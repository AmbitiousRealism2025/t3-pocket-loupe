# CONFORMANCE.md: T3 Pocket Loupe and the NixWeb Standard

Standard: NixWeb Standard 1.0.0
Level: 2 (Dependable), automated rules only; the device rules are not yet recorded
Date: 2026-10-12
Tester: the build run (automated checks only); device tests pending a person (see device-test.md)

**This is not yet a conformance claim.** An automated pass isn't one: the Level 2 device rules (NW-DEV-001 to -007, NW-UIX-002/-003, NW-ACC-011, NW-DAT-004, NW-NET-005) need a person with an iPhone, recorded in [device-test.md](device-test.md).

## Checker result

`tools/nixweb-check.sh` (demo server, `nixweb check . --level 2 --target http://127.0.0.1:<port>`):

```
No automated failures for Level 2. 5 rule(s) could not be verified.
```

The live service is also checked against loopback and the tailnet edge: `nixweb check . --level 2 --target http://127.0.0.1:8443 --url https://<machine>.ts.net:8443`. The result is recorded in HANDOFF.md.

## Rules verified by our own tests instead of the checker

`nixweb check` starts only a Python `server.py`. For a Node server it runs the runtime rules against a server we started (`--target`), and these rules then report "not verified". `tests/node-only.test.mjs` covers them:

| Rule | How it's verified |
|---|---|
| NW-NET-001 | `parseOptions` refuses any `--host`/`HOST` other than `127.0.0.1`/`localhost`; the bind address is a constant. The test starts the server with `0.0.0.0`, `::`, `::1`, a 100.x address, a name and `127.0.0.2` and requires a non-zero exit with nothing listening. |
| NW-NET-002 | The test reads `/proc/net/tcp` and `/proc/net/tcp6` for the server's port and requires every listening socket to be `127.0.0.1`. |
| NW-SRV-005 | The test copies the app to a temporary folder, plants `zz-canary.txt` and `secret.js` beside `public/`, and `zz-canary.db`, `server.ts.bak`, `notes.md`, `.env`, `.git/config`, an empty directory, a symlink to `server.ts` and a symlink to the app root inside `public/`, then requires 404 for every one of them and for traversal to `../server.ts`. Static serving also requires an allowlisted extension. |
| NW-SRV-010 | The test sends SIGTERM and requires exit status 0 within 3 s, and that the collector child process is gone. |

## Rules checked by hand at go-live

| Rule | How it was checked |
|---|---|
| NW-NET-004 | The checker looks for a `nixweb-<name>` unit; ours is `t3-pocket-loupe.service` (`tools/install-service.sh`): `Restart=on-failure`, `WantedBy=default.target`, `systemctl --user is-enabled` → `enabled`, and it came back after `systemctl --user restart`. Linger is off (the unit starts at login); see HANDOFF.md. Not tested across a reboot. |
| NW-NET-007 | `nixweb check … --url https://<machine>.ts.net:8443` passes it (Level 3 SHOULD). |

## Rules not applicable

| Rule | Why |
|---|---|
| NW-DAT-001, -002, -005, NW-UIX-001, NW-DEV-007 | The app sends no writes. |
| NW-SHL-010 | The app has no text inputs. |
| NW-IOS-001 | The app doesn't change behaviour on install state. |
| NW-ACC-009 | The app has no `nav` landmark (machine chips are a labelled group of buttons). |
| NW-DEV-006 | The app asks for no permissions. |

## Deliberate choices

- `/ping` answers 200 with an empty body and `Cache-Control: no-store`.
- `Cross-Origin-Resource-Policy: same-origin` is sent on API responses only, not static files, following the standard's note that it could stop iOS fetching the Home Screen icon.
- `/api/state` and `/api/theme` are `Cache-Control: no-cache` (always revalidated), so the service worker may keep the last good answer for the offline view (NW-OFF-013 skips `no-store`). Thread detail, the event stream, `/ping` and `/healthz` are `no-store`.

## Waivers

None. No `nixweb-allow` comment is used anywhere in the app.
