/**
 * Single writer for batch lifecycle DB sequences (start + end).
 *
 * Both the Dashboard ("End Batch" / "Start Batch") and FermentationTracker
 * ("Complete Batch" / "New Batch") used to write these sequences themselves
 * and drifted apart: one stored starting Brix + AI accuracy + a sensor
 * archive, the other stored the *target* Brix as the achieved result and
 * archived nothing. Reports & Analytics reads `targetBrixAchieved` as the
 * FINAL reading (trend chart, quality distribution, exports), so the divergent
 * writer was plotting the target as if it were the measured outcome.
 *
 * Every sequence is a SINGLE multi-path `update(ref(db), {...})`, which RTDB
 * applies atomically. The old sequential `set` calls left windows where a
 * dropped connection produced duplicate history records (end) or an active
 * new batch still carrying the previous batch's readings (start).
 */

import { get, push, ref, update } from "firebase/database";
import type { Database } from "firebase/database";
import { predictAbvFromBrixDrop, resolveInitialBrix } from "./abvFeatures";
import { toPoints } from "./sensorFormat";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The four live sensor nodes a fresh batch must start from empty. */
const START_SENSOR_CLEARS = {
  "sensors/current": null,
  "sensors/sugar/current": null,
  "sensors/history": null,
  "sensors/sugar/history": null,
} as const;

interface BatchDetails {
  batchId?: unknown;
  startDate?: unknown;
  fruitsUsed?: unknown;
  initialVolume?: unknown;
  initialBrix?: unknown;
  /** Declared finish target; archived as `targetBrix` so the rubric can use it. */
  targetBrix?: unknown;
}

interface EndBatchInput {
  db: Database;
  details: BatchDetails | null;
  currentBrix: number | null;
  currentTemp: number | null;
  currentPh: number | null;
}

