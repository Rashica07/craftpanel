// Thin client for the desktop CraftPanel's remote API (see
// `src-tauri/src/remote_api.rs` in the main app). No Tauri commands here —
// this is a plain `fetch()` client hitting the desktop app over the network
// (LAN or public IP, same path a Minecraft client itself would use), because
// the phone isn't the one running the server.

export interface Pairing {
  host: string;
  port: number;
  token: string;
}

export interface ServerSummary {
  id: string;
  name: string;
  server_type: string;
  mc_version: string | null;
  ram_mb: number;
  status: "stopped" | "starting" | "running" | "stopping" | "crashed";
  pid: number | null;
  started_at: number | null;
  needs_eula: boolean;
}

export interface LogLine {
  text: string;
  level: string;
}

export interface PlayerList {
  online: number;
  max: number;
  players: string[];
}

const KEY = "cp_pairing";

export function getPairing(): Pairing | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Pairing) : null;
  } catch {
    return null;
  }
}

export function setPairing(p: Pairing) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function clearPairing() {
  localStorage.removeItem(KEY);
}

/** Parses whatever a person pastes: the raw `{"host","port","token"}` JSON
 *  the desktop's QR/pairing screen hands out, or (defensively) the same
 *  fields typed in by hand. */
export function parsePairingPayload(raw: string): Pairing {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Paste the pairing code from CraftPanel's Settings first.");
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    throw new Error("That doesn't look like a pairing code — copy it from CraftPanel → Settings → Remote access.");
  }
  const o = obj as Record<string, unknown>;
  const host = typeof o.host === "string" ? o.host : null;
  const port = typeof o.port === "number" ? o.port : Number(o.port);
  const token = typeof o.token === "string" ? o.token : null;
  if (!host || !token || !Number.isFinite(port)) {
    throw new Error("That pairing code is missing a host, port, or token.");
  }
  return { host, port, token };
}

class ApiError extends Error {}

async function call<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const p = getPairing();
  if (!p) throw new ApiError("Not paired with a CraftPanel install yet.");

  let res: Response;
  try {
    res = await fetch(`http://${p.host}:${p.port}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${p.token}`,
        "Content-Type": "application/json",
        ...(opts.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      `Couldn't reach CraftPanel at ${p.host}:${p.port}. Make sure it's running and Remote access is on.`,
    );
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new ApiError("This token isn't valid anymore — pair again from CraftPanel.");
    throw new ApiError(typeof body.error === "string" ? body.error : `Request failed (${res.status}).`);
  }
  return body as T;
}

export const api = {
  listServers: () => call<{ servers: ServerSummary[] }>("/api/servers").then((r) => r.servers),
  getServer: (id: string) => call<ServerSummary>(`/api/servers/${id}`),
  start: (id: string) => call<ServerSummary>(`/api/servers/${id}/start`, { method: "POST" }),
  stop: (id: string) => call<{ ok: true }>(`/api/servers/${id}/stop`, { method: "POST" }),
  console: (id: string) => call<LogLine[]>(`/api/servers/${id}/console`),
  sendConsole: (id: string, line: string) =>
    call<{ ok: true }>(`/api/servers/${id}/console`, { method: "POST", body: JSON.stringify({ line }) }),
  players: (id: string) => call<PlayerList>(`/api/servers/${id}/players`),
};
