import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Backup } from "../types";
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  ProgressBar,
  StateBlock,
  TextInput,
  Tooltip,
  cx,
  toast,
} from "./ui";
import { Icon } from "./Icon";

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
    <div className="cp-stagger h-full space-y-3 overflow-y-auto pr-1">
      <Card
        title="Make a backup"
        icon="archive"
        description="A zip of the whole server folder — worlds, configs and mods — minus logs and caches."
      >
        <div className="flex items-end gap-2">
          <Field
            label="Call it something (optional)"
            className="min-w-0 flex-1"
          >
            <TextInput
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="before the big build"
            />
          </Field>
          <Button
            variant="primary"
            icon="archive"
            className="mb-0.5"
            loading={busy}
            onClick={() =>
              guard(async () => {
                await api.backupNow(serverId, label);
                setLabel("");
                toast.ok("Backup saved");
              })
            }
          >
            Back up now
          </Button>
        </div>

        {locked && (
          <p className="mt-2 flex items-start gap-1.5 text-2xs leading-snug text-ink-faint">
            <Icon name="info" size={11} className="mt-px shrink-0" />
            The server is running. Backing up now works, but stopping it first
            guarantees the world is fully written to disk.
          </p>
        )}
        {progress && (
          <div className="mt-3 space-y-1.5">
            <ProgressBar indeterminate />
            <p className="text-2xs text-ink-faint">{progress}</p>
          </div>
        )}
      </Card>

      {error && (
        <Banner tone="bad" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      <Card
        title="Your backups"
        icon="clock"
        description="Kept in craftpanel-backups/ next to the server."
        right={
          <Tooltip label="Older backups past this count are deleted automatically. Pre-restore safety copies are always kept.">
            <label className="flex items-center gap-1.5 text-2xs text-ink-faint">
              Keep newest
              <TextInput
                type="number"
                min={0}
                value={keep}
                onChange={(e) => saveKeep(Number(e.target.value))}
                className="w-16 text-center tabular-nums"
              />
            </label>
          </Tooltip>
        }
        pad={false}
      >
        {!backups ? (
          <StateBlock state="loading" title="Looking for backups…" compact />
        ) : backups.length === 0 ? (
          <StateBlock
            state="empty"
            icon="archive"
            title="No backups yet"
            message="Make one before you install a big modpack — restoring takes one click."
            compact
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {backups.map((b) => (
              <li key={b.id} className="px-3.5 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-faint">
                    <Icon name="archive" size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">
                      {b.label ?? "Backup"}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-2xs text-ink-faint">
                      <span>{ago(b.createdAt)}</span>
                      <span className="text-ink-ghost">·</span>
                      <span className="tabular-nums">{size(b.sizeBytes)}</span>
                    </div>
                  </div>
                  <Badge tone={TRIGGER_META[b.trigger].tone}>
                    {TRIGGER_META[b.trigger].label}
                  </Badge>
                </div>

                {confirmRestore === b.id ? (
                  <div className="cp-in mt-2.5 rounded-lg border border-warn/30 bg-warn-muted p-3">
                    <p className="text-2xs leading-relaxed text-warn-soft">
                      This swaps your current server folder for the contents of
                      this backup. Before it does, CraftPanel takes a fresh
                      safety backup of what's there now — so nothing is lost
                      either way.
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        icon="rotate"
                        loading={busy}
                        onClick={() =>
                          guard(async () => {
                            await api.restoreBackup(serverId, b.id);
                            setConfirmRestore(null);
                            toast.ok("Restored");
                          })
                        }
                      >
                        Yes, restore it
                      </Button>
                      <Button
                        variant="quiet"
                        size="sm"
                        onClick={() => setConfirmRestore(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : confirmDelete === b.id ? (
                  <div className="cp-in mt-2.5 flex items-center gap-2 rounded-lg border border-bad/30 bg-bad-muted p-2.5">
                    <span className="flex-1 text-2xs text-bad-soft">
                      Delete this backup for good? This one really is permanent.
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      icon="trash"
                      disabled={busy}
                      onClick={() =>
                        guard(async () => {
                          await api.deleteBackup(serverId, b.id);
                          setConfirmDelete(null);
                          toast.show("Backup deleted");
                        })
                      }
                    >
                      Delete
                    </Button>
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Keep
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-1.5 pl-[42px]">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="rotate"
                      disabled={locked || busy}
                      title={locked ? "Stop the server first" : undefined}
                      onClick={() => {
                        setConfirmDelete(null);
                        setConfirmRestore(b.id);
                      }}
                    >
                      Restore
                    </Button>
                    <Button
                      variant="quiet"
                      size="sm"
                      icon="trash"
                      disabled={busy}
                      className={cx("hover:text-bad")}
                      onClick={() => {
                        setConfirmRestore(null);
                        setConfirmDelete(b.id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
