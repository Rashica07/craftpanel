import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ServerRecord, ShareView } from "../types";
import { Badge, Button, Card } from "./ui";
import { ErrorBanner } from "./ErrorBanner";

export function leaseLabel(v: ShareView): { text: string; tone: "ok" | "warn" | "neutral" } {
  if (!v.shared) return { text: "Not shared", tone: "neutral" };
  if (v.heldByUs) return { text: "You have the lease", tone: "ok" };
  if (v.locked) {
    const mins = Math.max(0, Math.round((v.expiresIn ?? 0) / 60));
    return { text: `In use on ${v.holderName ?? "another device"} · ~${mins}m`, tone: "warn" };
  }
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.shareStatus(server.id).then(setFolder).catch(() => {});
  }, [server.id]);

  useEffect(() => {
    setError(null);
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function guard(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
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

  return (
    <Card
      title="Play the same world on two computers"
      icon="share"
      description="Hand the world back and forth with a friend, or between your own machines, via a folder you already keep in iCloud/Dropbox."
      right={
        folder?.shared && (
          <Badge tone={leaseLabel(folder).tone} icon="share">
            {leaseLabel(folder).text}
          </Badge>
        )
      }
    >
      {folder?.shared ? (
        <FolderShared server={server} onDone={() => guard(async () => {})} />
      ) : (
        <div className="space-y-2">
          <Button
            variant="primary"
            onClick={() => guard(() => api.shareServer(server.id))}
            disabled={busy}
          >
            Share via synced folder
          </Button>
        </div>
      )}

      <ErrorBanner message={error} className="mt-2" />
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
