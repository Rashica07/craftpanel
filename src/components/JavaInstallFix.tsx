import { useEffect, useState } from "react";
import { api } from "../api";
import type { ProvisionProgress } from "../types";
import { Button, ProgressBar, toast } from "./ui";
import { Icon } from "./Icon";

/**
 * The actual fix behind the "This computer doesn't have Java set up" error —
 * rendered inline by `ErrorBanner` when it recognizes that error shape and
 * has a server to fix. Downloads a matching Temurin runtime (Adoptium),
 * checksum-verifies it (see `javainstall.rs` — this is the one feature that
 * downloads and runs a third-party binary, so that step isn't optional),
 * and points this server at it.
 */
export function JavaInstallFix({
  serverId,
  mcVersion,
}: {
  serverId: string;
  mcVersion: string | null;
}) {
  // undefined = still checking, null = nothing CraftPanel can auto-install
  // for this version (see javainstall.rs's offerable_feature)
  const [feature, setFeature] = useState<number | null | undefined>(undefined);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<ProvisionProgress | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    if (!mcVersion) {
      setFeature(null);
      return;
    }
    api
      .javaOfferableFor(mcVersion)
      .then(setFeature)
      .catch(() => setFeature(null));
  }, [mcVersion]);

  useEffect(() => {
    let un: (() => void) | undefined;
    api.onJavaInstallProgress(setProgress).then((f) => (un = f));
    return () => un?.();
  }, []);

  async function install() {
    if (feature == null) return;
    setInstalling(true);
    setProgress(null);
    try {
      const info = await api.installJava(feature);
      await api.setServerJavaPath(serverId, info.path);
      setDone(info.major);
      toast.ok(`Java ${info.major} installed`, "Try starting the server again.");
    } catch (e) {
      toast.bad("Couldn't install Java", String(e));
    } finally {
      setInstalling(false);
    }
  }

  if (feature === undefined || feature === null) return null;

  if (done != null) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-2xs font-medium text-ok">
        <Icon name="check-circle" size={13} />
        Java {done} installed — hit Start again.
      </div>
    );
  }

  return (
    <div className="mt-2">
      <Button
        variant="secondary"
        size="sm"
        icon="download"
        loading={installing}
        onClick={install}
      >
        Install Java {feature} now (~40–190 MB)
      </Button>
      {installing && progress && (
        <div className="mt-1.5 max-w-xs space-y-1">
          <ProgressBar pct={progress.pct ?? undefined} indeterminate={progress.pct == null} />
          <p className="text-2xs text-ink-faint">{progress.message}</p>
        </div>
      )}
    </div>
  );
}
