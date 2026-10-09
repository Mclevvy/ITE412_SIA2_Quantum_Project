# Bunius-Sense mobile application

Bunius-Sense is a React/Vite application packaged for Android and iOS with Capacitor. It has two independent notification channels: FCM/APNs pushes (OS tray) and the in-app Notification Center fed by the Firebase Realtime Database `notifications` node.

## Push notification flow

1. When an authenticated user opens the native app, `src/lib/pushNotifications.ts` requests notification permission and registers with FCM (Android) or APNs (iOS).
2. The device token is stored in Firebase Realtime Database at `deviceTokens/{firebaseUserUid}/{encodedToken}`.
3. A push received while the app is in the foreground is shown through a native local notification. Background pushes are shown by the operating system.
4. The notification payload should use the same fields rendered by `NotificationCenter.tsx`:

```json
{
  "notification": {
    "title": "Fermentation alert",
    "body": "Tank 2 is outside the target temperature range."
  },
  "data": {
    "notificationId": "notification-id",
    "title": "Fermentation alert",
    "message": "Tank 2 is outside the target temperature range.",
    "type": "warning",
    "iconName": "ThermometerIcon",
    "timestamp": "1750000000000"
  }
}
```

The `notification` fields are used by FCM/APNs for background delivery. The `data` fields keep the payload aligned with the Notification Center record. Pushes are never written to the `notifications` node — a push appears in the OS tray (and as a native local notification when the app is foregrounded), while the in-app Notification Center is populated only by the app's own alert logic (offline/online device alerts, batch start/end events).

## Firebase setup required for real device delivery

- **Android:** add the Firebase project's `google-services.json` to `android/app/`, then run `npx cap sync android`. The application id is `com.ferma.app` (see `capacitor.config.json`).
- **iOS:** add the Firebase project's `GoogleService-Info.plist` to the iOS app target in Xcode, enable the **Push Notifications** capability and **Background Modes > Remote notifications**, and configure an APNs key/certificate in Firebase.
- The Firebase Realtime Database rules are version-controlled in
  [`database.rules.json`](database.rules.json) (root defaults to deny). Deploy
  them by pasting the file into **Firebase Console → Realtime Database →
  Rules**, or run `npx firebase-tools deploy --only database` (see
  `firebase.json`). The app silently loses a feature when its path is missing
  from the rules — if a screen breaks after a rules change, diff the paths in
  `src/` against that file.
- **Firmware caveat:** `sensors/current`, `sensors/history/*`, `deviceStatus`,
  `system/bottle_filler/*` and `reports/bottling` are written by external
  hardware with no Firebase session. These rules require `auth != null`, so
  deploying them as-is will make unauthenticated firmware show as offline.
  Firmware must sign in with a device account before deploying — reopening a
  path is a consciously-accepted exception, not the default.

## Run and build

```bash
npm install
cp .env.example .env   # REQUIRED: fill in Firebase web config (Vite reads VITE_* vars)
                       # the app throws at startup if these are missing — there are
                       # no hardcoded config fallbacks in src/lib/firebase.ts
npm run dev
npm run typecheck
npm run build
npx cap sync
npx cap open android
npx cap open ios
```

Hosted builds (Vercel) must define the same `VITE_FIREBASE_*` variables in the
project settings — a build without them produces an app that fails at startup
on purpose. Seed scripts (`npm run seed:demo` etc.) load the same `.env`
automatically via `node --env-file-if-exists=.env` (Node >= 22.9).

Backfill a batch's weighed harvest (rendered in the Batch Record sheet, and only there): `npm run seed:harvest -- --batch "Batch #8208" --ripe 3.4 --unripe 1.4` — dry-run by default, add `--confirm` to write. It stamps only `fermentation/history/{key}.harvest = { ripeKg, unripeKg }`; berry counts are deliberately not stored (they are `kg ÷ 0.45 / 0.30` and would drift).

A simulator can render the UI, but native push registration requires a physical device and valid Firebase/APNs/FCM credentials. The web build continues to work without native notification permissions.

## Code layout

- `src/lib/batchWrites.ts` — the single atomic writer for batch start/end. Edit batch lifecycle there, not in the screens. `endBatch` also archives the raw per-reading series to `sensorArchive/{historyKey}` (`temperature`, `ph`, `pressurePSI`, `sugarHistory`, `hydrometerChecks`) in the same atomic write — it is the only place a batch's trend data survives (the live `sensors/history` nodes are cleared).
- `src/lib/fermentationCurve.ts` — sugar soft sensor: fits the batch's manual Brix tests to an exponential decay curve for days-remaining (source of truth over the synthetic net; falls back to it when the fit is poor). Check: `npm run check:curve`.
- `src/lib/sensorFormat.ts` — shared sensor value/unit formatters (single source for °Brix, pH, °C, ABV formatting).
- `src/lib/exportGuards.ts` — shared export-safety helpers: `escapeHtml` (print-window XSS) and `guardFormula` (spreadsheet formula injection). Both exporters (`ReportsAnalytics.tsx`, `BatchRecordSheet.tsx`) must use these, never local copies.
- `src/components/BatchRecordSheet.tsx` — per-batch "full record" opened from a Production Reports card: charts `sensorArchive/{id}` on one shared time axis with the event log (sugar tests, hydrometer checks, completion + AI accuracy), and exports that single batch to PDF/Excel/print. Batches ended before `sensorArchive` existed show their summary with a "no sensor record" state.
- `src/hooks/useHistoryList.ts` — shared paginated history subscription used by all four history screens.
- `src/hooks/useDashboardLive.ts` / `useBatchActions.ts` — Dashboard data subscription and batch action wiring.
- `src/hooks/useSugarAutoLog.ts` — soft-sensor auto-log, mounted app-wide from `App.tsx` (every 15 min), so it runs whatever tab is open.
- `src/styles/globals.css` + `docs/ui-design-spec.md` — brand token layer (wine `#8B1538` primary, warm off-white surfaces, chart/radius/shadow tokens) and the component treatment rules. Components use token classes (`bg-primary`, `text-muted-foreground`, …), never raw hex; the AbvHero gradient and the status bands in `sensorFormat.ts` are the only exemptions.
- `src/components/dashboard/` — Dashboard sub-components (shell in `Dashboard.tsx`).
- `src/components/ui/` — exactly 12 shadcn components; do not add unused ones (repo pruned from 48).
- Status bands: Dashboard uses temp 25–32 °C / pH 3.2–3.8. The 15–40 °C / 2.5–4.5 ranges in FermentationTracker/PredictiveInsights are the TF-model input normalization (SCALING), not status bands — they must stay as-is for model inputs.

