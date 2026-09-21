// src/lib/firebase.ts
import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyB39fVBk55r5eo8WHvyjaQlhITH_wU7sGg",
  authDomain: "ferma-9eb60.firebaseapp.com",
  databaseURL: "https://ferma-9eb60-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ferma-9eb60",
  storageBucket: "ferma-9eb60.firebasestorage.app",
  messagingSenderId: "696158561611",
  appId: "1:696158561611:web:dc6506661c296e8214b4ce",
  measurementId: "G-TRQVQ56V6K",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

export let analytics: ReturnType<typeof getAnalytics> | null = null;
isSupported().then((ok) => {
  if (ok) analytics = getAnalytics(app);
});

export { app };