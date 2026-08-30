import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import type { LogLine } from "../types";
import { Button } from "./ui";

const STREAM_COLOR: Record<LogLine["stream"], string> = {
  stdout: "text-ink",
  stderr: "text-bad",
  system: "text-accent",
};

export function ConsoleView({
  serverId,
  canSend,
}: {
  serverId: string;
  canSend: boolean;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;

    api.consoleLines(serverId).then((seed) => {
      if (alive) setLines(seed);
    });
    api
      .onLog((line) => {
        if (line.server_id !== serverId) return;
        setLines((prev) => {
          const next = prev.length > 600 ? prev.slice(-500) : prev.slice();
          next.push(line);
          return next;
        });
      })
      .then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [serverId]);

  // autoscroll only when the user is already at the bottom
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }

  async function send() {
    const line = input.trim();
    if (!line) return;
    setHistory((h) => [...h, line]);
    setHistIdx(null);
    setInput("");
    try {
      await api.sendConsole(serverId, line);
    } catch (e) {
      // surface as a synthetic system line
      setLines((prev) => [
        ...prev,
        {
          server_id: serverId,
          seq: -1,
          stream: "stderr",
          text: `! ${e}`,
        },
      ]);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      send();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const idx = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(idx);
      setInput(history[idx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === null) return;
      const idx = histIdx + 1;
      if (idx >= history.length) {
        setHistIdx(null);
        setInput("");
      } else {
        setHistIdx(idx);
        setInput(history[idx]);
      }
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-edge bg-[#0c0d10]">
      <div className="flex items-center justify-between border-b border-edge px-3 py-1.5 text-xs text-ink-faint">
        <span>Console</span>
        <button
          className="hover:text-ink"
          onClick={() => setLines([])}
          title="Clear view (does not touch the server)"
        >
          clear
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 ? (
          <div className="text-ink-faint">No output yet.</div>
        ) : (
          lines.map((l, i) => (
            <div
              key={`${l.seq}-${i}`}
              className={`whitespace-pre-wrap break-words ${STREAM_COLOR[l.stream]}`}
            >
              {l.text}
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-edge p-2">
        <span className="pl-1 font-mono text-xs text-ink-faint">&gt;</span>
        <input
          value={input}
          disabled={!canSend}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            canSend ? "Type a server command…" : "Start the server to send commands"
          }
          className="flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
        />
        <Button variant="subtle" onClick={send} disabled={!canSend || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
