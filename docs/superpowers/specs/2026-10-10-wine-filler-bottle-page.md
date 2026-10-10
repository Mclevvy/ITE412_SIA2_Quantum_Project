# Spec: Wine-filler Bottle Filling page + End-Batch handoff

## Objective
Make the Bottle Filling page functional against the external `wine-filler` Firebase project, and link it to fermentation: when the operator stops a batch (End Batch), the finished batch is surfaced as "ready to fill" next to the live filler state.

User stories:
- As an operator I open Bottle Filling and see the filler machine state (idle/filling/done/unreachable) and its fill history — not a permanent "MACHINE OFFLINE".
- As an operator who just ended a fermentation batch, I see that finished batch staged as "Ready to fill" on the same page, so I know what goes into the filler next.
- As an operator with no filler configured, I get a clear "not connected" state instead of a dead page.

Single capability (no Phase-0 map): read-only filler display + staged finished-batch chip. Build order: filler lib → page migration → staged chip.

## Assumptions I'm making
1. The app NEVER writes into `wine-filler` — display only. Filler hardware stays source of truth for fill start/stop (write access to that project is unconfirmed; coupling ferma UX to its rules risks permission-denied desync).
2. `VITE_FILLER_API_KEY / VITE_FILLER_DATABASE_URL / VITE_FILLER_PROJECT_ID` env vars (mirror of `VITE_SORTER_*`); the pasted `firebaseConfig` from chat is NEVER hardcoded.
3. Old ferma paths `system/bottle_filler/live` + `reports/bottling` are dead and get REMOVED (single source of truth), per Ponytail.
4. Filler `stage` values beyond observed `"idle"` are unknown — any unrecognized stage renders "Unknown filler status", never a crash.
→ Correct me now or I proceed with these.

## Tech stack
React 18 + Vite + Tailwind 4 + shadcn-style `src/components/ui/*` + lucide-react + Firebase RTDB JS SDK. Third Firebase app (named `wine-filler`), same pattern as `src/lib/sorterFirebase.ts`.

## Commands
```
Typecheck: npm.cmd run typecheck
Build:     npm.cmd run build
Dev:       npm.cmd run dev
```
(PowerShell: `npm.cmd` / `firebase.cmd` — `.ps1` is execution-policy blocked.)

## Project structure
```
src/lib/fillerFirebase.ts      → NEW: tolerant named-app init → fillerDb: Database | null
src/lib/fillerFormat.ts        → NEW (only if validation exceeds ~30 lines; else inline): pure validators for filler shapes
src/components/BottleFillingPage.tsx → migrate reads to fillerDb + staged ferma chip, swap custom pills/bars to Badge/Progress
src/hooks/useHistoryList.ts    → needs a `db` param (or small variant) to list filling/history; currently hard-bound to primary db
.env.example                   → VITE_FILLER_* vars
```

## Data contract (wine-filler, external = untrusted, validate before render)
- `filling/currentBatch` → `{ stage: string, details: { batchId, startTime, targetVolumeMl } }` (observed live: `{"batchId":"FILL-69239","startTime":69239,"targetVolumeMl":110}, stage:"idle"`).
- `filling/history/{pushId}` → `{ batchId, startTime, endTime, durationMs, targetVolumeMl, actualVolumeMl, pulses, status }` (observed: `status:"pass"`, `pulses:0`).
- Rules: `stage` non-empty string (only `idle` observed; `filling|done|error` unconfirmed → fallback "Unknown filler status"); `batchId` non-empty ≤64 chars else "Unknown batch"; times finite `>0` with `endTime >= startTime` else `—`; `targetVolumeMl` finite 1–5000 else 0; `actualVolumeMl` 0–10000 else 0; `durationMs` 0–86_400_000 else `endTime-startTime` or `—`; `pulses` non-neg int else 0; `status` `pass|fail` else `unknown` (text label, never color-alone). Progress clamped 0–100. `null`/primitive snapshot = empty, never throw.

## Handoff semantics (End Batch → filler)
`endBatch` keeps writing ONLY ferma-9eb60 (`fermentation/history` + clears). No cross-project write. `BottleFillingPage` reads the latest `fermentation/history` entry as the staged chip: "Ready to fill: {batchId} · {finalYield}". Volume stays a `"10L"`-style string in ferma; parse numerically only for display.

## UI states (BottleFillingPage, reuse Card/Badge/Progress, no new deps)
| State | Condition | Copy |
|---|---|---|
| Unconfigured | `fillerDb === null` | Badge "Filler not connected". Body: "Filler database isn't configured. Add VITE_FILLER_* vars and reload." Staged ferma chip still shows if present. |
| Idle | `stage==="idle"` | Badge "Waiting for operator". Live: "0 / {target} ml", "Awaiting machine setup…". Staged chip or "No finished batch — end a fermentation batch to stage one." |
| Active | `stage==="filling"` | Badge "Filling — {fillerBatchId}". "{actual} / {target} ml · {pct}% Filled". Bad numbers → "—" + "Reading filler…". |
| Done | newest `filling/history` row / `stage==="done"` | Badge "Fill complete". Row: "{batchId} · {actualMl} ml · Passed/Failed". |
| Error | listener error / malformed | Badge destructive "Filler data unavailable". "Couldn't read the filler database. Check connection and retry." + Retry. Keep last-good history visible. |

A11y: `role="status" aria-live="polite"` on status, `role="progressbar"` on bars, text+icon (not color-alone), retry ≥44px, drop custom red pill → `Badge destructive`.

