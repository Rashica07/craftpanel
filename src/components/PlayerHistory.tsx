import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { PlayerStat } from "../types";
import { HISTORY_RANGES, rangeFor, type HistoryRange } from "../data/historyRanges";
import { Badge, Card, IconButton, Segmented, SkeletonChart, SkeletonList, StateBlock } from "./ui";
import { AreaChart } from "./AreaChart";
import { ErrorBanner } from "./ErrorBanner";

/**
 * Concurrent-player-count over time — "when are my peak hours" — built from
 * the same join/leave log data `PlayerHistory` below already parses, just
 * aggregated differently (overlap count, not per-player totals).
 */
export function PlayerActivityChart({ serverId }: { serverId: string }) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const [points, setPoints] = useState<{ ts: number; value: number | null }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const r = rangeFor(range);
    const since = Math.floor(Date.now() / 1000) - r.spanSecs;
    api
      .playerActivity(serverId, since, r.bucketSecs)
      .then((rows) => {
        setPoints(rows.map((p) => ({ ts: p.ts, value: p.count })));
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [serverId, range]);

  useEffect(() => {
    setPoints(null);
    load();
  }, [load]);

  return (
    <Card
      title="Player activity"
      icon="activity"
      description="How many were on at once — spot your peak hours."
      right={
        <Segmented
          size="sm"
          value={range}
          onChange={setRange}
          options={HISTORY_RANGES.map((r) => ({ value: r.value, label: r.label }))}
        />
      }
    >
      {error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : !points ? (
        <div style={{ height: 90 }}>
          <SkeletonChart bars={28} />
        </div>
      ) : (
        <AreaChart
          data={points}
          color="var(--color-accent)"
          formatValue={(v) => `${Math.round(v)} player${Math.round(v) === 1 ? "" : "s"}`}
        />
      )}
    </Card>
  );
}

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
    <Card
      title="Player history"
      icon="clock"
      description="Everyone who has ever joined, and how long they stayed."
      right={
        <IconButton icon="refresh" title="Refresh" size="sm" onClick={load} />
      }
    >

      {error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : !rows ? (
        <SkeletonList
          rows={4}
          listClassName="space-y-1"
          rowClassName="rounded-md bg-surface-2 px-2 py-1.5"
          iconClassName="h-3.5 w-16 rounded"
        />
      ) : rows.length === 0 ? (
        <StateBlock
          state="empty"
          icon="clock"
          title="No joins yet"
          message="Player history is built from logs/ — it fills in once someone's connected."
          compact
        />
      ) : (
        <ul className="space-y-1">
          {rows.map((p) => (
            <li key={p.name} className="rounded-md bg-surface-2">
              <button
                onClick={() => setOpen(open === p.name ? null : p.name)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm"
              >
                <span className="flex-1 truncate">{p.name}</span>
                {p.online && <Badge tone="ok">online</Badge>}
                <span className="text-2xs text-ink-faint">{dur(p.totalSecs)} played</span>
                <span className="text-2xs text-ink-faint">· {when(p.lastSeen)}</span>
              </button>
              {open === p.name && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-line px-3 py-2 text-2xs text-ink-dim">
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
      <p className="mt-1.5 text-2xs text-ink-faint">
        Built from <code>logs/</code> — names only (offline-mode safe).
      </p>
    </Card>
  );
}
