import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Schedule } from "../types";
import { Button, Card } from "./ui";
import { ErrorBanner } from "./ErrorBanner";

const EMPTY: Schedule = {
  restartOnCrash: false,
  maxCrashRestarts: 3,
  scheduledStart: null,
  dailyRestart: null,
  restartWarningSecs: 60,
  timedCommands: [],
  backupOnStop: false,
  intervalBackupHours: null,
  cloudBackup: false,
};

export function AutomationSection({ serverId }: { serverId: string }) {
  const [sch, setSch] = useState<Schedule>(EMPTY);
  const [saved, setSaved] = useState<Schedule>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .getSchedule(serverId)
      .then((s) => {
        setSch(s);
        setSaved(s);
      })
      .catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    setNote(null);
    load();
  }, [load]);

  const dirty = JSON.stringify(sch) !== JSON.stringify(saved);
  const set = <K extends keyof Schedule>(k: K, v: Schedule[K]) =>
    setSch((s) => ({ ...s, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const clean: Schedule = {
        ...sch,
        scheduledStart: sch.scheduledStart?.trim() ? sch.scheduledStart.trim() : null,
        dailyRestart: sch.dailyRestart?.trim() ? sch.dailyRestart.trim() : null,
        timedCommands: sch.timedCommands.filter((c) => c.at.trim() && c.command.trim()),
      };
      await api.setSchedule(serverId, clean);
      setSch(clean);
      setSaved(clean);
      setNote("Automation saved.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Keep it running by itself"
      icon="clock"
      description="Auto-restart after a crash, a nightly reboot, and scheduled commands."
    >

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={sch.restartOnCrash}
          onChange={(e) => set("restartOnCrash", e.target.checked)}
          className="mt-0.5 accent-accent"
        />
        <span className="flex-1">
          Restart automatically if it crashes
          <span className="ml-1 text-2xs text-ink-faint">
            (give up after{" "}
            <input
              type="number"
              min={1}
              max={20}
              value={sch.maxCrashRestarts}
              onChange={(e) => set("maxCrashRestarts", Number(e.target.value) || 3)}
              className="mx-0.5 w-12 rounded border border-line bg-surface-2 px-1 py-0.5 text-center text-ink"
            />
            crashes in 15 min)
          </span>
        </span>
      </label>

      <label className="mt-2.5 flex items-center gap-2 text-sm">
        <span className="flex-1">Start every day at</span>
        <input
          type="time"
          value={sch.scheduledStart ?? ""}
          onChange={(e) => set("scheduledStart", e.target.value || null)}
          className="rounded border border-line bg-surface-2 px-2 py-1 text-sm text-ink"
        />
      </label>
      {sch.scheduledStart && (
        <p className="mt-0.5 text-2xs text-ink-faint">
          Only fires if it's stopped. Local time — needs the Mac to actually be awake at that
          time; turn on "Stay awake on power" in Settings → General so it doesn't sleep through
          it.
        </p>
      )}

      <label className="mt-2.5 flex items-center gap-2 text-sm">
        <span className="flex-1">Restart every day at</span>
        <input
          type="time"
          value={sch.dailyRestart ?? ""}
          onChange={(e) => set("dailyRestart", e.target.value || null)}
          className="rounded border border-line bg-surface-2 px-2 py-1 text-sm text-ink"
        />
      </label>
      {sch.dailyRestart && (
        <p className="mt-0.5 text-2xs text-ink-faint">
          Players get a <code>/say</code> warning ~1 min before. Local time.
        </p>
      )}

      <label className="mt-2.5 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={sch.backupOnStop}
          onChange={(e) => set("backupOnStop", e.target.checked)}
          className="mt-0.5 accent-accent"
        />
        <span>
          Back up every time the server stops
          <span className="ml-1 text-2xs text-ink-faint">
            (counts toward the keep-limit)
          </span>
        </span>
      </label>

      <label className="mt-2.5 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={sch.intervalBackupHours != null}
          onChange={(e) => set("intervalBackupHours", e.target.checked ? 6 : null)}
          className="accent-accent"
        />
        <span className="flex-1">Also back up automatically every</span>
        <input
          type="number"
          min={1}
          max={168}
          disabled={sch.intervalBackupHours == null}
          value={sch.intervalBackupHours ?? 6}
          onChange={(e) => set("intervalBackupHours", Number(e.target.value) || 6)}
          className="w-14 rounded border border-line bg-surface-2 px-1 py-0.5 text-center text-ink disabled:opacity-40"
        />
        <span className="text-2xs text-ink-faint">hours, while running</span>
      </label>

      <label className="mt-2.5 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={sch.cloudBackup}
          onChange={(e) => set("cloudBackup", e.target.checked)}
          className="mt-0.5 accent-accent"
        />
        <span>
          Also push every scheduled backup to the cloud
          <span className="mt-0.5 block text-2xs text-ink-faint">
            Needs Cloud sync (R2) set up in CraftPanel settings — silently
            skipped otherwise. Off-machine, in case this computer's disk
            goes with it.
          </span>
        </span>
      </label>

      <div className="mt-3 border-t border-line pt-2">
        <div className="mb-1 text-2xs uppercase tracking-wide text-ink-faint">
          Timed commands
        </div>
        {sch.timedCommands.map((c, i) => (
          <div key={i} className="mb-1 flex gap-1.5">
            <input
              type="time"
              value={c.at}
              onChange={(e) =>
                set(
                  "timedCommands",
                  sch.timedCommands.map((x, j) => (j === i ? { ...x, at: e.target.value } : x)),
                )
              }
              className="rounded border border-line bg-surface-2 px-2 py-1 text-sm text-ink"
            />
            <input
              value={c.command}
              placeholder="save-all"
              onChange={(e) =>
                set(
                  "timedCommands",
                  sch.timedCommands.map((x, j) =>
                    j === i ? { ...x, command: e.target.value } : x,
                  ),
                )
              }
              className="flex-1 rounded border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
            />
            <button
              className="px-1 text-ink-faint hover:text-bad"
              onClick={() =>
                set(
                  "timedCommands",
                  sch.timedCommands.filter((_, j) => j !== i),
                )
              }
            >
              ✕
            </button>
          </div>
        ))}
        <Button
          variant="ghost"
          onClick={() =>
            set("timedCommands", [...sch.timedCommands, { at: "03:00", command: "" }])
          }
        >
          + Add command
        </Button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" disabled={busy || !dirty} onClick={save}>
          {busy ? "Saving…" : dirty ? "Save automation" : "Saved"}
        </Button>
        {note && <span className="text-2xs text-ink-dim">{note}</span>}
      </div>
      <ErrorBanner message={error} className="mt-2" />
    </Card>
  );
}
