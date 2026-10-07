// Runnable check for the sugar soft sensor (src/lib/fermentationCurve.ts).
// Run: node scripts/checkCurve.ts   (Node >= 23 strips types natively)
import assert from 'node:assert/strict';
import {
  buildPoints, fitCurve, estimateBrix, daysToTarget, sugarCurve,
} from '../src/lib/fermentationCurve.ts';

const DAY = 86400000;
const T0 = Date.UTC(2026, 6, 24); // fixed epoch

// Generate a clean daily series from a known curve (no noise).
const series = (c: { t0: number; b0: number; k: number; floor: number }, days: number) =>
  Array.from({ length: days + 1 }, (_, d) => ({
    t: c.t0 + d * DAY,
    brix: estimateBrix(c, c.t0 + d * DAY),
  }));

// --- 1. Synthetic recovery: known k/floor must come back out of noisy points
const trueCurve = { t0: T0, b0: 30, k: 0.14, floor: 2 };
const points = [];
for (let d = 0; d <= 23; d++) {
  const noise = [0, 0.08, -0.06, 0.05, -0.04][d % 5]; // deterministic ±0.08
  points.push({ t: T0 + d * DAY, brix: estimateBrix(trueCurve, T0 + d * DAY) + noise });
}
const fit = fitCurve(points, 3);
assert.ok(fit, 'fit should succeed on dense synthetic curve');
assert.ok(Math.abs(fit.k - 0.14) < 0.03, `k recovered as ${fit.k.toFixed(3)}, want ~0.14`);
assert.ok(Math.abs(fit.floor - 2) < 1.0, `floor recovered as ${fit.floor.toFixed(2)}, want ~2`);
let mae = 0;
for (const p of points) mae += Math.abs(estimateBrix(fit, p.t) - p.brix);
mae /= points.length;
assert.ok(mae < 0.3, `fit MAE ${mae.toFixed(3)} too high`);

// daysToTarget: from day 5, analytic vs fitted (target 3 keeps a healthy gap)
const dAnalytic = Math.log((30 - 2) / (3 - 2)) / 0.14 - 5;
const dFitted = daysToTarget(fit, 3, T0 + 5 * DAY);
assert.ok(dFitted !== null && Math.abs(dFitted - dAnalytic) < 5, `daysToTarget ${dFitted} vs analytic ${dAnalytic.toFixed(1)}`);

// --- 2. Sparse honest logs: OG + two early tests must already give an ETA
// (data generated from floor 1.0 / k 0.08, so the target 2 is genuinely reachable)
const sparse = sugarCurve(
  { startedAt: T0, og: 29.3, targetBrix: 2 },
  { a: { brix: 23.3, time: T0 + 3 * DAY }, b: { brix: 18.5, time: T0 + 6 * DAY } },
  null
);
assert.ok(sparse, '3-point honest fit should succeed');
assert.ok(sparse.k > 0.02 && sparse.k < 0.3, `sparse k=${sparse.k.toFixed(3)} plausible`);
const daysMid = daysToTarget(sparse, 2, T0 + 6 * DAY);
assert.ok(daysMid !== null && daysMid > 10, `mid-batch ETA ${daysMid} should be positive`);
assert.equal(daysToTarget(sparse, 2, T0 + 400 * DAY), 0, 'long-past batch is due now');

// --- 2b. Contradictory backfill data (brix rises between stored times)
// must be rejected -> null, so callers keep their model fallback.
assert.equal(
  sugarCurve(
    { startedAt: T0, og: 29.3, targetBrix: 2 },
    { a: { brix: 28.8, time: T0 + 16 * DAY }, b: { brix: 20, time: T0 + 30 * DAY } },
    { brix: 1.4, time: T0 + 30 * DAY }
  ),
  null,
  'garbage-fit data must fall back'
);

// --- 3. Too little data -> null (callers fall back to the model)
assert.equal(fitCurve(points.slice(0, 2), 2.5), null, '2 points must not fit');
assert.equal(
  sugarCurve({ startedAt: T0, og: 1.5, targetBrix: 2 }, null, null),
  null,
  'OG below target must not fit'
);

// --- 4. Point assembly: junk skipped, day-0 prepended, sorted
const assembled = buildPoints(
  { startedAt: T0, og: 30 },
  { x: { brix: 22, time: T0 + 7 * DAY }, bad: { brix: 'junk' }, worse: { time: NaN } },
  { brix: 15, time: T0 + 14 * DAY }
);
assert.equal(assembled.length, 3, 'only finite pairs + OG survive');
assert.deepEqual(assembled.map((p) => p.t), [T0, T0 + 7 * DAY, T0 + 14 * DAY], 'sorted, OG first');

// --- 5. estimateBrix anchors at b0 and decays
assert.equal(estimateBrix(fit, T0), 30, 'b0 anchor');
assert.ok(estimateBrix(fit, T0 + 30 * DAY) < estimateBrix(fit, T0 + 10 * DAY), 'monotonic decay');

// --- 6. Abstain when the asymptote is within 0.5 °Bx of the target
// (ETA hypersensitive to floor error) — fit succeeds, daysToTarget says null.
const nearFloor = fitCurve(series({ t0: T0, b0: 29.3, k: 0.14, floor: 2.3 }, 21), 2.5);
assert.ok(nearFloor, 'near-floor data still fits');
assert.equal(daysToTarget(nearFloor, 2.5, T0 + 21 * DAY), null, 'gap < 0.5 must abstain');

// --- 7. Abstain when the asymptote sits ABOVE the target (never reaches it)
// — the exact archived-batch shape (seeder floor ~3.2, target 2.0-2.6).
const aboveTarget = fitCurve(series({ t0: T0, b0: 30, k: 0.14, floor: 3.2 }, 21), 2.5);
assert.ok(aboveTarget, 'above-target data still fits');
assert.equal(daysToTarget(aboveTarget, 2.5, T0 + 21 * DAY), null, 'asymptote above target must abstain');

// --- 8. Abstain on absurd horizons (tiny k -> ETA beyond MAX_ETA_DAYS)
const slow = fitCurve(series({ t0: T0, b0: 30, k: 0.005, floor: 0.5 }, 10), 2);
assert.ok(slow, 'slow-decay data still fits');
assert.equal(daysToTarget(slow, 2, T0 + 10 * DAY), null, 'ETA > 60 days must abstain');

console.log('checkCurve: all assertions passed');
