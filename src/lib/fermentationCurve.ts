/**
 * Sugar soft sensor — fermentation curve fit.
 *
 * Fits the batch's manual Brix tests to a first-order decay curve
 *   b(t) = floor + (b0 - floor) * e^(-k * (t - t0))
 * (the classic sugar-consumption shape; see spike report 2026-10-07).
 * Two parameters (k, floor) re-fit at every new log, so each test
 * self-corrects the estimate — no neural net needed for days-remaining.
 *
 * Pure math, no app imports, so `node scripts/checkCurve.ts` runs it
 * bare. Consumers supply the OG via resolveInitialBrix (abvFeatures).
 */

const DAY_MS = 86400000;
// ponytail: absurd-horizon guard, bignay cycle is ~25d; raise only if a real batch needs longer
const MAX_ETA_DAYS = 60;
// Minimum target−floor gap: ETA sensitivity is ~1/(k·gap) days per °Bx of
// floor error, so a smaller gap makes the answer grid-noise, not data.
const MIN_GAP_BRIX = 0.5;

export interface Point {
  t: number; // ms epoch
  brix: number;
}

export interface SugarCurve {
  t0: number; // ms epoch of first point
  b0: number; // brix at t0
  k: number; // decay constant, per day
  floor: number; // asymptotic brix floor, °Bx
}

type Num = unknown;

const finite = (v: Num): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Assemble curve points: day-0 (startedAt + OG) + every logged test. */
export function buildPoints(
  args: { startedAt?: Num; og?: Num; targetBrix?: Num },
  history: Record<string, { brix?: Num; time?: Num }> | null | undefined,
  current?: { brix?: Num; time?: Num; source?: Num } | null
): Point[] {
  const pts: Point[] = [];
  const startedAt = finite(args.startedAt);
  const og = finite(args.og);
  if (startedAt !== null && og !== null && og > 0) pts.push({ t: startedAt, brix: og });
  const add = (r?: { brix?: Num; time?: Num } | null) => {
    const brix = r ? finite(r.brix) : null;
    const t = r ? finite(r.time) : null;
    if (brix !== null && t !== null) pts.push({ t, brix });
  };
  if (history) for (const key of Object.keys(history)) add(history[key]);
  // The soft-sensor auto-log writes its own estimate into `current` for the
  // dashboard; feeding it back in would make the fit validate its own output.
  if (current?.source !== 'predicted') add(current);
  return pts.sort((a, b) => a.t - b.t);
}

export function estimateBrix(c: SugarCurve, atMs: number): number {
  return c.floor + (c.b0 - c.floor) * Math.exp(-c.k * ((atMs - c.t0) / DAY_MS));
}

/**
 * Grid-search the floor, closed-form least squares for k per candidate,
 * keep the lowest-MAE pair. Returns null when there is too little data
 * or the fit is garbage (>2 °Bx MAE) — callers fall back to their model.
 * The floor is a physical asymptote, so the fit never sees `targetBrix`
 * (only the done-batch guard uses it); daysToTarget does the abstaining.
 */
export function fitCurve(points: Point[], targetBrix: number): SugarCurve | null {
  if (points.length < 3) return null;
  const pts = points.slice().sort((a, b) => a.t - b.t);
  const t0 = pts[0].t;
  const b0 = pts[0].brix;
  if (!(b0 > targetBrix)) return null;

  const minBrix = Math.min(...pts.map((p) => p.brix));
  const floorHi = minBrix - 0.1;
  let best: SugarCurve | null = null;
  let bestMae = Infinity;

  for (let floor = 0.2; floor <= floorHi + 1e-9; floor += 0.1) {
    const usable = pts.filter((p) => p.brix > floor + 0.05);
    if (usable.length < 2) continue;
    let n = 0, st = 0, sy = 0, stt = 0, sty = 0;
    for (const p of usable) {
      const x = (p.t - t0) / DAY_MS;
      const y = Math.log(p.brix - floor);
      n++; st += x; sy += y; stt += x * x; sty += x * y;
    }
    const denom = n * stt - st * st;
    if (denom === 0) continue;
    const k = -(n * sty - st * sy) / denom;
    if (!(k > 0)) continue; // brix must fall
    const cand: SugarCurve = { t0, b0, k, floor };
    let mae = 0;
    for (const p of pts) mae += Math.abs(estimateBrix(cand, p.t) - p.brix);
    mae /= pts.length;
    if (mae < bestMae) { bestMae = mae; best = cand; }
  }
  return bestMae <= 2 ? best : null;
}

/**
 * Days from `nowMs` until the curve reaches `targetBrix`.
 * 0 = already there; null = abstain (asymptote too close to/above target,
 * or ETA beyond MAX_ETA_DAYS) — callers fall back to their model.
 */
export function daysToTarget(c: SugarCurve, targetBrix: number, nowMs: number): number | null {
  if (c.b0 <= targetBrix) return 0;
  const gap = targetBrix - c.floor;
  if (!(gap >= MIN_GAP_BRIX)) return null;
  const tDays = Math.log((c.b0 - c.floor) / gap) / c.k;
  const remaining = tDays - (nowMs - c.t0) / DAY_MS;
  if (remaining > MAX_ETA_DAYS) return null;
  return Math.max(0, remaining);
}

/** One-call soft sensor: assemble points + fit for the active batch. */
export function sugarCurve(
  args: { startedAt?: Num; og?: Num; targetBrix?: Num },
  history: Record<string, { brix?: Num; time?: Num }> | null | undefined,
  current?: { brix?: Num; time?: Num } | null
): SugarCurve | null {
  const targetBrix = finite(args.targetBrix) ?? 2;
  return fitCurve(buildPoints(args, history, current), targetBrix);
}
