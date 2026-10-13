# T3 Pocket Loupe — project proposal

**Status:** proposal, 13 October 2026. Nothing has been built yet.
**In one line:** T3 Loupe's read-only view of every T3 Code agent, as an iPhone home-screen web app reached only over your own Tailscale network.

> **Decisions (milestone 0, settled 13 October 2026)**
> 1. **Server: Node** (`server.ts`, no dependencies, no `tsconfig.json`). Our own tests cover the three checks `nixweb check --target` skips; a systemd user unit replaces `nixweb serve`/`install`, which only run `server.py`.
> 2. **nixweb.app is used as the standard and the checker only.** All code is our own; nothing is copied from its unlicensed template, and `nixweb new` isn't used.
> 3. **Personal tailnet:** full thread titles and command text by default; no generic-label mode needed for the first version.
> 4. **Origin:** this machine's tailnet name, port **8443** locally and on the tailnet (`https://<machine>.ts.net:8443/`).
>
> Sections 9 and 12 below are kept as the original reasoning.

---

## 1. The problem

[T3 Loupe](https://github.com/AmbitiousRealism2025/t3-loupe) shows what every T3 Code thread is doing, across all paired machines, in the Omarchy bar. It answers the questions that matter while agents run: which thread needs you, what each one is doing, and how close you are to usage limits.

That answer only exists at the desk. Agents block on an approval or a question and then sit idle until you're back at the keyboard. From the sofa, the car or a coffee shop, there's no glanceable way to see that something is waiting.

## 2. The proposal

Build **T3 Pocket Loupe**: a small companion web app, served from the Omarchy machine that already runs T3 Loupe, and installed on the iPhone with **Add to Home Screen**.

- **One screen, at a glance.** Needs you, Working and Done, across every machine T3 Loupe is paired with. Tap a thread for its live detail.
- **Read-only.** It shows; it never acts. Approvals are still answered in T3 itself.
- **Tailnet only.** It's reachable from devices on your Tailscale network and nowhere else: no T3 Connect, no cloud relay, no public URL.
- **No new secrets.** T3 tokens stay on the desktop, exactly where T3 Loupe keeps them today. The phone only ever receives display data.

It's built to the conventions of **[nixweb.app](https://github.com/nixfred/nixweb.app)** by Fred Nix: "the standard for building iPhone apps as web apps, for people who live on Omarchy". That covers a template, the 105-rule NixWeb Standard 1.0, and a checker (`nixweb check`) that tests 87 of those rules automatically. nixweb.app was written for exactly this kind of plugin companion; its own ideas list ranks a phone "attention queue" for waiting agents as the most valuable app to build.

## 3. Goals and non-goals

**Goals**

1. See what needs you, and for how long, within two seconds of opening the app.
2. Cover every paired machine in one list, including machines reached through an SSH tunnel.
3. Show a thread's live detail on tap: current activity, the pending approval or question, plan progress, recent runs, context, PR and subagents.
4. Keep working sensibly with a sleeping host or no network: last-known state, clearly marked as stale.
5. Meet NixWeb Standard Level 2, "Dependable", as measured by `nixweb check`.
6. Leave the marketplace-verified T3 Loupe plugin untouched.

**Non-goals for the first version**

- Answering approvals, sending prompts, or anything else that writes. T3's own mobile and web clients already do that, with T3's authentication.
- Access from outside the tailnet (Tailscale Funnel, a public tunnel, a login system).
- Push notifications. This is a candidate for later; see section 10.
- Android-specific work. It should work there, but the iPhone is the target.

## 4. Where it fits

| | What it is | What it does on the phone |
|---|---|---|
| **T3 Loupe** (plugin) | The Omarchy bar widget and panel. Listed and verified on the [Omarchy plugin marketplace](https://plugins.omarchy.org/plugin.html?id=ambitiousrealism.t3-loupe). | Nothing; it's a desktop UI. |
| **T3 Code's own clients** | The T3 mobile app and the hosted web client, `app.t3.codes`. They can reach this machine's T3 over the same tailnet, and optionally through T3 Connect, T3's cloud relay. | The full client: one environment at a time, able to answer approvals. It needs a T3 pairing on the phone. |
| **T3 Pocket Loupe** (this proposal) | A companion server next to T3 Loupe, plus a home-screen web app. | The read-only overview of *every* machine in one list, with no secrets on the phone and no cloud account. |

Pocket Loupe isn't a replacement for T3's own mobile client; it's the overview you check first. When something needs an answer, you open T3.

## 5. Architecture

```
 Omarchy machine                                                      iPhone
 ┌──────────────────────────────────────────────────────────────┐
 │ T3 Loupe collector              Pocket Loupe server          │
 │ (node daemon/main.ts run)  ───▶ 127.0.0.1:<port>             │
 │  · paired T3 servers            · /api/state, /api/thread/…  │
 │  · tokens stay here             · serves the web app         │
 │                                         │                    │
 │                         tailscale serve --https=8443         │   tailnet    ┌────────────────┐
 │                                         └───────────────────────────────────▶│ Home-screen app │
 └──────────────────────────────────────────────────────────────┘    (HTTPS)   └────────────────┘
```

**Where the data comes from.** The Pocket Loupe server starts its **own instance of T3 Loupe's collector**, `node <plugin>/daemon/main.ts run`, and reads the same NDJSON stream the Omarchy shell reads:

- `state` lines: every environment's health, the ranked thread rows, counts and usage limits;
- `detail` lines: activity, pending requests, runs, context, subagents and plan for one thread, sent in reply to a `{"cmd":"detail"}` request written to the collector's stdin;
- `notice` lines: needs input, run failed, and so on. These are ignored in the first version and kept for possible push later.

This means **no change to the T3 Loupe plugin**, so its verified marketplace listing isn't touched. The collector already enforces the security work done for the marketplace review: read-only sessions, a pinned identity check before every token use, and loopback-ownership checks. The cost is a second set of read-only connections to each T3 server, which is negligible.

**Option kept open.** If running two collectors ever becomes a problem, T3 Loupe could later publish its state over a local socket that the companion reads. That would be a plugin change, with its own release and re-verification, and it isn't needed now.

**Serving.** The server binds `127.0.0.1` only (NixWeb rules NW-NET-001 and -002). `tailscale serve --bg --https=8443 http://127.0.0.1:8443` puts tailnet-only HTTPS in front of it, using nixweb's convention of the same port number locally and on the tailnet. Port **8443** keeps clear of the existing tailnet mapping on 443, which T3 itself uses. As of 13 October 2026 it's free both locally and on the tailnet. `tailscale funnel` is never used (NW-NET-003). A systemd user unit keeps the server running across reboots.

**One-time choice:** an installed home-screen app is bound to its origin. Pick the host name and port before installing on the phone, because changing either later creates a new app.

## 6. The phone app

**Main screen**
- A header with the same summary as the panel: "4 need you · 6 working · 2 machines". Each machine shows a health dot.
- **Needs you:** the thread title, its project and machine, what it's waiting for (command approval, question, plan ready, failure) and for how long.
- **Working:** the title and current activity, using T3's own activity icons, with the elapsed time.
- **Done:** recently finished threads, newest first, with idle threads folded away as in the panel.
- A clearly visible "last updated" time, which becomes a stale banner when the host or the network is gone.

**Thread detail** (on tap)
- The pending approval with its exact command text and the options T3 offered, or the question, with a note that answers happen in T3.
- Recent activity, plan progress, a runs chart, context and cost, PR number and checks, and subagents.

**Look and feel**
- It follows the active Omarchy theme where practical. Colours come from T3 Loupe's palette logic (`lib/Palette.js`), with the same colour budget as the panel: needs you, working and done-unseen.
- It handles safe areas, dark and light modes, Dynamic Type, and VoiceOver labels (NixWeb shell, layout and accessibility rules).
- The icon is the T3 Loupe ring.

**Updates while open:** a live stream of state changes (server-sent events), falling back to polling with request timeouts. When iOS suspends the app in the background, it refreshes on return to the foreground.

## 7. API

All responses are JSON, read-only, and contain display fields only. They never include tokens, URLs with credentials, or raw T3 payloads.

| Route | Returns |
|---|---|
| `GET /api/state` | The latest collector `state`: environments (label, health, last live time), rows (the ranked threads with display fields), counts, usage limits, plus the time the server last heard from the collector. |
| `GET /api/thread/:envId/:threadId` | The thread's latest `detail`, requesting it from the collector if needed, with a timeout. |
| `GET /api/events` | A server-sent event stream of state changes, for the open app. |
| `GET /healthz` | Liveness for the server and the collector. |

Writes aren't part of the first version. If one is ever added, it follows nixweb.app's "reads are free, writes confirm" rules (NW-UIX-001, NW-DAT-001, NW-DAT-002).

## 8. Security and privacy

**The tailnet is the lock.** Per the NixWeb security model, a tailnet-only personal app has no login. That holds only while nothing binds beyond loopback and nothing uses Funnel. The template's guards apply: loopback bind; only the public folder is served, with dotfiles refused; host-name checks against DNS rebinding (NW-SEC-003); cross-site writes refused (NW-SEC-004); no CORS; a strict Content-Security-Policy; no third-party scripts; `textContent`, never `innerHTML`; and no secrets in served files.

**What the phone can see.** Thread titles, projects, machine names and approval command text. That's the point of the app, and it's private work data. Because the app has no login of its own, **any device on the tailnet can see it.**

- **Personal tailnet (the expected case):** that's acceptable.
- **Shared tailnet:** use a setting that shows only generic labels, the same approach T3 Loupe now uses for notifications. Or restrict the port with a Tailscale access rule (a grant) so only your own devices reach it.

**Process arguments.** The same rule as T3 Loupe: private text is never passed to another process as a command-line argument.

**Tokens.** They never leave the collector, so the phone holds nothing that could be replayed against T3.

## 9. Technology choice (open)

| | Node (TypeScript, no dependencies) | Python (standard library) |
|---|---|---|
| Fit with T3 Loupe | Same language and style as the collector it drives. | A second language in the project. |
| Fit with nixweb.app | The NixWeb server guards would be written from the standard. | Mirrors nixweb.app's own template server. |
| Checker | Accepted (`server.ts`), but the checker won't start it: we run the server and use `nixweb check --target`. Three runtime checks (loopback socket, publish-only, SIGTERM) are then skipped and need our own tests. See [NIXWEB.md](NIXWEB.md) section 5. | Full coverage: the checker starts `server.py` itself. |
| Runtime | Node 22.18+ is already required by T3 Loupe. | Python 3 is present on Omarchy. |

**Recommendation: Node**, if one language across the T3 Loupe projects matters most. It drives the collector natively and adds no new runtime, at the cost of three checks we test ourselves. Python is the better choice if full checker coverage matters more. [NIXWEB.md](NIXWEB.md) has the details.

**Licensing note.** At the time of writing, the nixweb.app repository has **no license file**, so by default its code is all rights reserved. Following the standard and running its checker is fine; **copying the template's `server.py`, `app.js` or `sw.js` is not**, unless Fred Nix adds a license or gives permission. Asking him is a sensible first step, since the project is clearly meant to be built on.

## 10. Plan

| Milestone | Scope | Done when |
|---|---|---|
| **0 · Groundwork** | Ask about a nixweb.app license. Choose Node or Python. Pick the host name and port. | Decisions recorded here. |
| **1 · Read path** | The server spawns the collector, holds the latest state and serves `/api/state` and `/api/thread/...` on `127.0.0.1`. Tests run against T3 Loupe's fake T3 server. | `curl` on the machine shows live data; tests pass. |
| **2 · Phone app** | The main screen and thread detail, the manifest, icons, the offline shell and the stale banner. | Installed on the iPhone over `tailscale serve`; a real phone shows live state. |
| **3 · Dependable** | Live updates, reconnect and update flow, the security headers and guards. `nixweb check` at Level 2. | No failing MUST rules at Level 2. |
| **4 · Polish** | Theme colours, VoiceOver pass, Dynamic Type, icon states. Run the manual device checklist. | The device checklist is recorded. |
| **Later** | Web push for "needs you", with generic text. A home-screen badge. A local-socket feed from the plugin instead of a second collector. | Each decided separately. |

## 11. Risks

| Risk | Mitigation |
|---|---|
| Two collectors double the read-only connections to each T3 server. | Negligible for a personal setup. A shared local feed is the fallback (section 5). |
| The collector's NDJSON format changes in a T3 Loupe release. | It's versioned (`v` field). Pocket Loupe checks the version and says when it doesn't match. |
| Private text visible to every tailnet device. | The generic-label setting, or a Tailscale access rule (section 8). |
| iOS home-screen quirks: notch clipping, stale updates, background suspension. | The NixWeb rules exist for exactly these. Level 2 plus the device checklist. |
| Licensing of the nixweb.app template. | Write our own code, or get permission first (section 9). |
| Overlap with T3's own mobile client. | Keep Pocket Loupe read-only and focused on the cross-machine overview. |

## 12. Open questions

1. Node or Python for the server?
2. Is the tailnet personal, or shared with others? This decides the default privacy setting.
3. Which host name and port to commit to before the first install?
4. Should Pocket Loupe eventually live inside the T3 Loupe repository, or stay separate? Separate keeps the marketplace plugin small and its listing untouched.

## References

- nixweb.app, the template, standard and checker this builds on: https://github.com/nixfred/nixweb.app
- T3 Loupe: https://github.com/AmbitiousRealism2025/t3-loupe
- T3 Loupe on the Omarchy plugin marketplace: https://plugins.omarchy.org/plugin.html?id=ambitiousrealism.t3-loupe
- Tailscale Serve: https://tailscale.com/docs/features/tailscale-serve
- T3 Code remote access: the T3 Code Expert research corpus, `~/coding-projects/t3-code-expert/research/remote-connect.md`.
