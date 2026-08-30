import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { JvmInfo } from "../types";
import { Button } from "./ui";

export function JvmSection({
  serverId,
  onNeedsRestart,
}: {
  serverId: string;
  onNeedsRestart: () => void;
}) {
  const [info, setInfo] = useState<JvmInfo | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLine, setShowLine] = useState(false);

  const load = useCallback(() => {
    api
      .getJvmArgs(serverId)
      .then((i) => {
        setInfo(i);
        setDraft(i.args ?? "");
      })
      .catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setNote(null);
    setError(null);
    load();
  }, [load]);

  async function save(value: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const running = await api.setJvmArgs(serverId, value.trim() || null);
      setNote(running ? "Saved — restart to apply." : "Saved.");
      if (running) onNeedsRestart();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!info) return null;
  const dirty = draft.trim() !== (info.args ?? "").trim();

  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
        JVM flags
      </div>
      <p className="mb-2 text-[11px] leading-snug text-ink-faint">
        Extra flags added between the memory flags and <code>-jar</code>. Leave blank
        for defaults. Heap size comes from the RAM slider above.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder="-XX:+UseG1GC …"
        className="w-full resize-none rounded border border-edge bg-panel-2 p-2 font-mono text-[11px] text-ink outline-none focus:border-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || !dirty} onClick={() => save(draft)}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setDraft(info.aikar);
          }}
        >
          Fill Aikar's flags
        </Button>
        {draft.trim() && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDraft("");
              save("");
            }}
          >
            Clear
          </Button>
        )}
        <button
          className="text-[11px] text-accent hover:underline"
          onClick={() => setShowLine((v) => !v)}
        >
          {showLine ? "hide" : "show"} launch command
        </button>
      </div>
      {showLine && (
        <pre className="mt-2 overflow-x-auto rounded bg-[#0b0c0e] p-2 text-[10px] leading-relaxed text-ink-dim">
          {info.resolved}
        </pre>
      )}
      {note && <div className="mt-2 rounded bg-panel-2 px-2 py-1 text-xs text-ink-dim">{note}</div>}
      {error && (
        <div className="mt-2 rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}
    </div>
  );
}
