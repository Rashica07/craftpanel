import { useEffect, useState } from "react";
import { api } from "../api";
import type { SystemInfo } from "../types";

const MIN_MB = 1024;

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
    api.systemInfo().then(setSys).catch(() => setSys(null));
  }, []);

  const maxMb = sys ? Math.max(sys.total_ram_mb, valueMb) : Math.max(8192, valueMb);
  const safeMax = sys?.suggested_max_mb ?? Math.round(maxMb * 0.75);
  const pct = ((valueMb - MIN_MB) / (maxMb - MIN_MB)) * 100;
  const overSafe = valueMb > safeMax;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium uppercase tracking-wide text-ink-faint">
          Memory allocation
        </span>
        <span className={overSafe ? "text-warn" : "text-ink"}>
          {(valueMb / 1024).toFixed(valueMb % 1024 === 0 ? 0 : 1)} GB
          <span className="text-ink-faint"> · Xms = Xmx</span>
        </span>
      </div>
      <input
        type="range"
        min={MIN_MB}
        max={maxMb}
        step={512}
        value={valueMb}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent disabled:opacity-50"
        style={{
          background: `linear-gradient(to right, var(--color-accent) ${pct}%, var(--color-panel-3) ${pct}%)`,
        }}
      />
      <div className="mt-1 flex justify-between text-[11px] text-ink-faint">
        <span>{(MIN_MB / 1024).toFixed(0)} GB</span>
        {sys && (
          <span className={overSafe ? "text-warn" : ""}>
            {overSafe
              ? `Above the ${(safeMax / 1024).toFixed(1)} GB safe limit for this machine`
              : `${(sys.total_ram_mb / 1024).toFixed(1)} GB installed`}
          </span>
        )}
        <span>{(maxMb / 1024).toFixed(0)} GB</span>
      </div>
    </div>
  );
}
