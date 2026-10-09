import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../lib/firebase";
import {
  onValue,
  query,
  ref,
  limitToLast,
  type Database,
  push,
  serverTimestamp,
} from "firebase/database";
import { predictAbv, predictAbvFromBrixDrop, resolveInitialBrix } from "../lib/abvModel";
import {
  formatTime,
  getBrixStatus,
  getStatus,
  toPoints,
  toSugarHistoryPoints,
  type Point,
} from "../lib/sensorFormat";

export const SCALING = {
  temp: { min: 25, max: 32 },
  ph: { min: 3.2, max: 3.8 },
  // NOTE: this SCALING is the Dashboard's STATUS-BAND range (temp/ph only).
  // It is NOT the TF-model input normalization — that lives in
  // FermentationTracker/PredictiveInsights (brix 0-30, temp 15-40, ph 2.5-4.5).
  // brix 14-18 here is currently unused; sugar status uses batch-relative
  // logic (getBrixStatus + OG check) because a healthy ferment must fall
  // from OG toward the finish target.
  brix: { min: 14, max: 18 },
};

// Sugar/Brix is measured manually by the operator (no automatic sensor) and
// logged via the sugar-test action. This constant drives the "measure again"
// reminder.
export const SUGAR_TEST_INTERVAL_DAYS = 14;

/**
 * All live Firebase subscriptions for the Dashboard (moved verbatim out of
 * Dashboard.tsx): batch details, server offset, current sensors, sugar
 * readings, history tails, hydrometer-check tail, staleness flag, and the
 * alert/reminder notification writers. Returns live values plus derived
 * chart data, statuses, and ABV estimate — no JSX.
 */
