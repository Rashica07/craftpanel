import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { HISTORY_RANGES, rangeFor, type HistoryRange } from "../data/historyRanges";
import { Card, Segmented, StateBlock } from "./ui";
import { AreaChart } from "./AreaChart";
import { ErrorBanner } from "./ErrorBanner";

/**
 * RAM/CPU/TPS over time — from the background sampler in
 * `metrics_history.rs` (roughly one point per minute while the server was
 * running). This is the "figure out exactly when it crashed or why it was
 * lagging" view — the console's health strip only ever shows right now.
 */
export function ServerMetricsHistory({
  serverId,
  ramAllocatedMb,
}: {
  serverId: string;
  ramAllocatedMb: number;
}) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const [rows, setRows] = useState<
    { ts: number; ramMb: number | null; cpuPct: number | null; tps: number | null }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const r = rangeFor(range);
    const since = Math.floor(Date.now() / 1000) - r.spanSecs;
    api
      .metricsHistory(serverId, since)
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [serverId, range]);

  useEffect(() => {
    setRows(null);
    load();
  }, [load]);

  return (
    <Card
      title="Server performance"
      icon="gauge"
      description="Sampled about once a minute while the server's running — a slow drift in RAM or a TPS dip shows up here even after you've moved on."
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
      ) : !rows ? (
        <StateBlock state="loading" title="Reading history…" compact />
      ) : rows.length === 0 ? (
        <StateBlock
          state="empty"
          icon="gauge"
          title="No samples yet"
          message="Samples are collected roughly once a minute while this server is running — give it a bit."
          compact
        />
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-2xs font-medium text-ink-dim">Memory</div>
            <AreaChart
              data={rows.map((r) => ({ ts: r.ts, value: r.ramMb }))}
              color="var(--color-accent)"
              yMax={ramAllocatedMb}
              formatValue={(v) => `${(v / 1024).toFixed(1)} GB`}
            />
          </div>
          <div>
            <div className="mb-1 text-2xs font-medium text-ink-dim">CPU</div>
            <AreaChart
              data={rows.map((r) => ({ ts: r.ts, value: r.cpuPct }))}
              color="var(--color-info)"
              formatValue={(v) => `${Math.round(v)}%`}
            />
          </div>
          <div>
            <div className="mb-1 text-2xs font-medium text-ink-dim">TPS</div>
            <AreaChart
              data={rows.map((r) => ({ ts: r.ts, value: r.tps }))}
              color="var(--color-ok)"
              yMax={20}
              formatValue={(v) => v.toFixed(1)}
              emptyMessage="No TPS data — needs RCON set up on this server."
            />
          </div>
        </div>
      )}
    </Card>
  );
}
