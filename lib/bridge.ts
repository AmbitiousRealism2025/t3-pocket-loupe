// Spawns and supervises T3 Loupe's collector and keeps its latest output.
//
// The collector (`daemon/main.ts run`) holds the T3 tokens and writes NDJSON to stdout:
// `state` lines (every environment and ranked row), `detail` lines (one thread, in reply
// to a `detail` command on stdin) and `notice` lines (ignored for now). The bridge keeps
// the latest state and recent details. It never passes anything but fixed arguments to
// the child, and it keeps only an error *code* from stderr.
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROTOCOL = 1;
/** Environment and thread ids: T3 uses UUIDs; the demo uses short names. Never a dot first, so never `..`. */
export const ID_PATTERN = /^(?!\.)[A-Za-z0-9._:-]{1,120}$/;

export type BridgeStatus = "starting" | "running" | "restarting" | "missing" | "protocol_mismatch" | "failed";

export interface BridgeOptions {
  collector?: string;
  mode?: "run" | "demo";
  /** Node binary for the child; defaults to this process's own. */
  node?: string;
  backoffStartMs?: number;
  backoffMaxMs?: number;
  healthyAfterMs?: number;
  maxLineBytes?: number;
  detailTtlMs?: number;
  log?: (message: string) => void;
}

export interface CachedDetail { detail: unknown; receivedAt: number }

export function defaultCollector(): string {
  return process.env.POCKET_LOUPE_COLLECTOR
    || join(homedir(), ".config/omarchy/plugins/ambitiousrealism.t3-loupe/daemon/main.ts");
}

const MAX_DETAILS = 64;
const MAX_WAITS = 16;
const DETAIL_COALESCE_MS = 2000;
const MAX_STDIN_BACKLOG = 64 * 1024;
const MAX_STDERR_LINE = 64 * 1024;

export class Bridge extends EventEmitter {
  status: BridgeStatus = "starting";
  /** Last error code the collector reported on stderr, or a spawn failure code. */
  lastError: string | null = null;
  /** Latest `state` message, exactly as received (projected before it leaves the server). */
  state: Record<string, any> | null = null;
  receivedAt: number | null = null;

  readonly collector: string;
  readonly mode: "run" | "demo";
  private readonly opts: Required<Omit<BridgeOptions, "collector" | "mode" | "log">>;
  private readonly log: (message: string) => void;
  private details = new Map<string, CachedDetail>();
  private waits = new Map<string, { promise: Promise<CachedDetail | null>; resolve: (v: CachedDetail | null) => void; timer: ReturnType<typeof setTimeout> }>();
  private lastAsked = new Map<string, number>();
  private child: ChildProcess | null = null;
  private backoff: number;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private healthyTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private sawValidLine = false;

  constructor(options: BridgeOptions = {}) {
    super();
    this.setMaxListeners(64);
    this.collector = options.collector ?? defaultCollector();
    this.mode = options.mode ?? "run";
    this.opts = {
      node: options.node ?? process.execPath,
      backoffStartMs: options.backoffStartMs ?? 1000,
      backoffMaxMs: options.backoffMaxMs ?? 30_000,
      healthyAfterMs: options.healthyAfterMs ?? 60_000,
      maxLineBytes: options.maxLineBytes ?? 4 * 1024 * 1024,
      detailTtlMs: options.detailTtlMs ?? 5 * 60_000,
    };
    this.log = options.log ?? ((m) => process.stderr.write(`pocket-loupe: ${m}\n`));
    this.backoff = this.opts.backoffStartMs;
  }

  start() {
    this.stopped = false;
    this.spawnChild();
  }

