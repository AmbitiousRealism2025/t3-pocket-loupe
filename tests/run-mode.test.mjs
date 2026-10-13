// Run mode end to end: the server spawns T3 Loupe's real collector, which connects to
// T3 Loupe's own fake T3 server through a temporary, private config directory.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REAL_COLLECTOR, T3_LOUPE_DIR, http, startServer, until, walk } from "./helpers.mjs";

const FAKE_T3 = join(T3_LOUPE_DIR, "tests", "lib", "fake-t3.mjs");
const skip = !(existsSync(REAL_COLLECTOR) && existsSync(FAKE_T3)) && "T3 Loupe plugin (with its tests) not installed";
const TOKEN = "fake token for the run-mode test";

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
function thread(id, extra = {}) {
  return {
    id, projectId: "p1", title: `Run-mode thread ${id}`, status: "idle", activityRunStatus: null, pendingRuntimeRequest: null,
    pendingBackgroundTasks: [], lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    modelSelection: { model: "m" }, providerInstanceId: "codex", updatedAt: iso(1000), settledAt: null,
    latestRunCompletedAt: null, lastVisitedAt: null, pullRequests: [], archivedAt: null, deletedAt: null, ...extra,
  };
}

test("run mode: a live environment and its rows reach /api/state; the token never does", { skip }, async () => {
  const { FakeT3 } = await import(FAKE_T3);
  const fake = new FakeT3({
    environmentId: "env-run-1",
    token: TOKEN,
    snapshot: {
      schemaVersion: 2, snapshotSequence: 10, archivedThreads: [],
      projects: [{ id: "p1", title: "run-proj" }],
      threads: [
        thread("t-input", { activityRunStatus: "running", status: "running", pendingRuntimeRequest: { kind: "command", createdAt: iso(5000) } }),
        thread("t-work", { activityRunStatus: "running", status: "running" }),
      ],
    },
  });
  const url = await fake.listen();
  const dir = mkdtempSync(join(tmpdir(), "pocket-loupe-run-"));
  chmodSync(dir, 0o700);
  writeFileSync(join(dir, "connections.json"), JSON.stringify({
    version: 1,
    environments: [{ environmentId: "env-run-1", label: "run-box", url, token: TOKEN, expiresAt: Math.floor(Date.now() / 1000) + 86400 }],
  }), { mode: 0o600 });
  const s = await startServer({ args: [], env: { T3_LOUPE_CONFIG_DIR: dir, POCKET_LOUPE_COLLECTOR: REAL_COLLECTOR } });
  try {
    const body = await until(async () => {
      const r = await http(s.port, "/api/state");
      const env = r.json?.environments?.[0];
      return env?.state === "live" && r.json.rows.length >= 2 ? r.json : null;
    }, { timeout: 20_000 });
    assert.equal(body.collector.status, "running");
    assert.equal(body.environments[0].label, "run-box");
    const byId = Object.fromEntries(body.rows.map((r) => [r.id, r]));
    assert.equal(byId["t-input"].state, "input");
    assert.equal(byId["t-input"].pendingKind, "command");
    assert.equal(byId["t-work"].state, "working");
    assert.equal(byId["t-work"].project, "run-proj");
    assert.ok(!JSON.stringify(body).includes(TOKEN));
    assert.ok(!walk(body).strings.some((x) => x.includes(url)), "the T3 URL never reaches the phone");

    const detail = await until(async () => {
      const r = await http(s.port, "/api/thread/env-run-1/t-work");
      return r.status === 200 ? r : null;
    }, { timeout: 10_000 });
    assert.ok(Array.isArray(detail.json.detail.runs));
  } finally {
    await s.stop();
    await fake.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
