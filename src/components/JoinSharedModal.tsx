import { useState } from "react";
import { api } from "../api";
import type { ServerRecord } from "../types";
import { Button, Field, IconButton, TextInput, useDismissOnEscape } from "./ui";
import { ErrorBanner } from "./ErrorBanner";

export function JoinSharedModal({
  onClose,
  onJoined,
}: {
  onClose: () => void;
  onJoined: (s: ServerRecord) => void;
}) {
  const [folder, setFolder] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    const d = await api.pickFolder();
    if (d) setFolder(d);
  }

  async function join() {
    if (!folder || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const rec = await api.joinShared(folder, code.trim());
      onJoined(rec);
    } catch (e) {
      setError(String(e));
      setBusy(false);
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
          <p className="text-xs text-ink-dim">
            Pick the same synced folder the other device shared, then enter the code.
          </p>

          <Field label="Shared folder">
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

          <ErrorBanner message={error} />
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-line-soft bg-surface-2/60 px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={join}
            disabled={busy || !folder || !code.trim()}
          >
            {busy ? "Joining…" : "Join"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
