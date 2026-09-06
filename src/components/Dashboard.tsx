import { useEffect, useState } from "react";
import { api } from "../api";
import { STATUS_TONE } from "../App";
import { usePremium } from "../PremiumContext";
import type { ProcSnapshot, ServerRecord, SystemInfo } from "../types";
import { Badge, Button, StatusDot, toast } from "./ui";
import { Icon } from "./Icon";

type BulkAction = "start" | "stop" | "backup";

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
  const { active: premiumActive } = usePremium();
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<BulkAction | null>(null);

  useEffect(() => {
    api.systemInfo().then(setSys).catch(() => {});
  }, []);

  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Bypasses the onStart/onStop props (typed to return void, since the
  // per-row toggle button never needed to await them) and calls the API
  // directly instead — a bulk action needs to know per-server success or
  // failure to report one honest summary, not fire-and-forget N times.
  async function runBulk(action: BulkAction) {
    const ids = [...selected];
    setBulkBusy(action);
    const results = await Promise.allSettled(
      ids.map((id) => {
        if (action === "start") return api.startServer(id);
        if (action === "stop") return api.stopServer(id);
        return api.backupNow(id, "bulk");
      }),
    );
    setBulkBusy(null);
    const failed = results.filter((r) => r.status === "rejected").length;
    const ok = results.length - failed;
    const verb = action === "backup" ? "backed up" : `${action}ed`;
    if (failed === 0) {
      toast.ok(`${ok} server${ok === 1 ? "" : "s"} ${verb}`);
      if (action !== "backup") setSelected(new Set());
    } else {
      toast.bad(`${ok} ${verb}, ${failed} failed`, "Open each server to see why.");
    }
  }

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

        {premiumActive && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-accent-line bg-accent-muted px-4 py-2.5">
            <Badge tone="accent" icon="crown" size="sm">
              Premium
            </Badge>
            <span className="text-sm text-ink">{selected.size} selected</span>
            <span className="flex-1" />
            <Button size="sm" variant="secondary" loading={bulkBusy === "start"} onClick={() => runBulk("start")}>
              Start
            </Button>
            <Button size="sm" variant="secondary" loading={bulkBusy === "stop"} onClick={() => runBulk("stop")}>
              Stop
            </Button>
            <Button size="sm" variant="secondary" loading={bulkBusy === "backup"} onClick={() => runBulk("backup")}>
              Back up
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}

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
                {premiumActive && (
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSelect(s.id)}
                    className="accent-accent"
                    aria-label={`Select ${s.name} for a bulk action`}
                  />
                )}
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
