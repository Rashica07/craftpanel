import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProcSnapshot, ServerRecord, ServerStatus } from "../types";
import { Icon } from "./Icon";
import { StatusDot, cx } from "./ui";
import { statusOf } from "../useRuntimes";
import type { Tab as ServerTab } from "./ServerDetail";

// Local copy of App.tsx's STATUS_TONE map — deliberately not imported from
// App.tsx, which itself renders this component: importing back would make
// the two modules circular.
const STATUS_TONE: Record<ServerStatus, "ok" | "warn" | "bad" | "neutral"> = {
  running: "ok",
  starting: "warn",
  stopping: "warn",
  crashed: "bad",
  stopped: "neutral",
  unknown: "neutral",
};

interface Command {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: string;
  section: string;
  run: () => void;
}

/** Simple, dependency-free fuzzy score: exact > prefix > substring >
 * in-order-subsequence. Good enough for a few dozen commands — no need for
 * a real fuzzy-match library at this scale. */
function score(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 20 : 0;
}

const TAB_DEFS: { id: ServerTab; label: string; icon: string; hidden?: (s: ServerRecord) => boolean }[] = [
  { id: "console", label: "Console", icon: "terminal" },
  { id: "network", label: "Network", icon: "signal" },
  { id: "players", label: "Players", icon: "users", hidden: (s) => s.server_type === "bedrock" },
  { id: "settings", label: "Settings", icon: "sliders" },
  { id: "browse", label: "Add-ons", icon: "sparkle", hidden: (s) => s.server_type === "bedrock" },
  { id: "mods", label: "Mods", icon: "package", hidden: (s) => !["fabric", "forge"].includes(s.server_type) },
  { id: "worlds", label: "Worlds", icon: "globe", hidden: (s) => s.server_type === "bedrock" },
  { id: "backups", label: "Backups", icon: "archive" },
  { id: "files", label: "Files", icon: "folder" },
];

export function CommandPalette({
  open,
  onClose,
  servers,
  runtimes,
  onGoToServer,
  onOpenSettings,
  onOpenDashboard,
  onCreate,
  onAdd,
  onJoin,
  onQuickStart,
  onStart,
  onStop,
}: {
  open: boolean;
  onClose: () => void;
  servers: ServerRecord[];
  runtimes: Record<string, ProcSnapshot>;
  onGoToServer: (id: string, tab?: ServerTab) => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  onCreate: () => void;
  onAdd: () => void;
  onJoin: () => void;
  onQuickStart: () => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // let the portal paint first, or focus() lands on nothing
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const commands = useMemo<Command[]>(() => {
    const out: Command[] = [];

    out.push({ id: "create", label: "New server", icon: "plus", section: "Create", run: onCreate });
    out.push({ id: "add", label: "Add an existing folder", icon: "folder-open", section: "Create", run: onAdd });
    out.push({ id: "join", label: "Join a shared world", icon: "link", section: "Create", run: onJoin });
    out.push({ id: "quick", label: "Quick start", hint: "Skyblock, Bedwars, Survival", icon: "sparkle", section: "Create", run: onQuickStart });

    if (servers.length > 1) {
      out.push({ id: "dashboard", label: "Open Overview", icon: "monitor", section: "Go to", run: onOpenDashboard });
    }
    out.push({ id: "settings", label: "Open CraftPanel settings", icon: "gear", section: "Go to", run: onOpenSettings });

    for (const s of servers) {
      const status: ServerStatus = statusOf(runtimes, s.id);
      const running = status === "running" || status === "starting" || status === "stopping";
      out.push({
        id: `open-${s.id}`,
        label: `Open ${s.name}`,
        hint: s.mc_version ?? s.server_type,
        keywords: s.server_type,
        icon: "server",
        section: "Go to",
        run: () => onGoToServer(s.id),
      });
      out.push({
        id: `power-${s.id}`,
        label: `${s.name}: ${running ? "Stop" : "Start"}`,
        icon: running ? "stop" : "play",
        section: "Actions",
        run: () => (running ? onStop(s.id) : onStart(s.id)),
      });
      for (const t of TAB_DEFS) {
        if (t.hidden?.(s)) continue;
        out.push({
          id: `tab-${s.id}-${t.id}`,
          label: `${s.name} → ${t.label}`,
          icon: t.icon,
          section: "Go to",
          run: () => onGoToServer(s.id, t.id),
        });
      }
    }
    return out;
  }, [servers, runtimes, onCreate, onAdd, onJoin, onQuickStart, onOpenDashboard, onOpenSettings, onGoToServer, onStart, onStop]);

  const results = useMemo(() => {
    if (!query.trim()) {
      // no query: keep it short — creation + go-to-server only, not every tab
      return commands.filter((c) => c.section !== "Go to" || c.id.startsWith("open-") || c.id === "dashboard" || c.id === "settings").slice(0, 8);
    }
    return commands
      .map((c) => ({ c, s: Math.max(score(query, c.label), score(query, c.keywords ?? "")) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 20)
      .map((x) => x.c);
  }, [commands, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function run(c: Command) {
    c.run();
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[14vh] backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cp-in w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-e3">
        <div className="flex items-center gap-2.5 border-b border-line-soft px-3.5 py-3">
          <Icon name="search" size={15} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a server, tab, or action…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[active]) run(results[active]);
              }
            }}
          />
          <kbd className="shrink-0 rounded-xs border border-line-soft bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-ink-ghost">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-faint">Nothing matches "{query}".</p>
          ) : (
            results.map((c, i) => (
              <button
                key={c.id}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => run(c)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  i === active ? "bg-surface-3 text-ink" : "text-ink-dim",
                )}
              >
                {c.id.startsWith("open-") ? (
                  <StatusDot
                    tone={STATUS_TONE[statusOf(runtimes, c.id.slice(5))]}
                    size={7}
                    className="shrink-0"
                  />
                ) : (
                  <Icon name={c.icon} size={14} className="shrink-0 text-ink-faint" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
                {c.hint && <span className="shrink-0 text-2xs text-ink-faint">{c.hint}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
