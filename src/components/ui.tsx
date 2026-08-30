import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger" | "subtle";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-black font-semibold btn-bevel hover:bg-accent-hover active:bg-accent-press disabled:opacity-40",
  ghost:
    "bg-panel-2 border border-edge text-ink hover:bg-panel-3 hover:border-edge disabled:opacity-40",
  danger:
    "bg-panel-2 border border-bad/40 text-bad hover:bg-bad/10 disabled:opacity-40",
  subtle: "bg-panel-3 text-ink hover:bg-edge disabled:opacity-40",
};

export function Button({
  variant = "ghost",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex select-none items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "ok" | "warn" | "bad";
}) {
  const tones = {
    neutral: "bg-panel-3 text-ink-dim border-edge",
    accent: "bg-accent-muted text-accent border-accent/30",
    ok: "bg-ok/12 text-ok border-ok/30",
    warn: "bg-warn/12 text-warn border-warn/30",
    bad: "bg-bad/12 text-bad border-bad/30",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A framed panel section with an optional icon + title. */
export function Card({
  title,
  icon,
  right,
  children,
  className = "",
}: {
  title?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-edge-soft bg-panel shadow-[inset_0_1px_0_#ffffff08] ${className}`}
    >
      {title && (
        <header className="flex items-center gap-2 border-b border-edge-soft px-3 py-2">
          {icon && <span className="text-ink-faint">{icon}</span>}
          <h3 className="flex-1 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            {title}
          </h3>
          {right}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </label>
  );
}

export function TextInput({
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-edge bg-panel-2 px-3 py-1.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent ${className}`}
      {...rest}
    />
  );
}

/** iOS-style switch. */
export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? "bg-accent" : "bg-panel-3"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
