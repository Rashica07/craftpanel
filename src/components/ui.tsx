/**
 * CraftPanel UI kit
 * ============================================================================
 * Every primitive the app is built from. Dark-first, token-driven (see
 * index.css), keyboard-navigable, and deliberately small — no runtime deps.
 *
 * Back-compat note: Button/Badge/Card/Field/TextInput/Toggle keep their
 * original prop shapes so the ~20 feature panels keep compiling untouched.
 * New props are all optional and additive.
 *
 * ── INDEX ──────────────────────────────────────────────────────────────────
 *  Button          primary | secondary | ghost | subtle | danger | quiet
 *                  sizes sm|md|lg · loading · icon/iconRight · block
 *  IconButton      square icon-only button, same variants
 *  Badge           neutral | accent | ok | warn | bad | info  (+ dot, size)
 *  Pill            interactive Badge (filter chips)
 *  StatusDot       colored dot with an optional live halo
 *  Card            title/icon/right/description/footer/pad/tone
 *  SectionHeader   standalone header row for grouped content
 *  Field           label + hint wrapper for one control
 *  SettingRow      icon · label · one-line help · control  (Settings tiers)
 *  TextInput       + icon, suffix, invalid, mono
 *  Textarea
 *  Select          styled native select (keeps OS keyboard behaviour)
 *  Slider          range with fill, ticks, value readout
 *  Toggle          switch (sm|md), optional label/description
 *  Checkbox        square check, same rhythm as Toggle
 *  Tabs            icon+label tabs with overflow "More" menu + arrow keys
 *  Segmented       small 2-4 way switch (Live/Log, Basics/Advanced/Raw)
 *  Modal           portal, focus trap, Esc, scrim, sizes
 *  Banner          inline status: info | ok | warn | bad | accent
 *  EmptyState      icon + title + body + action, with pixel-motif art
 *  StateBlock      loading | empty | error | offline in one component
 *  Skeleton        shimmer placeholder
 *  Spinner
 *  ProgressBar     determinate + indeterminate
 *  Tooltip         portal-positioned, hover + focus
 *  CopyField       big copyable value (join addresses)
 *  Kbd
 *  Toaster/toast   fire-and-forget toasts from anywhere
 * ==========================================================================*/

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

/* ─────────────────────────────── helpers ─────────────────────────────── */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";

/* ─────────────────────────────── Button ──────────────────────────────── */

export type ButtonVariant =
  | "primary" // the one thing to do on this screen
  | "secondary" // a real alternative action
  | "ghost" // bordered, low commitment  (legacy default)
  | "subtle" // filled, no border, tertiary
  | "quiet" // text only
  | "danger"; // destructive

export type ButtonSize = "sm" | "md" | "lg";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-accent font-semibold shadow-e1 hover:bg-accent-hover active:bg-accent-press",
  secondary:
    "bg-surface-3 text-ink border border-line hover:bg-surface-4 hover:border-line-strong active:bg-surface-3",
  ghost:
    "bg-surface-2 text-ink border border-line hover:bg-surface-3 hover:border-line-strong active:bg-surface-2",
  subtle: "bg-surface-3 text-ink hover:bg-surface-4 active:bg-surface-3",
  quiet: "bg-transparent text-ink-dim hover:bg-surface-2 hover:text-ink",
  danger:
    "bg-transparent text-bad border border-bad/35 hover:bg-bad/12 hover:border-bad/60 active:bg-bad/18",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-2xs rounded-sm",
  md: "h-8 gap-1.5 px-3 text-xs rounded-md",
  lg: "h-10 gap-2 px-4 text-sm rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** swaps the leading icon for a spinner and blocks input */
  loading?: boolean;
  /** icon name or node, rendered before the label */
  icon?: ReactNode;
  /** icon name or node, rendered after the label */
  iconRight?: ReactNode;
  /** full-width */
  block?: boolean;
}

export function Button({
  variant = "ghost",
  size = "md",
  loading = false,
  icon,
  iconRight,
  block = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const iconSize = size === "lg" ? 16 : 14;
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium",
        "transition-[background-color,border-color,color,transform,opacity] duration-[120ms] ease-cp",
        "active:translate-y-px disabled:pointer-events-none disabled:opacity-40",
        BTN_SIZE[size],
        BTN_VARIANT[variant],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={iconSize} />
      ) : typeof icon === "string" ? (
        <Icon name={icon} size={iconSize} />
      ) : (
        icon
      )}
      {children}
      {typeof iconRight === "string" ? (
        <Icon name={iconRight} size={iconSize} />
      ) : (
        iconRight
      )}
    </button>
  );
}

