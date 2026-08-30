import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button } from "./ui";

/** Tail of logs/latest.log — works for any server (managed, reattached, external). */
export function LogView({ serverId, live }: { serverId: string; live: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .tailLog(serverId, undefined, 500)
        .then((t) => {
          if (!alive) return;
          setText(t);
          setError(null);
        })
        .catch((e) => alive && setError(String(e)));
    tick();
    const t = live ? setInterval(tick, 3000) : undefined;
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [serverId, live]);

  useEffect(() => {
    if (stick.current && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2 text-xs text-ink-faint">
        <span className="font-mono">logs/latest.log</span>
        {live && <span className="text-ok">• auto-refreshing</span>}
        <span className="flex-1" />
        <Button
          variant="ghost"
          onClick={() =>
            api.tailLog(serverId, undefined, 500).then(setText).catch((e) => setError(String(e)))
          }
        >
          Refresh
        </Button>
      </div>
      {error ? (
        <div className="rounded border border-edge bg-panel p-3 text-xs text-ink-faint">{error}</div>
      ) : (
        <pre
          ref={boxRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded border border-edge bg-[#0b0c0e] p-2 font-mono text-[11px] leading-relaxed text-ink-dim"
        >
          {text ?? "Loading…"}
        </pre>
      )}
    </div>
  );
}
