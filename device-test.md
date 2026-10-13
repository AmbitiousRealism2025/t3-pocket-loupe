# device-test.md: T3 Pocket Loupe on a real iPhone

**Filled in by a person holding the phone, never by an agent** (NixWeb rule NW-DOC-004). Leave a row blank until you've done it. HANDOFF.md says how to install and what each test means.

Device:
iOS:
Date:
Tester:
App version shown in the footer:

| Rule | What to do | Result (pass / fail / n/a) | Notes |
|---|---|---|---|
| NW-DEV-001 | Safari → Share → Add to Home Screen, "Open as Web App" on. It opens without browser bars, with the ring icon and its own App Switcher entry. | | |
| NW-DEV-002 | Stop the server (`systemctl --user stop t3-pocket-loupe`), force-quit the app, open it: the shell paints within about a second, shows the last data and says "host unreachable" with a Retry. Repeat with Tailscale off on the phone. | | |
| NW-DEV-003 | Portrait and landscape: the header, chips and footer clear the notch or Dynamic Island and the home indicator. (The app has no text inputs.) | | |
| NW-DEV-004 | With the app open, deploy a new version (bump `VERSION` in `public/sw.js`, restart the service), background and reopen: "Update ready" appears, one tap reloads once, the footer shows the new version. | | |
| NW-DEV-005 | Tap "Answer this in T3" and "Open pull request": note whether they open an in-app sheet or Safari, and that the app keeps its place. "Copy link" works. | | |
| NW-DEV-006 | No permission prompt ever appears (the app uses no notifications, camera, microphone or location). | | |
| NW-DEV-007 | n/a: the app sends no writes. | | |
| NW-UIX-002 | Loading (first open), empty ("Nothing running"), error (server stopped before first load: "Can't reach Pocket Loupe on the host" + Retry) and stale (banner with the age) each show. | | |
| NW-UIX-003 | Open a thread and a machine: the in-app Back returns to the list; an edge swipe (if iOS offers one) agrees and never exits the app. | | |
| NW-ACC-011 | Every button and row is comfortable to hit (44 px or more). | | |
| NW-DAT-004 | Delete and re-add the icon: nothing important is lost (everything lives on the host). Then open the URL in Safari first, install, and confirm the installed app doesn't depend on anything from that Safari visit (it keeps no settings; its only storage is the service-worker cache). | | |
| NW-NET-005 | The origin in the README is the one installed; a crt.sh search for the machine name shows nothing you mind being public. | | |
| NW-ACC-012 | VoiceOver on, Larger Text at maximum, Reduce Motion and Increase Contrast on: swipe through every screen; each control has a name and role; the "needs you" count change is announced; the stale banner is spoken. | | |
| NW-PER-004 | Optional (Level 3): LCP, INP and CLS measured with Safari Web Inspector on a Mac. | | |
| NW-NET-006 | Only if the tailnet is shared: a Tailscale grant limits who reaches port 8443. | | |
| NW-DAT-005 | n/a: the app has no offline writes. | | |
| NW-DEV-008 | Only if you claim Android: install from Chrome on Android and check DevTools → Application → Manifest. | | |
| NW-DEV-009 | Optional: leave an installed copy unused for 8–10 days, then open it offline; record what it kept. | | |
