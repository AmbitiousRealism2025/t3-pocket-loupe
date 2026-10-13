# Changelog

## 0.1.0 (2026-10-12)

First release. The app shell reports `pl-0.1.1` (the service-worker `VERSION`, bumped once during the build).

- Node server (`server.ts`, no dependencies) that runs T3 Loupe's collector and serves a read-only API on `127.0.0.1:8443`: `/api/state`, `/api/thread/:env/:thread`, `/api/events` (server-sent events), `/api/theme`, `/ping`, `/healthz`.
- Every API field is picked by name; tokens, T3 URLs, worktree paths and host labels never leave the server.
- Guards from the NixWeb Standard: Host allowlist, cross-site write refusal, strict CSP and companion headers, publish-only static serving with traversal and symlink protection, ETag, gzip and byte ranges, request bounds.
- Phone app: Needs you / Working / Done in T3 Loupe's own order, machine chips and a machine sheet with usage windows, thread detail with the pending command or question, plan, activity, runs, context, PR and subagents. Loading, empty, error and stale states.
- Offline shell and last good state from the service worker, with a user-gated "Update ready".
- Colours from the host's Omarchy theme through T3 Loupe's palette.
- systemd user unit and `tailscale serve` on port 8443 (`tools/install-service.sh`).
