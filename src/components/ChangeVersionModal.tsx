import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { LOADER_META, type Loader, type ProvisionProgress, type ServerRecord, type VersionInfo } from "../types";
import { Badge, Button, ProgressBar, StateBlock, TextInput, cx } from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { LoaderMark } from "./LoaderMark";

// Matches provision::change_version on the Rust side — Forge/NeoForge need
// their installer's whole multi-file output replaced as a set and Bedrock
// is a different binary/versioning story entirely; neither is safe to
// swap in place yet, so they're not offered here.
const SUPPORTED_LOADERS: Loader[] = ["paper", "vanilla", "fabric"];

export function ChangeVersionModal({
  server,
  onClose,
  onChanged,
}: {
  server: ServerRecord;
  onClose: () => void;
  onChanged: (rec: ServerRecord) => void;
}) {
  const [loader, setLoader] = useState<Loader>(
    (SUPPORTED_LOADERS as string[]).includes(server.server_type) ? (server.server_type as Loader) : "paper",
  );
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionId, setVersionId] = useState("");
  const [query, setQuery] = useState("");
  const [showUnstable, setShowUnstable] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProvisionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVersions(null);
    setVersionsError(null);
    setVersionId("");
    api.loaderVersions(loader).then(setVersions).catch((e) => setVersionsError(String(e)));
  }, [loader]);

  const visible = useMemo(() => {
    if (!versions) return [];
    const base = showUnstable ? versions : versions.filter((v) => v.kind === "release");
    const q = query.trim().toLowerCase();
    return q ? base.filter((v) => v.id.toLowerCase().includes(q)) : base;
  }, [versions, showUnstable, query]);

  useEffect(() => {
    if (!versionId && visible.length) setVersionId(visible[0].id);
  }, [visible, versionId]);

  useEffect(() => {
    let un: (() => void) | undefined;
    api.onProvisionProgress((p) => setProgress(p)).then((f) => (un = f));
    return () => un?.();
  }, []);

  const changingLoader = loader !== server.server_type;
  const changingVersion = !!versionId && versionId !== server.mc_version;

  async function apply() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const rec = await api.changeServerVersion(server.id, loader, versionId);
      onChanged(rec);
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
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="cp-display text-base text-ink">Change version / loader</h2>
            <p className="mt-0.5 text-xs text-ink-faint">{server.name}</p>
          </div>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose} disabled={busy} />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-lg border border-warn-line bg-warn-muted px-3 py-2.5 text-xs text-warn-soft">
            This replaces the server's launcher jar in place — the world, plugins/mods, and
            configs are left alone. A backup is taken automatically first. Switching loader
            (e.g. Fabric → Paper) means your existing mods/plugins won't work until you
            replace them for the new loader.
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-dim">Loader</div>
            <div className="grid grid-cols-3 gap-2">
              {SUPPORTED_LOADERS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLoader(l)}
                  className={cx(
                    "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs transition-colors",
                    loader === l
                      ? "border-accent-line bg-accent-muted text-ink"
                      : "border-line-soft bg-surface-2 text-ink-dim hover:border-line",
                  )}
                >
                  <LoaderMark loader={l} size={28} />
                  {LOADER_META[l].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div className="text-xs font-medium text-ink-dim">Minecraft version</div>
              <label className="flex items-center gap-1.5 text-2xs text-ink-faint">
                <input
                  type="checkbox"
                  checked={showUnstable}
                  onChange={(e) => setShowUnstable(e.target.checked)}
                />
                Show snapshots
              </label>
            </div>
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search versions…"
              className="mb-2"
            />
            {versionsError && <ErrorBanner message={versionsError} />}
            {!versions && !versionsError && <StateBlock state="loading" title="Loading versions…" compact />}
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-line-soft bg-surface-2 p-1.5">
              {visible.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVersionId(v.id)}
                  className={cx(
                    "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs",
                    versionId === v.id ? "bg-accent-muted text-ink" : "text-ink-dim hover:bg-surface-3",
                  )}
                >
                  {v.id}
                  {v.id === server.mc_version && <Badge tone="neutral">current</Badge>}
                </button>
              ))}
            </div>
          </div>

          {(changingLoader || changingVersion) && (
            <label className="flex items-start gap-2 text-xs text-ink-dim">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I understand this changes {server.name} from{" "}
                <strong>
                  {LOADER_META[server.server_type as Loader]?.label ?? server.server_type} {server.mc_version}
                </strong>{" "}
                to <strong>{LOADER_META[loader].label} {versionId || "…"}</strong>.
              </span>
            </label>
          )}

          {error && <ErrorBanner message={error} />}
          {busy && progress && (
            <div className="space-y-1.5">
              <ProgressBar pct={progress.pct} />
              <p className="text-2xs text-ink-faint">{progress.message}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="download"
            loading={busy}
            disabled={!versionId || ((changingLoader || changingVersion) && !confirmed)}
            onClick={apply}
          >
            {busy ? "Changing…" : "Change version"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
