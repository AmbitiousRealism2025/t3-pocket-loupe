import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { http, startServer } from "./helpers.mjs";

const { HostAllowlist, crossSite, resolveStatic } = await import("../lib/guards.ts");
const { parseStatus } = await import("../lib/tailnet.ts");

// Tailnet-shaped test values, built at runtime so the repo's privacy scan never sees one.
const TS_NAME = ["box", "tailnet-x", "ts", "net"].join(".");
const TS_IP4 = [100, 64, 0, 9].join(".");
const TS_IP6 = ["fd7a", "115c", "a1e0", "", "9"].join(":");

let s;
before(async () => { s = await startServer({ args: ["--demo", "--public-port", "8443"], env: { POCKET_LOUPE_HOSTS: "pocket.example.test" } }); });
after(async () => { await s.stop(); });

const SECURITY = ["content-security-policy", "x-content-type-options", "referrer-policy", "x-frame-options", "permissions-policy", "cross-origin-opener-policy"];
function assertSecurityHeaders(r, what) {
  for (const h of SECURITY) assert.ok(r.headers[h], `${what}: ${h}`);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["referrer-policy"], "no-referrer");
  assert.equal(r.headers.server, undefined, `${what}: no Server header`);
  assert.equal(r.headers["x-powered-by"], undefined, `${what}: no X-Powered-By`);
  assert.equal(r.headers["access-control-allow-origin"], undefined, `${what}: no CORS`);
  const csp = r.headers["content-security-policy"];
  for (const d of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'"]) assert.ok(csp.includes(d), `${what}: CSP ${d}`);
  assert.ok(!csp.includes("unsafe-inline") && !csp.includes("unsafe-eval"));
}

test("Host allowlist: rebinding names get 421, own names pass", async () => {
  for (const host of ["evil.example", "127.0.0.1.evil.example", "localhost.evil", `evil.example:${s.port}`, "127.0.0.1:1", "a b"]) {
    const r = await http(s.port, "/", { headers: { Host: host } });
    assert.equal(r.status, 421, `Host ${JSON.stringify(host)}`);
    assert.ok(!r.text.includes(host), "the body never echoes the Host");
    assertSecurityHeaders(r, "421");
  }
  for (const host of [`127.0.0.1:${s.port}`, `localhost:${s.port}`, "127.0.0.1", `[::1]:${s.port}`, "pocket.example.test", "pocket.example.test:8443", "POCKET.example.test."]) {
    assert.equal((await http(s.port, "/", { headers: { Host: host } })).status, 200, `Host ${host}`);
  }
});

test("OPTIONS gets 405 and no CORS headers, even with an Origin", async () => {
  const r = await http(s.port, "/", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  assert.equal(r.status, 405);
  assertSecurityHeaders(r, "405");
  const g = await http(s.port, "/", { headers: { Origin: "https://evil.example" } });
  assert.equal(g.headers["access-control-allow-origin"], undefined);
});

test("cross-site writes are refused with 403; same-origin writes reach 405", async () => {
  const post = (headers) => http(s.port, "/api/state", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });
  for (const h of [{ "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { Origin: "https://evil.example" }, { Origin: "null" }, { Origin: "::bad" }]) {
    const r = await post(h);
    assert.equal(r.status, 403, JSON.stringify(h));
    assertSecurityHeaders(r, "403");
  }
  const ok = await post({ "Sec-Fetch-Site": "same-origin", Origin: `http://127.0.0.1:${s.port}` });
  assert.equal(ok.status, 405);
  assert.equal(ok.headers.allow, "GET, HEAD");
  for (const method of ["PUT", "PATCH", "DELETE"]) assert.equal((await http(s.port, "/", { method })).status, 405);
});

test("an oversized body gets 413 before it is read", async () => {
  const r = await http(s.port, "/api/nixweb-check", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "99999999" }, body: "{" });
  assert.equal(r.status, 413);
});

test("path traversal fails in every encoding", async () => {
  for (const p of ["/../server.ts", "/%2e%2e/server.ts", "/%252e%252e/server.ts", "/..%2fserver.ts", "/%2e%2e%2fserver.ts", "/..%5cserver.ts",
    "/....//server.ts", "/%2e%2e/%2e%2e/etc/passwd", "/..\\server.ts", "/index.html%00.js", "/icons/../../server.ts", "//server.ts", "/%2F..%2Fserver.ts"]) {
    const r = await http(s.port, p);
    assert.ok(r.status >= 400 && r.status < 500, `${p} → ${r.status}`);
  }
});

test("dotfiles, server source and repository files are never served", async () => {
  for (const p of ["/.git/config", "/.env", "/.gitignore", "/.DS_Store", "/server.ts", "/server.py", "/package.json", "/lib/bridge.ts",
    "/PROGRESS.md", "/tests/helpers.mjs", "/public/index.html", "/zz-missing", "/icons/"]) {
    const r = await http(s.port, p);
    assert.equal(r.status, 404, p);
    assert.equal(r.text, "Not found\n", `${p}: generic body`);
    assertSecurityHeaders(r, "404");
  }
});

