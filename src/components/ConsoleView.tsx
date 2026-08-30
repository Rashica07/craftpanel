import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api";
import type { LogLine } from "../types";
import { Badge, Button, IconButton, Kbd, TextInput, cx } from "./ui";
import { Icon } from "./Icon";

/**
 * Minecraft writes `[12:34:56] [Server thread/INFO]: Done (5.2s)!`.
 * Splitting that apart lets us dim the timestamp, colour the level and leave
 * the message at full contrast — which is the difference between "wall of
 * text" and something a beginner can actually skim.
 */
const MC_LINE = /^\[(\d{2}:\d{2}:\d{2})\]\s*\[([^\]]*)\]:?\s?(.*)$/s;

type Level = "info" | "warn" | "error" | "system" | "plain";

interface Parsed {
  time?: string;
  source?: string;
  level: Level;
  text: string;
}

function parse(line: LogLine): Parsed {
  if (line.stream === "system")
    return { level: "system", text: line.text };

  const m = MC_LINE.exec(line.text);
  if (!m) {
    return {
      level: line.stream === "stderr" ? "error" : "plain",
      text: line.text,
    };
  }
  const [, time, source, rest] = m;
  const up = source.toUpperCase();
  const level: Level = up.includes("ERROR") || up.includes("FATAL")
    ? "error"
    : up.includes("WARN")
      ? "warn"
      : line.stream === "stderr"
        ? "error"
        : "info";
  return { time, source: source.split("/")[0], level, text: rest };
}

const LEVEL_TEXT: Record<Level, string> = {
  info: "text-ink-dim",
  warn: "text-warn-soft",
  error: "text-bad-soft",
  system: "text-accent-soft",
  plain: "text-ink-dim",
};

const LEVEL_MARK: Record<Level, string> = {
  info: "bg-transparent",
  warn: "bg-warn",
  error: "bg-bad",
  system: "bg-accent",
  plain: "bg-transparent",
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
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [pinned, setPinned] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const parsed = lines.map((l) => ({ raw: l, p: parse(l) }));
    return f
      ? parsed.filter((r) => r.raw.text.toLowerCase().includes(f))
      : parsed;
  }, [lines, filter]);

  const errorCount = useMemo(
    () => rows.filter((r) => r.p.level === "error").length,
    [rows],
  );

  // autoscroll only while the user is already at the bottom
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [rows]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    pinnedRef.current = atBottom;
    if (atBottom !== pinned) setPinned(atBottom);
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    pinnedRef.current = true;
    setPinned(true);
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
      setLines((prev) => [
        ...prev,
        { server_id: serverId, seq: -1, stream: "stderr", text: `! ${e}` },
      ]);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      send();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!history.length) return;
      const idx =
        histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
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
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-e1">
      {/* ── toolbar ───────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line-soft px-3 py-2">
        <span className="flex items-center gap-1.5 font-display text-xs font-semibold text-ink">
          <Icon name="terminal" size={13} className="text-ink-faint" />
          Console
        </span>
        {errorCount > 0 && (
          <Badge tone="bad" size="sm">
            {errorCount} error{errorCount > 1 ? "s" : ""}
          </Badge>
        )}
        <span className="text-2xs tabular-nums text-ink-faint">
          {rows.length} line{rows.length === 1 ? "" : "s"}
          {filter && ` of ${lines.length}`}
        </span>

        <span className="flex-1" />

        {showFilter ? (
          <div className="flex w-56 items-center gap-1">
            <TextInput
              autoFocus
              icon="search"
              value={filter}
              placeholder="Filter lines…"
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFilter("");
                  setShowFilter(false);
                }
              }}
              className="h-7 text-xs"
            />
            <IconButton
              icon="x"
              title="Clear filter"
              size="sm"
              onClick={() => {
                setFilter("");
                setShowFilter(false);
              }}
            />
          </div>
        ) : (
          <IconButton
            icon="search"
            title="Filter lines"
            size="sm"
            onClick={() => setShowFilter(true)}
          />
        )}
        <IconButton
          icon="trash"
          title="Clear this view (doesn't touch the server or its log file)"
          size="sm"
          onClick={() => setLines([])}
        />
      </div>

      {/* ── output ────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        data-selectable
        className="cp-well min-h-0 flex-1 overflow-y-auto py-2 font-mono text-xs leading-[1.65]"
      >
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-ghost">
            <Icon name="terminal" size={22} />
            <p className="text-xs">
              {filter
                ? "No lines match that filter."
                : canSend
                  ? "Waiting for the server to say something…"
                  : "Start the server and its output shows up here."}
            </p>
          </div>
        ) : (
          rows.map(({ raw, p }, i) => (
            <div
              key={`${raw.seq}-${i}`}
              className={cx(
                "group relative flex gap-2 px-3 hover:bg-white/[0.025]",
                p.level === "error" && "bg-bad/[0.06]",
                p.level === "warn" && "bg-warn/[0.05]",
              )}
            >
              {/* left rail marks warnings/errors so you can find them by
                  scrolling fast, without colouring the whole line */}
              <span
                className={cx(
                  "absolute inset-y-0 left-0 w-[2px]",
                  LEVEL_MARK[p.level],
                )}
              />
              {p.time && (
                <span className="shrink-0 select-none tabular-nums text-ink-faint">
                  {p.time}
                </span>
              )}
              <span
                className={cx(
                  "min-w-0 flex-1 whitespace-pre-wrap break-words",
                  LEVEL_TEXT[p.level],
                )}
              >
                {p.level === "warn" && (
                  <span className="mr-1.5 font-semibold text-warn">WARN</span>
                )}
                {p.level === "error" && (
                  <span className="mr-1.5 font-semibold text-bad">ERROR</span>
                )}
                {p.text}
              </span>
            </div>
          ))
        )}
      </div>

      {/* jump-to-bottom: only while the user has scrolled away */}
      {!pinned && (
        <button
          onClick={jumpToBottom}
          className="cp-fade absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface-3 px-3 py-1.5 text-2xs font-medium text-ink shadow-e2 hover:bg-surface-4"
        >
          <Icon name="arrow-down" size={12} />
          Jump to latest
        </button>
      )}

      {/* ── command line ──────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line-soft bg-surface-2 px-3 py-2">
        <span
          className={cx(
            "select-none font-mono text-xs",
            canSend ? "text-accent" : "text-ink-ghost",
          )}
        >
          ›
        </span>
        <input
          ref={inputRef}
          value={input}
          disabled={!canSend}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            canSend
              ? "Type a command — try  say hello  or  time set day"
              : "Start the server to send commands"
          }
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-ghost disabled:cursor-not-allowed"
        />
        {canSend && history.length > 0 && !input && (
          <span className="hidden shrink-0 items-center gap-1 text-2xs text-ink-ghost sm:flex">
            <Kbd>↑</Kbd> history
          </span>
        )}
        <Button
          variant={input.trim() ? "primary" : "subtle"}
          size="sm"
          onClick={send}
          disabled={!canSend || !input.trim()}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
