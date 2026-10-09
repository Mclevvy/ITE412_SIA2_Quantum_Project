// src/lib/firebase.ts
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getAnalytics, isSupported } from "firebase/analytics";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

// Config comes only from Vite env vars — no hardcoded fallbacks, so a
// half-filled .env can never silently target another (e.g. production) project.
const REQUIRED_ENV = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_DATABASE_URL",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;
const missingEnv = REQUIRED_ENV.filter((key) => !import.meta.env[key]);
if (missingEnv.length) {
  throw new Error(
    `Missing Firebase configuration: ${missingEnv.join(", ")}. ` +
      "Copy .env.example to .env and fill in your Firebase web config."
  );
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID && {
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  }),
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

// App Check attests that a request comes from our real app, not a script
// reusing the (public) API key. It stays OFF — zero behaviour change — until
// VITE_RECAPTCHA_SITE_KEY is set, and it only bites once enforced per-service
// in the Firebase console. Enforcement blocks every non-attesting client, so
// turn it on only after each writer (the app, and any ESP sensor node) can send
// a token.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (typeof window !== "undefined" && recaptchaSiteKey) {
  // Local dev only: a debug token from the App Check console, so the emulator
  // isn't rejected once enforcement is on.
  if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export let analytics: ReturnType<typeof getAnalytics> | null = null;
isSupported().then((ok) => {
  if (ok) analytics = getAnalytics(app);
});

export { app };