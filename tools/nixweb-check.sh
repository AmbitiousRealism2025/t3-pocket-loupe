#!/usr/bin/env bash
# Starts server.ts in demo mode on a free loopback port, runs `nixweb check` against it
# with --target, and stops it. nixweb can't start a Node server itself, so NW-NET-002,
# NW-SRV-005 and NW-SRV-010 report as not verified here; tests/node-only.test.mjs covers them.
#
#   tools/nixweb-check.sh [--level N] [--json] [--manual] [-v]     any nixweb check flags pass through
#   tools/nixweb-check.sh --target http://127.0.0.1:8443 --url …    check a server that's already running
set -euo pipefail
cd "$(dirname "$0")/.."
nixweb="${NIXWEB:-$HOME/coding-projects/nixweb.app/bin/nixweb}"
[ -x "$nixweb" ] || { echo "nixweb-check: nixweb not found at $nixweb (set NIXWEB)" >&2; exit 2; }

args=("$@")
has_level=0; has_target=0
for a in "${args[@]}"; do
  case "$a" in --level|--level=*) has_level=1 ;; --target|--target=*) has_target=1 ;; esac
done
[ "$has_level" = 1 ] || args=(--level 2 "${args[@]}")

if [ "$has_target" = 1 ]; then
  exec "$nixweb" check . "${args[@]}"
fi

log=$(mktemp)
node --disable-warning=ExperimentalWarning server.ts --demo --port 0 >"$log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -f "$log"' EXIT
port=""
for _ in $(seq 1 100); do
  port=$(sed -nE 's#.*listening on http://127\.0\.0\.1:([0-9]+).*#\1#p' "$log" | head -1)
  [ -n "$port" ] && break
  kill -0 "$pid" 2>/dev/null || { cat "$log" >&2; exit 2; }
  sleep 0.1
done
[ -n "$port" ] || { echo "nixweb-check: the server didn't start" >&2; cat "$log" >&2; exit 2; }
for _ in $(seq 1 50); do curl -fsS -o /dev/null "http://127.0.0.1:$port/ping" && break; sleep 0.1; done

set +e
"$nixweb" check . "${args[@]}" --target "http://127.0.0.1:$port"
code=$?
set -e
exit "$code"
