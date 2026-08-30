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
import { Badge, Button, Field, TextInput } from "./ui";
import { RamSlider } from "./RamSlider";

const LOADERS: Loader[] = ["vanilla", "paper", "fabric", "neoforge", "forge"];

/**
 * Forge "1.20.1-47.2.0" -> "1.20.1" (MC version is the prefix).
 * NeoForge "21.1.172" -> "1.21.1"; year-scheme "26.2.5" -> "26.2".
 */
function deriveMcVersion(loader: Loader, versionId: string): string {
  if (loader === "forge") return versionId.split("-")[0];
  if (loader === "neoforge") {
    const [a, b] = versionId.split(".");
    if (!a || !b) return versionId;
    // classic: NeoForge major == MC minor -> 1.<a>.<b>
    // year scheme (MC 26.x+): a is already the year major -> <a>.<b>
    return Number(a) >= 20 ? `${a}.${b}` : `1.${a}.${b}`;
  }
  return versionId;
}

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
  const [versionId, setVersionId] = useState("");

  const [parentDir, setParentDir] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ram, setRam] = useState(4096);
  const [agree, setAgree] = useState(false);

  const [showOpts, setShowOpts] = useState(false);
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
      .then((v) => setVersions(v))
      .catch((e) => setVersionsError(String(e)));
  }, [step, loader]);

  const visibleVersions = useMemo(() => {
    if (!versions) return [];
    return showUnstable ? versions : versions.filter((v) => v.kind === "release");
  }, [versions, showUnstable]);

  useEffect(() => {
    if (!versionId && visibleVersions.length) setVersionId(visibleVersions[0].id);
  }, [visibleVersions, versionId]);

  const sep = parentDir?.includes("\\") ? "\\" : "/";
  const safeName = name.trim().replace(/[^A-Za-z0-9 _-]/g, "").trim() || "server";
  const finalDir = parentDir ? `${parentDir}${sep}${safeName.replace(/\s+/g, "-")}` : "";

  useEffect(() => {
    let un: (() => void) | undefined;
    api.onProvisionProgress(setProgress).then((f) => (un = f));
    return () => un?.();
  }, []);

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
    setProgress({ stage: "start", message: "Starting…", pct: 0 });
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl border border-edge bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-edge px-5 py-3">
          <h2 className="text-sm font-semibold">
            Create a server{" "}
            <span className="text-ink-faint">· step {step + 1} of 4</span>
          </h2>
          {!creating && (
            <button onClick={onClose} className="text-ink-faint hover:text-ink">
              ✕
            </button>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {creating ? (
            <div className="space-y-3 py-6">
              <div className="text-sm font-medium">{progress?.message ?? "Working…"}</div>
              <div className="h-2 overflow-hidden rounded-full bg-panel-3">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${progress?.pct ?? 8}%` }}
                />
              </div>
              <p className="text-xs text-ink-faint">
                Downloading and first-booting can take a couple of minutes. Leave
                this open.
              </p>
              {error && (
                <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
                  {error}
                </div>
              )}
            </div>
          ) : step === 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {LOADERS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLoader(l)}
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    loader === l
                      ? "border-accent bg-accent-muted"
                      : "border-edge bg-panel-2 hover:bg-panel-3"
                  }`}
                >
                  <div className="text-sm font-medium">{LOADER_META[l].label}</div>
                  <div className="text-xs text-ink-faint">{LOADER_META[l].blurb}</div>
                </button>
              ))}
            </div>
          ) : step === 1 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-ink-faint">
                  {LOADER_META[loader].label} version
                </span>
                <label className="flex items-center gap-1.5 text-xs text-ink-dim">
                  <input
                    type="checkbox"
                    checked={showUnstable}
                    onChange={(e) => setShowUnstable(e.target.checked)}
                  />
                  show snapshots / betas
                </label>
              </div>
              {versionsError ? (
                <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
                  Couldn't load versions: {versionsError}
                </div>
              ) : !versions ? (
                <div className="text-xs text-ink-faint">Loading versions…</div>
              ) : (
                <select
                  value={versionId}
                  onChange={(e) => setVersionId(e.target.value)}
                  className="w-full rounded-md border border-edge bg-panel-2 px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
                  size={8}
                >
                  {visibleVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                      {v.kind !== "release" ? `  (${v.kind})` : ""}
                    </option>
                  ))}
                </select>
              )}
              {(loader === "neoforge" || loader === "forge") && versionId && (
                <p className="text-xs text-ink-faint">
                  Minecraft {deriveMcVersion(loader, versionId)} · {LOADER_META[loader].label}{" "}
                  {versionId}
                </p>
              )}
              {loader === "fabric" && (
                <p className="text-xs text-ink-faint">
                  Uses the latest stable Fabric loader for this Minecraft version.
                </p>
              )}
            </div>
          ) : step === 2 ? (
            <div className="space-y-4">
              <Field label="Server name">
                <TextInput value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Location" hint="a new subfolder is created here">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={pickParent}>
                    {parentDir ? "Change…" : "Choose folder…"}
                  </Button>
                  {finalDir && (
                    <span className="truncate font-mono text-xs text-ink-faint">
                      {finalDir}
                    </span>
                  )}
                </div>
              </Field>
              <div className="rounded-lg border border-edge bg-panel-2 p-3">
                <RamSlider valueMb={ram} onChange={setRam} />
              </div>

              <button
                onClick={() => setShowOpts((v) => !v)}
                className="text-xs text-accent hover:underline"
              >
                {showOpts ? "− Hide" : "+ World & rules"} (seed, gamemode, difficulty, MOTD)
              </button>
              {showOpts && (
                <div className="space-y-3 rounded-lg border border-edge bg-panel-2 p-3">
                  <Field label="Seed" hint="blank = random">
                    <TextInput value={seed} onChange={(e) => setSeed(e.target.value)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Gamemode">
                      <select
                        value={gamemode}
                        onChange={(e) => setGamemode(e.target.value)}
                        className="w-full rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                      >
                        {["survival", "creative", "adventure", "spectator"].map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Difficulty">
                      <select
                        value={difficulty}
                        onChange={(e) => setDifficulty(e.target.value)}
                        className="w-full rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                      >
                        {["peaceful", "easy", "normal", "hard"].map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="MOTD" hint="shown in the multiplayer list">
                    <TextInput value={motd} onChange={(e) => setMotd(e.target.value)} />
                  </Field>
                  <Field label="Max players">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={maxPlayers}
                      onChange={(e) => setMaxPlayers(Number(e.target.value) || 20)}
                      className="w-24 rounded-md border border-edge bg-panel px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                    />
                  </Field>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-edge bg-panel-2 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{LOADER_META[loader].label}</Badge>
                  <Badge tone="neutral">
                    MC {deriveMcVersion(loader, versionId)}
                  </Badge>
                </div>
                <div className="mt-2 font-mono text-xs text-ink-faint">{finalDir}</div>
                <div className="mt-1 text-xs text-ink-faint">
                  {(ram / 1024).toFixed(ram % 1024 ? 1 : 0)} GB RAM
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-ink-dim">
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I agree to the{" "}
                  <a
                    href="https://aka.ms/MinecraftEULA"
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline"
                  >
                    Minecraft EULA
                  </a>
                  . CraftPanel will write <code>eula=true</code> and first-boot the
                  server to generate its config.
                </span>
              </label>
              {error && (
                <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {!creating && (
          <footer className="flex items-center justify-between border-t border-edge px-5 py-3">
            <Button
              variant="subtle"
              onClick={() => (step === 0 ? onClose() : setStep((s) => (s - 1) as 0))}
            >
              {step === 0 ? "Cancel" : "← Back"}
            </Button>
            {step < 3 ? (
              <Button
                variant="primary"
                disabled={!canNext}
                onClick={() => setStep((s) => (s + 1) as 1)}
              >
                Next →
              </Button>
            ) : (
              <Button variant="primary" disabled={!agree} onClick={create}>
                Create server
              </Button>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