## Code style
```ts
// src/lib/fillerFirebase.ts — sorter mirror: tolerant, never throws at import
const appName = "wine-filler";
function createFillerDb(): Database | null {
  if (!apiKey || !projectId || !isHttps(databaseURL)) return null;
  try {
    return getDatabase(getApps().find((a) => a.name === appName) ?? initializeApp(config, appName));
  } catch { return null; }
}
export const fillerDb: Database | null = createFillerDb();
```
Conventions: named app + HMR-safe reuse; `null` = unavailable and every reader degrades one page; no hardcoded config; external snapshots validated before render; reuse `Card/Badge/Progress`, lucide icons, motion.

## Testing strategy
- `npm.cmd run typecheck` + `npm.cmd run build` (TONI runs; subagent shells are sandboxed).
- Manual matrix on Bottle page: (a) `VITE_FILLER_*` unset → Unconfigured; (b) live `stage:"idle"` → Idle + staged chip; (c) history rows → Done list newest-first; (d) bad snapshot → Error with retry, last-good kept.
- Reuse-audit (`sortingStats`/`useHistoryList` generalization over new utils), dead-code-scan (`system/bottle_filler`, `reports/bottling` refs must be zero after migration).

## Boundaries
- Always: env-only config; validate filler snapshots; keep header counts/toggles untouched (filler row, if any later, gets no controlKey); run typecheck+build before commit.
- Ask first: ANY app→filler write; changing `useHistoryList` signature used by other pages; keeping old paths as fallback.
- Never: commit the pasted `firebaseConfig`/secrets; throw at import from the new lib; write into wine-filler from `endBatch`.

## Success criteria
- [ ] Bottle page with filler env set shows live `stage:"idle"` + staged finished batch + 2-row history from live DB above.
- [ ] With filler env unset: Unconfigured copy, no crash, staged chip still renders.
- [ ] Ending a fermentation batch updates the staged chip (latest `fermentation/history`).
- [ ] Zero remaining refs to `system/bottle_filler/live` / `reports/bottling` in src.
- [ ] typecheck exit 0 + build pass.

## Open questions (need your answers before implement)
1. What `stage` strings does the filler firmware actually write (`filling`? `done`/`complete`? `error`)?
2. Does `filling/history` need linkage to the ferma `batchId` (today's `FILL-69239` looks hardware-generated)?
3. Are wine-filler RTDB rules read-only-public / locked-write — stay read-only forever, or do you want app→filler writes later?

## Addendum A — fill-to-report linkage (approved 2026-10-10)
- **Trigger (completion event):** a new child under `filling/history` with a valid `endTime`. (`stage` ignored for this — unconfirmed strings.)
- **Attribution:** the ferma batch staged ("Ready to fill") at completion time = latest `fermentation/history` by `completedAt`. No firmware change, no extra taps.
- **Storage (ferma side only — wine-filler stays read-untouched):** `fermentation/history/{fermaKey}/fills/{fillerPushKey} = { actualVolumeMl, status, endTime }`. Writes only keys not yet linked (ref + one read per staged-batch change; rewrites are value-identical so harmless). Failure → `console.error` only (background sync, no alert spam). Rules already allow it (operator-email write on `fermentation`).
- **Report:** Batch Record sheet shows fills provenance only (`Fills: n pour(s) · ids`) — no volume claims, no Estimated-vs-Actual math. Rationale (2026-10-10): the flow sensor is bypassed so `actualVolumeMl` is time-estimated, and displaying it as measured is misleading. `actualVolumeMl` is still RECORDED in each link for future sensor re-enable, just never displayed. Target ml (a real operator setting) is displayed instead of actual everywhere.
- **Stated limits:** linkage is recorded only while the app is open to witness the completion; if staging moves mid-fill, attribution follows the staging.
- **Acceptance:** complete a fill with #8204 staged → its history record gains `fills/{key}`; sheet shows Bottled X ml of Y estimated; typecheck + build green.

## Addendum C — sample bucket (approved 2026-10-10)
- Rule: at fill completion, if a fermentation batch is ACTIVE (`fermentation/currentBatch` exists), the fill is NOT linked to the staged finished batch — it goes to the sample bucket. Only with no active batch does Addendum A staging apply. (Process is end-then-fill, so anything poured mid-fermentation is a test/sample or otherwise unidentifiable.)
- Storage: `fermentation/samples/{fillerPushKey} = { actualVolumeMl, status, endTime, fillerBatchId, reason: "active-batch", linkedAt }`. Same validators, same linked-once gating (seed covers staged fills + samples), same console.error-only failures. Covered by existing `fermentation/.write` operator rule — no rules change.
- Display: Fill History rows whose key exists in `samples` carry a small "Sample" badge (existing Badge styles). No new sections; the bucket stays out of `fermentation/history` so Reports aggregates are untouched.
- Edge, stated: bottling finished wine while another batch ferments also lands in samples (attribution follows the rule, not intent); moving a sample to a real batch is a future slice, not this one.

## Addendum B — confirmed filler contract (firmware source reviewed 2026-10-10)
- Stage enum is `idle | dispensing | done | error` (DONE shows ~3 s then flips to idle; history row is the durable signal).
- `dispensing` ≡ Active ("Filling — {id}"); `error` (safety timeout) → Error block with copy "Filler reported an error." (Retry + last-good kept); `done` → Done; `idle` → Idle. Unknown strings still → "Unknown filler status".
- `details.dispensedMl` (optional, firmware PUTs it ~1/s mid-pour): valid finite 0..10000 → live progress `dispensed/target`; absent → indeterminate "Reading filler…".
- History `status: "manual"` (manual-hold pours are now logged by firmware): label "Manual".
- `startTime`/`endTime` are **millis-since-boot, not epoch** until firmware ships NTP: values `< 1e12` render as uptime duration ("X min after machine boot"), `>= 1e12` as dates. Real epoch-ms flows through untouched once NTP lands.
