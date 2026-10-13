import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FIXTURES, http, startServer, stateWithRows, until, walk } from "./helpers.mjs";
import { HOME, SECRET } from "./fixtures/fake-collector.mjs";

const { projectDetail, parseThemeColors } = await import("../lib/project.ts");

// The contract in PLAN.md §3.2: the only keys the phone may ever see.
const STATE_KEYS = ["v", "collector", "at", "receivedAt", "known", "configError", "truncated", "counts", "environments", "rows"];
const COUNTS = ["active", "busy", "attention", "input", "review"];
const ENV_KEYS = ["id", "label", "state", "stale", "lastLiveAt", "sessionExpiresAt", "retryAt", "serverVersion", "counts", "providers"];
const PROVIDER_KEYS = ["id", "name", "status", "auth", "windows"];
const WINDOW_KEYS = ["label", "kind", "usedPercent", "resetsAt", "durationMins"];
const ROW_KEYS = ["key", "envId", "id", "parentId", "title", "project", "branch", "provider", "model", "mode", "plan", "state",
  "pendingKind", "pendingSince", "activeSince", "lastRunMs", "completedAt", "updatedAt", "unread", "pinned", "settled", "snoozedUntil",
  "background", "pr", "prCount", "errorClass", "error", "usageResetAt", "childCount", "activeChildren", "activity"];
const PR_KEYS = ["number", "title", "url", "state", "checks", "draft", "additions", "deletions", "review"];
const ACTIVITY_KEYS = ["icon", "label", "status", "at"];
const DETAIL_KEYS = ["activity", "pending", "runs", "context", "subagents", "todo"];

const keys = (o) => Object.keys(o).sort();
const same = (o, want, what) => assert.deepEqual(keys(o), [...want].sort(), what);

function assertNoLeaks(body, what) {
  const { keys: paths, strings } = walk(body);
  const text = JSON.stringify(body);
  assert.ok(!text.includes(SECRET), `${what}: the token never leaves`);
  assert.ok(!text.includes(HOME), `${what}: no home paths`);
  assert.ok(!text.includes("/home/"), `${what}: no home paths`);
  assert.ok(!strings.some((s) => s.includes("127.0.0.1:")), `${what}: no loopback addresses`);
  for (const bad of ["token", "worktree", "hostLabel", "projectId", "rawStatus", "driver", "checkedAt", "cwd", "secret"]) {
    assert.ok(!paths.some((p) => p.endsWith(`.${bad}`)), `${what}: no ${bad} field`);
  }
  assert.ok(!paths.some((p) => /\.environments\[\d+\]\.url$/.test(p)), `${what}: no url on environments`);
}

test("projection: /api/state is exactly the allowlist, even from a leaky collector", async () => {
  const s = await startServer({ args: [], env: { POCKET_LOUPE_COLLECTOR: join(FIXTURES, "collector-leaky.mjs") } });
  try {
    const { json: body, headers } = await stateWithRows(s.port);
    assert.match(headers["content-type"], /^application\/json/);
    assert.match(headers["cache-control"], /no-cache|no-store/);
    same(body, STATE_KEYS, "state keys");
    same(body.counts, COUNTS, "counts keys");
    same(body.collector, ["status", "error"], "collector keys");
    for (const e of body.environments) {
      same(e, ENV_KEYS, "environment keys");
      same(e.counts, COUNTS, "environment counts keys");
      for (const p of e.providers) {
        same(p, PROVIDER_KEYS, "provider keys");
        for (const w of p.windows) same(w, WINDOW_KEYS, "window keys");
      }
    }
    for (const r of body.rows) {
      same(r, ROW_KEYS, "row keys");
      same(r.background, ["subagents", "commands", "monitors", "other"], "background keys");
      if (r.pr) same(r.pr, PR_KEYS, "pr keys");
      for (const a of r.activity) same(a, ACTIVITY_KEYS, "activity keys");
    }
    assert.ok(body.rows[1].error.length <= 300, "errors are capped at 300 characters");
    assertNoLeaks(body, "/api/state");
  } finally {
    await s.stop();
  }
});

