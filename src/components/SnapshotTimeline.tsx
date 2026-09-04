import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Snapshot } from "../types";
import { Badge, Button, Card, StateBlock, Tooltip, cx, toast } from "./ui";
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
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listSnapshots(serverId)
      .then((s) => {
        setSnaps(s);
        setSelected((cur) => (cur && s.some((x) => x.id === cur) ? cur : (s[0]?.id ?? null)));
      })
      .catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    setConfirming(false);
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

  async function restore() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.restoreSnapshot(serverId, selected);
      toast.ok("Restored");
      setConfirming(false);
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
      load();
    } catch (e) {
      toast.bad("Couldn't delete that snapshot", String(e));
    } finally {
      setBusy(false);
    }
  }

  const chosen = snaps?.find((s) => s.id === selected) ?? null;
  // oldest-to-newest, left-to-right, like a real timeline
  const ordered = snaps ? [...snaps].reverse() : [];
  // `snaps` comes back newest-first from the backend, so index 0 is the
  // true latest — selection deliberately stays put across reloads (so
  // inspecting an old tick doesn't get yanked out from under you while
  // new snapshots keep arriving), but that means it can silently drift
  // away from "latest" with nothing on screen saying so. This is what
  // actually caused a real incident: someone was about to restore a
  // 17-hour-old snapshot thinking it was current.
  const latestId = snaps?.[0]?.id ?? null;
  const onLatest = !selected || selected === latestId;

  return (
    <Card
      title="Time Machine"
      icon="clock"
      description="Frequent, near-free rollback points — separate from the zip backups below."
      right={
        <Button variant="ghost" size="sm" icon="save" loading={busy && !confirming} onClick={takeNow}>
          Snapshot now
        </Button>
      }
    >
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
          <div className="cp-well overflow-x-auto rounded-lg border border-line-soft px-3 py-3">
            <div className="flex min-w-max items-end gap-1.5" style={{ height: 40 }}>
              {ordered.map((s) => (
                <Tooltip
                  key={s.id}
                  label={`${clock(s.createdAt)} · ${size(s.newBytes)}${s.id === latestId ? " · latest" : ""}`}
                >
                  <button
                    onClick={() => setSelected(s.id)}
                    aria-pressed={selected === s.id}
                    className={cx(
                      "w-2.5 shrink-0 rounded-sm transition-all",
                      selected === s.id
                        ? "h-full bg-accent"
                        : s.id === latestId
                          ? "h-4/5 bg-accent-soft/70 hover:h-full hover:bg-accent-soft"
                          : "h-3/5 bg-ink-dim hover:h-4/5 hover:bg-accent-soft",
                    )}
                  />
                </Tooltip>
              ))}
            </div>
          </div>

          {chosen && (
            <div className="flex items-center gap-2.5 rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface text-ink-faint">
                <Icon name="clock" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink">{clock(chosen.createdAt)}</span>
                  {!onLatest && (
                    <Badge tone="warn" size="sm">
                      not the latest
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-2xs text-ink-faint">
                  <span>{ago(chosen.createdAt)}</span>
                  <span className="text-ink-ghost">·</span>
                  <span className="tabular-nums">{size(chosen.newBytes)} new</span>
                  <span className="text-ink-ghost">·</span>
                  <Badge tone={chosen.trigger === "manual" ? "neutral" : "accent"} size="sm">
                    {chosen.trigger}
                  </Badge>
                  {!onLatest && (
                    <>
                      <span className="text-ink-ghost">·</span>
                      <button
                        className="text-accent-soft hover:underline"
                        onClick={() => setSelected(latestId)}
                      >
                        Jump to latest
                      </button>
                    </>
                  )}
                </div>
              </div>
              {!confirming ? (
                <div className="flex shrink-0 gap-1.5">
                  <Tooltip label={locked ? "Stop the server first" : "Restore to this point"}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={locked || busy}
                      onClick={() => setConfirming(true)}
                    >
                      Restore
                    </Button>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => del(chosen.id)}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          {confirming && chosen && (
            <div className="cp-in rounded-lg border border-warn/30 bg-warn-muted p-3">
              <p className="text-2xs leading-relaxed text-warn-soft">
                This swaps your current server folder for {clock(chosen.createdAt)}. Before it
                does, CraftPanel takes a fresh zip safety backup of what's there now — so nothing
                is lost either way.
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button variant="primary" size="sm" loading={busy} onClick={restore}>
                  Restore now
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-2xs text-bad-soft">{error}</p>}
    </Card>
  );
}
