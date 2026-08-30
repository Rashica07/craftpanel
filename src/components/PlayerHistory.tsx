import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { PlayerStat } from "../types";
import { Badge, Button } from "./ui";
import { Icon } from "./Icon";

function dur(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m`;
  return `${secs}s`;
}

function when(unix: number) {
  if (!unix) return "—";
  const s = Math.floor(Date.now() / 1000 - unix);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  return new Date(unix * 1000).toLocaleDateString();
}

export function PlayerHistory({ serverId }: { serverId: string }) {
  const [rows, setRows] = useState<PlayerStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    api.playerHistory(serverId).then(setRows).catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    setOpen(null);
    load();
  }, [load]);

  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
          <Icon name="clock" size={13} /> Player history
        </span>
        <Button variant="ghost" onClick={load}>
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="text-xs text-ink-faint">{error}</div>
      ) : !rows ? (
        <div className="text-xs text-ink-faint">Reading logs…</div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-ink-faint">
          No joins found in the logs yet.
        </div>
      ) : (
        <ul className="space-y-1">
          {rows.map((p) => (
            <li key={p.name} className="rounded-md bg-panel-2">
              <button
                onClick={() => setOpen(open === p.name ? null : p.name)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm"
              >
                <span className="flex-1 truncate">{p.name}</span>
                {p.online && <Badge tone="ok">online</Badge>}
                <span className="text-[11px] text-ink-faint">{dur(p.totalSecs)} played</span>
                <span className="text-[11px] text-ink-faint">· {when(p.lastSeen)}</span>
              </button>
              {open === p.name && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-edge px-3 py-2 text-[11px] text-ink-dim">
                  <span>First seen</span>
                  <span className="text-right">{when(p.firstSeen)}</span>
                  <span>Last seen</span>
                  <span className="text-right">{when(p.lastSeen)}</span>
                  <span>Sessions</span>
                  <span className="text-right">{p.sessions}</span>
                  <span>Total playtime</span>
                  <span className="text-right">{dur(p.totalSecs)}</span>
                  {p.lastIp && (
                    <>
                      <span>Last IP</span>
                      <span className="text-right font-mono">{p.lastIp}</span>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[11px] text-ink-faint">
        Built from <code>logs/</code> — names only (offline-mode safe).
      </p>
    </div>
  );
}
