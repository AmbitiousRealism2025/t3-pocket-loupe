# PROGRESS: T3 Pocket Loupe build

The memory of the `/goal` run. Updated after every step. Never write real host names, titles, labels or ids here: counts only.

## Current state

- **Milestone:** all done: M0–M4 complete, HANDOFF.md written.
- **Next:** nothing for the build run. The person: install on the iPhone and work through HANDOFF.md §3, recording results in device-test.md.

## Decisions made during the run

- `GOAL.md` is excluded from git with `REHYDRATE.md` (it's a T3 thread instruction, not project content).

## M0 · Groundwork

- [x] `git log` has one commit: `git log --oneline` → `c7153bc Lay the groundwork for T3 Pocket Loupe`
- [x] `git ls-files` doesn't include REHYDRATE.md: `git ls-files | grep -c REHYDRATE` → `0`
- [x] the privacy scan passes: `tools/privacy-scan.sh` → `privacy-scan: passed (10 files scanned)` (also negative-tested: six planted canaries all flagged)

## M1 · Read path

- [x] `npm test` passes: `npm test` → `ℹ tests 32 / ℹ pass 32 / ℹ fail 0` (bridge, projection, guards, node-only, run-mode against T3 Loupe's fake T3)
- [x] `curl` against a demo-mode server shows projected rows: `node server.ts --port 18443 --demo` + `curl /api/state` → `collector=running rows=17 envs=2 first row keys=31`
- [x] against the real collector (run mode, port 18443), `/api/state` shows `live` environments: `collector=running environments=2 states={"live":1,"tunnel_missing":1} rows=11 counts={"active":5,"busy":1,"attention":0,"input":0,"review":0}` (the tunnel_missing one is the SSH-tunnelled machine, expected)
- [x] the three Node-only tests pass: `tests/node-only.test.mjs` NW-NET-002 (socket table + refused --host/HOST), NW-SRV-005 (planted files, symlinks, traversal on a temp copy), NW-SRV-010 (SIGTERM → exit 0 < 3 s, collector child gone), all in the 32 passes above
- [x] GLM review 1 + one fix round (see Reviews)
- [x] GitHub repo created and pushed: `gh repo create AmbitiousRealism2025/t3-pocket-loupe --public --source . --push` → `https://github.com/AmbitiousRealism2025/t3-pocket-loupe`, `* [new branch] HEAD -> main`; commit `cf54052` (a clean export of the M1 index: `npm test` 36/36; privacy scan passed, 32 files)

## M2 · Phone app

- [x] the screenshots in §6.3 look right on review: `tools/screenshots.sh` → `screenshots: 9 written` (main, command, question, working thread, machine, stale (server stopped, served from the SW cache), empty, plus main and command in a light theme). Read every PNG; fixed the detail title style and the "Copy t3 link" label, then regenerated.
- [x] `tools/nixweb-check.sh` reports no Level 1 failures: `Level 1 Installable 34 rules: 29 pass, 0 fail, 0 warn, 3 not verified` and `No automated failures for Level 2. 5 rule(s) could not be verified.`
- [x] `npm test` passes: 43/43
- [x] GLM review 2 + one fix round, then push (see Reviews; code review plus a glm-5.3-flash visual check, one combined fix round)

## M3 · Dependable

- [x] `tools/nixweb-check.sh` reports no Level 2 failures: `Level 2 Dependable 60 rules: 41 pass, 0 fail, 0 warn, 2 not verified, 6 not applicable, 11 need a person` / `No automated failures for Level 2. 5 rule(s) could not be verified.` (the 5: NW-NET-001/-002, NW-SRV-005, NW-SRV-010 covered by tests/node-only.test.mjs; NW-NET-004 looks for a `nixweb-<name>` unit, ours is `t3-pocket-loupe.service`)
- [x] `npm test` passes, including the SSE tests: 48/48 (`tests/events.test.mjs`: first event with projection and no secrets, ≥1 s between events, 9th stream 503 and slot reuse, SIGTERM ends streams and exits 0, Host/method guards)
- [x] the stale banner is shown in a screenshot taken with the server stopped: `docs/screens/stale-dark.png`, taken by `tools/screenshots.sh` after the service worker was controlling and had cached `/api/state`, the server was stopped and the page reloaded (shell and state from the SW cache, `/ping` refused). Also new: an end-to-end update-flow check → `screenshots: update flow ok (pl-0.1.0 → pl-9.9.9-update-test after one tap)` and `update-ready-dark.png`. A headless-Chrome check confirmed live updates arrive over the stream (one `/api/state` fetch, footer stays "Updated just now" over 15 s).
- [x] GLM review 3 + one fix round, then push (see Reviews)

## M4 · Polish and go live

- [x] the service is active and survives `systemctl --user restart`: `tools/install-service.sh` → `node: v26.10.0`, `tailnet port 8443 is free`, `local: http://127.0.0.1:8443/ping answers`, `443 mapping unchanged`; then `systemctl --user restart t3-pocket-loupe` → `active` / `enabled`, `/healthz` → `{"ok":true,"collector":"running",…}`, live `/api/state`: `environments=2 states={"live":1,"tunnel_missing":1} rows=13` (counts only). (First run 2026-10-13 ~02:54 UTC; re-checked after the final commit, see Log.)
- [x] `tailscale serve status` shows 443 unchanged and 8443 → 127.0.0.1:8443: `|-- / proxy http://127.0.0.1:3773` and `…:8443 (tailnet only) |-- / proxy http://127.0.0.1:8443`; JSON compare with a private pre-install snapshot → `443 unchanged: true`, `TCP ports: 443,8443`
- [x] `nixweb check . --level 2 --target http://127.0.0.1:8443 --url https://<tailnet-name>:8443` reports no automated failures: `No automated failures for Level 2. 5 rule(s) could not be verified.` exit 0; with `--level 3 --only NW-NET-007`: `✓ NW-NET-007 SHOULD The tailnet HTTPS edge delivers what loopback does`
- [x] the README is complete: what it is, screenshots, how it works, requirements, install (origin and manifest id stated, NW-NET-005), security model, development, related projects (T3 Loupe, nixweb.app), license; claims checked by review 4
- [x] the final privacy scan passes: `tools/privacy-scan.sh` → `passed`, run before the final commit and again on the pushed commit (see Log)
- [x] GLM review 4 + one fix round, final push, HANDOFF.md pushed (see Reviews and Log)
- Final re-check before the last commit: `npm test` → 51/51; `nixweb check . --level 2 --target http://127.0.0.1:8443 --url https://<tailnet-name>:8443` → `No automated failures for Level 2. 5 rule(s) could not be verified.` exit 0; `systemctl --user is-active t3-pocket-loupe` → `active`; serve status → `443 unchanged: true | 8443 -> http://127.0.0.1:8443 | TCP: 443,8443`

- `/ping` answers **200** (the standard and checker require 200; PLAN §3.2 said 204).
- CSP adds `object-src 'none'` (NW-SEC-001 requires it).
- `Cross-Origin-Resource-Policy: same-origin` goes on API responses only (`/api/*`, `/ping`, `/healthz`), not on static files: NixWeb deliberately omits CORP because it could stop iOS fetching the Home Screen icon.
- `/api/state` and `/api/theme` send `Cache-Control: no-cache` instead of `no-store`, so the service worker may keep the last good state for the offline stale view (NW-OFF-013 skips `no-store`). `/api/thread/*`, `/api/events`, `/ping` and `/healthz` stay `no-store`.
- Ids must match `^(?!\.)[A-Za-z0-9._:-]{1,120}$` (no leading dot, so never `..`).
- A POST with a chunked body gets 405 (body never read); only a declared Content-Length over 64 KiB gets 413.
- Protocol mismatch: the bridge kills the child and keeps retrying with backoff; the status stays `protocol_mismatch` until a v1 line arrives.
- **What Host header `tailscale serve` forwards (PLAN §3.3, checked at runtime 2026-10-13):** the client's own Host, unchanged. Through the edge: default Host (`<name>:8443`) → 200, `<name>` without port → 200, a spoofed `Host: evil.example` → **421** from our server, `Host: 127.0.0.1:8443` → 200. So the allowlist sees what the phone sent, and DNS rebinding through the edge is refused too.
- Linger is not enabled (`loginctl show-user` → `Linger=no`): the unit starts at login (`WantedBy=default.target`), which is when the desktop runs anyway. Enabling linger is left to the user (HANDOFF.md).
- Visual second opinions (from the user, 2026-10-12): `glm-5.3-flash` has vision. For M2–M4, the GLM-5.3 code review is paired with a `zai/glm-5.3-flash` look at `docs/screens/`, launched together and answered in the same single fix round.
- Vendored T3 Loupe libraries are wrapped as ES modules by `tools/vendor-sync.sh` (pragma dropped, `export {…}` appended); the app reuses `Store.visibleRows(rows, "active", …)` so the order and grouping match the panel exactly. Subagent children fold under their parent behind a "+N" button unless they need attention.
- The checker flags any element id containing "fatal"/"banner"/"alert" without a live role, so the error screen uses `crash-*` ids (it has `role="alert"` itself).
- The app re-asks `/api/state` every 2 s while the collector hasn't reported yet (`at: null`), instead of waiting for the next poll.
- Screenshots are driven over the Chrome DevTools protocol (`tools/screenshots.mjs`), so the stale view can be captured for real: SW installed and controlling, state cached, server stopped, reload.
- Test fixtures build home paths, tailnet names and 100.x addresses at runtime so the privacy scan never sees a literal one.

## Reviews

- **M1:** GLM-5.3 (pi, `zai/glm-5.3`, thinking max), clientRequestId `pocket-loupe-review-m1`, completed 2026-10-13 ~02:35 UTC (about 22 min). It ran `npm test` (32/32) and live probes. Findings and the one fix round:
  1. **Medium, fixed.** An async spawn failure (ENOENT/EACCES/EMFILE) emits `error` + `close` but no `exit`, so the bridge never restarted and stayed `starting`. Supervision now hangs off `close`; the status becomes `failed` with `spawn_failed`. New test with a non-existent node binary.
  2. **Medium, fixed.** Detail requests were unbounded (timers, listeners, collector watch pins via pipelined requests). Waits are now one shared promise per thread, at most 16 threads awaited at once (beyond that: 503 `busy`), repeat `detail` commands for one thread within 2 s are coalesced, and a backed-up collector stdin (>64 KiB) refuses new commands. New test.
  3. **Low, fixed.** A trailing line from a dead or killed child could flip the status to `running`. `onLine` now ignores lines from a child that's been replaced or killed.
  4. **Low, not changed (accepted trade-off).** SIGTERM closes remaining connections at 1 s, which can cut a 3 s detail wait. Exiting within 3 s (NW-SRV-010) matters more; the phone retries.
  5. **Test gaps, fixed:** spawn-error supervision, an oversized line split across chunks (new fixture), backoff reset after a healthy run, and the guards test now passes `--public-port 8443` explicitly. Not changed: the live tailnet Host path is verified in M4 with `nixweb --url`.
  - After the fixes: `npm test` → 43/43 (includes the M2 app tests in the working tree; the M1 commit's own suite is checked separately).
- **M2 code:** GLM-5.3 (pi, `zai/glm-5.3`, thinking max), clientRequestId `pocket-loupe-review-m2`, completed ~03:05 UTC. It ran `npm test` (48/48) and `tools/nixweb-check.sh`. No high findings; security, the service-worker core and the iOS lifecycle reported clean. All eight findings accepted and fixed in the one round:
  1. Medium: thread and machine screens showed a skeleton forever, with no Retry, when the host was unreachable at relaunch. Now they show "Can't reach Pocket Loupe on the host" with Retry (NW-UIX-002).
  2. Medium: polling kept running after the event stream recovered. `openStream` now clears the poll timer.
  3. Low: the first install reloaded the page once (`clients.claim` fires `controllerchange`). Reload now happens only after the person taps "Update ready".
  4. Low: machine chips were rebuilt every 5 s (lost taps and VoiceOver focus). Summary and chips now rebuild only when what they show changes.
  5. Low: "isn't active any more" was shown for unreachable/timeout failures. It now branches on the error.
  6. Low: section counts were below 4.5:1. They use `--dim`.
  7. Low: the PR link now also checks `https://` on the client.
  8. Low: the meter used an inline style (CSSOM). It's an SVG with width attributes now.
  - After both M2 rounds: `npm test` 48/48; `tools/nixweb-check.sh` → `No automated failures for Level 2. 5 rule(s) could not be verified.`; screenshots regenerated and re-read.
- **M2 visual:** `zai/glm-5.3-flash` (pi, thinking max), clientRequestId `pocket-loupe-visual-m2`, on the 9 screens; completed ~02:55 UTC. Tap targets ≥44 px, contrast AA and safe areas measured fine. Findings (decisions; fixes land in the single M2 fix round):
  1. Medium, accept: summary "6 working" vs section "WORKING 7" (Store's Working section includes `limited`). Summary will count what the sections show.
  2. Medium, accept in part: in the stale view the machine chips still look live. Chips go neutral while the host is unreachable. ("just now" was literally true: the shot is taken seconds after the stop.)
  3. Medium/low, accept: activity not in time order (demo data order). Sort by `at`, newest first.
  4. Low, accept: a path wraps mid-word. Use `overflow-wrap: break-word`.
  5. Low, reject: "Plan ready" is neutral in Needs you. That's T3 Loupe's panel colour budget (only input and failed are tinted); keep parity with the panel.
  6. Low, accept in part: a full usage bar uses the needs-you red; it becomes the warning colour (the palette's role for `limited`). Rejected: failed runs stay red (failed is an attention state in T3 Loupe); machine health dots are outside the row colour budget.
  7. Low, accept: the "+2" agents button stretches into an empty-looking sliver. Make it a compact, centred button labelled with an icon.
- **M3:** GLM-5.3 (pi, `zai/glm-5.3`, thinking max), clientRequestId `pocket-loupe-review-m3`, completed ~03:20 UTC. It ran `npm test` (48/48), the checker, and live probes of the hub (33 s stream, compressed expiry, a stalled reader, a crashing collector). Hub races, caps, guards, the iOS lifecycle and the update flow reported clean. All six findings accepted and fixed in the one round:
  1. Medium: no backpressure on stream writes (a stalled reader buffered 19 MB in 9.5 s with a 2 MB state). Now frames are skipped while the socket isn't draining (at most about one frame buffered), the latest state is sent on drain, and a stream stalled for 60 s is closed. New test: a ~1 MB-per-frame stalled reader peaks within 2.5 frames and is closed.
  2. Medium-low: the service worker's cache-first fetch had no timeout (NW-OFF-011). It uses the bounded `fetchWithin` now.
  3. Low: `tools/screenshots.mjs` leaked servers, Chromes and temp folders when a step threw. It tracks and removes them on any exit. The leftovers from my early failed runs (three `--port 0` demo servers, four headless Chromes, five temp profiles; all mine, all loopback) were removed; the live service was untouched.
  4. Low: CONFORMANCE.md listed NW-NET-004 under "verified by our own tests". Moved to a "checked by hand at go-live" section.
  5. Low: the 25 s ping and 10-minute expiry had no tests. New hub tests with small timings.
  6. Low: the 512 and maskable icons weren't precached. They replace the SVG favicon in the precache list (still 12 files).
  - Shell VERSION bumped to `pl-0.1.1` (public/ changed after the M2 commit). After the round: `npm test` 51/51, `tools/nixweb-check.sh` → `No automated failures for Level 2.`, screenshots regenerated (update flow `pl-0.1.1 → pl-9.9.9-update-test after one tap`), no leftover processes.
- **M4:** GLM-5.3 (pi, `zai/glm-5.3`, thinking max), clientRequestId `pocket-loupe-review-m4`, completed ~03:45 UTC. It ran `npm test` (51/51), the checker, inspected the live unit and serve status. No high or medium findings; the unit, the no-clobber logic, README and HANDOFF claims were confirmed against the code and the live system. All six low findings accepted and fixed in the one round:
  1. The installer read a failed `tailscale serve status` as "port free". It now refuses with a clear message; `After=tailscaled.service` (inert in a user unit) removed.
  2. Missing `ss`/`curl` failed soft. They're required up front now.
  3. `--uninstall` could leave a stale 8443 mapping if the unit was already stopped. It now removes the mapping itself, only when it's ours.
  4. device-test.md lacked a row for NW-DEV-009 (and NW-DAT-005, NW-DEV-008). Added.
  5. The NW-DAT-004 row missed the Safari-storage half. Added (device-test.md and HANDOFF).
  6. HANDOFF named a detail of the real setup (an SSH-tunnelled machine). Replaced with a generic line.
  - After the round: the fixed installer re-run over the live install → `tailnet port 8443 already maps to http://127.0.0.1:8443`, `443 mapping unchanged`, exit 0; `npm test` 51/51.

## Blocked

Nothing. No check failed three times; every "Done when" is ticked with evidence.

## Log

- 2026-10-12: read REHYDRATE.md, PLAN.md, PROPOSAL.md, NIXWEB.md, the nixweb STANDARD.md rules and `standard/check.py`. `git init -b main`, repo-local identity, `.git/info/exclude` (REHYDRATE.md, GOAL.md, private/). Moved PROPOSAL.md and NIXWEB.md to `docs/` and fixed links in PLAN.md and REHYDRATE.md.
- 2026-10-12: M0 committed (`c7153bc`, not pushed, as planned).
- 2026-10-12: M1 code: `server.ts`, `lib/{bridge,project,guards,tailnet}.ts`, placeholder `public/index.html`, tests and fixtures, `tools/{check-version,dev}.sh`. `npm test` 32/32. Privacy scan passed (31 files).
- 2026-10-12: M2 (in progress): vendored palette/format/icons/store (`tools/vendor-sync.sh`, VENDOR.md with SHA-256s), icons (authored SVG ring → `tools/icons.sh`), `public/{index.html,app.css,app.js,sw.js,manifest.webmanifest}`, `tests/app.test.mjs`, `tools/{nixweb-check,screenshots}.sh`. Found and fixed: a missing `)` in app.js (now caught by a syntax test), the start-up `at: null` wait. `npm test` 39/39. `tools/nixweb-check.sh` → `No automated failures for Level 2. 5 rule(s) could not be verified.` 9 screenshots in docs/screens.
- 2026-10-13: M1 committed (`cf54052`) and pushed; public repo created.
- 2026-10-13: M2 review round applied (both reviews), screens regenerated.
- 2026-10-13: M2 committed (`6f5033d`) and pushed. M3: SSE hub `lib/events.ts` wired into `server.ts`; update-flow check in the screenshot harness; checks green.
- 2026-10-13: M3 committed (`ecd1697`) and pushed; service restarted on it (serves `pl-0.1.1`). M4 accessibility pass: a headless-Chrome audit of `#/`, three thread screens and a machine screen at 390×844 → every button/link has an accessible name and is ≥44×44 px, one `h1`, a live region present (`problems: []` on all five). Theme colours come from `/api/theme` through Palette.derive (dark and light screenshots). README, CHANGELOG, VENDOR.md, device-test.md (empty template) and a HANDOFF.md draft written. Next: GLM review 4.
- 2026-10-13: M4 review round applied; installer re-run over the live install (exit 0); final checks green; committing M4 with HANDOFF.md.
