import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { CloudStatus, ServerRecord, ShareView } from "../types";
import { Badge, Button, Card } from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { R2SetupModal } from "./R2SetupModal";

export function leaseLabel(v: ShareView): { text: string; tone: "ok" | "warn" | "neutral" } {
  if (!v.shared) return { text: "Not shared", tone: "neutral" };
  if (v.heldByUs) return { text: "You have the lease", tone: "ok" };
  if (v.locked) {
    const mins = Math.max(0, Math.round((v.expiresIn ?? 0) / 60));
    return { text: `In use on ${v.holderName ?? "another device"} · ~${mins}m`, tone: "warn" };
  }
  return { text: "Available", tone: "ok" };
}

export function cloudLeaseLabel(c: CloudStatus): { text: string; tone: "ok" | "warn" | "neutral" } {
  if (c.heldByUs) return { text: "You have the lease", tone: "ok" };
  if (c.locked) {
    const mins = Math.max(0, Math.round((c.expiresIn ?? 0) / 60));
    return { text: `In use on ${c.holderName ?? "another device"} · ~${mins}m`, tone: "warn" };
  }
  if (c.cloudAhead) return { text: "Newer world in the cloud", tone: "warn" };
  return { text: "Available", tone: "ok" };
}

export function ShareSection({
  server,
  onServersChanged,
}: {
  server: ServerRecord;
  onServersChanged: () => void;
}) {
  const [folder, setFolder] = useState<ShareView | null>(null);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [r2Ready, setR2Ready] = useState<boolean | null>(null);
  const [showR2, setShowR2] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isCloud = !!server.sync_code;

  const load = useCallback(() => {
    api.r2ConfigGet().then((s) => setR2Ready(s.configured)).catch(() => setR2Ready(false));
    api.shareStatus(server.id).then(setFolder).catch(() => {});
    if (server.sync_code) {
      api.cloudStatus(server.id).then(setCloud).catch((e) => setError(String(e)));
    }
  }, [server.id, server.sync_code]);

  useEffect(() => {
    setError(null);
    setMsg(null);
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      onServersChanged();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card
      title="Play the same world on two computers"
      icon="cloud"
      description="Hand the world back and forth with a friend, or between your own machines."
      right={
        <>
          {isCloud && cloud && (
            <Badge tone={cloudLeaseLabel(cloud).tone} icon="cloud">
              {cloudLeaseLabel(cloud).text}
            </Badge>
          )}
          {!isCloud && folder?.shared && (
            <Badge tone={leaseLabel(folder).tone} icon="share">
              {leaseLabel(folder).text}
            </Badge>
          )}
        </>
      }
    >

      {isCloud ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-faint">Code</span>
            <code className="rounded bg-surface-2 px-2 py-1 font-mono text-sm tracking-widest text-ink">
              {server.sync_code}
            </code>
            <Button variant="subtle" onClick={() => copy(server.sync_code!)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-2xs text-ink-faint">
            CraftPanel uploads the world to your R2 bucket on stop and pulls the
            latest on start. On the other device: <b>⇄ Join → Cloud</b> → enter
            this code.
          </p>
          <div className="flex gap-2">
            <Button
              variant="subtle"
              onClick={() => guard(() => api.cloudFinish(server.id))}
              disabled={busy}
            >
              Sync now
            </Button>
            <Button
              variant="danger"
              onClick={() => guard(() => api.cloudUnshare(server.id))}
              disabled={busy}
            >
              Stop sharing (local)
            </Button>
          </div>
        </div>
      ) : folder?.shared ? (
        <FolderShared server={server} onDone={() => guard(async () => {})} />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-ink-dim">
            Share to the <b>cloud</b> (CraftPanel moves the world via your R2
            bucket — nothing to sync yourself), or via a folder you already keep
            in iCloud/Dropbox.
          </p>
          <div className="flex flex-wrap gap-2">
            {r2Ready ? (
              <Button
                variant="primary"
                onClick={() => guard(() => api.cloudShare(server.id))}
                disabled={busy}
              >
                {busy ? "Uploading…" : "Share to cloud"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setShowR2(true)}>
                Set up cloud sync
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => guard(() => api.shareServer(server.id))}
              disabled={busy}
            >
              Share via synced folder
            </Button>
          </div>
        </div>
      )}

      {msg && <div className="mt-2 rounded-md border border-line-soft bg-surface-2 px-2.5 py-1.5 text-xs text-ink-dim">{msg}</div>}
      <ErrorBanner message={error} className="mt-2" />

      {showR2 && (
        <R2SetupModal
          onClose={() => setShowR2(false)}
          onSaved={() => {
            setShowR2(false);
            load();
          }}
        />
      )}
    </Card>
  );
}

function FolderShared({ server, onDone }: { server: ServerRecord; onDone: () => void }) {
  const [view, setView] = useState<ShareView | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.shareStatus(server.id).then(setView).catch(() => {});
  }, [server.id]);
  if (!view?.code) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-faint">Code</span>
        <code className="rounded bg-surface-2 px-2 py-1 font-mono text-sm tracking-widest text-ink">
          {view.code}
        </code>
        <Button
          variant="subtle"
          onClick={() => {
            navigator.clipboard?.writeText(view.code!).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-2xs text-ink-faint">
        Synced-folder mode. Other device: <b>⇄ Join → Folder</b> → same folder +
        this code.
      </p>
      <Button variant="danger" onClick={() => api.unshareServer(server.id).then(onDone)}>
        Stop sharing
      </Button>
    </div>
  );
}
