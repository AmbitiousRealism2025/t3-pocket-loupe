// This machine's own tailnet identity, for the Host allowlist (NW-SEC-003).
// Read from `tailscale status --json` with fixed arguments: nothing private goes into argv.
import { execFile } from "node:child_process";

export interface Tailnet {
  /** MagicDNS name without the trailing dot, lower case, or null when Tailscale isn't running. */
  name: string | null;
  /** Tailscale addresses (100.x.y.z and fd7a:…). */
  ips: string[];
}

const EMPTY: Tailnet = { name: null, ips: [] };

export function parseStatus(json: string): Tailnet {
  let data: any;
  try { data = JSON.parse(json); } catch { return EMPTY; }
  const self = data?.Self;
  if (!self || typeof self !== "object") return EMPTY;
  const raw = typeof self.DNSName === "string" ? self.DNSName.trim().toLowerCase().replace(/\.$/, "") : "";
  const name = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(raw) ? raw : null;
  const ips = Array.isArray(self.TailscaleIPs)
    ? self.TailscaleIPs.filter((ip: unknown): ip is string => typeof ip === "string" && /^[0-9a-f.:]{3,45}$/i.test(ip)).map((ip: string) => ip.toLowerCase())
    : [];
  return { name, ips };
}

export function readTailnet(bin = process.env.POCKET_LOUPE_TAILSCALE || "tailscale", timeoutMs = 3000): Promise<Tailnet> {
  return new Promise((resolve) => {
    execFile(bin, ["status", "--json", "--peers=false"], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? EMPTY : parseStatus(stdout));
    });
  });
}
