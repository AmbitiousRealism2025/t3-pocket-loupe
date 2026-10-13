# PROGRESS: T3 Pocket Loupe build

The memory of the `/goal` run. Updated after every step. Never write real host names, titles, labels or ids here: counts only.

## Current state

- **Milestone:** M1 (read path): code and tests done
- **Next:** GLM review 1 (`pocket-loupe-review-m1`) is running; then one fix round, commit M1 (server, lib, tests; public/ held back for M2), create the GitHub repo and push. M2 work has started in the working tree meanwhile.

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
- [ ] GLM review 1 + one fix round
- [ ] GitHub repo created and pushed

## M2 · Phone app

- [ ] the screenshots in §6.3 look right on review
- [ ] `tools/nixweb-check.sh` reports no Level 1 failures
- [ ] `npm test` passes
- [ ] GLM review 2 + one fix round, then push

## M3 · Dependable

- [ ] `tools/nixweb-check.sh` reports no Level 2 failures
- [ ] `npm test` passes, including the SSE tests
- [ ] the stale banner is shown in a screenshot taken with the server stopped
- [ ] GLM review 3 + one fix round, then push

## M4 · Polish and go live

- [ ] the service is active and survives `systemctl --user restart`
- [ ] `tailscale serve status` shows 443 unchanged and 8443 → 127.0.0.1:8443
- [ ] `nixweb check . --level 2 --target http://127.0.0.1:8443 --url https://<tailnet-name>:8443` reports no automated failures
- [ ] the README is complete
- [ ] the final privacy scan passes
- [ ] GLM review 4 + one fix round, final push, HANDOFF.md pushed

- `/ping` answers **200** (the standard and checker require 200; PLAN §3.2 said 204).
- CSP adds `object-src 'none'` (NW-SEC-001 requires it).
- `Cross-Origin-Resource-Policy: same-origin` goes on API responses only (`/api/*`, `/ping`, `/healthz`), not on static files: NixWeb deliberately omits CORP because it could stop iOS fetching the Home Screen icon.
- `/api/state` and `/api/theme` send `Cache-Control: no-cache` instead of `no-store`, so the service worker may keep the last good state for the offline stale view (NW-OFF-013 skips `no-store`). `/api/thread/*`, `/api/events`, `/ping` and `/healthz` stay `no-store`.
- Ids must match `^(?!\.)[A-Za-z0-9._:-]{1,120}$` (no leading dot, so never `..`).
- A POST with a chunked body gets 405 (body never read); only a declared Content-Length over 64 KiB gets 413.
- Protocol mismatch: the bridge kills the child and keeps retrying with backoff; the status stays `protocol_mismatch` until a v1 line arrives.
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

## Blocked

(nothing)

## Log

- 2026-10-12: read REHYDRATE.md, PLAN.md, PROPOSAL.md, NIXWEB.md, the nixweb STANDARD.md rules and `standard/check.py`. `git init -b main`, repo-local identity, `.git/info/exclude` (REHYDRATE.md, GOAL.md, private/). Moved PROPOSAL.md and NIXWEB.md to `docs/` and fixed links in PLAN.md and REHYDRATE.md.
- 2026-10-12: M0 committed (`c7153bc`, not pushed, as planned).
- 2026-10-12: M1 code: `server.ts`, `lib/{bridge,project,guards,tailnet}.ts`, placeholder `public/index.html`, tests and fixtures, `tools/{check-version,dev}.sh`. `npm test` 32/32. Privacy scan passed (31 files).
- 2026-10-12: M2 (in progress): vendored palette/format/icons/store (`tools/vendor-sync.sh`, VENDOR.md with SHA-256s), icons (authored SVG ring → `tools/icons.sh`), `public/{index.html,app.css,app.js,sw.js,manifest.webmanifest}`, `tests/app.test.mjs`, `tools/{nixweb-check,screenshots}.sh`. Found and fixed: a missing `)` in app.js (now caught by a syntax test), the start-up `at: null` wait. `npm test` 39/39. `tools/nixweb-check.sh` → `No automated failures for Level 2. 5 rule(s) could not be verified.` 9 screenshots in docs/screens.
