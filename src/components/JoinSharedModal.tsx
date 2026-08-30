import { useEffect, useState } from "react";
import { api } from "../api";
import type { ServerRecord } from "../types";
import { Button, Field, IconButton, TextInput, useDismissOnEscape } from "./ui";
import { R2SetupModal } from "./R2SetupModal";

type Mode = "cloud" | "folder";

export function JoinSharedModal({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (s: ServerRecord) => void;
}) {
  const [mode, setMode] = useState<Mode>("cloud");
  const [folder, setFolder] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [r2Ready, setR2Ready] = useState<boolean | null>(null);
  const [showR2, setShowR2] = useState(false);

  useEffect(() => {
    api.r2ConfigGet().then((s) => setR2Ready(s.configured)).catch(() => setR2Ready(false));
    let un: (() => void) | undefined;
    api.onSyncProgress((p) => setProgress(p.message)).then((f) => (un = f));
    return () => un?.();
  }, []);

  async function pick() {
    const d = await api.pickFolder();
    if (d) setFolder(d);
  }

  async function join() {
    if (!folder || !code.trim()) return;
    setBusy(true);
    setError(null);
    setProgress(mode === "cloud" ? "Downloading…" : null);
    try {
      const rec =
        mode === "cloud"
          ? await api.cloudJoin(code.trim(), folder)
          : await api.joinShared(folder, code.trim());
      onJoined(rec);
    } catch (e) {
      setError(String(e));
      setBusy(false);
      setProgress(null);
    }
  }


  useDismissOnEscape(busy ? undefined : onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" className="cp-pop flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-e3">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <h2 className="font-display text-base font-semibold text-ink">Join a shared server</h2>
          {!busy && (
            <IconButton icon="x" title="Close" size="sm" onClick={onClose} />
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex rounded-md border border-line bg-surface-2 p-0.5 text-xs">
            {(["cloud", "folder"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-sm px-2 py-1 font-medium capitalize transition-colors duration-[120ms] ${
                  mode === m
                    ? "bg-surface-4 text-ink shadow-e1"
                    : "text-ink-faint hover:text-ink"
                }`}
              >
                {m === "cloud" ? "Cloud (code)" : "Synced folder"}
              </button>
            ))}
          </div>

          {mode === "cloud" && r2Ready === false ? (
            <div className="space-y-2">
              <p className="text-xs text-ink-dim">
                Cloud sync needs your Cloudflare R2 details first.
              </p>
              <Button variant="primary" onClick={() => setShowR2(true)}>
                Set up cloud sync
              </Button>
            </div>
          ) : (
            <>
              <p className="text-xs text-ink-dim">
                {mode === "cloud"
                  ? "Pick an empty folder to download the server into, then enter the code."
                  : "Pick the same synced folder the other device shared, then enter the code."}
              </p>

              <Field label={mode === "cloud" ? "Download into (empty folder)" : "Shared folder"}>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={pick}>
                    {folder ? "Change…" : "Choose folder…"}
                  </Button>
                  {folder && (
                    <span className="truncate font-mono text-xs text-ink-faint">{folder}</span>
                  )}
                </div>
              </Field>

              <Field label="Code">
                <TextInput
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  className="font-mono tracking-widest"
                />
              </Field>
            </>
          )}

          {progress && (
            <div className="rounded-md border border-line-soft bg-surface-2 px-2.5 py-1.5 text-xs text-ink-dim">{progress}</div>
          )}
          {error && (
            <div className="rounded-md border border-bad/30 bg-bad-muted px-3 py-2 text-xs text-bad-soft">
              {error}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-line-soft bg-surface-2/60 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={join}
            disabled={busy || !folder || !code.trim() || (mode === "cloud" && !r2Ready)}
          >
            {busy ? "Joining…" : "Join"}
          </Button>
        </footer>
      </div>

      {showR2 && (
        <R2SetupModal
          onClose={() => setShowR2(false)}
          onSaved={() => {
            setShowR2(false);
            setR2Ready(true);
          }}
        />
      )}
    </div>
  );
}