  /** Ends the collector: stdin closed, SIGTERM, then SIGKILL after 2 s. */
  stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    for (const [key, wait] of this.waits) { clearTimeout(wait.timer); this.waits.delete(key); wait.resolve(null); }
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const kill = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 2000);
      child.once("close", () => { clearTimeout(kill); resolve(); });
      try { child.stdin?.end(); } catch {}
      try { child.kill("SIGTERM"); } catch {}
    });
  }

  get pid(): number | null { return this.child?.pid ?? null; }

  environmentIds(): string[] {
    const envs = this.state?.environments;
    return Array.isArray(envs) ? envs.map((e: any) => e?.id).filter((id: unknown) => typeof id === "string") : [];
  }

  cachedDetail(envId: string, threadId: string): CachedDetail | null {
    const key = `${envId}/${threadId}`;
    const hit = this.details.get(key);
    if (!hit) return null;
    if (Date.now() - hit.receivedAt > this.opts.detailTtlMs) {
      this.details.delete(key);
      return null;
    }
    return hit;
  }

  /**
   * Asks the collector for one thread's detail. The collector pins a watch on the thread
   * for 60 s and sends a `detail` line now and whenever it changes. Returns false when the
   * ids are invalid, the environment is unknown, the collector isn't running or its stdin
   * is backed up. Repeats for the same thread within 2 s are coalesced into one command.
   */
  requestDetail(envId: string, threadId: string): boolean {
    if (!ID_PATTERN.test(envId) || !ID_PATTERN.test(threadId)) return false;
    if (!this.environmentIds().includes(envId)) return false;
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable || stdin.writableLength > MAX_STDIN_BACKLOG) return false;
    const key = `${envId}/${threadId}`;
    const now = Date.now();
    if (now - (this.lastAsked.get(key) ?? 0) < DETAIL_COALESCE_MS) return true;
    this.lastAsked.delete(key);
    this.lastAsked.set(key, now);
    while (this.lastAsked.size > MAX_DETAILS) this.lastAsked.delete(this.lastAsked.keys().next().value!);
    stdin.write(JSON.stringify({ cmd: "detail", envId, threadId }) + "\n");
    return true;
  }

  /**
   * Resolves with the next detail for this thread, or null after `timeoutMs`. Concurrent
   * waits for one thread share a single timer; at most MAX_WAITS threads are awaited at
   * once, and a wait beyond that resolves "busy" at once.
   */
  waitForDetail(envId: string, threadId: string, timeoutMs: number): Promise<CachedDetail | null | "busy"> {
    const key = `${envId}/${threadId}`;
    const existing = this.waits.get(key);
    if (existing) return existing.promise;
    if (this.waits.size >= MAX_WAITS) return Promise.resolve("busy");
    let resolve!: (v: CachedDetail | null) => void;
    const promise = new Promise<CachedDetail | null>((r) => { resolve = r; });
    const timer = setTimeout(() => { this.waits.delete(key); resolve(null); }, timeoutMs);
    this.waits.set(key, { promise, resolve, timer });
    return promise;
  }

  private setStatus(status: BridgeStatus) {
    if (this.status === status) return;
    this.status = status;
    this.log(`collector ${status}${this.lastError ? ` (${this.lastError})` : ""}`);
    this.emit("status", status);
  }

  private spawnChild() {
    if (this.stopped) return;
    this.sawValidLine = false;
    if (!existsSync(this.collector)) {
      this.setStatus("missing");
      this.scheduleRestart();
      return;
    }
    if (this.status !== "protocol_mismatch" && this.status !== "starting") this.setStatus("restarting");
    let child: ChildProcess;
    try {
      // Fixed arguments only: the collector path and the mode. Never anything private.
      child = spawn(this.opts.node, ["--disable-warning=ExperimentalWarning", this.collector, this.mode], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
    } catch {
      this.lastError = "spawn_failed";
      this.setStatus("failed");
      this.scheduleRestart();
      return;
    }
    this.child = child;
    // An async spawn failure (ENOENT, EACCES, EMFILE) emits `error` and `close` but never
    // `exit`, so supervision hangs off `close`, which follows every ending.
    child.on("error", () => {
      if (child.pid === undefined) this.lastError = "spawn_failed";
    });
    child.stdin?.on("error", () => {});
    this.readLines(child.stdout!, this.opts.maxLineBytes, (line) => this.onLine(child, line), (bytes) => {
      this.log(`dropped an oversized collector line (${bytes} bytes)`);
    });
    this.readLines(child.stderr!, MAX_STDERR_LINE, (line) => this.onStderr(line), () => {});
    child.on("close", () => {
      if (this.child !== child) return;
      this.child = null;
      if (this.healthyTimer) clearTimeout(this.healthyTimer);
      if (this.stopped) return;
      if (this.status !== "protocol_mismatch") this.setStatus(this.sawValidLine ? "restarting" : "failed");
      this.scheduleRestart();
    });
  }

  private scheduleRestart() {
    if (this.stopped) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.opts.backoffMaxMs);
    this.emit("restart-scheduled", delay);
    this.restartTimer = setTimeout(() => this.spawnChild(), delay);
  }

  /** Splits a stream into lines, dropping (not truncating) any line over `max` bytes. */
  private readLines(stream: NodeJS.ReadableStream, max: number, onLine: (line: string) => void, onDrop: (bytes: number) => void) {
    let parts: Buffer[] = [];
    let size = 0;
    let dropping = 0;
    stream.on("data", (chunk: Buffer) => {
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf(10, start);
        const piece = chunk.subarray(start, nl === -1 ? chunk.length : nl);
        if (dropping) {
          dropping += piece.length;
        } else if (size + piece.length > max) {
          dropping = size + piece.length;
          parts = [];
          size = 0;
        } else if (piece.length) {
          parts.push(Buffer.from(piece));
          size += piece.length;
        }
        if (nl === -1) break;
        if (dropping) {
          onDrop(dropping);
          dropping = 0;
        } else {
          const line = Buffer.concat(parts, size).toString("utf8");
          parts = [];
          size = 0;
          if (line.trim()) onLine(line);
        }
        start = nl + 1;
      }
    });
    stream.on("error", () => {});
  }

  private onLine(child: ChildProcess, line: string) {
    // Lines from a child that has been replaced or told to stop don't count.
    if (child !== this.child || child.killed) return;
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.v !== PROTOCOL) {
      this.lastError = "protocol_mismatch";
      this.setStatus("protocol_mismatch");
      try { child.kill("SIGTERM"); } catch {}
      return;
    }
    if (!this.sawValidLine) {
      this.sawValidLine = true;
      if (this.healthyTimer) clearTimeout(this.healthyTimer);
      this.healthyTimer = setTimeout(() => { this.backoff = this.opts.backoffStartMs; }, this.opts.healthyAfterMs);
    }
    if (this.status !== "running") {
      if (this.lastError === "protocol_mismatch") this.lastError = null;
      this.setStatus("running");
    }
    if (msg.type === "state") {
      this.state = msg;
      this.receivedAt = Date.now();
      this.emit("state");
    } else if (msg.type === "detail") {
      if (typeof msg.envId !== "string" || typeof msg.threadId !== "string") return;
      if (!ID_PATTERN.test(msg.envId) || !ID_PATTERN.test(msg.threadId)) return;
      const key = `${msg.envId}/${msg.threadId}`;
      this.details.delete(key);
      this.details.set(key, { detail: msg.detail, receivedAt: Date.now() });
      while (this.details.size > MAX_DETAILS) this.details.delete(this.details.keys().next().value!);
      const wait = this.waits.get(key);
      if (wait) {
        clearTimeout(wait.timer);
        this.waits.delete(key);
        wait.resolve(this.details.get(key)!);
      }
      this.emit("detail", key);
    }
    // `notice` lines are ignored for now; a later push feature would hook in here.
  }

  /** Keeps only the error code from `{"error": code, "detail": …}`; the detail text is dropped. */
  private onStderr(line: string) {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg && typeof msg.error === "string" && /^[a-z0-9_]{1,64}$/.test(msg.error)) {
      this.lastError = msg.error;
      this.emit("error-code", msg.error);
    }
  }
}
