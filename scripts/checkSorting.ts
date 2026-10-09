// Runnable check for per-batch sorting stats (src/lib/sortingStats.ts).
// Run: node scripts/checkSorting.ts   (Node >= 23 strips types natively)
import assert from 'node:assert/strict';
import { summarizeSorting, sortedKeys, latestEntryKey } from '../src/lib/sortingStats.ts';

// ordering: b10 after b9 (numeric suffix), push-ids lexicographic
assert.deepEqual(sortedKeys({ b10: { value: 'pass' }, b2: { value: 'pass' }, b9: { value: 'reject' } }),
                 ['b2', 'b9', 'b10']);
assert.deepEqual(sortedKeys({ '-Nzz': { value: 'pass' }, '-Naa': { value: 'reject' } }),
                 ['-Naa', '-Nzz']);
assert.equal(latestEntryKey({ b1: { value: 'pass' }, b10: { value: 'pass' }, b2: { value: 'pass' } }), 'b10');
assert.equal(latestEntryKey({}), null);

// a stray non-`b<n>` key must not flip the ordering of the `b<n>` keys
assert.deepEqual(sortedKeys({ b2: { value: 'pass' }, b10: { value: 'pass' }, '-Meta': { value: 'pass' } }),
                 ['b2', 'b10', '-Meta']);
// ...so slicing stays correct even with a stray key present
assert.deepEqual(
  summarizeSorting({ b9: { value: 'pass' }, b10: { value: 'reject' }, b2: { value: 'pass' }, '-Meta': {} }, 'b9'),
  { total: 1, passed: 0, rejected: 1, estimatedWeightG: 0.30 });

// baseline null (empty log at start) -> all entries
assert.deepEqual(summarizeSorting({ b1: { value: 'pass' }, b2: { value: 'reject' } }, null),
                 { total: 2, passed: 1, rejected: 1, estimatedWeightG: 0.45 + 0.30 });

// baseline "b1" -> only entries after b1
assert.deepEqual(summarizeSorting({ b1: { value: 'pass' }, b2: { value: 'pass' }, b3: { value: 'reject' } }, 'b1'),
                 { total: 2, passed: 1, rejected: 1, estimatedWeightG: 0.45 + 0.30 });

// malformed values ignored -> total === passed + rejected
assert.deepEqual(summarizeSorting({ b1: { value: 'pass' }, b2: { value: 'maybe' }, b3: {} }, null),
                 { total: 1, passed: 1, rejected: 0, estimatedWeightG: 0.45 });

// baseline key no longer present (log cleared) -> null, callers must not guess
assert.equal(summarizeSorting({ b5: { value: 'pass' } }, 'b1'), null);

// empty
assert.deepEqual(summarizeSorting({}, null), { total: 0, passed: 0, rejected: 0, estimatedWeightG: 0 });

console.log('checkSorting: all assertions passed');
