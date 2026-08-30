import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { FileView, Listing } from "../types";
import { Button } from "./ui";

function size(n: number) {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function FilesPanel({ serverId }: { serverId: string }) {
  const [dir, setDir] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [open, setOpen] = useState<FileView | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .fsList(serverId, dir)
      .then((l) => {
        setListing(l);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [serverId, dir]);

  useEffect(() => {
    setOpen(null);
    load();
  }, [load]);

  useEffect(() => {
    setDir("");
    setOpen(null);
  }, [serverId]);

  async function guard(fn: () => Promise<unknown>, msg?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (msg) setNote(msg);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openFile(rel: string) {
    setError(null);
    try {
      const v = await api.fsRead(serverId, rel);
      setOpen(v);
      setDraft(v.text);
    } catch (e) {
      setError(String(e));
    }
  }

  const crumbs = ["", ...dir.split("/").filter(Boolean).map((_, i, arr) => arr.slice(0, i + 1).join("/"))];

  if (open) {
    const dangerous = /server\.properties$|\.json$/.test(open.rel);
    return (
      <div className="flex h-full flex-col">
        <div className="mb-2 flex items-center gap-2">
          <Button variant="ghost" onClick={() => setOpen(null)}>
            ← Back
          </Button>
          <span className="flex-1 truncate font-mono text-xs text-ink-dim">{open.rel}</span>
          <span className="text-[11px] text-ink-faint">{size(open.bytes)}</span>
        </div>
        {open.binary ? (
          <div className="rounded border border-edge bg-panel p-4 text-xs text-ink-faint">
            Binary file — can't edit here. Use Download to get a copy.
            <div className="mt-2">
              <Button variant="ghost" onClick={() => api.fsExport(serverId, open.rel)}>
                Download
              </Button>
            </div>
          </div>
        ) : (
          <>
            {dangerous && (
              <div className="mb-2 rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
                The Settings and Players tabs edit this file safely. Hand-editing can
                break formatting.
              </div>
            )}
            {open.truncated && (
              <div className="mb-2 rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
                File is large — only the first 2 MB is shown. Saving would truncate it,
                so saving is disabled.
              </div>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded border border-edge bg-panel-2 p-2 font-mono text-xs text-ink outline-none focus:border-accent"
            />
            <div className="mt-2 flex gap-2">
              <Button
                variant="primary"
                disabled={busy || open.truncated || draft === open.text}
                onClick={() =>
                  guard(async () => {
                    await api.fsWrite(serverId, open.rel, draft);
                    setOpen({ ...open, text: draft });
                  }, "Saved.")
                }
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => api.fsExport(serverId, open.rel)}>
                Download
              </Button>
            </div>
          </>
        )}
        {error && (
          <div className="mt-2 rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
        {crumbs.map((c, i) => (
          <span key={c || "root"} className="flex items-center gap-1">
            {i > 0 && <span className="text-ink-faint">/</span>}
            <button
              onClick={() => setDir(c)}
              className={c === dir ? "text-ink" : "text-accent hover:underline"}
            >
              {i === 0 ? "server" : c.split("/").pop()}
            </button>
          </span>
        ))}
        <span className="flex-1" />
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            const name = prompt("New folder name");
            if (name) guard(() => api.fsMkdir(serverId, dir ? `${dir}/${name}` : name), "Folder created.");
          }}
        >
          + Folder
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            guard(async () => {
              const added = await api.fsImport(serverId, dir);
              if (added) setNote(`Uploaded ${added.join(", ")}.`);
            })
          }
        >
          ↑ Upload
        </Button>
      </div>

      {note && <div className="mb-2 rounded bg-panel-2 px-2 py-1 text-xs text-ink-dim">{note}</div>}
      {error && (
        <div className="mb-2 rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}

      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {listing?.entries.map((e) => (
          <li
            key={e.rel}
            className="group flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-panel-2"
          >
            <button
              className="flex flex-1 items-center gap-2 truncate text-left"
              onClick={() => (e.isDir ? setDir(e.rel) : openFile(e.rel))}
            >
              <span>{e.isDir ? "📁" : "📄"}</span>
              <span className="truncate">{e.name}</span>
              {!e.isDir && <span className="text-[11px] text-ink-faint">{size(e.size)}</span>}
            </button>
            <div className="flex gap-2 text-[11px] opacity-0 group-hover:opacity-100">
              {!e.isDir && (
                <button
                  className="text-accent hover:underline"
                  onClick={() => api.fsExport(serverId, e.rel)}
                >
                  download
                </button>
              )}
              <button
                className="text-ink-faint hover:text-ink"
                onClick={() => {
                  const to = prompt("Rename to (path relative to server)", e.rel);
                  if (to && to !== e.rel) guard(() => api.fsRename(serverId, e.rel, to), "Renamed.");
                }}
              >
                rename
              </button>
              <button
                className="text-ink-faint hover:text-bad"
                onClick={() => {
                  if (confirm(`Move "${e.name}" to .craftpanel-trash?`))
                    guard(() => api.fsDelete(serverId, e.rel), "Moved to trash.");
                }}
              >
                delete
              </button>
            </div>
          </li>
        ))}
        {listing && listing.entries.length === 0 && (
          <li className="px-2 py-3 text-xs text-ink-faint">Empty folder.</li>
        )}
      </ul>
      <p className="mt-1 text-[11px] text-ink-faint">
        Deletes move to <code>.craftpanel-trash/</code> — nothing is erased.
      </p>
    </div>
  );
}
