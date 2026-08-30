import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { MgmtStatus } from "../types";
import { Badge, Button, Card } from "./ui";
import { ErrorBanner } from "./ErrorBanner";

export function MgmtSection({
  serverId,
  onNeedsRestart,
}: {
  serverId: string;
  onNeedsRestart: () => void;
}) {
  const [st, setSt] = useState<MgmtStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.mgmtStatus(serverId).then(setSt).catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  if (!st || !st.supported) return null; // hidden for < 1.21.9

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onNeedsRestart();
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Management API"
      icon="zap"
      description="Minecraft 1.21.9+ can be controlled live, without restarts."
      right={
        st.enabled ? (
          <Badge tone={st.reachable ? "ok" : "neutral"} dot>
            {st.reachable ? `Live · ${st.port}` : `On · ${st.port}`}
          </Badge>
        ) : (
          <Badge tone="neutral">Off</Badge>
        )
      }
    >
      <p className="mb-2 text-2xs leading-snug text-ink-faint">
        Minecraft 1.21.9+ ships a management API (JSON-RPC over WebSocket) —
        changing settings and game rules without a restart, live events, real TPS.
        CraftPanel can turn it on now (localhost-only, auto-generated secret); full
        in-app use of it is coming.
      </p>
      <div className="flex gap-2">
        {!st.enabled ? (
          <Button variant="primary" disabled={busy} onClick={() => act(() => api.mgmtEnable(serverId))}>
            Enable
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={() => act(() => api.mgmtDisable(serverId))}>
            Disable
          </Button>
        )}
      </div>
      <ErrorBanner message={error} className="mt-2" />
    </Card>
  );
}
