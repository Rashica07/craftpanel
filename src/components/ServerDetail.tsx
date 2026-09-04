import { useEffect, useState } from "react";
import { api } from "../api";
import {
  SERVER_TYPE_META,
  STATUS_META,
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
  toast,
  type TabDef,
} from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { ConsoleView } from "./ConsoleView";
import { RconPanel } from "./RconPanel";
import { BroadcastSection } from "./BroadcastSection";
import { SettingsPanel } from "./SettingsPanel";
import { ModsPanel } from "./ModsPanel";
import { BackupsPanel } from "./BackupsPanel";
import { FilesPanel } from "./FilesPanel";
import { LogView } from "./LogView";
import { AdminPanel } from "./AdminPanel";
import { WorldsPanel } from "./WorldsPanel";
import { BrowsePanel } from "./BrowsePanel";
import { NetworkPanel } from "./NetworkPanel";
import { PlayerActivityChart, PlayerHistory } from "./PlayerHistory";
import { ServerMetricsHistory } from "./ServerMetricsHistory";
import { SecuritySection } from "./SecuritySection";
import { HealthStrip } from "./HealthStrip";
import { Icon } from "./Icon";
import { leaseLabel } from "./ShareSection";
import { STATUS_TONE } from "../App";
import { ChangeVersionModal } from "./ChangeVersionModal";
import { CloneServerModal } from "./CloneServerModal";