test("projection: /api/thread is the detail allowlist, even from a leaky collector", async () => {
  const s = await startServer({ args: [], env: { POCKET_LOUPE_COLLECTOR: join(FIXTURES, "collector-leaky.mjs") } });
  try {
    await stateWithRows(s.port);
    const first = await http(s.port, "/api/thread/env-a/t1");
    assert.equal(first.status, 200);
    assert.equal(first.json.cached, false);
    same(first.json, ["v", "envId", "threadId", "at", "cached", "detail"], "thread keys");
    same(first.json.detail, DETAIL_KEYS, "detail keys");
    same(first.json.detail.pending[0], ["id", "kind", "since", "prompt", "appName", "options", "questions"], "pending keys");
    same(first.json.detail.runs[0], ["ordinal", "status", "startedAt", "completedAt", "durationMs"], "run keys");
    same(first.json.detail.context, ["used", "max", "cost", "currency"], "context keys");
    same(first.json.detail.subagents[0], ["id", "title", "status", "progress", "model", "startedAt", "completedAt", "childThreadId"], "subagent keys");
    same(first.json.detail.todo, ["total", "done", "current"], "todo keys");
    for (const a of first.json.detail.activity) same(a, ACTIVITY_KEYS, "activity keys");
    assertNoLeaks(first.json, "/api/thread");
    assert.equal(first.headers["cache-control"], "no-store");

    const second = await http(s.port, "/api/thread/env-a/t1");
    assert.equal(second.status, 200);
    assert.equal(second.json.cached, true, "a cached detail comes back at once");
    assertNoLeaks(second.json, "/api/thread (cached)");
  } finally {
    await s.stop();
  }
});

test("thread endpoint: unknown environment, bad ids and timeouts", async () => {
  const s = await startServer({ args: [], env: { POCKET_LOUPE_COLLECTOR: join(FIXTURES, "collector-silent.mjs") } });
  try {
    await stateWithRows(s.port);
    assert.equal((await http(s.port, "/api/thread/nope/t1")).status, 404);
    assert.equal((await http(s.port, "/api/thread/env-a/%2e%2e")).status, 404);
    assert.equal((await http(s.port, "/api/thread/env-a/a%22b")).status, 404);
    assert.equal((await http(s.port, "/api/thread/env-a/%E0%A4%A")).status, 404);
    assert.equal((await http(s.port, "/api/thread/env-a")).status, 404);
    const t0 = Date.now();
    const slow = await http(s.port, "/api/thread/env-a/t1");
    assert.equal(slow.status, 504);
    assert.deepEqual(slow.json, { error: "detail_timeout" });
    assert.ok(Date.now() - t0 < 4500, "the wait is bounded at about 3 s");
  } finally {
    await s.stop();
  }
});

test("before the first state, /api/state says what the collector is doing", async () => {
  const s = await startServer({ args: [], env: { POCKET_LOUPE_COLLECTOR: join(FIXTURES, "does-not-exist.mjs") } });
  try {
    const body = await until(async () => {
      const r = await http(s.port, "/api/state");
      return r.json?.collector?.status === "missing" ? r.json : null;
    });
    assert.equal(body.at, null);
    assert.deepEqual(body.rows, []);
    const health = await http(s.port, "/healthz");
    assert.equal(health.json.ok, false);
    assert.equal(health.json.collector, "missing");
  } finally {
    await s.stop();
  }
});

test("projectDetail tolerates junk and drops unknown fields", () => {
  assert.deepEqual(projectDetail(null), { activity: [], pending: [], runs: [], context: null, subagents: [], todo: null });
  const d = projectDetail({ activity: [null, 3, { icon: 1, label: "x", extra: "y" }], pending: [{ options: ["a", 2, "b"], questions: [{ options: [1] }] }] });
  assert.deepEqual(d.activity, [{ icon: "", label: "x", status: "", at: null }]);
  assert.deepEqual(d.pending[0].options, ["a", "b"]);
  assert.deepEqual(d.pending[0].questions[0].options, []);
});

test("parseThemeColors keeps only key = \"#rrggbb\" lines", () => {
  const colors = parseThemeColors('mode = "dark"\naccent = "#82FB9C"\nborder = "rgba(1,2,3,1)"\nbackground = "#0B0C16" # comment\nbad = "#12345"\n');
  assert.deepEqual(colors, { accent: "#82fb9c", background: "#0b0c16" });
  assert.equal(parseThemeColors("nothing here"), null);
});
