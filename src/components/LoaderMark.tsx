/**
 * Abstract marks for the five server flavours. Deliberately *not* the projects'
 * real logos — these are simple geometric glyphs in each project's rough colour
 * family, so the picker reads as a set and stays trademark-clean.
 */
import type { Loader } from "../types";

const MARKS: Record<Loader, { bg: string; fg: string; art: React.ReactNode }> = {
  vanilla: {
    bg: "#2f5d34",
    fg: "#8bd18f",
    art: (
      <>
        <rect x="7" y="14" width="18" height="11" rx="1.5" fill="#7a5236" />
        <rect x="7" y="9" width="18" height="6" rx="1.5" fill="#4f9c53" />
        <rect x="10" y="17" width="3" height="3" fill="#00000033" />
        <rect x="18" y="20" width="3" height="3" fill="#00000033" />
      </>
    ),
  },
  paper: {
    bg: "#2a3550",
    fg: "#9fb6e8",
    art: (
      <>
        <path d="M9 6h10l5 5v15H9z" fill="#e8ecf5" />
        <path d="M19 6l5 5h-5z" fill="#a9b6d0" />
        <path d="M12 14h9M12 18h9M12 22h6" stroke="#6b7a9c" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  fabric: {
    bg: "#4a3d24",
    fg: "#dcc48a",
    art: (
      <>
        <path d="M8 10h16v12H8z" fill="#c9ad74" />
        <path d="M8 13h16M8 16h16M8 19h16" stroke="#8a7346" strokeWidth="1.4" />
        <path d="M12 10v12M16 10v12M20 10v12" stroke="#e3ceA0" strokeWidth="1.4" />
      </>
    ),
  },
  neoforge: {
    bg: "#4a3212",
    fg: "#f0a94a",
    art: (
      <>
        <path d="M7 18h18l-3 6H10z" fill="#d98324" />
        <path d="M9 12h14v6H9z" fill="#f0a94a" />
        <path d="M13 7h6v5h-6z" fill="#8a561a" />
      </>
    ),
  },
  forge: {
    bg: "#2c3138",
    fg: "#a9b4c2",
    art: (
      <>
        <path d="M6 17h20l-3.5 7h-13z" fill="#6b7684" />
        <path d="M9 11h14v6H9z" fill="#98a3b2" />
        <path d="M14 6h4v5h-4z" fill="#4a525c" />
      </>
    ),
  },
};

export function LoaderMark({
  loader,
  size = 40,
}: {
  loader: Loader;
  size?: number;
}) {
  const m = MARKS[loader];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className="shrink-0 rounded-lg"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill={m.bg} />
      {m.art}
    </svg>
  );
}