export type Tab =
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
  initialTab,
  onInitialTabConsumed,
}: {
  server: ServerRecord;
  runtime: ProcSnapshot | undefined;
  onServersChanged: () => void;
  /** Jump straight to this tab on mount/update — set by the command palette.
   * Consumed once (via `onInitialTabConsumed`) so a later plain tab click
   * isn't fought by a stale request. */
  initialTab?: Tab;
  onInitialTabConsumed?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [external, setExternal] = useState<ExternalStatus | null>(null);
  const [eulaOk, setEulaOk] = useState<boolean | null>(null);
  const [showEula, setShowEula] = useState(false);
  const [tab, setTab] = useState<Tab>("console");
  // Tabs stay mounted (hidden, not destroyed) once visited — switching tabs
  // used to unmount the previous one, which threw away any typed-but-
  // unsaved state in it (e.g. a scheduled-start time set in Settings before
  // hitting Save). Console is visited from the start since it's the default.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["console"]));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);
  const [browseQuery, setBrowseQuery] = useState<string | undefined>(undefined);
  const [consoleMode, setConsoleMode] = useState<"live" | "log">("live");
  const [pendingRestart, setPendingRestart] = useState(false);
  const [share, setShare] = useState<ShareView | null>(null);
  const [crash, setCrash] = useState<CrashReport | null>(null);
  const [crashDismissed, setCrashDismissed] = useState(false);
  const [suspectDisabled, setSuspectDisabled] = useState(false);
  const [disablingSuspect, setDisablingSuspect] = useState(false);
  const [showChangeVersion, setShowChangeVersion] = useState(false);
  const [showClone, setShowClone] = useState(false);

  const status = runtime?.status ?? "stopped";
  const active =
    status === "running" || status === "starting" || status === "stopping";
  const uptime = useUptime(runtime?.startedAt ?? null, active);
  const externalRunning = !active && !!external?.portOpen;
  const reachable = status === "running" || externalRunning;
  const hasMods =
    server.server_type === "fabric" || server.server_type === "forge";
  // No RCON, no Modrinth mod/plugin ecosystem, and a different world format
  // — Players, Add-ons and Worlds don't apply to a native Bedrock server.
  // Console and Settings both still work (stdin passthrough, server.properties).
  const isBedrock = server.server_type === "bedrock";
  const leasedElsewhere = !active && !!share?.shared && !!share.locked && !share.heldByUs;

  useEffect(() => {
    setTab(initialTab ?? "console");
    setConsoleMode("live");
    setPendingRestart(false);
    setCrashDismissed(false);
    setSuspectDisabled(false);
    onInitialTabConsumed?.();
    // deliberately server.id only — initialTab/onInitialTabConsumed are read
    // fresh each time this fires, the second effect below handles a tab
    // request arriving for the *same* server that's already mounted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  // same-server tab jump (e.g. palette action "ServerX → Files" while
  // already viewing ServerX) — the effect above only fires on server switch
  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
      onInitialTabConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  // a fresh crash report means a fresh suspect — don't keep showing
  // "Disabled" for last time's culprit
  useEffect(() => {
    setSuspectDisabled(false);
  }, [crash?.file]);

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
    };
    check();
    const t = setInterval(check, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [server.id, active]);

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
    ...(isBedrock ? [] : [{ id: "players" as const, label: "Players", icon: "users" }]),
    { id: "settings", label: "Settings", icon: "sliders" },
    ...(isBedrock ? [] : [{ id: "browse" as const, label: "Add-ons", icon: "sparkle" }]),
    ...(hasMods ? [{ id: "mods" as const, label: "Mods", icon: "package" }] : []),
    ...(isBedrock ? [] : [{ id: "worlds" as const, label: "Worlds", icon: "globe" }]),
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
              {share?.shared && (
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
                  icon: "download",
                  label: "Change version / loader",
                  run: () => setShowChangeVersion(true),
                  disabled: active || busy || isBedrock,
                },
                {
                  icon: "copy",
                  label: "Duplicate server",
                  run: () => setShowClone(true),
                  disabled: active || busy,
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
                <>
                  {hasMods && crash?.suspect?.endsWith(".jar") && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={suspectDisabled ? "check" : "power"}
                      disabled={busy || disablingSuspect || suspectDisabled}
                      loading={disablingSuspect}
                      onClick={async () => {
                        setDisablingSuspect(true);
                        try {
                          await api.setModEnabled(server.id, crash!.suspect!, false);
                          setSuspectDisabled(true);
                          toast.ok(
                            `Disabled ${crash!.suspect}`,
                            "Moved to mods-disabled/ — start the server again to see if that was it.",
                          );
                        } catch (e) {
                          toast.bad("Couldn't disable it", String(e));
                        } finally {
                          setDisablingSuspect(false);
                        }
                      }}
                    >
                      {suspectDisabled ? "Disabled" : "Disable it"}
                    </Button>
                  )}
                  {crash?.missingDependency && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon="search"
                      onClick={() => {
                        setBrowseQuery(crash.missingDependency!.modId);
                        setTab("browse");
                      }}
                    >
                      Find {crash.missingDependency.modId}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="play"
                    onClick={onStartClick}
                    disabled={busy}
                  >
                    Start again
                  </Button>
                </>
              }
            >
              {crash ? (
                <div className="mt-1 space-y-1">
                  {crash.headline && (
                    <div className="rounded-sm bg-black/25 px-2 py-1 font-mono text-2xs text-ink-dim">
                      {crash.headline}
                    </div>
                  )}
                  {crash.missingDependency ? (
                    <div>
                      <span className="font-mono text-warn-soft">
                        {crash.missingDependency.requestedBy}
                      </span>{" "}
                      needs{" "}
                      <span className="font-mono text-warn-soft">
                        {crash.missingDependency.modId}
                      </span>
                      , which isn't installed.
                      <span className="text-ink-faint">
                        {" "}
                        — Add-ons → search will find it.
                      </span>
                    </div>
                  ) : crash.suspect && (
                    <div>
                      Most likely cause:{" "}
                      <span className="font-mono text-warn-soft">
                        {crash.suspect}
                      </span>
                      {hasMods && crash.suspect.endsWith(".jar") && !suspectDisabled && (
                        <span className="text-ink-faint">
                          {" "}
                          — disable it and CraftPanel will leave everything
                          else exactly as it is.
                        </span>
                      )}
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

          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
            serverId={server.id}
            mcVersion={server.mc_version}
          />
        </div>
      )}

      {/* ─────────────────────── panel ───────────────────────
          Every visited tab stays mounted (just hidden) from here on — see
          the `visited` comment above. */}
      <div className="min-h-0 flex-1 px-6 pb-6 pt-4">
        <div className={cx("flex h-full flex-col gap-3", tab !== "console" && "hidden")}>
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

        {visited.has("players") && (
          <div className={cx("h-full space-y-3 overflow-y-auto pr-1", tab !== "players" && "hidden")}>
            <RconPanel
              serverId={server.id}
              reachable={reachable}
              onNeedsRestart={() => setPendingRestart(true)}
            />
            <BroadcastSection serverId={server.id} reachable={reachable} />
            <AdminPanel
              serverId={server.id}
              reachable={reachable}
              onNeedsRestart={() => setPendingRestart(true)}
            />
            <PlayerActivityChart serverId={server.id} />
            <ServerMetricsHistory serverId={server.id} ramAllocatedMb={server.ram_mb} />
            <PlayerHistory serverId={server.id} />
            <SecuritySection serverId={server.id} />
          </div>
        )}

        {visited.has("settings") && (
          <div className={cx("h-full", tab !== "settings" && "hidden")}>
            <SettingsPanel
              server={server}
              locked={active || externalRunning}
              onServersChanged={onServersChanged}
              onNeedsRestart={() => setPendingRestart(true)}
            />
          </div>
        )}
        {hasMods && visited.has("mods") && (
          <div className={cx("h-full", tab !== "mods" && "hidden")}>
            <ModsPanel serverId={server.id} />
          </div>
        )}
        {visited.has("browse") && (
          <div className={cx("h-full", tab !== "browse" && "hidden")}>
            <BrowsePanel
              serverId={server.id}
              serverType={server.server_type}
              onNeedsRestart={() => setPendingRestart(true)}
              initialQuery={browseQuery}
            />
          </div>
        )}
        {visited.has("worlds") && (
          <div className={cx("h-full", tab !== "worlds" && "hidden")}>
            <WorldsPanel
              serverId={server.id}
              locked={active || externalRunning}
            />
          </div>
        )}
        {visited.has("network") && (
          <div className={cx("h-full", tab !== "network" && "hidden")}>
            <NetworkPanel serverId={server.id} serverType={server.server_type} />
          </div>
        )}
        {visited.has("files") && (
          <div className={cx("h-full", tab !== "files" && "hidden")}>
            <FilesPanel serverId={server.id} />
          </div>
        )}
        {visited.has("backups") && (
          <div className={cx("h-full", tab !== "backups" && "hidden")}>
            <BackupsPanel
              serverId={server.id}
              locked={active || externalRunning}
            />
          </div>
        )}
      </div>

      {showChangeVersion && (
        <ChangeVersionModal
          server={server}
          onClose={() => setShowChangeVersion(false)}
          onChanged={() => onServersChanged()}
        />
      )}
      {showClone && (
        <CloneServerModal
          server={server}
          onClose={() => setShowClone(false)}
          onCloned={() => onServersChanged()}
        />
      )}
    </div>
  );
}
