import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ModrinthInstalled, ModrinthSearch, ServerType } from "../types";
import {
  Badge,
  Banner,
  Button,
  Card,
  IconButton,
  Segmented,
  StateBlock,
  TextInput,
  Tooltip,
  cx,
} from "./ui";
import { Icon } from "./Icon";

function num(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

function typesFor(t: ServerType): { id: string; label: string }[] {
  if (t === "vanilla") return [{ id: "datapack", label: "Datapacks" }];
  const primary =
    t === "paper" || t === "spigot"
      ? { id: "mod", label: "Plugins" }
      : { id: "mod", label: "Mods" };
  return [primary, { id: "datapack", label: "Datapacks" }, { id: "modpack", label: "Modpacks" }];
}

export function BrowsePanel({
  serverId,
  serverType,
  onNeedsRestart,
}: {
  serverId: string;
  serverType: ServerType;
  onNeedsRestart: () => void;
}) {
  const tabs = typesFor(serverType);
  const [ptype, setPtype] = useState(tabs[0].id);
  const [query, setQuery] = useState("");
  const [res, setRes] = useState<ModrinthSearch | null>(null);
  const [installed, setInstalled] = useState<ModrinthInstalled[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInstalled = useCallback(() => {
    api.modrinthInstalled(serverId).then(setInstalled).catch(() => {});
  }, [serverId]);

  useEffect(() => {
    setRes(null);
    setQuery("");
    setError(null);
    setNote(null);
    loadInstalled();
  }, [serverId, loadInstalled]);

  const doSearch = useCallback(async () => {
    setError(null);
    try {
      setRes(await api.modrinthSearch(serverId, query, ptype));
    } catch (e) {
      setError(String(e));
    }
  }, [serverId, query, ptype]);

  useEffect(() => {
    const t = setTimeout(doSearch, query ? 350 : 0);
    return () => clearTimeout(t);
  }, [doSearch, query, ptype]);

  async function install(projectId: string, title: string) {
    setBusy(projectId);
    setError(null);
    setNote(`Installing ${title}…`);
    try {
      const r = await api.modrinthInstall(serverId, projectId, ptype);
      const extra = r.installed.length - 1;
      setNote(
        `Installed ${title}${extra > 0 ? ` + ${extra} ${extra === 1 ? "dependency" : "dependencies"}` : ""}.`,
      );
      onNeedsRestart();
      doSearch();
      loadInstalled();
    } catch (e) {
      setError(String(e));
      setNote(null);
    } finally {
      setBusy(null);
    }
  }

  async function act(fn: () => Promise<unknown>, msg: string, key: string) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(msg);
      onNeedsRestart();
      loadInstalled();
      doSearch();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const updates = installed.filter((i) => i.update);

  return (
    <div className="flex h-full flex-col">
      {/* ── search bar ───────────────────────────────────────────── */}
      <div className="mb-3 flex gap-2">
        <Segmented
          value={ptype}
          onChange={setPtype}
          options={tabs.map((t) => ({ value: t.id, label: t.label }))}
        />
        <TextInput
          icon="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
          placeholder="Search Modrinth — try “worldedit” or “shopkeepers”…"
        />
        <Button variant="secondary" icon="search" onClick={doSearch}>
          Search
        </Button>
      </div>

      {note && (
        <Banner tone="ok" className="mb-2" onDismiss={() => setNote(null)}>
          {note}
        </Banner>
      )}
      {error && (
        <Banner tone="bad" className="mb-2" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {/* ── results ──────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line-soft bg-surface shadow-e1">
        {!res || (!query.trim() && res.hits.length === 0) ? (
          <StateBlock
            state="empty"
            icon="search"
            title="Find mods and plugins"
            message="Everything here comes from Modrinth, and CraftPanel picks the build that matches your Minecraft version — dependencies included."
          />
        ) : res.hits.length === 0 ? (
          <StateBlock
            state="empty"
            icon="search"
            title={`Nothing called “${query}”`}
            message="Try a shorter search, or switch between mods and plugins above."
            compact
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {res.hits.map((h) => (
              <li
                key={h.projectId}
                className={cx(
                  "flex gap-3 px-3.5 py-3 transition-colors hover:bg-surface-2",
                  !h.compatible && "opacity-60",
                )}
              >
                {h.iconUrl ? (
                  <img
                    src={h.iconUrl}
                    alt=""
                    loading="lazy"
                    className="h-11 w-11 shrink-0 rounded-lg border border-line-soft object-cover"
                  />
                ) : (
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line-soft bg-surface-2 text-ink-ghost">
                    <Icon name="package" size={18} />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-ink">
                      {h.title}
                    </span>
                    <span className="flex items-center gap-0.5 text-2xs text-ink-faint">
                      <Icon name="download" size={10} />
                      {num(h.downloads)}
                    </span>
                    {!h.compatible && (
                      <Tooltip label="Nobody has published a build of this for your Minecraft version yet.">
                        <Badge tone="warn" size="sm" icon="alert">
                          Not for {`this version`}
                        </Badge>
                      </Tooltip>
                    )}
                    {h.serverSide === "optional" && h.compatible && (
                      <Tooltip label="Works on the server, but your friends get more out of it if they install it too.">
                        <Badge tone="neutral" size="sm">
                          Better with client
                        </Badge>
                      </Tooltip>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-2xs leading-snug text-ink-faint">
                    {h.description}
                  </p>
                </div>

                <div className="flex shrink-0 items-center">
                  {h.installed ? (
                    <Badge tone="ok" icon="check">
                      Installed
                    </Badge>
                  ) : h.compatible ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="download"
                      disabled={!!busy}
                      loading={busy === h.projectId}
                      onClick={() => install(h.projectId, h.title)}
                    >
                      Install
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── what CraftPanel installed ────────────────────────────── */}
      {installed.length > 0 && (
        <Card
          className="mt-3 shrink-0"
          title="Installed from here"
          icon="check-circle"
          tone={updates.length ? "warn" : undefined}
          right={
            <>
              {updates.length > 0 && (
                <Badge tone="warn" dot>
                  {updates.length} update{updates.length > 1 ? "s" : ""}
                </Badge>
              )}
              <Button
                variant="quiet"
                size="sm"
                icon="refresh"
                disabled={!!busy}
                loading={busy === "chk"}
                onClick={() =>
                  act(
                    () => api.modrinthCheckUpdates(serverId),
                    "Checked for updates.",
                    "chk",
                  )
                }
              >
                Check for updates
              </Button>
            </>
          }
          pad={false}
        >
          <ul className="max-h-44 divide-y divide-line-soft overflow-y-auto">
            {installed.map((i) => (
              <li
                key={i.projectId}
                className="group flex items-center gap-2 px-3.5 py-2 transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-ink">
                  {i.title}
                  {i.dependency && (
                    <Tooltip label="Installed automatically because something else needed it">
                      <span className="ml-1.5 text-2xs text-ink-ghost">
                        (needed by another mod)
                      </span>
                    </Tooltip>
                  )}
                </span>
                <span className="shrink-0 font-mono text-2xs text-ink-faint">
                  {i.versionNumber}
                </span>
                {i.update && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="arrow-up"
                    disabled={!!busy}
                    loading={busy === i.projectId}
                    onClick={() =>
                      act(
                        () => api.modrinthUpdate(serverId, i.projectId),
                        `Updated ${i.title}.`,
                        i.projectId,
                      )
                    }
                  >
                    {i.update.versionNumber}
                  </Button>
                )}
                <IconButton
                  icon="trash"
                  title={`Remove ${i.title}`}
                  size="sm"
                  disabled={!!busy}
                  className="opacity-0 transition-opacity hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() =>
                    act(
                      () => api.modrinthRemove(serverId, i.projectId),
                      `Removed ${i.title}.`,
                      i.projectId,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
