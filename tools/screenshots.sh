#!/usr/bin/env bash
# Screenshots at iPhone size from demo data; see tools/screenshots.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --disable-warning=ExperimentalWarning tools/screenshots.mjs "$@"
