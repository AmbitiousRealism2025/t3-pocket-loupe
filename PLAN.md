# T3 Pocket Loupe: implementation plan

**Written 13 October 2026 for an unattended `/goal` run.** It takes the project from an empty folder to a server running on this machine, published on the tailnet, with a phone app ready for a person to install and test.

Read [REHYDRATE.md](REHYDRATE.md) first for background (T3 Loupe, its collector protocol and its security rules), then [docs/PROPOSAL.md](docs/PROPOSAL.md) for the "why" and [docs/NIXWEB.md](docs/NIXWEB.md) for the standard. This plan is the "how". Where they disagree, this plan wins.

**Keep [PROGRESS.md](PROGRESS.md) current.** It's the only record that survives compaction. Update it after every step: what's done, the evidence (command and summary line), what's next, and anything blocked.

---

## 0. Decisions and authorizations

**Decisions**, settled with the user and recorded in PROPOSAL.md:
- **Server:** Node, `server.ts`. No dependencies and no `tsconfig.json`; Node 22.18+ strips the types.
- **nixweb.app:** used as the standard and the checker only. All code is our own. Nothing is copied from `~/coding-projects/nixweb.app/template/`, and `nixweb new` is never run.
- **Tailnet:** personal. Full thread titles and command text are shown; no generic-label mode.
- **Origin:** this machine's tailnet name, port **8443** on loopback and on the tailnet.
- **Repository:** `AmbitiousRealism2025/t3-pocket-loupe`, **public**, MIT.

**What the run may do without asking**, as the user authorized:
1. `git init`, commit, create the GitHub repo with `gh`, and push to it. Push only at milestone boundaries, after tests pass and the privacy scan (§6.4) is clean.
2. Install and enable a systemd **user** unit for the server.
3. Map tailnet HTTPS port 8443 with `tailscale serve --bg --https=8443 http://127.0.0.1:8443`.
4. Get second opinions from GLM-5.3 through Pi, using `delegate_task` (§7).

## 1. Hard rules for the run

Breaking one of these is worse than leaving a milestone unfinished.

