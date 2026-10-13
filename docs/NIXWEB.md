# nixweb.app for T3 Pocket Loupe

The working reference for building T3 Pocket Loupe on [nixweb.app](https://github.com/nixfred/nixweb.app): what's installed, what the standard asks for, and what applies to this project. Read it alongside [PROPOSAL.md](PROPOSAL.md).

Gathered on 13 October 2026 from the local clone at commit `57a5424`.

---

## 1. Installation on this machine

| | |
|---|---|
| Clone | `~/coding-projects/nixweb.app`, tracking `origin`. Update with `git -C ~/coding-projects/nixweb.app pull`. |
| Command | `nixweb`, on `PATH` through `~/.bashrc`. The original file is saved as `~/.bashrc.before-nixweb`. Not added to zsh. |
| App folder | `NIXWEB_APPS=~/coding-projects`, so `nixweb new <name>` creates `~/coding-projects/<name>`. The default would be `~/Projects`. |
| Standard | `~/coding-projects/nixweb.app/STANDARD.md`: NixWeb Standard 1.0, 105 rules. Machine-readable in `standard/rules.json`. |
| Checker | `standard/check.py`, run through `nixweb check`. Python 3 standard library only. Its self-test is `python3 standard/selftest.py`. |
| Prerequisites | All present: Python 3.14, ImageMagick (`nixweb icons`), systemd user services (`nixweb install`), Tailscale 1.102 with MagicDNS and HTTPS certificates enabled. |
| Smoke test | `nixweb check ~/coding-projects/nixweb.app/template --no-live` reported no automated failures at Level 2. |

### License

**The repository has no license file.** By default that means all rights reserved. Reading it, following the standard and running the checker against our own code is fine. **Copying the template (`server.py`, `public/app.js`, `public/sw.js`, `public/app.css`) is not, unless Fred Nix adds a license or gives permission.** Note that `nixweb new` works by copying the template, so don't use it for Pocket Loupe until that's settled. Asking Fred is milestone 0 in the proposal.

---

## 2. Commands

```bash
nixweb new <name>                 # copy the template to $NIXWEB_APPS/<name>  (see the license note)
nixweb icons <name> [letters]     # every icon size the manifest needs, from two letters
nixweb serve <name> [port]        # tailscale serve + run; prints the phone URL; Ctrl-C removes the mapping
nixweb install <name> [port]      # systemd --user unit nixweb-<name>, survives reboot, owns the mapping
nixweb check <name|path>          # Level 2 by default
nixweb check <path> --level 3 --manual            # everything, plus the rules a person must test
nixweb check <path> --target http://127.0.0.1:8443  # runtime checks against a server you started
nixweb check <path> --url https://<host>.ts.net:8443 # also test the tailnet HTTPS edge
nixweb check <path> --json        # machine-readable; exit 0 = no failures
nixweb standard --list            # every rule: id, level, MUST/SHOULD, static/runtime, auto/manual
nixweb hosts                      # where you could serve from
```

`nixweb serve` and `nixweb install` use the **same number** for the local port and the tailnet HTTPS port: `tailscale serve --bg --https=PORT http://127.0.0.1:PORT`. Before mapping a port, they refuse one that `tailscale serve status --json` shows is already in use. Remove an installed app with `systemctl --user disable --now nixweb-<name>`, which also drops its mapping.

---

## 3. The standard in brief

**Three levels, cumulative.**

| Level | Name | Rules | Meaning |
|---|---|---|---|
| 1 | Installable | 34 | Installs, is safe on a tailnet, nothing basic is broken. |
| 2 | Dependable | 94 | Keeps working with the host asleep, no network, an update mid-session, or a hostile page open in the browser. **Pocket Loupe's target.** |
| 3 | Exemplary | 105 | Proven on a real phone with VoiceOver, numbers recorded, a conformance claim published. |

87 rules are checked automatically and 18 need a person holding a phone. **An automated pass isn't a conformance claim.**

**Areas:** Architecture (ARC), Network (NET), Server (SRV), Security (SEC), Installability (INS), Shell and layout (SHL), iOS behaviour (IOS), Offline (OFF), Data (DAT), UX (UIX), Accessibility (ACC), Performance (PER), Documentation (DOC), Device tests (DEV).

**Waivers:** when a rule genuinely doesn't fit, put `nixweb-allow: NW-XXX-000 <reason>` on that line and record it in `CONFORMANCE.md`. A failing MUST is otherwise a bug.

---

## 4. Rules that shape Pocket Loupe

### Architecture

- **NW-ARC-001:** no build step, framework or package manager. No `node_modules`, no `package.json` dependencies, **no `tsconfig.json`**, no bundler config. T3 Loupe's style (TypeScript run directly by Node 22.18+, no dependencies, no `tsconfig.json`) fits as long as `package.json` lists no dependencies.
- **NW-ARC-002:** `public/index.html`, plus **one** `server.py`, `server.ts`, `server.js` or `server.mjs` in the app root, and none inside `public/`.
- **NW-ARC-003:** anything vendored into `public/vendor/` is listed in `VENDOR.md`. If we reuse T3 Loupe's `lib/Palette.js` or `lib/Icons.js` in the browser, record them there.

### Network and hosting

- **NW-NET-001 and -002:** bind `127.0.0.1` only and refuse anything else.
- **NW-NET-003:** nothing ever runs `tailscale funnel`.
- **NW-NET-004:** the service comes back after a reboot (`nixweb install`'s systemd unit, or our own).
- **NW-NET-005:** **host name and port are final before anyone installs.** An installed app is bound to scheme, host and port; changing either creates a different app, with different storage. Machine names must carry nothing sensitive, because the HTTPS certificate puts the host name in public Certificate Transparency logs.
- **NW-NET-006 (Level 3):** use a Tailscale grant to narrow who can reach the app when the tailnet is shared.

### Server

- **NW-SRV-001, -003, -005:** serve `public/` and nothing else. Dotfiles, server source and repository paths return 404, path traversal fails in every encoding, and there are no directory listings.
- **NW-SRV-002:** `/ping` answers fast, is never cached, and answers HEAD.
- **NW-SRV-006, -008, -009:** files without a content hash revalidate; conditional requests, gzip and byte ranges are supported.
- **NW-SRV-007:** errors and headers leak nothing, such as versions or stack traces.
- **NW-SRV-010:** clean exit on SIGTERM.
- **NW-SRV-011:** request size and time are bounded.

### Security

- **NW-SEC-001 and -002:** a strict Content-Security-Policy and companion headers on every response.
- **NW-SEC-003:** a Host-header allowlist against DNS rebinding. The template reads its own tailnet name and addresses from `tailscale status --json`.
- **NW-SEC-004:** state-changing requests refuse cross-site origins. Pocket Loupe has none in the first version, but the guard stays.
- **NW-SEC-005:** no CORS; OPTIONS gets 405.
- **NW-SEC-006 to -009:** no third-party origins, no `innerHTML` or `eval`, no inline scripts, handlers or styles, and no secrets in served files.

### Installability, shell and iOS

- **NW-INS-001 to -008:** a linked manifest with a stable `id` and a `start_url` in scope, real non-blank icons, and a **180×180 opaque `apple-touch-icon`** (iOS paints transparent pixels black). Also the Apple and Chromium meta tags, matching theme and background colours, and a deliberate status-bar style (`black`; avoid `black-translucent`, see section 6).
- **NW-SHL-001 to -010:**
  - the `viewport-fit=cover` viewport, and safe-area insets added to real padding on all four sides;
  - **the page never scrolls; lists scroll in their own box**;
  - `height: 100%` or `dvh`, never `100vh`;
  - inputs at 16px or larger;
  - `touch-action: manipulation` on controls only;
  - chrome unselectable and content selectable;
  - phone-number auto-linking off.
- **NW-IOS-001 to -004:** detect install state three ways, no user-agent sniffing, lifecycle events (`visibilitychange`, `pageshow`) rather than `unload`, and feature-detect platform APIs.

### Offline and data

- **NW-OFF-001 to -013:**
  - a service worker with versioned caches; **bump `VERSION` in `sw.js` whenever a shell file changes**;
  - only same-origin GET is cached, and `/ping` never;
  - only good responses are cached, and the shell is the fallback for navigations only;
  - registration with `updateViaCache: 'none'`, and user-gated updates (an "Update ready" button, no `skipWaiting` on install);
  - **reachability is probed with `/ping`, never inferred from `navigator.onLine`**;
  - **every fetch has a timeout**, using an AbortController and a timer rather than `AbortSignal.timeout`;
  - errors paint a screen, never a blank page;
  - API caching is bounded (50 entries in the template) and skips `no-store` and `private`.
- **NW-DAT-004:** device storage is rebuildable, and first-run state never depends on Safari. **The home-screen app and Safari don't share storage.**
- **NW-DAT-001 and -002, NW-UIX-001** apply only if Pocket Loupe ever writes: queue writes in IndexedDB, add idempotency keys, and confirm with specific wording.

### UX, accessibility and documentation

- **NW-UIX-002:** loading, empty, error and stale states for every view. **NW-UIX-003:** an in-app Back on every screen below the first. **NW-UIX-004:** the running version is visible.
- **NW-ACC-001 to -013:** zoom never disabled; language, title, one `h1` and a `main` landmark; every control named; visible focus; status changes announced (`aria-live`); reduced motion honoured; colour scheme declared; contrast met; **44px touch targets**; relative font sizes so Larger Text works; and a VoiceOver walkthrough at Level 3.
- **NW-PER-001 to -003:** a small first load, no render-blocking scripts, system fonts.
- **NW-DOC-001:** every CSS rule that exists for an iOS quirk carries a `WHY` comment. **NW-DOC-002:** an `AGENTS.md` for AI agents. **NW-DOC-003 to -005 (Level 3):** a conformance claim, a device test on record, a change log.

---

## 5. Node or Python, per the checker

The checker accepts a Node server, but covers it less:

| | `server.py` (Python) | `server.ts` (Node) |
|---|---|---|
| NW-ARC-002, one server file | Pass | Pass (`server.ts`, `.js` and `.mjs` are accepted) |
| NW-NET-001, static loopback default | Checked in the source | **Skipped:** "not a Python server; NW-NET-002 checks the socket at runtime" |
| Runtime checks (headers, CSP, Host allowlist, cross-site, CORS, caching, gzip, Range, traversal) | The checker starts `server.py` on a free loopback port by itself | **We start the server** and run `nixweb check . --target http://127.0.0.1:<port>` |
| NW-NET-002 loopback socket, NW-SRV-005 publish-only with planted files, NW-SRV-010 SIGTERM | Checked | **Skipped with `--target`:** they need a server the checker started. Cover them with our own tests. |

**What this means for the proposal's recommendation (Node):** it still works. The project needs:
- a script that starts the server and runs `nixweb check --target`;
- its own tests for the loopback socket, the publish-only rule and SIGTERM;
- a note in `CONFORMANCE.md` explaining that those three are verified by our tests rather than the checker.

If full checker coverage matters more than one language, that argues for Python.

---

## 6. iPhone facts that affect design

- **Install from Safari, with "Open as Web App" left on.** iOS 26 opens Home Screen sites as web apps by default, but the person can switch that off in the Add to Home Screen sheet.
- **Origin is identity:** scheme, host and port. Decide `https://<host>.ts.net:8443` once (NW-NET-005).
- **Status bar:** use `black`. `black-translucent` has a reported iOS 26.1+ bug where `env(safe-area-inset-top)` returns 0 and the header slides under the clock (WebKit bug 301994).
- **No browser Back** in an installed app, so the thread-detail screen needs its own Back control (NW-UIX-003).
- **Background:** iOS freezes the app when it's not in front, and timers don't run. Re-check on `visibilitychange` and `pageshow`; a live stream will be dropped and must reconnect on return.
- **Storage:** separate from Safari. Installed apps are exempt from Safari's 7-day cleanup, but keep nothing precious on the phone; all state lives on the host.
- **Web Push and badging:** installed apps only, iOS 16.4+, and the permission prompt must come from a tap (NW-DEV-006). Declarative Web Push arrived in 18.4. Not in the first version; if added later, payloads stay generic, as with T3 Loupe's notifications.
- **Not on iPhone Safari:** Background Sync, Web Bluetooth/USB/Serial/HID, vibration, orientation lock.
- **External links,** such as a PR link, may open an in-app sheet rather than Safari. Test it and record the result (NW-DEV-005).
- **Debugging a real iPhone** needs Safari Web Inspector on a Mac. `ios-webkit-debug-proxy` from Linux is fragile.

---

## 7. Hosting plan on this machine

| | |
|---|---|
| Tailscale | Running, MagicDNS on, HTTPS certificates enabled. An iPhone is on the tailnet. |
| Existing mappings | `tailscale serve` already maps **443** to T3 (`127.0.0.1:3773`). Leave it alone. |
| Pocket Loupe | **Port 8443**, both on loopback and on the tailnet, per nixweb's same-number convention. Free on both as of this writing. |
| Phone URL | `https://<this machine's tailnet name>:8443/`. The full name is in `tailscale status`; it's deliberately not written into this repo. |
| Service | `nixweb install`'s systemd user unit if we use the template layout, otherwise our own `systemd --user` unit plus `tailscale serve --bg --https=8443 http://127.0.0.1:8443`. |
| Never | `tailscale funnel`, binding `0.0.0.0`, or putting anything sensitive in the host name. |

The certificate is issued by Let's Encrypt on first request and renewed automatically. Don't repeatedly delete and reissue it: rate limits can block issuance for up to 34 hours.

---

## 8. Testing workflow

1. **`nixweb check . --level 2`**, plus `--target http://127.0.0.1:8443` for a Node server, and `--url https://<host>.ts.net:8443` to test the HTTPS edge. Paste the summary line into the change description. Exit status 0 means no automated failures.
2. **Our own tests**, the `node --test` style used by T3 Loupe. They cover:
   - the collector bridge, using T3 Loupe's fake T3 server;
   - API shapes, and that the API never returns tokens;
   - for Node, the three checks the checker skips.
3. **Optional second opinions:** Lighthouse (no installability score since v12), axe-core or pa11y, Playwright with WebKit (it can't do Add to Home Screen or safe areas).
4. **A real iPhone**, recorded in `device-test.md`:
   - installs and opens standalone;
   - offline launch with the host stopped, then with Tailscale off on the phone;
   - safe areas in portrait and landscape;
   - the update flow;
   - external links;
   - loading, empty, error and stale states;
   - 44px targets;
   - VoiceOver, Larger Text, Reduce Motion and Increase Contrast.

---

## 9. Files nixweb expects in the app

| File | Purpose |
|---|---|
| `public/index.html`, `app.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/` | The web app. `sw.js` carries `VERSION`. |
| `server.py` or `server.ts` | The one server file, beside `public/`. |
| `AGENTS.md` | How an AI agent works in the app: run `nixweb check`, treat a failing MUST as a bug, keep the hard constraints (NW-DOC-002). |
| `CONFORMANCE.md` | The claim: standard, level, date, tester, checker summary, rules not applicable, exceptions and waivers. Only filled in after a person has run the checks. |
| `device-test.md` | The real-iPhone results, rule by rule. A person fills it in, never an agent. |
| `VENDOR.md` | Any vendored code, such as T3 Loupe's palette or icons. |

---

## 10. Sources in the clone

- `README.md`: the overview and a first-app walkthrough.
- `STANDARD.md`: all 105 rules, each with its reason, source and exact test.
- `standard/CHECKLIST.md`: the 18 manual rules.
- `docs/03-iphone-gotchas.md`, `docs/04-https-and-tailscale.md`, `docs/05-offline.md`, `docs/06-testing.md`, `docs/07-security-model.md`.
- `IDEAS.md`: idea #2, "herdr Remote", is the same idea as Pocket Loupe for a different tool.
- `template/AGENTS.md`: the hard constraints, quoted in section 4.
