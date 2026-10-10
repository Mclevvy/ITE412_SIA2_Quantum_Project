# Implementation Plan: Wine-filler Bottle Filling page + End-Batch handoff

Spec: `docs/superpowers/specs/2026-10-10-wine-filler-bottle-page.md` (approved).

## Overview
Migrate `BottleFillingPage` from dead ferma paths to the external read-only `wine-filler` project, and stage the latest finished ferma batch as "Ready to fill". Display-only; no cross-project writes.

## Architecture decisions
- `src/lib/fillerFirebase.ts` mirrors `sorterFirebase.ts`: named app `wine-filler`, tolerant init → `Database | null`, never throws at import (batchWrites-adjacent hazard documented at `sorterFirebase.ts:25-27`).
- `useHistoryList` gains an optional `db` param (backward compatible); filler history reuses it instead of a fork.
- Validation lives with the reader (inline in page unless >~30 lines, then `src/lib/fillerFormat.ts`); external snapshots are untrusted.
- Old paths (`system/bottle_filler/live`, `reports/bottling`) deleted from the page — single source of truth.

## Task list
### Phase 1: Foundation (bruce, owns lib + hook + env only)
- [ ] Task 1: `fillerFirebase.ts` + `VITE_FILLER_*` in `.env.example`
- [ ] Task 2: `useHistoryList` optional `db` param, existing callers untouched
### Checkpoint: Foundation
- [ ] typecheck exit 0, build pass
### Phase 2: Page (natasha, owns `BottleFillingPage.tsx` only)
- [ ] Task 3: migrate page to `fillerDb` (5 states, validation, remove old refs, Badge/Progress)
- [ ] Task 4: staged chip from latest `fermentation/history` ("Ready to fill" / "No finished batch…")
### Checkpoint: Core
- [ ] Manual matrix: unconfigured / idle+staged / history rows / malformed → error with retry, last-good kept
- [ ] `system/bottle_filler` + `reports/bottling` refs in src = zero
### Phase 3: Ship (TONI)
- [ ] typecheck + build, secret scan, commit (branch), push 3 remotes
- [ ] thor audit (new project, env, no hardcoded config), steve docs (README filler section), vault append

Tasks tracked in `tasks/todo.md`.

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| `firebase.ts:40` default-app assumption vs load order | High — whole app dead at import | Filler lib never initializes default app; named app only; TONI verifies build |
| New lib throws at import via batchWrites graph | High | Tolerant-null mirror of sorter; no top-level throw |
| `stage` enum unknown beyond `idle` | Med | Fallback "Unknown filler status", never crash |
| Parallel edits collide | Med | Explicit file ownership; bruce≠page, natasha=page only |
| wine-filler write access assumed | Med | Display-only; no app→filler writes (spec boundary) |

## Open questions
Carried in spec (stage enum, ferma-batchId linkage, rules) — building against fallbacks; answers refine copy later, no rework.
