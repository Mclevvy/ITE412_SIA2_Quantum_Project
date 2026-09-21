# Bunius-Sense mobile application

Bunius-Sense is a React/Vite application packaged for Android and iOS with Capacitor. The existing Firebase Realtime Database notification feed in `src/components/NotificationCenter.tsx` is also the source of truth for mobile notifications.

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

The `notification` fields are used by FCM/APNs for background delivery. The `data` fields keep the payload aligned with the Notification Center record.

## Firebase setup required for real device delivery

- **Android:** add the Firebase project's `google-services.json` to `android/app/`, then run `npx cap sync android`. The application id is `com.buniussense.app`.
- **iOS:** add the Firebase project's `GoogleService-Info.plist` to the iOS app target in Xcode, enable the **Push Notifications** capability and **Background Modes > Remote notifications**, and configure an APNs key/certificate in Firebase.
- The Firebase Realtime Database rules must allow an authenticated user to write only their own token path and read notification records needed by the app.

## Run and build

```bash
npm install
npm run dev
npm run build
npx cap sync
npx cap open android
npx cap open ios
```

A simulator can render the UI, but native push registration requires a physical device and valid Firebase/APNs/FCM credentials. The web build continues to work without native notification permissions.
