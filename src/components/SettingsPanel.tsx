import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ServerRecord, ServerSettings, SettingField } from "../types";
import { Button } from "./ui";
import { RamSlider } from "./RamSlider";
import { ShareSection } from "./ShareSection";
import { BrandingSection } from "./BrandingSection";
import { AutomationSection } from "./AutomationSection";
import { JvmSection } from "./JvmSection";

type View = "common" | "advanced" | "raw";

export function SettingsPanel({
  server,
  locked,
  onServersChanged,
  onNeedsRestart,
}: {
  server: ServerRecord;
  locked: boolean;
  onServersChanged: () => void;
  onNeedsRestart: () => void;
}) {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("common");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ram, setRam] = useState(server.ram_mb);
  const [keepAwake, setKeepAwake] = useState(server.keep_awake);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(() => {
    api
      .getSettings(server.id)
      .then((s) => {
        setSettings(s);
        setDraft({});
      })
      .catch((e) => setError(String(e)));
  }, [server.id]);

  useEffect(() => {
    setError(null);
    setMsg(null);
    load();
  }, [load]);
  useEffect(() => setRam(server.ram_mb), [server.id, server.ram_mb]);
  useEffect(() => setKeepAwake(server.keep_awake), [server.id, server.keep_awake]);

  function toggleKeepAwake(next: boolean) {
    setKeepAwake(next);
    api.setKeepAwake(server.id, next).then(onServersChanged).catch((e) => setError(String(e)));
  }

  const dirty = Object.keys(draft).length > 0;
  const val = (key: string, fallback: string) => draft[key] ?? fallback;
  const edit = (key: string, v: string) => setDraft((d) => ({ ...d, [key]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await api.applySettings(
        server.id,
        Object.entries(draft) as [string, string][],
      );
      setMsg(r.changed.length ? `Saved ${r.changed.join(", ")}.` : "No changes.");
      if (r.restartRequired) onNeedsRestart();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function saveRam(mb: number) {
    setRam(mb);
    api.setServerRam(server.id, mb).then(onServersChanged).catch((e) => setError(String(e)));
  }

  const fields: SettingField[] =
    view === "common"
      ? (settings?.common ?? [])
      : view === "advanced"
        ? (settings?.advanced ?? [])
        : [];

  return (
    <div className="h-full space-y-4 overflow-y-auto pr-1">
      <div className="rounded-lg border border-edge bg-panel p-3">
        <RamSlider valueMb={ram} onChange={saveRam} disabled={locked} />
        {locked && (
          <p className="mt-2 text-[11px] text-ink-faint">Stop the server to change memory.</p>
        )}
        <label className="mt-3 flex items-start gap-2 border-t border-edge pt-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={keepAwake}
            onChange={(e) => toggleKeepAwake(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span>
            Keep this computer awake while the server runs
            <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">
              Stops idle-sleep so the server stays up when you step away. Takes effect on
              the next start. macOS: with the lid shut it still sleeps unless plugged in.
              Windows support is coming.
            </span>
          </span>
        </label>
      </div>

      <BrandingSection serverId={server.id} />

      <AutomationSection serverId={server.id} />

      <JvmSection serverId={server.id} onNeedsRestart={onNeedsRestart} />

      <ShareSection server={server} onServersChanged={onServersChanged} />

      {!settings ? (
        <div className="text-xs text-ink-faint">Loading settings…</div>
      ) : !settings.present ? (
        <div className="rounded-lg border border-edge bg-panel p-3 text-xs text-ink-faint">
          No <code>server.properties</code> yet. Start the server once and it'll
          generate one.
        </div>
      ) : (
        <>
          <div className="flex rounded-md border border-edge bg-panel-2 p-0.5 text-xs">
            {(["common", "advanced", "raw"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`flex-1 rounded px-2 py-1 capitalize transition-colors ${
                  view === v ? "bg-accent text-black" : "text-ink-dim hover:text-ink"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {view === "raw" ? (
            <div className="space-y-1 rounded-lg border border-edge bg-panel-2 p-2">
              <p className="pb-1 text-[11px] text-ink-faint">
                Every key in the file. Careful — no validation here.
              </p>
              {settings.all.map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-56 shrink-0 truncate font-mono text-[11px] text-ink-faint">
                    {k}
                  </span>
                  <input
                    value={val(k, v)}
                    onChange={(e) => edit(k, e.target.value)}
                    className="flex-1 rounded border border-edge bg-panel px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {view === "advanced" && (
                <p className="text-[11px] text-ink-faint">
                  The knobs that actually move performance and behaviour. Hover a
                  label for what it does.
                </p>
              )}
              {fields.map((f) => (
                <FieldRow key={f.key} field={f} value={val(f.key, f.value)} onChange={edit} />
              ))}
            </div>
          )}

          <div className="sticky bottom-0 flex items-center gap-2 bg-[#0f1013] py-2">
            <Button variant="primary" onClick={save} disabled={busy || !dirty}>
              {busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft({})} disabled={busy}>
                Discard
              </Button>
            )}
            {dirty && (
              <span className="text-[11px] text-ink-faint">
                {Object.keys(draft).length} unsaved
              </span>
            )}
          </div>
        </>
      )}

      {msg && <div className="rounded bg-panel-2 px-2 py-1 text-xs text-ink-dim">{msg}</div>}
      {error && (
        <div className="rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}

      <div className="space-y-1 border-t border-edge pt-3 text-xs text-ink-faint">
        <div className="break-all">
          Folder: <span className="font-mono">{server.path}</span>
        </div>
        <div>
          Launch: <span className="font-mono">{server.launch_target}</span>
        </div>
      </div>

      <div className="border-t border-edge pt-3">
        {!confirmRemove ? (
          <Button
            variant="danger"
            onClick={() => setConfirmRemove(true)}
            disabled={locked}
            title={locked ? "Stop the server first" : undefined}
          >
            Remove from CraftPanel
          </Button>
        ) : (
          <div className="space-y-2 text-xs text-ink-dim">
            <p>Remove “{server.name}”? The folder on disk is untouched.</p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={async () => {
                  await api.removeServer(server.id);
                  onServersChanged();
                }}
              >
                Confirm
              </Button>
              <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: SettingField;
  value: string;
  onChange: (key: string, v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm text-ink">{field.label}</label>
        {field.kind === "bool" ? (
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(field.key, e.target.checked ? "true" : "false")}
            className="accent-accent"
          />
        ) : field.kind === "enum" ? (
          <select
            value={value}
            onChange={(e) => onChange(field.key, e.target.value)}
            className="rounded-md border border-edge bg-panel-2 px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          >
            {field.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={field.kind === "int" ? "number" : "text"}
            value={value}
            onChange={(e) => onChange(field.key, e.target.value)}
            className="w-52 rounded-md border border-edge bg-panel-2 px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          />
        )}
      </div>
      {field.help && (
        <div className="mt-0.5 text-[11px] leading-snug text-ink-faint">{field.help}</div>
      )}
      {field.note && <div className="mt-0.5 text-[11px] text-warn">{field.note}</div>}
    </div>
  );
}
