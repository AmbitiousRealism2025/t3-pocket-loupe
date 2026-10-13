#!/usr/bin/env bash
# Pre-push privacy scan for a public repo.
#
# Scans what git would publish: every file in the index (tracked plus staged) and the
# commit messages. Fails on tailnet host names, home paths, tailnet addresses, UUIDs,
# token-shaped strings and the real T3 environment labels and ids, which it reads at
# scan time and never writes down. Reports file:line only, never the matched text.
#
#   tools/privacy-scan.sh            scan the index and the history's messages
#   PRIVACY_SCAN_NO_LABELS=1 …       skip the live label lookup (fails closed otherwise)
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
say() { printf 'privacy-scan: %s\n' "$*" >&2; }
flag() { say "FAIL $*"; fail=1; }

tmp=$(mktemp -d)
chmod 700 "$tmp"
trap 'rm -rf "$tmp"' EXIT

# --- 1. Patterns -------------------------------------------------------------
# Each pattern is written so that this file does not match itself.
declare -A PATTERNS=(
  ["tailnet host name"]='[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.ts\.net\b'
  ["home path"]='/home/[a-z_][a-z0-9_.-]*'
  ["macOS home path"]='/Users/[A-Za-z_][A-Za-z0-9_.-]*/'
  ["tailnet IPv4 address"]='\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}\b'
  ["tailnet IPv6 address"]='\bfd7a:115c:a1e0:'
  ["UUID"]='\b(?!00000000-0000-0000-0000-000000000000)[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b'
  ["GitHub token"]='\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}'
  ["API key"]='\b(sk|pk)-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}'
  ["JWT"]='\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  ["private key"]='-----BEGIN [A-Z ]*PRIVATE KEY-----'
  ["secret assignment"]='(?i)(token|secret|passw(or)?d|bearer|api[_-]?key)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9+/_.=-]{16,}["'"'"']'
  ["high-entropy string"]='\b(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{32,}\b'
)

for label in "${!PATTERNS[@]}"; do
  hits=$(git grep --cached -I -n -P -e "${PATTERNS[$label]}" -- . 2>/dev/null | cut -d: -f1,2 || true)
  if [ -n "$hits" ]; then
    while IFS= read -r h; do flag "$label at $h"; done <<<"$hits"
  fi
  if git rev-parse --verify -q HEAD >/dev/null; then
    if git log --format='%H%n%B' | grep -qP -e "${PATTERNS[$label]}"; then flag "$label in a commit message"; fi
  fi
done

# --- 2. Real environment labels and ids, read live, never written down --------
words="$tmp/words"
: >"$words"
collect() { # JSON on stdin → labels (>= 4 chars) and ids, one per line
  node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j; try { j = JSON.parse(s); } catch { process.exit(0); }
      for (const e of j.environments || []) {
        if (typeof e.label === "string" && e.label.trim().length >= 4) console.log(e.label.trim());
        if (typeof e.id === "string" && e.id.length >= 8) console.log(e.id);
      }
    });'
}
# a) a running Pocket Loupe service (labels and ids)
curl -fsS -m 3 -H 'Host: 127.0.0.1:8443' http://127.0.0.1:8443/api/state 2>/dev/null | collect >>"$words" || true
# b) the T3 Loupe collector's one-shot status (labels, no titles)
collector="${POCKET_LOUPE_COLLECTOR:-$HOME/.config/omarchy/plugins/ambitiousrealism.t3-loupe/daemon/main.ts}"
if [ -f "$collector" ]; then
  timeout 25 node --disable-warning=ExperimentalWarning "$collector" status 2>/dev/null </dev/null | collect >>"$words" || true
fi
sort -u -o "$words" "$words"
# Demo labels are fine to publish.
grep -vxF -e laptop -e build-box -e demo-laptop -e demo-server "$words" >"$words.real" || true

if [ -s "$words.real" ]; then
  n=0
  while IFS= read -r w; do
    n=$((n + 1))
    hits=$(git grep --cached -I -n -w -F -e "$w" -- . 2>/dev/null | cut -d: -f1,2 || true)
    if [ -n "$hits" ]; then
      while IFS= read -r h; do flag "real environment label or id #$n at $h"; done <<<"$hits"
    fi
    if git rev-parse --verify -q HEAD >/dev/null && git log --format='%B' | grep -qwF -e "$w"; then
      flag "real environment label or id #$n in a commit message"
    fi
  done <"$words.real"
  say "checked $(wc -l <"$words.real") real label(s) and id(s)"
elif [ "${PRIVACY_SCAN_NO_LABELS:-}" = "1" ]; then
  say "skipping the live label check (PRIVACY_SCAN_NO_LABELS=1)"
else
  flag "could not read the real environment labels (start T3 Loupe's collector, or set PRIVACY_SCAN_NO_LABELS=1)"
fi

# --- 3. Screenshots must come from demo mode ---------------------------------
manifest="docs/screens/manifest.txt"
pngs=$(git ls-files --cached -- 'docs/screens/*.png' 'docs/*.png' '*.png' | grep -v '^public/icons/' || true)
if [ -n "$pngs" ]; then
  if ! git cat-file -e ":$manifest" 2>/dev/null; then
    flag "PNG files are tracked but $manifest (written by tools/screenshots.sh) is not"
  else
    git cat-file blob ":$manifest" >"$tmp/manifest"
    grep -qx 'mode: demo' "$tmp/manifest" || flag "$manifest does not record demo mode"
    while IFS= read -r f; do
      sum=$(git cat-file blob ":$f" | sha256sum | cut -d' ' -f1)
      grep -q "^$sum  $(basename "$f")\$" "$tmp/manifest" || flag "$f is not a recorded demo-mode screenshot"
    done <<<"$pngs"
  fi
fi

files=$(git ls-files --cached | wc -l)
if [ "$fail" -ne 0 ]; then
  say "FAILED ($files files scanned)"
  exit 1
fi
say "passed ($files files scanned)"