## ML honesty & reproducibility (2026-10-08 audit)

- The master net (`public/model_master/`, 4-in/3-out) is **synthetic-trained and unvalidated**: its days-remaining is systematically ~4 days optimistic (MAE ~3.9 on archived batches), and its quality/risk outputs span only ~90.6–92.7 across normal inputs — treat them as signals, not calibrated ratings. The UI labels them accordingly ("uncalibrated", "not a lab measurement") and shows the scale + direction (`0–100 · higher/lower is better`) so a bare number is readable.
- The sugar soft sensor (`fermentationCurve.ts`) is the days-remaining source of truth **only when it speaks**: it abstains (falls back to the net) when the fitted asymptote sits within 0.5 °Bx of the target or the ETA exceeds 60 days. Where it speaks it measured MAE ~0.8–2.0 days on archived batches.
- ABV tier 1 `(OG − brix) × 0.59` is calibrated with a 0.73 refractometer correction (effective ~0.43) against batch #8208's measured 12% — uncorrected readings run hot once alcohol is present. Provisional until a second measured point. Tier 2 (ridge) is effectively a calibrated constant ~12% (±0.5 pt) — the `2400 (synthetic)` spec row is honest about its provenance.
- The auto-log writes its estimate to `sensors/sugar/current` tagged `source: 'predicted'`, only when the last manual test is >24h stale. That tag is honored everywhere: `buildPoints` refuses to fit a predicted point (the model cannot validate its own output), the manual-log history archive skips it, and the UI says "soft-sensor estimate" instead of "measured". Manual readings always win — a write is dropped if a manual log lands mid-read.
- **Trainers are not reproducible**: `npm run train:abv` is broken (tfjs-node addon unbuilt; `npm rebuild @tensorflow/tfjs-node --build-addon-from-source` fixes the addon, but the script then writes fixed constants regardless of training). `train_abv_model.py` uses an inverted feature order vs `abvModelParams.json` and emits no params file. **No trainer in the repo produces `public/model_master/`** — retraining does not change the app until someone deliberately reconnects a trainer to the artifact.
- End-of-batch accuracy (`aiAccuracy` on `fermentation/history/{key}`) is now surfaced in Batch Reports: days error, ABV error, and quality-match (graded against the declared target ±0.5 °Bx, not a dry-wine band).
- **TF.js import surface:** the two model screens (`PredictiveInsights.tsx`, `FermentationTracker.tsx`) import `@tensorflow/tfjs-core` + `@tensorflow/tfjs-layers` + the webgl/cpu backends directly, **not** the `@tensorflow/tfjs` umbrella — the umbrella also pulls `tfjs-converter` + `tfjs-data`. The four subpackages are declared in `package.json` (drop back to the umbrella only if you need conversion/IO helpers). Measured: the shared tfjs chunk went 1,591 → 1,449 kB raw, ~250 → 244 kB gzip — the kernels compress ~26:1, so the win is parse time, not download.
- **Quality/Spoilage-Risk gating:** those two are the only outputs that need the net, so they're computed whenever the model is loaded and temp/pH/Brix are present — independently of the "Ready Now" days short-circuit and the ≥target check. When a card has no number it now names the blocker (`Loading model…` / `Waiting for a Brix reading` / `Model unavailable`) instead of a `Calculating…` that never resolved.

## Fruit sorting (separate `bignaysorter` project)

The Fruit Sorting page reads a **different** Firebase project, read-only — configured via `VITE_SORTER_*` (see `.env.example`). `src/lib/sorterFirebase.ts` is deliberately tolerant: an absent sorter config degrades this one page, it never crashes the app.

- Data: `bignay_sorter/{key} = { value: "pass" | "reject" }`, an append-only log; `sorter/totalCount` is ignored (derivable, and can drift).
- Per-batch counts are a **delta**: `startBatch` snapshots the log's last key into `fermentation/currentBatch/details.sortingBaseline` (`{ key: null }` = log was empty; the field absent = not captured, shown as such rather than guessed).
- `src/lib/sortingStats.ts` (`summarizeSorting`) is pure and checked by `npm run check:sorting`; ordering handles `b1…b10` via the numeric suffix.
- Estimated weight assumes **0.45 g per passed (ripe)** and **0.30 g per rejected (unripe)** berry — edit the constants in `sortingStats.ts`.
- Assumes the log is append-only and never cleared; if it is cleared, the batch collapses to "counts can't be attributed" rather than a wrong number.
