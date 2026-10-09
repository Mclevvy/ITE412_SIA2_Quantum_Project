# Per-Batch Fruit Sorting Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock Fruit Sorting page with live per-batch totals (total / passed / rejected / estimated weight) read from the separate `bignaysorter` RTDB.

**Architecture:** A second, tolerant Firebase app reads the sorter's append-only `bignay_sorter` log; the active fermentation batch stores a baseline key captured at Start Batch, and a pure function diffs the log against it.

**Tech Stack:** React 18 + Vite, Firebase RTDB (v12 web SDK), TypeScript, node assert check scripts (no test framework).

**Spec:** `docs/superpowers/specs/2026-10-09-sorting-per-batch-counts-design.md`

## Global Constraints

- Node >= 22.9; check scripts run as `node scripts/<file>.ts` (native type stripping, no framework).
- Shell is Windows PowerShell: use `npm.cmd`, chain with `; if ($?) { ... }`.
- Config only from `VITE_`-prefixed env vars; `.env` is gitignored — never print real keys into committed files (placeholders only in `.env.example`).
- **Read-only** against `bignaysorter`. Never write to it.
- `PASS_WEIGHT_G = 0.45`, `REJECT_WEIGHT_G = 0.30` (grams per berry).
- Sorter node: `bignay_sorter/{key} = { value: "pass" | "reject" }`. `sorter/totalCount` is ignored.
- The secondary sorter DB must **never** crash the primary app when unconfigured.

## Review Focus

