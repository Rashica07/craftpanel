import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { CrossplayStatus, JoinInfo, TunnelStatus } from "../types";
import {
  Badge,
  Banner,
  Button,
  Card,
  CopyField,
  EmptyState,
  ProgressBar,
  StateBlock,
  StatusDot,
  TextInput,
  Tooltip,
  cx,
  toast,
} from "./ui";
import { Icon } from "./Icon";

/**
 * One rung of the "who can reach my server" ladder. Reading these three lines
 * top-to-bottom should tell a 14-year-old exactly why their friend can't
 * connect, and what button fixes it.
 */
function ReachRow({
  icon,
  label,
  detail,
  state,
  action,
}: {
  icon: string;
  label: string;
  detail: string;
  state: "ok" | "warn" | "off";
  action?: React.ReactNode;
}) {
  const tone = state === "ok" ? "ok" : state === "warn" ? "warn" : "neutral";
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span
        className={cx(
          "grid h-7 w-7 shrink-0 place-items-center rounded-md",
          state === "ok"
            ? "bg-ok-muted text-ok"
            : state === "warn"
              ? "bg-warn-muted text-warn"
              : "bg-surface-2 text-ink-ghost",
        )}
      >
        <Icon name={icon} size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
          {label}
          <StatusDot tone={tone} size={6} />
        </div>
        <p className="mt-0.5 text-2xs leading-snug text-ink-faint">{detail}</p>
      </div>
      {action}
    </div>
  );
}

