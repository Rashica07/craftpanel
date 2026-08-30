import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { WorldInfo } from "../types";
import { Badge, Button } from "./ui";

function size(n: number) {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} MB`;
  if (n > 0) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return "not generated yet";
}

export function WorldsPanel({ serverId, locked }: { serverId: string; locked: boolean }) {
  const [info, setInfo] = useState<WorldInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newSeed, setNewSeed] = useState("");

  const load = useCallback(() => {
    api.listWorlds(serverId).then(setInfo).catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

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

  return (
    <div className="h-full space-y-3 overflow-y-auto pr-1">
      {locked && (
        <div className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
          Stop the server to switch, rename, create or delete worlds.
        </div>
      )}

      <ul className="space-y-1.5">
        {info?.worlds.map((w) => (
          <li key={w.name} className="rounded-md border border-edge bg-panel-2 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate">{w.name}</span>
              {w.active && <Badge tone="ok">active</Badge>}
              {w.hasNether && <Badge tone="neutral">nether</Badge>}
              {w.hasEnd && <Badge tone="neutral">end</Badge>}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">
              {size(w.sizeBytes)}
              {w.seed ? ` · seed ${w.seed}` : ""}
            </div>
            <div className="mt-1.5 flex gap-3 text-xs">
              {!w.active && (
                <button
                  className="text-accent hover:underline disabled:opacity-40"
                  disabled={locked || busy}
                  onClick={() => guard(() => api.worldSetActive(serverId, w.name))}
                >
                  make active
                </button>
              )}
              <button
                className="text-ink-faint hover:text-ink disabled:opacity-40"
                disabled={locked || busy}
                onClick={() => {
                  const to = prompt(`Rename "${w.name}" to`, w.name);
                  if (to && to !== w.name) guard(() => api.worldRename(serverId, w.name, to));
                }}
              >
                rename
              </button>
              {!w.active && (
                <button
                  className="text-ink-faint hover:text-bad disabled:opacity-40"
                  disabled={locked || busy}
                  onClick={() => {
                    if (confirm(`Move world "${w.name}" to .craftpanel-trash?`))
                      guard(() => api.worldDelete(serverId, w.name));
                  }}
                >
                  delete
                </button>
              )}
            </div>
          </li>
        ))}
        {info && info.worlds.length === 0 && (
          <li className="px-2 py-3 text-xs text-ink-faint">No worlds yet.</li>
        )}
      </ul>

      <div className="rounded-lg border border-edge bg-panel p-3">
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
          New world
        </div>
        <p className="mb-2 text-[11px] text-ink-faint">
          Points the server at a fresh world name — it generates on the next start.
          The current world folder is kept.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="world name"
            className="flex-1 rounded border border-edge bg-panel-2 px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            value={newSeed}
            onChange={(e) => setNewSeed(e.target.value)}
            placeholder="seed (optional)"
            className="w-40 rounded border border-edge bg-panel-2 px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          />
          <Button
            variant="subtle"
            disabled={locked || busy || !newName.trim()}
            onClick={() =>
              guard(async () => {
                await api.worldCreate(serverId, newName, newSeed);
                setNewName("");
                setNewSeed("");
              })
            }
          >
            Create
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}
    </div>
  );
}
