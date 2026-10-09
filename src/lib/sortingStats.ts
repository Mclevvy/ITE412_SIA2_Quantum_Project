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

/** Numeric part of a `b<n>` key, or null when the key isn't that shape.
 *  Digit run is capped so a pathologically long key can't overflow to Infinity. */
function numericKey(key: string): number | null {
  const match = /^b(\d{1,15})$/.exec(key);
  return match ? Number(match[1]) : null;
}

/**
 * Log keys in insertion order. `b<n>` keys compare numerically (so `b10` follows
 * `b9`); every other key compares lexicographically (Firebase push IDs are
 * lexicographically chronological). The decision is per pair, not global — a
 * single stray non-`b<n>` key must not flip the ordering of all the others and
 * silently shuffle entries across a batch boundary.
 */
export function sortedKeys(entries: Record<string, SorterEntry>): string[] {
  return Object.keys(entries).sort((a, b) => {
    const na = numericKey(a);
    const nb = numericKey(b);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1; // numeric keys before non-numeric
    if (nb !== null) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
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