export function useDashboardLive() {
  const [tempNow, setTempNow] = useState<number | null>(null);
  const [brixNow, setBrixNow] = useState<number | null>(null);
  const [phNow, setPhNow] = useState<number | null>(null);
  const [pressureNow, setPressureNow] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const [tempHistory, setTempHistory] = useState<Point[]>([]);
  const [brixHistory, setBrixHistory] = useState<Point[]>([]);
  const [phHistory, setPhHistory] = useState<Point[]>([]);
  const [pressureHistory, setPressureHistory] = useState<Point[]>([]);

  const [isLive, setIsLive] = useState(false);
  const [canNotify, setCanNotify] = useState(false);

  const [isBatchActive, setIsBatchActive] = useState<boolean>(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [activeBatchDetails, setActiveBatchDetails] = useState<any>(null);

  const [lastHydroCheck, setLastHydroCheck] = useState<any>(null);

  const serverOffsetRef = useRef<number>(0);
  // Always-fresh OG for the alert closure below (state captured by the
  // long-lived Firebase listener would otherwise go stale after an OG
  // correction until the listener re-subscribes).
  const ogBrixRef = useRef<number | null>(null);

  const lastNotifiedTemp = useRef<number | null>(null);
  const lastNotifiedPh = useRef<number | null>(null);
  const lastNotifiedBrix = useRef<number | null>(null);
  const sugarReminderNotifiedRef = useRef<boolean>(false);
  // Instrument + provenance of the current Brix reading (state, not a ref:
  // the estimatedAbv memo must recompute when they change).
  const [sugarInstrumentNow, setSugarInstrumentNow] = useState<string | null>(null);
  const [brixSource, setBrixSource] = useState<string | null>(null);
  // When the operator last actually measured (never a soft-sensor estimate):
  // the sugar-test reminder must not be silenced by our own predictions.
  const [lastManualBrixAt, setLastManualBrixAt] = useState<number | null>(null);

  const dbReady = !!db;

  useEffect(() => {
    const timer = setTimeout(() => {
      setCanNotify(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const pushNotification = async (title: string, message: string, iconName: string) => {
    if (!db) return;
    try {
      const notificationsRef = ref(db, 'notifications');
      await push(notificationsRef, {
        type: 'warning',
        title,
        message,
        timestamp: serverTimestamp(),
        iconName,
        unread: true
      });
    } catch (e) {
      console.error("Failed to push notification:", e);
    }
  };

  const checkAndTriggerNotification = (type: 'temp' | 'ph' | 'brix', value: number) => {
    if (!canNotify || !isBatchActive) return;

    // Sugar has no fixed "normal" band: falling from OG toward the finish
    // target IS healthy fermentation. The only alert-worthy state is a
    // reading above OG (wrong OG on record or inflated instrument).
    if (type === 'brix') {
      const og = ogBrixRef.current;
      if (og === null) return;
      if (value - og > 0.5) {
        if (lastNotifiedBrix.current !== value) {
          pushNotification(
            "Sugar Content Alert",
            `Sugar reading ${value.toFixed(1)} Brix is above starting Brix (${og.toFixed(1)} Brix). Check the OG or use a hydrometer.`,
            "DropletIcon"
          );
          lastNotifiedBrix.current = value;
        }
      } else {
        lastNotifiedBrix.current = null;
      }
      return;
    }

    let min, max, title, unit, icon, lastNotifiedRef;

    if (type === 'temp') {
      min = SCALING.temp.min; max = SCALING.temp.max;
      title = "Temperature Alert";
      unit = "°C";
      icon = "ThermometerIcon";
      lastNotifiedRef = lastNotifiedTemp;
    } else {
      min = SCALING.ph.min; max = SCALING.ph.max;
      title = "Acidity (pH) Alert";
      unit = "pH";
      icon = "FlaskConicalIcon";
      lastNotifiedRef = lastNotifiedPh;
    }

    const isAlert = value < min || value > max;

    if (isAlert) {
      if (lastNotifiedRef.current !== value) {
        const direction = value > max ? "high" : "low";
        const message = `${type.toUpperCase()} is too ${direction}: ${value.toFixed(1)}${unit}. Optimal range is ${min}-${max}.`;
        pushNotification(title, message, icon);
        lastNotifiedRef.current = value;
      }
    } else {
      lastNotifiedRef.current = null;
    }
  };

  useEffect(() => {
    if (!db) {
      setIsLive(false);
      return;
    }

    const database: Database = db;
    // onValue returns unsubscribe functions — use them for cleanup so
    // limitToLast queries are detached correctly.
    const unsubscribers: Array<() => void> = [];

    const batchRef = ref(database, "fermentation/currentBatch/details");
    unsubscribers.push(onValue(batchRef, (snap) => {
      if (snap.exists()) {
        setIsBatchActive(true);
        const details = snap.val();
        setActiveBatchId(details.batchId);
        setActiveBatchDetails(details);
      } else {
        setIsBatchActive(false);
        setActiveBatchId(null);
        setActiveBatchDetails(null);
      }
    }));

    const offsetRef = ref(database, ".info/serverTimeOffset");
    unsubscribers.push(onValue(offsetRef, (snap) => {
      serverOffsetRef.current = Number(snap.val()) || 0;
    }));

    const currentRef = ref(database, "sensors/current");
    unsubscribers.push(onValue(currentRef, (snap) => {
      const v = snap.val();
      if (!v) {
        setTempNow(null); setPhNow(null); setPressureNow(null);
        return;
      }
      const t = typeof v.temperature === "number" ? v.temperature : null;
      const p = typeof v.ph === "number" ? v.ph : null;

      setTempNow(t); setPhNow(p);
      setPressureNow(typeof v.pressurePSI === "number" ? v.pressurePSI : null);

      if (t !== null) checkAndTriggerNotification('temp', t);
      if (p !== null) checkAndTriggerNotification('ph', p);
    }, () => setIsLive(false)));

    // Sugar/Brix has no automatic sensor — it is entered manually by the
    // operator via the sugar-test action, which writes to this same path
    // (sensors/sugar/current) and pushes the previous reading into
    // sensors/sugar/history.
    const sugarCurrentRef = ref(database, "sensors/sugar/current");
    unsubscribers.push(onValue(sugarCurrentRef, (snap) => {
      const v = snap.val();
      if (!v) {
        setBrixNow(null);
        setSugarInstrumentNow(null);
        setBrixSource(null);
        setLastManualBrixAt(null);
        return;
      }

      const brixVal = typeof v.brix === "number" ? v.brix : null;
      setSugarInstrumentNow(typeof v.instrument === "string" ? v.instrument : null);
      const source = typeof v.source === "string" ? v.source : null;
      setBrixSource(source);
      setBrixNow(brixVal);

      if (source !== "predicted" && typeof v.time === "number") {
        setLastManualBrixAt(v.time);
      }

      if (brixVal !== null) checkAndTriggerNotification('brix', brixVal);

      if (typeof v.time === "number") {
        setUpdatedAt(v.time);
      }
    }));

    const tempQ = query(ref(database, "sensors/history/temperature"), limitToLast(30));
    const phQ = query(ref(database, "sensors/history/ph"), limitToLast(30));
    const pressureQ = query(ref(database, "sensors/history/pressurePSI"), limitToLast(30));
    const sugarHistQ = query(ref(database, "sensors/sugar/history"), limitToLast(30));

    unsubscribers.push(onValue(tempQ, (snap) => setTempHistory(toPoints(snap.val()))));
    unsubscribers.push(onValue(phQ, (snap) => setPhHistory(toPoints(snap.val()))));
    unsubscribers.push(onValue(pressureQ, (snap) => setPressureHistory(toPoints(snap.val()))));
    unsubscribers.push(onValue(sugarHistQ, (snap) => setBrixHistory(toSugarHistoryPoints(snap.val()))));

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canNotify, isBatchActive]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!updatedAt) return;
      const stale = Date.now() - updatedAt > 2 * 60 * 1000;
      setIsLive(!stale);
    }, 5000);
    return () => clearInterval(id);
  }, [updatedAt]);

  // Live tail of the hydrometer-check log (latest entry only). Read-only;
  // writing happens in the batch action and never touches batch state.
  useEffect(() => {
    if (!db || !isBatchActive) {
      setLastHydroCheck(null);
      return;
    }
    const lastCheckQ = query(ref(db, 'fermentation/currentBatch/hydrometerChecks'), limitToLast(1));
    const unsub = onValue(lastCheckQ, (snap) => {
      const v = snap.val();
      if (!v) {
        setLastHydroCheck(null);
        return;
      }
      const entries = Object.values(v) as any[];
      setLastHydroCheck(entries.length ? entries[entries.length - 1] : null);
    });
    return () => unsub();
  }, [isBatchActive]);

  // Reminds the owner to measure sugar again every SUGAR_TEST_INTERVAL_DAYS (14) days.
  const daysSinceSugarTest = useMemo(() => {
    const reference =
      lastManualBrixAt ??
      (typeof activeBatchDetails?.startedAt === 'number' ? activeBatchDetails.startedAt : null);
    if (!reference) return null;
    return Math.floor((Date.now() - reference) / (24 * 60 * 60 * 1000));
  }, [lastManualBrixAt, activeBatchDetails]);

  const sugarTestDue = isBatchActive && daysSinceSugarTest !== null && daysSinceSugarTest >= SUGAR_TEST_INTERVAL_DAYS;

  useEffect(() => {
    if (!canNotify || !isBatchActive) return;

    const checkReminder = () => {
      if (sugarTestDue && !sugarReminderNotifiedRef.current) {
        sugarReminderNotifiedRef.current = true;
        pushNotification(
          "Sugar Test Reminder",
          `It's been ${daysSinceSugarTest} days since the last sugar (Brix) test. Please measure and log a new reading.`,
          "DropletIcon"
        );
      }
    };

    checkReminder();
    const id = setInterval(checkReminder, 60 * 60 * 1000); // re-check hourly in case the tab stays open
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canNotify, isBatchActive, sugarTestDue, daysSinceSugarTest]);

  const temperatureData = useMemo(() => tempHistory.map((p) => ({ time: formatTime(p.time), value: p.value })), [tempHistory]);
  const pressureData = useMemo(() => pressureHistory.map((p) => ({ time: formatTime(p.time), value: p.value })), [pressureHistory]);
  const phData = useMemo(() => phHistory.map((p) => ({ time: formatTime(p.time), value: p.value })), [phHistory]);
  const sugarData = useMemo(() => {
    const hist = brixHistory.map((p) => ({ time: formatTime(p.time), value: p.value }));
    if (brixNow != null && updatedAt != null) {
      const lastT = brixHistory.length ? brixHistory[brixHistory.length - 1].time : 0;
      if (updatedAt > lastT) {
        hist.push({ time: formatTime(updatedAt), value: brixNow });
      }
    }
    return hist;
  }, [brixHistory, brixNow, updatedAt]);

  const estimatedAbv = useMemo(() => {
    if (!isBatchActive) return null;
    // Chemistry first: ABV from actual sugar consumed needs only OG and the
    // latest Brix reading. Falls back to the sensor-trend model for batches
    // started before OG capture existed (no initialBrix on record).
    const ogBrix = resolveInitialBrix(activeBatchDetails);
    if (ogBrix !== null && brixNow !== null) {
      const chemistry = predictAbvFromBrixDrop(ogBrix, brixNow, sugarInstrumentNow ?? undefined);
      if (chemistry !== null) {
        // Same arithmetic, different provenance: a soft-sensor estimate must
        // never be labelled "measured".
        return { value: chemistry, basis: brixSource === 'predicted' ? 'soft' as const : 'measured' as const };
      }
    }
    if (tempNow === null || phNow === null || pressureNow === null) return null;
    const startedAt = typeof activeBatchDetails?.startedAt === "number" ? activeBatchDetails.startedAt : null;
    const daysSinceStart = startedAt
      ? Math.max(1, (Date.now() - startedAt) / (24 * 60 * 60 * 1000))
      : 1;
    return {
      value: predictAbv({
        summary_average_ph: phNow,
        summary_average_temp: tempNow,
        summary_average_pressure_psi: pressureNow,
        days_since_start: daysSinceStart,
      }),
      basis: 'estimated' as const,
    };
  }, [activeBatchDetails, isBatchActive, brixNow, phNow, pressureNow, tempNow, sugarInstrumentNow, brixSource]);

  // Data-quality flag: a current reading above OG means a logging or
  // instrument error — the usual causes are an uncorrected refractometer
  // late in fermentation, or the recorded OG actually being the finish
  // target (the form's 2.0 default) instead of the Day-0 must reading.
  const ogBrixForCheck = resolveInitialBrix(activeBatchDetails);
  ogBrixRef.current = ogBrixForCheck;
  const brixAboveOg =
    ogBrixForCheck !== null && brixNow !== null && brixNow - ogBrixForCheck > 0.5;
  const finishTargetBrix =
    activeBatchDetails !== null && Number.isFinite(Number(activeBatchDetails.targetBrix))
      ? Number(activeBatchDetails.targetBrix) : null;

  const tempStatus = isBatchActive ? getStatus(tempNow, SCALING.temp.min, SCALING.temp.max) : "No Data";
  const brixStatus = getBrixStatus(brixNow, ogBrixForCheck, isBatchActive);
  const phStatus = isBatchActive ? getStatus(phNow, SCALING.ph.min, SCALING.ph.max) : "No Data";
  const pressureStatus = isBatchActive ? getStatus(pressureNow, 0, 30) : "No Data";

  /** Clears the live readings (used after Start Batch so a new batch never shows old data). */
  const resetLiveState = () => {
    setTempNow(null);
    setPhNow(null);
    setBrixNow(null);
    setPressureNow(null);
    setUpdatedAt(null);
    setSugarInstrumentNow(null);
    setBrixSource(null);
    setLastManualBrixAt(null);
    sugarReminderNotifiedRef.current = false;
  };

  const getServerNow = () => Date.now() + (serverOffsetRef.current || 0);

  /** Re-arms the sugar-test reminder (called after a reading is logged). */
  const markSugarTestLogged = () => {
    sugarReminderNotifiedRef.current = false;
  };

  return {
    dbReady,
    tempNow,
    brixNow,
    brixSource,
    phNow,
    pressureNow,
    updatedAt,
    isLive,
    isBatchActive,
    activeBatchId,
    activeBatchDetails,
    lastHydroCheck,
    temperatureData,
    pressureData,
    phData,
    sugarData,
    estimatedAbv,
    ogBrixForCheck,
    brixAboveOg,
    finishTargetBrix,
    daysSinceSugarTest,
    sugarTestDue,
    tempStatus,
    brixStatus,
    phStatus,
    pressureStatus,
    resetLiveState,
    getServerNow,
    markSugarTestLogged,
  };
}

export type DashboardLive = ReturnType<typeof useDashboardLive>;
