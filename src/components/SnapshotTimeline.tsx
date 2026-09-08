import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { usePremium } from "../PremiumContext";
import type { Snapshot } from "../types";
import { Badge, Button, Card, Modal, StateBlock, Tooltip, cx, toast } from "./ui";
import { Icon } from "./Icon";

function size(bytes: number) {
  if (bytes === 0) return "0 KB (linked)";
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ago(unix: number) {
  const s = Math.floor(Date.now() / 1000 - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d}d ago`;
  return new Date(unix * 1000).toLocaleDateString();
}

function clock(unix: number) {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A horizontal "Time Machine" scrubber — one tick per snapshot, newest on
 * the right. Click a tick to select it, then confirm to restore. Not a
 * literal drag-scrub-with-live-preview (there's no meaningful live preview
 * of a Minecraft world to show) — it's a fast way to browse and pick a
 * rollback point, which is the actual thing the feature promises.
 */
export function SnapshotTimeline({ serverId, locked }: { serverId: string; locked: boolean }) {
  const { active: premiumActive } = usePremium();
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listSnapshots(serverId)
      .then((s) => setSnaps(s))
      .catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    setConfirmRestore(null);
    load();
  }, [load]);

  async function takeNow() {
    setBusy(true);
    setError(null);
    try {
      await api.snapshotNow(serverId);
      toast.ok("Snapshot taken");
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.restoreSnapshot(serverId, id);
      toast.ok("Restored");
      setConfirmRestore(null);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    setBusy(true);
    try {
      await api.deleteSnapshot(serverId, id);
      setConfirmDelete(null);
      load();
    } catch (e) {
      toast.bad("Couldn't delete that snapshot", String(e));
    } finally {
      setBusy(false);
    }
  }

  // oldest-to-newest, left-to-right, like a real timeline
  const ordered = snaps ? [...snaps].reverse() : [];
  const latestId = snaps?.[0]?.id ?? null;

  // Not Premium and nothing on disk from before it lapsed (or was never
  // active) — there's nothing to view and nothing to create, so this card
  // doesn't render at all rather than dangling a feature that isn't there.
  // Existing snapshots (e.g. from when Premium was active) stay browsable
  // either way — losing access to your own files isn't the gate.
  if (!premiumActive && snaps !== null && snaps.length === 0) return null;

  return (
    <Card
      title="Time Machine"
      icon="clock"
      description="Frequent, near-free rollback points — separate from the zip backups below."
      right={
        premiumActive ? (
          <Button variant="ghost" size="sm" icon="save" loading={busy} onClick={takeNow}>
            Snapshot now
          </Button>
        ) : (
          <Badge tone="accent" icon="crown" size="sm">
            Premium
          </Badge>
        )
      }
    >
      {!premiumActive && (
        <p className="mb-3 text-2xs text-ink-faint">
          These are from before — new snapshots need Premium (Settings → Premium).
        </p>
      )}
      {snaps === null ? (
        <StateBlock state="loading" title="Reading snapshots…" compact />
      ) : snaps.length === 0 ? (
        <StateBlock
          state="empty"
          icon="clock"
          title="No snapshots yet"
          message="Turn them on in Automation, or take one now — unchanged files cost nothing to keep."
          compact
        />
      ) : (
        <div className="space-y-3">
          {/* A quick-glance timeline, not the only way to see a snapshot —
              every one of them is also its own row below regardless of
              whether you ever touch this. Ticks got wider and higher-
              contrast after the all-but-invisible thin/dim version read as
              "empty" even with several real snapshots sitting right there. */}
          <div className="cp-well overflow-x-auto rounded-lg border border-line-soft px-3 py-3">
            <div className="flex min-w-max items-end gap-2" style={{ height: 40 }}>
              {ordered.map((s) => (
                <Tooltip
                  key={s.id}
                  label={`${clock(s.createdAt)} · ${size(s.newBytes)}${s.id === latestId ? " · latest" : ""}`}
                >
                  <button
                    onClick={() => setHighlighted(s.id)}
                    aria-pressed={highlighted === s.id}
                    className={cx(
                      "w-3.5 shrink-0 rounded-sm transition-all",
                      s.id === latestId ? "h-full bg-accent" : "h-4/5 bg-accent-soft/60 hover:h-full hover:bg-accent-soft",
                      highlighted === s.id && "ring-2 ring-accent ring-offset-1 ring-offset-console",
                    )}
                  />
                </Tooltip>
              ))}
            </div>
          </div>

          {/* Every snapshot, newest first — not just whichever tick above
              happens to be picked. Clicking a tick scrolls here and rings
              the matching row instead of replacing this list with it. */}
          <ul className="space-y-1.5">
            {snaps.map((s) => (
              <li
                key={s.id}
                className={cx(
                  "rounded-lg border bg-surface-2 px-3 py-2.5 transition-colors",
                  highlighted === s.id ? "border-accent-line" : "border-line-soft",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface text-ink-faint">
                    <Icon name="clock" size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink">{clock(s.createdAt)}</span>
                      {s.id === latestId && (
                        <Badge tone="ok" size="sm">
                          latest
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-2xs text-ink-faint">
                      <span>{ago(s.createdAt)}</span>
                      <span className="text-ink-ghost">·</span>
                      <span className="tabular-nums">{size(s.newBytes)} new</span>
                      <span className="text-ink-ghost">·</span>
                      <Badge tone={s.trigger === "manual" ? "neutral" : "accent"} size="sm">
                        {s.trigger}
                      </Badge>
                    </div>
                  </div>
                  {confirmRestore !== s.id && (
                    <div className="flex shrink-0 gap-1.5">
                      <Tooltip label={locked ? "Stop the server first" : "Restore to this point"}>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={locked || busy}
                          onClick={() => setConfirmRestore(s.id)}
                        >
                          Restore
                        </Button>
                      </Tooltip>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDelete(s)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </div>

                {confirmRestore === s.id && (
                  <div className="cp-in mt-2.5 rounded-lg border border-warn/30 bg-warn-muted p-3">
                    <p className="text-2xs leading-relaxed text-warn-soft">
                      This swaps your current server folder for {clock(s.createdAt)}. Before it
                      does, CraftPanel takes a fresh zip safety backup of what's there now — so
                      nothing is lost either way.
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <Button variant="primary" size="sm" loading={busy} onClick={() => restore(s.id)}>
                        Restore now
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmRestore(null)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-2 text-2xs text-bad-soft">{error}</p>}

      {confirmDelete && (
        <Modal
          title={`Delete this snapshot for good?`}
          icon="trash"
          size="sm"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Button variant="quiet" className="mr-auto" onClick={() => setConfirmDelete(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                icon="trash"
                loading={busy}
                onClick={() => del(confirmDelete.id)}
              >
                Delete for good
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-dim">
            {clock(confirmDelete.createdAt)} ({ago(confirmDelete.createdAt)}) — there's no trash
            folder for Time Machine snapshots. Once it's gone, this exact rollback point can't be
            recovered.
          </p>
        </Modal>
      )}
    </Card>
  );
}
