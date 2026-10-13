# HANDOFF: T3 Pocket Loupe 0.1.0

What the build run left you: a running service, a published tailnet URL, a phone app ready to install, and a checklist only a person with an iPhone can do. Everything here was verified on this machine on 2026-10-13 unless it says otherwise.

## 1. What's running

| | |
|---|---|
| Service | `t3-pocket-loupe.service`, a systemd **user** unit in `~/.config/systemd/user/`, enabled (`WantedBy=default.target`) |
| Server | `server.ts --port 8443`, bound to `127.0.0.1` only, running its own copy of T3 Loupe's collector (`run` mode) |
| Tailnet | `tailscale serve`: HTTPS port 8443 → `http://127.0.0.1:8443`. The unit adds it on start and removes it on stop. T3's own 443 → `127.0.0.1:3773` mapping is unchanged. |
| Node | the newest mise-installed Node 22.18+ at install time (v26.10.0), by absolute path |

```bash
systemctl --user status t3-pocket-loupe       # is it up?
journalctl --user -u t3-pocket-loupe -f       # logs (no titles or tokens are logged)
systemctl --user restart t3-pocket-loupe      # after pulling a new version
systemctl --user stop t3-pocket-loupe         # stop; also removes the 8443 mapping
tools/install-service.sh --uninstall          # disable, remove the unit and the mapping
tailscale serve status                        # 443 → 3773 and 8443 → 8443
```

**After a reboot** it starts when you log in. It doesn't start before login, because linger is off for your user (`loginctl show-user $USER -p Linger` → `no`). If you want it running without a login: `loginctl enable-linger $USER`. That's a change to your login policy, so the run left it to you.

**After updating T3 Loupe**, restart the service so it runs the new collector. If T3 Loupe's protocol version ever changes, the app says "T3 Loupe speaks a newer protocol" instead of showing wrong data.

## 2. Installing on the iPhone

1. Make sure Tailscale is connected on the phone.
2. In **Safari**, open `https://<your machine>.ts.net:8443/`. The exact name is the `DNSName` in `tailscale status --json` on this machine (without the trailing dot), or the line `tailscale serve status` prints for port 8443. It's deliberately not written in this repo.
3. Share → **Add to Home Screen**, and leave **"Open as Web App"** on.
4. Open it from the Home Screen: you should see the ring icon, no Safari bars, and your threads.

The origin (`https`, the machine name, port 8443) is the app's identity. Renaming the machine or changing the port later makes a different app with its own storage, so keep both. The manifest `id` is `/`.

## 3. The manual checklist

Work through these on the phone and record the results in [device-test.md](device-test.md) (which has a row for each). nixweb says only a person fills that file in.

**From `nixweb check . --level 3 --manual`** (the rules no tool can check):

| Rule | Level | What to do |
|---|---|---|
| NW-DEV-001 | 1 MUST | Share → Add to Home Screen with Open as Web App on. The icon is the ring, the app has its own App Switcher entry, no browser bars. |
| NW-NET-005 | 2 SHOULD | The README states the origin and the manifest id (it does). Search crt.sh for the machine name: issuing the HTTPS certificate already published it in Certificate Transparency logs; check you don't mind what's there. |
| NW-DAT-004 | 2 MUST | Delete and re-add the icon: nothing important is lost (everything lives on the host). Then visit the URL in Safari first, install, and confirm the app doesn't depend on anything from that visit (Safari's storage is separate from the app's; the app keeps no settings). |
| NW-UIX-002 | 2 MUST | Every view has loading, empty, error and stale states: go offline, empty list, a failed server, a slow answer. |
| NW-UIX-003 | 2 MUST | Open a thread and a machine: the in-app Back returns to the list; an edge swipe, if iOS offers one, agrees and never exits the app. |
| NW-ACC-011 | 2 MUST | Every control is at least 44 px (the visual review measured chips at 44, buttons at about 44–46). |
| NW-DEV-002 | 2 MUST | `systemctl --user stop t3-pocket-loupe`, force-quit the app, launch it: the shell paints in about a second, shows the last data and says "host unreachable" with Retry. Repeat with Tailscale off on the phone. Start the service again afterwards. |
| NW-DEV-003 | 2 MUST | Portrait and landscape on a notched iPhone: the header, chips and footer clear the notch or Dynamic Island and the home indicator. (No text inputs, so no keyboard test.) |
| NW-DEV-004 | 2 MUST | With the app open, ship a new version: bump `VERSION` in `public/sw.js` (and the matching strings in `public/app.js` and `public/index.html`; `npm test` checks they agree), restart the service, background and reopen the app: "Update ready" appears, one tap reloads once, the footer shows the new version. (Verified in headless Chrome; not on a phone.) |
| NW-DEV-005 | 2 MUST | Tap "Answer this in T3" and "Open pull request": record whether iOS opens an in-app sheet or Safari, and that the app keeps its place. "Copy link" is there for each. |
| NW-DEV-006 | 2 MUST | No permission prompt ever appears (the app asks for none). |
| NW-DEV-007 | 2 MUST | Not applicable: the app sends no writes. |
| NW-NET-006 | 3 SHOULD | Only if your tailnet is shared: a Tailscale grant limits who reaches port 8443. |
| NW-DAT-005 | 3 SHOULD | Not applicable: no offline writes. |
| NW-ACC-012 | 3 MUST | VoiceOver on, Larger Text at maximum, Reduce Motion and Increase Contrast on: swipe through every screen; each control has a name and role; a change in the "needs you" count is announced; the stale banner is spoken. |
| NW-PER-004 | 3 MUST | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, measured on a real phone (Safari Web Inspector needs a Mac). |
| NW-DEV-008 | 3 SHOULD | Only if you claim Android: install from Chrome on Android and check DevTools → Application → Manifest. |
| NW-DEV-009 | 3 MAY | Leave an installed copy unused for 8–10 days, then open it offline. |