/** Square, icon-only. Always give it a `title` — it becomes the a11y label. */
export function IconButton({
  icon,
  title,
  variant = "quiet",
  size = "md",
  className = "",
  ...rest
}: Omit<ButtonProps, "icon" | "children"> & { icon: string; title: string }) {
  const box = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-10 w-10" : "h-8 w-8";
  return (
    <button
      title={title}
      aria-label={title}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-[120ms] ease-cp",
        "active:translate-y-px disabled:pointer-events-none disabled:opacity-40",
        box,
        BTN_VARIANT[variant],
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === "lg" ? 18 : 15} />
    </button>
  );
}

/* ──────────────────────────── Badge / Pill ───────────────────────────── */

const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-dim border-line",
  accent: "bg-accent-muted text-accent-soft border-accent-line",
  ok: "bg-ok-muted text-ok-soft border-ok/30",
  warn: "bg-warn-muted text-warn-soft border-warn/30",
  bad: "bg-bad-muted text-bad-soft border-bad/30",
  info: "bg-info-muted text-info-soft border-info/30",
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  info: "bg-info",
};

export function Badge({
  children,
  tone = "neutral",
  size = "md",
  dot = false,
  icon,
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  size?: "sm" | "md";
  /** leading status dot in the badge's tone */
  dot?: boolean;
  icon?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium",
        size === "sm" ? "px-1.5 py-px text-2xs" : "px-2 py-0.5 text-2xs",
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot && (
        <span className={cx("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
      )}
      {icon && <Icon name={icon} size={11} />}
      {children}
    </span>
  );
}

/** A Badge you can click — filter chips, category toggles. */
export function Pill({
  children,
  active = false,
  onClick,
  icon,
  className = "",
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  icon?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors duration-[120ms] ease-cp",
        active
          ? "border-accent-line bg-accent-muted text-accent-soft"
          : "border-line bg-surface-2 text-ink-dim hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      {icon && <Icon name={icon} size={11} />}
      {children}
    </button>
  );
}

/** Status dot. `live` adds the slow expanding halo used for "running". */
export function StatusDot({
  tone = "neutral",
  live = false,
  size = 8,
  className = "",
}: {
  tone?: Tone;
  live?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "relative inline-block shrink-0 rounded-full",
        TONE_DOT[tone],
        live && "cp-halo",
        className,
      )}
      style={{ width: size, height: size, color: "currentColor" }}
    />
  );
}

/* ──────────────────────────────── Card ───────────────────────────────── */

/**
 * The single container primitive. Everything in a panel is a Card or lives
 * inside one — that's what makes eight very different tabs read as one app.
 *
 *   <Card title="Free tunnel" icon="signal" description="…" right={<Badge/>}>
 */
