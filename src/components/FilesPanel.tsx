import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { FileEntry, FileView, Listing } from "../types";
import {
  Badge,
  Banner,
  Button,
  Field,
  IconButton,
  Modal,
  StateBlock,
  TextInput,
  Tooltip,
  cx,
  toast,
} from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { Icon } from "./Icon";

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
  // window.prompt()/confirm() are unavailable in Tauri's WKWebView, so these
  // used to be silent no-ops on macOS. Real dialogs instead.
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [renaming, setRenaming] = useState<FileEntry | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [deleting, setDeleting] = useState<FileEntry | null>(null);

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
        <div className="mb-3 flex items-center gap-2">
          <Button variant="secondary" icon="arrow-left" onClick={() => setOpen(null)}>
            All files
          </Button>
          <span
            data-selectable
            className="min-w-0 flex-1 truncate font-mono text-xs text-ink-dim"
          >
            {open.rel}
          </span>
          <Badge tone="neutral">{size(open.bytes)}</Badge>
        </div>
        {open.binary ? (
          <StateBlock
            state="empty"
            icon="file"
            title="This one isn't text"
            message="It's a binary file — an image, a jar, a region file. Editing it here would corrupt it."
            action={
              <Button
                variant="secondary"
                icon="download"
                onClick={() => api.fsExport(serverId, open.rel)}
              >
                Save a copy
              </Button>
            }
          />
        ) : (
          <>
            {dangerous && (
              <Banner tone="warn" className="mb-2">
                The <strong>Settings</strong> and <strong>Players</strong> tabs edit
                this file safely and keep its formatting. Hand-editing can break it.
              </Banner>
            )}
            {open.truncated && (
              <Banner tone="warn" className="mb-2">
                Only the first 2 MB is shown. Saving would cut the rest off, so it's
                disabled for this file.
              </Banner>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-md border border-line bg-surface-2 p-2.5 font-mono text-xs text-ink outline-none transition-colors focus:border-accent"
            />
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="primary"
                icon="save"
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
              <Button
                variant="secondary"
                icon="download"
                onClick={() => api.fsExport(serverId, open.rel)}
              >
                Save a copy
              </Button>
              {draft !== open.text && (
                <span className="text-2xs text-warn-soft">Unsaved changes</span>
              )}
            </div>
          </>
        )}
        <ErrorBanner message={error} onDismiss={() => setError(null)} className="mt-2" />
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
              className={cx(
                "rounded-sm px-1.5 py-1 font-medium transition-colors",
                c === dir
                  ? "bg-surface-3 text-ink"
                  : "text-ink-faint hover:bg-surface-2 hover:text-ink",
              )}
            >
              {i === 0 ? "server" : c.split("/").pop()}
            </button>
          </span>
        ))}
        <span className="flex-1" />
        <Button
          variant="ghost"
          disabled={busy}
          icon="plus"
          onClick={() => {
            setMkdirName("");
            setMkdirOpen(true);
          }}
        >
          Folder
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          icon="upload"
          onClick={() =>
            guard(async () => {
              const added = await api.fsImport(serverId, dir);
              if (added) toast.ok(`Added ${added.length} file(s)`, added.join(", "));
            })
          }
        >
          Add files
        </Button>
      </div>

      {note && (
        <Banner tone="ok" className="mb-2" onDismiss={() => setNote(null)}>
          {note}
        </Banner>
      )}
      <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-2" />

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line-soft bg-surface shadow-e1">
        {!listing ? (
          <StateBlock state="loading" title="Reading the folder…" compact />
        ) : listing.entries.length === 0 ? (
          <StateBlock
            state="empty"
            icon="folder-open"
            title="Nothing in here"
            message="Use “Add files” to drop something in."
            compact
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {listing.entries.map((e) => (
              <li
                key={e.rel}
                className="group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-2"
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  onClick={() => (e.isDir ? setDir(e.rel) : openFile(e.rel))}
                >
                  <span
                    className={cx(
                      "grid h-7 w-7 shrink-0 place-items-center rounded-md",
                      e.isDir
                        ? "bg-accent-muted text-accent-soft"
                        : "bg-surface-2 text-ink-faint",
                    )}
                  >
                    <Icon name={e.isDir ? "folder" : "file"} size={14} />
                  </span>
                  <span className="truncate text-sm text-ink">{e.name}</span>
                  {!e.isDir && (
                    <span className="shrink-0 text-2xs tabular-nums text-ink-faint">
                      {size(e.size)}
                    </span>
                  )}
                </button>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  {!e.isDir && (
                    <Tooltip label="Save a copy somewhere else">
                      <IconButton
                        icon="download"
                        title="Save a copy"
                        size="sm"
                        onClick={() => api.fsExport(serverId, e.rel)}
                      />
                    </Tooltip>
                  )}
                  <IconButton
                    icon="type"
                    title="Rename"
                    size="sm"
                    onClick={() => {
                      setRenaming(e);
                      setRenameTo(e.rel);
                    }}
                  />
                  <IconButton
                    icon="trash"
                    title="Move to trash"
                    size="sm"
                    className="hover:text-bad"
                    onClick={() => setDeleting(e)}
                  />
                </div>
                {e.isDir && (
                  <Icon
                    name="chevron-right"
                    size={13}
                    className="shrink-0 text-ink-ghost"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-2xs text-ink-faint">
        <Icon name="shield" size={11} />
        Deleting moves things to <code>.craftpanel-trash/</code> — nothing is
        erased for good.
      </p>

      {mkdirOpen && (
        <Modal
          title="New folder"
          icon="folder"
          size="sm"
          onClose={() => setMkdirOpen(false)}
          footer={
            <>
              <Button
                variant="quiet"
                className="mr-auto"
                onClick={() => setMkdirOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                icon="plus"
                disabled={!mkdirName.trim()}
                onClick={() => {
                  const name = mkdirName.trim();
                  setMkdirOpen(false);
                  guard(
                    () => api.fsMkdir(serverId, dir ? `${dir}/${name}` : name),
                    "Folder created.",
                  );
                }}
              >
                Create
              </Button>
            </>
          }
        >
          <Field
            label="Name"
            hint={`Created inside ${dir || "the server folder"}.`}
          >
            <TextInput
              autoFocus
              value={mkdirName}
              placeholder="datapacks"
              onChange={(ev) => setMkdirName(ev.target.value)}
            />
          </Field>
        </Modal>
      )}

      {renaming && (
        <Modal
          title={`Rename “${renaming.name}”`}
          icon="type"
          size="sm"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <Button
                variant="quiet"
                className="mr-auto"
                onClick={() => setRenaming(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                icon="save"
                disabled={!renameTo.trim() || renameTo === renaming.rel}
                onClick={() => {
                  const from = renaming.rel;
                  const to = renameTo.trim();
                  setRenaming(null);
                  guard(() => api.fsRename(serverId, from, to), "Renamed.");
                }}
              >
                Rename
              </Button>
            </>
          }
        >
          <Field
            label="New path"
            hint="Relative to the server folder. Include a folder name to move it."
          >
            <TextInput
              autoFocus
              mono
              value={renameTo}
              onChange={(ev) => setRenameTo(ev.target.value)}
            />
          </Field>
        </Modal>
      )}

      {deleting && (
        <Modal
          title={`Move “${deleting.name}” to the trash?`}
          icon="trash"
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button
                variant="quiet"
                className="mr-auto"
                onClick={() => setDeleting(null)}
              >
                Keep it
              </Button>
              <Button
                variant="danger"
                icon="trash"
                onClick={() => {
                  const rel = deleting.rel;
                  setDeleting(null);
                  guard(() => api.fsDelete(serverId, rel), "Moved to trash.");
                }}
              >
                Move to trash
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-dim">
            It moves to <code>.craftpanel-trash/</code> inside the server folder.
            Nothing is deleted for good, so you can put it back by hand.
          </p>
        </Modal>
      )}
    </div>
  );
}
