import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import {
  LOADER_META,
  type CreateSpec,
  type Loader,
  type ProvisionProgress,
  type ServerRecord,
  type VersionInfo,
} from "../types";
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Field,
  IconButton,
  ProgressBar,
  StateBlock,
  TextInput,
  Toggle,
  Tooltip,
  cx,
} from "./ui";
import { Icon } from "./Icon";
import { LoaderMark } from "./LoaderMark";
import { LogoMark } from "./Logo";
import { RamSlider } from "./RamSlider";
import { createPortal } from "react-dom";

const LOADERS: Loader[] = ["paper", "vanilla", "fabric", "neoforge", "forge"];

/** Plain-language "why would I pick this?" — LOADER_META's blurb is terser. */
const LOADER_PITCH: Record<Loader, string> = {
  paper: "Runs smoothly and takes plugins. The best pick if you're not sure.",
  vanilla: "Exactly what Mojang ships. No mods, no plugins, no surprises.",
  fabric: "Light and quick to update — the usual choice for modpacks.",
  neoforge: "The actively developed Forge. Use it for newer modpacks.",
  forge: "The classic mod loader. Use it if your modpack says Forge.",
};

const GAMEMODES = [
  { v: "survival", icon: "heart", label: "Survival", hint: "Hunger, mobs, the works" },
  { v: "creative", icon: "sparkle", label: "Creative", hint: "Fly, infinite blocks" },
  { v: "adventure", icon: "map", label: "Adventure", hint: "For built maps" },
  { v: "spectator", icon: "eye", label: "Spectator", hint: "Fly through walls" },
];

const DIFFICULTIES = [
  { v: "peaceful", label: "Peaceful", hint: "No hostile mobs" },
  { v: "easy", label: "Easy", hint: "Gentle" },
  { v: "normal", label: "Normal", hint: "The default" },
  { v: "hard", label: "Hard", hint: "Mobs hit harder" },
];

/**
 * Forge "1.20.1-47.2.0" -> "1.20.1" (MC version is the prefix).
 * NeoForge "21.1.172" -> "1.21.1"; year-scheme "26.2.5" -> "26.2".
 */
function deriveMcVersion(loader: Loader, versionId: string): string {
  if (loader === "forge") return versionId.split("-")[0];
  if (loader === "neoforge") {
    const [a, b] = versionId.split(".");
    if (!a || !b) return versionId;
    return Number(a) >= 20 ? `${a}.${b}` : `1.${a}.${b}`;
  }
  return versionId;
}

/* ── step rail ─────────────────────────────────────────────────────────── */

const STEPS = ["Flavour", "Version", "Your world", "Ready"];

