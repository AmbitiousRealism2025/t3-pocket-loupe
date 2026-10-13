// Screenshots of the phone app at iPhone size (390×844 CSS px, 3x), demo data only.
// Drives headless Chrome over the DevTools protocol (Node's built-in WebSocket), so it can
// also stop the server and reload to show the offline, stale state from the service worker.
//
//   node tools/screenshots.mjs [outDir]       default docs/screens
// Records every PNG's SHA-256 in <outDir>/manifest.txt with "mode: demo" for the privacy scan.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, "docs", "screens");
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const FIX = join(ROOT, "tests", "fixtures");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(env) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.HOST;
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "server.ts"), "--port", "0"], { env: childEnv, stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    let out = "";
    proc.stdout.on("data", (d) => {
      out += d;
      const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (m) resolve({ proc, ready: async () => {
        for (let i = 0; i < 100; i++) {
          try { if ((await (await fetch(`http://127.0.0.1:${m[1]}/healthz`)).json()).lastStateAt) return; } catch {}
          await sleep(100);
        }
      }, url: `http://127.0.0.1:${m[1]}/`, stop: () => new Promise((r) => { proc.once("exit", r); proc.kill("SIGTERM"); }) });
    });
    proc.once("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
}

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), "pocket-loupe-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch {}
  }
  if (!port) throw new Error("Chrome didn't start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const close = async () => { ws.close(); proc.kill("SIGTERM"); await sleep(300); rmSync(profile, { recursive: true, force: true }); };
  return { send, listeners, close };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const chrome = await launchChrome();
  const { send } = chrome;
  if (process.env.DEBUG) chrome.listeners.add((m) => {
    if (m.method === "Runtime.exceptionThrown") console.log("page exception:", JSON.stringify(m.params.exceptionDetails).slice(0, 600));
    if (m.method === "Runtime.consoleAPICalled") console.log("console:", m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  });
  await send("Log.enable");
  if (process.env.DEBUG) chrome.listeners.add((m) => { if (m.method === "Log.entryAdded") console.log("log:", m.params.entry.level, m.params.entry.text.slice(0, 300), m.params.entry.url || ""); });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  try {
    // iPhone 15-style insets, where this Chrome supports emulating them.
    await send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34, left: 0, right: 0 } });
  } catch {}
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  const waitFor = async (expression, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(expression)) return true;
      await sleep(100);
    }
    if (process.env.DEBUG) console.log("page:", await evaluate("JSON.stringify({busy: document.querySelector('#main')?.getAttribute('aria-busy'), summary: document.querySelector('#summary')?.textContent, main: document.querySelector('#main')?.textContent.slice(0, 200), crash: document.querySelector('#crash')?.hidden})"));
    throw new Error(`timed out waiting for ${expression}`);
  };
  const shots = [];
  const shot = async (name) => {
    await sleep(400);
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const buf = Buffer.from(data, "base64");
    writeFileSync(join(OUT, `${name}.png`), buf);
    shots.push(`${createHash("sha256").update(buf).digest("hex")}  ${name}.png`);
    console.log(`screenshots: ${name}.png`);
  };
  const open = async (url, ready) => {
    for (const srv of [s]) if (srv?.ready) await srv.ready();
    await send("Page.navigate", { url });
    await waitFor(ready);
  };
  const READY_MAIN = "document.querySelector('#main')?.getAttribute('aria-busy') === 'false' && !document.querySelector('#main .skeleton')";

  // Dark theme, demo data.
  let s = await startServer({ POCKET_LOUPE_DEMO: "1", POCKET_LOUPE_THEME_FILE: join(FIX, "theme-dark.toml") });
  await open(s.url + "#/", READY_MAIN);
  await shot("main-dark");
  await open(s.url + "#/thread/demo-laptop/approve", "!!document.querySelector('pre.command')");
  await shot("thread-command-dark");
  await open(s.url + "#/thread/demo-server/question", "!!document.querySelector('.question')");
  await shot("thread-question-dark");
  await open(s.url + "#/thread/demo-laptop/work", "!!document.querySelector('svg.runs')");
  await shot("thread-working-dark");
  await open(s.url + "#/machine/demo-server", "!!document.querySelector('.provider')");
  await shot("machine-dark");

  // Offline: let the service worker cache the shell and the last state, stop the server, reload.
  await open(s.url + "#/", READY_MAIN);
  await waitFor("navigator.serviceWorker.controller !== null", 10000);
  await send("Page.reload");
  await waitFor(READY_MAIN);
  await waitFor("caches.keys().then((k) => Promise.all(k.filter((n) => n.includes('-api-')).map((n) => caches.open(n).then((c) => c.keys())))).then((l) => l.flat().length > 0)", 10000);
  await s.stop();
  await send("Page.reload");
  await waitFor("document.querySelector('#stale-banner')?.classList.contains('on')", 15000);
  await shot("stale-dark");

  // Empty: a paired machine with nothing running.
  s = await startServer({ POCKET_LOUPE_COLLECTOR: join(FIX, "collector-empty.mjs"), POCKET_LOUPE_THEME_FILE: join(FIX, "theme-dark.toml") });
  await open(s.url + "#/", READY_MAIN);
  await shot("empty-dark");
  await s.stop();

  // Light theme.
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  s = await startServer({ POCKET_LOUPE_DEMO: "1", POCKET_LOUPE_THEME_FILE: join(FIX, "theme-light.toml") });
  await open(s.url + "#/", READY_MAIN);
  await shot("main-light");
  await open(s.url + "#/thread/demo-laptop/approve", "!!document.querySelector('pre.command')");
  await shot("thread-command-light");
  await s.stop();

  await chrome.close();
  writeFileSync(join(OUT, "manifest.txt"), ["# Written by tools/screenshots.mjs. Synthetic demo data only.", "mode: demo", ...shots, ""].join("\n"));
  console.log(`screenshots: ${shots.length} written to ${OUT}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
