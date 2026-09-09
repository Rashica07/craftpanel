/**
 * Thin bridge to CraftPanel's local Remote API (`remote_api.rs`, port 8642 by
 * default). REST, bearer-token, polled — same shape the desktop frontend and
 * the Android app already use.
 *
 * Every method returns a Result-ish object and NEVER throws: the panel might be
 * closed, mid-restart, or on a laptop that's currently asleep, and none of that
 * should crash the bot or bubble up as an unhandled rejection.
 */
import { config } from "../config.js";

export type PanelResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Shape of a server row from `GET /api/servers` (see `remote_api.rs::summarize`). */
export interface PanelServer {
  id: string;
  name: string;
  server_type?: string; // "vanilla" | "paper" | "fabric" | ...
  mc_version?: string | null;
  status: string; // "running" | "stopped" | "crashed" | "starting" | ...
  pid?: number | null;
  started_at?: number | null; // unix seconds; null unless running
  needs_eula?: boolean;
  port?: number; // not in the current Remote API payload — kept for forward-compat
}

const TIMEOUT_MS = 5_000;

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<PanelResult<T>> {
  if (!config.panel.token) {
    return { ok: false, error: "No Remote API token. Turn on the Remote API in CraftPanel → Settings, or set PANEL_TOKEN." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.panel.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.panel.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 401) return { ok: false, error: "Remote API rejected the token (401)." };
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Remote API returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
    }

    const data = (await res.json().catch(() => null)) as T | null;
    if (data === null) return { ok: false, error: "Remote API sent a response that wasn't JSON." };
    return { ok: true, data };
  } catch (err) {
    const e = err as Error;
    if (e.name === "AbortError") return { ok: false, error: `CraftPanel didn't answer within ${TIMEOUT_MS / 1000}s — is the app running?` };
    // ECONNREFUSED, DNS, offline, TLS — all land here.
    return { ok: false, error: `Couldn't reach CraftPanel at ${config.panel.url} (${e.message}).` };
  } finally {
    clearTimeout(timer);
  }
}

export const craftPanel = {
  async listServers(): Promise<PanelResult<PanelServer[]>> {
    const r = await call<{ servers: PanelServer[] }>("GET", "/api/servers");
    return r.ok ? { ok: true, data: r.data.servers ?? [] } : r;
  },

  getServer(id: string): Promise<PanelResult<PanelServer>> {
    return call<PanelServer>("GET", `/api/servers/${encodeURIComponent(id)}`);
  },

  startServer(id: string): Promise<PanelResult<unknown>> {
    return call("POST", `/api/servers/${encodeURIComponent(id)}/start`);
  },

  stopServer(id: string): Promise<PanelResult<unknown>> {
    return call("POST", `/api/servers/${encodeURIComponent(id)}/stop`);
  },

  sendConsole(id: string, line: string): Promise<PanelResult<unknown>> {
    return call("POST", `/api/servers/${encodeURIComponent(id)}/console`, { line });
  },
};

/** Resolve a user-typed name or id to a single server, or an explanatory error. */
export async function resolveServer(query: string): Promise<PanelResult<PanelServer>> {
  const list = await craftPanel.listServers();
  if (!list.ok) return list;

  const q = query.trim().toLowerCase();
  const byId = list.data.find((s) => s.id.toLowerCase() === q);
  if (byId) return { ok: true, data: byId };

  const byName = list.data.filter((s) => s.name.toLowerCase().includes(q));
  if (byName.length === 1) return { ok: true, data: byName[0]! };
  if (byName.length > 1) {
    return { ok: false, error: `"${query}" matches ${byName.length} servers: ${byName.map((s) => s.name).join(", ")}` };
  }
  return { ok: false, error: `No server matching "${query}".` };
}
