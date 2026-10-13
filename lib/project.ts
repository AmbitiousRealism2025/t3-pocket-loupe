// The allowlist projection: collector objects in, API JSON out.
//
// Every field the phone receives is picked here by name, with its type checked and its
// length capped. Nothing is ever spread from a collector object, so a field the collector
// adds later (or one it already has, like an environment's `url` or a row's `worktree`)
// can't reach the phone by accident.
import type { Bridge } from "./bridge.ts";

const MAX_ROWS = 2000;
const MAX_ENVIRONMENTS = 32;
const MAX_LIST = 64;

function str(v: unknown, max = 500): string {
  return typeof v === "string" ? (v.length > max ? v.slice(0, max) : v) : "";
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean {
  return v === true;
}
function list<T>(v: unknown, pick: (item: any) => T, max = MAX_LIST): T[] {
  return Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === "object").map(pick) : [];
}
function strings(v: unknown, max = 500, count = MAX_LIST): string[] {
  return Array.isArray(v) ? v.slice(0, count).filter((x) => typeof x === "string").map((x) => str(x, max)) : [];
}

export function counts(c: any) {
  const o = c && typeof c === "object" ? c : {};
  return { active: num(o.active), busy: num(o.busy), attention: num(o.attention), input: num(o.input), review: num(o.review) };
}

function activity(a: any) {
  return { icon: str(a.icon, 64), label: str(a.label, 500), status: str(a.status, 32), at: numOrNull(a.at) };
}

function usageWindow(w: any) {
  return { label: str(w.label, 64), kind: str(w.kind, 32), usedPercent: num(w.usedPercent), resetsAt: numOrNull(w.resetsAt), durationMins: num(w.durationMins) };
}

function provider(p: any) {
  // Dropped on purpose: driver, version, checkedAt.
  return { id: str(p.id, 120), name: str(p.name, 120), status: str(p.status, 32), auth: str(p.auth, 32), windows: list(p.windows, usageWindow, 8) };
}

function environment(e: any) {
  // Dropped on purpose: url and hostLabel (ports, tunnel hosts).
  return {
    id: str(e.id, 120), label: str(e.label, 120), state: str(e.state, 40), stale: bool(e.stale),
    lastLiveAt: numOrNull(e.lastLiveAt), sessionExpiresAt: numOrNull(e.sessionExpiresAt), retryAt: numOrNull(e.retryAt),
    serverVersion: str(e.serverVersion, 64), counts: counts(e.counts), providers: list(e.providers, provider, 16),
  };
}

function pr(p: any) {
  if (!p || typeof p !== "object") return null;
  const url = str(p.url, 500);
  return {
    number: num(p.number), title: str(p.title, 300), url: /^https:\/\//.test(url) ? url : "", state: str(p.state, 16),
    checks: str(p.checks, 16), draft: bool(p.draft), additions: num(p.additions), deletions: num(p.deletions), review: str(p.review, 32),
  };
}

function background(b: any) {
  const o = b && typeof b === "object" ? b : {};
  return { subagents: num(o.subagents), commands: num(o.commands), monitors: num(o.monitors), other: num(o.other) };
}

function row(r: any) {
  // Dropped on purpose: worktree (a local path), projectId, rawStatus, stale.
  return {
    key: str(r.key, 250), envId: str(r.envId, 120), id: str(r.id, 120), parentId: str(r.parentId, 120),
    title: str(r.title, 500), project: str(r.project, 200), branch: str(r.branch, 200),
    provider: str(r.provider, 120), model: str(r.model, 120), mode: str(r.mode, 40), plan: bool(r.plan),
    state: str(r.state, 20), pendingKind: str(r.pendingKind, 40), pendingSince: numOrNull(r.pendingSince),
    activeSince: numOrNull(r.activeSince), lastRunMs: numOrNull(r.lastRunMs), completedAt: numOrNull(r.completedAt),
    updatedAt: numOrNull(r.updatedAt), unread: bool(r.unread), pinned: bool(r.pinned), settled: bool(r.settled),
    snoozedUntil: numOrNull(r.snoozedUntil), background: background(r.background), pr: pr(r.pr), prCount: num(r.prCount),
    errorClass: str(r.errorClass, 64), error: str(r.error, 300), usageResetAt: numOrNull(r.usageResetAt),
    childCount: num(r.childCount), activeChildren: num(r.activeChildren), activity: list(r.activity, activity, 12),
  };
}

export function projectState(bridge: Pick<Bridge, "state" | "receivedAt" | "status" | "lastError">) {
  const s = bridge.state;
  const base = {
    v: 1,
    collector: { status: bridge.status, error: bridge.lastError ? str(bridge.lastError, 64) : null },
    at: null as number | null,
    receivedAt: null as number | null,
    known: false,
    configError: null as string | null,
    truncated: false,
    counts: counts(null),
    environments: [] as ReturnType<typeof environment>[],
    rows: [] as ReturnType<typeof row>[],
  };
  if (!s) return base;
  return {
    ...base,
    at: numOrNull(s.at),
    receivedAt: bridge.receivedAt,
    known: bool(s.known),
    configError: typeof s.configError === "string" && s.configError ? str(s.configError, 64) : null,
    truncated: bool(s.truncated),
    counts: counts(s.counts),
    environments: list(s.environments, environment, MAX_ENVIRONMENTS),
    rows: list(s.rows, row, MAX_ROWS),
  };
}

function pending(p: any) {
  return {
    id: str(p.id, 120), kind: str(p.kind, 40), since: numOrNull(p.since), prompt: str(p.prompt, 8000), appName: str(p.appName, 120),
    options: strings(p.options, 200, 16),
    questions: list(p.questions, (q: any) => ({ header: str(q.header, 200), question: str(q.question, 2000), options: strings(q.options, 300, 16) }), 8),
  };
}

function run(r: any) {
  return { ordinal: num(r.ordinal), status: str(r.status, 32), startedAt: numOrNull(r.startedAt), completedAt: numOrNull(r.completedAt), durationMs: numOrNull(r.durationMs) };
}

function subagent(s: any) {
  return {
    id: str(s.id, 120), title: str(s.title, 300), status: str(s.status, 32), progress: str(s.progress, 200), model: str(s.model, 120),
    startedAt: numOrNull(s.startedAt), completedAt: numOrNull(s.completedAt), childThreadId: str(s.childThreadId, 120),
  };
}

export function projectDetail(d: any) {
  const o = d && typeof d === "object" ? d : {};
  const ctx = o.context && typeof o.context === "object"
    ? { used: num(o.context.used), max: num(o.context.max), cost: numOrNull(o.context.cost), currency: str(o.context.currency, 8) }
    : null;
  const todo = o.todo && typeof o.todo === "object"
    ? { total: num(o.todo.total), done: num(o.todo.done), current: str(o.todo.current, 500) }
    : null;
  return {
    activity: list(o.activity, activity, 40),
    pending: list(o.pending, pending, 8),
    runs: list(o.runs, run, 24),
    context: ctx,
    subagents: list(o.subagents, subagent, 24),
    todo,
  };
}

/** Parses an Omarchy colors.toml: `key = "#rrggbb"` lines only. */
export function parseThemeColors(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let n = 0;
  for (const line of text.split("\n").slice(0, 400)) {
    const m = /^\s*([a-z][a-z0-9_]{0,40})\s*=\s*"(#[0-9a-fA-F]{6})"\s*(#.*)?$/.exec(line);
    if (m) { out[m[1]] = m[2].toLowerCase(); n++; }
  }
  return n ? out : null;
}
