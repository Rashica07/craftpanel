import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ModList } from "../types";
import { Button } from "./ui";

function mb(bytes: number) {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ModsPanel({ serverId }: { serverId: string }) {
  const [list, setList] = useState<ModList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(() => {
    api.listMods(serverId).then(setList).catch((e) => setError(String(e)));
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

  async function pickAndImport() {
    const files = await api.pickJars();
    if (files?.length) await guard(() => api.importMods(serverId, files));
  }

  if (list && !list.supported) {
    return (
      <div className="rounded-lg border border-edge bg-panel p-4 text-sm text-ink-dim">
        {list.warnings[0] ?? "This server type doesn't use a mods/ folder."}
      </div>
    );
  }

  return (
    <div className="space-y-3 overflow-y-auto pr-1">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          // Tauri exposes dropped paths via the file-drop event; the button is
          // the reliable path, so nudge the user there.
          setError(null);
        }}
        className={`rounded-lg border-2 border-dashed p-4 text-center text-xs transition-colors ${
          dragOver ? "border-accent bg-accent-muted" : "border-edge text-ink-faint"
        }`}
      >
        <p>Add mods to this server</p>
        <Button variant="ghost" className="mt-2" onClick={pickAndImport} disabled={busy}>
          Choose .jar files…
        </Button>
      </div>

      {list?.authMods.length ? (
        <div className="rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok">
          Offline-auth protection active: {list.authMods.join(", ")}
        </div>
      ) : null}
      {list?.warnings.map((w, i) => (
        <div
          key={i}
          className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn"
        >
          {w}
        </div>
      ))}

      {list && (
        <div className="text-xs text-ink-faint">
          {list.mods.filter((m) => m.enabled).length} enabled ·{" "}
          {list.mods.filter((m) => !m.enabled).length} disabled
          {list.fabricApiPresent && (
            <>
              {" · "}
              <span className="text-ok">Fabric API ✓</span>
            </>
          )}
        </div>
      )}

      <ul className="space-y-1">
        {list?.mods.map((m) => (
          <li
            key={m.name}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              m.enabled ? "bg-panel-2" : "bg-panel opacity-60"
            }`}
          >
            <input
              type="checkbox"
              checked={m.enabled}
              disabled={busy}
              onChange={(e) =>
                guard(() => api.setModEnabled(serverId, m.name, e.target.checked))
              }
              className="accent-accent"
            />
            <span className="flex-1 truncate font-mono text-xs">{m.name}</span>
            <span className="text-[11px] text-ink-faint">{mb(m.size)}</span>
            <button
              onClick={() => guard(() => api.removeMod(serverId, m.name))}
              disabled={busy}
              className="text-ink-faint hover:text-bad"
              title="Move to .craftpanel-trash"
            >
              ✕
            </button>
          </li>
        ))}
        {list && list.mods.length === 0 && (
          <li className="px-2 py-3 text-xs text-ink-faint">No mods yet.</li>
        )}
      </ul>

      {error && (
        <div className="rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}
      <p className="text-[11px] text-ink-faint">
        Disabled mods move to <code>mods-disabled/</code>. Removed mods move to{" "}
        <code>.craftpanel-trash/</code> — nothing is permanently deleted.
      </p>
    </div>
  );
}
