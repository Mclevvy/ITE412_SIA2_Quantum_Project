import { useState } from "react";
import { db } from "../lib/firebase";
import { get, push, ref, set, update } from "firebase/database";
import { endBatch, startBatch } from "../lib/batchWrites";
import { getBrixToAbvFactor } from "../lib/abvModel";
import { writeErrorMessage } from "../lib/rtdbError";
import type { DashboardLive } from "./useDashboardLive";

/**
 * Batch lifecycle + measurement-logging actions for the Dashboard (moved
 * verbatim out of Dashboard.tsx). Owns the modal/form state for the start,
 * stop, sugar-test, OG-correction, and hydrometer-check dialogs. Reads live
 * values through the DashboardLive object; batch writes still go through
 * src/lib/batchWrites.ts.
 */
export function useBatchActions(live: DashboardLive) {
  const [isStopModalOpen, setIsStopModalOpen] = useState<boolean>(false);
  const [isEndingBatch, setIsEndingBatch] = useState<boolean>(false);

  // Shared in-flight guard for the measurement-log writes below (sugar test,
  // OG correction, hydrometer check): a double-tap could push two history
  // records, and a rejected write used to close the modal as if it had saved.
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Same in-flight guard for Start Batch: a double-tap could push two batch
  // records and clear the sensor state twice.
  const [isStarting, setIsStarting] = useState<boolean>(false);

  const [isStartModalOpen, setIsStartModalOpen] = useState<boolean>(false);
  const [newBatch, setNewBatch] = useState({ volume: '', fruits: '', targetBrix: '2.0', initialBrix: '' });

  // Manual sugar (Brix) test entry
  const [isSugarModalOpen, setIsSugarModalOpen] = useState<boolean>(false);
  const [sugarInput, setSugarInput] = useState<string>('');
  const [sugarInstrument, setSugarInstrument] = useState<'hydrometer' | 'refractometer'>('hydrometer');

  // In-place Starting Brix (OG) correction for the active batch — lets the
  // operator fix a missing/wrong OG (e.g. batches started before OG capture
  // existed) without touching the Firebase console.
  const [isOgEditing, setIsOgEditing] = useState<boolean>(false);
  const [ogInput, setOgInput] = useState<string>('');

  // Non-destructive hydrometer check: records a hydrometer-derived ABV
  // alongside whatever the app currently estimates, so ML accuracy can be
  // validated on a LIVE batch — no need to end the batch (which archives and
  // clears everything) just to compare numbers.
  const [isHydroModalOpen, setIsHydroModalOpen] = useState<boolean>(false);
  const [hydroAbvInput, setHydroAbvInput] = useState<string>('');
  // "actual" = (OG−FG)×131.25 from today's hydrometer pair (should match the
  // app now). "potential" = what OG becomes fully dry (big Δ mid-batch that
  // converges toward ~0 at dryness — that convergence IS the validation).
  const [hydroCheckType, setHydroCheckType] = useState<'actual' | 'potential'>('actual');

  const handleStartBatch = async (e: any) => {
    e.preventDefault();
    if (!db || isStarting) return;

    // Validate BEFORE touching the database: Number('') is 0 and a cleared
    // form field yields NaN, which RTDB rejects — clearing the sensors first
    // would leave the batch unset with its history already destroyed.
    const initialBrix = Number(newBatch.initialBrix);
    if (!Number.isFinite(initialBrix) || initialBrix <= 0) {
      console.error("Start Batch: starting Brix (OG) must be a number above 0", newBatch.initialBrix);
      window.alert("Enter the Starting Brix (OG) — the Day-0 must reading, e.g. 30.");
      return;
    }

    // After every validation return above: they must not latch the guard.
    setIsStarting(true);
    try {
      // Shared writer (src/lib/batchWrites.ts): one atomic write records the
      // batch and clears the previous batch's sensor state, so a new batch
      // never shows old readings and they can never be archived under it.
      await startBatch({
        db,
        volume: newBatch.volume,
        fruits: newBatch.fruits,
        targetBrix: Number(newBatch.targetBrix),
        initialBrix,
        overallProgress: 0,
      });

      live.resetLiveState();
    } catch (error) {
      console.error("Failed to start batch:", error);
      window.alert(writeErrorMessage(error, "Could not start the batch. Nothing was changed — check your connection and try again."));
      return;
    } finally {
      setIsStarting(false);
    }

    setIsStartModalOpen(false);
    setNewBatch({ volume: '', fruits: '', targetBrix: '2.0', initialBrix: '' });
  };

  const handleStopBatch = async () => {
    if (!db || isEndingBatch) return;

    // In-flight guard: a double-tap used to push two history records for the
    // same batch. The write itself is atomic, but nothing stops a second call.
    setIsEndingBatch(true);

    try {
      // Shared writer (src/lib/batchWrites.ts): one atomic write pushes the
      // history record with starting Brix + AI accuracy + the measured final
      // Brix, archives the raw sensor series under the same key, and clears
      // the live state.
      await endBatch({
        db,
        details: live.activeBatchDetails,
        currentBrix: live.brixNow,
        currentTemp: live.tempNow,
        currentPh: live.phNow,
      });
    } catch (error) {
      console.error("Failed to end batch:", error);
      window.alert(writeErrorMessage(error, "Could not archive this batch. It is still active — check your connection and try again."));
      setIsEndingBatch(false);
      return;
    }

    setIsStopModalOpen(false);
    setIsEndingBatch(false);
  };

  // Manual sugar (Brix) test entry — the owner/operator measures Brix by hand
  // (hydrometer/refractometer) and logs the result here instead of a sensor reading it.
  // NOTE on instruments: a refractometer is only accurate before alcohol is
  // present (Day-0 OG). Once fermentation is underway, alcohol inflates the
  // reading by several Brix — use a hydrometer for in-progress readings.
  // The instrument is stored with each reading so future analysis can tell
  // corrected (hydrometer) values apart from inflated refractometer ones.
  const handleLogSugarTest = async (e: any) => {
    e.preventDefault();
    if (!db || isSaving) return;

    const brix = Number(sugarInput);
    if (!Number.isFinite(brix) || brix < 0) return;

    const now = live.getServerNow();
    const sugarCurrentRef = ref(db, 'sensors/sugar/current');

    setIsSaving(true);
    try {
      // Archive the previous reading (if any) before overwriting it — but never
      // a soft-sensor estimate, which is model output, not a measurement.
      const prevSnap = await get(sugarCurrentRef);
      const prev = prevSnap.exists() ? prevSnap.val() : null;
      if (
        prev &&
        typeof prev.time === 'number' &&
        typeof prev.brix === 'number' &&
        prev.source !== 'predicted'
      ) {
        await push(ref(db, 'sensors/sugar/history'), {
          brix: Number(prev.brix),
          time: Number(prev.time),
          ...(typeof prev.instrument === 'string' ? { instrument: prev.instrument } : {}),
        });
      }

      await set(sugarCurrentRef, { brix, time: now, source: 'manual', instrument: sugarInstrument });

      live.markSugarTestLogged();
      setIsSugarModalOpen(false);
      setSugarInput('');
    } catch (error) {
      console.error('Failed to log sugar test:', error);
      window.alert(writeErrorMessage(error, 'Could not log this Brix reading — the previous reading is unchanged. Check your connection and try again.'));
    } finally {
      setIsSaving(false);
    }
  };

  // Correct the active batch's Starting Brix (OG). Written straight into
  // the batch details record; the live Alcohol % switches to the sugar-drop
  // calculation as soon as a valid OG exists.
  const handleSaveOg = async (e: any) => {
    e.preventDefault();
    if (!db || isSaving) return;
    const og = Number(ogInput);
    if (!Number.isFinite(og) || og <= 0 || og > 60) return;
    setIsSaving(true);
    try {
      await update(ref(db, 'fermentation/currentBatch/details'), { initialBrix: og });
      setIsOgEditing(false);
      setOgInput('');
    } catch (error) {
      console.error('Failed to save OG correction:', error);
      window.alert(writeErrorMessage(error, 'Could not save the corrected Starting Brix — nothing was changed. Check your connection and try again.'));
    } finally {
      setIsSaving(false);
    }
  };

  // Append one hydrometer-vs-app comparison. Purely additive — batch details,
  // sensors, and history are untouched, so this is safe on a live batch.
  const handleSaveHydroCheck = async (e: any) => {
    e.preventDefault();
    if (!db || isSaving) return;
    const habv = Number(hydroAbvInput);
    if (!Number.isFinite(habv) || habv < 0 || habv > 60) return;
    setIsSaving(true);
    try {
      await push(ref(db, 'fermentation/currentBatch/hydrometerChecks'), {
        checkedAt: live.getServerNow(),
        hydrometerAbv: habv,
        checkType: hydroCheckType,
        modelAbv: live.estimatedAbv !== null ? live.estimatedAbv.value : null,
        basis: live.estimatedAbv !== null ? live.estimatedAbv.basis : 'none',
        ogBrix: live.ogBrixForCheck,
        currentBrix: live.brixNow,
        factor: getBrixToAbvFactor(),
      });
      setIsHydroModalOpen(false);
      setHydroAbvInput('');
    } catch (error) {
      console.error('Failed to save hydrometer check:', error);
      window.alert(writeErrorMessage(error, 'Could not save this hydrometer check — nothing was recorded. Check your connection and try again.'));
    } finally {
      setIsSaving(false);
    }
  };

  return {
    isStopModalOpen,
    setIsStopModalOpen,
    isEndingBatch,
    isStartModalOpen,
    setIsStartModalOpen,
    newBatch,
    setNewBatch,
    isSugarModalOpen,
    setIsSugarModalOpen,
    sugarInput,
    setSugarInput,
    sugarInstrument,
    setSugarInstrument,
    isOgEditing,
    setIsOgEditing,
    ogInput,
    setOgInput,
    isHydroModalOpen,
    setIsHydroModalOpen,
    hydroAbvInput,
    setHydroAbvInput,
    hydroCheckType,
    setHydroCheckType,
    handleStartBatch,
    handleStopBatch,
    handleLogSugarTest,
    handleSaveOg,
    handleSaveHydroCheck,
  };
}
