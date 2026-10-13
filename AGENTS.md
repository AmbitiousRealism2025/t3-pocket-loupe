# AGENTS.md: working in T3 Pocket Loupe

T3 Pocket Loupe is a NixWeb app: a Node server (`server.ts`) that serves `public/` on `127.0.0.1` and a read-only API built from T3 Loupe's collector. It targets **NixWeb Standard 1.0, Level 2 (Dependable)**.

## Check your work

```bash
npm test                       # node --test: bridge, projection, guards, SSE, the Node-only rules
tools/nixweb-check.sh          # starts the server in demo mode, runs `nixweb check . --level 2 --target …`, stops it
tools/check-version.sh         # fails if public/ changed without a new VERSION in public/sw.js
tools/privacy-scan.sh          # run before every push
```

`nixweb check` can't start a Node server, so `tools/nixweb-check.sh` starts one and passes `--target`. Three rules it then skips (NW-NET-002, NW-SRV-005, NW-SRV-010) are covered by `tests/node-only.test.mjs`. A failing MUST is a bug. Waive a rule only with `nixweb-allow: NW-XXX-000 <reason>` plus an entry in `CONFORMANCE.md`.

## Hard constraints

- **No build step, no dependencies, no `tsconfig.json`.** Node 22.18+ runs `server.ts` directly. The browser loads `public/app.js` as an ES module.
- **Bind `127.0.0.1` only.** Never `0.0.0.0`, `::` or a tailnet address. Never run `tailscale funnel`.
- **Read-only.** No route changes T3 state. The collector's `copy`, `reload` and `refresh` commands are never exposed.
- **The phone never receives secrets.** `lib/project.ts` picks every API field by name. Never spread a collector object into a response.
- **No private text in process arguments.** The collector is spawned with fixed arguments only.
- **No `innerHTML`, no inline script or style.** Use `textContent` and `createElement`.
- **Bump `VERSION` in `public/sw.js`** whenever any file in `public/` changes.
- **Public repo hygiene:** demo data only in commits, docs and screenshots. No real thread titles, environment ids, home paths or tailnet host names.
- **Don't modify T3 Loupe** (the plugin, its repo or its config). Pocket Loupe only reads and runs its collector.

## What needs a person

Installing on an iPhone, the device checklist (`device-test.md`, filled in only by a person), VoiceOver, Larger Text and the other manual rules listed by `nixweb check . --level 3 --manual`.
