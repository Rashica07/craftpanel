import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { AddServerModal } from "./components/AddServerModal";
import { CreateServerModal } from "./components/CreateServerModal";
import { TemplateModal } from "./components/TemplateModal";
import { JoinSharedModal } from "./components/JoinSharedModal";
import { SettingsPage } from "./components/SettingsPage";
import { LockScreen } from "./components/LockScreen";
import { ServerDetail, type Tab as ServerTab } from "./components/ServerDetail";
import { Dashboard } from "./components/Dashboard";
import { CommandPalette } from "./components/CommandPalette";
import {
  SERVER_TYPE_META,
  STATUS_META,
  type ProcSnapshot,
  type ServerRecord,
  type ServerStatus,
} from "./types";
import {
  Badge,
  Button,
  Skeleton,
  StatusDot,
  toast,
  Toaster,
  Tooltip,
  cx,
} from "./components/ui";
import { Icon } from "./components/Icon";
import { LogoMark, Wordmark } from "./components/Logo";
import { statusOf, useRuntimes } from "./useRuntimes";

/** Status → the tone the dot/label uses everywhere in the app. */
export const STATUS_TONE: Record<
  ServerStatus,
  "ok" | "warn" | "bad" | "neutral"
> = {
  running: "ok",
  starting: "warn",
  stopping: "warn",
  crashed: "bad",
  stopped: "neutral",
  unknown: "neutral",
};

/* ───────────────────── sidebar: one server ───────────────────── */