- Sorter env vars absent → app boots and the page says "sorter not configured"; nothing throws. (Pinned in Task 1.)
- `sortingBaseline` field **absent** (Start Batch couldn't reach the sorter) → "baseline not captured", never treated as zero. (Task 3 + Task 4.)
- Baseline key gone (log was cleared/reset) → no numbers, explicit message. (Task 2 `null` return + Task 4.)
- Log past `b9`: `b10` must sort after `b9`, not before `b2`. (Task 2 check.)
- Malformed entry (`value` missing or not "pass"/"reject") → ignored, so `total === passed + rejected` always holds. (Task 2 check.)

---

### Task 1: Sorter Firebase app + env placeholders

**Files:**
- Create: `src/lib/sorterFirebase.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `isSorterConfigured: boolean`; `sorterDb: Database | null` (type `import type { Database } from "firebase/database"`). App name literal `"bignaysorter"`.

- [ ] **Step 1: Write `src/lib/sorterFirebase.ts`**

Mirror `src/lib/firebase.ts` style, but **tolerant**: no `throw`. Read `VITE_SORTER_API_KEY`, `VITE_SORTER_DATABASE_URL`, `VITE_SORTER_PROJECT_ID`; if any is missing set `sorterDb = null`. Reuse an existing app if `getApps()` already has app named `"bignaysorter"` (guard against HMR double-init), else `initializeApp(config, "bignaysorter")`. Export `isSorterConfigured = sorterDb !== null`.

- [ ] **Step 2: Add placeholder keys to `.env.example`**

Append, placeholder values only (real values go in the gitignored `.env`):

```
# Sorting machine (separate Firebase project, read-only)
VITE_SORTER_API_KEY=YOUR_SORTER_API_KEY
VITE_SORTER_DATABASE_URL=https://YOUR_SORTER-default-rtdb.YOUR_REGION.firebasedatabase.app
VITE_SORTER_PROJECT_ID=YOUR_SORTER_PROJECT_ID
```

- [ ] **Step 3: Set real values in local `.env`**

Add the three `VITE_SORTER_*` keys to the gitignored `.env` with the `bignaysorter` web config (values from the sorter project's Firebase console — see the local `.env`, never committed). Do not commit `.env`.

- [ ] **Step 4: Verify build + typecheck**

Run: `npm.cmd run typecheck; if ($?) { npm.cmd run build }`
Expected: both succeed, no new warnings. (No node check here — the module uses `import.meta.env`, which node cannot run.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sorterFirebase.ts .env.example
git commit -m "feat: tolerant second Firebase app for the bignaysorter DB"
```

---

### Task 2: `summarizeSorting` pure lib + check script

**Files:**
- Create: `src/lib/sortingStats.ts`
- Create: `scripts/checkSorting.ts`
- Modify: `package.json` (add `"check:sorting": "node scripts/checkSorting.ts"`)

**Interfaces:**
- Consumes: nothing.
- Produces, from `src/lib/sortingStats.ts`:
  - `export const PASS_WEIGHT_G = 0.45;`
  - `export const REJECT_WEIGHT_G = 0.30;`
  - `export type SorterEntry = { value?: unknown };`
  - `export type SortSummary = { total: number; passed: number; rejected: number; estimatedWeightG: number };`
  - `export function sortedKeys(entries: Record<string, SorterEntry>): string[]`
  - `export function latestEntryKey(entries: Record<string, SorterEntry>): string | null`
  - `export function summarizeSorting(entries: Record<string, SorterEntry>, baselineKey: string | null): SortSummary | null`

- [ ] **Step 1: Write the failing check `scripts/checkSorting.ts`**

Import the three functions; assert each case below with `node:assert/strict`, ending with `console.log('checkSorting: all assertions passed')`. Fixed fixtures, no randomness.

```ts
// ordering: b10 after b9 (numeric suffix), push-ids lexicographic
assert.deepEqual(sortedKeys({ b10: { value: 'pass' }, b2: { value: 'pass' }, b9: { value: 'reject' } }),
                 ['b2', 'b9', 'b10']);
assert.deepEqual(sortedKeys({ '-Nzz': { value: 'pass' }, '-Naa': { value: 'reject' } }),
                 ['-Naa', '-Nzz']);
assert.equal(latestEntryKey({ b1: { value: 'pass' }, b10: { value: 'pass' }, b2: { value: 'pass' } }), 'b10');
assert.equal(latestEntryKey({}), null);

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
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm.cmd run check:sorting`
Expected: FAIL — cannot find module `../src/lib/sortingStats.ts`.

- [ ] **Step 3: Implement `src/lib/sortingStats.ts`**

`sortedKeys`: if every key matches `^b(\d+)$`, sort by the parsed number; otherwise lexicographic. `latestEntryKey`: last of `sortedKeys`, or `null` when empty. `summarizeSorting`: if `baselineKey === null` use all keys; else if it is not in `sortedKeys` return `null`; else take keys after it. Count `value === 'pass'` / `'reject'` (anything else ignored); `estimatedWeightG = passed * PASS_WEIGHT_G + rejected * REJECT_WEIGHT_G`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npm.cmd run check:sorting`
Expected: `checkSorting: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sortingStats.ts scripts/checkSorting.ts package.json
git commit -m "feat: per-batch sorting stats (pure) + runnable check"
```

---

### Task 3: Capture the baseline at Start Batch

**Files:**
- Modify: `src/lib/batchWrites.ts` (in `startBatch`, before the final `update`)

**Interfaces:**
- Consumes: `isSorterConfigured`, `sorterDb` (Task 1); `latestEntryKey` (Task 2).
- Produces: `fermentation/currentBatch/details.sortingBaseline = { key: string | null }`, or the field left **absent** on any failure.

- [ ] **Step 1: Implement baseline capture in `startBatch`**

Before `await update(...)`: if `isSorterConfigured && sorterDb`, `try { const snap = await get(ref(sorterDb, 'bignay_sorter')); const entries = snap.exists() ? snap.val() : {}; sortingBaseline = { key: latestEntryKey(entries) }; } catch { /* leave undefined */ }`. Then inside the `details` object spread `...(sortingBaseline ? { sortingBaseline } : {})`. Failure/absent config must not throw — the batch still starts.
Add a one-line comment: the sorter read is best-effort; a missing baseline is surfaced by the UI, never guessed.
`// ponytail: cross-project read on Start Batch; make it a background retry if it ever adds noticeable latency`

- [ ] **Step 2: Verify build + typecheck**

Run: `npm.cmd run typecheck; if ($?) { npm.cmd run build }`
Expected: both succeed.

- [ ] **Step 3: Manual verification (dev)**

Run `npm.cmd run dev`; Start Batch with the sorter reachable → in the RTDB console
`fermentation/currentBatch/details/sortingBaseline` exists with `{ key: "b2" }` (last key at that time).

- [ ] **Step 4: Commit**

```bash
git add src/lib/batchWrites.ts
git commit -m "feat: snapshot sorter baseline when a batch starts"
```

---

### Task 4: Rewrite `FruitSorting.tsx` + README

**Files:**
- Modify: `src/components/FruitSorting.tsx` (full rewrite of the data layer; keep the existing visual language)
- Modify: `README.md`

**Interfaces:**
- Consumes: `sorterDb`, `isSorterConfigured` (Task 1); `summarizeSorting`, `SortSummary` (Task 2); `db` from `src/lib/firebase.ts`.

- [ ] **Step 1: Rewrite the data layer**

Subscribe with `onValue` to `ref(db, 'fermentation/currentBatch/details')` (active batch: `batchId`, `sortingBaseline`) and, only when `sorterDb`, to `ref(sorterDb, 'bignay_sorter')` (entries). Keep a `sorterError` state set in the sorter `onValue` error callback. Derive the summary in a `useMemo` over (entries, baseline). Delete the `sortedFruits` array, the amber sample banner, the by-color report, and the `autoMode` toggle.

- [ ] **Step 2: Render states and cards**

- No active batch → "No active batch — start one in the Tracker."
- `!isSorterConfigured` → "Sorter not configured" (no crash).
- `sorterError` → "Sorter unreachable".
- `sortingBaseline` absent → "Baseline not captured for this batch."
- `summarizeSorting(...) === null` → "Sorting log was reset — cannot attribute counts to this batch."
- Otherwise → four cards: **Total**, **Passed**, **Rejected**, **Est. Weight** (`estimatedWeightG` in g, and kg when ≥ 1000). Counts via `.tnum`; keep `max-w-xl mx-auto pb-20`.

- [ ] **Step 3: Update README**

One short bullet: the Fruit Sorting page reads the separate `bignaysorter` project (read-only) at `bignay_sorter`; per-batch counts are a Start-Batch delta; weights assume 0.45 g passed / 0.30 g rejected.

- [ ] **Step 4: Verify build + checks + manual**

Run: `npm.cmd run typecheck; if ($?) { npm.cmd run check:sorting; if ($?) { npm.cmd run build; if ($?) { npm.cmd run check:curve } } }`
Expected: all pass. Then in `npm.cmd run dev`, confirm the page shows live numbers while a batch is active, and the fallback messages when the sorter config is removed from `.env`.

- [ ] **Step 5: Commit**

```bash
git add src/components/FruitSorting.tsx README.md
git commit -m "feat: live per-batch fruit sorting totals from bignaysorter"
```
