# Per-Batch Fruit Sorting Counts — Design

Date: 2026-10-09
Status: Approved (design) — pending spec review
Component: `src/components/FruitSorting.tsx`

## Problem

The Fruit Sorting page is entirely mock data: a 6-item `sortedFruits` array,
an amber "Sample data — no live classifier connected" banner, and an
`autoMode` toggle that changes nothing. The real sorting data lives in a
**separate** Firebase project (`bignaysorter`), which the app does not read.

The operator needs, **for the active batch**: total bignay sorted, how many
passed, how many were rejected, and the estimated weight of that batch.

## Goal

Replace the mock with live per-batch numbers read from `bignaysorter`,
scoped to the active fermentation batch.

## Non-goals

- We do **not** write to `bignaysorter`. It is read-only for us.
- We do **not** modify the sorting machine's code.
- No per-color breakdown (the real data has no color — only pass/reject).
- No historical per-batch sorting chart (single active batch only).

## Data contract (sorter side)

Read-only. Confirmed live shape:

```json
{
  "bignay_sorter": {
    "b1": { "value": "pass" },
    "b2": { "value": "reject" }
  },
  "sorter": { "totalCount": 2 }
}
```

- Node read: `bignay_sorter` — child entries keyed `b1`, `b2`, …; each has
  `value: "pass" | "reject"`.
- `sorter/totalCount` is **ignored**. It duplicates the number of entries and
  can drift; we count what we read.

## Batch boundary (option A: automatic baseline)

At **Start Batch**, the app snapshots the sorter's last entry key and stores
it on our own batch record:

```
fermentation/currentBatch/details.sortingBaseline = { key: string | null }
```

Three distinct states, deliberately unambiguous:

- field **absent** → the snapshot could not be taken (offline / error);
  the page shows "baseline not captured for this batch" and no numbers.
- `{ key: null }` → captured, and the log was empty at that moment.
- `{ key: "b5" }` → captured; the batch is everything ordered after `b5`.

The failure path never writes `{ key: null }` — a failed snapshot leaves the
field absent, so "couldn't read" can never be mistaken for "read zero".

## Entry ordering

`b1…b9,b10` sorts incorrectly under lexicographic comparison, so ordering is
by parsed numeric suffix when the key matches `^b(\d+)$`; otherwise by plain
key order (covers Firebase push IDs, which are lexicographically chronological).

## Metrics — `summarizeSorting(entries, baseline)`

- `total = passed + rejected` (entries after the baseline)
- `passed` — entries with `value === "pass"`
- `rejected` — entries with `value === "reject"`
- `estimatedWeightG = passed * PASS_WEIGHT_G + rejected * REJECT_WEIGHT_G`

Constants (editable, single source):

- `PASS_WEIGHT_G = 0.45` (ripe berry)
- `REJECT_WEIGHT_G = 0.30` (unripe berry)

## Components

New:

- `src/lib/sorterFirebase.ts` — second app:
  `initializeApp(sorterConfig, "bignaysorter")` + `getDatabase(sorterApp)`.
  Config from `VITE_SORTER_*` env vars, no hardcoded fallbacks (mirrors
  `src/lib/firebase.ts`). No auth — the DB is public-read (verified by probe).
- `src/lib/sortingStats.ts` — `summarizeSorting` + the two weight constants.
- `scripts/checkSorting.ts` — assert-based check, `npm run check:sorting`,
  mirroring `scripts/checkCurve.ts`.

Changed:

- `src/lib/batchWrites.ts` — capture `sortingBaseline` in `startBatch`.
- `src/components/FruitSorting.tsx` — `onValue` the real node; render Total /
  Passed / Rejected / Est. Weight for the active batch; remove mock array,
  sample banner, per-color report, and the dead `autoMode` toggle.
- `.env` + `.env.example` — add `VITE_SORTER_API_KEY`,
  `VITE_SORTER_DATABASE_URL`, `VITE_SORTER_PROJECT_ID` (minimum needed for
  `initializeApp` + `getDatabase`).

## Error handling

- Baseline missing → explicit message, no numbers.
- Sorter DB unreachable → "Sorter offline / unreachable" state; the rest of the
  app is unaffected.
- Empty log → zeros, not an error.

## Testing

- `npm run check:sorting` — table of cases: empty, no baseline, mixed
  pass/reject, weight math, `b10 > b9` ordering.
- `npm run typecheck`, `npm run build`.

## Risks / assumptions

1. **Append-only log.** If the other developer clears or resets `bignay_sorter`
   between sorting sessions, key-based baselining breaks. Confirmed assumed
   append-only; revisit if the writer changes.
2. **Key scheme.** Numeric `b<n>` parsing handles the current format; push-ID
   fallback handles a switch.
3. **Multi-device.** Two devices sorting simultaneously into one log cannot be
   attributed to different batches — single active batch only.

## Out of scope

- Multi-batch history, per-color analytics, writing back to the sorter.
