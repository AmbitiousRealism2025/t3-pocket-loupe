// Static checks on the phone app in public/: it parses, its versions agree, everything it
// precaches exists, its icons are the sizes it claims, and VENDOR.md matches the vendor files.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";

const PUBLIC = join(ROOT, "public");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function pngSize(path) {
  const b = readFileSync(path);
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${path} is a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

test("every public script parses", () => {
  const files = ["app.js", "sw.js", ...readdirSync(join(PUBLIC, "vendor")).map((f) => `vendor/${f}`)];
  for (const f of files) execFileSync(process.execPath, ["--check", join(PUBLIC, f)]);
});

test("the vendored modules load and export what app.js uses", async () => {
  const Store = await import("../public/vendor/store.js");
  const Palette = await import("../public/vendor/palette.js");
  const Format = await import("../public/vendor/format.js");
  const Icons = await import("../public/vendor/icons.js");
  for (const fn of ["visibleRows", "stateIcon", "stateLabel", "stateRole", "pendingInfo", "currentActivity", "environmentLabel", "environmentOk", "isAlarm"]) assert.equal(typeof Store[fn], "function", fn);
  assert.equal(typeof Palette.derive, "function");
  for (const fn of ["elapsed", "duration", "ago", "until", "tokens", "money", "model"]) assert.equal(typeof Format[fn], "function", fn);
  assert.ok(Icons.get("terminal").length > 0);
  const app = read("public/app.js");
  for (const name of [...app.matchAll(/icon\('([a-z-]+)'/g)].map((m) => m[1])) {
    assert.ok(Icons.paths[name], `icon ${name} exists in the vendored set`);
  }
});

test("app.js and sw.js report the same VERSION", () => {
  const sw = /const VERSION = '([^']+)';/.exec(read("public/sw.js"))?.[1];
  const app = /const VERSION = '([^']+)';/.exec(read("public/app.js"))?.[1];
  const html = /id="version">([^<]+)</.exec(read("public/index.html"))?.[1];
  assert.ok(sw);
  assert.equal(app, sw);
  assert.equal(html, sw);
});

test("every precached URL exists, and there are at most 12", () => {
  const list = /const SHELL = \[([\s\S]*?)\];/.exec(read("public/sw.js"))[1];
  const urls = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(urls.length > 0 && urls.length <= 12, `${urls.length} precached files`);
  for (const u of urls) assert.ok(existsSync(join(PUBLIC, u)), u);
});

test("manifest and icons", () => {
  const m = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(m.id, "/");
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "./");
  assert.equal(m.scope, "./");
  assert.equal(m.theme_color, /name="theme-color" content="([^"]+)"/.exec(read("public/index.html"))[1]);
  for (const icon of m.icons) {
    const [w, h] = icon.sizes.split("x").map(Number);
    const size = pngSize(join(PUBLIC, icon.src));
    assert.deepEqual([size.w, size.h], [w, h], icon.src);
  }
  const apple = pngSize(join(PUBLIC, "icons/apple-touch-icon.png"));
  assert.deepEqual([apple.w, apple.h], [180, 180]);
  assert.ok(apple.colorType !== 4 && apple.colorType !== 6, "apple-touch-icon has no alpha channel");
});

test("VENDOR.md records each vendored file's SHA-256", () => {
  const vendor = read("VENDOR.md");
  for (const f of readdirSync(join(PUBLIC, "vendor"))) {
    const sum = createHash("sha256").update(readFileSync(join(PUBLIC, "vendor", f))).digest("hex");
    assert.ok(vendor.includes(`public/vendor/${f}`), `${f} is listed`);
    assert.ok(vendor.includes(sum), `${f}'s SHA-256 matches VENDOR.md`);
  }
});

test("index.html has no inline script, style or handlers", () => {
  const html = read("public/index.html");
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "no inline script");
  assert.ok(!/<style/i.test(html) && !/\sstyle=/i.test(html), "no inline style");
  assert.ok(!/\son[a-z]+=/i.test(html), "no inline handlers");
  assert.ok(!/black-translucent/.test(html), "status bar style is black (WebKit 301994)");
});
