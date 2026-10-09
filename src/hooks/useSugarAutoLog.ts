import { useEffect } from "react";
import { get, ref, set } from "firebase/database";

import { db } from "../lib/firebase";
import { resolveInitialBrix } from "../lib/abvFeatures";
import { estimateBrix, sugarCurve } from "../lib/fermentationCurve";
import { toFiniteNumber } from "../lib/num";

/** Cadence shared by the soft-sensor auto-log and the ABV prediction writes. */
export const ABV_PREDICTION_INTERVAL_MS = 15 * 60 * 1000;

const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Soft-sensor auto-log — app-wide, not screen-scoped.
 *
 * When the last manual Brix test is stale (>24h) or missing, writes the
 * curve-fit estimate to `sensors/sugar/current` so the dashboard and the ABV
 * estimate keep updating without manual logging. Manual readings always win:
 * the write is skipped if one lands while this runs, and neither the curve
 * fit nor the history archive ever consumes a `source: 'predicted'` value.
 */
async function autoLogPredictedBrix(): Promise<void> {
  if (!db) return;

  const batchSnap = await get(ref(db, "fermentation/currentBatch/details"));
  const details = batchSnap.exists() ? batchSnap.val() : null;
  const startedAt = toFiniteNumber(details?.startedAt);
  if (startedAt === null || startedAt <= 0) return;

  const sugarSnap = await get(ref(db, "sensors/sugar/current"));
  const current = sugarSnap.exists() ? sugarSnap.val() : null;
  const lastTime = toFiniteNumber(current?.time);
  if (lastTime !== null && Date.now() - lastTime <= STALE_MS) return;

  const histSnap = await get(ref(db, "sensors/sugar/history"));
  const curve = sugarCurve(
    { startedAt, og: resolveInitialBrix(details), targetBrix: details?.targetBrix },
    histSnap.exists() ? histSnap.val() : null,
    current
  );
  if (!curve) return;

  const predicted = estimateBrix(curve, Date.now());
  if (!Number.isFinite(predicted) || predicted < 0 || predicted > 60) return;

  // A manual log may have landed during the reads above — it wins.
  const checkSnap = await get(ref(db, "sensors/sugar/current"));
  const checkTime = checkSnap.exists() ? toFiniteNumber(checkSnap.val()?.time) : null;
  if (checkTime !== lastTime) return;

  await set(ref(db, "sensors/sugar/current"), {
    brix: Math.round(predicted * 10) / 10,
    time: Date.now(),
    source: "predicted",
    instrument: "soft-sensor",
  });
}

/** Keeps the live Brix reading fresh between manual tests. Mount app-wide. */
export function useSugarAutoLog(): void {
  useEffect(() => {
    if (!db) return;
    const run = () => {
      void autoLogPredictedBrix().catch((e) =>
        console.error("Auto-log predicted Brix failed:", e)
      );
    };
    run();
    const id = setInterval(run, ABV_PREDICTION_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
