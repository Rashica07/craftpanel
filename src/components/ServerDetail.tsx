import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  SERVER_TYPE_META,
  STATUS_META,
  type CloudStatus,
  type CrashReport,
  type ExternalStatus,
  type ProcSnapshot,
  type ServerRecord,
  type ShareView,
} from "../types";
import {
  Badge,
  Banner,
  Button,
  IconButton,
  Segmented,
  StatusDot,
  Tabs,
  Tooltip,
  cx,
  type TabDef,
} from "./ui";
import { ConsoleView } from "./ConsoleView";
import { RconPanel } from "./RconPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ModsPanel } from "./ModsPanel";
import { BackupsPanel } from "./BackupsPanel";
import { FilesPanel } from "./FilesPanel";
import { LogView } from "./LogView";
import { AdminPanel } from "./AdminPanel";
import { WorldsPanel } from "./WorldsPanel";
import { BrowsePanel } from "./BrowsePanel";
import { NetworkPanel } from "./NetworkPanel";
import { PlayerHistory } from "./PlayerHistory";
import { SecuritySection } from "./SecuritySection";
import { HealthStrip } from "./HealthStrip";
import { Icon } from "./Icon";
import { cloudLeaseLabel, leaseLabel } from "./ShareSection";
import { STATUS_TONE } from "../App";

type Tab =
  | "console"
  | "network"
  | "players"
  | "settings"
  | "browse"
  | "mods"
  | "worlds"
  | "backups"
  | "files";

