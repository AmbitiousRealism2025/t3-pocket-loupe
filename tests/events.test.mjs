// /api/events: the server-sent event stream.
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { join } from "node:path";
import { FIXTURES, http, startServer, until } from "./helpers.mjs";
import { SECRET } from "./fixtures/fake-collector.mjs";

/** Opens an event stream and collects parsed events until closed. */
function openStream(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const events = [];
    const comments = [];
    let buf = "";
    const req = request({ host: "127.0.0.1", port, path: "/api/events", headers: { Host: `127.0.0.1:${port}`, Accept: "text/event-stream", ...headers }, agent: false }, (res) => {
      const stream = { res, req, events, comments, status: res.statusCode, headers: res.headers, ended: false, raw: () => buf };
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const lines = block.split("\n");
          if (lines.every((l) => l.startsWith(":"))) { comments.push(block); continue; }
          const ev = { event: "message", data: "" };
          for (const l of lines) {
            if (l.startsWith("event: ")) ev.event = l.slice(7);
            else if (l.startsWith("data: ")) ev.data += l.slice(6);
          }
          if (ev.data) events.push({ ...ev, at: Date.now(), json: JSON.parse(ev.data) });
        }
      });
      res.on("end", () => { stream.ended = true; });
      resolve(stream);
    });
    req.on("error", reject);
    req.end();
  });
}

test("SSE: the first event arrives at once with the projected state and no secrets", async () => {
  const s = await startServer({ args: [], env: { POCKET_LOUPE_COLLECTOR: join(FIXTURES, "collector-leaky.mjs") } });
  try {
    await until(async () => (await http(s.port, "/healthz")).json?.lastStateAt);
    const st = await openStream(s.port);
    assert.equal(st.status, 200);
    assert.match(st.headers["content-type"], /^text\/event-stream/);
    assert.equal(st.headers["cache-control"], "no-store");
    assert.equal(st.headers["x-accel-buffering"], "no");
    assert.ok(st.headers["content-security-policy"], "security headers on the stream too");
    await until(() => st.events.length >= 1, { timeout: 3000 });
    const first = st.events[0];
    assert.equal(first.event, "state");
    assert.equal(first.json.v, 1);
    assert.ok(first.json.rows.length >= 1);
    assert.ok(!st.raw().includes(SECRET) && !first.data.includes(SECRET), "no token in the stream");
    assert.ok(!first.data.includes("worktree"), "the projection applies");
    st.req.destroy();
  } finally {
    await s.stop();
  }
});

test("SSE: changes are sent, at most once per second", async () => {
  // The leaky fixture emits a state every second; the demo collector every 5 s.
  const s = await startServer({ args: [], env: { POCKET_LOUPE_COLLECTOR: join(FIXTURES, "collector-leaky.mjs") } });
  try {
    await until(async () => (await http(s.port, "/healthz")).json?.lastStateAt);
    const st = await openStream(s.port);
    await until(() => st.events.length >= 4, { timeout: 8000 });
    const gaps = st.events.slice(1).map((e, i) => e.at - st.events[i].at);
    for (const g of gaps.slice(1)) assert.ok(g >= 900, `events at least ~1 s apart (gap ${g} ms)`);
    st.req.destroy();
  } finally {
    await s.stop();
  }
});

test("SSE: the ninth concurrent stream gets 503, and closed streams free their slot", async () => {
  const s = await startServer();
  try {
    const open = [];
    for (let i = 0; i < 8; i++) open.push(await openStream(s.port));
    assert.ok(open.every((x) => x.status === 200));
    const ninth = await openStream(s.port);
    assert.equal(ninth.status, 503);
    ninth.req.destroy();
    open[0].req.destroy();
    open[0].res.destroy();
    const again = await until(async () => {
      const x = await openStream(s.port);
      if (x.status === 200) return x;
      x.req.destroy();
      return null;
    }, { timeout: 3000 });
    assert.equal(again.status, 200, "a disconnected client's slot is reused");
    for (const x of [...open.slice(1), again]) x.req.destroy();
  } finally {
    await s.stop();
  }
});

test("SSE: a shut-down server ends its streams and still exits 0 promptly", async () => {
  const s = await startServer();
  const st = await openStream(s.port);
  await until(() => st.events.length >= 1, { timeout: 5000 });
  const t0 = Date.now();
  const code = await new Promise((resolve) => { s.proc.once("exit", resolve); s.proc.kill("SIGTERM"); });
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 3000);
  await until(() => st.ended || st.res.destroyed, { timeout: 2000 });
});

test("SSE: Host and method guards apply to the stream", async () => {
  const s = await startServer();
  try {
    const evil = await openStream(s.port, { Host: "evil.example" });
    assert.equal(evil.status, 421);
    evil.req.destroy();
    assert.equal((await http(s.port, "/api/events", { method: "POST", headers: { Origin: "https://evil.example" }, body: "" })).status, 403);
  } finally {
    await s.stop();
  }
});

// ---- the hub's own bounds, with small timings, against an in-process server ----

const { EventHub } = await import("../lib/events.ts");
const { createServer } = await import("node:http");
const { EventEmitter } = await import("node:events");

function fakeBridge(rows = 1, titleBytes = 40) {
  const bridge = new EventEmitter();
  bridge.status = "running";
  bridge.lastError = null;
  bridge.receivedAt = Date.now();
  bridge.state = { v: 1, type: "state", at: Date.now(), known: true, counts: {}, environments: [], rows: Array.from({ length: rows }, (_, i) => ({ key: `e:${i}`, envId: "e", id: String(i), title: "t".repeat(titleBytes), state: "working" })) };
  return bridge;
}

async function hubServer(bridge, options) {
  const hub = new EventHub(bridge, options);
  const server = createServer((req, res) => hub.open(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { hub, server, port: server.address().port, close: () => { hub.closeAll(); server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

test("hub: a ping comment arrives every pingMs", async () => {
  const h = await hubServer(fakeBridge(), { pingMs: 100 });
  try {
    const st = await openStream(h.port);
    await until(() => st.comments.some((c) => c.startsWith(": ping")), { timeout: 2000 });
    st.req.destroy();
  } finally {
    await h.close();
  }
});

test("hub: a stream ends after maxAgeMs and frees its slot", async () => {
  const h = await hubServer(fakeBridge(), { maxAgeMs: 300 });
  try {
    const st = await openStream(h.port);
    await until(() => st.ended, { timeout: 3000 });
    await until(() => h.hub.size === 0, { timeout: 1000 });
  } finally {
    await h.close();
  }
});

test("hub: a reader that stops reading never makes the server buffer more than a frame, and is closed when it stalls", async () => {
  // About 1 MB per frame; the bridge "changes" every 20 ms.
  const bridge = fakeBridge(500, 2000);
  const h = await hubServer(bridge, { minIntervalMs: 10, stallMs: 400, pingMs: 50 });
  const frame = JSON.stringify(bridge.state).length;
  try {
    const st = await openStream(h.port);
    st.res.pause();
    st.res.socket.pause();
    const ticker = setInterval(() => { bridge.state = { ...bridge.state, at: Date.now() }; bridge.emit("state"); }, 20);
    let peak = 0;
    const watch = setInterval(() => { peak = Math.max(peak, h.hub.buffered); }, 10);
    await until(() => h.hub.size === 0, { timeout: 5000 });
    clearInterval(ticker);
    clearInterval(watch);
    assert.ok(peak <= frame * 2.5, `peak buffered ${peak} bytes for a ${frame}-byte frame`);
    st.req.destroy();
  } finally {
    await h.close();
  }
});
