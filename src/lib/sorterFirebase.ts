// src/lib/sorterFirebase.ts
import { getApps, initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import type { Database } from "firebase/database";

// The sorting machine is a SEPARATE Firebase project, read-only for us.
// Unlike src/lib/firebase.ts this one is deliberately tolerant: a missing or
// half-filled sorter config degrades the Fruit Sorting page, but must never
// throw at import time and take the whole app down with it.
const SORTER_APP_NAME = "bignaysorter";

const sorterConfig = {
  apiKey: import.meta.env.VITE_SORTER_API_KEY,
  databaseURL: import.meta.env.VITE_SORTER_DATABASE_URL,
  projectId: import.meta.env.VITE_SORTER_PROJECT_ID,
};

export const isSorterConfigured = Boolean(
  sorterConfig.apiKey && sorterConfig.databaseURL && sorterConfig.projectId
);

export const sorterDb: Database | null = isSorterConfigured
  ? getDatabase(
      // Reuse the app across HMR reloads instead of calling initializeApp twice.
      getApps().find((a) => a.name === SORTER_APP_NAME) ??
        initializeApp(sorterConfig, SORTER_APP_NAME)
    )
  : null;
