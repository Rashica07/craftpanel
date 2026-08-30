/**
 * The CraftPanel lockup: a pixel-cut "block" mark next to the wordmark.
 * The mark is the only place the Minecraft reference is literal — it's built
 * from square corners on purpose, so the rest of the chrome can stay round
 * and calm.
 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id="cp-mark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cp-accent-hover)" />
          <stop offset="100%" stopColor="var(--cp-accent-press)" />
        </linearGradient>
      </defs>
      {/* isometric block, drawn as three flat faces — no gradients on the sides
          so it reads as a logo rather than an illustration */}
      <path d="M16 3 28 9v14l-12 6-12-6V9z" fill="url(#cp-mark)" />
      <path d="M16 3 28 9l-12 6L4 9z" fill="var(--cp-accent-hover)" />
      <path d="M4 9v14l12 6V15z" fill="#00000038" />
      {/* two "pixels" punched out of the top face */}
      <path d="M13 8.5h3.2v1.7H13zM18 11h3.2v1.7H18z" fill="#ffffff5c" />
    </svg>
  );
}

export function Wordmark({
  size = 26,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      <span
        className="cp-display leading-none text-ink"
        style={{ fontSize: size * 0.62 }}
      >
        Craft<span className="text-accent">Panel</span>
      </span>
    </div>
  );
}
