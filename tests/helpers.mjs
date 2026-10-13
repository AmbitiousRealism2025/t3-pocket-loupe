// Test helpers: start server.ts as a child process and talk raw HTTP to it.
import { spawn } from "node:child_process";
import { request } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES = join(ROOT, "tests", "fixtures");
/** The installed T3 Loupe plugin (read and run only, never modified). */
export const T3_LOUPE_DIR = process.env.T3_LOUPE_DIR || join(homedir(), ".config/omarchy/plugins/ambitiousrealism.t3-loupe");
export const REAL_COLLECTOR = join(T3_LOUPE_DIR, "daemon", "main.ts");

/** Starts the server on a free port. Resolves once it prints its address. */
export function startServer({ args = ["--demo"], env = {}, server = join(ROOT, "server.ts") } = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.HOST;
  if (env.HOST !== undefined) childEnv.HOST = env.HOST;
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", server, "--port", "0", ...args], {
    env: childEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error("server did not start: " + stderr)), 10_000);
    proc.stdout.on("data", (d) => {
      out += d;
      const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        const port = Number(m[1]);
        resolve({
          proc, port, host: `127.0.0.1:${port}`, stderr: () => stderr,
          stop: () => new Promise((r) => { if (proc.exitCode !== null) return r(); proc.once("exit", r); proc.kill("SIGTERM"); }),
        });
      }
    });
    proc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${stderr}`)); });
  });
}

/** Raw request: the path is sent as written, and the Host header can be anything. */
export function http(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers }, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const text = res.headers["content-encoding"] === "gzip" ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, raw, text, json });
      });
    });
    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("timeout")));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Polls until `fn` returns a truthy value. */
export async function until(fn, { timeout = 10_000, every = 100 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, every));
  }
}

export async function stateWithRows(port) {
  return until(async () => {
    const r = await http(port, "/api/state");
    return r.json?.rows?.length ? r : null;
  });
}

/** Every key path and string value in a JSON value. */
export function walk(value, path = "$", out = { keys: [], strings: [] }) {
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { out.keys.push(`${path}.${k}`); walk(v, `${path}.${k}`, out); }
  else if (typeof value === "string") out.strings.push(value);
  return out;
}