function StepRail({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5">
      {STEPS.map((s, i) => {
        const done = i < step;
        const now = i === step;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span
              className={cx(
                "flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-2xs font-medium transition-colors duration-[160ms]",
                now
                  ? "bg-accent-muted text-accent-soft"
                  : done
                    ? "text-ok"
                    : "text-ink-ghost",
              )}
            >
              <span
                className={cx(
                  "grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold",
                  now
                    ? "bg-accent text-on-accent"
                    : done
                      ? "bg-ok/20 text-ok"
                      : "bg-surface-3 text-ink-ghost",
                )}
              >
                {done ? <Icon name="check" size={9} strokeWidth={3.5} /> : i + 1}
              </span>
              {s}
            </span>
            {i < STEPS.length - 1 && (
              <span
                className={cx(
                  "h-px w-3",
                  done ? "bg-ok/40" : "bg-line",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** A fake multiplayer-list row, so the MOTD isn't an abstract text box. */
function MotdPreview({ name, motd }: { name: string; motd: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-line-soft bg-console p-2">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xs bg-surface-3 text-ink-ghost">
        <Icon name="cube" size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-ink">
          {name || "My Server"}
        </div>
        <div className="truncate font-mono text-2xs text-ink-faint">
          {motd || "A Minecraft Server"}
        </div>
      </div>
      <div className="flex items-end gap-px pb-0.5" aria-hidden="true">
        {[3, 5, 7, 9, 11].map((h, i) => (
          <span
            key={h}
            className={cx("w-[3px] rounded-t-xs", i < 4 ? "bg-ok" : "bg-surface-4")}
            style={{ height: h }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── the wizard ────────────────────────────────────────────────────────── */

export function CreateServerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (s: ServerRecord) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [loader, setLoader] = useState<Loader>("paper");

  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [showUnstable, setShowUnstable] = useState(false);
  const [versionQuery, setVersionQuery] = useState("");
  const [versionId, setVersionId] = useState("");

  const [parentDir, setParentDir] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ram, setRam] = useState(4096);
  const [agree, setAgree] = useState(false);

  const [seed, setSeed] = useState("");
  const [gamemode, setGamemode] = useState("survival");
  const [difficulty, setDifficulty] = useState("normal");
  const [motd, setMotd] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(20);

  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<ProvisionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // fetch versions when entering step 1 / changing loader
  useEffect(() => {
    if (step !== 1) return;
    setVersions(null);
    setVersionsError(null);
    setVersionId("");
    api
      .loaderVersions(loader)
      .then(setVersions)
      .catch((e) => setVersionsError(String(e)));
  }, [step, loader]);

  const visibleVersions = useMemo(() => {
    if (!versions) return [];
    const base = showUnstable
      ? versions
      : versions.filter((v) => v.kind === "release");
    const q = versionQuery.trim().toLowerCase();
    return q ? base.filter((v) => v.id.toLowerCase().includes(q)) : base;
  }, [versions, showUnstable, versionQuery]);

  useEffect(() => {
    if (!versionId && visibleVersions.length) setVersionId(visibleVersions[0].id);
  }, [visibleVersions, versionId]);

  const sep = parentDir?.includes("\\") ? "\\" : "/";
  const safeName =
    name.trim().replace(/[^A-Za-z0-9 _-]/g, "").trim() || "server";
  const finalDir = parentDir
    ? `${parentDir}${sep}${safeName.replace(/\s+/g, "-")}`
    : "";

  useEffect(() => {
    let un: (() => void) | undefined;
    api.onProvisionProgress(setProgress).then((f) => (un = f));
    return () => un?.();
  }, []);

  // Esc closes, unless we're mid-download
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [creating, onClose]);

  async function pickParent() {
    const d = await api.pickFolder();
    if (d) {
      setParentDir(d);
      if (!name) setName("My Server");
    }
  }

  async function create() {
    setCreating(true);
    setError(null);
    setProgress({ stage: "start", message: "Getting started…", pct: 0 });
    const spec: CreateSpec = {
      loader,
      mc_version: deriveMcVersion(loader, versionId),
      loader_version:
        loader === "neoforge" || loader === "forge" ? versionId : null,
      dir: finalDir,
      name: name.trim() || safeName,
      ram_mb: ram,
      java_path: null,
      accept_eula: agree,
      seed: seed.trim() || null,
      gamemode,
      difficulty,
      motd: motd.trim() || null,
      max_players: maxPlayers,
    };
    try {
      const rec = await api.createServer(spec);
      onCreated(rec);
    } catch (e) {
      setError(String(e));
      setCreating(false);
    }
  }

  const canNext =
    step === 0
      ? true
      : step === 1
        ? !!versionId
        : step === 2
          ? !!parentDir && !!name.trim()
          : agree;

  const mcVersion = versionId ? deriveMcVersion(loader, versionId) : "";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="cp-fade absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        onClick={creating ? undefined : onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        className="cp-pop relative flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-e3"
      >
        {/* ── header ─────────────────────────────────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b border-line-soft px-5 py-3.5">
          <LogoMark size={26} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold text-ink">
              {creating ? "Building your server" : "New server"}
            </h2>
            {!creating && (
              <div className="mt-1.5">
                <StepRail step={step} />
              </div>
            )}
          </div>
          {!creating && <IconButton icon="x" title="Cancel" onClick={onClose} />}
        </header>

        {/* ── body ───────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {creating ? (
            /* ── provisioning ───────────────────────────────────── */
            <div className="space-y-4 py-6 text-center">
              <div className="flex justify-center">
                <LoaderMark loader={loader} size={52} />
              </div>
              <div>
                <div className="font-display text-base font-semibold text-ink">
                  {progress?.message ?? "Working…"}
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  {LOADER_META[loader].label} {mcVersion} → {safeName}
                </p>
              </div>
              <ProgressBar
                pct={progress?.pct ?? undefined}
                indeterminate={progress?.pct == null}
                className="mx-auto max-w-sm"
              />
              <p className="mx-auto max-w-sm text-2xs leading-relaxed text-ink-faint">
                Downloading the server and generating the world can take a couple
                of minutes on a first run. You can leave this window open —
                closing CraftPanel now would cancel it.
              </p>
              {error && (
                <Banner tone="bad" className="text-left">
                  <div className="break-words">{error}</div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setCreating(false);
                      setError(null);
                    }}
                  >
                    Back to the settings
                  </Button>
                </Banner>
              )}
            </div>
          ) : step === 0 ? (
            /* ── 1. flavour ─────────────────────────────────────── */
            <div className="space-y-2">
              <p className="pb-1 text-xs leading-relaxed text-ink-faint">
                A “flavour” decides what your server can run. You can't change it
                later without making a new server — but{" "}
                <strong className="text-ink-dim">Paper</strong> is right for most
                people.
              </p>
              {LOADERS.map((l) => {
                const on = loader === l;
                return (
                  <button
                    key={l}
                    onClick={() => setLoader(l)}
                    aria-pressed={on}
                    className={cx(
                      "flex w-full items-center gap-3.5 rounded-lg border p-3 text-left transition-colors duration-[120ms] ease-cp",
                      on
                        ? "border-accent bg-accent-muted"
                        : "border-line-soft bg-surface-2 hover:border-line-strong hover:bg-surface-3",
                    )}
                  >
                    <LoaderMark loader={l} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-sm font-semibold text-ink">
                          {LOADER_META[l].label}
                        </span>
                        {l === "paper" && (
                          <Badge tone="accent" size="sm">
                            Recommended
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-2xs leading-snug text-ink-faint">
                        {LOADER_PITCH[l]}
                      </p>
                    </div>
                    <span
                      className={cx(
                        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors",
                        on
                          ? "border-accent bg-accent text-on-accent"
                          : "border-line",
                      )}
                    >
                      {on && <Icon name="check" size={11} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : step === 1 ? (
            /* ── 2. version ─────────────────────────────────────── */
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <TextInput
                  autoFocus
                  icon="search"
                  value={versionQuery}
                  placeholder={`Search ${LOADER_META[loader].label} versions…`}
                  onChange={(e) => setVersionQuery(e.target.value)}
                />
                <Tooltip label="Snapshots and betas are unfinished builds. Mods usually don't work on them.">
                  <label className="flex shrink-0 items-center gap-2 text-2xs text-ink-dim">
                    <Toggle
                      size="sm"
                      checked={showUnstable}
                      onChange={setShowUnstable}
                      label="Show snapshots and betas"
                    />
                    Snapshots
                  </label>
                </Tooltip>
              </div>

              {versionsError ? (
                <StateBlock
                  state="error"
                  title="Couldn't load the version list"
                  message={
                    <>
                      CraftPanel needs the internet to fetch versions.
                      <div className="mt-2 break-words font-mono text-2xs text-ink-ghost">
                        {versionsError}
                      </div>
                    </>
                  }
                  onRetry={() => {
                    setVersionsError(null);
                    setVersions(null);
                    api
                      .loaderVersions(loader)
                      .then(setVersions)
                      .catch((e) => setVersionsError(String(e)));
                  }}
                />
              ) : !versions ? (
                <StateBlock state="loading" title="Fetching versions…" />
              ) : visibleVersions.length === 0 ? (
                <StateBlock
                  state="empty"
                  icon="search"
                  title="No versions match"
                  message={
                    versionQuery
                      ? `Nothing called “${versionQuery}”. Try a shorter search.`
                      : "Turn on snapshots to see pre-release builds."
                  }
                  compact
                />
              ) : (
                <div
                  role="listbox"
                  aria-label="Minecraft version"
                  className="max-h-72 overflow-y-auto rounded-lg border border-line-soft bg-surface-2 p-1"
                >
                  {visibleVersions.map((v, i) => {
                    const on = v.id === versionId;
                    return (
                      <button
                        key={v.id}
                        role="option"
                        aria-selected={on}
                        onClick={() => setVersionId(v.id)}
                        className={cx(
                          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-[120ms]",
                          on
                            ? "bg-accent-muted text-ink"
                            : "text-ink-dim hover:bg-surface-3 hover:text-ink",
                        )}
                      >
                        <span
                          className={cx(
                            "grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full border",
                            on ? "border-accent bg-accent text-on-accent" : "border-line",
                          )}
                        >
                          {on && <Icon name="check" size={10} strokeWidth={3} />}
                        </span>
                        <span className="flex-1 font-mono text-xs">{v.id}</span>
                        {i === 0 && !versionQuery && (
                          <Badge tone="ok" size="sm">
                            Latest
                          </Badge>
                        )}
                        {v.kind !== "release" && (
                          <Badge tone="warn" size="sm">
                            {v.kind}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {versionId && (
                <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-2xs text-ink-faint">
                  <Icon name="info" size={12} className="shrink-0" />
                  {loader === "fabric" ? (
                    <span>
                      Uses the newest stable Fabric loader for Minecraft{" "}
                      <span className="font-mono text-ink-dim">{mcVersion}</span>.
                    </span>
                  ) : loader === "neoforge" || loader === "forge" ? (
                    <span>
                      That's{" "}
                      <span className="font-mono text-ink-dim">
                        Minecraft {mcVersion}
                      </span>{" "}
                      with {LOADER_META[loader].label} {versionId}. Your friends
                      need the same modpack.
                    </span>
                  ) : (
                    <span>
                      Everyone joining needs Minecraft{" "}
                      <span className="font-mono text-ink-dim">{mcVersion}</span>.
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : step === 2 ? (
            /* ── 3. your world ──────────────────────────────────── */
            <div className="space-y-5">
              <section className="space-y-3">
                <h3 className="font-display text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
                  The basics
                </h3>
                <Field label="What should we call it?">
                  <TextInput
                    autoFocus
                    value={name}
                    placeholder="My Server"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field
                  label="Where should it live?"
                  hint="We make a new folder inside the one you pick."
                >
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      icon="folder-open"
                      onClick={pickParent}
                    >
                      {parentDir ? "Change folder…" : "Choose a folder…"}
                    </Button>
                    {finalDir && (
                      <span
                        data-selectable
                        className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-faint"
                        title={finalDir}
                      >
                        {finalDir}
                      </span>
                    )}
                  </div>
                </Field>
                <div className="rounded-lg border border-line-soft bg-surface-2 p-3.5">
                  <RamSlider valueMb={ram} onChange={setRam} />
                </div>
              </section>

              <div className="cp-rule" />

              <section className="space-y-4">
                <h3 className="font-display text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
                  World &amp; rules
                </h3>

                <div>
                  <div className="mb-1.5 text-2xs font-medium text-ink-dim">
                    How do you want to play?
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {GAMEMODES.map((g) => {
                      const on = gamemode === g.v;
                      return (
                        <button
                          key={g.v}
                          onClick={() => setGamemode(g.v)}
                          aria-pressed={on}
                          className={cx(
                            "rounded-lg border px-2 py-2.5 text-center transition-colors duration-[120ms]",
                            on
                              ? "border-accent bg-accent-muted"
                              : "border-line-soft bg-surface-2 hover:border-line-strong",
                          )}
                        >
                          <Icon
                            name={g.icon}
                            size={16}
                            className={cx(
                              "mx-auto mb-1.5",
                              on ? "text-accent" : "text-ink-faint",
                            )}
                          />
                          <div className="text-2xs font-medium text-ink">
                            {g.label}
                          </div>
                          <div className="mt-0.5 text-[10px] leading-tight text-ink-faint">
                            {g.hint}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-2xs font-medium text-ink-dim">
                    How dangerous?
                  </div>
                  <div className="flex gap-1.5">
                    {DIFFICULTIES.map((d) => {
                      const on = difficulty === d.v;
                      return (
                        <Tooltip key={d.v} label={d.hint} className="flex-1">
                          <button
                            onClick={() => setDifficulty(d.v)}
                            aria-pressed={on}
                            className={cx(
                              "w-full rounded-md border py-1.5 text-2xs font-medium transition-colors duration-[120ms]",
                              on
                                ? "border-accent bg-accent-muted text-accent-soft"
                                : "border-line-soft bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
                            )}
                          >
                            {d.label}
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="World seed"
                    hint="Leave blank for a random world."
                  >
                    <TextInput
                      mono
                      value={seed}
                      placeholder="random"
                      onChange={(e) => setSeed(e.target.value)}
                      suffix={
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setSeed(
                              String(
                                Math.floor(Math.random() * 2 ** 48) -
                                  2 ** 47,
                              ),
                            );
                          }}
                          className="flex items-center gap-1 rounded-xs px-1 py-0.5 text-accent-soft hover:bg-surface-3"
                        >
                          <Icon name="dice" size={11} /> roll
                        </button>
                      }
                    />
                  </Field>
                  <Field label="How many players at once?">
                    <TextInput
                      type="number"
                      min={1}
                      max={1000}
                      value={maxPlayers}
                      onChange={(e) =>
                        setMaxPlayers(Number(e.target.value) || 20)
                      }
                      className="tabular-nums"
                    />
                  </Field>
                </div>

                <Field label="Server description">
                  <TextInput
                    value={motd}
                    placeholder="A Minecraft Server"
                    maxLength={59}
                    onChange={(e) => setMotd(e.target.value)}
                  />
                  <div className="mt-2">
                    <MotdPreview name={name} motd={motd} />
                    <p className="mt-1.5 text-2xs text-ink-faint">
                      This is what friends see in their multiplayer list.
                    </p>
                  </div>
                </Field>

              </section>
            </div>
          ) : (
            /* ── 4. ready ───────────────────────────────────────── */
            <div className="space-y-4">
              <div className="rounded-lg border border-line-soft bg-surface-2 p-4">
                <div className="flex items-center gap-3.5">
                  <LoaderMark loader={loader} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="cp-display truncate text-base text-ink">
                      {name.trim() || safeName}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone="accent">{LOADER_META[loader].label}</Badge>
                      <Badge tone="neutral">MC {mcVersion}</Badge>
                      <Badge tone="neutral">
                        {(ram / 1024).toFixed(ram % 1024 ? 1 : 0)} GB RAM
                      </Badge>
                    </div>
                  </div>
                </div>

                <dl className="mt-4 space-y-1.5 border-t border-line-soft pt-3 text-2xs">
                  {[
                    ["Folder", finalDir, "folder"],
                    [
                      "World",
                      `${gamemode} · ${difficulty}${seed ? ` · seed ${seed}` : " · random seed"}`,
                      "globe",
                    ],
                    ["Players", `up to ${maxPlayers}`, "users"],
                  ].map(([k, v, ic]) => (
                    <div key={k} className="flex gap-2.5">
                      <Icon
                        name={ic}
                        size={12}
                        className="mt-0.5 shrink-0 text-ink-ghost"
                      />
                      <dt className="w-14 shrink-0 text-ink-faint">{k}</dt>
                      <dd
                        data-selectable
                        className="min-w-0 flex-1 break-all font-mono text-ink-dim"
                      >
                        {v}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line-soft bg-surface-2 p-3">
                <Checkbox
                  checked={agree}
                  onChange={setAgree}
                  label="I agree to the Minecraft EULA"
                />
                <span className="text-2xs leading-relaxed text-ink-dim">
                  I agree to the{" "}
                  <a
                    href="https://aka.ms/MinecraftEULA"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Minecraft EULA
                  </a>
                  . CraftPanel will write <code>eula=true</code> and boot the
                  server once to generate its files.
                </span>
              </label>

              {error && <Banner tone="bad">{error}</Banner>}
            </div>
          )}
        </div>

        {/* ── footer ─────────────────────────────────────────────── */}
        {!creating && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-line-soft bg-surface-2/60 px-5 py-3">
            <Button
              variant="quiet"
              icon={step === 0 ? undefined : "arrow-left"}
              onClick={() =>
                step === 0 ? onClose() : setStep((s) => (s - 1) as 0)
              }
            >
              {step === 0 ? "Cancel" : "Back"}
            </Button>
            <span className="flex-1" />
            {step === 2 && !parentDir && (
              <span className="text-2xs text-ink-faint">
                Pick a folder to continue
              </span>
            )}
            {step < 3 ? (
              <Button
                variant="primary"
                size="lg"
                iconRight="arrow-right"
                disabled={!canNext}
                onClick={() => setStep((s) => (s + 1) as 1)}
              >
                Continue
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                icon="wand"
                disabled={!agree}
                onClick={create}
              >
                Create server
              </Button>
            )}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
