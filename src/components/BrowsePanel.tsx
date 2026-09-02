import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { ModrinthInstalled, ModrinthSearch, ServerType } from "../types";
import {
  Badge,
  Banner,
  Button,
  Card,
  IconButton,
  Pill,
  Segmented,
  Spinner,
  StateBlock,
  TextInput,
  Tooltip,
  cx,
} from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { Icon } from "./Icon";
import { ResourcePackSection } from "./ResourcePackSection";

function num(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

const LOADER_NAME: Record<ServerType, string> = {
  fabric: "Fabric",
  forge: "Forge",
  paper: "Paper",
  spigot: "Spigot",
  vanilla: "Vanilla",
  bedrock: "Bedrock",
};

/**
 * Fabric/Forge check every joining client's mod list against the server's and
 * refuse the connection with a clear reason if something required is
 * missing — that's built into the loader's own handshake, nothing CraftPanel
 * has to do. Paper/Spigot plugins have no such mechanism: a player missing a
 * required client mod just joins and something silently doesn't work, so the
 * admin has to tell people themselves.
 */
function enforcesClientModsFor(t: ServerType): boolean {
  return t === "fabric" || t === "forge";
}

/**
 * Real Modrinth categories, not invented ones (confirmed live against
 * `/v2/tag/category`) — shared taxonomy across mods, plugins, datapacks.
 * "Minigame" is the one that actually matters here: it's what separates a
 * complete gamemode someone can drop in and play (BedWars, a skyblock
 * plugin) from an everyday utility plugin like EssentialsX or WorldEdit.
 * There's no Modrinth equivalent of a modpack for plugins — no bundled
 * "plugin pack" format exists — so this filter is the real substitute:
 * point straight at the complete-gamemode plugins instead of hoping the
 * right one turns up in a text search.
 */
const CATEGORIES: { id: string; label: string }[] = [
  { id: "minigame", label: "Minigame" },
  { id: "economy", label: "Economy" },
  { id: "management", label: "Management" },
  { id: "utility", label: "Utility" },
  { id: "social", label: "Social" },
  { id: "game-mechanics", label: "Mechanics" },
  { id: "worldgen", label: "World gen" },
  { id: "adventure", label: "Adventure" },
];

/**
 * Real resource-pack categories (confirmed live against `/v2/tag/category`,
 * filtered to `project_type: "resourcepack"`) — resolution and style are
 * what actually matters when picking a *look*, not the gameplay categories
 * above that make sense for mods/plugins instead.
 */
const RESOURCEPACK_CATEGORIES: { id: string; label: string }[] = [
  { id: "8x-", label: "8x-" },
  { id: "16x", label: "16x" },
  { id: "32x", label: "32x" },
  { id: "64x", label: "64x" },
  { id: "128x", label: "128x" },
  { id: "256x", label: "256x" },
  { id: "512x+", label: "512x+" },
  { id: "vanilla-like", label: "Vanilla-like" },
  { id: "realistic", label: "Realistic" },
  { id: "simplistic", label: "Simplistic" },
  { id: "themed", label: "Themed" },
  { id: "modded", label: "Modded" },
];

/** Not loader-specific — works the same for every Java server type. */
const RESOURCEPACK_TAB = { id: "resourcepack", label: "Resource Packs" };

function typesFor(t: ServerType): { id: string; label: string }[] {
  if (t === "vanilla") return [{ id: "datapack", label: "Datapacks" }, RESOURCEPACK_TAB];
  const primary =
    t === "paper" || t === "spigot"
      ? { id: "mod", label: "Plugins" }
      : { id: "mod", label: "Mods" };
  // "Modpacks" used to be a search category here, but installing a modpack
  // into an already-created server never really worked — a pack dictates
  // its own loader + Minecraft version, which can't change after the fact.
  // It's a real create-time flow now (see the wizard's Modpack step).
  return [primary, { id: "datapack", label: "Datapacks" }, RESOURCEPACK_TAB];
}

export function BrowsePanel({
  serverId,
  serverType,
  onNeedsRestart,
  initialQuery,
}: {
  serverId: string;
  serverType: ServerType;
  onNeedsRestart: () => void;
  /** jump straight to a search — e.g. the crash banner's "find the missing
   * dependency" action. Only applied once, on mount. */
  initialQuery?: string;
}) {
  const tabs = typesFor(serverType);
  const [ptype, setPtype] = useState(tabs[0].id);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery ?? "");
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
    setQuery(initialQuery ?? "");
    setCategory(null);
    setError(null);
    setNote(null);
    loadInstalled();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialQuery
    // is deliberately a one-time seed on mount/server-switch, not a value
    // to keep resyncing on every render
  }, [serverId, loadInstalled]);

  // switching tabs (Mods <-> Datapacks, or between servers) clears a
  // category filter that may not even apply to the new tab
  useEffect(() => {
    setCategory(null);
  }, [ptype]);

  const doSearch = useCallback(async () => {
    setError(null);
    try {
      setRes(await api.modrinthSearch(serverId, query, ptype, category));
    } catch (e) {
      setError(String(e));
    }
  }, [serverId, query, ptype, category]);

  useEffect(() => {
    const t = setTimeout(doSearch, query ? 350 : 0);
    return () => clearTimeout(t);
  }, [doSearch, query, ptype, category]);

  const [rpRefresh, setRpRefresh] = useState(0);
  const [preview, setPreview] = useState<{ projectId: string; title: string; images: string[] | null } | null>(
    null,
  );

  function previewPack(projectId: string, title: string) {
    setPreview({ projectId, title, images: null });
    api
      .modrinthGallery(projectId)
      .then((images) =>
        setPreview((cur) => (cur?.projectId === projectId ? { projectId, title, images } : cur)),
      )
      .catch(() =>
        setPreview((cur) => (cur?.projectId === projectId ? { projectId, title, images: [] } : cur)),
      );
  }

  async function useAsResourcePack(projectId: string, title: string) {
    setBusy(projectId);
    setError(null);
    setNote(`Setting ${title} as this server's resource pack…`);
    try {
      await api.modrinthInstallResourcePack(serverId, projectId, "", false);
      setNote(`${title} is now this server's resource pack.`);
      setRpRefresh((n) => n + 1);
    } catch (e) {
      setError(String(e));
      setNote(null);
    } finally {
      setBusy(null);
    }
  }

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
  const enforcesClientMods = enforcesClientModsFor(serverType);

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

      {ptype === "resourcepack" && (
        <ResourcePackSection key={rpRefresh} serverId={serverId} className="mb-3" />
      )}

      {ptype !== "datapack" && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <Pill active={category === null} onClick={() => setCategory(null)}>
            All
          </Pill>
          {(ptype === "resourcepack" ? RESOURCEPACK_CATEGORIES : CATEGORIES).map((c) => (
            <Pill
              key={c.id}
              active={category === c.id}
              onClick={() => setCategory((cur) => (cur === c.id ? null : c.id))}
            >
              {c.label}
            </Pill>
          ))}
        </div>
      )}

      {note && (
        <Banner tone="ok" className="mb-2" onDismiss={() => setNote(null)}>
          {note}
        </Banner>
      )}
      <ErrorBanner message={error} onDismiss={() => setError(null)} className="mb-2" />

      {/* ── results ──────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line-soft bg-surface shadow-e1">
        {!res || (!query.trim() && res.hits.length === 0) ? (
          <StateBlock
            state="empty"
            icon="search"
            title={ptype === "resourcepack" ? "Find a resource pack" : "Find mods and plugins"}
            message={
              ptype === "resourcepack"
                ? "Search Modrinth's resource packs — picking one sets it as this server's pack directly, no download or hosting needed on your end."
                : "Everything here comes from Modrinth, and CraftPanel picks the build that matches your Minecraft version — dependencies included."
            }
          />
        ) : res.hits.length === 0 ? (
          <StateBlock
            state="empty"
            icon="search"
            title={query.trim() ? `Nothing called "${query}"` : "Nothing in this category"}
            message={
              category
                ? `No results with the "${(ptype === "resourcepack" ? RESOURCEPACK_CATEGORIES : CATEGORIES).find((c) => c.id === category)?.label}" filter on. Try "All", or a different search.`
                : "Try a shorter search, or switch between mods and plugins above."
            }
            compact
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {res.hits.map((h) => {
              const resolution =
                ptype === "resourcepack"
                  ? RESOURCEPACK_CATEGORIES.find((r) => r.label.includes("x") && h.categories.includes(r.id))
                  : undefined;
              return (
              <li
                key={h.projectId}
                className={cx(
                  "flex gap-3 px-3.5 py-3 transition-colors hover:bg-surface-2",
                  !h.compatible && "opacity-60",
                )}
              >
                {(() => {
                  const size = ptype === "resourcepack" ? "h-16 w-16" : "h-11 w-11";
                  const clickable = ptype === "resourcepack";
                  const content = h.iconUrl ? (
                    <img
                      src={h.iconUrl}
                      alt=""
                      loading="lazy"
                      className={cx(size, "shrink-0 rounded-lg border border-line-soft object-cover")}
                    />
                  ) : (
                    <div
                      className={cx(
                        size,
                        "grid shrink-0 place-items-center rounded-lg border border-line-soft bg-surface-2 text-ink-ghost",
                      )}
                    >
                      <Icon name="package" size={18} />
                    </div>
                  );
                  return clickable ? (
                    <Tooltip label="Preview screenshots">
                      <button
                        onClick={() => previewPack(h.projectId, h.title)}
                        className="group relative shrink-0 overflow-hidden rounded-lg"
                      >
                        {content}
                        <span className="absolute inset-0 grid place-items-center bg-black/0 text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white">
                          <Icon name="eye" size={16} />
                        </span>
                      </button>
                    </Tooltip>
                  ) : (
                    content
                  );
                })()}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-ink">
                      {h.title}
                    </span>
                    {resolution && (
                      <Badge tone="neutral" size="sm">
                        {resolution.label}
                      </Badge>
                    )}
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
                    {h.clientSide === "required" && h.compatible && (
                      <Tooltip
                        label={
                          enforcesClientMods
                            ? `Everyone joining needs this installed too — ${LOADER_NAME[serverType]} won't let a player in without it, so they'll see a clear reason if they forget.`
                            : "Everyone joining needs this installed too — Paper/Spigot can't enforce that, so tell your friends yourself (the Network tab's join info is a good place)."
                        }
                      >
                        <Badge tone="warn" size="sm" icon="alert">
                          Players need this too
                        </Badge>
                      </Tooltip>
                    )}
                    {h.clientSide === "optional" &&
                      h.serverSide === "optional" &&
                      h.compatible && (
                        <Tooltip label="Works fine either way — your friends get more out of it if they install it too, but nothing breaks if they don't.">
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

                <div className="flex shrink-0 items-center gap-1.5">
                  <Tooltip label="View on Modrinth">
                    <a
                      href={`https://modrinth.com/${h.projectType}/${h.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="grid h-8 w-8 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface-3 hover:text-ink"
                    >
                      <Icon name="external-link" size={14} />
                    </a>
                  </Tooltip>
                  {ptype === "resourcepack" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="check"
                      disabled={!!busy}
                      loading={busy === h.projectId}
                      onClick={() => useAsResourcePack(h.projectId, h.title)}
                    >
                      Use this pack
                    </Button>
                  ) : h.installed ? (
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
              );
            })}
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

      {preview &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
            onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}
          >
            <div className="cp-in flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-e3">
              <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {preview.title}
                </span>
                <IconButton icon="x" title="Close" size="sm" onClick={() => setPreview(null)} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {preview.images === null ? (
                  <div className="flex h-40 items-center justify-center">
                    <Spinner size={18} />
                  </div>
                ) : preview.images.length === 0 ? (
                  <StateBlock
                    state="empty"
                    icon="image"
                    title="No screenshots"
                    message="This pack's page doesn't have any gallery images — check its Modrinth page instead."
                    compact
                  />
                ) : (
                  <div className="space-y-3">
                    {preview.images.map((src) => (
                      <img
                        key={src}
                        src={src}
                        alt=""
                        loading="lazy"
                        className="w-full rounded-lg border border-line-soft"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