function ServerRow({
  server,
  status,
  selected,
  players,
  onSelect,
}: {
  server: ServerRecord;
  status: ServerStatus;
  selected: boolean;
  players: string | null;
  onSelect: () => void;
}) {
  const tone = STATUS_TONE[status];
  const st = STATUS_META[status];
  const type = SERVER_TYPE_META[server.server_type];

  return (
    <button
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "group relative w-full rounded-lg px-2.5 py-2 text-left transition-colors duration-[120ms] ease-cp",
        selected
          ? "bg-surface-3 text-ink"
          : "text-ink-dim hover:bg-surface-2 hover:text-ink",
      )}
    >
      {/* selected marker: a short accent bar, not a full outline */}
      <span
        className={cx(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent transition-opacity duration-[120ms]",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} live={status === "running"} size={7} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {server.name}
        </span>
        {status === "running" && players && (
          <span className="flex shrink-0 items-center gap-1 text-2xs tabular-nums text-ink-faint">
            <Icon name="users" size={11} />
            {players}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-1.5 pl-[15px] text-2xs text-ink-faint">
        <span
          className={cx(
            "font-medium",
            tone === "ok" && "text-ok",
            tone === "warn" && "text-warn",
            tone === "bad" && "text-bad",
          )}
        >
          {st.label}
        </span>
        <span className="text-ink-ghost">·</span>
        <span className="truncate">{type.label}</span>
        {server.mc_version && (
          <>
            <span className="text-ink-ghost">·</span>
            <span className="truncate font-mono">{server.mc_version}</span>
          </>
        )}
      </div>
    </button>
  );
}

/* ─────────────── sidebar: the "New server" split button ─────────────── */

function NewServerButton({
  onCreate,
  onAdd,
  onJoin,
  onQuickStart,
}: {
  onCreate: () => void;
  onAdd: () => void;
  onJoin: () => void;
  onQuickStart: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const items = [
    {
      icon: "sparkle",
      label: "Quick start",
      hint: "Skyblock, Bedwars, or Survival — one click",
      run: onQuickStart,
    },
    {
      icon: "folder-open",
      label: "Add an existing folder",
      hint: "You already have a server on disk",
      run: onAdd,
    },
    {
      icon: "link",
      label: "Join a shared world",
      hint: "A friend gave you a sync code",
      run: onJoin,
    },
  ];

  // mousedown + outside-of-ref, not a full-screen onClick scrim: a scrim div
  // only exists in the DOM *after* the open-triggering click has already
  // finished dispatching, so it shouldn't double-fire in theory — but on some
  // webviews (WebView2 in particular) a fast click can still race the paint.
  // This is the standard bulletproof pattern: no new DOM node in the hit-test
  // path, so there's nothing for a stray click to land on and immediately
  // close.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <div className="flex gap-px">
        <Button
          variant="primary"
          size="lg"
          icon="plus"
          onClick={onCreate}
          className="flex-1 rounded-r-none"
        >
          New server
        </Button>
        <Button
          variant="primary"
          size="lg"
          aria-label="More ways to add a server"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((v) => !v)}
          className="w-8 rounded-l-none px-0"
        >
          <Icon name="chevron-down" size={14} />
        </Button>
      </div>

      {open && (
        <>
          {/*
            No entrance animation on this one, unlike the rest of the app's
            popovers: it's the specific dropdown reported as "opens but
            doesn't paint", and an opacity/transform CSS animation starting
            on the very first frame an element exists is a known compositing
            trap on some WebView2 builds. Cheap to remove, directly rules it
            out as a cause.
          */}
          <div
            role="menu"
            className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-lg border border-line bg-surface-2 p-1 shadow-e3"
          >
            {items.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.run();
                }}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-[120ms] hover:bg-surface-3"
              >
                <Icon
                  name={it.icon}
                  size={14}
                  className="mt-0.5 shrink-0 text-ink-faint"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-ink">
                    {it.label}
                  </span>
                  <span className="block text-2xs text-ink-faint">{it.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────── first-run welcome ──────────────────────── */

function Welcome({
  onCreate,
  onAdd,
  onJoin,
}: {
  onCreate: () => void;
  onAdd: () => void;
  onJoin: () => void;
}) {
  const steps = [
    {
      icon: "wand",
      title: "Pick a flavour",
      body: "Vanilla, Paper, Fabric, Forge — we download the right files for you.",
    },
    {
      icon: "play",
      title: "Press Start",
      body: "No config files, no Java flags, no terminal. It just boots.",
    },
    {
      icon: "signal",
      title: "Send the address",
      body: "One click makes a link your friends can join from anywhere.",
    },
  ];

  return (
    <div className="relative flex h-full items-center justify-center overflow-y-auto px-8 py-10">
      {/* blocky motif, very faint — personality without a texture pack */}
      <div className="cp-pixels pointer-events-none absolute inset-x-0 top-0 h-64 opacity-[0.35] [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <div className="cp-stagger relative w-full max-w-2xl text-center">
        <div className="flex justify-center">
          <LogoMark size={56} />
        </div>

        <h1 className="cp-display mt-6 text-3xl text-ink">
          Run a Minecraft server
          <br />
          <span className="text-accent">for you and your friends.</span>
        </h1>

        <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-ink-dim">
          CraftPanel downloads the server, sets it up, keeps it running and
          hands you an address to share. You never touch a config file.
        </p>

        <div className="mt-9 grid gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <div
              key={s.title}
              className="rounded-xl border border-line-soft bg-surface p-4 text-left shadow-e1"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-muted text-accent">
                  <Icon name={s.icon} size={14} />
                </span>
                <span className="font-mono text-2xs text-ink-ghost">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-3 font-display text-sm font-semibold text-ink">
                {s.title}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                {s.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-9 flex flex-col items-center gap-3">
          <Button variant="primary" size="lg" icon="wand" onClick={onCreate}>
            Create your first server
          </Button>
          <div className="flex items-center gap-1 text-xs text-ink-faint">
            <span>Already have one?</span>
            <button
              onClick={onAdd}
              className="rounded-xs px-1 font-medium text-accent-soft hover:underline"
            >
              Add a folder
            </button>
            <span className="text-ink-ghost">or</span>
            <button
              onClick={onJoin}
              className="rounded-xs px-1 font-medium text-accent-soft hover:underline"
            >
              join with a code
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── the app ────────────────────────────── */

export default function App() {
  // undefined = still checking; null = no PIN set, straight through
  const [locked, setLocked] = useState<boolean | undefined>(undefined);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickStart, setShowQuickStart] = useState(false);
  // Land on the overview by default once there's more than one server to
  // survey — with just one, jumping straight to it (the old behavior) is
  // still the faster path and there's nothing an overview would add.
  const [showDashboard, setShowDashboard] = useState(true);
  const [showJoin, setShowJoin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [requestedTab, setRequestedTab] = useState<ServerTab | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [players, setPlayers] = useState<Record<string, string>>({});
  const runtimes = useRuntimes();
  const runtimesRef = useRef<Record<string, ProcSnapshot>>({});
  runtimesRef.current = runtimes;

  async function refresh() {
    try {
      const list = await api.listServers();
      setServers(list);
      setLoadError(null);
      setSelectedId((cur) =>
        cur && list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? null),
      );
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    api
      .lockStatus()
      .then(setLocked)
      .catch(() => setLocked(false));
  }, []);

  // Sidebar player counts. Only polls servers that are actually up, slowly —
  // it's a nice-to-have, not worth hammering RCON for.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const up = servers.filter(
        (s) => statusOf(runtimesRef.current, s.id) === "running",
      );
      if (!up.length) {
        if (alive) setPlayers({});
        return;
      }
      const next: Record<string, string> = {};
      await Promise.all(
        up.map(async (s) => {
          try {
            const p = await api.rconPlayers(s.id);
            next[s.id] = `${p.online}/${p.max}`;
          } catch {
            /* RCON off or still booting — just don't show a count */
          }
        }),
      );
      if (alive) setPlayers(next);
    };
    tick();
    const t = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [servers, runtimes]);

  // ⌘N / Ctrl+N → new server, ⌘K / Ctrl+K → command palette
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        setShowCreate(true);
      } else if (key === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function goToServer(id: string, tab?: ServerTab) {
    setShowSettings(false);
    setShowDashboard(false);
    setSelectedId(id);
    setRequestedTab(tab);
  }

  const selected = servers.find((s) => s.id === selectedId) ?? null;
  const runningCount = servers.filter(
    (s) => statusOf(runtimes, s.id) === "running",
  ).length;

  if (locked === undefined) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <LogoMark size={40} />
      </div>
    );
  }
  if (locked) {
    return <LockScreen onUnlocked={() => setLocked(false)} />;
  }

  return (
    <div className="flex h-full">
      {/* ───────────────────────── sidebar ───────────────────────── */}
      <aside className="flex w-[268px] shrink-0 flex-col border-r border-line bg-surface">
        <header className="flex items-center gap-2 px-4 pb-3 pt-4">
          <Wordmark size={24} />
          <span className="flex-1" />
          {runningCount > 0 && (
            <Tooltip
              label={`${runningCount} server${runningCount > 1 ? "s" : ""} running`}
            >
              <Badge tone="ok" size="sm" dot>
                {runningCount}
              </Badge>
            </Tooltip>
          )}
        </header>

        <div className="px-3 pb-3">
          <NewServerButton
            onCreate={() => setShowCreate(true)}
            onAdd={() => setShowAdd(true)}
            onJoin={() => setShowJoin(true)}
            onQuickStart={() => setShowQuickStart(true)}
          />
        </div>

        {servers.length > 1 && (
          <div className="px-3 pb-3">
            <button
              onClick={() => {
                setShowSettings(false);
                setShowDashboard(true);
              }}
              aria-current={showDashboard && !showSettings ? "true" : undefined}
              className={cx(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors duration-[120ms]",
                showDashboard && !showSettings
                  ? "bg-surface-3 text-ink"
                  : "text-ink-dim hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon name="monitor" size={15} />
              Overview
            </button>
          </div>
        )}

        <div className="px-4 pb-1.5">
          <span className="font-display text-2xs font-semibold uppercase tracking-[0.08em] text-ink-ghost">
            Your servers
          </span>
        </div>

        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="space-y-2 px-1 py-1">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full opacity-60" />
            </div>
          ) : loadError ? (
            <div className="px-2 py-3 text-2xs leading-relaxed text-bad">
              Couldn't read your server list.
              <button
                onClick={refresh}
                className="mt-1 block font-medium underline"
              >
                Try again
              </button>
            </div>
          ) : servers.length === 0 ? (
            <p className="px-2 py-3 text-2xs leading-relaxed text-ink-faint">
              Nothing here yet — hit{" "}
              <span className="font-medium text-ink-dim">New server</span> and
              we'll walk you through it.
            </p>
          ) : (
            servers.map((s) => (
              <ServerRow
                key={s.id}
                server={s}
                status={statusOf(runtimes, s.id)}
                selected={!showSettings && !showDashboard && s.id === selectedId}
                players={players[s.id] ?? null}
                onSelect={() => goToServer(s.id)}
              />
            ))
          )}
        </nav>

        <footer className="border-t border-line-soft p-2">
          <button
            onClick={() => setShowSettings(true)}
            aria-current={showSettings ? "true" : undefined}
            className={cx(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-[120ms]",
              showSettings ? "bg-surface-3 text-ink" : "hover:bg-surface-2",
            )}
          >
            <span
              className={cx(
                "grid h-7 w-7 shrink-0 place-items-center rounded-md",
                showSettings ? "bg-accent-muted text-accent-soft" : "bg-surface-2 text-ink-faint",
              )}
            >
              <Icon name="gear" size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-ink">
                CraftPanel settings
              </span>
              <span className="block text-2xs text-ink-faint">
                Java, updates &amp; more
              </span>
            </span>
            <Icon name="chevron-right" size={13} className="text-ink-ghost" />
          </button>
        </footer>
      </aside>

      {/* ────────────────────────── main ─────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LogoMark size={40} />
          </div>
        ) : showSettings ? (
          <SettingsPage onClose={() => setShowSettings(false)} />
        ) : showDashboard && servers.length > 1 ? (
          <Dashboard
            servers={servers}
            runtimes={runtimes}
            onOpen={(id) => goToServer(id)}
            onStart={async (id) => {
              try {
                await api.startServer(id);
              } catch (e) {
                toast.bad("Couldn't start it", String(e));
              }
            }}
            onStop={async (id) => {
              try {
                await api.stopServer(id);
              } catch (e) {
                toast.bad("Couldn't stop it", String(e));
              }
            }}
          />
        ) : selected ? (
          <ServerDetail
            key={selected.id}
            server={selected}
            runtime={runtimes[selected.id]}
            onServersChanged={refresh}
            initialTab={requestedTab}
            onInitialTabConsumed={() => setRequestedTab(undefined)}
          />
        ) : (
          <Welcome
            onCreate={() => setShowCreate(true)}
            onAdd={() => setShowAdd(true)}
            onJoin={() => setShowJoin(true)}
          />
        )}
      </main>

      {showAdd && (
        <AddServerModal
          onClose={() => setShowAdd(false)}
          onAdded={async (rec) => {
            setShowAdd(false);
            await refresh();
            setSelectedId(rec.id);
          }}
        />
      )}
      {showCreate && (
        <CreateServerModal
          onClose={() => setShowCreate(false)}
          onCreated={async (rec) => {
            setShowCreate(false);
            await refresh();
            setSelectedId(rec.id);
          }}
        />
      )}
      {showJoin && (
        <JoinSharedModal
          onClose={() => setShowJoin(false)}
          onJoined={async (rec) => {
            setShowJoin(false);
            await refresh();
            setSelectedId(rec.id);
          }}
        />
      )}
      {showQuickStart && (
        <TemplateModal
          onClose={() => setShowQuickStart(false)}
          onCreated={async (rec) => {
            setShowQuickStart(false);
            await refresh();
            setSelectedId(rec.id);
          }}
        />
      )}
      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        servers={servers}
        runtimes={runtimes}
        onGoToServer={goToServer}
        onOpenSettings={() => {
          setShowDashboard(false);
          setShowSettings(true);
        }}
        onOpenDashboard={() => {
          setShowSettings(false);
          setShowDashboard(true);
        }}
        onCreate={() => setShowCreate(true)}
        onAdd={() => setShowAdd(true)}
        onJoin={() => setShowJoin(true)}
        onQuickStart={() => setShowQuickStart(true)}
        onStart={async (id) => {
          try {
            await api.startServer(id);
          } catch (e) {
            toast.bad("Couldn't start it", String(e));
          }
        }}
        onStop={async (id) => {
          try {
            await api.stopServer(id);
          } catch (e) {
            toast.bad("Couldn't stop it", String(e));
          }
        }}
      />
      <Toaster />
    </div>
  );
}
