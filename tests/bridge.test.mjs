import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, REAL_COLLECTOR, until } from "./helpers.mjs";

const { Bridge } = await import("../lib/bridge.ts");
const { projectState } = await import("../lib/project.ts");

const quiet = () => {};
const fixture = (name) => join(FIXTURES, name);

async function withBridge(options, fn) {
  const bridge = new Bridge({ log: quiet, ...options });
  bridge.start();
  try {
    return await fn(bridge);
  } finally {
    await bridge.stop();
  }
}

test("real collector, demo mode: state arrives and the detail round trip works", { skip: !existsSync(REAL_COLLECTOR) && "T3 Loupe plugin not installed" }, async () => {
  await withBridge({ collector: REAL_COLLECTOR, mode: "demo" }, async (bridge) => {
    await until(() => bridge.state);
    assert.equal(bridge.status, "running");
    assert.ok(bridge.state.rows.length > 5, "demo rows arrive");
    assert.ok(bridge.environmentIds().includes("demo-laptop"));
    const waiting = bridge.waitForDetail("demo-laptop", "approve", 3000);
    assert.equal(bridge.requestDetail("demo-laptop", "approve"), true);
    const got = await waiting;
    assert.ok(got, "detail arrives");
    assert.equal(got.detail.pending[0].kind, "command");
    assert.ok(bridge.cachedDetail("demo-laptop", "approve"));
  });
});

test("detail requests are refused for bad ids and unknown environments", async () => {
  await withBridge({ collector: fixture("collector-leaky.mjs") }, async (bridge) => {
    await until(() => bridge.state);
    assert.equal(bridge.requestDetail("env-a", "t1"), true);
    assert.equal(bridge.requestDetail("env-unknown", "t1"), false);
    assert.equal(bridge.requestDetail("env-a", "../etc"), false);
    assert.equal(bridge.requestDetail("env-a", "x".repeat(121)), false);
    assert.equal(bridge.requestDetail("env-a", 'a"b'), false);
  });
});

test("protocol version 2 puts the bridge in protocol_mismatch", async () => {
  await withBridge({ collector: fixture("collector-v2.mjs"), backoffStartMs: 5000 }, async (bridge) => {
    await until(() => bridge.status === "protocol_mismatch");
    assert.equal(bridge.state, null, "a v2 state is never kept");
    assert.equal(projectState(bridge).collector.status, "protocol_mismatch");
  });
});

test("a crashing collector restarts with doubling backoff", async () => {
  const delays = [];
  await withBridge({ collector: fixture("collector-crash.mjs"), backoffStartMs: 50, backoffMaxMs: 400 }, async (bridge) => {
    bridge.on("restart-scheduled", (d) => delays.push(d));
    await until(() => delays.length >= 4, { timeout: 15_000 });
    assert.deepEqual(delays.slice(0, 4), [50, 100, 200, 400]);
    assert.ok(bridge.state, "the state from before the crash is kept");
    assert.ok(["restarting", "running"].includes(bridge.status));
  });
});

test("an oversized line is dropped and the next line still parses", async () => {
  const logs = [];
  await withBridge({ collector: fixture("collector-oversize.mjs"), maxLineBytes: 64 * 1024, log: (m) => logs.push(m) }, async (bridge) => {
    await until(() => bridge.state);
    assert.equal(bridge.state.marker, "normal");
    assert.ok(logs.some((m) => /dropped an oversized collector line/.test(m)));
    assert.ok(!logs.some((m) => m.includes("Fixture thread")), "the dropped content is never logged");
  });
});

test("an oversized line split across many chunks is dropped whole", async () => {
  const seen = [];
  await withBridge({ collector: fixture("collector-oversize-chunked.mjs"), maxLineBytes: 64 * 1024 }, async (bridge) => {
    bridge.on("state", () => seen.push(bridge.state.marker));
    await until(() => bridge.state);
    assert.deepEqual(seen, ["normal"], "only the normal line is ever parsed");
  });
});

test("a node binary that can't be spawned reports failed and keeps retrying", async () => {
  const delays = [];
  await withBridge({ collector: fixture("collector-leaky.mjs"), node: "/nonexistent/node", backoffStartMs: 20, backoffMaxMs: 80 }, async (bridge) => {
    bridge.on("restart-scheduled", (d) => delays.push(d));
    await until(() => delays.length >= 3, { timeout: 5000 });
    assert.equal(bridge.status, "failed");
    assert.equal(bridge.lastError, "spawn_failed");
    assert.deepEqual(delays.slice(0, 3), [20, 40, 80]);
  });
});

test("backoff resets after the collector has been healthy for a while", async () => {
  const delays = [];
  await withBridge({ collector: fixture("collector-crash.mjs"), backoffStartMs: 50, backoffMaxMs: 400, healthyAfterMs: 1 }, async (bridge) => {
    bridge.on("restart-scheduled", (d) => delays.push(d));
    await until(() => delays.length >= 3, { timeout: 10_000 });
    assert.deepEqual(delays.slice(0, 3), [50, 50, 50], "each healthy run resets the backoff");
  });
});

test("detail waits are coalesced per thread and capped overall", async () => {
  await withBridge({ collector: fixture("collector-silent.mjs") }, async (bridge) => {
    await until(() => bridge.state);
    const a = bridge.waitForDetail("env-a", "t1", 300);
    const b = bridge.waitForDetail("env-a", "t1", 300);
    assert.equal(a, b, "one shared wait per thread");
    const many = [];
    for (let i = 0; i < 15; i++) many.push(bridge.waitForDetail("env-a", `x${i}`, 300));
    assert.equal(await bridge.waitForDetail("env-a", "one-too-many", 300), "busy");
    assert.equal(await a, null, "times out to null");
    await Promise.all(many);
    assert.notEqual(await bridge.waitForDetail("env-a", "after", 50), "busy", "slots free up after the timeout");
  });
});

test("stderr keeps only the error code, never the detail text", async () => {
  const logs = [];
  await withBridge({ collector: fixture("collector-stderr.mjs"), log: (m) => logs.push(m) }, async (bridge) => {
    await until(() => bridge.state && bridge.lastError);
    assert.equal(bridge.lastError, "config_invalid");
    const out = JSON.stringify(projectState(bridge));
    assert.ok(out.includes("config_invalid"));
    assert.ok(!out.includes("PRIVATE-DETAIL"));
    assert.ok(!logs.join("\n").includes("PRIVATE-DETAIL"));
  });
});

test("a missing collector reports missing and keeps checking", async () => {
  const delays = [];
  await withBridge({ collector: fixture("does-not-exist.mjs"), backoffStartMs: 20, backoffMaxMs: 40 }, async (bridge) => {
    bridge.on("restart-scheduled", (d) => delays.push(d));
    await until(() => bridge.status === "missing");
    await until(() => delays.length >= 2);
    assert.equal(projectState(bridge).collector.status, "missing");
    assert.equal(projectState(bridge).at, null);
  });
});

test("stop() ends the collector child", async () => {
  const bridge = new Bridge({ collector: fixture("collector-leaky.mjs"), log: quiet });
  bridge.start();
  await until(() => bridge.state);
  const pid = bridge.pid;
  assert.ok(pid);
  await bridge.stop();
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});
