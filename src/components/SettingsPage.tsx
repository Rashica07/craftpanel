import { useEffect, useState } from "react";
import { api } from "../api";
import type {
  AppSettings,
  BackupsConfig,
  DoctorReport,
  JavaInfo,
  ProvisionProgress,
  R2Status,
  UpdateCheck,
} from "../types";
import {
  Badge,
  Button,
  Card,
  CopyField,
  Field,
  ProgressBar,
  StatusDot,
  Tabs,
  TextInput,
  Toggle,
  toast,
  type TabDef,
} from "./ui";
import { Icon } from "./Icon";
import { R2SetupModal } from "./R2SetupModal";

const DEFAULTS: AppSettings = {
  defaultJava: "",
  defaultRamMb: 4096,
  expertMode: false,
  keepServersOnQuit: false,
  githubRepo: "",
};

type Tab = "general" | "updates" | "java" | "cloud" | "diagnostics" | "about";

const TABS: TabDef[] = [
  { id: "general", label: "General", icon: "sliders" },
  { id: "updates", label: "Updates", icon: "download" },
  { id: "java", label: "Java", icon: "cpu" },
  { id: "cloud", label: "Cloud & Backups", icon: "cloud" },
  { id: "diagnostics", label: "Diagnostics", icon: "activity" },
  { id: "about", label: "About", icon: "info" },
];

const JAVA_FEATURES = [17, 21, 25] as const;

/**
 * The app's own settings, promoted from a cramped modal to a full page —
 * same chrome as a server's detail view (header + Tabs + scrolling body),
 * because there's now enough here (updates, Java runtimes, cloud + backups,
 * diagnostics, about) that a single scrolling form didn't do it justice.
 */
