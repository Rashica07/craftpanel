/**
 * Local-machine facts for the /status command: public IP and any active
 * network tunnel. Both are best-effort and never throw.
 *
 * Tunnel discovery: CraftPanel's `tunnel.rs` keeps the `bore.pub:PORT` address
 * in memory only, so there's no file to read while the app is closed. When the
 * app is running it exposes the address in its state; a future Remote API
 * endpoint would be the clean source. Until then we read an optional
 * `tunnels.json` from the app's config dir (written by newer CraftPanel builds)
 * and fall back to "none detected".
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const IP_TIMEOUT_MS = 4_000;

export async function getPublicIp(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IP_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.ipify.org", { signal: controller.signal });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    // very light sanity check — ipv4 or ipv6-ish
    return /^[0-9a-f.:]+$/i.test(text) && text.length >= 7 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function panelConfigDir(): string {
  const id = "com.craftpanel.app";
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", id);
    case "win32":
      return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), id);
    default:
      return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), id);
  }
}

/** Returns tunnel addresses like `bore.pub:38561`, or [] if none are known. */
export function readTunnelAddresses(): string[] {
  for (const file of ["tunnels.json", "tunnel.json"]) {
    try {
      const raw = readFileSync(join(panelConfigDir(), file), "utf8");
      const parsed: unknown = JSON.parse(raw);
      const found = new Set<string>();
      const visit = (v: unknown): void => {
        if (typeof v === "string") {
          if (/^[a-z0-9.-]+:\d{2,5}$/i.test(v.trim())) found.add(v.trim());
        } else if (Array.isArray(v)) {
          v.forEach(visit);
        } else if (v && typeof v === "object") {
          Object.values(v).forEach(visit);
        }
      };
      visit(parsed);
      if (found.size) return [...found];
    } catch {
      // try the next filename
    }
  }
  return [];
}

/** "2h 14m" style uptime from a unix-seconds start time. */
export function formatUptime(startedAtSec: number | null | undefined): string {
  if (!startedAtSec) return "—";
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - startedAtSec));
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
