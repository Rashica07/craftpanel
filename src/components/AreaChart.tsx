/**
 * A small, dependency-free area/line chart — hand-rolled SVG, same spirit
 * as the QR code (`net.rs::qr_svg`): this app doesn't reach for a charting
 * library for one shape of chart. Null values (server wasn't running, or
 * RCON wasn't reachable for that sample) become a real gap in the line,
 * not a drop to zero — a gap tells the truth, zero would lie.
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

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-[var(--h)] w-full"
        style={{ "--h": `${height}px` } as React.CSSProperties}
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
      </svg>
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
