// src/lib/firebase.ts
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "AIzaSyB39fVBk55r5eo8WHvyjaQlhITH_wU7sGg",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "ferma-9eb60.firebaseapp.com",
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ??
    "https://ferma-9eb60-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "ferma-9eb60",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "ferma-9eb60.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "696158561611",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "1:696158561611:web:dc6506661c296e8214b4ce",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "G-TRQVQ56V6K",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

export let analytics: ReturnType<typeof getAnalytics> | null = null;
isSupported().then((ok) => {
  if (ok) analytics = getAnalytics(app);
});

export { app };