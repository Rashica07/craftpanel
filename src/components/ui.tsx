import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "danger" | "subtle";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-black font-semibold hover:bg-accent-hover disabled:opacity-40",
  ghost:
    "bg-transparent border border-edge text-ink hover:bg-panel-3 disabled:opacity-40",
  danger:
    "bg-transparent border border-bad/40 text-bad hover:bg-bad/10 disabled:opacity-40",
  subtle: "bg-panel-3 text-ink hover:bg-edge disabled:opacity-40",
};

export function Button({
  variant = "ghost",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
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
    ok: "bg-ok/10 text-ok border-ok/30",
    warn: "bg-warn/10 text-warn border-warn/30",
    bad: "bg-bad/10 text-bad border-bad/30",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
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
      className={`w-full rounded-md border border-edge bg-panel-2 px-3 py-1.5 text-sm text-ink outline-none focus:border-accent ${className}`}
      {...rest}
    />
  );
}