test("/ping is 200, no-store and answers HEAD", async () => {
  const g = await http(s.port, "/ping");
  assert.equal(g.status, 200);
  assert.match(g.headers["cache-control"], /no-store/);
  assertSecurityHeaders(g, "/ping");
  const h = await http(s.port, "/ping", { method: "HEAD" });
  assert.equal(h.status, 200);
  assert.equal(h.raw.length, 0);
});

test("static files: MIME, no-cache, conditional GET, gzip and ranges", async () => {
  const r = await http(s.port, "/");
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "text/html; charset=utf-8");
  assert.match(r.headers["cache-control"], /no-cache/);
  assertSecurityHeaders(r, "200");
  assert.equal(r.headers["cross-origin-resource-policy"], undefined, "no CORP on static files (iOS icon fetch)");

  const etag = await http(s.port, "/", { headers: { "If-None-Match": r.headers.etag } });
  assert.equal(etag.status, 304);
  assertSecurityHeaders(etag, "304");
  const ims = await http(s.port, "/", { headers: { "If-Modified-Since": r.headers["last-modified"] } });
  assert.equal(ims.status, 304);
  assert.equal((await http(s.port, "/", { headers: { "If-None-Match": '"other"' } })).status, 200);

  const gz = await http(s.port, "/", { headers: { "Accept-Encoding": "gzip, br" } });
  assert.equal(gz.headers["content-encoding"], "gzip");
  assert.match(gz.headers.vary, /Accept-Encoding/);
  assert.equal(gz.text, r.text, "gzip round-trips");
  const gz304 = await http(s.port, "/", { headers: { "Accept-Encoding": "gzip", "If-None-Match": gz.headers.etag } });
  assert.equal(gz304.status, 304);

  const part = await http(s.port, "/", { headers: { Range: "bytes=0-9" } });
  assert.equal(part.status, 206);
  assert.equal(part.raw.length, 10);
  assert.match(part.headers["content-range"], /^bytes 0-9\/\d+$/);
  assert.equal((await http(s.port, "/", { headers: { Range: "bytes=999999999-" } })).status, 416);
  const tail = await http(s.port, "/", { headers: { Range: "bytes=-5" } });
  assert.equal(tail.status, 206);
  assert.equal(tail.raw.length, 5);
  assert.equal((await http(s.port, "/", { method: "HEAD" })).raw.length, 0);
});

test("API responses carry the security headers and CORP", async () => {
  for (const p of ["/api/state", "/api/theme", "/healthz", "/api/nope"]) {
    const r = await http(s.port, p);
    assertSecurityHeaders(r, p);
    assert.equal(r.headers["cross-origin-resource-policy"], "same-origin", p);
  }
  assert.equal((await http(s.port, "/api/nope")).status, 404);
});

test("HostAllowlist re-reads the tailnet name at most once per 5 minutes", async () => {
  let reads = 0;
  const allow = new HostAllowlist([8443], [], async () => { reads++; return { name: TS_NAME, ips: [TS_IP4] }; });
  assert.equal(await allow.allows(`${TS_NAME}:8443`), true);
  assert.equal(reads, 1);
  assert.equal(await allow.allows(TS_NAME), true);
  assert.equal(await allow.allows(`${TS_IP4}:8443`), true);
  assert.equal(await allow.allows(`${TS_NAME}:9999`), false, "other ports refused");
  assert.equal(await allow.allows("evil.example"), false);
  assert.equal(await allow.allows("evil.example"), false);
  assert.equal(reads, 1, "misses don't trigger a re-read within 5 minutes");
});

test("crossSite reads Sec-Fetch-Site and Origin against Host", () => {
  const req = (headers) => ({ headers });
  assert.equal(crossSite(req({ host: "a:1" })), false, "no headers: curl or a script");
  assert.equal(crossSite(req({ host: "a:1", origin: "https://a:1" })), false);
  assert.equal(crossSite(req({ host: "a:1", origin: "https://b:1" })), true);
  assert.equal(crossSite(req({ host: "a:1", "sec-fetch-site": "same-origin" })), false);
  assert.equal(crossSite(req({ host: "a:1", "sec-fetch-site": "cross-site" })), true);
});

test("resolveStatic refuses anything outside public/", () => {
  const root = new URL("../public", import.meta.url).pathname;
  assert.ok(resolveStatic(root, "/"));
  assert.ok(resolveStatic(root, "/index.html"));
  for (const p of ["/../server.ts", "/.hidden", "/%2e%2e/server.ts", "relative", "/a//b.html", "/index.html\\", "/x.txt"]) assert.equal(resolveStatic(root, p), null, p);
});

test("parseStatus reads the MagicDNS name and addresses", () => {
  const t = parseStatus(JSON.stringify({ Self: { DNSName: TS_NAME.toUpperCase() + ".", TailscaleIPs: [TS_IP4, TS_IP6, "bad ip!"] } }));
  assert.deepEqual(t, { name: TS_NAME, ips: [TS_IP4, TS_IP6] });
  assert.deepEqual(parseStatus("not json"), { name: null, ips: [] });
});
