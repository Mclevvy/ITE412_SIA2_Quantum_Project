/**
 * Shared sensor formatting helpers (pure, no Firebase, no React).
 *
 * `toPoints` / `formatTime` were byte-identical in Dashboard.tsx and the
 * (now deleted, zero-importer) useSensor hook — one copy lives here now.
 *
 * NOTE: alert/scaling bands are intentionally NOT shared. The temp band on
 * the Dashboard (25–32 °C, wine-must operating window) disagrees with the
 * TF-model normalization range in FermentationTracker / PredictiveInsights
 * (15–40 °C). Those numbers stay screen-local; unifying them would silently
 * change alert thresholds. See the Phase-3 report for details.
 */

export type Point = { time: number; value: number };

export function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function toPoints(obj: any): Point[] {
  if (!obj) return [];
  return Object.values(obj)
    .map((x: any) => ({ time: Number(x.time), value: Number(x.value) }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
}

/** Sugar history rows store the reading under `brix`, not `value`. */
export function toSugarHistoryPoints(obj: any): Point[] {
  if (!obj) return [];
  return Object.values(obj)
    .map((x: any) => ({ time: Number(x.time), value: Number(x.brix) }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
}

export function getStatus(value: number | null, min: number, max: number): "Normal" | "Alert" | "No Data" {
  if (value == null) return "No Data";
  if (value >= min && value <= max) return "Normal";
  return "Alert";
}

export function badgeClass(status: string) {
  if (status === "Normal" || status === "On track") return "border-green-500 text-green-600 text-xs";
  if (status === "Alert" || status === "Check OG") return "border-red-500 text-red-600 text-xs";
  return "border-gray-300 text-gray-600 text-xs";
}

// Batch-relative sugar status. Fixed bands (e.g. 14-18) penalize normal
// fermentation, which must fall from OG toward the finish target — so a
// falling reading is "On track", and only a reading above OG (bad data:
// wrong OG or inflated instrument) is flagged.
export function getBrixStatus(
  current: number | null,
  og: number | null,
  batchActive: boolean
): "On track" | "Check OG" | "No Data" {
  if (!batchActive || current === null) return "No Data";
  if (og !== null && current - og > 0.5) return "Check OG";
  return "On track";
}
