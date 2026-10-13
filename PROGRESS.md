# PROGRESS: T3 Pocket Loupe build

The memory of the `/goal` run. Updated after every step. Never write real host names, titles, labels or ids here: counts only.

## Current state

- **Milestone:** M0 (groundwork)
- **Next:** finish M0 and commit; then M1 (read path).

## Decisions made during the run

- `GOAL.md` is excluded from git with `REHYDRATE.md` (it's a T3 thread instruction, not project content).

## M0 · Groundwork

- [ ] `git log` has one commit
- [ ] `git ls-files` doesn't include REHYDRATE.md
- [ ] the privacy scan passes

## M1 · Read path

- [ ] `npm test` passes
- [ ] `curl` against a demo-mode server shows projected rows
- [ ] against the real collector (run mode, test port), `/api/state` shows `live` environments (counts only)
- [ ] the three Node-only tests pass
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

## Reviews

(none yet)

## Blocked

(nothing)

## Log

- 2026-10-12: read REHYDRATE.md, PLAN.md, PROPOSAL.md, NIXWEB.md, the nixweb STANDARD.md rules and `standard/check.py`. `git init -b main`, repo-local identity, `.git/info/exclude` (REHYDRATE.md, GOAL.md, private/). Moved PROPOSAL.md and NIXWEB.md to `docs/` and fixed links in PLAN.md and REHYDRATE.md.