function useUptime(startedAt: number | null, live: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (!startedAt || !live) return null;
  const s = Math.max(0, Math.floor(Date.now() / 1000 - startedAt));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/**
 * The big status chip in the top bar. This is the single most-looked-at
 * element in the app — it answers "is my server up?" from across the room,
 * so it gets a dot, a word, and the uptime, at a size you can't miss.
 */
function StatusChip({
  label,
  tone,
  detail,
  busy,
}: {
  label: string;
  tone: "ok" | "warn" | "bad" | "neutral";
  detail?: string | null;
  busy?: boolean;
}) {
  const ring = {
    ok: "border-ok/35 bg-ok-muted text-ok-soft",
    warn: "border-warn/35 bg-warn-muted text-warn-soft",
    bad: "border-bad/35 bg-bad-muted text-bad-soft",
    neutral: "border-line bg-surface-2 text-ink-dim",
  }[tone];
  return (
    <div
      className={cx(
        "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5",
        ring,
      )}
    >
      <StatusDot tone={tone} live={tone === "ok"} size={8} />
      <span className="text-xs font-semibold">{label}</span>
      {busy && <span className="cp-pulse text-2xs">…</span>}
      {detail && (
        <span className="border-l border-current/20 pl-2 text-2xs tabular-nums opacity-70">
          {detail}
        </span>
      )}
    </div>
  );
}

/** Overflow menu on the top bar — the actions you rarely want by accident. */
function ActionMenu({
  items,
}: {
  items: { icon: string; label: string; run: () => void; danger?: boolean; disabled?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const live = items.filter((i) => !i.disabled);
  if (!live.length) return null;
  return (
    <div className="relative">
      <IconButton
        icon="more-horizontal"
        title="More actions"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="cp-pop absolute right-0 top-full z-40 mt-1.5 min-w-48 overflow-hidden rounded-lg border border-line bg-surface-2 p-1 shadow-e3"
          >
            {live.map((it) => (
              <button
                key={it.label}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.run();
                }}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors duration-[120ms]",
                  it.danger
                    ? "text-bad hover:bg-bad/12"
                    : "text-ink-dim hover:bg-surface-3 hover:text-ink",
                )}
              >
                <Icon name={it.icon} size={14} />
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ServerDetail({
  server,
  runtime,
  onServersChanged,
}: {
  server: ServerRecord;
  runtime: ProcSnapshot | undefined;
  onServersChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [external, setExternal] = useState<ExternalStatus | null>(null);
  const [eulaOk, setEulaOk] = useState<boolean | null>(null);
  const [showEula, setShowEula] = useState(false);
  const [tab, setTab] = useState<Tab>("console");
  const [consoleMode, setConsoleMode] = useState<"live" | "log">("live");
  const [pendingRestart, setPendingRestart] = useState(false);
  const [share, setShare] = useState<ShareView | null>(null);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [crash, setCrash] = useState<CrashReport | null>(null);
  const [crashDismissed, setCrashDismissed] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const status = runtime?.status ?? "stopped";
  const active =
    status === "running" || status === "starting" || status === "stopping";
  const uptime = useUptime(runtime?.startedAt ?? null, active);
  const externalRunning = !active && !!external?.portOpen;
  const reachable = status === "running" || externalRunning;
  const hasMods =
    server.server_type === "fabric" || server.server_type === "forge";
  const isCloud = !!server.sync_code;
  const leasedElsewhere =
    !active &&
    ((!!share?.shared && !!share.locked && !share.heldByUs) ||
      (isCloud && !!cloud?.locked && !cloud.heldByUs));

  useEffect(() => {
    setTab("console");
    setConsoleMode("live");
    setPendingRestart(false);
    setCrashDismissed(false);
  }, [server.id]);

  // reattached / external servers have no live stream — show the log file
  useEffect(() => {
    if (runtime?.reattached || externalRunning) setConsoleMode("log");
  }, [runtime?.reattached, externalRunning]);

  // once the server is actually down, the "restart to apply" reminder is moot
  useEffect(() => {
    if (!active && !externalRunning) setPendingRestart(false);
  }, [active, externalRunning]);

  async function restart() {
    setPendingRestart(false);
    await run(async () => {
      await api.stopServer(server.id);
      for (let i = 0; i < 80; i++) {
        const s = await api.serverRuntime(server.id);
        if (s.status === "stopped" || s.status === "crashed") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      await api.startServer(server.id);
    });
  }

  useEffect(() => {
    if (active) {
      setExternal(null);
      return;
    }
    let alive = true;
    const check = () =>
      api
        .checkExternal(server.id)
        .then((e) => alive && setExternal(e))
        .catch(() => {});
    check();
    const t = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [server.id, active]);

  useEffect(() => {
    setShowEula(false);
    api
      .eulaState(server.id)
      .then(setEulaOk)
      .catch(() => setEulaOk(null));
  }, [server.id]);

  useEffect(() => {
    api
      .latestCrash(server.id)
      .then(setCrash)
      .catch(() => setCrash(null));
  }, [server.id, status]);

  useEffect(() => {
    let alive = true;
    const check = () => {
      api
        .shareStatus(server.id)
        .then((s) => alive && setShare(s))
        .catch(() => {});
      if (server.sync_code) {
        api
          .cloudStatus(server.id)
          .then((c) => alive && setCloud(c))
          .catch(() => {});
      }
    };
    check();
    const t = setInterval(check, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [server.id, server.sync_code, active]);

  // sync progress toast + auto "finish" (upload world) after a cloud server stops
  useEffect(() => {
    let un: (() => void) | undefined;
    api
      .onSyncProgress((p) => {
        if (!p.serverId || p.serverId === server.id) {
          setSyncMsg(p.message);
          clearTimeout(syncTimer.current);
          syncTimer.current = setTimeout(() => setSyncMsg(null), 4000);
        }
      })
      .then((f) => (un = f));
    return () => {
      un?.();
      clearTimeout(syncTimer.current);
    };
  }, [server.id]);

  useEffect(() => {
    if (isCloud && (status === "stopped" || status === "crashed")) {
      api.cloudFinish(server.id).catch(() => {});
    }
  }, [isCloud, status, server.id]);

  const meta = SERVER_TYPE_META[server.server_type];
  const st = STATUS_META[status];

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function onStartClick() {
    if (eulaOk === false) {
      setShowEula(true);
      return;
    }
    run(async () => {
      try {
        await api.startServer(server.id);
      } catch (e) {
        if (String(e).includes("EULA_REQUIRED")) {
          setEulaOk(false);
          setShowEula(true);
          return;
        }
        throw e;
      }
    });
  }

  function agreeAndStart() {
    setShowEula(false);
    run(async () => {
      await api.startServer(server.id, { acceptEula: true });
      setEulaOk(true);
    });
  }

  /* Tab order is a priority order: the thing you do most is leftmost, and
     Network sits second because "how do my friends join" is the question the
     app exists to answer. */
  const tabs: TabDef[] = [
    { id: "console", label: "Console", icon: "terminal" },
    { id: "network", label: "Network", icon: "signal" },
    { id: "players", label: "Players", icon: "users" },
    { id: "settings", label: "Settings", icon: "sliders" },
    { id: "browse", label: "Add-ons", icon: "sparkle" },
    ...(hasMods ? [{ id: "mods", label: "Mods", icon: "package" }] : []),
    { id: "worlds", label: "Worlds", icon: "globe" },
    { id: "backups", label: "Backups", icon: "archive" },
    { id: "files", label: "Files", icon: "folder" },
  ];

  const statusTone = externalRunning ? "ok" : STATUS_TONE[status];
  const statusLabel = externalRunning ? "Running elsewhere" : st.label;

  return (
    <div className="flex h-full flex-col">
      {/* ─────────────────────── top bar ─────────────────────── */}
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex items-start gap-4 px-6 pb-3.5 pt-4">
          <div className="min-w-0 flex-1">
            <h1 className="cp-display truncate text-xl text-ink">
              {server.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{meta.label}</Badge>
              {server.mc_version && (
                <Badge tone="neutral">MC {server.mc_version}</Badge>
              )}
              {runtime?.reattached && (
                <Tooltip label="CraftPanel found this server already running and adopted it">
                  <Badge tone="neutral" icon="rotate">
                    Reattached
                  </Badge>
                </Tooltip>
              )}
              {isCloud && cloud && (
                <Badge tone={cloudLeaseLabel(cloud).tone} icon="cloud">
                  {cloudLeaseLabel(cloud).text}
                </Badge>
              )}
              {!isCloud && share?.shared && (
                <Badge tone={leaseLabel(share).tone} icon="share">
                  {leaseLabel(share).text}
                </Badge>
              )}
              {active && runtime?.pid && (
                <span className="font-mono text-2xs text-ink-faint">
                  pid {runtime.pid}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            <StatusChip
              label={statusLabel}
              tone={statusTone}
              detail={uptime ? `up ${uptime}` : null}
              busy={status === "starting" || status === "stopping"}
            />

            {active ? (
              <Button
                variant="secondary"
                size="lg"
                icon="stop"
                onClick={() => run(() => api.stopServer(server.id))}
                disabled={busy || status === "stopping"}
                loading={busy && status === "stopping"}
              >
                Stop
              </Button>
            ) : externalRunning || leasedElsewhere ? (
              <Button
                variant="secondary"
                size="lg"
                icon="play"
                onClick={() =>
                  run(() => api.startServer(server.id, { force: true }))
                }
                disabled={busy}
                title={
                  leasedElsewhere
                    ? `In use on ${share?.holderName ?? "another device"} — only start if that device is off`
                    : "A server is already listening on this port"
                }
              >
                Start anyway
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                icon="play"
                onClick={onStartClick}
                disabled={busy}
                loading={busy}
              >
                Start
              </Button>
            )}

            <ActionMenu
              items={[
                {
                  icon: "refresh",
                  label: "Restart server",
                  run: restart,
                  disabled: !active || busy,
                },
                {
                  icon: "power",
                  label: "Force kill",
                  run: () => run(() => api.killServer(server.id)),
                  danger: true,
                  disabled: !active || busy,
                },
                {
                  icon: "stop",
                  label: `Stop whatever holds port ${external?.port ?? ""}`,
                  run: () =>
                    run(async () => {
                      await api.stopOnPort(server.id);
                      setExternal(await api.checkExternal(server.id));
                    }),
                  danger: true,
                  disabled: !externalRunning || busy,
                },
              ]}
            />
          </div>
        </div>

        <div className="px-6">
          <Tabs
            tabs={tabs}
            value={tab}
            onChange={(id) => setTab(id as Tab)}
            className="border-b-0"
          />
        </div>
      </header>

      {/* ─────────────────────── banners ─────────────────────── */}
      {(showEula ||
        externalRunning ||
        runtime?.needsEula ||
        (status === "crashed" && !crashDismissed) ||
        syncMsg ||
        (pendingRestart && (active || externalRunning)) ||
        error) && (
        <div className="shrink-0 space-y-2 px-6 pt-4">
          {showEula && (
            <Banner
              tone="accent"
              icon="book"
              title="One-time agreement"
              actions={
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={agreeAndStart}
                    disabled={busy}
                  >
                    I agree — start
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => setShowEula(false)}
                    disabled={busy}
                  >
                    Not now
                  </Button>
                </>
              }
            >
              Minecraft servers require you to accept the{" "}
              <a
                href="https://aka.ms/MinecraftEULA"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Minecraft EULA
              </a>
              . We'll write <code>eula=true</code> and start the server.
            </Banner>
          )}

          {externalRunning && (
            <Banner
              tone="ok"
              icon="alert"
              title={`Something else is already using port ${external?.port}`}
              actions={
                <Button
                  variant="danger"
                  size="sm"
                  icon="stop"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.stopOnPort(server.id);
                      setExternal(await api.checkExternal(server.id));
                    })
                  }
                >
                  Stop it
                </Button>
              }
            >
              A Minecraft server started outside CraftPanel (or left over from a
              first boot) holds this port. The live console can't capture it, but
              Players still works over RCON. Stop it, then press Start.
            </Banner>
          )}

          {runtime?.needsEula && !showEula && (
            <Banner
              tone="warn"
              title="The server stopped — EULA not accepted"
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={agreeAndStart}
                  disabled={busy}
                >
                  Accept &amp; start
                </Button>
              }
            >
              Minecraft won't run until the EULA is accepted once.
            </Banner>
          )}

          {status === "crashed" && !runtime?.needsEula && !crashDismissed && (
            <Banner
              tone="bad"
              title={`Server crashed${
                runtime?.exitCode != null ? ` (exit code ${runtime.exitCode})` : ""
              }`}
              onDismiss={() => setCrashDismissed(true)}
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  icon="play"
                  onClick={onStartClick}
                  disabled={busy}
                >
                  Start again
                </Button>
              }
            >
              {crash ? (
                <div className="mt-1 space-y-1">
                  {crash.headline && (
                    <div className="rounded-sm bg-black/25 px-2 py-1 font-mono text-2xs text-ink-dim">
                      {crash.headline}
                    </div>
                  )}
                  {crash.suspect && (
                    <div>
                      Most likely cause:{" "}
                      <span className="font-mono text-warn-soft">
                        {crash.suspect}
                      </span>
                    </div>
                  )}
                  <div className="text-ink-faint">
                    Full report in <strong>Files → crash-reports/</strong> (
                    <span className="font-mono">{crash.file}</span>)
                  </div>
                </div>
              ) : (
                "Check the Console tab for the last few lines before it went down."
              )}
            </Banner>
          )}

          {syncMsg && (
            <Banner tone="info" icon="cloud">
              {syncMsg}
            </Banner>
          )}

          {pendingRestart && (active || externalRunning) && (
            <Banner
              tone="warn"
              icon="refresh"
              title="Restart to apply your changes"
              actions={
                status === "running" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="refresh"
                    onClick={restart}
                    disabled={busy}
                  >
                    Restart now
                  </Button>
                ) : undefined
              }
            >
              Settings are saved, but a running server keeps the old values in
              memory until it restarts.
            </Banner>
          )}

          {error && (
            <Banner tone="bad" onDismiss={() => setError(null)}>
              <span className="break-words">{error}</span>
            </Banner>
          )}
        </div>
      )}

      {/* ─────────────────────── panel ─────────────────────── */}
      <div key={tab} className="cp-in min-h-0 flex-1 px-6 pb-6 pt-4">
        {tab === "console" && (
          <div className="flex h-full flex-col gap-3">
            <HealthStrip serverId={server.id} live={active || externalRunning} />
            <div className="flex items-center gap-2">
              <Segmented
                value={consoleMode}
                onChange={setConsoleMode}
                options={[
                  { value: "live", label: "Live console", icon: "terminal" },
                  { value: "log", label: "Log file", icon: "file" },
                ]}
              />
              {runtime?.reattached && consoleMode === "live" && (
                <span className="text-2xs text-ink-faint">
                  This server was adopted, so there's no live stream — use the
                  log file.
                </span>
              )}
            </div>
            <div className="min-h-0 flex-1">
              {consoleMode === "live" ? (
                <ConsoleView
                  serverId={server.id}
                  canSend={
                    (status === "running" || status === "starting") &&
                    !runtime?.reattached
                  }
                />
              ) : (
                <LogView
                  serverId={server.id}
                  live={active || externalRunning}
                />
              )}
            </div>
          </div>
        )}

        {tab === "players" && (
          <div className="h-full space-y-3 overflow-y-auto pr-1">
            <RconPanel
              serverId={server.id}
              reachable={reachable}
              onNeedsRestart={() => setPendingRestart(true)}
            />
            <AdminPanel
              serverId={server.id}
              reachable={reachable}
              onNeedsRestart={() => setPendingRestart(true)}
            />
            <PlayerHistory serverId={server.id} />
            <SecuritySection serverId={server.id} />
          </div>
        )}

        {tab === "settings" && (
          <SettingsPanel
            server={server}
            locked={active || externalRunning}
            onServersChanged={onServersChanged}
            onNeedsRestart={() => setPendingRestart(true)}
          />
        )}
        {tab === "mods" && hasMods && <ModsPanel serverId={server.id} />}
        {tab === "browse" && (
          <BrowsePanel
            serverId={server.id}
            serverType={server.server_type}
            onNeedsRestart={() => setPendingRestart(true)}
          />
        )}
        {tab === "worlds" && (
          <WorldsPanel
            serverId={server.id}
            locked={active || externalRunning}
          />
        )}
        {tab === "network" && <NetworkPanel serverId={server.id} />}
        {tab === "files" && <FilesPanel serverId={server.id} />}
        {tab === "backups" && (
          <BackupsPanel
            serverId={server.id}
            locked={active || externalRunning}
          />
        )}
      </div>
    </div>
  );
}
