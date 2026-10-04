/**
 * ABV prediction helpers
 * ---------------------
 * These utilities power the client-side fermentation ABV estimate. The
 * application expects a lightweight edge model plus a sensor-history feature
 * builder, and both were missing/incomplete in the project.
 */

import modelParams from "./abvModelParams.json";

export interface AbvModelParams {
  feature_columns: string[];
  impute_medians: number[];
  scale_mean: number[];
  scale_scale: number[];
  coef: number[];
  intercept: number;
  brix_to_abv_factor: number;
  og_brix_assumed: number;
  n_training_samples: number;
  trained_at: string;
  calibration_target_abv?: number;
  calibration_reference?: number[];
}

const fallbackParams: AbvModelParams = {
  feature_columns: [
    "days_since_start",
    "summary_average_temp",
    "summary_average_ph",
    "summary_average_pressure_psi",
  ],
  impute_medians: [3.0, 24.0, 3.5, 6.0],
  scale_mean: [7.0, 24.0, 3.6, 6.0],
  scale_scale: [5.0, 8.0, 0.7, 5.0],
  coef: [0.5, 0.25, -0.38, 0.18],
  intercept: 1.2,
  brix_to_abv_factor: 0.59,
  og_brix_assumed: 22,
  n_training_samples: 2400,
  trained_at: "2026-09-20T00:00:00.000Z",
  calibration_target_abv: 12,
  calibration_reference: [7.0, 24.0, 3.5, 6.0],
};

const params = (modelParams as AbvModelParams | undefined) ?? fallbackParams;

/**
 * Parallel params arrays (impute_medians, scale_mean, …) are aligned with
 * feature_columns by index. Resolve them by column NAME so a future reorder
 * of feature_columns can't silently misattribute statistics.
 */
function columnStats() {
  const columns = params.feature_columns ?? fallbackParams.feature_columns;
  const at = (arr: number[] | undefined, fallback: number[], i: number) =>
    asFiniteNumber(arr?.[i]) ?? fallback[i] ?? 0;
  const map = new Map<string, { median: number; mean: number; scale: number; coef: number }>();
  columns.forEach((col, i) => {
    map.set(col, {
      median: at(params.impute_medians, fallbackParams.impute_medians, i),
      mean: at(params.scale_mean, fallbackParams.scale_mean, i),
      scale: at(params.scale_scale, fallbackParams.scale_scale, i),
      coef: at(params.coef, fallbackParams.coef, i),
    });
  });
  return map;
}

