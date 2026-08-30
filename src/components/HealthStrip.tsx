import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { PerfSample } from "../types";
import { Skeleton, Tooltip, cx } from "./ui";
import { Icon } from "./Icon";

const KEEP = 48;

/**
 * Area sparkline. The filled gradient (rather than a bare polyline) is what
 * turns three numbers into something you read at a glance — shape first,
 * digits second.
 */
function Spark({
  values,
  max,
  color,
  id,
}: {
  values: number[];
  max: number;
  color: string;
  id: string;
}) {
  const w = 140;
  const h = 34;
  if (values.length < 2) return <div style={{ height: h }} />;

  const step = w / (KEEP - 1);
  const pt = (v: number, i: number) => {
    const x = w - (values.length - 1 - i) * step;
    const y = h - Math.max(0, Math.min(1, v / max)) * (h - 4) - 2;
    return [x, y] as const;
  };
  const pts = values.map(pt);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  const area = `${pts[0][0].toFixed(1)},${h} ${line} ${lx.toFixed(1)},${h}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full"
      style={{ height: h }}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* the "now" dot — anchors the eye to the latest reading */}
      <circle cx={lx} cy={ly} r={2} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
  history,
  max,
  color,
  tone,
  help,
  sparkId,
}: {
  icon: string;
  label: string;
  value: string;
  unit?: string;
  history: number[];
  max: number;
  color: string;
  tone?: "ok" | "warn" | "bad";
  help: string;
  sparkId: string;
}) {
  return (
    <Tooltip label={help} side="bottom" className="flex-1">
      <div className="w-full overflow-hidden rounded-lg border border-line-soft bg-surface px-3 pb-1 pt-2 shadow-e1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.06em] text-ink-faint">
            <Icon name={icon} size={11} />
            {label}
          </span>
          <span
            className={cx(
              "font-display text-base font-semibold tabular-nums leading-none",
              tone === "bad"
                ? "text-bad"
                : tone === "warn"
                  ? "text-warn"
                  : "text-ink",
            )}
          >
            {value}
            {unit && (
              <span className="ml-0.5 text-2xs font-normal text-ink-faint">
                {unit}
              </span>
            )}
          </span>
        </div>
        <div className="-mx-1 mt-1">
          <Spark values={history} max={max} color={color} id={sparkId} />
        </div>
      </div>
    </Tooltip>
  );
}

export function HealthStrip({
  serverId,
  live,
}: {
  serverId: string;
  live: boolean;
}) {
  const [s, setS] = useState<PerfSample | null>(null);
  const ram = useRef<number[]>([]);
  const cpu = useRef<number[]>([]);
  const tps = useRef<number[]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    ram.current = [];
    cpu.current = [];
    tps.current = [];
    setS(null);
  }, [serverId]);

  useEffect(() => {
    if (!live) return;
    let alive = true;
    const tick = () =>
      api
        .serverPerf(serverId)
        .then((p) => {
          if (!alive) return;
          setS(p);
          const push = (arr: number[], v: number | null) => {
            if (v != null) {
              arr.push(v);
              if (arr.length > KEEP) arr.shift();
            }
          };
          push(ram.current, p.ramMb);
          push(cpu.current, p.cpuPct);
          push(tps.current, p.tps);
          force((n) => n + 1);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [serverId, live]);

  if (!live) return null;

  // first 3s after a start: show the shape of the strip rather than nothing,
  // so the layout doesn't jump once numbers arrive
  if (!s) {
    return (
      <div className="flex shrink-0 gap-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[74px] flex-1" />
        ))}
      </div>
    );
  }

  const tpsTone =
    s.tps == null ? undefined : s.tps >= 19 ? "ok" : s.tps >= 15 ? "warn" : "bad";
  const cpuTone = s.cpuPct == null ? undefined : s.cpuPct >= 90 ? "warn" : undefined;

  return (
    <div className="flex shrink-0 gap-2.5">
      <Stat
        icon="memory"
        label="Memory"
        value={s.ramMb != null ? (s.ramMb / 1024).toFixed(1) : "—"}
        unit={s.ramMb != null ? "GB" : undefined}
        history={ram.current}
        max={Math.max(1024, ...ram.current) * 1.15}
        color="var(--cp-accent)"
        help="How much RAM the server process is using right now. Climbing steadily and never dropping usually means a mod is leaking."
        sparkId="spark-ram"
      />
      <Stat
        icon="cpu"
        label="CPU"
        value={s.cpuPct != null ? s.cpuPct.toFixed(0) : "—"}
        unit={s.cpuPct != null ? "%" : undefined}
        history={cpu.current}
        max={Math.max(100, ...cpu.current)}
        color="var(--cp-info)"
        tone={cpuTone}
        help="Share of one CPU core. Above 100% just means it's using more than one core — that's normal for a busy server."
        sparkId="spark-cpu"
      />
      <Stat
        icon="gauge"
        label="Tick rate"
        value={s.tps != null ? s.tps.toFixed(1) : s.source ? "—" : "n/a"}
        unit={
          s.tps != null
            ? s.mspt != null
              ? `tps · ${s.mspt.toFixed(0)}ms`
              : "tps"
            : undefined
        }
        history={tps.current}
        max={20}
        color="var(--cp-ok)"
        tone={tpsTone}
        help="20 tps is perfect. Below 15 and players feel it as lag — usually too many mobs, a heavy mod, or not enough memory."
        sparkId="spark-tps"
      />
    </div>
  );
}
