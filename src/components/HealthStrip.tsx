import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { PerfSample } from "../types";

const KEEP = 40;

function Spark({ values, max, color }: { values: number[]; max: number; color: string }) {
  if (values.length < 2) return <div className="h-8 w-full" />;
  const w = 120;
  const h = 32;
  const step = w / (KEEP - 1);
  const pts = values
    .map((v, i) => {
      const x = w - (values.length - 1 - i) * step;
      const y = h - Math.max(0, Math.min(1, v / max)) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function Stat({
  label,
  value,
  history,
  max,
  color,
  tone,
}: {
  label: string;
  value: string;
  history: number[];
  max: number;
  color: string;
  tone?: "ok" | "warn" | "bad";
}) {
  return (
    <div className="flex-1 rounded-md border border-edge bg-panel-2 p-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</span>
        <span
          className={`text-sm font-medium ${
            tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink"
          }`}
        >
          {value}
        </span>
      </div>
      <Spark values={history} max={max} color={color} />
    </div>
  );
}

export function HealthStrip({ serverId, live }: { serverId: string; live: boolean }) {
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

  if (!live || !s) return null;

  const tpsTone = s.tps == null ? undefined : s.tps >= 19 ? "ok" : s.tps >= 15 ? "warn" : "bad";

  return (
    <div className="mb-2 flex gap-2">
      <Stat
        label="RAM"
        value={s.ramMb != null ? `${(s.ramMb / 1024).toFixed(1)} GB` : "—"}
        history={ram.current}
        max={Math.max(1024, ...ram.current) * 1.1}
        color="#FF8C00"
      />
      <Stat
        label="CPU"
        value={s.cpuPct != null ? `${s.cpuPct.toFixed(0)}%` : "—"}
        history={cpu.current}
        max={Math.max(100, ...cpu.current)}
        color="#5b9bd5"
      />
      <Stat
        label={s.mspt != null ? "MSPT" : "TPS"}
        value={
          s.tps != null
            ? `${s.tps.toFixed(1)} tps${s.mspt != null ? ` · ${s.mspt.toFixed(1)} ms` : ""}`
            : s.source
              ? "—"
              : "n/a"
        }
        history={tps.current}
        max={20}
        color="#63c088"
        tone={tpsTone}
      />
    </div>
  );
}
