/**
 * Demo-batch seeder for defense presentations.
 * -------------------------------------------
 * Writes 4 realistic COMPLETED batches (house recipe: 2kg muscovado +
 * 3kg bignay + 3L water, OG ~30, 3-week ferment 30 → ~2, finish ~16.5%)
 * to `fermentation/history` + `sensorArchive`.
 *
 * SAFETY:
 * - Demo writes go under fermentation/history and sensorArchive/{key}.
 *   --harvest touches only fermentation/history/{key}.harvest; --baseline
 *   touches only fermentation/currentBatch/details.sortingBaseline. Live
 *   sensor paths are never touched.
 * - Idempotent: existing demo batchIds are skipped, so re-runs can't duplicate.
 * - Default is --dry-run (prints what WOULD be written, touches nothing).
 *
 * USAGE (PowerShell — plain `VAR=value` prefixes do NOT work here):
 *   node scripts\seedDemoBatch.mjs --dry-run
 *   # Set credentials via env (preferred — a --password on the command line
 *   # is written to your shell history for every local user to read):
 *   #   $env:SEED_EMAIL="you@example.com"; $env:SEED_PASSWORD="secret"
 *   node scripts\seedDemoBatch.mjs --check
 *   node scripts\seedDemoBatch.mjs --confirm
 *   node scripts\seedDemoBatch.mjs --harvest --batch "Batch #8208" --ripe 3.5 --unripe 1.4
 *   node scripts\seedDemoBatch.mjs --harvest --batch "Batch #8208" --ripe 3.5 --unripe 1.4 --confirm
 *   node scripts\seedDemoBatch.mjs --baseline
 *   node scripts\seedDemoBatch.mjs --baseline --confirm
 *
 * MODES (choose one):
 *   --dry-run    preview only, no sign-in, writes nothing (default)
 *   --check      sign in and list what is actually in fermentation/history
 *   --confirm    write the 4 batches (needs credentials)
 *   --clean-junk list history records missing a batchId (needs credentials);
 *                add --confirm to actually delete them
 *   --harvest   stamp { ripeKg, unripeKg } onto batch "<id>" wherever it lives —
 *                the active batch's details (Fruit Sorting page) and/or its
 *                history record (Batch Record sheet), matched by --batch. Add
 *                --confirm to write; only those two numbers change.
 *   --baseline  set the ACTIVE batch's details.sortingBaseline so the Fruit
 *                Sorting page stops saying "baseline not captured". Add --key
 *                <key> to count only entries after that key; default counts the
 *                whole log. Add --confirm to write.
 *
 * NOTE: these are synthetic batches for presentation purposes. Disclose that
 * to your panel — the data is realistic but generated, not measured.
 */
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, ref, push, set, get, update, remove } from "firebase/database";

// Config comes only from env (loaded via `node --env-file-if-exists=.env`),
// so a missing/incorrect .env fails loudly instead of hitting production.
const REQUIRED_ENV = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_DATABASE_URL",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(
    `Missing Firebase configuration: ${missingEnv.join(", ")}. ` +
      "Copy .env.example to .env and fill in your Firebase web config."
  );
  process.exit(1);
}
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.VITE_FIREBASE_DATABASE_URL,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const BRIX_TO_ABV = 0.59;
const DAY_MS = 24 * 60 * 60 * 1000;

// Deterministic PRNG (mulberry32) so re-runs generate identical series.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 4 staggered batches, oldest first. Realistic 4-digit ids in the same
// series as the live batch numbering (current live batch is #8208).
const BATCH_DEFS = [
  { batchId: "Batch #8191", daysAgoCompleted: 49, durationDays: 23, volumeL: 20, og: 30.2 },
  { batchId: "Batch #8195", daysAgoCompleted: 35, durationDays: 22, volumeL: 20, og: 29.6 },
  { batchId: "Batch #8201", daysAgoCompleted: 21, durationDays: 24, volumeL: 22, og: 30.5 },
  { batchId: "Batch #8204", daysAgoCompleted: 7, durationDays: 21, volumeL: 18, og: 29.3 },
];