export function Card({
  title,
  icon,
  right,
  description,
  footer,
  children,
  className = "",
  pad = true,
  tone,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** false when the body is a list/table that should bleed to the edges */
  pad?: boolean;
  /** tints the border + header, for cards that carry a status */
  tone?: Tone;
}) {
  const toneRing =
    tone && tone !== "neutral"
      ? {
          accent: "border-accent-line",
          ok: "border-ok/30",
          warn: "border-warn/30",
          bad: "border-bad/30",
          info: "border-info/30",
        }[tone]
      : "border-line-soft";

  return (
    <section
      className={cx(
        "rounded-lg border bg-surface shadow-e1",
        toneRing,
        className,
      )}
    >
      {(title || right) && (
        <header
          className={cx(
            "flex items-center gap-2.5 px-3.5",
            description ? "pt-3 pb-2" : "py-2.5",
            children != null && "border-b border-line-soft",
          )}
        >
          {icon && (
            <span
              className={cx(
                "grid h-6 w-6 shrink-0 place-items-center rounded-md",
                tone && tone !== "neutral"
                  ? {
                      accent: "bg-accent-muted text-accent-soft",
                      ok: "bg-ok-muted text-ok-soft",
                      warn: "bg-warn-muted text-warn-soft",
                      bad: "bg-bad-muted text-bad-soft",
                      info: "bg-info-muted text-info-soft",
                    }[tone]
                  : "bg-surface-2 text-ink-faint",
              )}
            >
              {typeof icon === "string" ? <Icon name={icon} size={13} /> : icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {title && (
              <h3 className="truncate font-display text-sm font-semibold text-ink">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-0.5 text-2xs leading-snug text-ink-faint">
                {description}
              </p>
            )}
          </div>
          {right && <div className="flex shrink-0 items-center gap-1.5">{right}</div>}
        </header>
      )}
      {children != null && <div className={pad ? "p-3.5" : ""}>{children}</div>}
      {footer && (
        <footer className="flex items-center gap-2 border-t border-line-soft bg-surface-2/50 px-3.5 py-2.5">
          {footer}
        </footer>
      )}
    </section>
  );
}

/** Header for a group of cards, or a run of rows inside one. */
export function SectionHeader({
  title,
  hint,
  icon,
  right,
  className = "",
}: {
  title: ReactNode;
  hint?: ReactNode;
  icon?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] text-ink-faint">
          {icon && <Icon name={icon} size={12} />}
          {title}
        </h2>
        {hint && <p className="mt-1 text-2xs text-ink-faint">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

/* ─────────────────────────── form primitives ─────────────────────────── */

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <div className="mb-1.5 text-2xs font-medium text-ink-dim">{label}</div>
      {children}
      {error ? (
        <div className="mt-1.5 flex items-center gap-1 text-2xs text-bad">
          <Icon name="alert" size={11} />
          {error}
        </div>
      ) : (
        hint && <div className="mt-1.5 text-2xs leading-snug text-ink-faint">{hint}</div>
      )}
    </label>
  );
}

/**
 * One line in a settings list: icon · label · one-line help · control.
 * This is the shape that makes server.properties readable to a 14-year-old.
 */
export function SettingRow({
  icon,
  label,
  help,
  note,
  control,
  htmlFor,
  className = "",
}: {
  icon?: string;
  label: ReactNode;
  help?: ReactNode;
  note?: ReactNode;
  control: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-start gap-3 px-3.5 py-3 transition-colors duration-[120ms] hover:bg-surface-2/60",
        className,
      )}
    >
      {icon && (
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-faint">
          <Icon name={icon} size={14} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <label
          htmlFor={htmlFor}
          className="block text-sm font-medium leading-tight text-ink"
        >
          {label}
        </label>
        {help && (
          <p className="mt-1 text-2xs leading-snug text-ink-faint">{help}</p>
        )}
        {note && (
          <p className="mt-1 flex items-start gap-1 text-2xs leading-snug text-warn-soft">
            <Icon name="alert" size={11} className="mt-px shrink-0" />
            {note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center pt-0.5">{control}</div>
    </div>
  );
}

const INPUT_BASE =
  "w-full rounded-md border bg-surface-2 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-[120ms] ease-cp placeholder:text-ink-ghost disabled:cursor-not-allowed disabled:opacity-50";

export function TextInput({
  className = "",
  icon,
  suffix,
  invalid = false,
  mono = false,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  icon?: string;
  suffix?: ReactNode;
  invalid?: boolean;
  mono?: boolean;
}) {
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={cx(
        INPUT_BASE,
        "h-8 px-2.5",
        icon && "pl-8",
        !!suffix && "pr-16",
        mono && "font-mono text-xs",
        invalid
          ? "border-bad/60 focus:border-bad focus:shadow-[0_0_0_3px_var(--cp-bad-muted)]"
          : "border-line focus:border-accent focus:shadow-[0_0_0_3px_var(--cp-accent-muted)]",
        className,
      )}
      {...rest}
    />
  );
  if (!icon && !suffix) return input;
  return (
    <div className="relative min-w-0 flex-1">
      {icon && (
        <Icon
          name={icon}
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
      )}
      {input}
      {suffix && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-2xs text-ink-faint">
          {suffix}
        </div>
      )}
    </div>
  );
}

export function Textarea({
  className = "",
  mono = false,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return (
    <textarea
      className={cx(
        INPUT_BASE,
        "resize-none border-line p-2.5 leading-relaxed focus:border-accent focus:shadow-[0_0_0_3px_var(--cp-accent-muted)]",
        mono && "font-mono text-xs",
        className,
      )}
      {...rest}
    />
  );
}

/** Native <select> under our chrome — keeps OS type-ahead and keyboard nav. */
export function Select({
  className = "",
  size: _size,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cx(
          INPUT_BASE,
          "cp-select h-8 border-line pl-2.5 pr-8 focus:border-accent focus:shadow-[0_0_0_3px_var(--cp-accent-muted)]",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  className = "",
  "aria-label": ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cx("cp-range", className)}
      style={{ ["--cp-fill" as string]: `${pct}%` }}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  size = "md",
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** accessible name when the switch isn't next to a <label> */
  label?: string;
  id?: string;
}) {
  const w = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const knob = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const travel = size === "sm" ? "translate-x-3.5" : "translate-x-4";
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative shrink-0 rounded-full border transition-colors duration-[160ms] ease-cp disabled:cursor-not-allowed disabled:opacity-40",
        w,
        checked
          ? "border-transparent bg-accent"
          : "border-line bg-surface-3 hover:bg-surface-4",
      )}
    >
      <span
        className={cx(
          "absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-e1 transition-transform duration-[160ms] ease-cp",
          knob,
          checked ? travel : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  disabled,
  id,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-xs border transition-colors duration-[120ms] ease-cp disabled:cursor-not-allowed disabled:opacity-40",
        checked
          ? "border-accent bg-accent text-on-accent"
          : "border-line bg-surface-2 hover:border-line-strong",
      )}
    >
      {checked && <Icon name="check" size={12} strokeWidth={3} />}
    </button>
  );
}

/* ────────────────────────────── Tabs ─────────────────────────────────── */

export interface TabDef {
  id: string;
  label: string;
  icon?: string;
  /** small count/status chip rendered after the label */
  badge?: ReactNode;
}

/**
 * Underlined tabs with icons. Measures itself and folds anything that
 * doesn't fit into a "More ▾" menu, so 9 tabs survive a narrow window.
 * Arrow keys move between tabs (roving tabindex, WAI-ARIA pattern).
 */
export function Tabs({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(tabs.length);
  const [menuOpen, setMenuOpen] = useState(false);
  /* Measured widths, cached per tab id. Without the cache, a narrowed row
     would re-measure only the tabs still rendered, decide they all fit, and
     flip straight back to showing everything. */
  const widthsRef = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const measure = () => {
      // refresh the cache from whatever is currently on screen
      el.querySelectorAll<HTMLElement>("[data-tab]").forEach((n) => {
        const id = n.dataset.tab;
        if (id && n.offsetWidth) widthsRef.current[id] = n.offsetWidth;
      });

      const avail = el.clientWidth;
      if (!avail) return;

      const w = tabs.map((t) => widthsRef.current[t.id] ?? 96);
      const total = w.reduce((a, b) => a + b, 0);
      if (total <= avail) {
        setVisible(tabs.length);
        return;
      }

      // doesn't fit — reserve room for the "More ▾" button
      let used = 0;
      let n = 0;
      for (const x of w) {
        if (used + x > avail - 92) break;
        used += x;
        n++;
      }
      setVisible(Math.max(1, n));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs]);

  const shown = tabs.slice(0, visible);
  const hidden = tabs.slice(visible);
  const hiddenActive = hidden.find((t) => t.id === value);

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === value);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      onChange(tabs[next].id);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(tabs[0].id);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(tabs[tabs.length - 1].id);
    }
  }

  const tabCls = (active: boolean) =>
    cx(
      "-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium",
      "transition-colors duration-[120ms] ease-cp",
      active
        ? "border-accent text-ink"
        : "border-transparent text-ink-faint hover:border-line-strong hover:text-ink",
    );

  return (
    <div
      ref={wrapRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cx("relative flex items-center border-b border-line", className)}
    >
      {shown.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            data-tab={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={tabCls(active)}
          >
            {t.icon && <Icon name={t.icon} size={14} />}
            {t.label}
            {t.badge}
          </button>
        );
      })}

      {hidden.length > 0 && (
        <div className="relative -mb-px">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className={tabCls(!!hiddenActive)}
          >
            {hiddenActive ? (
              <>
                {hiddenActive.icon && <Icon name={hiddenActive.icon} size={14} />}
                {hiddenActive.label}
              </>
            ) : (
              <>More</>
            )}
            <Icon name="chevron-down" size={12} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="cp-pop absolute right-0 top-full z-40 mt-1 min-w-44 overflow-hidden rounded-lg border border-line bg-surface-2 p-1 shadow-e3"
              >
                {hidden.map((t) => (
                  <button
                    key={t.id}
                    role="menuitem"
                    onClick={() => {
                      onChange(t.id);
                      setMenuOpen(false);
                    }}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors duration-[120ms]",
                      t.id === value
                        ? "bg-accent-muted text-accent-soft"
                        : "text-ink-dim hover:bg-surface-3 hover:text-ink",
                    )}
                  >
                    {t.icon && <Icon name={t.icon} size={14} />}
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact 2–4 way switch. Live/Log, Basics/Advanced/Raw. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className = "",
}: {
  options: { value: T; label: ReactNode; icon?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx(
        "inline-flex shrink-0 rounded-md border border-line bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex items-center gap-1.5 rounded-sm font-medium transition-colors duration-[120ms] ease-cp",
              size === "sm" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-2xs",
              active
                ? "bg-surface-4 text-ink shadow-e1"
                : "text-ink-faint hover:text-ink",
            )}
          >
            {o.icon && <Icon name={o.icon} size={12} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────── Modal ────────────────────────────────── */

const MODAL_W = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

/**
 * Portal + scrim + focus trap + Esc. `onClose` is also wired to the scrim, so
 * pass undefined during an operation you don't want interrupted.
 */
export function Modal({
  open = true,
  onClose,
  title,
  description,
  icon,
  size = "md",
  footer,
  children,
  className = "",
}: {
  open?: boolean;
  onClose?: () => void;
  title?: ReactNode;
  description?: ReactNode;
  icon?: string;
  size?: keyof typeof MODAL_W;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // focus the first thing worth focusing inside the dialog
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]),select,textarea,button:not([disabled]),[tabindex]:not([tabindex='-1'])",
      );
      (el ?? panelRef.current)?.focus();
    }, 0);

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const f = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])",
        ),
      ).filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="cp-fade absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cx(
          "cp-pop relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-e3",
          MODAL_W[size],
          className,
        )}
      >
        {(title || onClose) && (
          <header className="flex items-start gap-3 border-b border-line-soft px-5 py-3.5">
            {icon && (
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-muted text-accent-soft">
                <Icon name={icon} size={16} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              {title && (
                <h2
                  id={titleId}
                  className="font-display text-base font-semibold text-ink"
                >
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-0.5 text-xs leading-snug text-ink-faint">
                  {description}
                </p>
              )}
            </div>
            {onClose && (
              <IconButton icon="x" title="Close" onClick={onClose} size="sm" />
            )}
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center gap-2 border-t border-line-soft bg-surface-2/60 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ────────────────────────────── Banner ───────────────────────────────── */

const BANNER_TONE: Record<Tone, { box: string; icon: string; glyph: string }> = {
  neutral: {
    box: "border-line bg-surface-2 text-ink-dim",
    icon: "text-ink-faint",
    glyph: "info",
  },
  accent: {
    box: "border-accent-line bg-accent-muted text-ink",
    icon: "text-accent",
    glyph: "sparkle",
  },
  ok: { box: "border-ok/30 bg-ok-muted text-ok-soft", icon: "text-ok", glyph: "check-circle" },
  warn: {
    box: "border-warn/30 bg-warn-muted text-warn-soft",
    icon: "text-warn",
    glyph: "alert",
  },
  bad: { box: "border-bad/30 bg-bad-muted text-bad-soft", icon: "text-bad", glyph: "alert-octagon" },
  info: { box: "border-info/30 bg-info-muted text-info-soft", icon: "text-info", glyph: "info" },
};

/** Inline status strip: EULA prompt, crash report, "restart to apply", offline. */
export function Banner({
  tone = "neutral",
  title,
  icon,
  children,
  actions,
  onDismiss,
  className = "",
}: {
  tone?: Tone;
  title?: ReactNode;
  icon?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const t = BANNER_TONE[tone];
  return (
    <div
      role="status"
      className={cx(
        "cp-in flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs",
        t.box,
        className,
      )}
    >
      <Icon
        name={icon ?? t.glyph}
        size={15}
        className={cx("mt-px shrink-0", t.icon)}
      />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <div className="font-medium text-ink">{title}</div>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      {onDismiss && (
        <IconButton icon="x" title="Dismiss" size="sm" onClick={onDismiss} />
      )}
    </div>
  );
}

/* ─────────────────── loading / empty / error / offline ───────────────── */

export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cx("cp-spin shrink-0", className)}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.22" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={cx("cp-skeleton rounded-md", className)} />;
}

export function ProgressBar({
  pct,
  indeterminate = false,
  className = "",
  tone = "accent",
}: {
  pct?: number | null;
  indeterminate?: boolean;
  className?: string;
  tone?: Tone;
}) {
  const fill = { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", info: "bg-info", neutral: "bg-ink-faint" }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(pct ?? 0)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cx(
        "relative h-1.5 overflow-hidden rounded-full bg-surface-3",
        indeterminate && "cp-indeterminate",
        className,
      )}
    >
      {!indeterminate && (
        <div
          className={cx("h-full rounded-full transition-[width] duration-300 ease-cp", fill)}
          style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
        />
      )}
    </div>
  );
}

/**
 * The "nothing here yet" screen. Always give it an action — no dead ends.
 * `art` draws a faint blocky glyph behind the icon for a little personality.
 */
export function EmptyState({
  icon = "package",
  title,
  children,
  action,
  secondaryAction,
  tone = "neutral",
  compact = false,
  className = "",
}: {
  icon?: string;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  tone?: Tone;
  compact?: boolean;
  className?: string;
}) {
  const ring = {
    neutral: "text-ink-faint",
    accent: "text-accent",
    ok: "text-ok",
    warn: "text-warn",
    bad: "text-bad",
    info: "text-info",
  }[tone];
  return (
    <div
      className={cx(
        "cp-in flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-6 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      <div className="relative">
        <div className="cp-pixels absolute -inset-3 rounded-xl opacity-40" />
        <div
          className={cx(
            "relative grid place-items-center rounded-xl border border-line-soft bg-surface-2",
            compact ? "h-10 w-10" : "h-14 w-14",
            ring,
          )}
        >
          <Icon name={icon} size={compact ? 18 : 24} />
        </div>
      </div>
      <h3
        className={cx(
          "font-display font-semibold text-ink",
          compact ? "text-sm" : "text-base",
        )}
      >
        {title}
      </h3>
      {children && (
        <p className="max-w-sm text-xs leading-relaxed text-ink-faint">{children}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

/**
 * One component for the four states every panel needs. Panels call this
 * instead of hand-rolling "Loading…" strings, which is what made the old UI
 * feel like a dev tool.
 */
export function StateBlock({
  state,
  title,
  message,
  onRetry,
  action,
  icon,
  compact,
}: {
  state: "loading" | "empty" | "error" | "offline";
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  action?: ReactNode;
  icon?: string;
  compact?: boolean;
}) {
  if (state === "loading") {
    return (
      <div
        className={cx(
          "flex items-center justify-center gap-2.5 text-xs text-ink-faint",
          compact ? "py-6" : "py-14",
        )}
      >
        <Spinner size={15} />
        {title ?? "Loading…"}
      </div>
    );
  }
  if (state === "error") {
    return (
      <EmptyState
        icon={icon ?? "alert-octagon"}
        tone="bad"
        compact={compact}
        title={title ?? "Something went wrong"}
        action={
          onRetry ? (
            <Button variant="secondary" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          ) : (
            action
          )
        }
      >
        {message}
      </EmptyState>
    );
  }
  if (state === "offline") {
    return (
      <EmptyState
        icon={icon ?? "cloud-off"}
        tone="warn"
        compact={compact}
        title={title ?? "Server isn't running"}
        action={action}
      >
        {message ?? "Start the server to see this."}
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={icon} compact={compact} title={title ?? "Nothing here yet"} action={action}>
      {message}
    </EmptyState>
  );
}

/* ───────────────────────────── Tooltip ───────────────────────────────── */

/**
 * Portal-positioned so it never gets clipped by an overflow container.
 * Shows on hover *and* focus, so keyboard users get the help text too.
 */
export function Tooltip({
  label,
  children,
  side = "top",
  className = "",
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const map = {
      top: { x: r.left + r.width / 2, y: r.top - 8 },
      bottom: { x: r.left + r.width / 2, y: r.bottom + 8 },
      left: { x: r.left - 8, y: r.top + r.height / 2 },
      right: { x: r.right + 8, y: r.top + r.height / 2 },
    };
    setPos(map[side]);
  }, [side]);

  const translate = {
    top: "translate(-50%, -100%)",
    bottom: "translate(-50%, 0)",
    left: "translate(-100%, -50%)",
    right: "translate(0, -50%)",
  }[side];

  return (
    <>
      <span
        ref={ref}
        className={cx("inline-flex", className)}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocusCapture={show}
        onBlurCapture={() => setPos(null)}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: pos.x, top: pos.y, transform: translate }}
            className="cp-fade pointer-events-none fixed z-[60] max-w-64 rounded-md border border-line bg-surface-3 px-2 py-1 text-2xs leading-snug text-ink shadow-e2"
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-line bg-surface-3 px-1 font-mono text-[10px] text-ink-dim">
      {children}
    </kbd>
  );
}

/* ──────────────────────────── CopyField ──────────────────────────────── */

/**
 * The join-address control. Big, monospace, one click to copy, and it says
 * "Copied" rather than silently succeeding — this is the thing users actually
 * came to the app for.
 */
export function CopyField({
  value,
  label,
  hint,
  size = "md",
  tone = "neutral",
  className = "",
}: {
  value: string;
  label?: string;
  hint?: ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: Tone;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function copy() {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className={className}>
      {label && (
        <div className="mb-1.5 text-2xs font-medium uppercase tracking-[0.06em] text-ink-faint">
          {label}
        </div>
      )}
      <div
        className={cx(
          "group flex items-center gap-2 rounded-lg border bg-surface-2 transition-colors duration-[120ms] ease-cp",
          size === "lg" ? "px-3 py-2.5" : size === "sm" ? "px-2 py-1" : "px-2.5 py-1.5",
          tone === "accent" ? "border-accent-line" : "border-line",
        )}
      >
        <code
          data-selectable
          className={cx(
            "min-w-0 flex-1 truncate font-mono text-ink",
            size === "lg" ? "text-base font-medium tracking-tight" : "text-xs",
          )}
        >
          {value}
        </code>
        <Button
          variant={size === "lg" ? "secondary" : "quiet"}
          size="sm"
          onClick={copy}
          icon={copied ? "check" : "copy"}
          className={copied ? "text-ok" : undefined}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {hint && <p className="mt-1.5 text-2xs leading-snug text-ink-faint">{hint}</p>}
    </div>
  );
}

/* ───────────────────────────── Toaster ───────────────────────────────── */

export interface ToastMsg {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
  /** ms; 0 keeps it until dismissed */
  duration?: number;
}

type Listener = (t: ToastMsg) => void;
const listeners = new Set<Listener>();
let toastSeq = 0;

/**
 * Module-level so any panel can fire one without prop-drilling a context:
 *   toast.ok("Port forwarded")   toast.bad("Couldn't reach the router", err)
 */
function push(tone: Tone, title: string, body?: string, duration = 4200) {
  const t: ToastMsg = { id: ++toastSeq, tone, title, body, duration };
  listeners.forEach((l) => l(t));
  return t.id;
}

export const toast = {
  show: (title: string, body?: string) => push("neutral", title, body),
  ok: (title: string, body?: string) => push("ok", title, body),
  warn: (title: string, body?: string) => push("warn", title, body),
  bad: (title: string, body?: string) => push("bad", title, body, 7000),
  info: (title: string, body?: string) => push("info", title, body),
  accent: (title: string, body?: string) => push("accent", title, body),
};

/** Mount once, near the root. */
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);

  useEffect(() => {
    const l: Listener = (t) => {
      setItems((prev) => [...prev.slice(-3), t]);
      if (t.duration) {
        setTimeout(
          () => setItems((prev) => prev.filter((x) => x.id !== t.id)),
          t.duration,
        );
      }
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  if (!items.length) return null;

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2">
      {items.map((t) => {
        const tone = BANNER_TONE[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            className={cx(
              "cp-toast pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface-2 px-3 py-2.5 shadow-e3",
              tone.box.replace(/bg-\S+/, ""),
            )}
          >
            <Icon
              name={tone.glyph}
              size={15}
              className={cx("mt-px shrink-0", tone.icon)}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-ink">{t.title}</div>
              {t.body && (
                <div className="mt-0.5 break-words text-2xs leading-snug text-ink-faint">
                  {t.body}
                </div>
              )}
            </div>
            <IconButton
              icon="x"
              title="Dismiss"
              size="sm"
              onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}
            />
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/* ─────────────── expert-mode context (Settings "Raw" gating) ─────────── */

export const ExpertContext = createContext(false);
export const useExpert = () => useContext(ExpertContext);

/* ─────────────────── shared modal keyboard behaviour ─────────────────── */

/**
 * Esc closes. `Modal` does this itself; the older hand-rolled dialogs call
 * this so every dialog in the app dismisses the same way.
 */
export function useDismissOnEscape(onClose: (() => void) | undefined) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}
