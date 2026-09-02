import { useRef, useState, type CSSProperties } from "react";

/**
 * A small, dependency-free area/line chart — hand-rolled SVG, same spirit
 * as the QR code (`net.rs::qr_svg`): this app doesn't reach for a charting
 * library for one shape of chart. Null values (server wasn't running, or
 * RCON wasn't reachable for that sample) become a real gap in the line,
 * not a drop to zero — a gap tells the truth, zero would lie.
 *
 * Hover shows the nearest point's real value + time — a chart you can't
 * read a specific value off of is just decoration.
 */
export function AreaChart({
  data,
  height = 90,
  color = "var(--color-accent)",
  yMax,
  formatValue = (v) => `${Math.round(v)}`,
  emptyMessage = "Not enough history yet — check back once the server's run a while.",
}: {
  data: { ts: number; value: number | null }[];
  height?: number;
  color?: string;
  /** force the top of the y-axis (e.g. allocated RAM) instead of auto-scaling */
  yMax?: number;
  formatValue?: (v: number) => string;
  emptyMessage?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const known = data.filter((d): d is { ts: number; value: number } => d.value != null);

  if (known.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-2xs text-ink-faint"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  const width = 600; // viewBox units — scales to container via CSS
  const padTop = 8;
  const padBottom = 4;
  const plotH = height - padTop - padBottom;

  const minTs = data[0].ts;
  const maxTs = data[data.length - 1].ts || minTs + 1;
  const span = Math.max(1, maxTs - minTs);

  const maxV = yMax ?? (Math.max(...known.map((d) => d.value)) * 1.15 || 1);

  const x = (ts: number) => ((ts - minTs) / span) * width;
  const y = (v: number) => padTop + plotH - (Math.min(v, maxV) / maxV) * plotH;

  // build line segments, breaking at gaps (null values)
  const segments: { ts: number; value: number }[][] = [];
  let current: { ts: number; value: number }[] = [];
  for (const d of data) {
    if (d.value == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ ts: d.ts, value: d.value });
    }
  }
  if (current.length) segments.push(current);

  const linePath = (seg: { ts: number; value: number }[]) =>
    seg.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  const areaPath = (seg: { ts: number; value: number }[]) =>
    `${linePath(seg)} L${x(seg[seg.length - 1].ts).toFixed(1)},${padTop + plotH} ` +
    `L${x(seg[0].ts).toFixed(1)},${padTop + plotH} Z`;

  const latest = known[known.length - 1].value;
  const peak = Math.max(...known.map((d) => d.value));

  function nearestKnownIndex(clientX: number): number | null {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const relX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const ts = minTs + relX * span;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < known.length; i++) {
      const dist = Math.abs(known[i].ts - ts);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  const hovered = hoverIdx != null ? known[hoverIdx] : null;
  const hoverXPct = hovered ? (x(hovered.ts) / width) * 100 : 0;
  // flip the tooltip to the other side near the edges so it doesn't clip
  const tooltipSide = hoverXPct > 70 ? "right" : "left";

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-[var(--h)] w-full cursor-crosshair"
        style={{ "--h": `${height}px` } as CSSProperties}
        onMouseMove={(e) => setHoverIdx(nearestKnownIndex(e.clientX))}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {segments.map((seg, i) => (
          <path key={`a${i}`} d={areaPath(seg)} fill={color} opacity={0.14} />
        ))}
        {segments.map((seg, i) => (
          <path
            key={`l${i}`}
            d={linePath(seg)}
            fill="none"
            stroke={color}
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {hovered && (
          <>
            <line
              x1={x(hovered.ts)}
              x2={x(hovered.ts)}
              y1={padTop}
              y2={padTop + plotH}
              stroke="var(--cp-line-strong)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="3,3"
            />
            <circle
              cx={x(hovered.ts)}
              cy={y(hovered.value)}
              r={3.5}
              fill={color}
              stroke="var(--cp-surface)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className={
            "pointer-events-none absolute top-0 z-10 -translate-y-full rounded-md border border-line bg-surface-2 px-2 py-1 text-2xs shadow-e2 " +
            (tooltipSide === "right" ? "-translate-x-full" : "")
          }
          style={{ left: `${hoverXPct}%` }}
        >
          <div className="font-mono font-medium text-ink">{formatValue(hovered.value)}</div>
          <div className="text-ink-faint">{new Date(hovered.ts * 1000).toLocaleTimeString()}</div>
        </div>
      )}

      <div className="mt-1 flex items-center justify-between text-2xs text-ink-faint">
        <span>
          latest <span className="font-mono text-ink-dim">{formatValue(latest)}</span>
        </span>
        <span>
          peak <span className="font-mono text-ink-dim">{formatValue(peak)}</span>
        </span>
      </div>
    </div>
  );
}