function buildBatch(def, index, now) {
  const rand = rng(1000 + index * 77);
  const completedAt = now - def.daysAgoCompleted * DAY_MS;
  const startedAt = completedAt - def.durationDays * DAY_MS;
  const n = def.durationDays + 1;

  // Sugar: fast early drop, slow tail (extraction + fermentation), ending dry.
  const finalBrix = 1.5 + rand() * 1.2;
  // Temp: warm room wobble around 27-28.5. pH: drifts down as acids build.
  // Pressure: gentle 4-9 PSI arc peaking mid-ferment.
  const tempPts = [];
  const phPts = [];
  const pressurePts = [];
  const sugarPts = [];
  for (let d = 0; d < n; d += 1) {
    const t = startedAt + d * DAY_MS;
    const frac = d / (n - 1);
    const brix = finalBrix + (def.og - finalBrix) * Math.exp(-3.2 * frac) + (rand() - 0.5) * 0.3;
    sugarPts.push({ brix: Math.max(0.5, Math.round(brix * 10) / 10), time: t });
    tempPts.push({
      value: Math.round((27.6 + Math.sin(d * 0.9 + index) * 0.9 + (rand() - 0.5) * 0.6) * 10) / 10,
      time: t,
    });
    phPts.push({
      value: Math.round((3.75 - 0.55 * frac + (rand() - 0.5) * 0.08) * 100) / 100,
      time: t,
    });
    pressurePts.push({
      value: Math.round((4 + 5 * Math.sin(Math.PI * Math.min(1, frac * 1.15)) + (rand() - 0.5) * 0.8) * 10) / 10,
      time: t,
    });
  }

  const avgTemp = tempPts.reduce((s, p) => s + p.value, 0) / tempPts.length;
  const avgPh = phPts.reduce((s, p) => s + p.value, 0) / phPts.length;
  const actualAbv = Math.max(0, (def.og - finalBrix) * BRIX_TO_ABV);
  const predictedAbv = Math.round((actualAbv + (rand() - 0.4) * 0.8) * 10) / 10;
  const predictedDays = def.durationDays + Math.round((rand() - 0.5) * 4);
  const predictedQuality = 86 + Math.round(rand() * 8);

  const actualDays = def.durationDays - 14;
  const summary = {
    batchId: def.batchId,
    startDate: new Date(startedAt).toLocaleDateString(),
    completedAt,
    finalYield: `${Math.round(def.volumeL * 0.9)}L`,
    fruitsUsed: "3kg",
    targetBrixAchieved: finalBrix.toFixed(1),
    startingBrix: def.og.toFixed(1),
    averageTemp: avgTemp.toFixed(1),
    averagePh: avgPh.toFixed(2),
    aiAccuracy: {
      predictedAt: startedAt + 14 * DAY_MS,
      predictedDaysRemaining: predictedDays,
      actualDaysFromPrediction: actualDays,
      daysError: actualDays - predictedDays,
      predictedQualityPercent: predictedQuality,
      predictedQualityGrade: predictedQuality >= 85 ? "premium" : predictedQuality >= 70 ? "good" : "standard",
      actualQualityGrade: "below",
      qualityMatch: false,
      predictedRiskPercent: 8 + Math.round(rand() * 10),
      predictedAbv,
      actualAbv: Math.round(actualAbv * 10) / 10,
      abvError: Math.round((Math.max(0, (def.og - finalBrix) * BRIX_TO_ABV) - predictedAbv) * 10) / 10,
    },
  };

  const archive = {
    ph: phPts,
    temperature: tempPts,
    pressurePSI: pressurePts,
    sugarHistory: sugarPts,
  };

  return { summary, archive };
}

