import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ModList } from "../types";
import {
  Badge,
  Banner,
  Button,
  Card,
  IconButton,
  StateBlock,
  Toggle,
  Tooltip,
  cx,
  toast,
} from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { Icon } from "./Icon";

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
    api
      .listMods(serverId)
      .then(setList)
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

  async function pickAndImport() {
    const files = await api.pickJars();
    if (files?.length)
      await guard(
        () => api.importMods(serverId, files),
        `Added ${files.length} mod${files.length > 1 ? "s" : ""}.`,
      );
  }

  if (list && !list.supported) {
    return (
      <Card>
        <StateBlock
          state="empty"
          icon="package"
          title="This server doesn't use a mods folder"
          message={
            list.warnings[0] ??
            "Paper, Spigot and Vanilla load plugins or nothing at all — check the Add-ons tab instead."
          }
        />
      </Card>
    );
  }

  const enabled = list?.mods.filter((m) => m.enabled).length ?? 0;
  const disabled = (list?.mods.length ?? 0) - enabled;

  return (
    <div className="cp-stagger h-full space-y-3 overflow-y-auto pr-1">
      {/* drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          // Tauri delivers dropped paths through its own file-drop event, not
          // the DOM one — the picker is the reliable route, so point there.
          toast.show("Use “Choose .jar files”", "Drag-and-drop needs the picker in the desktop app.");
        }}
        className={cx(
          "rounded-xl border-2 border-dashed p-6 text-center transition-colors duration-[120ms]",
          dragOver
            ? "border-accent bg-accent-muted"
            : "border-line bg-surface/40 hover:border-line-strong",
        )}
      >
        <div className="relative mx-auto mb-3 w-fit">
          <div className="cp-pixels absolute -inset-2 rounded-lg opacity-40" />
          <div className="relative grid h-11 w-11 place-items-center rounded-lg border border-line-soft bg-surface-2 text-accent">
            <Icon name="package" size={20} />
          </div>
        </div>
        <h3 className="font-display text-sm font-semibold text-ink">
          Add mods to this server
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-2xs leading-relaxed text-ink-faint">
          Drop in <code>.jar</code> files you downloaded yourself — or use the{" "}
          <strong>Add-ons</strong> tab to install from Modrinth with dependencies
          sorted out for you.
        </p>
        <Button
          variant="primary"
          icon="plus"
          className="mt-3"
          onClick={pickAndImport}
          disabled={busy}
        >
          Choose .jar files…
        </Button>
      </div>

      {list?.authMods.length ? (
        <Banner tone="ok" icon="shield" title="Offline-login protection is on">
          {list.authMods.join(", ")} — players are asked for a password, so
          nobody can join pretending to be someone else.
        </Banner>
      ) : null}

      {list?.warnings.map((w, i) => (
        <Banner key={i} tone="warn">
          {w}
        </Banner>
      ))}

      <Card
        title="Installed mods"
        icon="package"
        description="Every mod has to be installed on your friends' computers too, at the same version."
        right={
          list && (
            <div className="flex items-center gap-1.5">
              {list.fabricApiPresent && (
                <Tooltip label="Most Fabric mods need this to work at all">
                  <Badge tone="ok" icon="check">
                    Fabric API
                  </Badge>
                </Tooltip>
              )}
              <Badge tone="neutral">
                {enabled} on{disabled ? ` · ${disabled} off` : ""}
              </Badge>
            </div>
          )
        }
        pad={false}
      >
        {!list ? (
          <StateBlock state="loading" title="Reading the mods folder…" compact />
        ) : list.mods.length === 0 ? (
          <StateBlock
            state="empty"
            icon="package"
            title="No mods installed"
            message="Add a .jar above, or browse Modrinth in the Add-ons tab."
            compact
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {list.mods.map((m) => (
              <li
                key={m.name}
                className={cx(
                  "group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2",
                  !m.enabled && "opacity-55",
                )}
              >
                <Tooltip
                  label={
                    m.enabled
                      ? "Loaded at start-up"
                      : "Parked in mods-disabled/ — not loaded"
                  }
                >
                  <Toggle
                    checked={m.enabled}
                    disabled={busy}
                    label={m.name}
                    onChange={(v) =>
                      guard(() => api.setModEnabled(serverId, m.name, v))
                    }
                  />
                </Tooltip>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                  {m.name}
                </span>
                <span className="shrink-0 text-2xs tabular-nums text-ink-ghost">
                  {mb(m.size)}
                </span>
                <IconButton
                  icon="trash"
                  title="Move to the trash folder"
                  size="sm"
                  disabled={busy}
                  className="opacity-0 transition-opacity hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() =>
                    guard(
                      () => api.removeMod(serverId, m.name),
                      `Removed ${m.name}.`,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-start gap-1.5 border-t border-line-soft px-3.5 py-2.5 text-2xs leading-relaxed text-ink-faint">
          <Icon name="shield" size={11} className="mt-px shrink-0" />
          Switching a mod off moves it to <code>mods-disabled/</code>; removing
          one moves it to <code>.craftpanel-trash/</code>. Nothing is ever
          permanently deleted.
        </p>
      </Card>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
    </div>
  );
}
