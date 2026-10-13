#!/usr/bin/env node
// T3 Pocket Loupe: a read-only view of T3 Loupe's collector, served on loopback for
// `tailscale serve` to publish on the tailnet. The one server file (NW-ARC-002).
//
//   node server.ts [--port 8443] [--demo] [--public-port 8443]
//
// It binds 127.0.0.1 and nothing else (NW-NET-001/-002). It serves public/ and a small
// JSON API whose every field is picked by lib/project.ts. No route changes T3 state.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Bridge, ID_PATTERN } from "./lib/bridge.ts";
import { crossSite, HostAllowlist, resolveStatic, securityHeaders, sendFile, sendJson, sendText } from "./lib/guards.ts";
import { parseThemeColors, projectDetail, projectState } from "./lib/project.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const BIND = "127.0.0.1";
const MAX_BODY = 64 * 1024;
const DETAIL_WAIT_MS = 3000;

export interface Options {
  port: number;
  publicPort: number;
  demo: boolean;
  hosts: string[];
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

function port(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`invalid port: ${value}`);
  return n;
}

/** Throws on a non-loopback --host or HOST: the bind address is fixed. */
export function parseOptions(argv: string[], env: NodeJS.ProcessEnv): Options {
  const host = flag(argv, "host") ?? env.HOST;
  if (host !== undefined && host !== "" && host !== BIND && host !== "localhost") {
    throw new Error(`refusing to bind ${host}: Pocket Loupe binds ${BIND} only`);
  }
  const p = port(flag(argv, "port") ?? env.PORT, 8443);
  return {
    port: p,
    publicPort: port(flag(argv, "public-port") ?? env.POCKET_LOUPE_PUBLIC_PORT, p || 8443),
    demo: argv.includes("--demo") || env.POCKET_LOUPE_DEMO === "1",
    hosts: (env.POCKET_LOUPE_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean),
  };
}

function themeFile(): string {
  return process.env.POCKET_LOUPE_THEME_FILE || join(homedir(), ".local/state/omarchy/current/theme/colors.toml");
}

export function createApp(bridge: Bridge, hosts: HostAllowlist) {
  async function threadDetail(res: ServerResponse, rawEnv: string, rawThread: string) {
    let envId: string, threadId: string;
    try {
      envId = decodeURIComponent(rawEnv);
      threadId = decodeURIComponent(rawThread);
    } catch {
      return sendJson(res, 404, { error: "not_found" });
    }
    if (!ID_PATTERN.test(envId) || !ID_PATTERN.test(threadId) || !bridge.environmentIds().includes(envId)) {
      return sendJson(res, 404, { error: "not_found" });
    }
    const cached = bridge.cachedDetail(envId, threadId);
    if (cached) {
      bridge.requestDetail(envId, threadId); // keeps the collector's watch pinned and the cache fresh
      return sendJson(res, 200, { v: 1, envId, threadId, at: cached.receivedAt, cached: true, detail: projectDetail(cached.detail) });
    }
    const waiting = bridge.waitForDetail(envId, threadId, DETAIL_WAIT_MS);
    if (!bridge.requestDetail(envId, threadId)) return sendJson(res, 503, { error: "collector_unavailable" });
    const got = await waiting;
    if (got === "busy") return sendJson(res, 503, { error: "busy" });
    if (!got) return sendJson(res, 504, { error: "detail_timeout" });
    return sendJson(res, 200, { v: 1, envId, threadId, at: got.receivedAt, cached: false, detail: projectDetail(got.detail) });
  }

  async function theme(res: ServerResponse) {
    let colors: Record<string, string> | null = null;
    try {
      const text = await readFile(themeFile(), "utf8");
      if (text.length < 256 * 1024) colors = parseThemeColors(text);
    } catch {}
    return sendJson(res, 200, { colors }, "no-cache");
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const raw = req.url ?? "/";
    const q = raw.indexOf("?");
    const path = q === -1 ? raw : raw.slice(0, q);
    const api = path === "/ping" || path === "/healthz" || path.startsWith("/api/");
    securityHeaders(res, { api });

    if (!(await hosts.allows(req.headers.host))) return sendText(res, 421, "Misdirected request\n", { Connection: "close" });

    const method = req.method ?? "GET";
    if (method === "OPTIONS") return sendText(res, 405, "Method not allowed\n", { Allow: "GET, HEAD" });
    if (method !== "GET" && method !== "HEAD") {
      // Nothing here accepts a write, but the guards run first so they hold if one is ever added.
      if (crossSite(req)) return sendText(res, 403, "Forbidden\n", { Connection: "close" });
      // The body is never read: the reply closes the connection.
      const length = Number(req.headers["content-length"] ?? 0);
      if (!Number.isFinite(length) || length > MAX_BODY) {
        return sendText(res, 413, "Payload too large\n", { Connection: "close" });
      }
      return sendText(res, 405, "Method not allowed\n", { Allow: "GET, HEAD", Connection: "close" });
    }

    if (path === "/ping") return sendText(res, 200, "");
    if (path === "/healthz") {
      return sendJson(res, 200, { ok: bridge.status === "running", collector: bridge.status, lastStateAt: bridge.receivedAt });
    }
    if (path === "/api/state") return sendJson(res, 200, projectState(bridge), "no-cache");
    if (path === "/api/theme") return theme(res);
    const thread = /^\/api\/thread\/([^/]+)\/([^/]+)$/.exec(path);
    if (thread) return threadDetail(res, thread[1], thread[2]);
    if (api) return sendJson(res, 404, { error: "not_found" });

    const file = resolveStatic(PUBLIC, path);
    if (!file) return sendText(res, 404, "Not found\n");
    return sendFile(req, res, file);
  };
}

async function main() {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`pocket-loupe: ${(error as Error).message}\n`);
    process.exit(2);
  }

  const bridge = new Bridge({ mode: options.demo ? "demo" : "run" });
  const hosts = new HostAllowlist([options.port, options.publicPort], options.hosts);
  await hosts.refresh();
  const handle = createApp(bridge, hosts);

  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000, maxHeaderSize: 16 * 1024 }, (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendText(res, 500, "Internal error\n");
      else res.destroy();
    });
  });
  server.maxConnections = 128;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    else socket.destroy();
  });

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    setTimeout(() => process.exit(0), 2500).unref();
    server.close();
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 1000).unref();
    await bridge.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.listen(options.port, BIND, () => {
    const address = server.address();
    const actual = typeof address === "object" && address ? address.port : options.port;
    if (options.port === 0) hosts.setPorts([actual, options.publicPort || actual]);
    process.stdout.write(`pocket-loupe listening on http://${BIND}:${actual} (collector: ${options.demo ? "demo" : "run"})\n`);
    bridge.start();
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    process.stderr.write(`pocket-loupe: cannot listen (${error.code ?? "error"})\n`);
    process.exit(1);
  });
}

function isMain(): boolean {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (isMain()) void main();