export function NetworkPanel({ serverId }: { serverId: string }) {
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [tunnel, setTunnel] = useState("");
  const [tun, setTun] = useState<TunnelStatus>({
    running: false,
    address: null,
    error: null,
  });
  const [xp, setXp] = useState<CrossplayStatus | null>(null);
  const [tunProgress, setTunProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const load = useCallback(() => {
    api
      .netInfo(serverId)
      .then((i) => {
        setInfo(i);
        setTunnel(i.tunnelAddress ?? "");
        if (i.recommended)
          api
            .qrSvg(i.recommended)
            .then(setQr)
            .catch(() => setQr(null));
      })
      .catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    setInfo(null);
    setQr(null);
    load();
    api.tunnelStatus(serverId).then(setTun).catch(() => {});
    api.crossplayStatus(serverId).then(setXp).catch(() => {});
  }, [load, serverId]);

  useEffect(() => {
    const uns: Array<() => void> = [];
    api
      .onTunnelStatus((id, s) => {
        if (id !== serverId) return;
        setTun(s);
        load(); // the tunnel address feeds "recommended"
      })
      .then((u) => uns.push(u));
    api
      .onTunnelProgress((msg) => {
        setTunProgress(msg);
        clearTimeout(progressTimer.current);
        progressTimer.current = setTimeout(() => setTunProgress(null), 5000);
      })
      .then((u) => uns.push(u));
    return () => {
      uns.forEach((u) => u());
      clearTimeout(progressTimer.current);
    };
  }, [serverId, load]);

  async function guard(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (ok) toast.ok(ok);
      load();
    } catch (e) {
      setError(String(e));
      toast.bad("That didn't work", String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!info) {
    return error ? (
      <StateBlock
        state="error"
        title="Couldn't check your network"
        message={error}
        onRetry={() => {
          setError(null);
          load();
        }}
      />
    ) : (
      <StateBlock state="loading" title="Working out how friends can reach you…" />
    );
  }

  /* ── what kind of reach do we actually have? ─────────────────────────── */
  const viaTunnel = !!info.tunnelAddress;
  const viaPublic = !viaTunnel && info.recommended === info.publicAddress;
  const lanOnly = !viaTunnel && !viaPublic;

  const reach = viaTunnel
    ? {
        tone: "ok" as const,
        icon: "globe",
        title: "Anyone, anywhere",
        blurb: "This address goes through a tunnel, so it works over the internet.",
      }
    : viaPublic
      ? {
          tone: "ok" as const,
          icon: "globe",
          title: "Anyone, anywhere",
          blurb: "Your router is forwarding the port, so internet friends can connect.",
        }
      : {
          tone: "warn" as const,
          icon: "wifi",
          title: "Only people on your Wi-Fi",
          blurb:
            "Friends somewhere else won't reach this yet — turn on the free tunnel below.",
        };

  return (
    <div className="cp-stagger h-full space-y-3 overflow-y-auto pr-1">
      {/* ───────────────── the money card ───────────────── */}
      <Card
        tone={reach.tone === "ok" ? "accent" : "warn"}
        className="overflow-hidden"
        pad={false}
      >
        {info.recommended ? (
          <div className="flex flex-col gap-5 p-5 sm:flex-row">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.06em] text-ink-faint">
                Tell your friends to join
              </h2>

              <div className="mt-3">
                <CopyField value={info.recommended} size="lg" tone="accent" />
              </div>

              <div
                className={cx(
                  "mt-3 flex items-start gap-2 rounded-md px-2.5 py-2 text-xs",
                  reach.tone === "ok"
                    ? "bg-ok-muted text-ok-soft"
                    : "bg-warn-muted text-warn-soft",
                )}
              >
                <Icon name={reach.icon} size={14} className="mt-px shrink-0" />
                <span>
                  <strong className="font-semibold">{reach.title}.</strong>{" "}
                  <span className="opacity-90">{reach.blurb}</span>
                </span>
              </div>

              {lanOnly && !tun.running && (
                <Button
                  variant="primary"
                  size="lg"
                  icon="signal"
                  className="mt-3"
                  disabled={busy}
                  loading={busy}
                  onClick={() => guard(() => api.tunnelStart(serverId))}
                >
                  Make it work from anywhere
                </Button>
              )}
            </div>

            {qr && (
              <div className="flex shrink-0 flex-col items-center gap-2">
                <div
                  className="h-[124px] w-[124px] rounded-lg bg-white p-2 shadow-e2 [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: qr }}
                />
                <span className="flex items-center gap-1 text-2xs text-ink-faint">
                  <Icon name="smartphone" size={11} />
                  Scan on a phone
                </span>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon="signal"
            title="No address yet"
            action={
              <Badge tone="neutral" icon="play">
                Start the server once
              </Badge>
            }
          >
            CraftPanel works out the join address from the running server's port.
            Start it once and this page fills in.
          </EmptyState>
        )}
      </Card>

      {/* ───────────────── reach ladder ───────────────── */}
      <Card title="Who can reach this server" icon="layers" pad={false}>
        <div className="divide-y divide-line-soft">
          <ReachRow
            icon="wifi"
            label="People on your Wi-Fi"
            detail={
              info.lanAddress
                ? `Anyone in the house can use ${info.lanAddress}`
                : "Start the server to find your local address."
            }
            state={info.lanAddress ? "ok" : "off"}
          />
          <ReachRow
            icon="globe"
            label="People on the internet"
            detail={
              viaTunnel
                ? "Reachable through the tunnel."
                : info.upnpMapped
                  ? `Your router is forwarding port ${info.port}.`
                  : info.likelyCgnat
                    ? "Your internet provider blocks port-forwarding (carrier NAT). Use the tunnel."
                    : "Not reachable yet — start the tunnel, or forward the port."
            }
            state={viaTunnel || info.upnpMapped ? "ok" : "warn"}
            action={
              !viaTunnel &&
              !info.upnpMapped && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => guard(() => api.tunnelStart(serverId))}
                >
                  Fix it
                </Button>
              )
            }
          />
          <ReachRow
            icon="gamepad"
            label="Phone, console & Windows edition"
            detail={
              !xp?.compatible
                ? "This server type can't run the Bedrock bridge."
                : xp.geyser
                  ? `Bedrock players can join on port ${xp.bedrockPort}.`
                  : "Not set up — Bedrock players can't join yet."
            }
            state={xp?.geyser ? "ok" : xp?.compatible ? "warn" : "off"}
          />
        </div>
      </Card>

      {/* ───────────────── free tunnel ───────────────── */}
      <Card
        title="Free tunnel"
        icon="signal"
        tone={tun.running ? "ok" : undefined}
        description="One click, no account, no router settings — gives you an address that works from anywhere."
        right={
          tun.running ? (
            <Badge tone="ok" dot>
              On
            </Badge>
          ) : (
            <Badge tone="neutral">Off</Badge>
          )
        }
      >
        {tun.running ? (
          <div className="space-y-3">
            {tun.address ? (
              <CopyField value={tun.address} label="Tunnel address" />
            ) : (
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <ProgressBar indeterminate className="w-24" />
                Connecting…
              </div>
            )}
            <Button
              variant="secondary"
              icon="stop"
              disabled={busy}
              onClick={() => guard(() => api.tunnelStop(serverId), "Tunnel stopped.")}
            >
              Stop the tunnel
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            icon="signal"
            disabled={busy}
            loading={busy}
            onClick={() => guard(() => api.tunnelStart(serverId))}
          >
            Start free tunnel
          </Button>
        )}

        {tunProgress && (
          <div className="mt-3 space-y-1.5">
            <ProgressBar indeterminate />
            <p className="text-2xs text-ink-faint">{tunProgress}</p>
          </div>
        )}
        {tun.error && (
          <Banner tone="bad" className="mt-3">
            {tun.error}
          </Banner>
        )}

        <p className="mt-3 border-t border-line-soft pt-2.5 text-2xs leading-relaxed text-ink-faint">
          It's temporary: the number changes each time you restart it, and it
          runs on a shared community relay (<code>bore.pub</code>). For an
          address that never changes, see Advanced below.
        </p>
      </Card>

      {/* ───────────────── Bedrock cross-play ───────────────── */}
      {xp?.compatible && (
        <Card
          title="Bedrock cross-play"
          icon="gamepad"
          tone={xp.geyser ? "ok" : undefined}
          description="Let friends on phone, console or the Windows store edition join this Java server — no Java account needed."
          right={xp.geyser ? <Badge tone="ok" dot>On</Badge> : undefined}
        >
          {!xp.geyser ? (
            <Button
              variant="primary"
              icon="download"
              disabled={busy}
              loading={busy}
              onClick={() =>
                guard(async () => {
                  await api.crossplayEnable(serverId);
                  setXp(await api.crossplayStatus(serverId));
                }, "Geyser + Floodgate installed — restart the server to finish.")
              }
            >
              Turn on cross-play
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="ok" icon="check">
                  Geyser
                </Badge>
                <Badge tone={xp.floodgate ? "ok" : "warn"} icon={xp.floodgate ? "check" : "alert"}>
                  {xp.floodgate ? "Floodgate" : "Floodgate missing"}
                </Badge>
              </div>

              <CopyField
                label="Bedrock address"
                value={`${info.lanIp ?? "your-ip"} port ${xp.bedrockPort}`}
                hint="On Bedrock, add a server and put the address and port in separate boxes."
              />

              <Banner tone="info" icon="info">
                Bedrock uses <strong>UDP</strong>, and the free tunnel above only
                carries Java traffic. For Bedrock friends outside your house,
                forward UDP {xp.bedrockPort}.
              </Banner>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  icon="router"
                  disabled={busy}
                  onClick={() =>
                    guard(() => api.crossplayForward(serverId), "UDP port forwarded.")
                  }
                >
                  Forward UDP {xp.bedrockPort}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    guard(async () => {
                      await api.crossplayDisable(serverId);
                      setXp(await api.crossplayStatus(serverId));
                    }, "Cross-play removed.")
                  }
                >
                  Remove cross-play
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ───────────────── advanced ───────────────── */}
      <Card
        title="Advanced"
        icon="sliders"
        description="Raw addresses, router port-forwarding, and a permanent custom address."
        right={
          <Button
            variant="quiet"
            size="sm"
            iconRight={showAdvanced ? "chevron-up" : "chevron-down"}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? "Hide" : "Show"}
          </Button>
        }
        pad={showAdvanced}
      >
        {showAdvanced && (
          <div className="cp-in space-y-4">
            {/* raw addresses */}
            <div className="space-y-2">
              {info.lanAddress && (
                <CopyField label="Local (LAN)" value={info.lanAddress} size="sm" />
              )}
              {info.publicAddress && (
                <CopyField label="Public" value={info.publicAddress} size="sm" />
              )}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {info.likelyCgnat ? (
                  <Tooltip label="Your ISP puts you behind a shared address, so no router setting can open a port. A tunnel is the only way out.">
                    <Badge tone="warn" icon="alert">
                      Carrier NAT — port-forwarding can't work
                    </Badge>
                  </Tooltip>
                ) : info.upnpMapped ? (
                  <Badge tone="ok" icon="check">
                    Port {info.port} forwarded
                  </Badge>
                ) : info.upnpAvailable ? (
                  <Badge tone="neutral" icon="router">
                    Router supports automatic forwarding
                  </Badge>
                ) : (
                  <Badge tone="neutral" icon="router">
                    No UPnP router found
                  </Badge>
                )}
                <Badge tone="neutral" icon="hash">
                  Port {info.port}
                </Badge>
              </div>
            </div>

            {/* UPnP */}
            {info.upnpAvailable && !info.likelyCgnat && (
              <div className="rounded-lg border border-line-soft bg-surface-2 p-3">
                <h4 className="text-xs font-semibold text-ink">
                  Open the port automatically
                </h4>
                <p className="mt-1 text-2xs leading-relaxed text-ink-faint">
                  Asks your router (over UPnP) to forward port {info.port} to
                  this computer for 24 hours. No tunnel, no middleman — but it
                  exposes your home IP.
                </p>
                <div className="mt-2.5">
                  {!info.upnpMapped ? (
                    <Button
                      variant="secondary"
                      icon="router"
                      disabled={busy}
                      onClick={() =>
                        guard(() => api.upnpForward(serverId), "Port forwarded.")
                      }
                    >
                      Forward port {info.port}
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        guard(() => api.upnpRemove(serverId), "Port-forward removed.")
                      }
                    >
                      Remove the forward
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* permanent address */}
            <div className="rounded-lg border border-line-soft bg-surface-2 p-3">
              <h4 className="text-xs font-semibold text-ink">
                Permanent address
              </h4>
              <p className="mt-1 text-2xs leading-relaxed text-ink-faint">
                Want something stable like{" "}
                <code>you.craft.playit.gg</code>? Make a free tunnel at{" "}
                <a
                  href="https://playit.gg"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  playit.gg
                </a>
                , point it at port {info.port}, and paste the address here. It
                overrides the free tunnel.
              </p>
              <div className="mt-2.5 flex gap-1.5">
                <TextInput
                  value={tunnel}
                  mono
                  onChange={(e) => setTunnel(e.target.value)}
                  placeholder="you.craft.playit.gg"
                />
                <Button
                  variant="secondary"
                  icon="save"
                  disabled={busy}
                  onClick={() =>
                    guard(
                      () => api.setTunnelAddress(serverId, tunnel || null),
                      "Saved.",
                    )
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {error && (
        <Banner tone="bad" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
    </div>
  );
}
