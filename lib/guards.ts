// Request guards and safe static serving, written from the NixWeb Standard's rule text.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { readTailnet, type Tailnet } from "./tailnet.ts";

// ---------------------------------------------------------------- headers (NW-SEC-001/-002, NW-SRV-007)

export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "connect-src 'self'",
  "manifest-src 'self'", "worker-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

const PERMISSIONS = [
  "accelerometer=()", "camera=()", "display-capture=()", "geolocation=()", "gyroscope=()", "magnetometer=()",
  "microphone=()", "midi=()", "payment=()", "publickey-credentials-get=()", "usb=()", "serial=()", "hid=()",
].join(", ");

/** Sent on every response, errors included. Node's http module adds no Server or X-Powered-By header. */
export function securityHeaders(res: ServerResponse, opts: { api?: boolean } = {}) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", PERMISSIONS);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  // CORP only on API responses: NixWeb leaves it off static files because it could stop
  // iOS fetching the Home Screen icon (unverified on a device).
  if (opts.api) res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

/** A fixed, generic body: no paths, versions or stack traces. */
export function sendText(res: ServerResponse, status: number, body: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body), ...extra });
  res.end(res.req?.method === "HEAD" ? undefined : body);
}

export function sendJson(res: ServerResponse, status: number, body: unknown, cache = "no-store") {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache, "Content-Length": Buffer.byteLength(text) });
  res.end(res.req?.method === "HEAD" ? undefined : text);
}

// ---------------------------------------------------------------- Host allowlist (NW-SEC-003)

const REFRESH_MS = 5 * 60_000;

export class HostAllowlist {
  private tailnet: Tailnet = { name: null, ips: [] };
  private lastRead = 0;
  private reading: Promise<void> | null = null;
  private ports: Set<string>;
  private readonly read: () => Promise<Tailnet>;
  readonly extra: string[];

  /** `ports`: the ports a Host header may name (the loopback port and the tailnet HTTPS port). */
  constructor(ports: number[], extra: string[] = [], read: () => Promise<Tailnet> = () => readTailnet()) {
    this.ports = new Set();
    this.setPorts(ports);
    this.extra = extra.map((h) => h.trim().toLowerCase()).filter(Boolean);
    this.read = read;
  }

  setPorts(ports: number[]) { this.ports = new Set(ports.filter((p) => p > 0).map(String)); }

  async refresh() {
    if (this.reading) return this.reading;
    this.lastRead = Date.now();
    this.reading = this.read().then((t) => { this.tailnet = t; }).finally(() => { this.reading = null; });
    return this.reading;
  }

  get name(): string | null { return this.tailnet.name; }

  /** Splits a Host header into a lower-case host and an optional port; null when malformed. */
  static split(host: string): { host: string; port: string } | null {
    const h = host.trim().toLowerCase();
    let m = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/.exec(h);
    if (m) return { host: m[1], port: m[2] ?? "" };
    m = /^([a-z0-9.-]+?)\.?(?::(\d{1,5}))?$/.exec(h);
    return m ? { host: m[1], port: m[2] ?? "" } : null;
  }

  matches(header: string | undefined): boolean {
    if (!header) return false;
    const parts = HostAllowlist.split(header);
    if (!parts) return false;
    if (parts.port && !this.ports.has(parts.port)) return false;
    const own = ["127.0.0.1", "localhost", "::1", ...this.extra, ...this.tailnet.ips];
    if (this.tailnet.name) own.push(this.tailnet.name);
    return own.includes(parts.host);
  }

  /** Checks the Host header; on a miss, re-reads the tailnet identity at most once every 5 minutes. */
  async allows(header: string | undefined): Promise<boolean> {
    if (this.matches(header)) return true;
    if (Date.now() - this.lastRead < REFRESH_MS) return false;
    await this.refresh();
    return this.matches(header);
  }
}

// ---------------------------------------------------------------- cross-site writes (NW-SEC-004)

