import { useEffect, useState } from "react";
import { api } from "../api";
import type {
  AppSettings,
  BackupsConfig,
  DoctorReport,
  JavaInfo,
  ProvisionProgress,
  RemoteApiStatus,
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
  cx,
  toast,
  type TabDef,
} from "./ui";
import { Icon } from "./Icon";

const DEFAULTS: AppSettings = {
  defaultJava: "",
  defaultRamMb: 4096,
  expertMode: false,
  keepServersOnQuit: false,
  stayAwakeOnPower: false,
};

type Tab = "general" | "account" | "updates" | "java" | "backups" | "diagnostics" | "about";

const TABS: TabDef[] = [
  { id: "general", label: "General", icon: "sliders" },
  { id: "account", label: "Account", icon: "user" },
  { id: "updates", label: "Updates", icon: "download" },
  { id: "java", label: "Java", icon: "cpu" },
  { id: "backups", label: "Backups", icon: "archive" },
  { id: "diagnostics", label: "Diagnostics", icon: "activity" },
  { id: "about", label: "About", icon: "info" },
];

const JAVA_FEATURES = [17, 21, 25] as const;

/** CraftPanel's own repo — resolved once at compile time on the Rust side
 *  (`updater::DEFAULT_REPO`, overridable per-build via the `CRAFTPANEL_REPO`
 *  env var, not a per-user setting). Mirrored here just for the About
 *  link's `href`. */
const DEFAULT_REPO = "Rashica07/craftpanel";

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
  // Tabs stay mounted (hidden, not destroyed) once visited — switching tabs
  // used to unmount the previous one, throwing away anything it had fetched
  // (e.g. a "check for updates" result) or, before this was lifted into `s`
  // below, anything typed but not yet saved.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["general"]));
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);

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

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
        <div className={cx("mx-auto max-w-2xl space-y-4", tab !== "general" && "hidden")}>
          <GeneralTab s={s} set={set} />
        </div>
        {visited.has("account") && (
          <div className={cx("mx-auto max-w-2xl space-y-4", tab !== "account" && "hidden")}>
            <AccountTab />
          </div>
        )}
        {visited.has("updates") && (
          <div className={cx("mx-auto max-w-2xl space-y-4", tab !== "updates" && "hidden")}>
            <UpdatesTab />
          </div>
        )}
        {visited.has("java") && (
          <div className={cx("mx-auto max-w-2xl space-y-4", tab !== "java" && "hidden")}>
            <JavaTab s={s} set={set} />
          </div>
        )}
        {visited.has("backups") && (
          <div className={cx("mx-auto max-w-2xl space-y-4", tab !== "backups" && "hidden")}>
            <BackupsTab />
          </div>
        )}
        {visited.has("diagnostics") && (
          <div className={cx("mx-auto max-w-2xl space-y-4", tab !== "diagnostics" && "hidden")}>
            <DiagnosticsTab />
          </div>
        )}
        {visited.has("about") && (
          <div className={cx("mx-auto max-w-2xl space-y-4", tab !== "about" && "hidden")}>
            <AboutTab />
          </div>
        )}
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
    <>
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
          Stay awake on power
          <span className="mt-0.5 block text-2xs text-ink-faint">
            Stops this Mac from sleeping while it's plugged in — on battery it still sleeps
            normally. What lets a server's scheduled start (set per-server, under Settings →
            Automation) actually fire instead of sitting there asleep.
          </span>
        </span>
        <Toggle checked={s.stayAwakeOnPower} onChange={(v) => set("stayAwakeOnPower", v)} />
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
    </>
  );
}

/* ─────────────────────────────── Updates ──────────────────────────────── */

