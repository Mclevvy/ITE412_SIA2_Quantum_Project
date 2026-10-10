// src/lib/fillerFirebase.ts
import { getApps, initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import type { Database } from "firebase/database";

// The wine filler is a SEPARATE Firebase project, read-only for us (the
// hardware owns writes). Same deliberate tolerance as sorterFirebase.ts: a
// missing or half-filled filler config degrades the Bottle Filling page only,
// and must never throw at import time and take the whole app down with it.
const FILLER_APP_NAME = "wine-filler";

const fillerConfig = {
  apiKey: import.meta.env.VITE_FILLER_API_KEY,
  databaseURL: import.meta.env.VITE_FILLER_DATABASE_URL,
  projectId: import.meta.env.VITE_FILLER_PROJECT_ID,
};

const configPresent = Boolean(
  fillerConfig.apiKey &&
    fillerConfig.projectId &&
    typeof fillerConfig.databaseURL === "string" &&
    fillerConfig.databaseURL.startsWith("https://")
);

// A malformed URL makes getDatabase throw. Contain it here: like sorterDb, this
// module exports a single nullable handle, so no caller can observe a half-built
// Database. Named app ONLY — src/lib/firebase.ts does `getApps().length ? getApp()
// : initializeApp(...)`, so never touching the default app keeps that untouched.
function createFillerDb(): Database | null {
  if (!configPresent) return null;
  try {
    return getDatabase(
      // Reuse the app across HMR reloads instead of calling initializeApp twice.
      getApps().find((a) => a.name === FILLER_APP_NAME) ??
        initializeApp(fillerConfig, FILLER_APP_NAME)
    );
  } catch {
    return null;
  }
}

/** The filler database, or null when unconfigured *or* init failed — callers
 *  treat null as "unavailable" and degrade this one page. */
export const fillerDb: Database | null = createFillerDb();