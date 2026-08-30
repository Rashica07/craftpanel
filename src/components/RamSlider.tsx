import { useEffect, useState } from "react";
import { api } from "../api";
import type { SystemInfo } from "../types";
import { Badge, Slider, Tooltip, cx } from "./ui";
import { Icon } from "./Icon";

const MIN_MB = 1024;

const gb = (mb: number) => (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1);

/**
 * Memory allocation. The number is the hero (people know "how many GB"), the
 * slider is secondary, and the safe limit is drawn *on the track* rather than
 * explained in prose — so over-allocating looks wrong before you read why.
 */
export function RamSlider({
  valueMb,
  onChange,
  disabled,
}: {
  valueMb: number;
  onChange: (mb: number) => void;
  disabled?: boolean;
}) {
  const [sys, setSys] = useState<SystemInfo | null>(null);

  useEffect(() => {
    api
      .systemInfo()
      .then(setSys)
      .catch(() => setSys(null));
  }, []);

  const maxMb = sys ? Math.max(sys.total_ram_mb, valueMb) : Math.max(8192, valueMb);
  const safeMax = sys?.suggested_max_mb ?? Math.round(maxMb * 0.75);
  const overSafe = valueMb > safeMax;
  const safePct = ((safeMax - MIN_MB) / (maxMb - MIN_MB)) * 100;

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.06em] text-ink-faint">
            <Icon name="memory" size={12} />
            Memory for this server
          </div>
          <p className="mt-1 text-2xs leading-snug text-ink-faint">
            More memory lets you run more mods and hold more chunks — it doesn't
            make the game faster on its own.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span
            className={cx(
              "cp-display text-2xl leading-none tabular-nums",
              overSafe ? "text-warn" : "text-ink",
            )}
          >
            {gb(valueMb)}
          </span>
          <span className="ml-1 text-xs text-ink-faint">GB</span>
        </div>
      </div>

      <div className="relative mt-3">
        <Slider
          aria-label="Memory allocation in megabytes"
          value={valueMb}
          min={MIN_MB}
          max={maxMb}
          step={512}
          disabled={disabled}
          onChange={onChange}
        />
        {/* the safe-limit tick sits on the track itself */}
        {sys && safePct > 2 && safePct < 98 && (
          <Tooltip
            label={`${gb(safeMax)} GB is the most this machine can spare without starving macOS/Windows.`}
          >
            <span
              className="pointer-events-auto absolute top-[7px] h-2 w-px -translate-x-1/2 bg-ink-faint"
              style={{ left: `${safePct}%` }}
            />
          </Tooltip>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between text-2xs text-ink-faint">
        <span className="tabular-nums">{gb(MIN_MB)} GB</span>
        {sys &&
          (overSafe ? (
            <Badge tone="warn" size="sm" icon="alert">
              Over the {gb(safeMax)} GB safe limit
            </Badge>
          ) : (
            <span>{gb(sys.total_ram_mb)} GB installed</span>
          ))}
        <span className="tabular-nums">{gb(maxMb)} GB</span>
      </div>
    </div>
  );
}
