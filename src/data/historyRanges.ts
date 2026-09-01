/** Shared 24h/7d/30d presets for the player-activity and metrics-history
 * charts — same ranges, so picking one on one chart reads consistently
 * against the other. `bucketSecs` is chosen per range so each chart draws
 * a sane number of points (24-30ish), not one point per raw sample. */
export type HistoryRange = "24h" | "7d" | "30d";

export const HISTORY_RANGES: { value: HistoryRange; label: string; spanSecs: number; bucketSecs: number }[] = [
  { value: "24h", label: "24h", spanSecs: 24 * 3600, bucketSecs: 3600 },
  { value: "7d", label: "7d", spanSecs: 7 * 86400, bucketSecs: 6 * 3600 },
  { value: "30d", label: "30d", spanSecs: 30 * 86400, bucketSecs: 86400 },
];

export function rangeFor(r: HistoryRange) {
  return HISTORY_RANGES.find((x) => x.value === r) ?? HISTORY_RANGES[0];
}