interface StartBatchInput {
  db: Database;
  volume: string;
  fruits: string;
  targetBrix: number;
  initialBrix: number;
  /** 0 for a batch started from the Dashboard, 10 once a first sort is done. */
  overallProgress: number;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fixed(value: number | null): string {
  return value !== null ? value.toFixed(1) : "Unknown";
}

/** 90% of the recorded must volume, e.g. "10L" → "9L". */
function computeFinalYield(initialVolume: unknown): string {
  const match = String(initialVolume ?? "0").match(/\d+/);
  const liters = match ? parseInt(match[0], 10) : 0;
  return liters > 0 ? `${Math.round(liters * 0.90)}L` : "Unknown";
}

/** Mean of a sensor history node (`{ time, value }` entries), or null when empty. */
function meanReading(value: unknown): number | null {
  const values = toPoints(value).map((p) => p.value);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sugarReadings(value: unknown): { brix: number; time: number }[] {
  if (!value) return [];
  const readings = Object.values(value) as { brix: number; time: number }[];
  readings.sort((a, b) => a.time - b.time);
  return readings;
}

/**
 * Score the AI's last live prediction (written by PredictiveInsights.tsx)
 * against what actually happened, so real-world model accuracy accumulates
 * over time instead of being assumed. Returns null when there is no usable
 * prediction or no measurable outcome.
 */
function scorePrediction(
  prediction: any,
  startingBrix: number | null,
  achievedBrix: number | null,
  targetBrix: number | null,
  completedAt: number
): Record<string, unknown> | null {
  if (!prediction || typeof prediction.capturedAt !== "number") return null;

  const actualDaysFromPrediction = Math.max(0, Math.round((completedAt - prediction.capturedAt) / DAY_MS));
  const daysError = actualDaysFromPrediction - (prediction.predictedDaysRemaining ?? 0);

  const predictedQualityGrade: "premium" | "good" | "standard" =
    prediction.predictedQualityPercent >= 85 ? "premium" : prediction.predictedQualityPercent >= 70 ? "good" : "standard";

  // Grade the RESULT against the batch's own declared target. A dry-wine band
  // (13-18 Bx) scored every bignay batch that hit its 2.0-2.6 target as
  // "below", so qualityMatch could never be true.
  let actualQualityGrade: "premium" | "above" | "below" | "unknown" = "unknown";
  if (achievedBrix !== null && targetBrix !== null) {
    if (Math.abs(achievedBrix - targetBrix) <= 0.5) actualQualityGrade = "premium";
    else if (achievedBrix > targetBrix) actualQualityGrade = "below"; // stopped early
    else actualQualityGrade = "above"; // overshot
  }

  const qualityMatch =
    actualQualityGrade !== "unknown" &&
    ((predictedQualityGrade === "premium" && actualQualityGrade === "premium") ||
      (predictedQualityGrade === "good" && actualQualityGrade !== "below") ||
      (predictedQualityGrade === "standard" && actualQualityGrade !== "premium"));

  // Skip ABV scoring when the sugar drop isn't positive: a final reading at or
  // above OG means bad inputs (wrong OG or an inflated refractometer), and
  // scoring that 0% against the prediction would poison the accuracy log.
  const actualAbv =
    startingBrix !== null && achievedBrix !== null && startingBrix - achievedBrix > 0.5
      ? predictAbvFromBrixDrop(startingBrix, achievedBrix)
      : null;
  const predictedAbv = numeric(prediction.predictedAbv);
  const abvError = predictedAbv !== null && actualAbv !== null ? actualAbv - predictedAbv : null;

  return {
    predictedAt: prediction.capturedAt,
    predictedDaysRemaining: prediction.predictedDaysRemaining ?? null,
    actualDaysFromPrediction,
    daysError,
    predictedQualityPercent: prediction.predictedQualityPercent ?? null,
    predictedQualityGrade,
    actualQualityGrade,
    qualityMatch,
    predictedRiskPercent: prediction.predictedRiskPercent ?? null,
    predictedAbv,
    actualAbv,
    abvError,
  };
}

/**
 * Records a new active batch and clears the live sensor state in one atomic
 * write, so a new batch never displays the previous batch's readings and
 * `endBatch` never archives them under the new key.
 * Throws if the write fails (callers surface it — a half-applied start is
 * worse than a visible error).
 */
export async function startBatch({
  db,
  volume,
  fruits,
  targetBrix,
  initialBrix,
  overallProgress,
}: StartBatchInput): Promise<void> {
  const startDate = new Date().toLocaleDateString();

  await update(ref(db), {
    "fermentation/currentBatch": {
      details: {
        batchId: `Batch #${Date.now().toString().slice(-4)}`,
        overallProgress,
        initialVolume: `${volume}L`,
        fruitsUsed: `${fruits}kg`,
        targetBrix,
        initialBrix,
        startDate,
        startedAt: Date.now(), // numeric timestamp, used to schedule the first sugar-test reminder
      },
      stages: [
        { id: 1, name: "Sorting", status: "completed", date: startDate },
        { id: 2, name: "Fermentation", status: "active", date: startDate, progress: 0 },
        { id: 3, name: "Filtration", status: "pending", date: "TBD" },
        { id: 4, name: "Harvest", status: "pending", date: "TBD" },
      ],
    },
    ...START_SENSOR_CLEARS,
  });
}

/**
 * Archives the active batch and clears the live sensor state in one atomic
 * write: the summary record, the raw time series under the SAME key (so the ML
 * pipeline can join them directly), then the live batch + sensor nodes.
 * Resolves with the history key that was written; throws if the write fails.
 */
export async function endBatch({
  db,
  details,
  currentBrix,
  currentTemp,
  currentPh,
}: EndBatchInput): Promise<string | null> {
  // Read the raw per-reading series BEFORE anything is cleared. Without the
  // archive only coarse averages survive, and this is the last point where
  // the batch's trend data exists.
  const [phSnap, tempSnap, pressureSnap, sugarSnap, predictionSnap, targetSnap] = await Promise.all([
    get(ref(db, "sensors/history/ph")),
    get(ref(db, "sensors/history/temperature")),
    get(ref(db, "sensors/history/pressurePSI")),
    get(ref(db, "sensors/sugar/history")),
    get(ref(db, "fermentation/currentBatch/aiPrediction")),
    // The declared target lives in the node this write clears, so it has to be
    // captured here — without it the accuracy log has nothing to grade against.
    get(ref(db, "fermentation/currentBatch/details/targetBrix")),
  ]);

  const sugarHistoryVal = sugarSnap.exists() ? sugarSnap.val() : null;
  const readings = sugarReadings(sugarHistoryVal);

  // Original Gravity: prefer the OG captured by the Start Batch form, fall back
  // to the earliest logged sugar test for batches started before OG capture.
  let startingBrix = resolveInitialBrix(details);
  if (startingBrix === null && readings.length > 0) {
    startingBrix = numeric(readings[0].brix);
  }

  // Final Brix: the live reading when present, otherwise the most recent logged
  // sugar test — the current node is cleared on start, so a batch that started
  // with no reading still reports a measured result instead of "Unknown".
  const achievedBrix = currentBrix ?? (readings.length > 0 ? numeric(readings[readings.length - 1].brix) : null);

  const completedAt = Date.now();
  const batchId = typeof details?.batchId === "string" && details.batchId !== "" ? details.batchId : "Legacy Batch";
  const targetBrix = numeric(targetSnap.exists() ? targetSnap.val() : null) ?? numeric(details?.targetBrix);
  const aiAccuracy = scorePrediction(
    predictionSnap.exists() ? predictionSnap.val() : null,
    startingBrix,
    achievedBrix,
    targetBrix,
    completedAt
  );

  // push() only allocates the key; the write itself happens in the update below.
  const historyKey = push(ref(db, "fermentation/history")).key;
  if (!historyKey) throw new Error("Could not allocate a history key");

  await update(ref(db), {
    [`fermentation/history/${historyKey}`]: {
      batchId,
      startDate: (details?.startDate as string) || "Unknown Date",
      completedAt,
      finalYield: computeFinalYield(details?.initialVolume),
      fruitsUsed: (details?.fruitsUsed as string) || "Unknown",
      // Achieved (measured) Brix — NOT the target. Reports & Analytics plots
      // this as "Final Brix" and grades quality from it.
      targetBrixAchieved: fixed(achievedBrix),
      // The target the operator declared at Start Batch — the other half of the
      // accuracy loop (achieved vs declared).
      targetBrix: fixed(targetBrix),
      startingBrix: fixed(startingBrix),
      // Means over the archived series, not the last live reading (a single
      // sample at end of batch says nothing about the batch's environment).
      averageTemp: fixed(meanReading(tempSnap.exists() ? tempSnap.val() : null) ?? currentTemp),
      averagePh: (() => {
        const mean = meanReading(phSnap.exists() ? phSnap.val() : null) ?? currentPh;
        return mean !== null ? mean.toFixed(1) : "N/A";
      })(),
      ...(aiAccuracy ? { aiAccuracy } : {}),
    },
    [`sensorArchive/${historyKey}`]: {
      ph: phSnap.exists() ? phSnap.val() : null,
      temperature: tempSnap.exists() ? tempSnap.val() : null,
      pressurePSI: pressureSnap.exists() ? pressureSnap.val() : null,
      sugarHistory: sugarHistoryVal,
    },
    "fermentation/currentBatch": null,
    "sensors/history": null,
    "sensors/sugar/history": null,
  });

  return historyKey;
}