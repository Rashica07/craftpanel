import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AntiCheatAdvice, Suspicion } from "../types";
import { Badge } from "./ui";
import { Icon } from "./Icon";

export function SecuritySection({ serverId }: { serverId: string }) {
  const [advice, setAdvice] = useState<AntiCheatAdvice | null>(null);
  const [sus, setSus] = useState<Suspicion[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.anticheatAdvice(serverId).then(setAdvice).catch((e) => setError(String(e)));
    api.anticheatSuspicion(serverId).then(setSus).catch(() => {});
  }, [serverId]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
          <Icon name="power" size={13} /> Security
        </span>
        <button className="text-[11px] text-accent hover:underline" onClick={load}>
          Refresh
        </button>
      </div>

      {advice && advice.supported && (
        <div className="mb-2">
          {advice.installed.length > 0 ? (
            <div className="rounded border border-ok/30 bg-ok/10 px-2 py-1.5 text-xs text-ok">
              Anti-cheat: {advice.installed.join(", ")}
            </div>
          ) : advice.warn ? (
            <div className="rounded border border-warn/30 bg-warn/10 px-2 py-1.5 text-xs text-warn">
              This server is shared publicly and has no anti-cheat. Consider one of:
              <ul className="mt-1 space-y-0.5">
                {advice.recommended.map((r) => (
                  <li key={r.name}>
                    <span className="font-medium">{r.name}</span>
                    {r.slug && (
                      <span className="ml-1 text-ink-faint">
                        — install it from the Browse tab
                      </span>
                    )}
                    <span className="block text-[10px] text-ink-faint">{r.blurb}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-[11px] text-ink-faint">
              No anti-cheat installed — fine for a private/friends server.
            </div>
          )}
        </div>
      )}
      {advice && !advice.supported && (
        <div className="mb-2 text-[11px] text-ink-faint">
          Vanilla servers have no anti-cheat option — switch to Paper or Fabric for one.
        </div>
      )}

      <div className="border-t border-edge pt-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-faint">
          Suspicion signals (from the logs)
        </div>
        {sus == null ? (
          <div className="text-[11px] text-ink-faint">Reading logs…</div>
        ) : sus.length === 0 ? (
          <div className="text-[11px] text-ink-faint">Nothing flagged.</div>
        ) : (
          <ul className="space-y-1">
            {sus.map((s) => (
              <li key={s.name} className="rounded bg-panel-2">
                <button
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
                  onClick={() => setOpen(open === s.name ? null : s.name)}
                >
                  <span className="flex-1">{s.name}</span>
                  {s.flags > 0 && <Badge tone="bad">{s.flags} flags</Badge>}
                  {s.rejoins > 0 && <Badge tone="warn">{s.rejoins} rapid re-joins</Badge>}
                </button>
                {open === s.name && s.samples.length > 0 && (
                  <pre className="border-t border-edge px-2 py-1.5 text-[10px] leading-relaxed text-ink-faint">
                    {s.samples.join("\n")}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[10px] text-ink-faint">
          Heuristic only — movement kicks and re-joins have innocent causes too.
        </p>
      </div>
      {error && (
        <div className="mt-2 rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}
    </div>
  );
}
