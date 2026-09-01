import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { ServerRecord } from "../types";
import { Button, Field, TextInput } from "./ui";
import { ErrorBanner } from "./ErrorBanner";

export function CloneServerModal({
  server,
  onClose,
  onCloned,
}: {
  server: ServerRecord;
  onClose: () => void;
  onCloned: () => void;
}) {
  const [name, setName] = useState(`${server.name} copy`);
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    const d = await api.pickFolder();
    if (d) setDir(d);
  }

  async function clone() {
    setBusy(true);
    setError(null);
    try {
      await api.cloneServer(server.id, name, dir);
      onCloned();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-e3">
        <div className="border-b border-line px-5 py-4">
          <h2 className="cp-display text-base text-ink">Duplicate server</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            Copies {server.name}'s world, plugins/mods, and configs into a new, independent
            server — nothing about the original changes.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <Field label="Name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Folder for the copy">
            <div className="flex gap-2">
              <TextInput value={dir} readOnly placeholder="Choose a folder…" className="flex-1" />
              <Button variant="secondary" size="sm" onClick={choose} disabled={busy}>
                Browse…
              </Button>
            </div>
          </Field>
          {error && <ErrorBanner message={error} />}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="copy"
            loading={busy}
            disabled={!name.trim() || !dir}
            onClick={clone}
          >
            {busy ? "Duplicating…" : "Duplicate"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