function UpdatesTab() {
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
      description={`Checks and installs releases from ${DEFAULT_REPO}.`}
    >
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

function BackupsTab() {
  const [backupsCfg, setBackupsCfg] = useState<BackupsConfig | null>(null);

  useEffect(() => {
    api.getBackupsConfig().then(setBackupsCfg).catch(() => {});
  }, []);

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
    <Card
      title="Local backup retention"
      icon="archive"
      description="Applies to every server — oldest backups get pruned first. Turned on per-server in its Backups tab."
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
      description="Java, disk space, and a free port — catches the reasons a server might fail to create or start, before it fails."
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

function AboutTab() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    api.checkUpdate().then((u) => setVersion(u.current)).catch(() => {});
  }, []);

  const repo = DEFAULT_REPO;

  return (
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
        <a
          href={`https://github.com/${repo}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1 text-2xs text-accent-soft underline"
        >
          <Icon name="external-link" size={11} />
          {repo}
        </a>
      </div>
    </Card>
  );
}

/* ─────────────────────────────── Account ──────────────────────────────── */

function AccountTab() {
  const [installId, setInstallId] = useState<string | null>(null);

  useEffect(() => {
    api.appInstallId().then(setInstallId).catch(() => {});
  }, []);

  return (
    <>
      <Card
        title="This install"
        icon="key"
        description="A random id for this install of CraftPanel — not you, not your servers' content. It's what gets written into a server's hidden .craftpanel-meta.json when CraftPanel creates or adopts it, so a server folder can be traced back to the install that made it. Nothing leaves your machine on its own; it only ever shows up if a server is shared through CraftPanel's own sync."
      >
        {installId ? (
          <CopyField value={installId} size="sm" />
        ) : (
          <div className="text-2xs text-ink-faint">Loading…</div>
        )}
      </Card>

      <LockCard />
      <RemoteApiCard />
    </>
  );
}

function RemoteApiCard() {
  const [status, setStatus] = useState<RemoteApiStatus | null>(null);
  const [pairPayload, setPairPayload] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.remoteApiStatus().then(setStatus).catch(() => {});
  };
  useEffect(load, []);

  useEffect(() => {
    if (!status?.running) {
      setPairPayload(null);
      setQr(null);
      return;
    }
    // one fetch feeds both the "Copy" button and the QR — they need to be
    // the exact same code, not two independent requests that could race
    // and disagree if the token rotates mid-load.
    api
      .remoteApiPairPayload()
      .then((payload) => {
        setPairPayload(payload);
        return api.qrSvg(payload);
      })
      .then(setQr)
      .catch(() => {
        setPairPayload(null);
        setQr(null);
      });
  }, [status?.running, status?.token]);

  async function toggle(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.remoteApiSetEnabled(enabled));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.remoteApiRegenerateToken());
      toast.ok("New token generated — re-pair the Android app.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Remote access"
      icon="smartphone"
      description="Lets the CraftPanel Android app see and control your servers from your phone — reachable the same way friends join your servers (your public IP), so it works away from home too. Off by default; anyone with the token below can control your servers, so keep it private and turn this off when you're not using the app."
      className="mt-4"
      right={
        status ? (
          <Badge tone={status.running ? "ok" : "neutral"} dot>
            {status.running ? "On" : "Off"}
          </Badge>
        ) : undefined
      }
    >
      <div className="flex items-center gap-2">
        <Toggle
          checked={status?.enabled ?? false}
          disabled={busy || !status}
          onChange={toggle}
          label="Remote access"
        />
        <span className="text-2xs text-ink-faint">
          {status?.running
            ? `Listening on port ${status.port}`
            : "Turn on to pair your phone"}
        </span>
      </div>

      {error && <p className="mt-2 text-2xs text-bad-soft">{error}</p>}

      {status?.running && (
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Field
              label="Pairing code"
              hint="Paste this into the Android app's “Pairing code” box — it's the host, port, and token together, not just the token below."
            >
              <CopyField value={pairPayload ?? "Loading…"} size="sm" />
            </Field>
            <Field label="Token only" hint="For the app's manual host/port/token entry — not what most people want.">
              <CopyField value={status.token} size="sm" />
            </Field>
            <Button variant="ghost" size="sm" loading={busy} onClick={regenerate}>
              Generate a new token
            </Button>
          </div>
          {qr && (
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div
                className="h-[124px] w-[124px] rounded-lg bg-white p-2 shadow-e2 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qr }}
              />
              <span className="flex items-center gap-1 text-2xs text-ink-faint">
                <Icon name="smartphone" size={11} />
                Scan to pair
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

type LockMode = "idle" | "set" | "change" | "remove";

function LockCard() {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [mode, setMode] = useState<LockMode>("idle");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.lockStatus().then(setIsSet).catch(() => setIsSet(false));
  };
  useEffect(load, []);

  function reset() {
    setMode("idle");
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  }

  async function submitSet() {
    if (next !== confirm) return setError("Those two don't match.");
    setBusy(true);
    setError(null);
    try {
      await api.lockSet(next);
      toast.ok("PIN set — CraftPanel will ask for it next launch.");
      reset();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitChange() {
    if (next !== confirm) return setError("Those two don't match.");
    setBusy(true);
    setError(null);
    try {
      if (!(await api.lockCheck(current))) throw new Error("Current PIN is wrong.");
      await api.lockSet(next);
      toast.ok("PIN changed.");
      reset();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitRemove() {
    setBusy(true);
    setError(null);
    try {
      await api.lockClear(current);
      toast.ok("PIN removed — CraftPanel opens straight to your servers now.");
      reset();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="App lock"
      icon="lock"
      description="A local PIN CraftPanel asks for on launch — for a shared computer, not real security against someone with access to the files. Doesn't touch your servers or their worlds."
      className="mt-4"
      right={
        isSet == null ? undefined : (
          <Badge tone={isSet ? "ok" : "neutral"} dot>
            {isSet ? "PIN set" : "Not set"}
          </Badge>
        )
      }
    >
      {mode === "idle" && (
        <div className="flex gap-2">
          {!isSet ? (
            <Button variant="secondary" size="sm" icon="lock" onClick={() => setMode("set")}>
              Set a PIN
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setMode("change")}>
                Change PIN
              </Button>
              <Button variant="danger" size="sm" onClick={() => setMode("remove")}>
                Remove PIN
              </Button>
            </>
          )}
        </div>
      )}

      {(mode === "set" || mode === "change") && (
        <div className="space-y-2">
          {mode === "change" && (
            <Field label="Current PIN">
              <TextInput
                type="password"
                autoFocus
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
          )}
          <Field label="New PIN" hint="At least 4 characters.">
            <TextInput
              type="password"
              autoFocus={mode === "set"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="Confirm new PIN">
            <TextInput
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          {error && <p className="text-2xs text-bad-soft">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!next || !confirm || (mode === "change" && !current)}
              onClick={mode === "set" ? submitSet : submitChange}
            >
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "remove" && (
        <div className="space-y-2">
          <Field label="Current PIN, to confirm">
            <TextInput
              type="password"
              autoFocus
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          {error && <p className="text-2xs text-bad-soft">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="danger" size="sm" loading={busy} disabled={!current} onClick={submitRemove}>
              Remove PIN
            </Button>
            <Button variant="ghost" size="sm" onClick={reset} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
