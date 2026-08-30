import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Badge, Button, IconButton, StateBlock, cx } from "./ui";
import { Icon } from "./Icon";

/**
 * Tail of logs/latest.log. Works for any server — managed, reattached, or one
 * that was started outside CraftPanel — which is why it's a peer of the live
 * console rather than a fallback buried in a menu.
 */
export function LogView({
  serverId,
  live,
}: {
  serverId: string;
  live: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  function fetchTail(showSpinner = false) {
    if (showSpinner) setBusy(true);
    return api
      .tailLog(serverId, undefined, 500)
      .then((t) => {
        setText(t);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  }

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
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e1">
      <div className="flex shrink-0 items-center gap-2 border-b border-line-soft px-3 py-2">
        <span className="flex items-center gap-1.5 font-display text-xs font-semibold text-ink">
          <Icon name="file" size={13} className="text-ink-faint" />
          logs/latest.log
        </span>
        {live && (
          <Badge tone="ok" size="sm" dot>
            auto-refreshing
          </Badge>
        )}
        <span className="flex-1" />
        <span className="text-2xs text-ink-faint">last 500 lines</span>
        <IconButton
          icon="refresh"
          title="Refresh now"
          size="sm"
          onClick={() => fetchTail(true)}
          className={cx(busy && "opacity-60")}
        />
      </div>

      {error ? (
        <StateBlock
          state="error"
          title="Can't read the log"
          message={
            <>
              The server hasn't written <code>logs/latest.log</code> yet, or the
              folder moved.
              <div className="mt-2 break-words font-mono text-2xs text-ink-ghost">
                {error}
              </div>
            </>
          }
          onRetry={() => fetchTail(true)}
        />
      ) : text === null ? (
        <StateBlock state="loading" title="Reading the log file…" />
      ) : (
        <pre
          ref={boxRef}
          data-selectable
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="cp-well min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-2xs leading-[1.7] text-ink-dim"
        >
          {text || "(the log file is empty)"}
        </pre>
      )}

      {!live && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line-soft bg-surface-2 px-3 py-2 text-2xs text-ink-faint">
          <Icon name="info" size={12} />
          The server isn't running, so this is a snapshot.
          <span className="flex-1" />
          <Button variant="quiet" size="sm" icon="refresh" onClick={() => fetchTail(true)}>
            Refresh
          </Button>
        </div>
      )}
    </div>
  );
}