**Also from [docs/NIXWEB.md](docs/NIXWEB.md) §8.4** (real-iPhone tests): installs and opens standalone; offline launch with the host stopped, then with Tailscale off; safe areas in portrait and landscape; the update flow; external links; loading, empty, error and stale states; 44 px targets; VoiceOver, Larger Text, Reduce Motion and Increase Contrast. Each is covered by a row above.

**Things only a device can answer** (open questions in the standard): whether `font: -apple-system-body` makes the installed app follow Larger Text (the CSS uses it, with rem sizes everywhere), and whether an edge-swipe back exists in installed apps on iOS 26.

## 4. Verified here, and not

| Check | Result |
|---|---|
| `npm test` | 51 tests, all pass: bridge, projection, guards, event stream, run mode against T3 Loupe's fake T3, the app shell, and the three Node-only rules |
| `nixweb check . --level 2 --target http://127.0.0.1:8443 --url https://<machine>.ts.net:8443` | `No automated failures for Level 2. 5 rule(s) could not be verified.` (exit 0); NW-NET-007 (the edge) passes |
| The 5 "not verified" | NW-NET-001/-002, NW-SRV-005, NW-SRV-010: the checker only starts Python servers; `tests/node-only.test.mjs` covers them. NW-NET-004: the checker looks for a `nixweb-<name>` unit; ours is `t3-pocket-loupe.service`. |
| Host header through `tailscale serve` | Passed through unchanged; a spoofed `Host: evil.example` through the edge gets 421 |
| Offline stale view | Real: service worker controlling, server stopped, reload → shell and last state from the cache, banner shown (`docs/screens/stale-dark.png`) |
| Update flow | Real in headless Chrome: new VERSION deployed → "Update ready" → one tap → reload into the new version |
| Live data | The live service reaches T3 through the collector and shows its paired machines with their health |
| Privacy scan of the pushed repo | `tools/privacy-scan.sh` passes on the final commit (it also checks the real environment labels and ids, read live and never written down) |
| **Not verified** | Anything on a real iPhone (section 3), VoiceOver, and the app under iOS's background freezing (handled in code with `visibilitychange`/`pageshow`, tested only in Chrome). |

## 5. What the reviews found

Each milestone M1–M4 had one GLM-5.3 review (Pi, `zai/glm-5.3`, thinking max) and one fix round, no re-reviews. M2 also had a visual check of the screenshots by `zai/glm-5.3-flash`. Details are in [PROGRESS.md](PROGRESS.md) under Reviews.

| Review | Findings | Outcome |
|---|---|---|
| **M1** read path (GLM-5.3) | 2 medium, 2 low, test gaps | **Fixed:** an async spawn failure left the collector never restarted (now supervised from `close`, status `failed`); detail requests were unbounded (now one shared wait per thread, 16 at most, repeats coalesced, stdin backlog capped); a late line from a dead child could claim `running`. **Kept:** SIGTERM closes connections after 1 s, which can cut a 3 s detail wait; exiting within 3 s matters more and the phone retries. Missing tests added. |
| **M2** phone app (GLM-5.3) | 2 medium, 6 low | **All fixed:** thread and machine screens now show "Can't reach Pocket Loupe on the host" with Retry instead of a skeleton forever; polling stops when the stream recovers; no reload on first install; machine chips no longer rebuilt every 5 s (lost taps, lost VoiceOver focus); clearer "not active" vs "unreachable"; section-count contrast; a client-side `https:` check on PR links; no inline style. |
| **M2** screens (GLM-5.3-flash, visual) | 2 medium, 5 low | **Fixed:** the summary and the Working section now count the same rows; machine chips go neutral while the host is unreachable; activity sorted newest first; a compact agents button; a full usage bar uses the warning colour. **Kept, by design:** "Plan ready" stays neutral and failed runs stay red, matching T3 Loupe's panel colour budget. |
| **M3** dependable (GLM-5.3) | 1 medium, 1 medium-low, 4 low | **All fixed:** event-stream backpressure (a stalled reader now buffers at most about one frame and is closed after 60 s stalled); the service worker's cache-first fetch now has a timeout; the screenshot harness cleans up on failure; a CONFORMANCE.md row corrected; ping and expiry tests; the 512 icons precached. |
| **M4** go-live (GLM-5.3) | 6 low | **All fixed:** the installer refuses to guess when `tailscale serve status` fails and checks for `ss` and `curl`; `--uninstall` removes a leftover 8443 mapping only if it's ours; device-test.md gained the NW-DEV-009 row and the Safari half of NW-DAT-004; a detail about the real setup removed from this file. |

No review found a high-severity problem. The reviewers confirmed the Host allowlist, traversal protection, the projection (no tokens, URLs or paths reach the phone), argv hygiene, the service-worker core and the iOS lifecycle handling.

## 6. Blocked

Nothing is blocked. Every "Done when" in PLAN.md §8 is ticked in PROGRESS.md with its evidence. What's left is only what needs a person and a phone (section 3).

## 7. Suggested next steps

Each is a separate decision; none is started.

1. **Web push for "needs you"**, with generic text (like T3 Loupe's notifications), for the installed app on iOS 16.4+. It needs a tap-gated permission prompt (NW-DEV-006), a VAPID key on the host and a subscription store. The collector's `notice` lines are already read and ignored, ready for this.
2. **A Home Screen badge** with the "needs you" count (Badging API, installed app only), which comes almost free with push.
3. **A local-socket feed from the T3 Loupe plugin** instead of a second collector. It removes the second set of T3 connections, but it's a plugin change with its own release and marketplace re-verification.
4. **Linger**, if you want the service up before you log in (section 1).
