#!/usr/bin/env bash
# Runs the server in demo mode (synthetic data, no T3 needed) on a free or given port.
#   tools/dev.sh [port]
set -euo pipefail
cd "$(dirname "$0")/.."
port="${1:-0}"
exec node --disable-warning=ExperimentalWarning server.ts --demo --port "$port"
