import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { MgmtStatus } from "../types";
import { Badge, Button } from "./ui";

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
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
        Management API
        {st.enabled ? (
          <Badge tone={st.reachable ? "ok" : "neutral"}>
            {st.reachable ? `live :${st.port}` : `on :${st.port}`}
          </Badge>
        ) : (
          <Badge tone="neutral">off</Badge>
        )}
      </div>
      <p className="mb-2 text-[11px] leading-snug text-ink-faint">
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
      {error && (
        <div className="mt-2 rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}
    </div>
  );
}
