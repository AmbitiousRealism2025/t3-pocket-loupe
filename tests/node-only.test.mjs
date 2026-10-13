// The three rules `nixweb check --target` skips for a Node server, because they need a
// server the checker started itself. Recorded in CONFORMANCE.md.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURES, REAL_COLLECTOR, ROOT, http, startServer, until } from "./helpers.mjs";

/** Listening sockets for a port, from the kernel's socket tables. */
function listeners(port) {
  const found = [];
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let rows = [];
    try { rows = readFileSync(table, "utf8").trim().split("\n").slice(1); } catch { continue; }
    for (const row of rows) {
      const cols = row.trim().split(/\s+/);
      if (cols[3] !== "0A") continue; // LISTEN
      const [ip, p] = cols[1].split(":");
      if (parseInt(p, 16) === port) found.push({ table, ip });
    }
  }
  return found;
}

function children(pid) {
  try {
    return readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return readdirSync("/proc").filter((d) => /^\d+$/.test(d)).filter((d) => {
      try { return readFileSync(`/proc/${d}/stat`, "utf8").split(") ")[1].split(" ")[1] === String(pid); } catch { return false; }
    }).map(Number);
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function exitOf(args, env = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env, POCKET_LOUPE_COLLECTOR: join(FIXTURES, "collector-leaky.mjs"), ...env };
    if (!("HOST" in env)) delete childEnv.HOST;
    const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "server.ts"), "--port", "0", ...args], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill("SIGKILL"), 5000);
    p.on("exit", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

test("NW-NET-002: the listening socket is 127.0.0.1 and nothing else", async () => {
  const s = await startServer();
  try {
    const rows = listeners(s.port);
    assert.ok(rows.length >= 1, "a listening socket exists");
    for (const r of rows) {
      const loopback = r.table === "/proc/net/tcp" ? r.ip === "0100007F" : r.ip === "0000000000000000FFFF00000100007F";
      assert.ok(loopback, `listening on ${r.table} ${r.ip}`);
    }
  } finally {
    await s.stop();
  }
});

test("NW-NET-002: a non-loopback --host or HOST exits non-zero without listening", async () => {
  const tailnetIp = [100, 64, 0, 1].join(".");
  for (const host of ["0.0.0.0", "::", "::1", tailnetIp, "example.com", "127.0.0.2"]) {
    const r = await exitOf(["--host", host]);
    assert.notEqual(r.code, 0, `--host ${host}`);
    assert.ok(!/listening/.test(r.out), `--host ${host} never listens`);
    assert.match(r.err, /refusing to bind/);
  }
  const env = await exitOf([], { HOST: "0.0.0.0" });
  assert.notEqual(env.code, 0, "HOST=0.0.0.0");
  const fine = await exitOf(["--host", "127.0.0.1", "--port", "0"], {});
  assert.equal(fine.code, null, "127.0.0.1 is accepted (killed by the test timer)");
});

test("NW-SRV-005: only public/ is published, with planted files, symlinks and traversal", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "pocket-loupe-srv005-"));
  try {
    const app = join(tmp, "app");
    mkdirSync(app);
    for (const f of ["server.ts", "lib", "public", "package.json"]) cpSync(join(ROOT, f), join(app, f), { recursive: true });
    writeFileSync(join(app, "zz-canary.txt"), "canary");
    writeFileSync(join(app, "secret.js"), "canary");
    writeFileSync(join(app, "public", "zz-canary.db"), "canary");
    writeFileSync(join(app, "public", "server.ts.bak"), "canary");
    writeFileSync(join(app, "public", "notes.md"), "canary");
    writeFileSync(join(app, "public", ".env"), "canary");
    mkdirSync(join(app, "public", ".git"));
    writeFileSync(join(app, "public", ".git", "config"), "canary");
    mkdirSync(join(app, "public", "zz-empty-dir"));
    symlinkSync(join(app, "server.ts"), join(app, "public", "leak.js"));
    symlinkSync(app, join(app, "public", "linked"));
    const s = await startServer({ server: join(app, "server.ts"), args: [], env: { POCKET_LOUPE_COLLECTOR: join(FIXTURES, "collector-leaky.mjs") } });
    try {
      assert.equal((await http(s.port, "/")).status, 200, "the real page is served");
      for (const p of ["/zz-canary.txt", "/secret.js", "/zz-canary.db", "/server.ts.bak", "/notes.md", "/.env", "/.git/config",
        "/zz-empty-dir/", "/zz-empty-dir", "/leak.js", "/linked/secret.js", "/linked/server.ts", "/../server.ts", "/%2e%2e/server.ts", "/server.ts"]) {
        const r = await http(s.port, p);
        assert.equal(r.status, 404, `${p} → ${r.status}`);
        assert.ok(!r.text.includes("canary"), `${p} leaks nothing`);
      }
    } finally {
      await s.stop();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("NW-SRV-010: SIGTERM exits 0 within 3 s and the collector child is gone", async () => {
  const useReal = existsSync(REAL_COLLECTOR);
  const s = await startServer({ args: useReal ? ["--demo"] : [], env: useReal ? {} : { POCKET_LOUPE_COLLECTOR: join(FIXTURES, "collector-leaky.mjs") } });
  await until(async () => (await http(s.port, "/healthz")).json?.ok);
  const kids = children(s.proc.pid);
  assert.ok(kids.length >= 1, "the collector child is running");
  const t0 = Date.now();
  const code = await new Promise((resolve) => { s.proc.once("exit", (c) => resolve(c)); s.proc.kill("SIGTERM"); });
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 3000, `exited in ${Date.now() - t0} ms`);
  await until(() => kids.every((k) => !alive(k)), { timeout: 2000 });
});
