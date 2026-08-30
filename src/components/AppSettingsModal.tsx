import { useEffect, useState } from "react";
import { api } from "../api";
import type { AppSettings, UpdateCheck } from "../types";
import { Button, Field, IconButton, TextInput, Toggle, useDismissOnEscape } from "./ui";
import { Icon } from "./Icon";

const DEFAULTS: AppSettings = {
  defaultJava: "",
  defaultRamMb: 4096,
  expertMode: false,
  keepServersOnQuit: false,
  githubRepo: "",
};

export function AppSettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AppSettings>(DEFAULTS);
  const [saved, setSaved] = useState<AppSettings>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [upd, setUpd] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api
      .appSettingsGet()
      .then((v) => {
        const filled = { ...DEFAULTS, ...v, defaultRamMb: v.defaultRamMb || 4096 };
        setS(filled);
        setSaved(filled);
      })
      .catch(() => {});
  }, []);

  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setS((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      await api.appSettingsSet(s);
      setSaved(s);
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setChecking(true);
    try {
      if (dirty) await save();
      setUpd(await api.checkUpdate());
    } finally {
      setChecking(false);
    }
  }


  useDismissOnEscape(busy ? undefined : onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" className="cp-pop flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-e3">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-muted text-accent-soft">
            <Icon name="gear" size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold text-ink">
              CraftPanel settings
            </h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              Defaults for new servers, and how the app behaves.
            </p>
          </div>
          <IconButton icon="x" title="Close" size="sm" onClick={onClose} />
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Field label="Default Java" hint="used for new servers — blank = whatever's on PATH">
            <TextInput
              value={s.defaultJava}
              onChange={(e) => set("defaultJava", e.target.value)}
              placeholder="/path/to/java  (optional)"
            />
          </Field>

          <Field label="Default memory for new servers">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1024}
                max={16384}
                step={512}
                value={s.defaultRamMb}
                onChange={(e) => set("defaultRamMb", Number(e.target.value))}
                className="flex-1 accent-accent"
              />
              <span className="w-16 text-right text-sm">
                {(s.defaultRamMb / 1024).toFixed(s.defaultRamMb % 1024 ? 1 : 0)} GB
              </span>
            </div>
          </Field>

          <label className="flex items-start justify-between gap-3">
            <span className="text-sm">
              Keep servers running when I quit CraftPanel
              <span className="mt-0.5 block text-2xs text-ink-faint">
                Quitting won't stop your servers — the app re-adopts them next launch.
                (Closing the window already keeps them; this covers Quit.)
              </span>
            </span>
            <Toggle
              checked={s.keepServersOnQuit}
              onChange={(v) => set("keepServersOnQuit", v)}
            />
          </label>

          <label className="flex items-start justify-between gap-3">
            <span className="text-sm">
              Expert mode
              <span className="mt-0.5 block text-2xs text-ink-faint">
                Shows the raw <code>server.properties</code> editor and other power tools.
              </span>
            </span>
            <Toggle checked={s.expertMode} onChange={(v) => set("expertMode", v)} />
          </label>

          <div className="border-t border-line-soft pt-4">
            <Field label="Updates" hint="your GitHub repo, e.g. yourname/craftpanel">
              <TextInput
                value={s.githubRepo}
                onChange={(e) => set("githubRepo", e.target.value)}
                placeholder="owner/repo"
              />
            </Field>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="ghost" disabled={checking} onClick={check}>
                {checking ? "Checking…" : "Check for updates"}
              </Button>
              {upd &&
                (upd.unavailable ? (
                  <span className="text-2xs text-ink-faint">{upd.unavailable}</span>
                ) : upd.newer ? (
                  <a
                    href={upd.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-2xs text-accent underline"
                  >
                    {upd.latest} available (you have {upd.current}) →
                  </a>
                ) : (
                  <span className="text-2xs text-ok">Up to date ({upd.current}).</span>
                ))}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line-soft bg-surface-2/60 px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" disabled={busy || !dirty} onClick={save}>
            {busy ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
