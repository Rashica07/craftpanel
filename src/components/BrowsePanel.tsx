import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ModrinthInstalled, ModrinthSearch, ServerType } from "../types";
import { Badge, Button } from "./ui";
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
      <div className="mb-2 flex gap-1.5">
        <div className="flex rounded-md border border-edge bg-panel-2 p-0.5 text-xs">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setPtype(t.id)}
              className={`rounded px-2 py-1 ${
                ptype === t.id ? "bg-accent text-black" : "text-ink-dim hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-1.5 rounded-md border border-edge bg-panel-2 px-2">
          <Icon name="search" size={13} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
            placeholder="Search Modrinth…"
            className="flex-1 bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>

      {note && <div className="mb-2 rounded bg-panel-2 px-2 py-1 text-xs text-ink-dim">{note}</div>}
      {error && (
        <div className="mb-2 rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {res?.hits.map((h) => (
          <div key={h.projectId} className="flex gap-2 rounded-md border border-edge bg-panel-2 p-2">
            {h.iconUrl ? (
              <img src={h.iconUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded bg-panel-3" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={`truncate text-sm font-medium ${!h.compatible ? "text-ink-faint" : ""}`}>
                  {h.title}
                </span>
                <span className="text-[10px] text-ink-faint">↓ {num(h.downloads)}</span>
                {!h.compatible && <Badge tone="warn">no build for your version</Badge>}
                {h.serverSide === "optional" && h.compatible && (
                  <span className="text-[10px] text-ink-faint">client-optional</span>
                )}
              </div>
              <p className="line-clamp-2 text-[11px] leading-snug text-ink-faint">{h.description}</p>
            </div>
            <div className="shrink-0 self-center">
              {h.installed ? (
                <Badge tone="ok">installed</Badge>
              ) : h.compatible ? (
                <Button
                  variant="subtle"
                  disabled={!!busy}
                  onClick={() => install(h.projectId, h.title)}
                >
                  {busy === h.projectId ? "…" : "Install"}
                </Button>
              ) : (
                <span className="text-[10px] text-ink-faint">—</span>
              )}
            </div>
          </div>
        ))}
        {res && res.hits.length === 0 && (
          <div className="px-2 py-4 text-xs text-ink-faint">Nothing found.</div>
        )}
        {!res && <div className="px-2 py-4 text-xs text-ink-faint">Search to browse.</div>}
      </div>

      {installed.length > 0 && (
        <div className="mt-2 border-t border-edge pt-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-ink-faint">
              Installed via CraftPanel ({installed.length})
              {updates.length > 0 && (
                <span className="ml-1 text-warn">· {updates.length} update{updates.length > 1 ? "s" : ""}</span>
              )}
            </span>
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() =>
                act(() => api.modrinthCheckUpdates(serverId), "Checked for updates.", "chk")
              }
            >
              {busy === "chk" ? "Checking…" : "Check updates"}
            </Button>
          </div>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {installed.map((i) => (
              <li
                key={i.projectId}
                className="flex items-center gap-2 rounded bg-panel-2 px-2 py-1 text-xs"
              >
                <span className="flex-1 truncate">
                  {i.title}
                  {i.dependency && <span className="ml-1 text-ink-faint">(dependency)</span>}
                  <span className="ml-1 font-mono text-[10px] text-ink-faint">{i.versionNumber}</span>
                </span>
                {i.update && (
                  <Button
                    variant="subtle"
                    disabled={!!busy}
                    onClick={() =>
                      act(() => api.modrinthUpdate(serverId, i.projectId), `Updated ${i.title}.`, i.projectId)
                    }
                  >
                    Update
                  </Button>
                )}
                <button
                  className="text-ink-faint hover:text-bad"
                  disabled={!!busy}
                  onClick={() =>
                    act(() => api.modrinthRemove(serverId, i.projectId), `Removed ${i.title}.`, i.projectId)
                  }
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