export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("general");
  const [s, setS] = useState<AppSettings>(DEFAULTS);
  const [saved, setSaved] = useState<AppSettings>(DEFAULTS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .appSettingsGet()
      .then((v) => {
        const filled = { ...DEFAULTS, ...v, defaultRamMb: v.defaultRamMb || 4096 };
        setS(filled);
        setSaved(filled);
      })
      .catch(() => {});
  }, []);

  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setS((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      await api.appSettingsSet(s);
      setSaved(s);
      toast.ok("Settings saved");
    } catch (e) {
      toast.bad("Couldn't save settings", String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex items-start gap-4 px-6 pb-3.5 pt-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-muted text-accent-soft">
            <Icon name="gear" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="cp-display truncate text-xl text-ink">CraftPanel settings</h1>
            <p className="mt-0.5 text-xs text-ink-faint">
              Defaults for new servers, updates, Java, cloud, and how the app behaves.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {dirty && (
              <Button variant="primary" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
        <div className="px-6">
          <Tabs tabs={TABS} value={tab} onChange={(id) => setTab(id as Tab)} className="border-b-0" />
        </div>
      </header>

      <div key={tab} className="cp-in min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {tab === "general" && <GeneralTab s={s} set={set} />}
          {tab === "updates" && <UpdatesTab s={s} set={set} onDirtySave={dirty ? save : undefined} />}
          {tab === "java" && <JavaTab s={s} set={set} />}
          {tab === "cloud" && <CloudTab />}
          {tab === "diagnostics" && <DiagnosticsTab />}
          {tab === "about" && <AboutTab githubRepo={s.githubRepo} />}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── General ─────────────────────────────── */

function GeneralTab({
  s,
  set,
}: {
  s: AppSettings;
  set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
}) {
  return (
    <Card title="Defaults for new servers" icon="sliders">
      <Field label="Default Java" hint="used for new servers — blank = whatever's on PATH">
        <TextInput
          value={s.defaultJava}
          onChange={(e) => set("defaultJava", e.target.value)}
          placeholder="/path/to/java  (optional)"
        />
      </Field>

      <Field label="Default memory for new servers" className="mt-3">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1024}
            max={16384}
            step={512}
            value={s.defaultRamMb}
            onChange={(e) => set("defaultRamMb", Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="w-16 text-right text-sm">
            {(s.defaultRamMb / 1024).toFixed(s.defaultRamMb % 1024 ? 1 : 0)} GB
          </span>
        </div>
      </Field>

      <label className="mt-4 flex items-start justify-between gap-3 border-t border-line-soft pt-4">
        <span className="text-sm">
          Keep servers running when I quit CraftPanel
          <span className="mt-0.5 block text-2xs text-ink-faint">
            Quitting won't stop your servers — the app re-adopts them next launch.
            (Closing the window already keeps them; this covers Quit.)
          </span>
        </span>
        <Toggle checked={s.keepServersOnQuit} onChange={(v) => set("keepServersOnQuit", v)} />
      </label>

      <label className="mt-3 flex items-start justify-between gap-3 border-t border-line-soft pt-3">
        <span className="text-sm">
          Expert mode
          <span className="mt-0.5 block text-2xs text-ink-faint">
            Shows the raw <code>server.properties</code> editor and other power tools.
          </span>
        </span>
        <Toggle checked={s.expertMode} onChange={(v) => set("expertMode", v)} />
      </label>
    </Card>
  );
}

/* ─────────────────────────────── Updates ──────────────────────────────── */

function UpdatesTab({
  s,
  set,
  onDirtySave,
}: {
  s: AppSettings;
  set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
  onDirtySave?: () => Promise<void>;
}) {
  const [upd, setUpd] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [progress, setProgress] = useState<ProvisionProgress | null>(null);

  useEffect(() => {
    let un: (() => void) | undefined;
    api.onUpdateProgress(setProgress).then((f) => (un = f));
    return () => un?.();
  }, []);

  async function check() {
    setChecking(true);
    try {
      if (onDirtySave) await onDirtySave();
      setUpd(await api.checkUpdate());
    } finally {
      setChecking(false);
    }
  }

  async function installUpdate() {
    setInstalling(true);
    setProgress(null);
    try {
      await api.installUpdate();
      setInstalled(true);
    } catch (e) {
      toast.bad("Couldn't install the update", String(e));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <Card
      title="Updates"
      icon="download"
      description="Set your GitHub repo once, then check and install new releases from here."
    >
      <Field label="GitHub repo" hint="e.g. yourname/craftpanel">
        <TextInput
          value={s.githubRepo}
          onChange={(e) => set("githubRepo", e.target.value)}
          placeholder="owner/repo"
        />
      </Field>

      {installed ? (
        <div className="mt-3 flex items-center gap-2 border-t border-line-soft pt-3 text-2xs font-medium text-ok">
          <Icon name="check-circle" size={13} />
          Update installed — restart to finish.
          <Button variant="secondary" size="sm" onClick={() => api.relaunchApp()}>
            Restart now
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 border-t border-line-soft pt-3">
          <Button variant="ghost" disabled={checking} onClick={check}>
            {checking ? "Checking…" : "Check for updates"}
          </Button>
          {upd &&
            (upd.unavailable ? (
              <span className="text-2xs text-ink-faint">{upd.unavailable}</span>
            ) : upd.newer ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="download"
                  loading={installing}
                  onClick={installUpdate}
                >
                  Install {upd.latest} (you have {upd.current})
                </Button>
                <a
                  href={upd.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-2xs text-ink-faint underline"
                >
                  release notes →
                </a>
              </>
            ) : (
              <span className="text-2xs text-ok">Up to date ({upd.current}).</span>
            ))}
        </div>
      )}
      {installing && progress && (
        <div className="mt-2 max-w-xs space-y-1">
          <ProgressBar pct={progress.pct ?? undefined} indeterminate={progress.pct == null} />
          <p className="text-2xs text-ink-faint">{progress.message}</p>
        </div>
      )}
    </Card>
  );
}

/* ──────────────────────────────── Java ────────────────────────────────── */

function JavaTab({
  s,
  set,
}: {
  s: AppSettings;
  set: <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => void;
}) {
  const [status, setStatus] = useState<Record<number, JavaInfo | null | undefined>>({});
  const [installing, setInstalling] = useState<number | null>(null);
  const [progress, setProgress] = useState<ProvisionProgress | null>(null);

  const load = () => {
    for (const f of JAVA_FEATURES) {
      api
        .javaInstallStatus(f)
        .then((info) => setStatus((x) => ({ ...x, [f]: info })))
        .catch(() => setStatus((x) => ({ ...x, [f]: null })));
    }
  };

  useEffect(load, []);

  useEffect(() => {
    let un: (() => void) | undefined;
    api.onJavaInstallProgress(setProgress).then((f) => (un = f));
    return () => un?.();
  }, []);

  async function install(feature: number) {
    setInstalling(feature);
    setProgress(null);
    try {
      const info = await api.installJava(feature);
      setStatus((x) => ({ ...x, [feature]: info }));
      toast.ok(`Java ${info.major} installed`);
    } catch (e) {
      toast.bad(`Couldn't install Java ${feature}`, String(e));
    } finally {
      setInstalling(null);
    }
  }

  return (
    <>
      <Card
        title="Java runtimes"
        icon="cpu"
        description="Adoptium Temurin, downloaded and checksum-verified once and shared across every server that needs it — installing one server's Java doesn't re-download for the next."
      >
        <div className="space-y-2">
          {JAVA_FEATURES.map((f) => {
            const info = status[f];
            const isInstalling = installing === f;
            return (
              <div
                key={f}
                className="flex items-center gap-3 rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5"
              >
                <StatusDot tone={info ? "ok" : "neutral"} size={7} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink">Java {f}</div>
                  <div className="mt-0.5 truncate text-2xs text-ink-faint">
                    {info === undefined
                      ? "Checking…"
                      : info
                        ? info.path
                        : "Not installed"}
                  </div>
                  {isInstalling && progress && (
                    <div className="mt-1.5 max-w-xs space-y-1">
                      <ProgressBar
                        pct={progress.pct ?? undefined}
                        indeterminate={progress.pct == null}
                      />
                      <p className="text-2xs text-ink-faint">{progress.message}</p>
                    </div>
                  )}
                </div>
                {info ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => set("defaultJava", info.path)}
                    disabled={s.defaultJava === info.path}
                  >
                    {s.defaultJava === info.path ? "Default" : "Make default"}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="download"
                    loading={isInstalling}
                    disabled={installing != null}
                    onClick={() => install(f)}
                  >
                    Install
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-2xs text-ink-faint">
          Very old Minecraft (Java 8) or the 1.17-only Java 16 requirement
          aren't offered here — CraftPanel won't guess a substitute JVM under
          old modded servers. Point "Default Java" at a system install
          instead if you need one of those.
        </p>
      </Card>
      <p className="mt-1 text-2xs text-ink-ghost">
        Reload this tab after installing to refresh — press it again if a
        status looks stale.
        <button onClick={load} className="ml-1 font-medium text-accent-soft hover:underline">
          Refresh
        </button>
      </p>
    </>
  );
}

/* ─────────────────────────── Cloud & Backups ──────────────────────────── */

function CloudTab() {
  const [r2, setR2] = useState<R2Status | null>(null);
  const [showR2Setup, setShowR2Setup] = useState(false);
  const [checking, setChecking] = useState(false);
  const [backupsCfg, setBackupsCfg] = useState<BackupsConfig | null>(null);

  const loadR2 = () => api.r2ConfigGet().then(setR2).catch(() => setR2(null));

  useEffect(() => {
    loadR2();
    api.getBackupsConfig().then(setBackupsCfg).catch(() => {});
  }, []);

  async function disconnect() {
    if (!confirm("Disconnect Cloudflare R2? Cloud world-sync and cloud backups will stop working until you reconnect.")) {
      return;
    }
    await api.r2ConfigClear();
    await loadR2();
    toast.ok("Disconnected from R2");
  }

  async function recheck() {
    setChecking(true);
    await loadR2();
    setChecking(false);
  }

  async function saveKeep(n: number) {
    const v = Math.max(0, Math.min(1000, Math.floor(n)));
    setBackupsCfg({ keep: v });
    try {
      await api.setBackupsKeep(v);
    } catch (e) {
      toast.bad("Couldn't save backup retention", String(e));
    }
  }

  return (
    <>
      <Card
        title="Cloud sync (Cloudflare R2)"
        icon="cloud"
        description="Powers cross-device world sync and, once a server opts in, pushing its scheduled backups off this machine too."
        right={
          r2?.configured ? (
            <Badge tone="ok" dot>
              Connected
            </Badge>
          ) : (
            <Badge tone="neutral">Not set up</Badge>
          )
        }
      >
        {r2?.configured && r2.config ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5 text-2xs text-ink-dim">
              <div>
                <span className="text-ink-faint">Account:</span> {r2.config.accountId}
              </div>
              <div>
                <span className="text-ink-faint">Bucket:</span> {r2.config.bucket}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={checking} onClick={recheck}>
                {checking ? "Checking…" : "Verify connection"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowR2Setup(true)}>
                Reconfigure
              </Button>
              <Button variant="danger" size="sm" onClick={disconnect}>
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon="cloud" onClick={() => setShowR2Setup(true)}>
              Set up cloud sync
            </Button>
            <span className="text-2xs text-ink-faint">
              Needs a free Cloudflare R2 bucket + API token.
            </span>
          </div>
        )}
      </Card>

      <Card
        title="Local backup retention"
        icon="archive"
        description="Applies to every server — oldest backups get pruned first. Turned on per-server in its Backups tab."
        className="mt-4"
      >
        <Field label="Keep newest" hint="0 = unlimited">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={1000}
              value={backupsCfg?.keep ?? ""}
              onChange={(e) => saveKeep(Number(e.target.value))}
              className="w-24 rounded border border-line bg-surface-2 px-2 py-1.5 text-sm text-ink"
            />
            <span className="text-2xs text-ink-faint">backups per server</span>
          </div>
        </Field>
      </Card>

      {showR2Setup && (
        <R2SetupModal
          onClose={() => setShowR2Setup(false)}
          onSaved={async () => {
            setShowR2Setup(false);
            await loadR2();
            toast.ok("Connected to R2");
          }}
        />
      )}
    </>
  );
}

/* ────────────────────────────── Diagnostics ───────────────────────────── */

function DiagnosticsTab() {
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      setDoctor(await api.doctorCheck());
    } catch {
      setDoctor(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card
      title="Health check"
      icon="activity"
      description="Java, disk space, a free port, and cloud sync if you've set it up — catches the reasons a server might fail to create or start, before it fails."
      right={
        <Button variant="ghost" disabled={running} onClick={run}>
          {running ? "Checking…" : doctor ? "Run again" : "Run check"}
        </Button>
      }
    >
      {doctor && (
        <>
          <div className={`text-2xs font-medium ${doctor.allOk ? "text-ok" : "text-warn"}`}>
            {doctor.allOk
              ? "Everything checks out."
              : `${doctor.checks.filter((c) => !c.ok).length} thing${doctor.checks.filter((c) => !c.ok).length > 1 ? "s" : ""} to look at:`}
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {doctor.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 rounded-md bg-surface-2 px-2.5 py-2">
                <StatusDot tone={c.ok ? "ok" : "bad"} size={7} className="mt-1 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-ink">{c.label}</div>
                  <div className="mt-0.5 text-2xs leading-snug text-ink-faint">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/* ──────────────────────────────── About ───────────────────────────────── */

function AboutTab({ githubRepo }: { githubRepo: string }) {
  const [version, setVersion] = useState<string | null>(null);
  const [installId, setInstallId] = useState<string | null>(null);

  useEffect(() => {
    api.checkUpdate().then((u) => setVersion(u.current)).catch(() => {});
    api.appInstallId().then(setInstallId).catch(() => {});
  }, []);

  return (
    <>
      <Card title="CraftPanel" icon="info">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-sm font-medium text-ink">
              Version {version ?? "…"}
            </div>
            <div className="mt-0.5 text-2xs text-ink-faint">
              A self-hosted Minecraft server manager.
            </div>
          </div>
          {githubRepo && (
            <a
              href={`https://github.com/${githubRepo}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1 text-2xs text-accent-soft underline"
            >
              <Icon name="external-link" size={11} />
              {githubRepo}
            </a>
          )}
        </div>
      </Card>

      <Card
        title="This install"
        icon="key"
        description="A random id for this install of CraftPanel — not you, not your servers' content. It's what gets written into a server's hidden .craftpanel-meta.json when CraftPanel creates or adopts it, so a server folder can be traced back to the install that made it. Nothing leaves your machine on its own; it only ever shows up if a server is shared through CraftPanel's own sync."
        className="mt-4"
      >
        {installId ? (
          <CopyField value={installId} size="sm" />
        ) : (
          <div className="text-2xs text-ink-faint">Loading…</div>
        )}
      </Card>
    </>
  );
}
