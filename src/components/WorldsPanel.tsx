import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { World, WorldInfo } from "../types";
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
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
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} MB`;
  if (n > 0) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return "not generated yet";
}

export function WorldsPanel({
  serverId,
  locked,
}: {
  serverId: string;
  locked: boolean;
}) {
  const [info, setInfo] = useState<WorldInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newSeed, setNewSeed] = useState("");
  const [renaming, setRenaming] = useState<World | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [deleting, setDeleting] = useState<World | null>(null);

  const load = useCallback(() => {
    api
      .listWorlds(serverId)
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  async function guard(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (ok) toast.ok(ok);
      load();
    } catch (e) {
      setError(String(e));
      toast.bad("That didn't work", String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cp-stagger h-full space-y-3 overflow-y-auto pr-1">
      {locked && (
        <Banner tone="warn" icon="lock">
          Stop the server to switch, rename, create or delete worlds — Minecraft
          holds the files open while it's running.
        </Banner>
      )}

      <Card
        title="Worlds"
        icon="globe"
        description="Each world is its own folder. Only the active one is loaded when the server starts."
        pad={false}
      >
        {!info ? (
          <StateBlock state="loading" title="Looking for worlds…" compact />
        ) : info.worlds.length === 0 ? (
          <StateBlock
            state="empty"
            icon="globe"
            title="No worlds yet"
            message="Minecraft generates one the first time the server boots."
            compact
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {info.worlds.map((w) => (
              <li key={w.name} className="px-3.5 py-3">
                <div className="flex items-start gap-3">
                  <span
                    className={cx(
                      "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md",
                      w.active
                        ? "bg-ok-muted text-ok"
                        : "bg-surface-2 text-ink-faint",
                    )}
                  >
                    <Icon name={w.active ? "grass" : "map"} size={15} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-ink">
                        {w.name}
                      </span>
                      {w.active && (
                        <Badge tone="ok" size="sm" dot>
                          Active
                        </Badge>
                      )}
                      {w.hasNether && (
                        <Badge tone="neutral" size="sm">
                          Nether
                        </Badge>
                      )}
                      {w.hasEnd && (
                        <Badge tone="neutral" size="sm">
                          End
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs text-ink-faint">
                      <span className="flex items-center gap-1">
                        <Icon name="hard-drive" size={11} />
                        {size(w.sizeBytes)}
                      </span>
                      {w.seed && (
                        <span
                          data-selectable
                          className="flex items-center gap-1 font-mono"
                        >
                          <Icon name="dice" size={11} />
                          {w.seed}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {!w.active && (
                      <Tooltip label="Point the server at this world on the next start">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="play"
                          disabled={locked || busy}
                          onClick={() =>
                            guard(
                              () => api.worldSetActive(serverId, w.name),
                              `“${w.name}” is now the active world.`,
                            )
                          }
                        >
                          Use this
                        </Button>
                      </Tooltip>
                    )}
                    <Button
                      variant="quiet"
                      size="sm"
                      icon="type"
                      disabled={locked || busy}
                      onClick={() => {
                        setRenaming(w);
                        setRenameTo(w.name);
                      }}
                    >
                      Rename
                    </Button>
                    {!w.active && (
                      <Button
                        variant="quiet"
                        size="sm"
                        icon="trash"
                        disabled={locked || busy}
                        onClick={() => setDeleting(w)}
                        className="text-ink-faint hover:text-bad"
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Start a fresh world"
        icon="sparkle"
        description="Points the server at a new world name. It generates on the next start, and your current world folder is left alone."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="World name" hint="Letters, numbers and dashes.">
            <TextInput
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="season-4"
            />
          </Field>
          <Field label="Seed" hint="Blank gives you a random world.">
            <TextInput
              mono
              value={newSeed}
              onChange={(e) => setNewSeed(e.target.value)}
              placeholder="random"
            />
          </Field>
        </div>
        <Button
          variant="primary"
          icon="plus"
          className="mt-3"
          disabled={locked || busy || !newName.trim()}
          onClick={() =>
            guard(async () => {
              await api.worldCreate(serverId, newName, newSeed);
              setNewName("");
              setNewSeed("");
            }, "New world queued — start the server to generate it.")
          }
        >
          Create world
        </Button>
      </Card>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {/* In-app dialogs: window.prompt() is a no-op in Tauri's WKWebView, so
          the old browser prompts silently did nothing on macOS. */}
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
                disabled={!renameTo.trim() || renameTo === renaming.name || busy}
                onClick={() => {
                  const from = renaming.name;
                  const to = renameTo.trim();
                  setRenaming(null);
                  guard(
                    () => api.worldRename(serverId, from, to),
                    `Renamed to “${to}”.`,
                  );
                }}
              >
                Rename
              </Button>
            </>
          }
        >
          <Field
            label="New name"
            hint="Letters, numbers, dashes. This renames the folder on disk."
          >
            <TextInput
              autoFocus
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
            />
          </Field>
        </Modal>
      )}

      {deleting && (
        <Modal
          title={`Delete “${deleting.name}”?`}
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
                  const name = deleting.name;
                  setDeleting(null);
                  guard(
                    () => api.worldDelete(serverId, name),
                    `Moved “${name}” to the trash folder.`,
                  );
                }}
              >
                Move to trash
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-dim">
            It won't be gone for good — the folder moves to{" "}
            <code>.craftpanel-trash/</code> inside the server directory, so you
            can drag it back if you change your mind.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-2xs text-ink-faint">
            <Icon name="hard-drive" size={12} />
            {size(deleting.sizeBytes)} will stay on disk until you empty the
            trash folder yourself.
          </div>
        </Modal>
      )}
    </div>
  );
}
