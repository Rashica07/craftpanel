import { useEffect, useState } from "react";
import { api } from "../api";
import {
  SERVER_TYPE_META,
  STATUS_META,
  type CloudStatus,
  type ExternalStatus,
  type ProcSnapshot,
  type ServerRecord,
  type ShareView,
} from "../types";
import { Badge, Button } from "./ui";
import { ConsoleView } from "./ConsoleView";
import { RconPanel } from "./RconPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ModsPanel } from "./ModsPanel";
import { BackupsPanel } from "./BackupsPanel";
import { FilesPanel } from "./FilesPanel";
import { LogView } from "./LogView";
import { AdminPanel } from "./AdminPanel";
import { WorldsPanel } from "./WorldsPanel";
import { NetworkPanel } from "./NetworkPanel";
import { PlayerHistory } from "./PlayerHistory";
import { Icon } from "./Icon";
import { cloudLeaseLabel, leaseLabel } from "./ShareSection";

type Tab =
  | "console"
  | "players"
  | "settings"
  | "mods"
  | "backups"
  | "files"
  | "worlds"
  | "network";

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

  const status = runtime?.status ?? "stopped";
  const active = status === "running" || status === "starting" || status === "stopping";
  const uptime = useUptime(runtime?.startedAt ?? null, active);
  const externalRunning = !active && !!external?.portOpen;
  const reachable = status === "running" || externalRunning;
  const hasMods = server.server_type === "fabric" || server.server_type === "forge";
  const isCloud = !!server.sync_code;
  const leasedElsewhere =
    !active &&
    ((!!share?.shared && !!share.locked && !share.heldByUs) ||
      (isCloud && !!cloud?.locked && !cloud.heldByUs));

  useEffect(() => {
    setTab("console");
    setConsoleMode("live");
    setPendingRestart(false);
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
      api.checkExternal(server.id).then((e) => alive && setExternal(e)).catch(() => {});
    check();
    const t = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [server.id, active]);

  useEffect(() => {
    setShowEula(false);
    api.eulaState(server.id).then(setEulaOk).catch(() => setEulaOk(null));
  }, [server.id]);

  useEffect(() => {
    let alive = true;
    const check = () => {
      api.shareStatus(server.id).then((s) => alive && setShare(s)).catch(() => {});
      if (server.sync_code) {
        api.cloudStatus(server.id).then((c) => alive && setCloud(c)).catch(() => {});
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
          setTimeout(() => setSyncMsg(null), 4000);
        }
      })
      .then((f) => (un = f));
    return () => un?.();
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

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "console", label: "Console", icon: "terminal" },
    { id: "players", label: "Players", icon: "users" },
    { id: "settings", label: "Settings", icon: "sliders" },
    ...(hasMods ? [{ id: "mods" as Tab, label: "Mods", icon: "package" }] : []),
    { id: "worlds", label: "Worlds", icon: "globe" },
    { id: "network", label: "Network", icon: "signal" },
    { id: "files", label: "Files", icon: "folder" },
    { id: "backups", label: "Backups", icon: "archive" },
  ];

  return (
    <div className="flex h-full flex-col p-6">
      {/* header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{server.name}</h1>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge tone={externalRunning ? "ok" : st.tone}>
              {externalRunning ? "Running (external)" : st.label}
            </Badge>
            <Badge tone="accent">{meta.label}</Badge>
            {server.mc_version && <Badge tone="neutral">MC {server.mc_version}</Badge>}
            {runtime?.reattached && <Badge tone="neutral">⟲ Reattached</Badge>}
            {isCloud && cloud && (
              <Badge tone={cloudLeaseLabel(cloud).tone}>☁ {cloudLeaseLabel(cloud).text}</Badge>
            )}
            {!isCloud && share?.shared && (
              <Badge tone={leaseLabel(share).tone}>⇄ {leaseLabel(share).text}</Badge>
            )}
            {active && runtime?.pid && (
              <span className="text-xs text-ink-faint">
                pid {runtime.pid}
                {uptime ? ` · up ${uptime}` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {active ? (
            <>
              <Button
                variant="ghost"
                className="flex items-center gap-1.5"
                onClick={() => run(() => api.stopServer(server.id))}
                disabled={busy || status === "stopping"}
              >
                <Icon name="stop" size={13} /> Stop
              </Button>
              <Button
                variant="danger"
                onClick={() => run(() => api.killServer(server.id))}
                disabled={busy}
              >
                Kill
              </Button>
            </>
          ) : externalRunning || leasedElsewhere ? (
            <>
              {externalRunning && (
                <Button
                  variant="danger"
                  onClick={() =>
                    run(async () => {
                      await api.stopOnPort(server.id);
                      const e = await api.checkExternal(server.id);
                      setExternal(e);
                    })
                  }
                  disabled={busy}
                  className="flex items-center gap-1.5"
                  title={`Kill the Minecraft server holding port ${external?.port}`}
                >
                  <Icon name="stop" size={13} /> Stop it
                </Button>
              )}
              <Button
                variant="ghost"
                className="flex items-center gap-1.5"
                onClick={() => run(() => api.startServer(server.id, { force: true }))}
                disabled={busy}
                title={
                  leasedElsewhere
                    ? `In use on ${share?.holderName ?? "another device"} — only start if that device is off`
                    : "A server is already listening on this port"
                }
              >
                <Icon name="play" size={13} /> Start anyway
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              className="flex items-center gap-1.5"
              onClick={onStartClick}
              disabled={busy}
            >
              <Icon name="play" size={13} /> Start
            </Button>
          )}
        </div>
      </div>

      {/* banners */}
      {showEula && (
        <div className="mt-3 rounded-md border border-accent/30 bg-accent-muted px-3 py-2.5 text-xs">
          <p className="text-ink">
            To run a Minecraft server you must agree to the{" "}
            <a
              href="https://aka.ms/MinecraftEULA"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline"
            >
              Minecraft EULA
            </a>
            . CraftPanel will write <code>eula=true</code> and start the server.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={agreeAndStart} disabled={busy}>
              I agree — start
            </Button>
            <Button variant="ghost" onClick={() => setShowEula(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {externalRunning && (
        <div className="mt-3 rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok">
          A Minecraft server is already listening on port {external?.port}, started
          outside CraftPanel (or left over from a create/first-boot). Console isn't
          captured for it; the Players tab still reaches it over RCON. Use{" "}
          <strong>Stop it</strong> to end that process, then Start normally.
        </div>
      )}
      {runtime?.needsEula && !showEula && (
        <div className="mt-3 flex items-center justify-between rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <span>The server stopped because the Minecraft EULA isn't accepted.</span>
          <Button variant="subtle" onClick={agreeAndStart} disabled={busy}>
            Accept EULA &amp; start
          </Button>
        </div>
      )}
      {status === "crashed" && !runtime?.needsEula && (
        <div className="mt-3 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
          Server crashed
          {runtime?.exitCode != null ? ` (exit code ${runtime.exitCode})` : ""}. Check the console.
        </div>
      )}
      {syncMsg && (
        <div className="mt-3 rounded-md border border-accent/30 bg-accent-muted px-3 py-2 text-xs text-ink">
          ☁ {syncMsg}
        </div>
      )}
      {pendingRestart && (active || externalRunning) && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <span>
            Changes saved to <code>server.properties</code> — the running server
            won't pick them up until it's restarted.
          </span>
          {status === "running" ? (
            <Button variant="subtle" onClick={restart} disabled={busy}>
              Restart server
            </Button>
          ) : externalRunning ? (
            <span className="shrink-0 text-ink-faint">restart it in your terminal</span>
          ) : null}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
          {error}
        </div>
      )}

      {/* tabs */}
      <div className="mt-4 flex gap-1 border-b border-edge">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm transition-colors ${
              tab === t.id
                ? "border-accent text-ink"
                : "border-transparent text-ink-faint hover:text-ink"
            }`}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 min-h-0 flex-1">
        {tab === "console" && (
          <div className="flex h-full flex-col">
            <div className="mb-2 flex w-max rounded-md border border-edge bg-panel-2 p-0.5 text-xs">
              {(["live", "log"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setConsoleMode(m)}
                  className={`rounded px-2 py-1 ${
                    consoleMode === m ? "bg-accent text-black" : "text-ink-dim hover:text-ink"
                  }`}
                >
                  {m === "live" ? "Live console" : "Log file"}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {consoleMode === "live" ? (
                <ConsoleView
                  serverId={server.id}
                  canSend={
                    (status === "running" || status === "starting") && !runtime?.reattached
                  }
                />
              ) : (
                <LogView serverId={server.id} live={active || externalRunning} />
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
        {tab === "worlds" && (
          <WorldsPanel serverId={server.id} locked={active || externalRunning} />
        )}
        {tab === "network" && <NetworkPanel serverId={server.id} />}
        {tab === "files" && <FilesPanel serverId={server.id} />}
        {tab === "backups" && (
          <BackupsPanel serverId={server.id} locked={active || externalRunning} />
        )}
      </div>
    </div>
  );
}