function parseArgs(argv) {
  const args = { dryRun: true, confirm: false, check: false, clean: false, harvest: false, baseline: false, batch: null, ripe: null, unripe: null, key: null, email: null, password: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--confirm") {
      args.confirm = true;
      args.dryRun = false;
      args.check = false;
    } else if (argv[i] === "--dry-run") {
      args.dryRun = true;
      args.confirm = false;
      args.check = false;
    } else if (argv[i] === "--check") {
      args.check = true;
      args.dryRun = false;
      args.confirm = false;
    } else if (argv[i] === "--clean-junk") {
      args.clean = true;
    } else if (argv[i] === "--harvest") {
      // Independent of --confirm/--dry-run: it never resets them, so
      // `--harvest ... --confirm` leaves both flags true.
      args.harvest = true;
    } else if (argv[i] === "--baseline") {
      args.baseline = true;
    } else if (argv[i] === "--key") args.key = argv[++i];
    else if (argv[i] === "--batch") args.batch = argv[++i];
    else if (argv[i] === "--ripe") args.ripe = argv[++i];
    else if (argv[i] === "--unripe") args.unripe = argv[++i];
    else if (argv[i] === "--email") args.email = argv[++i];
    else if (argv[i] === "--password") args.password = argv[++i];
  }
  // Reject ambiguous invocations instead of last-flag-wins: `--dry-run` with
  // `--confirm` in either order must never silently perform a real write.
  if (argv.includes("--dry-run") && argv.includes("--confirm")) {
    console.error("Conflicting flags: --dry-run and --confirm. Pick one (dry-run is the default).");
    process.exit(1);
  }
  if ([args.check, args.clean, args.harvest, args.baseline].filter(Boolean).length > 1) {
    console.error("Conflicting modes: choose one of --check, --clean-junk, --harvest, --baseline.");
    process.exit(1);
  }
  args.email ??= process.env.SEED_EMAIL ?? null;
  args.password ??= process.env.SEED_PASSWORD ?? null;
  return args;
}

async function signInDb(email, password) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  await signInWithEmailAndPassword(auth, email, password);
  return getDatabase(app);
}

