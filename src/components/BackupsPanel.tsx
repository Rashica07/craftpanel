import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Backup } from "../types";
import { Badge, Button } from "./ui";

function size(bytes: number) {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ago(unixSecs: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSecs));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TRIGGER_META: Record<Backup["trigger"], { label: string; tone: "neutral" | "warn" | "accent" }> = {
  manual: { label: "manual", tone: "neutral" },
  "pre-restore": { label: "pre-restore", tone: "warn" },
  scheduled: { label: "scheduled", tone: "accent" },
};

export function BackupsPanel({
  serverId,
  locked,
}: {
  serverId: string;
  locked: boolean;
}) {
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [keep, setKeep] = useState<number>(20);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const clearProgress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(() => {
    api.listBackups(serverId).then(setBackups).catch((e) => setError(String(e)));
    api.getBackupsConfig().then((c) => setKeep(c.keep)).catch(() => {});
  }, [serverId]);

  useEffect(() => {
    setError(null);
    setConfirmRestore(null);
    setConfirmDelete(null);
    load();
  }, [load]);

  useEffect(() => {
    let un: (() => void) | undefined;
    api
      .onBackupProgress((p) => {
        if (p.serverId !== serverId) return;
        setProgress(p.message);
        clearTimeout(clearProgress.current);
        clearProgress.current = setTimeout(() => setProgress(null), 4000);
      })
      .then((f) => (un = f));
    return () => {
      un?.();
      clearTimeout(clearProgress.current);
    };
  }, [serverId]);

  async function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function saveKeep(n: number) {
    const v = Math.max(0, Math.min(1000, Math.floor(n) || 0));
    setKeep(v);
    api.setBackupsKeep(v).catch((e) => setError(String(e)));
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto pr-1">
      <div className="rounded-lg border border-edge bg-panel p-3">
        <div className="flex items-end gap-2">
          <label className="flex-1 text-xs text-ink-dim">
            Label (optional)
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. before the big build"
              className="mt-1 w-full rounded border border-edge bg-panel-2 px-2 py-1 text-sm text-ink outline-none focus:border-accent"
            />
          </label>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              guard(async () => {
                await api.backupNow(serverId, label);
                setLabel("");
              })
            }
          >
            {busy ? "Working…" : "Back up now"}
          </Button>
        </div>
        {locked && (
          <p className="mt-2 text-[11px] text-ink-faint">
            The server is running — a backup now still works, but stopping it first
            guarantees a clean world save.
          </p>
        )}
        {progress && (
          <div className="mt-2 rounded bg-panel-2 px-2 py-1 text-xs text-ink-dim">
            {progress}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <span>Keep the newest</span>
        <input
          type="number"
          min={0}
          value={keep}
          onChange={(e) => saveKeep(Number(e.target.value))}
          className="w-16 rounded border border-edge bg-panel-2 px-1.5 py-0.5 text-center text-ink outline-none focus:border-accent"
        />
        <span>backups (0 = unlimited). Pre-restore backups are always kept.</span>
      </div>

      {error && (
        <div className="rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}

      <ul className="space-y-1.5">
        {backups?.map((b) => (
          <li key={b.id} className="rounded-md border border-edge bg-panel-2 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <div className="flex-1 truncate">
                {b.label ? (
                  <span className="text-ink">{b.label}</span>
                ) : (
                  <span className="text-ink-dim">Backup</span>
                )}
                <span className="ml-2 text-[11px] text-ink-faint">
                  {ago(b.createdAt)} · {size(b.sizeBytes)}
                </span>
              </div>
              <Badge tone={TRIGGER_META[b.trigger].tone}>{TRIGGER_META[b.trigger].label}</Badge>
            </div>

            {confirmRestore === b.id ? (
              <div className="mt-2 space-y-1.5 text-xs text-ink-dim">
                <p>
                  Restore this backup? The current folder is backed up and moved
                  aside first — nothing is deleted.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      guard(async () => {
                        await api.restoreBackup(serverId, b.id);
                        setConfirmRestore(null);
                      })
                    }
                  >
                    Restore
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmRestore(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : confirmDelete === b.id ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-ink-dim">
                <span>Delete this backup for good?</span>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    guard(async () => {
                      await api.deleteBackup(serverId, b.id);
                      setConfirmDelete(null);
                    })
                  }
                >
                  Delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="mt-1.5 flex gap-3 text-xs">
                <button
                  className="text-accent hover:underline disabled:opacity-40"
                  disabled={locked || busy}
                  title={locked ? "Stop the server first" : undefined}
                  onClick={() => {
                    setConfirmDelete(null);
                    setConfirmRestore(b.id);
                  }}
                >
                  Restore
                </button>
                <button
                  className="text-ink-faint hover:text-bad"
                  disabled={busy}
                  onClick={() => {
                    setConfirmRestore(null);
                    setConfirmDelete(b.id);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
        {backups && backups.length === 0 && (
          <li className="px-2 py-3 text-xs text-ink-faint">
            No backups yet. A backup is a zip of the whole server folder (worlds,
            configs, mods) minus logs and caches, stored in{" "}
            <code>craftpanel-backups/</code>.
          </li>
        )}
        {!backups && <li className="px-2 py-3 text-xs text-ink-faint">Loading…</li>}
      </ul>
    </div>
  );
}
