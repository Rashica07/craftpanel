import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  applyCommandSuggestion,
  suggestCommand,
  type CommandSuggestion,
} from "../data/mcCommands";
import { cx } from "./ui";

/**
 * A console command field with command-name and argument autofill, dropped
 * into ConsoleView's live console and RconPanel's `/` field.
 *
 * It only ever intercepts a keystroke while its own dropdown is actually
 * open — Enter/↑/↓ fall through to `onKeyDown` the rest of the time, so it
 * slots in as a drop-in replacement for a plain `<input>` without disturbing
 * whatever history/submit behaviour the caller already had.
 */
export function CommandInput({
  value,
  onChange,
  onKeyDown,
  players,
  disabled,
  placeholder,
  prefix,
  className = "",
  inputClassName = "",
}: {
  value: string;
  onChange: (v: string) => void;
  /** fallback handler — called for any key the dropdown doesn't itself use */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** online player names, for completing <player> argument slots */
  players?: string[];
  disabled?: boolean;
  placeholder?: string;
  prefix?: ReactNode;
  className?: string;
  inputClassName?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = disabled ? [] : suggestCommand(value, players);
  const open = focused && suggestions.length > 0 && value !== dismissedFor;
  const idx = Math.min(active, Math.max(0, suggestions.length - 1));

  // fresh keystroke -> re-highlight the top match, not wherever the mouse
  // last hovered
  useEffect(() => setActive(0), [value]);

  function accept(s: CommandSuggestion) {
    onChange(applyCommandSuggestion(value, s.value));
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        accept(suggestions[idx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedFor(value);
        return;
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className={cx("relative flex min-w-0 flex-1 items-center gap-2", className)}>
      {prefix}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? "command-suggest-list" : undefined}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cx(
          "min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-ghost disabled:cursor-not-allowed",
          inputClassName,
        )}
      />

      {open && (
        <div
          id="command-suggest-list"
          role="listbox"
          className="cp-pop absolute bottom-full left-0 z-20 mb-1.5 max-h-56 w-full min-w-64 overflow-y-auto rounded-lg border border-line bg-surface-2 p-1 shadow-e3"
        >
          {suggestions.map((s, i) => (
            <button
              key={s.value}
              type="button"
              role="option"
              aria-selected={i === idx}
              // onMouseDown, not onClick: fires before the input's onBlur,
              // so clicking a row never closes the list out from under it
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
              className={cx(
                "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left transition-colors duration-[80ms]",
                i === idx
                  ? "bg-accent-muted text-accent-soft"
                  : "text-ink-dim hover:bg-surface-3 hover:text-ink",
              )}
            >
              <span className="min-w-0 shrink-0 truncate font-mono text-xs">
                {s.value}
              </span>
              {s.usage && (
                <span className="min-w-0 flex-1 truncate text-2xs text-ink-faint">
                  {s.usage}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
