import { useEffect, useState } from "react";
import { api } from "../api";
import { STATUS_TONE } from "../App";
import type { ProcSnapshot, ServerRecord, SystemInfo } from "../types";
import { Badge, Button, StatusDot } from "./ui";
import { Icon } from "./Icon";

/** The landing view once you've got servers — an at-a-glance "does
 * anything need me right now" before drilling into any one server, plus
 * how much of the machine they're actually using between them. */
export function Dashboard({
  servers,
  runtimes,
  onOpen,
  onStart,
  onStop,
}: {
  servers: ServerRecord[];
  runtimes: Record<string, ProcSnapshot>;
  onOpen: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
}) {
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api.systemInfo().then(setSys).catch(() => {});
  }, []);

  const running = servers.filter((s) => runtimes[s.id]?.status === "running");
  const needsAttention = servers.filter((s) =>
    ["crashed"].includes(runtimes[s.id]?.status ?? ""),
  );
  const usedRamMb = running.reduce((sum, s) => sum + s.ram_mb, 0);
  const totalRamMb = sys?.total_ram_mb ?? 0;
  const ramPct = totalRamMb ? Math.min(100, Math.round((usedRamMb / totalRamMb) * 100)) : 0;

  async function toggle(s: ServerRecord) {
    setBusyId(s.id);
    try {
      if (runtimes[s.id]?.status === "running") await onStop(s.id);
      else await onStart(s.id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="cp-display text-2xl text-ink">Overview</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {running.length} of {servers.length} server{servers.length === 1 ? "" : "s"} running
          </p>
        </div>

        {needsAttention.length > 0 && (
          <div className="rounded-xl border border-bad-line bg-bad-muted px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-bad">
              <Icon name="alert-triangle" size={15} />
              {needsAttention.length === 1
                ? `${needsAttention[0].name} crashed`
                : `${needsAttention.length} servers crashed`}
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-line-soft bg-surface p-4">
            <div className="text-2xs font-medium uppercase tracking-wide text-ink-faint">Servers</div>
            <div className="mt-1.5 text-2xl font-semibold text-ink tabular-nums">{servers.length}</div>
          </div>
          <div className="rounded-xl border border-line-soft bg-surface p-4">
            <div className="text-2xs font-medium uppercase tracking-wide text-ink-faint">Running</div>
            <div className="mt-1.5 text-2xl font-semibold text-ok tabular-nums">{running.length}</div>
          </div>
          <div className="rounded-xl border border-line-soft bg-surface p-4">
            <div className="text-2xs font-medium uppercase tracking-wide text-ink-faint">
              Memory allocated
            </div>
            <div className="mt-1.5 text-2xl font-semibold text-ink tabular-nums">
              {(usedRamMb / 1024).toFixed(1)} <span className="text-sm text-ink-faint">GB</span>
            </div>
            {totalRamMb > 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${ramPct}%` }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {servers.map((s) => {
            const status = runtimes[s.id]?.status ?? "stopped";
            const tone = STATUS_TONE[status];
            return (
              <button
                key={s.id}
                onClick={() => onOpen(s.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-line-soft bg-surface px-4 py-3 text-left transition-colors hover:border-line"
              >
                <StatusDot tone={tone} live={tone === "ok"} size={9} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{s.name}</div>
                  <div className="text-2xs text-ink-faint">
                    {s.server_type}
                    {s.mc_version ? ` · ${s.mc_version}` : ""} · {(s.ram_mb / 1024).toFixed(1)} GB
                  </div>
                </div>
                <Badge tone={tone}>{status}</Badge>
                <Button
                  variant={status === "running" ? "danger" : "secondary"}
                  size="sm"
                  loading={busyId === s.id}
                  disabled={status === "starting" || status === "stopping"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(s);
                  }}
                >
                  {status === "running" ? "Stop" : "Start"}
                </Button>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
