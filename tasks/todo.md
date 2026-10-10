# Tasks: wine-filler bottle page

## Task 1: fillerFirebase lib + env (bruce)
**Description:** New `src/lib/fillerFirebase.ts` mirroring `sorterFirebase.ts` (named app `wine-filler`, `VITE_FILLER_API_KEY/_DATABASE_URL/_PROJECT_ID`, tolerant init → `null`), plus the 3 vars in `.env.example`.
**Acceptance criteria:**
- [ ] `export const fillerDb: Database | null`; null when unconfigured/init fails; never throws at import
- [ ] No hardcoded apiKey/URL/projectId anywhere in src
**Verification:** typecheck exit 0; build pass (TONI runs)
**Dependencies:** None
**Files:** `src/lib/fillerFirebase.ts` (new), `.env.example`
**Scope:** S

## Task 2: useHistoryList db param (bruce)
**Description:** Add optional `db` parameter to `useHistoryList` (defaults to primary db) so filler history can reuse it.
**Acceptance criteria:**
- [ ] All existing callers compile/behave unchanged (no call-site edits required)
- [ ] Passing a filler Database lists `filling/history` shaped rows
**Verification:** typecheck exit 0; grep existing call sites unchanged
**Dependencies:** Task 1 (for the filler Database value; signature first, wiring after)
**Files:** `src/hooks/useHistoryList.ts`
**Scope:** S

## Checkpoint: Foundation
- [ ] typecheck exit 0, build pass, secret scan clean

## Task 3: BottleFillingPage migration (natasha, owns page file only)
**Description:** Migrate `BottleFillingPage.tsx` to `fillerDb`: read `filling/currentBatch` + `filling/history` with validation-per-spec, render the 5 states with exact spec copy, swap custom pills/bars to `Badge`/`Progress` (+ `role="status"`, progressbar attrs), delete `system/bottle_filler/live` + `reports/bottling` refs.
**Acceptance criteria:**
- [ ] Unconfigured → "Filler not connected" copy, no crash
- [ ] `stage:"idle"` → "Waiting for operator" + live cards; malformed snapshot → error state with Retry, last-good kept
- [ ] Zero `system/bottle_filler` / `reports/bottling` refs in src
**Verification:** typecheck exit 0; build pass; manual matrix per spec
**Dependencies:** Tasks 1–2 (imports `fillerDb`; contract fixed in spec so build against it)
**Files:** `src/components/BottleFillingPage.tsx` (only)
**Scope:** M

## Task 4: staged finished-batch chip (natasha, same file)
**Description:** Read latest `fermentation/history` entry on the page; render "Ready to fill: {batchId} · {finalYield}" or "No finished batch — end a fermentation batch to stage one." No endBatch changes.
**Acceptance criteria:**
- [ ] Chip reflects latest ferma history; empty history → fallback copy
- [ ] No writes added anywhere on this page
**Verification:** manual check with/without history rows
**Dependencies:** Task 3
**Files:** `src/components/BottleFillingPage.tsx` (only)
**Scope:** XS

## Checkpoint: Core
- [ ] Live DB check: idle + staged + 2 history rows render; typecheck/build green

## Task 5: Ship (TONI)
- [ ] Secret scan, commit, push bunius/origin/fork; thor audit; steve README section; vault append

## Task 6: fill-to-report linkage (natasha, owns BottleFillingPage.tsx + BatchRecordSheet.tsx only)
**Description:** Per spec Addendum A: watcher on `filling/history` links each completed fill (valid `endTime`) to the staged ferma batch by writing `fermentation/history/{fermaKey}/fills/{fillerKey} = {actualVolumeMl,status,endTime}` for not-yet-linked keys only; Batch Record sheet renders Estimated-vs-Actual row when fills exist.
**Acceptance criteria:**
- [ ] New completed fill with a staged batch → `fills/{key}` appears on that batch's history record; no duplicate churn (linked-key ref)
- [ ] Sheet shows "Bottled X ml of Y estimated" only when fills exist; no fills → sheet unchanged
- [ ] No writes into wine-filler; background failures log only, never alert
**Verification:** typecheck exit 0; build pass; manual: complete a fill (or simulate row) with #8204 staged
**Dependencies:** Tasks 3–4 (done)
**Files:** `src/components/BottleFillingPage.tsx`, `src/components/BatchRecordSheet.tsx`
**Scope:** M

## Task 7: confirmed filler contract (natasha, owns BottleFillingPage.tsx only)
Per spec Addendum B: map `dispensing`→Active, `error`→Error copy; live progress from `details.dispensedMl`; `manual` status label; sub-epoch startTime renders as uptime duration.

## Task 8: sample bucket (natasha, owns BottleFillingPage.tsx only)
Per spec Addendum C: completed fill with an ACTIVE batch → `fermentation/samples/{fillerKey}` (not staged); Sample badge on matching history rows; staged path otherwise unchanged.

## Task 9: sorter sample ranges (natasha, owns FruitSorting.tsx + sortingStats.ts only)
Per spec Addendum D: "Ignore entries so far" button (confirm-gated) re-cuts baseline to latest key + pushes audit range to `fermentation/sorterSamples`; muted status line; harvest path untouched.
