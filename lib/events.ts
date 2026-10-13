// GET /api/events: server-sent events carrying the projected state.
//
// - `event: state` with the same body as /api/state, on connect and whenever the collector
//   sends a state or the bridge status changes, at most once per second;
// - a `: ping` comment every 25 s, so proxies and the phone see a live connection;
// - at most 8 streams; the 9th gets 503. Each stream ends after 10 minutes and the app
//   reconnects, so a stream that the phone abandoned can't live forever;
// - backpressure: while a stream's socket isn't draining, frames are skipped (so at most one
//   frame is ever buffered) and it gets the latest state when it drains; a stream that stays
//   stalled for 60 s is closed (a frozen or vanished phone).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Bridge } from "./bridge.ts";
import { sendJson } from "./guards.ts";
import { projectState } from "./project.ts";

export interface EventHubOptions {
  maxStreams?: number;
  minIntervalMs?: number;
  pingMs?: number;
  maxAgeMs?: number;
  stallMs?: number;
}

interface Stream { res: ServerResponse; ping: ReturnType<typeof setInterval>; expire: ReturnType<typeof setTimeout>; behindSince: number }

export class EventHub {
  private readonly streams = new Set<Stream>();
  private readonly bridge: Bridge;
  private readonly maxStreams: number;
  private readonly minIntervalMs: number;
  private readonly pingMs: number;
  private readonly maxAgeMs: number;
  private readonly stallMs: number;
  private lastSent = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(bridge: Bridge, options: EventHubOptions = {}) {
    this.bridge = bridge;
    this.maxStreams = options.maxStreams ?? 8;
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.pingMs = options.pingMs ?? 25_000;
    this.maxAgeMs = options.maxAgeMs ?? 10 * 60_000;
    this.stallMs = options.stallMs ?? 60_000;
    const changed = () => this.schedule();
    bridge.on("state", changed);
    bridge.on("status", changed);
  }

  get size(): number { return this.streams.size; }

  /** Bytes queued but not yet sent, across all streams. */
  get buffered(): number {
    let n = 0;
    for (const s of this.streams) n += s.res.writableLength;
    return n;
  }

  open(req: IncomingMessage, res: ServerResponse) {
    if (this.streams.size >= this.maxStreams) return sendJson(res, 503, { error: "too_many_streams" });
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    if (req.method === "HEAD") { res.end(); return; }
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);
    const stream: Stream = {
      res,
      ping: setInterval(() => this.send(stream, ": ping\n\n"), this.pingMs),
      expire: setTimeout(() => this.close(stream), this.maxAgeMs),
      behindSince: 0,
    };
    this.streams.add(stream);
    const gone = () => this.drop(stream);
    req.on("close", gone);
    res.on("close", gone);
    res.on("error", gone);
    res.on("drain", () => {
      if (!stream.behindSince || !this.streams.has(stream)) return;
      stream.behindSince = 0;
      this.send(stream, this.frame());
    });
    this.send(stream, "retry: 5000\n\n" + this.frame());
  }

  /** Writes unless the socket is backed up: then the frame is skipped (the next drain sends the latest). */
  private send(stream: Stream, data: string) {
    const res = stream.res;
    if (res.writableNeedDrain) {
      const now = Date.now();
      if (!stream.behindSince) stream.behindSince = now;
      else if (now - stream.behindSince > this.stallMs) {
        this.drop(stream);
        res.destroy();
      }
      return;
    }
    res.write(data);
  }

  /** Ends every stream (shutdown). */
  closeAll() {
    if (this.pending) clearTimeout(this.pending);
    for (const s of [...this.streams]) this.close(s);
  }

  private frame(): string {
    return `event: state\ndata: ${JSON.stringify(projectState(this.bridge))}\n\n`;
  }

  /** Sends at most once per `minIntervalMs`; a change inside the window is sent when it ends. */
  private schedule() {
    if (this.pending || !this.streams.size) return;
    const wait = Math.max(0, this.lastSent + this.minIntervalMs - Date.now());
    this.pending = setTimeout(() => {
      this.pending = null;
      this.broadcast();
    }, wait);
  }

  private broadcast() {
    if (!this.streams.size) return;
    this.lastSent = Date.now();
    const frame = this.frame();
    for (const stream of [...this.streams]) this.send(stream, frame);
  }

  private close(stream: Stream) {
    this.drop(stream);
    stream.res.end();
  }

  private drop(stream: Stream) {
    if (!this.streams.delete(stream)) return;
    clearInterval(stream.ping);
    clearTimeout(stream.expire);
  }
}
