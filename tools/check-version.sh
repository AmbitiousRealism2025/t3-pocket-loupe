#!/usr/bin/env bash
# Fails if anything in public/ changed since the last commit (staged, unstaged or untracked)
# without a new VERSION in public/sw.js. Run before every commit (NW-OFF-002).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git rev-parse --verify -q HEAD >/dev/null; then echo "check-version: no commits yet"; exit 0; fi
changed=$( { git diff --name-only HEAD -- public/; git ls-files --others --exclude-standard -- public/; } | sort -u)
if [ -z "$changed" ]; then echo "check-version: public/ unchanged"; exit 0; fi
if [ ! -f public/sw.js ]; then echo "check-version: public/ changed; no sw.js yet, nothing to bump"; exit 0; fi

now=$(sed -nE "s/^const VERSION = '([^']+)';.*/\1/p" public/sw.js | head -1)
before=$(git show HEAD:public/sw.js 2>/dev/null | sed -nE "s/^const VERSION = '([^']+)';.*/\1/p" | head -1 || true)
if [ -z "$now" ]; then echo "check-version: FAIL no \"const VERSION = '…';\" line in public/sw.js" >&2; exit 1; fi
if [ "$now" = "$before" ]; then
  echo "check-version: FAIL public/ changed but VERSION is still $now. Changed:" >&2
  printf '  %s\n' $changed >&2
  exit 1
fi
echo "check-version: VERSION ${before:-(new)} → $now"
