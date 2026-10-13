#!/usr/bin/env bash
# Installs T3 Pocket Loupe as a systemd user service and publishes it on the tailnet.
#
#   tools/install-service.sh              preflight, write the unit, enable and start it, verify
#   tools/install-service.sh --uninstall  stop and disable it (which drops the tailnet mapping), remove the unit
#
# The unit runs `server.ts --port 8443` on 127.0.0.1 and owns one `tailscale serve` mapping:
# tailnet HTTPS 8443 → http://127.0.0.1:8443. It never touches other ports or Funnel, and it
# never uses sudo. Set POCKET_LOUPE_NODE to choose the Node binary.
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$(pwd -P)
unit_name=t3-pocket-loupe.service
unit_dir="$HOME/.config/systemd/user"
unit="$unit_dir/$unit_name"
port=8443
target="http://127.0.0.1:$port"

say() { printf 'install-service: %s\n' "$*"; }
die() { printf 'install-service: %s\n' "$*" >&2; exit 1; }

tailscale_bin=$(command -v tailscale || true)
[ -n "$tailscale_bin" ] || die "tailscale is not installed"
for tool in ss curl systemctl; do command -v "$tool" >/dev/null || die "$tool is required"; done

# The serve configuration as JSON; refuses to guess when tailscaled can't be asked.
serve_status() {
  local out
  out=$("$tailscale_bin" serve status --json 2>/dev/null) || die "can't read 'tailscale serve status' (is tailscaled running and logged in?)"
  printf '%s' "${out:-{\}}"
}
# "free", "ours" (8443 → our loopback port, nothing else) or "other", from serve status JSON on stdin.
mapping_of() {
  "$1" -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j = {}; try { j = JSON.parse(s || "{}"); } catch {}
      const tcp = j.TCP || {}, web = j.Web || {};
      if (!tcp["8443"]) return console.log("free");
      const site = Object.entries(web).find(([k]) => k.endsWith(":8443"));
      const proxy = site?.[1]?.Handlers?.["/"]?.Proxy;
      const ok = tcp["8443"].HTTPS && proxy === "http://127.0.0.1:8443" && Object.keys(site[1].Handlers).length === 1;
      console.log(ok ? "ours" : "other");
    });'
}

if [ "${1:-}" = "--uninstall" ]; then
  systemctl --user disable --now "$unit_name" 2>/dev/null || true
  rm -f "$unit"
  systemctl --user daemon-reload
  # Normally the unit's ExecStopPost removed the mapping. If it didn't (the unit was already
  # stopped, or tailscale was down when it stopped), remove ours, and only ours.
  node_any=$(command -v node || true)
  if [ -n "$node_any" ] && [ "$(serve_status | mapping_of "$node_any")" = "ours" ]; then
    "$tailscale_bin" serve --https="$port" off
  fi
  say "removed $unit_name; tailscale serve status:"
  "$tailscale_bin" serve status
  exit 0
fi

# ---- preflight ---------------------------------------------------------------
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; }
pick_node() {
  if [ -n "${POCKET_LOUPE_NODE:-}" ]; then echo "$POCKET_LOUPE_NODE"; return; fi
  local n
  n=$(mise which node 2>/dev/null || true)
  if [ -n "$n" ] && node_ok "$n"; then readlink -f "$n"; return; fi
  for n in $(ls -d "$HOME"/.local/share/mise/installs/node/[0-9]*.[0-9]*.[0-9]* 2>/dev/null | sort -V -r); do
    if [ -x "$n/bin/node" ] && node_ok "$n/bin/node"; then readlink -f "$n/bin/node"; return; fi
  done
  for n in /usr/bin/node /usr/local/bin/node "$(command -v node || true)"; do
    if [ -n "$n" ] && [ -x "$n" ] && node_ok "$n"; then readlink -f "$n"; return; fi
  done
}
node_bin=$(pick_node)
[ -n "$node_bin" ] && [ -x "$node_bin" ] && node_ok "$node_bin" || die "no Node 22.18+ found (set POCKET_LOUPE_NODE)"
say "node: $("$node_bin" --version)"

collector="${POCKET_LOUPE_COLLECTOR:-$HOME/.config/omarchy/plugins/ambitiousrealism.t3-loupe/daemon/main.ts}"
[ -f "$collector" ] || die "T3 Loupe's collector isn't installed ($collector)"

active=$(systemctl --user is-active "$unit_name" 2>/dev/null || true)
if ss -ltnH "sport = :$port" 2>/dev/null | grep -q LISTEN && [ "$active" != "active" ]; then
  die "port $port is already in use on this machine by something else"
fi

serve_json=$(serve_status)
mapping=$(printf '%s' "$serve_json" | mapping_of "$node_bin")
case "$mapping" in
  free) say "tailnet port $port is free" ;;
  ours) say "tailnet port $port already maps to $target" ;;
  *) die "tailnet port $port is already used by another mapping; refusing to touch it" ;;
esac
before_443=$(printf '%s' "$serve_json" | "$node_bin" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j={};try{j=JSON.parse(s||"{}")}catch{};const w=Object.entries(j.Web||{}).filter(([k])=>k.endsWith(":443"));console.log(JSON.stringify(w.map(([,v])=>v)))})')

# ---- the unit ---------------------------------------------------------------
mkdir -p "$unit_dir"
cat >"$unit" <<UNIT
[Unit]
Description=T3 Pocket Loupe (read-only T3 Loupe view for the phone, tailnet only)
Documentation=https://github.com/AmbitiousRealism2025/t3-pocket-loupe
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$repo
ExecStart=$node_bin --disable-warning=ExperimentalWarning $repo/server.ts --port $port
ExecStartPost=$tailscale_bin serve --bg --https=$port $target
ExecStopPost=$tailscale_bin serve --https=$port off
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=default.target
UNIT
say "wrote $unit"

systemctl --user daemon-reload
systemctl --user enable "$unit_name" >/dev/null 2>&1
systemctl --user restart "$unit_name"

# ---- verify -------------------------------------------------------------------
for _ in $(seq 1 50); do curl -fsS -o /dev/null "$target/ping" 2>/dev/null && break; sleep 0.2; done
curl -fsS -o /dev/null "$target/ping" || die "the server doesn't answer on $target/ping (journalctl --user -u $unit_name)"
say "local: $target/ping answers"
for _ in $(seq 1 25); do serve_status | grep -q '"8443"' && break; sleep 0.2; done
after_443=$(serve_status | "$node_bin" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j={};try{j=JSON.parse(s||"{}")}catch{};const w=Object.entries(j.Web||{}).filter(([k])=>k.endsWith(":443"));console.log(JSON.stringify(w.map(([,v])=>v)))})')
[ "$before_443" = "$after_443" ] || die "the 443 mapping changed; this should never happen"
say "443 mapping unchanged"
"$tailscale_bin" serve status
say "done. Check the tailnet edge with: tools/nixweb-check.sh --target $target --url https://<this machine's tailnet name>:$port"
