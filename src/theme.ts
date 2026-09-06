/**
 * The app's selectable themes — swatch colors here are just for the picker
 * UI; the actual palettes live in index.css as `:root[data-theme="…"]`
 * blocks. Applying one is a single attribute set (see `applyTheme`), so a
 * switch is instant and needs no rebuild or restart.
 */
export interface ThemeDef {
  id: string;
  label: string;
  /** Free for everyone; the rest are Premium-gated in the Settings UI. */
  premium: boolean;
  swatch: { bg: string; surface: string; accent: string };
}

export const THEMES: ThemeDef[] = [
  {
    id: "dark",
    label: "Dark",
    premium: false,
    swatch: { bg: "#0d0c0f", surface: "#1c1b21", accent: "#ff8c00" },
  },
  {
    id: "light",
    label: "Light",
    premium: true,
    swatch: { bg: "#f6f5f4", surface: "#ffffff", accent: "#d97400" },
  },
  {
    id: "midnight",
    label: "Midnight",
    premium: true,
    swatch: { bg: "#0a0e17", surface: "#161c28", accent: "#3ea6ff" },
  },
  {
    id: "sunset",
    label: "Sunset",
    premium: true,
    swatch: { bg: "#150a12", surface: "#271521", accent: "#ff4fa3" },
  },
];

/** "" (AppSettings' zero value) and "dark" are the same theme. */
export function normalizeThemeId(id: string): string {
  return id || "dark";
}

export function applyTheme(id: string): void {
  document.documentElement.dataset.theme = normalizeThemeId(id);
}
