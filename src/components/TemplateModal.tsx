import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { ProvisionProgress, ServerRecord } from "../types";
import { Button, Field, ProgressBar, TextInput, cx } from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { Icon } from "./Icon";
import { RamSlider } from "./RamSlider";

/** Real, verified Modrinth plugin slugs — checked live against the API
 * before pinning (downloads/last-updated as of writing): `iridiumskyblock`
 * (17k dl), `bedwars1058` (39k dl, the de-facto standard Bedwars plugin),
 * `essentialsx` (765k dl). Not guessed. */
interface Template {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  plugin: { slug: string; name: string } | null;
}

const TEMPLATES: Template[] = [
  {
    id: "smp",
    label: "Vanilla SMP",
    icon: "users",
    blurb: "Plain survival with friends, no gimmicks — Paper for the performance headroom, nothing else installed.",
    plugin: null,
  },
  {
    id: "skyblock",
    label: "Skyblock",
    icon: "package",
    blurb: "Start on a floating island with nothing. Auto-installs Iridium Skyblock.",
    plugin: { slug: "iridiumskyblock", name: "Iridium Skyblock" },
  },
  {
    id: "bedwars",
    label: "Bedwars",
    icon: "swords",
    blurb: "Team PvP, protect your bed. Auto-installs BedWars1058 — you'll still need to build/set an arena in-game.",
    plugin: { slug: "bedwars1058", name: "BedWars1058" },
  },
  {
    id: "essentials",
    label: "Survival + Essentials",
    icon: "sliders",
    blurb: "Vanilla SMP plus the standard QoL commands (/home, /tpa, /kits…). Auto-installs EssentialsX.",
    plugin: { slug: "essentialsx", name: "EssentialsX" },
  },
];

export function TemplateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (rec: ServerRecord) => void;
}) {
  const [template, setTemplate] = useState<Template>(TEMPLATES[0]);
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [ramMb, setRamMb] = useState(4096);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState<ProvisionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let un: (() => void) | undefined;
    api.onProvisionProgress((p) => setProgress(p)).then((f) => (un = f));
    return () => un?.();
  }, []);

  // Same "keep servers in one place" default as the full Create flow —
  // "Change folder…" below still overrides it.
  useEffect(() => {
    api.defaultServersDir().then(setParentDir).catch(() => {});
  }, []);

  async function chooseFolder() {
    const d = await api.pickFolder();
    if (d) setParentDir(d);
  }

  const sep = parentDir?.includes("\\") ? "\\" : "/";
  const safeName = name.trim().replace(/[^A-Za-z0-9 _-]/g, "").trim() || template.label.replace(/\s+/g, "-");
  const dir = parentDir ? `${parentDir}${sep}${safeName.replace(/\s+/g, "-")}` : "";

  async function create() {
    if (!dir) return;
    setBusy(true);
    setError(null);
    try {
      setStage("Downloading Paper…");
      const versions = await api.loaderVersions("paper");
      let mcVersion = versions.find((v) => v.kind === "release")?.id ?? versions[0]?.id;
      if (!mcVersion) throw new Error("Couldn't find a Paper build to install.");

      if (template.plugin) {
        // Pick the newest Paper version this template's plugin actually
        // has a published build for, instead of blindly grabbing the
        // newest Paper release and hoping the plugin caught up to it —
        // that's the real bug that made Skyblock fail every time Iridium
        // Skyblock hadn't published a build for whatever was newest yet.
        setStage(`Checking ${template.plugin.name} compatibility…`);
        const supported = new Set(await api.modrinthSupportedVersions(template.plugin.slug, "spigot"));
        const match = versions.find((v) => supported.has(v.id));
        if (!match) {
          throw new Error(
            `${template.plugin.name} doesn't have a build for any currently available Paper version yet.`,
          );
        }
        mcVersion = match.id;
      }

      const rec = await api.createServer({
        loader: "paper",
        mc_version: mcVersion,
        loader_version: null,
        dir,
        name: safeName,
        ram_mb: ramMb,
        java_path: null,
        accept_eula: true,
      });

      if (template.plugin) {
        setStage(`Installing ${template.plugin.name}…`);
        await api.modrinthInstall(rec.id, template.plugin.slug, "plugin");
      }

      onCreated(rec);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-e3">
        <div className="border-b border-line px-5 py-4">
          <h2 className="cp-display text-base text-ink">Quick start</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            A ready-made game mode — Paper server, EULA accepted, the right plugin installed
            automatically.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplate(t)}
                className={cx(
                  "flex flex-col items-start gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  template.id === t.id
                    ? "border-accent-line bg-accent-muted"
                    : "border-line-soft bg-surface-2 hover:border-line",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Icon name={t.icon} size={14} />
                  {t.label}
                </span>
                <span className="text-2xs text-ink-faint">{t.blurb}</span>
              </button>
            ))}
          </div>

          <Field label="Name">
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={template.label}
            />
          </Field>

          <Field label="Location">
            <div className="flex gap-2">
              <TextInput value={dir} readOnly placeholder="Choose a folder…" className="flex-1" />
              <Button variant="secondary" size="sm" onClick={chooseFolder} disabled={busy}>
                Browse…
              </Button>
            </div>
          </Field>

          <Field label="Memory">
            <RamSlider valueMb={ramMb} onChange={setRamMb} disabled={busy} />
          </Field>

          {error && <ErrorBanner message={error} />}
          {busy && (
            <div className="space-y-1.5">
              <ProgressBar pct={progress?.pct} />
              <p className="text-2xs text-ink-faint">{progress?.message || stage}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon="sparkle" loading={busy} disabled={!dir} onClick={create}>
            {busy ? "Creating…" : `Create ${template.label}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