async function readAllHistory(db) {
  const historyRef = ref(db, "fermentation/history");
  const snap = await get(historyRef);
  if (!snap.exists()) return [];
  // `key` LAST: a record must never be able to shadow its own RTDB key — a
  // planted `key` field would otherwise redirect an update (or a --clean-junk
  // delete) to the history root or a phantom path.
  return Object.entries(snap.val()).map(([key, b]) => ({ ...(b || {}), key }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const batches = BATCH_DEFS.map((def, i) => ({ def, ...buildBatch(def, i, now) }));

  console.log("Demo batches to seed (house recipe 2kg/3kg/3L, OG ~30, 3-week ferment):");
  for (const b of batches) {
    const s = b.summary;
    console.log(
      `  ${s.batchId}: OG ${s.startingBrix} → ${s.targetBrixAchieved} Brix, ` +
        `ABV actual ${s.aiAccuracy.actualAbv}% vs predicted ${s.aiAccuracy.predictedAbv}%, ` +
        `completed ${new Date(s.completedAt).toLocaleDateString()}`
    );
  }

  if (args.check) {
    if (!args.email || !args.password) {
      console.error("Missing credentials. Pass --email/--password (or set SEED_EMAIL/SEED_PASSWORD).");
      process.exitCode = 1;
      return;
    }
    const db = await signInDb(args.email, args.password);
    const rows = await readAllHistory(db);
    console.log(`fermentation/history holds ${rows.length} record(s):`);
    for (const r of rows) {
      console.log(
        `  ${r.batchId ?? "(no batchId)"} | key ${r.key} | ` +
          `completed ${typeof r.completedAt === "number" ? new Date(r.completedAt).toLocaleDateString() : "?"} | ` +
          `OG ${r.startingBrix ?? "?"} → ${r.targetBrixAchieved ?? "?"} Brix`
      );
    }
    if (rows.length === 0) {
      console.log("Empty — the seed data was never written (dry-run writes nothing).");
    }
    return;
  }

  // Purge malformed history records (no batchId): these are exactly what the
  // Reports screen now hides. Preview by default; --confirm deletes for real.
  if (args.clean) {
    if (!args.email || !args.password) {
      console.error("Missing credentials. Pass --email/--password (or set SEED_EMAIL/SEED_PASSWORD).");
      process.exitCode = 1;
      return;
    }
    const db = await signInDb(args.email, args.password);
    const rows = await readAllHistory(db);
    const junk = rows.filter((r) => typeof r.batchId !== "string" || r.batchId.trim() === "");
    console.log(`Found ${junk.length} malformed record(s) out of ${rows.length}:`);
    for (const j of junk) {
      console.log(`  key ${j.key} | completedAt ${typeof j.completedAt === "number" ? new Date(j.completedAt).toLocaleDateString() : "?"} | keys: ${Object.keys(j).filter((k) => k !== "key").join(", ") || "(empty)"}`);
    }
    if (junk.length === 0) return;
    if (!args.confirm) {
      console.log("Preview only — nothing deleted. Add --confirm to delete these records.");
      return;
    }
    for (const j of junk) {
      await remove(ref(db, `fermentation/history/${j.key}`));
      console.log(`  DELETED history/${j.key}.`);
    }
    console.log("Done.");
    return;
  }

  // Stamp weighed-harvest numbers onto batch "<id>" wherever it lives: the live
  // batch's details (the Fruit Sorting page reads that) and/or its history
  // record (the Batch Record sheet reads that). `update` (not `set`), so the
  // rest of each target survives.
  if (args.harvest) {
    const batchId = typeof args.batch === "string" ? args.batch.trim() : "";
    const rawRipe = args.ripe == null ? "" : String(args.ripe).trim();
    const rawUnripe = args.unripe == null ? "" : String(args.unripe).trim();
    const ripeKg = Number(rawRipe);
    const unripeKg = Number(rawUnripe);
    if (!batchId) {
      console.error('Missing --batch. Pass the batchId exactly as stored, e.g. --batch "Batch #8208".');
      process.exitCode = 1;
      return;
    }
    // Trim before Number(): Number("  ") is 0, which would otherwise write a
    // fabricated 0 kg onto a real production record.
    if (!rawRipe || !rawUnripe || !Number.isFinite(ripeKg) || !Number.isFinite(unripeKg) || ripeKg < 0 || unripeKg < 0) {
      console.error(`Missing/invalid --ripe/--unripe. Both must be numbers >= 0 (got ripe=${args.ripe} unripe=${args.unripe}).`);
      process.exitCode = 1;
      return;
    }
    if (args.dryRun || !args.confirm) {
      console.log(`\nDRY RUN — nothing written. Would stamp ${ripeKg} kg ripe / ${unripeKg} kg unripe onto batch "${batchId}" wherever it lives:`);
      console.log("  · active batch    → fermentation/currentBatch/details/harvest   (if its batchId matches)");
      console.log("  · history record  → fermentation/history/{key}.harvest          (if its batchId matches)");
      console.log("  Re-run with --confirm (plus credentials) to write.");
      return;
    }
    if (!args.email || !args.password) {
      console.error("Missing credentials. Pass --email/--password (or set SEED_EMAIL/SEED_PASSWORD).");
      process.exitCode = 1;
      return;
    }
    const db = await signInDb(args.email, args.password);

    // Collect every place this batchId lives; each write is verified separately.
    const targets = [];
    const details = (await get(ref(db, "fermentation/currentBatch/details"))).val();
    if (details && details.batchId === batchId) {
      targets.push({
        label: "active batch (Fruit Sorting page)",
        path: "fermentation/currentBatch",
        patch: { "details/harvest/ripeKg": ripeKg, "details/harvest/unripeKg": unripeKg },
        harvestPath: "fermentation/currentBatch/details/harvest",
        batchPath: "fermentation/currentBatch/details/batchId",
      });
    }
    const rows = await readAllHistory(db);
    const matches = rows.filter((r) => r.batchId === batchId);
    if (matches.length > 1) {
      console.error(`Ambiguous: ${matches.length} history records share batchId "${batchId}" (keys: ${matches.map((m) => m.key).join(", ")}). Nothing written.`);
      process.exitCode = 1;
      return;
    }
    if (matches.length === 1) {
      targets.push({
        label: "history record (Batch Record sheet)",
        path: `fermentation/history/${matches[0].key}`,
        patch: { "harvest/ripeKg": ripeKg, "harvest/unripeKg": unripeKg },
        harvestPath: `fermentation/history/${matches[0].key}/harvest`,
        batchPath: `fermentation/history/${matches[0].key}/batchId`,
      });
    }
    if (targets.length === 0) {
      console.error(`Batch "${batchId}" is neither the active batch nor in fermentation/history. History:`);
      for (const r of rows) console.log(`  ${r.batchId ?? "(no batchId)"} | key ${r.key}`);
      process.exitCode = 1;
      return;
    }
    for (const t of targets) {
      try {
        await update(ref(db, t.path), t.patch);
      } catch (e) {
        console.error(`  FAILED ${t.label}: ${e?.code || e?.message || e}`);
        process.exitCode = 1;
        return;
      }
      const h = (await get(ref(db, t.harvestPath))).val();
      const owner = (await get(ref(db, t.batchPath))).val();
      // Assert the owner too: if it vanished between read and write, update()
      // recreates an orphan {harvest} node that would otherwise verify clean.
      if (!h || h.ripeKg !== ripeKg || h.unripeKg !== unripeKg || owner !== batchId) {
        console.error(`  VERIFY FAILED — ${t.harvestPath} = ${JSON.stringify(h ?? null)} (owner ${JSON.stringify(owner ?? null)}).`);
        process.exitCode = 1;
        return;
      }
      console.log(`  WROTE ${t.harvestPath} = ${JSON.stringify(h)} — ${t.label}.`);
    }
    console.log("Done.");
    return;
  }

  // Backfill the sorting baseline on the LIVE batch: a batch started before the
  // feature has no details.sortingBaseline, so the Fruit Sorting page can never
  // attribute counts. `""` = whole log (count every entry), else a key to slice
  // after. Only details/sortingBaseline is written.
  if (args.baseline) {
    const key = args.key == null ? "" : String(args.key).trim();
    const patch = { "details/sortingBaseline": { key } };
    if (args.dryRun || !args.confirm) {
      console.log("\nDRY RUN — nothing written. Would set fermentation/currentBatch/details/sortingBaseline:");
      console.log(`  ${JSON.stringify(patch)}  (empty key = count the whole log)`);
      console.log("  Re-run with --confirm (plus credentials) to write.");
      return;
    }
    if (!args.email || !args.password) {
      console.error("Missing credentials. Pass --email/--password (or set SEED_EMAIL/SEED_PASSWORD).");
      process.exitCode = 1;
      return;
    }
    const db = await signInDb(args.email, args.password);
    // Guard: update() would CREATE the node on a batch that isn't running,
    // leaving an orphan baseline behind after the batch ends.
    const detailsSnap = await get(ref(db, "fermentation/currentBatch/details"));
    if (!detailsSnap.exists()) {
      console.error("No active batch (fermentation/currentBatch/details is empty). Nothing written.");
      process.exitCode = 1;
      return;
    }
    try {
      await update(ref(db, "fermentation/currentBatch"), patch);
    } catch (e) {
      console.error(`  FAILED baseline: ${e?.code || e?.message || e}`);
      process.exitCode = 1;
      return;
    }
    const verify = (await get(ref(db, "fermentation/currentBatch/details/sortingBaseline"))).val();
    // "" survives RTDB; compare on the key we meant to write.
    if (!verify || verify.key !== key) {
      console.error(`  VERIFY FAILED — details/sortingBaseline = ${JSON.stringify(verify ?? null)}.`);
      process.exitCode = 1;
      return;
    }
    const batchId = detailsSnap.val()?.batchId ?? "the active batch";
    console.log(`  WROTE fermentation/currentBatch/details/sortingBaseline = ${JSON.stringify(verify)} (${batchId}).`);
    console.log("Done.");
    return;
  }

  if (args.dryRun || !args.confirm) {
    console.log("\nDRY RUN — nothing written. Re-run with --confirm (plus credentials) to write.");
    return;
  }

  if (!args.email || !args.password) {
    console.error("Missing credentials. Pass --email/--password (or set SEED_EMAIL/SEED_PASSWORD).");
    process.exitCode = 1;
    return;
  }

  const db = await signInDb(args.email, args.password);

  const existingSnap = await get(ref(db, "fermentation/history"));
  const existingIds = new Set();
  const existingKeys = new Map();
  if (existingSnap.exists()) {
    Object.entries(existingSnap.val()).forEach(([key, b]) => {
      if (b && typeof b.batchId === "string") {
        existingIds.add(b.batchId);
        if (!existingKeys.has(b.batchId)) existingKeys.set(b.batchId, key);
      }
    });
  }

  async function archiveExists(key) {
    try {
      const snap = await get(ref(db, `sensorArchive/${key}`));
      return snap.exists();
    } catch {
      return false;
    }
  }

  const writtenIds = [];
  for (const b of batches) {
    // Retry-safe: a previous run may have written the summary but failed the
    // archive (e.g. missing sensorArchive rules). Backfill the archive
    // instead of skipping-and-leaving-it-broken forever.
    if (existingIds.has(b.def.batchId)) {
      const key = existingKeys.get(b.def.batchId);
      if (key && !(await archiveExists(key))) {
        try {
          await set(ref(db, `sensorArchive/${key}`), b.archive);
          console.log(`  REPAIRED archive for ${b.def.batchId} (history/${key}).`);
          writtenIds.push(b.def.batchId);
        } catch (e) {
          console.error(`  FAILED archive for ${b.def.batchId}: ${e?.code || e?.message || e}`);
          process.exitCode = 1;
          return;
        }
      } else {
        console.log(`  SKIP ${b.def.batchId}: already present.`);
      }
      continue;
    }
    try {
      const newRef = push(ref(db, "fermentation/history"));
      await set(newRef, b.summary);
      await set(ref(db, `sensorArchive/${newRef.key}`), b.archive);
      writtenIds.push(b.def.batchId);
      console.log(`  WROTE ${b.def.batchId} -> history/${newRef.key} (+ sensorArchive).`);
    } catch (e) {
      console.error(
        `  FAILED ${b.def.batchId}: ${e?.code || e?.message || e}\n` +
          `  If this is PERMISSION_DENIED, your database rules lack a sensorArchive stanza.\n` +
          `  Add this next to your fermentation/sensors rules and retry:\n` +
          `    "sensorArchive": { ".read": true, ".write": true },`
      );
      process.exitCode = 1;
      return;
    }
  }

  // Verify: re-read and confirm every written batch is actually there.
  const verifySnap = await get(ref(db, "fermentation/history"));
  const verifyIds = new Set();
  if (verifySnap.exists()) {
    Object.values(verifySnap.val()).forEach((b) => {
      if (b && typeof b.batchId === "string") verifyIds.add(b.batchId);
    });
  }
  const missing = writtenIds.filter((id) => !verifyIds.has(id));
  if (missing.length > 0) {
    console.error(`  VERIFY FAILED — not found after write: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  VERIFIED ${writtenIds.length} batch(es) readable in fermentation/history.`);
  console.log("Done. Live batch and sensor paths untouched.");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  });