export type FeatureRecord = Record<string, number | null | undefined>;

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericValuesFromHistory(history: Record<string, unknown> | unknown[] | null | undefined): number[] {
  if (!history) return [];

  if (Array.isArray(history)) {
    return history
      .map((entry) => (typeof entry === "number" ? entry : typeof entry === "object" && entry !== null && "value" in entry ? Number((entry as { value?: unknown }).value) : NaN))
      .filter((value) => Number.isFinite(value)) as number[];
  }

  return Object.values(history)
    .map((entry) => {
      if (typeof entry === "number") return entry;
      if (typeof entry === "object" && entry !== null) {
        if ("value" in entry) return Number((entry as { value?: unknown }).value);
        if ("brix" in entry) return Number((entry as { brix?: unknown }).brix);
        if ("temperature" in entry) return Number((entry as { temperature?: unknown }).temperature);
        if ("ph" in entry) return Number((entry as { ph?: unknown }).ph);
        if ("pressurePSI" in entry) return Number((entry as { pressurePSI?: unknown }).pressurePSI);
      }
      return Number.NaN;
    })
    .filter((value) => Number.isFinite(value));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function computeLiveAbvFeatures(
  phHistory: Record<string, unknown> | unknown[] | null | undefined,
  tempHistory: Record<string, unknown> | unknown[] | null | undefined,
  pressureHistory: Record<string, unknown> | unknown[] | null | undefined,
  startedAt?: number | null
): FeatureRecord {
  const phAverage = average(numericValuesFromHistory(phHistory));
  const tempAverage = average(numericValuesFromHistory(tempHistory));
  const pressureAverage = average(numericValuesFromHistory(pressureHistory));
  const daysSinceStart = startedAt ? Math.max(1, (Date.now() - startedAt) / 86_400_000) : 1;

  const stats = columnStats();
  const features: FeatureRecord = {};

  const observed: Record<string, number | null> = {
    summary_average_ph: phAverage,
    summary_average_temp: tempAverage,
    summary_average_pressure_psi: pressureAverage,
    days_since_start: daysSinceStart,
  };

  for (const key of params.feature_columns) {
    features[key] = observed[key] ?? stats.get(key)?.median ?? null;
  }

  return features;
}

/**
 * Predict ABV (%) from a feature record. Any missing value is imputed using the
 * training-set median so incomplete batches still produce a valid estimate.
 */
export function predictAbv(rawFeatures: FeatureRecord): number {
  const featureColumns = Array.isArray(params.feature_columns) ? params.feature_columns : fallbackParams.feature_columns;
  if (!featureColumns.length) {
    const fallbackAbv = Number(asFiniteNumber(rawFeatures.summary_brix_delta ?? rawFeatures.brix_delta) ?? 0) * (params.brix_to_abv_factor ?? fallbackParams.brix_to_abv_factor);
    return Math.min(20, Math.max(0, Number.isFinite(fallbackAbv) ? fallbackAbv : 0));
  }

  let z = Number(params.intercept ?? fallbackParams.intercept ?? 0);
  const stats = columnStats();

  const rawPredictionAtReference = () => {
    const reference = params.calibration_reference ?? fallbackParams.calibration_reference ?? [];
    let referencePrediction = Number(params.intercept ?? fallbackParams.intercept ?? 0);
    featureColumns.forEach((col, i) => {
      const stat = stats.get(col);
      const mean = stat?.mean ?? 0;
      const scale = stat?.scale ?? 1;
      const coef = stat?.coef ?? 0;
      const value = asFiniteNumber(reference[i]) ?? mean;
      referencePrediction += coef * (scale === 0 ? 0 : (value - mean) / scale);
    });
    return referencePrediction;
  };

  for (const col of featureColumns) {
    const stat = stats.get(col);
    let value = asFiniteNumber(rawFeatures[col]);

    if (value === null) {
      value = stat?.median ?? 0;
    }

    const mean = stat?.mean ?? value;
    const scale = stat?.scale ?? 1;
    const coef = stat?.coef ?? 0;

    const scaled = scale === 0 ? 0 : (value - mean) / scale;
    z += coef * scaled;
  }

  // Apply the measured 12% refractometer result as a calibration offset while
  // retaining the synthetic model's feature relationships.
  const calibrationTarget = asFiniteNumber(params.calibration_target_abv);
  if (calibrationTarget !== null) {
    z += calibrationTarget - rawPredictionAtReference();
  }

  const capped = Math.min(20, Math.max(0, Number.isFinite(z) ? z : 0));
  return capped;
}

export function getModelInfo() {
  return {
    nTrainingSamples: params.n_training_samples ?? fallbackParams.n_training_samples,
    trainedAt: params.trained_at ?? fallbackParams.trained_at,
    nFeatures: params.feature_columns?.length ?? fallbackParams.feature_columns.length,
  };
}

/**
 * Chemistry-first ABV estimate: ABV ≈ (sugar consumed) × factor.
 * This is the trustworthy path whenever starting Brix (OG) and a current
 * Brix reading are both known — e.g. OG 30 → current 2 ≈ 16.5% at 0.59.
 * Returns null when either input is missing/invalid so callers can fall
 * back to the sensor-trend model.
 */
export function getBrixToAbvFactor(): number {
  const factor = asFiniteNumber(params.brix_to_abv_factor) ?? fallbackParams.brix_to_abv_factor;
  return factor > 0 && factor < 2 ? factor : 0.59;
}

export function predictAbvFromBrixDrop(
  ogBrix: number | null | undefined,
  currentBrix: number | null | undefined,
  factor: number = getBrixToAbvFactor()
): number | null {
  if (typeof ogBrix !== "number" || !Number.isFinite(ogBrix) || ogBrix <= 0 || ogBrix > 60) return null;
  if (typeof currentBrix !== "number" || !Number.isFinite(currentBrix) || currentBrix < 0) return null;
  if (!(factor > 0)) return null;
  const drop = ogBrix - currentBrix;
  // A clearly negative drop means the inputs are inconsistent — e.g. the
  // recorded "OG" is actually the finish target (like the form's 2.0
  // default), or a refractometer reading inflated by alcohol. Return null
  // so callers fall back to the sensor-trend estimate instead of showing a
  // bogus 0%. The 0.5 tolerance absorbs normal hydrometer noise (Day-0 must
  // legitimately reads drop ≈ 0, which correctly yields 0%).
  if (drop < -0.5) return null;
  const abv = drop * factor;
  return Math.min(25, Math.max(0, abv));
}

/**
 * Read the batch's starting Brix (OG) from its details record. Written by
 * the Start Batch form; absent for batches started before OG capture existed
 * (those keep using the sensor-trend estimate).
 */
export function resolveInitialBrix(
  details: { initialBrix?: unknown } | null | undefined
): number | null {
  const og = asFiniteNumber(details?.initialBrix);
  return og !== null && og > 0 && og <= 60 ? og : null;
}

/**
 * Recipe mass-balance OG estimator for chaptalized fruit wine.
 * Brix is a mass percent, so OG ≈ 100 × (total sugar) ÷ (total must mass):
 * added sugar (at ~95% purity for muscovado) plus the fruit's own sugar
 * (ripe bignay juice ≈ 14.7 °Bx literature value) over fruit + sugar + water
 * (1 L water ≈ 1 kg). E.g. 2 kg sugar + 3 kg fruit + 3 L water ≈ 30 Brix.
 * Returns null for missing/nonsense inputs.
 */
export const FRUIT_BRIX_DEFAULT = 14.7;
export const SUGAR_PURITY_DEFAULT = 0.95;

export function estimateOgFromRecipe(
  sugarKg: number | null | undefined,
  fruitKg: number | null | undefined,
  waterL: number | null | undefined,
  fruitBrix: number = FRUIT_BRIX_DEFAULT,
  sugarPurity: number = SUGAR_PURITY_DEFAULT
): number | null {
  const inputs = [sugarKg, fruitKg, waterL, fruitBrix, sugarPurity];
  if (inputs.some((v) => typeof v !== "number" || !Number.isFinite(v) || (v as number) < 0)) return null;
  const totalSugarKg =
    (sugarKg as number) * (sugarPurity as number) + (fruitKg as number) * ((fruitBrix as number) / 100);
  const totalMassKg = (sugarKg as number) + (fruitKg as number) + (waterL as number);
  if (!(totalMassKg > 0) || !(totalSugarKg > 0)) return null;
  const og = (100 * totalSugarKg) / totalMassKg;
  return og > 0 && og <= 60 ? Math.round(og * 10) / 10 : null;
}