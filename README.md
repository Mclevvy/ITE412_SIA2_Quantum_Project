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

A simulator can render the UI, but native push registration requires a physical device and valid Firebase/APNs/FCM credentials. The web build continues to work without native notification permissions.

## Code layout

- `src/lib/batchWrites.ts` — the single atomic writer for batch start/end. Edit batch lifecycle there, not in the screens.
- `src/lib/fermentationCurve.ts` — sugar soft sensor: fits the batch's manual Brix tests to an exponential decay curve for days-remaining (source of truth over the synthetic net; falls back to it when the fit is poor). Check: `npm run check:curve`.
- `src/lib/sensorFormat.ts` — shared sensor value/unit formatters (single source for °Brix, pH, °C, ABV formatting).
- `src/hooks/useHistoryList.ts` — shared paginated history subscription used by all four history screens.
- `src/hooks/useDashboardLive.ts` / `useBatchActions.ts` — Dashboard data subscription and batch action wiring.
- `src/components/dashboard/` — Dashboard sub-components (shell in `Dashboard.tsx`).
- `src/components/ui/` — exactly 12 shadcn components; do not add unused ones (repo pruned from 48).
- Status bands: Dashboard uses temp 25–32 °C / pH 3.2–3.8. The 15–40 °C / 2.5–4.5 ranges in FermentationTracker/PredictiveInsights are the TF-model input normalization (SCALING), not status bands — they must stay as-is for model inputs.

## ML honesty & reproducibility (2026-10-08 audit)

- The master net (`public/model_master/`, 4-in/3-out) is **synthetic-trained and unvalidated**: its days-remaining is systematically ~4 days optimistic (MAE ~3.9 on archived batches), and its quality/risk outputs span only ~90.6–92.7 across normal inputs — treat them as signals, not calibrated ratings. The UI labels them accordingly ("uncalibrated", "experimental").
- The sugar soft sensor (`fermentationCurve.ts`) is the days-remaining source of truth **only when it speaks**: it abstains (falls back to the net) when the fitted asymptote sits within 0.5 °Bx of the target or the ETA exceeds 60 days. Where it speaks it measured MAE ~0.8–2.0 days on archived batches.
- ABV tier 1 `(OG − brix) × 0.59` runs hot on uncorrected refractometer readings: real batch #8208 predicted 16.5% vs 12% measured (~4.5 pts). Tier 2 (ridge) is effectively a calibrated constant ~12% (±0.5 pt) — the `2400 (synthetic)` spec row is honest about its provenance.
- **Trainers are not reproducible**: `npm run train:abv` is broken (tfjs-node addon unbuilt; `npm rebuild @tensorflow/tfjs-node --build-addon-from-source` fixes the addon, but the script then writes fixed constants regardless of training). `train_abv_model.py` uses an inverted feature order vs `abvModelParams.json` and emits no params file. **No trainer in the repo produces `public/model_master/`** — retraining does not change the app until someone deliberately reconnects a trainer to the artifact.
- End-of-batch accuracy (`aiAccuracy` on `fermentation/history/{key}`) is now surfaced in Batch Reports: days error, ABV error, and quality-match (graded against the declared target ±0.5 °Bx, not a dry-wine band).