1. **Never modify** `~/coding-projects/t3-loupe`, the installed plugin `~/.config/omarchy/plugins/ambitiousrealism.t3-loupe`, `~/.config/t3-loupe/`, or anything about the Omarchy marketplace (no issues, PRs or comments). Reading and running the collector is fine.
2. **Never touch other Tailscale state:** no `tailscale funnel`, no changes to the 443 → `127.0.0.1:3773` mapping (T3's), and no other ports.
3. **Bind `127.0.0.1` only.** Never `0.0.0.0`, `::` or the tailnet IP.
4. **Public repo hygiene:** demo data only in commits, docs and screenshots. That means no real thread titles, project names, environment ids, tokens, home paths (`/home/<user>`), the machine's tailnet name (`*.ts.net`) or its 100.x address. Real host names stay in the environment, never in files.
5. **No private text in process arguments** (`/proc/<pid>/cmdline` is world-readable). The collector is spawned with fixed arguments only.
6. **The phone never receives secrets.** API responses are built from an explicit field allowlist and never spread a collector object.
7. **No force pushes and no history rewrites.** Don't delete anything outside the repo.
8. **Read-only app.** No route changes T3 state. The collector's `copy`, `reload` and `refresh` commands aren't exposed.
9. **Attempt cap:** if the same check fails three times for the same reason, record it under "Blocked" in PROGRESS.md and move on. Don't loop.
10. **Stop at what needs a person:** installing on the iPhone, the device checklist, VoiceOver, and `device-test.md` (nixweb says only a person fills it in). Prepare them in HANDOFF.md.

## 2. Repository layout

```
t3-pocket-loupe/
  server.ts              # the one server file (NW-ARC-002): HTTP, guards, routes
  lib/                   # server-side modules imported by server.ts (not served)
    bridge.ts            #   spawns and supervises the collector, parses NDJSON
    project.ts           #   allowlist projection: collector objects → API JSON
    guards.ts            #   Host allowlist, cross-site, headers, static file safety
    tailnet.ts           #   reads this machine's tailnet name/IPs from `tailscale status --json`
  public/                # the only served folder
    index.html  app.css  app.js  sw.js  manifest.webmanifest  icons/
    vendor/              # code vendored from T3 Loupe (see VENDOR.md)
  tests/                 # node --test
    fixtures/            #   fake collectors, planted files
  tools/
    dev.sh               # run the server in demo mode on a free port
    nixweb-check.sh      # start server → nixweb check --target → stop
    screenshots.sh       # headless Chrome at iPhone size, demo data only
    privacy-scan.sh      # pre-push scan (§6.4)
    install-service.sh   # systemd user unit + tailscale serve (§5)
    vendor-sync.sh       # copies the T3 Loupe files into public/vendor/
  docs/                  # PROPOSAL.md, NIXWEB.md, screens/
  package.json           # name, "type": "module", scripts, engines; NO dependencies
  AGENTS.md  CONFORMANCE.md  device-test.md  VENDOR.md  CHANGELOG.md
  README.md  HANDOFF.md  PROGRESS.md  LICENSE
```

- `REHYDRATE.md` stays at the root but is **excluded from git** through `.git/info/exclude`, along with `private/`. It names real machines and workflow details.
- `PROPOSAL.md` and `NIXWEB.md` move to `docs/`. Update the links in REHYDRATE.md and in this plan when they move.
- If the checker objects to `lib/` beside `server.ts`, inline the modules into `server.ts` rather than waiving NW-ARC-002.

## 3. Server

### 3.1 The collector bridge (`lib/bridge.ts`)

- **What it runs:** `process.execPath --disable-warning=ExperimentalWarning <collector> run`, or `demo` in demo mode.
  - `<collector>` defaults to `~/.config/omarchy/plugins/ambitiousrealism.t3-loupe/daemon/main.ts`. Override it with `POCKET_LOUPE_COLLECTOR`.
  - Demo mode is `--demo` or `POCKET_LOUPE_DEMO=1`. Use it for tests, screenshots and every public image.
  - Pass the environment through unchanged. `T3_LOUPE_CONFIG_DIR` is honoured by the collector, and tests use it.
- **Safe to run beside the plugin's own collector.** In `run` mode the collector only reads `connections.json` (it writes only in `pair`/`forget`), and each instance keeps its own read-only connections.
- **Reading its output:**
  - Read stdout line by line and cap each line at 4 MiB. The collector caps `state` at 2 MiB. Drop longer lines and log the fact without the content.
  - Parse JSON and require `v === 1`. Any other version puts the bridge in status `protocol_mismatch` and the app says so.
  - Keep the latest `state` and its arrival time.
  - Keep `detail` messages in a map keyed by `envId/threadId`, with a TTL.
  - Ignore `notice` for now; keep a hook for later push work.
- **stderr:** keep only the last error *code*. The collector prints `{"error": code, "detail": …}`; drop the detail text.
- **Supervision:**
  - Restart with backoff (1 s doubling to 30 s, reset after 60 s healthy).
  - Statuses: `starting | running | restarting | missing` (collector file not found) `| protocol_mismatch | failed`.
- **Detail requests:**
  - Write `{"cmd":"detail","envId","threadId"}` to the collector's stdin. The collector pins a watch on the thread for 60 s and replies with `detail` lines whenever it changes.
  - The app re-requests every 20 s while a detail screen is open, which keeps the watch pinned.
  - Validate ids against `^[A-Za-z0-9._:-]{1,120}$`. The `envId` must be in the latest state.
- **Shutdown:** on SIGTERM or SIGINT, end the collector's stdin, send it SIGTERM, then SIGKILL after 2 s. Close the HTTP server and exit 0 within 3 s (NW-SRV-010).

### 3.2 API contract (`lib/project.ts`)

All `/api/*` responses send `Cache-Control: no-store` and JSON. **Every field is picked by name.** Anything not listed here is dropped.

`GET /api/state` → `200`:

```jsonc
{
  "v": 1,
  "collector": { "status": "running", "error": null },   // bridge status, last error code
  "at": 1760000000000,          // collector's state time (null before the first state)
  "receivedAt": 1760000000000,  // when the server got it
  "known": true, "configError": null, "truncated": false,
  "counts": { "active": 0, "busy": 0, "attention": 0, "input": 0, "review": 0 },
  "environments": [{
    "id", "label", "state", "stale", "lastLiveAt", "sessionExpiresAt", "retryAt", "serverVersion",
    "counts",
    "providers": [{ "id", "name", "status", "auth", "windows": [{ "label", "kind", "usedPercent", "resetsAt", "durationMins" }] }]
  }],
  "rows": [{
    "key", "envId", "id", "parentId", "title", "project", "branch", "provider", "model", "mode", "plan",
    "state", "pendingKind", "pendingSince", "activeSince", "lastRunMs", "completedAt", "updatedAt",
    "unread", "pinned", "settled", "snoozedUntil", "background", "pr", "prCount",
    "errorClass", "error", "usageResetAt", "childCount", "activeChildren", "activity"
  }]
}
```

- **Dropped on purpose:**
  - environment `url` and `hostLabel` (ports, tunnel hosts);
  - row `worktree` (a local path), `projectId` and `rawStatus`;
  - provider `driver`, `version` and `checkedAt`.
- `pr` keeps `number, title, url, state, checks, draft, additions, deletions, review`. The URL is the public PR page.
- `error` strings are capped at 300 characters.
- **Before the first state arrives**, return `200` with `at: null` and the collector status, so the app can show "starting" or "collector not found".

`GET /api/thread/:envId/:threadId`:
- Send the detail command and wait up to **3 s** for a matching `detail`.
- `200` `{ v, envId, threadId, at, detail }`. `detail` is projected from the protocol's detail object: `activity`, `pending` (`id, kind, since, prompt, appName, options, questions`), `runs`, `context`, `subagents`, `todo`.
- `404` for an unknown environment or bad ids. `504` `{ "error": "detail_timeout" }` when nothing arrives.
- If a cached detail exists, return it immediately with `"cached": true` and refresh it in the background.

`GET /api/events`: server-sent events.
- `event: state` carries the same body as `/api/state`, sent when it changes, at most once per second.
- A `: ping` comment every 25 s.
- `Cache-Control: no-store` and `X-Accel-Buffering: no`.
- At most 8 concurrent streams; the 9th gets `503`. Each stream closes after 10 minutes, and the app reconnects.

`GET /api/theme`: the active Omarchy theme for the phone.
- Read `~/.local/state/omarchy/current/theme/colors.toml` (the path T3 Loupe's `Theme.qml` uses).
- Parse only `key = "#rrggbb"` lines into `{ colors: { key: "#hex" } }`.
- Missing or unparsable → `{ colors: null }`, and the app uses its built-in dark palette.

`GET|HEAD /ping`: `204`, `no-store`, and as cheap as possible (NW-SRV-002).

`GET /healthz`: `{ ok, collector: status, lastStateAt }`, `no-store`.

**Everything else:**
- static files from `public/` only, `GET`/`HEAD`;
- `OPTIONS` → `405` (NW-SEC-005);
- other methods → `405`, after the cross-site check (NW-SEC-004).

### 3.3 Guards (`lib/guards.ts`)

Implement from `STANDARD.md`'s rule text and tests. Read each rule's "test" before writing the code.

- **Host allowlist (NW-SEC-003):**
  - `127.0.0.1:<port>` and `localhost:<port>`;
  - this machine's MagicDNS name, from `tailscale status --json` → `Self.DNSName` without the trailing dot, with and without `:<port>`;
  - `POCKET_LOUPE_HOSTS` (comma-separated) for tests.
  - Anything else gets `421` and no body detail.
  - Read the tailnet name at startup. Re-read at most once every 5 minutes, when a request misses. Use `execFile`, and add nothing private to argv.
  - **Check at runtime what `Host` header `tailscale serve` actually forwards,** and record the finding in PROGRESS.md.
- **Cross-site writes (NW-SEC-004):** refuse non-GET/HEAD requests whose `Origin` or `Sec-Fetch-Site` is cross-site.
- **Headers on every response, errors included (NW-SEC-001/-002, NW-SRV-007):**
  - a strict CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  - `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`;
  - no `Server` or `X-Powered-By`;
  - error bodies are fixed strings.
  - Adjust to exactly what the checker tests.
- **Static files (NW-SRV-001/-003/-005/-006/-008/-009):**
  - Decode once, reject `..` after normalization, any segment starting with `.`, NUL and backslashes.
  - Resolve with `realpath` and require the result to stay inside `public/`. That also catches symlink escapes.
  - No directory listings; `/` → `index.html`.
  - `ETag` and `Last-Modified` with `If-None-Match`/`If-Modified-Since` → `304`.
  - gzip when accepted, for text types. Single byte `Range` → `206`; unsatisfiable → `416`.
  - Unhashed files get `Cache-Control: no-cache`.
- **Bounds (NW-SRV-011):** header and body size limits, request timeouts, and a cap on concurrent connections.
- **Binding (NW-NET-001/-002):**
  - The host is hard-coded to `127.0.0.1`. A `--host` or `HOST` that isn't loopback makes the server exit with an error. Tests prove it.
  - The port comes from `--port` or `PORT` (default 8443). Tests use port 0.

## 4. The phone app (`public/`)

**No framework and no build.** Use `app.js` as an ES module (`<script type="module" src>`). No inline scripts, styles or handlers. Use `textContent` and `createElement`/`createElementNS` only (NW-SEC-007/-008).

### 4.1 Reused from T3 Loupe (`public/vendor/`, recorded in `VENDOR.md`)

- `tools/vendor-sync.sh` copies `lib/Palette.js`, `lib/Format.js`, `lib/Icons.js` and, if useful, the grouping and ranking parts of `lib/Store.js`, from the **installed plugin at its verified commit**.
- These are QML `.pragma library` scripts. The sync script strips the pragma line and wraps each file as an ES module exporting the functions the app uses.
- `VENDOR.md` records the source repo, commit (`6fb1ec8`), license (MIT; Lucide icons are ISC) and the transformation.
- If wrapping is awkward, port the needed functions by hand, keep the attribution, and say so in `VENDOR.md`.
- **Check `lib/Store.js` before writing any grouping or ranking.** The phone should order rows exactly as the panel does.

### 4.2 Screens

**Main screen** (one `h1`, one `main`):
- **Header:** "Pocket Loupe", a one-line summary ("4 need you · 6 working · 2 machines") and machine chips. Each chip is the environment label with a health dot for the environment state; tapping it opens the machine sheet.
- **Needs you:** rows in state `input | plan | failed`. Each shows the title, `project · machine`, what it's waiting for (`pendingKind` → "command approval", "question", "plan ready", "failed: …"), and how long it has been waiting.
- **Working:** `working | waiting | queued | background`. Each shows the title, the latest `activity` entry with its icon, and elapsed time since `activeSince`. Subagent children fold under their parent, showing "+N agents".
- **Done:** `review` and unread rows, newest first, then a folded "Idle and stopped (N)" group (`idle | stopped | limited`, plus settled rows).
- **Footer:** "Updated 12 s ago" and the app version (NW-UIX-004).
- **The page never scrolls.** The list scrolls inside its own box (NW-SHL rules). Safe-area padding goes on all four sides.

**Machine sheet:** environment state in words (reuse the state labels from `lib/Store.js` or `Format.js`), the last live time, session expiry, and each provider's usage windows as bars with reset times.

**Thread detail** (an in-app Back control is required, NW-UIX-003):
- the title, `project · branch · machine`, provider and model, and state;
- **Pending:** the exact command text in monospace, or the question with its options, then "Answer this in T3". Link to T3's web UI on the same host at port 443 (`https://${location.hostname}/`) with `rel="noopener"`;
- recent activity, plan progress (`todo`), runs (a small bar chart from `runs`), context used/max and cost, the PR (number, checks, review; it links to its URL), and subagents with status.
- Refresh every 20 s while visible (this keeps the collector's watch pinned). Stop when hidden.

**Every view handles four states (NW-UIX-002):** loading (skeleton), empty ("Nothing running"), error ("Can't reach Pocket Loupe on the host", with a Retry button), and stale. The stale state is a banner, "Last updated 4 min ago · host unreachable", shown when `/ping` fails or `receivedAt` is older than 90 s. The collector statuses `missing`, `protocol_mismatch` and `failed` each get their own clear message.

### 4.3 Data flow and lifecycle

- **First paint:** fetch `/api/state` (timeout 5 s) and `/api/theme`. Then open `EventSource('/api/events')`.
- **Live updates:** each `state` event replaces the model, and the view re-renders without moving the scroll position.
- **Fallback:** if `EventSource` errors twice in 30 s, poll `/api/state` every 15 s. Probe `/ping` before showing the stale banner.
- **Every fetch has a timeout,** using `AbortController` plus `setTimeout`, not `AbortSignal.timeout` (NW-OFF).
- **Reachability comes only from `/ping`,** never `navigator.onLine`.
- **iOS freezes the app in the background.** On `visibilitychange` (hidden): close the EventSource and stop timers. On `visibilitychange` (visible) and `pageshow`: re-fetch, reopen the stream, and re-check for a service worker update (NW-IOS-003).
- **Announce** changes to the "needs you" count through an `aria-live="polite"` region (NW-ACC).

### 4.4 Service worker and updates (`sw.js`)

- `const VERSION = 'pl-0.1.0'`. **Bump it whenever any shell file changes.** `tools/check-version.sh` fails if `public/` changed since the last commit without a new `VERSION`; run it before every commit.
- **On install,** pre-cache the shell: `index.html`, `app.css`, `app.js`, the vendor files, the manifest and the icons. **Don't call `skipWaiting()` on install.**
- **Requests:**
  - navigations: network-first, falling back to the cached `index.html`;
  - shell assets: cache-first;
  - `/api/*`: network only, except the last good `/api/state`, which goes into a small bounded cache so the stale view can show something offline. It's skipped when the response has `no-store`; follow the standard's exact rule (NW-OFF-013);
  - `/ping` is never cached;
  - only same-origin `GET` with a good response is cached.
- **Registration:** register with `updateViaCache: 'none'`. When a new worker is waiting, show an "Update ready" button. Tapping it posts `SKIP_WAITING`, then reloads on `controllerchange`.

### 4.5 Manifest, icons, iOS

- **Manifest:** a stable `id`, `start_url` `./`, `scope` `./`, `display` `standalone`, and matching `theme_color`/`background_color` (the dark Loupe surface).
- **Icons:**
  - our own T3 Loupe ring, drawn as an SVG we author and rendered with ImageMagick to PNGs;
  - sizes 180 (opaque, `apple-touch-icon`), 192 and 512, plus a 512 maskable;
  - non-blank and opaque where iOS needs it.
- **Meta tags:**
  - viewport `width=device-width, initial-scale=1, viewport-fit=cover`, and never disable zoom;
  - `apple-mobile-web-app-capable` plus the current `mobile-web-app-capable`;
  - `apple-mobile-web-app-status-bar-style` **`black`**, never `black-translucent` (WebKit bug 301994);
  - `format-detection telephone=no`;
  - `color-scheme`.
- **CSS:**
  - `height: 100%` or `dvh`, never `100vh`;
  - `env(safe-area-inset-*)` added to the real padding;
  - targets at least 44 px;
  - relative font sizes so Larger Text works;
  - `prefers-reduced-motion` honoured;
  - `touch-action: manipulation` on controls only;
  - chrome `user-select: none`, content selectable.
  - **Every iOS-quirk rule has a `/* WHY: … */` comment (NW-DOC-001).**
- **Theme:** apply `/api/theme` colours through `Palette.js` into CSS custom properties, keeping the panel's colour budget (needs you, working, done-unseen). Check contrast in light themes too; Palette.js already enforces a floor.

## 5. Service and tailnet (`tools/install-service.sh`)

1. **Preflight; refuse unless all pass:**
   - Node ≥ 22.18 at a resolved absolute path. Prefer `mise which node`, else `command -v node`.
   - The collector exists.
   - Port 8443 is free locally, or already ours.
   - `tailscale serve status --json` shows 8443 unused, or already mapped to `http://127.0.0.1:8443`.
2. **Write `~/.config/systemd/user/t3-pocket-loupe.service`:**
   - `ExecStart=<node> --disable-warning=ExperimentalWarning <repo>/server.ts --port 8443`
   - `ExecStartPost=<tailscale> serve --bg --https=8443 http://127.0.0.1:8443`
   - `ExecStopPost=<tailscale> serve --https=8443 off`
   - `Restart=on-failure`, `RestartSec=5`, `WantedBy=default.target`
   - light hardening that doesn't break reading `~/.config`: `NoNewPrivileges=yes`, `PrivateTmp=yes`.
3. **Start it:** `systemctl --user daemon-reload && systemctl --user enable --now t3-pocket-loupe`.
4. **Verify:**
   - `curl -fsS http://127.0.0.1:8443/ping`;
   - `tailscale serve status` shows both 443 → 3773 (unchanged) and 8443 → 8443;
   - `curl -fsS https://<tailnet-name>:8443/ping` from this machine;
   - `tools/nixweb-check.sh --url`.
5. **`--uninstall`** disables the unit, which drops the mapping, and removes the unit file.

The user is already the Tailscale operator (`OperatorUser` is set), so `tailscale serve` needs no sudo. Never run anything with sudo.

## 6. Verification

### 6.1 Tests (`npm test` → `node --test tests/`)

- **Bridge:**
  - Spawn the real collector in demo mode from the installed plugin (`T3_LOUPE_DIR`, default the plugin path). `/api/state` has rows and environments; the detail round trip works.
  - Fake collectors in `tests/fixtures/` cover: `v: 2` → `protocol_mismatch`; a crash → restart with backoff; an oversized line dropped; stderr detail never surfaced; a missing collector → `missing`.
- **Run mode:** if practical, start T3 Loupe's fake T3 (`<plugin>/tests/lib/fake-t3.mjs`; read how `<plugin>/tests/daemon.test.mjs` sets it up) with a temporary `T3_LOUPE_CONFIG_DIR`, and show a live environment reaching `/api/state`. If it isn't practical, record why in PROGRESS.md; demo mode covers the shapes.
- **Projection:**
  - every response is a subset of the allowlist;
  - a deep scan of `/api/state`, `/api/thread` and `/api/events` output finds no `token`, `url` on environments, `worktree`, `/home/` or `127.0.0.1:` strings;
  - this works against a fixture collector that deliberately emits those fields.
- **Guards:**
  - Host rebinding → `421`; `OPTIONS` → `405`; cross-site POST refused;
  - traversal in raw, single and double encodings, plus backslash and NUL → `404`;
  - dotfiles, `server.ts`, `package.json` and `lib/` are never served;
  - headers present on `200`, `304`, `404`, `405` and `421`;
  - `/ping` is `no-store` and answers `HEAD`;
  - conditional GET, gzip and Range behave correctly.
- **The three checks the nixweb checker skips for Node** (record them in `CONFORMANCE.md`):
  - **NW-NET-002:** the listening socket is `127.0.0.1`, and a non-loopback `--host` exits non-zero;
  - **NW-SRV-005:** planted `public/.env`, `public/.git/config`, a symlink out of `public/`, and `../server.ts` all return `404`;
  - **NW-SRV-010:** SIGTERM exits 0 within 3 s and the collector child is gone.
- **SSE:** the first event arrives, change events are rate-limited, the stream cap holds, and streams close when the client disconnects.

### 6.2 nixweb check

- `tools/nixweb-check.sh` starts `server.ts --demo` on a free port, runs `~/coding-projects/nixweb.app/bin/nixweb check . --level 2 --target http://127.0.0.1:<port>`, and stops the server. Call nixweb by its full path; it isn't on the non-interactive `PATH`.
- With `--json`, its exit status is the result. Paste the summary line into PROGRESS.md and the commit message.
- A failing MUST is a bug. Waive only with `nixweb-allow: NW-XXX-000 <reason>` plus a `CONFORMANCE.md` entry, and only when the rule genuinely doesn't apply.
- Also run `--level 3 --manual` once at the end and copy the list of manual rules into HANDOFF.md.

### 6.3 Visual check

`tools/screenshots.sh` runs `google-chrome-stable --headless=new` at 390×844 with device scale 3, against demo mode, and saves:
- the main screen, a thread with a pending command, a question, the machine sheet, the stale banner and the empty state;
- each in the dark theme, plus one light theme.

Look at every screenshot (Read the PNG) and fix what's visibly wrong before calling a milestone done. Save the final set to `docs/screens/`. Demo data only. The T3 preview tools (`preview_open`, `preview_snapshot`) are an alternative for interactive checks.

### 6.4 Privacy scan (`tools/privacy-scan.sh`, before every push)

- Fail on tracked files matching `\.ts\.net`, `/home/`, `100\.\d+\.\d+\.\d+`, a UUID that isn't in the demo data, `token`-looking strings, and the real environment labels. Read those from the live `/api/state` at scan time and match them as whole words, skipping labels shorter than 4 characters to avoid false hits. Never write them down.
- Scan the staged diff and `docs/screens/*.png` (for PNGs, check that `tools/screenshots.sh` ran in demo mode, which the script records).

## 7. GLM second opinions

At the **end of each milestone, 1 to 4**, after tests pass and before pushing:

- `mcp__t3-code__delegate_task` with:
  - `target: { providerInstanceId: "pi", model: "zai/glm-5.3" }`;
  - `options: [{ id: "thinking", value: "max" }]`;
  - role `review`, mode `async`, and a stable `clientRequestId` such as `pocket-loupe-review-m1`.
- **Prompt:**
  - read-only, no edits;
  - the repo path, the milestone's scope from this plan, and the hard rules in §1;
  - ask for concrete findings only: correctness, security (the guards, the allowlist, argv), the nixweb rules in scope, and the iOS behaviour. Each finding needs a file and line, a failure scenario and a severity;
  - "no style nits".
- Retain the `taskId` and wait with `task_status`. Keep the waits bounded; if it hasn't finished after about 30 minutes, record that and move on.
- **One fix round:**
  - fix the findings you agree with, and record the ones you reject with a reason in PROGRESS.md;
  - re-run the tests;
  - don't ask for a re-review. No loops.
- If Pi or the model isn't available, run `orchestrator_capabilities` again, record it, and continue without a review.

## 8. Milestones

Each milestone ends with these steps, in order:
1. PROGRESS.md updated;
2. tests green;
3. GLM review plus one fix round;
4. `tools/check-version.sh` and the privacy scan;
5. a commit;
6. a push.

**Commit style:** imperative subject, a body that says what and why, the `nixweb check` summary line when relevant, and the trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Git identity, set repo-locally: `Ambitious Realism <207237935+AmbitiousRealism2025@users.noreply.github.com>`.

### M0 · Groundwork

- **Scope:**
  - `git init -b main`, the local identity, `.gitignore` (`node_modules/`, `*.log`, `private/`), and `.git/info/exclude` for `REHYDRATE.md`;
  - move PROPOSAL.md and NIXWEB.md into `docs/` and fix their links;
  - `LICENSE` (MIT, Ambitious Realism), `package.json` (no dependencies, `engines.node >= 22.18`, scripts `test`, `dev`, `check`), a skeleton `README.md`, `AGENTS.md`, and PROGRESS.md;
  - the first commit, which isn't pushed yet.
- **Done when:**
  - `git log` has one commit;
  - `git ls-files` doesn't include REHYDRATE.md;
  - the privacy scan passes.

### M1 · Read path

- **Scope:** `server.ts` with the bridge, projection, guards, `/api/state`, `/api/thread`, `/ping` and `/healthz`, and static serving of a placeholder `public/index.html`. Tests from §6.1, except SSE.
- **Done when:**
  - `npm test` passes;
  - `curl` against a demo-mode server shows projected rows;
  - against the **real** collector (`run` mode, on a test port such as 18443), `/api/state` shows `live` environments. Record only counts in PROGRESS.md, never titles;
  - the three Node-only tests pass.
- **Then:** GLM review 1. Create the public GitHub repo:
  ```
  gh repo create AmbitiousRealism2025/t3-pocket-loupe --public --source . --description "T3 Loupe on your iPhone: a read-only, tailnet-only home-screen web app for T3 Code agents." --push
  ```

### M2 · Phone app

- **Scope:** §4.1, §4.2 and §4.5: the vendored modules, the main screen, the machine sheet, thread detail, the four states, the manifest, icons and meta tags. The service worker at its basic level (shell cache, offline fallback).
- **Done when:**
  - the screenshots in §6.3 look right on review;
  - `tools/nixweb-check.sh` reports no Level 1 failures;
  - `npm test` passes.
- **Then:** GLM review 2, then push.

### M3 · Dependable

- **Scope:** SSE plus the polling fallback, the lifecycle handling (§4.3), the full service worker and update flow (§4.4), every remaining guard and header, the bounds, and `check-version.sh`. `CONFORMANCE.md`, covering the three rules our tests verify and any waivers.
- **Done when:**
  - `tools/nixweb-check.sh` reports **no Level 2 failures**;
  - `npm test` passes, including the SSE tests;
  - the stale banner is shown in a screenshot taken with the server stopped. It's served from the service worker cache by the test harness; if headless Chrome can't show this, record the reason.
- **Then:** GLM review 3, then push.

### M4 · Polish and go live

- **Scope:**
  - **Theme and accessibility:** theme colours from `/api/theme`; an accessibility pass (names, focus, live region, contrast, reduced motion, Larger Text with relative units); `WHY` comments.
  - **Docs:**
    - `README.md`: what it is, a screenshot, requirements, install, the security model, and its relation to T3 Loupe and nixweb.app with links;
    - `CHANGELOG.md` (0.1.0);
    - `VENDOR.md`;
    - `device-test.md` as an **empty** checklist template for a person.
  - **Go live:** `tools/install-service.sh` installs the live service and the tailnet mapping.
- **Done when:**
  - the service is active and survives `systemctl --user restart`;
  - `tailscale serve status` shows 443 unchanged and 8443 → `127.0.0.1:8443`;
  - `nixweb check . --level 2 --target http://127.0.0.1:8443 --url https://<tailnet-name>:8443` reports no automated failures. Run it from the shell, and keep the host name out of files;
  - the README is complete;
  - the final privacy scan passes.
- **Then:** GLM review 4, the final push, and **HANDOFF.md** (§9).

## 9. Handoff (the goal's last step)

`HANDOFF.md`, committed, with no host name in it:

1. **What's running:** the unit name, the port, and how to stop, restart or uninstall it.
2. **Installing on the iPhone:**
   - open Safari to `https://<your machine>.ts.net:8443/`; the exact name comes from `tailscale status`;
   - Share → Add to Home Screen, with "Open as Web App" left on;
   - keep Tailscale connected on the phone.
3. **The manual checklist:** the output of `nixweb check --level 3 --manual`, plus the items from NIXWEB.md §8.4, as a list for the user to work through and record in `device-test.md`.
4. **What the reviews found** and what was fixed or rejected; anything still blocked, from PROGRESS.md.
5. **Suggested next steps:** web push for "needs you" with generic text, a badge, and a local-socket feed from the plugin. Each is a separate decision.

The goal is complete when HANDOFF.md is pushed and every "Done when" above is ticked in PROGRESS.md with evidence, or recorded as blocked with a reason.
