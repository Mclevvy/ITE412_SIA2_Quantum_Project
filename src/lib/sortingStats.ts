// Per-batch sorting stats, derived from the separate `bignaysorter` log.
// Pure — no Firebase import — so scripts/checkSorting.ts can run it under node.

/** Grams per ripe (passed) berry. Editable — tune against a real weighed sample. */
export const PASS_WEIGHT_G = 0.45;
/** Grams per unripe (rejected) berry. */
export const REJECT_WEIGHT_G = 0.30;

export type SorterEntry = { value?: unknown };

export type SortSummary = {
  total: number;
  passed: number;
  rejected: number;
  estimatedWeightG: number;
};

/** Numeric part of a `b<n>` key, or null when the key isn't that shape. */
function numericKey(key: string): number | null {
  const match = /^b(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}

/**
 * Log keys in insertion order. The sorter writes `b1, b2, … b10`, which sorts
 * wrong lexicographically (b10 before b2), so parse the suffix when every key
 * has that shape; otherwise fall back to key order (Firebase push IDs are
 * lexicographically chronological).
 */
export function sortedKeys(entries: Record<string, SorterEntry>): string[] {
  const keys = Object.keys(entries);
  const allNumeric = keys.every((k) => numericKey(k) !== null);
  return keys.sort(
    allNumeric
      ? (a, b) => (numericKey(a) as number) - (numericKey(b) as number)
      : (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  );
}

/** Last key in insertion order, or null when the log is empty. */
export function latestEntryKey(entries: Record<string, SorterEntry>): string | null {
  const keys = sortedKeys(entries);
  return keys.length ? keys[keys.length - 1] : null;
}

/**
 * Counts for one batch: entries after `baselineKey` (the log position recorded
 * at Start Batch). `baselineKey === null` means the log was empty then, so the
 * batch is every entry. Returns null when the baseline key is gone (log was
 * cleared) — the caller must not present a guessed number in that case.
 */
export function summarizeSorting(
  entries: Record<string, SorterEntry>,
  baselineKey: string | null
): SortSummary | null {
  const keys = sortedKeys(entries);
  let batchKeys = keys;

  if (baselineKey !== null) {
    const cut = keys.indexOf(baselineKey);
    if (cut === -1) return null;
    batchKeys = keys.slice(cut + 1);
  }

  let passed = 0;
  let rejected = 0;
  for (const key of batchKeys) {
    const value = entries[key]?.value;
    if (value === 'pass') passed++;
    else if (value === 'reject') rejected++;
    // Anything else is ignored, so total === passed + rejected always holds.
  }

  return {
    total: passed + rejected,
    passed,
    rejected,
    estimatedWeightG: passed * PASS_WEIGHT_G + rejected * REJECT_WEIGHT_G,
  };
}
