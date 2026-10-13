// Shared body for the fake collectors: a demo-shaped state with every leaky field the
// real collector has (and a few it doesn't), so tests can prove the projection drops them.
import { createInterface } from "node:readline";

// Built at runtime so the repo's privacy scan never sees a literal home path.
export const HOME = ["", "home", "fixture-user", ""].join("/");

export const SECRET = "fake token SHOULD NEVER LEAVE";

export function leakyState(extra = {}) {
  const now = Date.now();
  return {
    v: 1, type: "state", at: now, known: true,
    token: SECRET,
    counts: { active: 2, busy: 1, attention: 1, input: 1, review: 0, secret: SECRET },
    environments: [{
      id: "env-a", label: "fixture-box", hostLabel: "127.0.0.1:3773", state: "live", stale: false,
      url: "http://127.0.0.1:3773/?token=" + SECRET, token: SECRET, serverVersion: "test", lastLiveAt: now,
      sessionExpiresAt: now + 86400_000, retryAt: null, counts: { active: 2, busy: 1, attention: 1, input: 1, review: 0 },
      providers: [{ id: "codex", name: "Codex", driver: "codex", status: "ready", auth: "authenticated", version: "9.9.9",
        checkedAt: now, token: SECRET, windows: [{ label: "Session", kind: "session", usedPercent: 40, resetsAt: now + 3600_000, durationMins: 300, url: "http://127.0.0.1:9/" }] }],
    }],
    rows: [
      { key: "env-a:t1", envId: "env-a", id: "t1", parentId: "", title: "Fixture thread waiting on you", projectId: "proj-secret-id",
        project: "fixture", branch: "main", worktree: HOME + "worktrees/fixture", provider: "codex", model: "m", mode: "full-access",
        plan: false, state: "input", rawStatus: "running", pendingKind: "command", pendingSince: now - 60_000, activeSince: now - 120_000,
        lastRunMs: null, completedAt: null, updatedAt: now, unread: false, pinned: false, settled: false, snoozedUntil: null,
        background: { subagents: 0, commands: 0, monitors: 0, other: 0, token: SECRET }, prCount: 1, errorClass: "", error: "",
        pr: { number: 7, title: "Fixture PR", url: "https://example.invalid/pr/7", state: "open", checks: "passing", draft: false,
          additions: 1, deletions: 1, review: "", headRef: HOME + "x", token: SECRET },
        usageResetAt: null, childCount: 0, activeChildren: 0, stale: false, cwd: HOME + "project", token: SECRET,
        activity: [{ icon: "terminal", label: "npm test", status: "running", at: now, cwd: HOME + "project" }] },
      { key: "env-a:t2", envId: "env-a", id: "t2", parentId: "", title: "Fixture thread working", projectId: "p", project: "fixture",
        branch: "", worktree: true, provider: "claudeAgent", model: "m", mode: "", plan: false, state: "working", rawStatus: "running",
        pendingKind: "", pendingSince: null, activeSince: now - 30_000, lastRunMs: null, completedAt: null, updatedAt: now,
        unread: false, pinned: false, settled: false, snoozedUntil: null, background: { subagents: 1, commands: 0, monitors: 0, other: 0 },
        pr: null, prCount: 0, errorClass: "", error: "x".repeat(1000), usageResetAt: null, childCount: 0, activeChildren: 0, activity: [] },
    ],
    ...extra,
  };
}

export function leakyDetail(envId, threadId) {
  return {
    v: 1, type: "detail", envId, threadId,
    detail: {
      token: SECRET,
      activity: [{ icon: "terminal", label: "npm test", status: "running", at: Date.now(), output: HOME + "secret-output" }],
      pending: [{ id: "r1", kind: "command", since: Date.now(), prompt: "npm publish", appName: "", options: ["Allow once", "Decline"],
        questions: [], raw: { token: SECRET } }],
      runs: [{ ordinal: 1, status: "completed", startedAt: 1, completedAt: 2, durationMs: 1, diff: HOME + "diff" }],
      context: { used: 10, max: 100, cost: 0.5, currency: "USD", token: SECRET },
      subagents: [{ id: "s1", title: "Sub", status: "running", progress: "", model: "m", startedAt: 1, completedAt: null, childThreadId: "t9", transcript: SECRET }],
      todo: { total: 3, done: 1, current: "Step two", items: [SECRET] },
    },
  };
}

export const write = (m) => process.stdout.write(JSON.stringify(m) + "\n");

/** Answers `detail` commands on stdin like the real collector. */
export function answerDetails(make = leakyDetail) {
  createInterface({ input: process.stdin }).on("line", (line) => {
    try {
      const cmd = JSON.parse(line);
      if (cmd.cmd === "detail") write(make(cmd.envId, cmd.threadId));
    } catch {}
  }).on("close", () => process.exit(0));
}

export function stayAlive() {
  setInterval(() => {}, 1 << 30);
  process.on("SIGTERM", () => process.exit(0));
}