/** True when a state-changing request comes from another site. GET and HEAD never change state. */
export function crossSite(req: IncomingMessage): boolean {
  const site = String(req.headers["sec-fetch-site"] ?? "").toLowerCase();
  if (site === "cross-site" || site === "same-site") return true;
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  if (origin === "null") return true;
  try {
    return new URL(origin).host.toLowerCase() !== String(req.headers.host ?? "").toLowerCase();
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- static files (NW-SRV-001/-003/-004/-005/-006/-008/-009)

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const TEXT = new Set([".html", ".css", ".js", ".mjs", ".webmanifest", ".json", ".svg"]);

/**
 * Maps a raw request path to a file inside `root`, or null. Decodes once, then refuses
 * backslashes, NUL, any `..` and any segment starting with a dot, requires an allowlisted
 * extension, and resolves symlinks so the real path must stay inside the real root.
 */
export function resolveStatic(root: string, rawPath: string): string | null {
  if (!rawPath.startsWith("/") || /%5c|\\|%00/i.test(rawPath)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); } catch { return null; }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const segments = decoded.slice(1).split("/");
  if (segments.some((seg) => seg.startsWith("."))) return null;
  if (segments.slice(0, -1).some((seg) => seg === "")) return null;
  let rel = segments.join("/");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (!MIME[extname(rel).toLowerCase()]) return null;
  let realRoot: string, real: string;
  try {
    realRoot = realpathSync(root);
    real = realpathSync(join(realRoot, rel));
  } catch {
    return null;
  }
  if (!real.startsWith(realRoot + sep)) return null;
  try {
    if (!statSync(real).isFile()) return null;
  } catch {
    return null;
  }
  return real;
}

interface FileEntry { mtimeMs: number; size: number; body: Buffer; gz: Buffer | null; etag: string }
const fileCache = new Map<string, FileEntry>();

function load(path: string): FileEntry {
  const st = statSync(path);
  const hit = fileCache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  const body = readFileSync(path);
  const ext = extname(path).toLowerCase();
  const gz = TEXT.has(ext) && body.length > 256 ? gzipSync(body) : null;
  const etag = '"' + createHash("sha256").update(body).digest("base64url").slice(0, 22) + '"';
  const entry = { mtimeMs: st.mtimeMs, size: st.size, body, gz, etag };
  if (fileCache.size > 256) fileCache.clear();
  fileCache.set(path, entry);
  return entry;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = etag.replace(/^W\//, "");
  return header.split(",").map((t) => t.trim().replace(/^W\//, "").replace(/-gzip"$/, '"')).some((t) => t === "*" || t === bare);
}

/** Serves one resolved file with conditional GET, gzip, single byte ranges and no-cache. */
export function sendFile(req: IncomingMessage, res: ServerResponse, path: string) {
  const file = load(path);
  const ext = extname(path).toLowerCase();
  const lastModified = new Date(Math.floor(file.mtimeMs / 1000) * 1000).toUTCString();
  res.setHeader("Content-Type", MIME[ext]);
  // Nothing in public/ has a content hash in its name, so everything revalidates (NW-SRV-006).
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Last-Modified", lastModified);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Vary", "Accept-Encoding");

  const inm = req.headers["if-none-match"];
  const ims = req.headers["if-modified-since"];
  const notModified = inm !== undefined
    ? etagMatches(inm, file.etag)
    : ims !== undefined && Date.parse(ims) >= Date.parse(lastModified);
  const range = req.headers.range;
  const gzipOk = !!file.gz && !range && /\bgzip\b/i.test(String(req.headers["accept-encoding"] ?? ""));
  const etag = gzipOk ? file.etag.replace(/"$/, '-gzip"') : file.etag;
  res.setHeader("ETag", etag);
  if (notModified) {
    res.writeHead(304);
    res.end();
    return;
  }

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && (m[1] !== "" || m[2] !== "")) {
      const size = file.body.length;
      let start: number, end: number;
      if (m[1] === "") {
        const n = Number(m[2]);
        start = Math.max(0, size - n);
        end = size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
      }
      if (start >= size || start > end || (m[1] === "" && Number(m[2]) === 0)) {
        res.writeHead(416, { "Content-Range": `bytes */${size}`, "Content-Type": "text/plain; charset=utf-8", "Content-Length": 0 });
        res.end();
        return;
      }
      const slice = file.body.subarray(start, end + 1);
      res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": slice.length });
      res.end(req.method === "HEAD" ? undefined : slice);
      return;
    }
    // A multi-range or malformed Range header is ignored: the whole file follows.
  }

  const body = gzipOk ? file.gz! : file.body;
  if (gzipOk) res.setHeader("Content-Encoding", "gzip");
  res.writeHead(200, { "Content-Length": body.length });
  res.end(req.method === "HEAD" ? undefined : body);
}
