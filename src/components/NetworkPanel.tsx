import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { JoinInfo } from "../types";
import { Badge, Button } from "./ui";
import { Icon } from "./Icon";

function Copyable({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      <code className="flex-1 truncate rounded bg-panel-2 px-2 py-1 text-sm text-ink">{value}</code>
      <button
        className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-ink-faint hover:text-ink"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
      >
        <Icon name="copy" size={12} />
        {done ? "copied" : "copy"}
      </button>
    </div>
  );
}

export function NetworkPanel({ serverId }: { serverId: string }) {
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [tunnel, setTunnel] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .netInfo(serverId)
      .then((i) => {
        setInfo(i);
        setTunnel(i.tunnelAddress ?? "");
        if (i.recommended) api.qrSvg(i.recommended).then(setQr).catch(() => setQr(null));
      })
      .catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    setNote(null);
    setInfo(null);
    setQr(null);
    load();
  }, [load]);

  async function guard(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (ok) setNote(ok);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!info) {
    return <div className="text-xs text-ink-faint">{error ?? "Checking your network…"}</div>;
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto pr-1">
      {/* recommended address + QR */}
      <div className="rounded-lg border border-edge bg-panel p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
          Tell your friends to connect to
        </div>
        {info.recommended ? (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Copyable label="address" value={info.recommended} />
              <p className="text-[11px] text-ink-faint">
                {info.tunnelAddress
                  ? "Tunnel address — works from anywhere."
                  : info.recommended === info.publicAddress
                    ? "Your public address (port is forwarded)."
                    : "LAN address — only works for people on your Wi-Fi. Set up a tunnel or forward your port for internet friends."}
              </p>
            </div>
            {qr && (
              <div
                className="h-24 w-24 shrink-0 rounded bg-white p-1"
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            )}
          </div>
        ) : (
          <p className="text-xs text-ink-faint">Couldn't work out an address — start the server once.</p>
        )}
      </div>

      {/* the raw facts */}
      <div className="space-y-2 rounded-lg border border-edge bg-panel p-3">
        {info.lanAddress && <Copyable label="LAN" value={info.lanAddress} />}
        {info.publicAddress && <Copyable label="Public" value={info.publicAddress} />}
        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          <span className="w-16 shrink-0" />
          {info.likelyCgnat ? (
            <Badge tone="warn">carrier NAT — port-forwarding won't work, use a tunnel</Badge>
          ) : info.upnpMapped ? (
            <Badge tone="ok">port {info.port} forwarded</Badge>
          ) : info.upnpAvailable ? (
            <Badge tone="neutral">router supports auto port-forward</Badge>
          ) : (
            <Badge tone="neutral">no UPnP router found</Badge>
          )}
        </div>
      </div>

      {/* UPnP */}
      {info.upnpAvailable && !info.likelyCgnat && (
        <div className="rounded-lg border border-edge bg-panel p-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
            Open my port automatically
          </div>
          <p className="mb-2 text-[11px] text-ink-faint">
            Asks your router (UPnP) to forward port {info.port} to this computer for 24h.
          </p>
          <div className="flex gap-2">
            {!info.upnpMapped ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => guard(() => api.upnpForward(serverId), "Port forwarded.")}
              >
                Forward port {info.port}
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => guard(() => api.upnpRemove(serverId), "Port-forward removed.")}
              >
                Remove the forward
              </Button>
            )}
          </div>
        </div>
      )}

      {/* tunnel address */}
      <div className="rounded-lg border border-edge bg-panel p-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
          <Icon name="signal" size={13} /> Tunnel address
        </div>
        <p className="mb-2 text-[11px] leading-snug text-ink-faint">
          A tunnel gives you an address that works from anywhere with no port-forwarding.
          Set one up at{" "}
          <a href="https://playit.gg" target="_blank" rel="noreferrer" className="text-accent underline">
            playit.gg
          </a>{" "}
          (free), point it at port {info.port}, then paste the address it gives you here.
          A bundled one-click tunnel is coming.
        </p>
        <div className="flex gap-1.5">
          <input
            value={tunnel}
            onChange={(e) => setTunnel(e.target.value)}
            placeholder="e.g. yourname.craft.playit.gg"
            className="flex-1 rounded border border-edge bg-panel-2 px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          />
          <Button
            variant="subtle"
            disabled={busy || tunnel === (info.tunnelAddress ?? "")}
            onClick={() => guard(() => api.setTunnelAddress(serverId, tunnel), "Saved.")}
          >
            Save
          </Button>
        </div>
      </div>

      {note && <div className="rounded bg-panel-2 px-2 py-1 text-xs text-ink-dim">{note}</div>}
      {error && (
        <div className="rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}
    </div>
  );
}
