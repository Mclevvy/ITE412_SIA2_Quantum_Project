import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  ThermometerIcon,
  DropletIcon,
  FlaskConicalIcon,
  TrendingUpIcon,
  AlertCircleIcon,
  GaugeIcon,
  PlayCircleIcon,
  StopCircleIcon,
  AlertTriangleIcon,
  XIcon
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion } from "motion/react";
import Logo from "./Logo";
import OgCalculator from "./OgCalculator";
import { predictAbv, predictAbvFromBrixDrop, resolveInitialBrix, getBrixToAbvFactor } from "../lib/abvModel";

import { db } from "../lib/firebase";
import {
  onValue,
  query,
  ref,
  limitToLast,
  Database,
  get,
  set,
  push,
  serverTimestamp,
  update,
} from "firebase/database";

interface DashboardProps {
  userRole: string;
}

type Point = { time: number; value: number };

const SCALING = {
  temp: { min: 25, max: 32 },
  ph: { min: 3.2, max: 3.8 },
  // NOTE: SCALING.brix is the TF-model input normalization range (shared
  // with FermentationTracker / PredictiveInsights) — NOT a quality band.
  // Sugar status/alerts use batch-relative logic (getBrixStatus + OG check)
  // because a healthy ferment must fall from OG toward the finish target.
  brix: { min: 14, max: 18 }
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toPoints(obj: any): Point[] {
  if (!obj) return [];
  return Object.values(obj)
    .map((x: any) => ({ time: Number(x.time), value: Number(x.value) }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
}

function toSugarHistoryPoints(obj: any): Point[] {
  if (!obj) return [];
  return Object.values(obj)
    .map((x: any) => ({ time: Number(x.time), value: Number(x.brix) }))
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time);
}

function getStatus(value: number | null, min: number, max: number): "Normal" | "Alert" | "No Data" {
  if (value == null) return "No Data";
  if (value >= min && value <= max) return "Normal";
  return "Alert";
}

function badgeClass(status: string) {
  if (status === "Normal" || status === "On track") return "border-green-500 text-green-600 text-xs";
  if (status === "Alert" || status === "Check OG") return "border-red-500 text-red-600 text-xs";
  return "border-gray-300 text-gray-600 text-xs";
}

// Batch-relative sugar status. Fixed bands (e.g. 14-18) penalize normal
// fermentation, which must fall from OG toward the finish target — so a
// falling reading is "On track", and only a reading above OG (bad data:
// wrong OG or inflated instrument) is flagged.
function getBrixStatus(
  current: number | null,
  og: number | null,
  batchActive: boolean
): "On track" | "Check OG" | "No Data" {
  if (!batchActive || current === null) return "No Data";
  if (og !== null && current - og > 0.5) return "Check OG";
  return "On track";
}

// Sugar/Brix is measured manually by the operator (no automatic sensor) and logged
// via handleLogSugarTest below. This constant drives the "measure again" reminder.
const SUGAR_TEST_INTERVAL_DAYS = 14;
const SUGAR_TEST_INTERVAL_MS = SUGAR_TEST_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

export default function Dashboard({ userRole }: DashboardProps) {
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

  const [isStopModalOpen, setIsStopModalOpen] = useState<boolean>(false);
  
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

    // Sugar/Brix has no automatic sensor — it's entered manually by the operator via
    // handleLogSugarTest() below, which writes to this same path (sensors/sugar/current)
    // and pushes the previous reading into sensors/sugar/history.
    const sugarCurrentRef = ref(database, "sensors/sugar/current");
    unsubscribers.push(onValue(sugarCurrentRef, (snap) => {
      const v = snap.val();
      if (!v) { setBrixNow(null); return; }
      
      const brixVal = typeof v.brix === "number" ? v.brix : null;
      setBrixNow(brixVal);

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
  }, [canNotify, isBatchActive]); 

  useEffect(() => {
    const id = setInterval(() => {
      if (!updatedAt) return;
      const stale = Date.now() - updatedAt > 2 * 60 * 1000;
      setIsLive(!stale);
    }, 5000);
    return () => clearInterval(id);
  }, [updatedAt]);

  const handleStartBatch = async (e: any) => {
    e.preventDefault();
    if (!db) return;
    
    await set(ref(db, 'sensors/history'), null);
    await set(ref(db, 'sensors/sugar/history'), null);
    await set(ref(db, 'sensors/current'), null);
    await set(ref(db, 'sensors/sugar/current'), null);

    setTempNow(null);
    setPhNow(null);
    setBrixNow(null);
    setPressureNow(null);
    setUpdatedAt(null);
    sugarReminderNotifiedRef.current = false;

    await set(ref(db, 'fermentation/currentBatch'), {
      details: {
        batchId: `Batch #${Date.now().toString().slice(-4)}`,
        overallProgress: 0,
        initialVolume: `${newBatch.volume}L`,
        fruitsUsed: `${newBatch.fruits}kg`,
        targetBrix: Number(newBatch.targetBrix),
        initialBrix: Number(newBatch.initialBrix),
        startDate: new Date().toLocaleDateString(),
        startedAt: Date.now() // numeric timestamp, used to schedule the first sugar-test reminder
      },
      stages: [
        { id: 1, name: 'Sorting', status: 'completed', date: new Date().toLocaleDateString() },
        { id: 2, name: 'Fermentation', status: 'active', date: new Date().toLocaleDateString(), progress: 0 },
        { id: 3, name: 'Filtration', status: 'pending', date: 'TBD' },
        { id: 4, name: 'Harvest', status: 'pending', date: 'TBD' }
      ]
    });

    setIsStartModalOpen(false);
    setNewBatch({ volume: '', fruits: '', targetBrix: '2.0', initialBrix: '' });
  };

    const handleStopBatch = async () => {
    if (!db) return;
    
    let finalYield = "Unknown";
    if (activeBatchDetails) {
      const initVolMatch = String(activeBatchDetails.initialVolume || "0").match(/\d+/);
      const initialVolNum = initVolMatch ? parseInt(initVolMatch[0], 10) : 0;
      finalYield = initialVolNum > 0 ? `${Math.round(initialVolNum * 0.90)}L` : "Unknown";
    }

    // ============================================================
    // Archive the raw per-reading sensor + Brix trend data BEFORE it gets
    // cleared below. Without this, only the coarse averages survive — the
    // ML pipeline needs the actual time series to build trend features,
    // and this is the only point where that data still exists for the
    // batch that's ending. Moved to the top of the function so
    // `startingBrix` (below) is available for the aiAccuracy comparison
    // that follows.
    // ============================================================
    const [phSnap, tempSnap, pressureSnap, sugarHistSnap] = await Promise.all([
      get(ref(db, 'sensors/history/ph')),
      get(ref(db, 'sensors/history/temperature')),
      get(ref(db, 'sensors/history/pressurePSI')),
      get(ref(db, 'sensors/sugar/history')),
    ]);

    const sugarHistoryVal = sugarHistSnap.exists() ? sugarHistSnap.val() : null;

    // The FIRST manual Brix reading logged for this batch = true Original
    // Gravity, if the operator logged one at Day 0. This removes the need
    // for a separate "starting Brix" input field entirely — just log a
    // sugar test right when a batch starts, same button as always.
    // Prefer the explicit OG captured by the Start Batch form (most
    // reliable); fall back to the earliest sugar log for older batches.
    let startingBrix: number | null = resolveInitialBrix(activeBatchDetails);
    if (startingBrix === null && sugarHistoryVal) {
      const readings = Object.values(sugarHistoryVal) as { brix: number; time: number }[];
      readings.sort((a, b) => a.time - b.time);
      if (readings.length > 0) startingBrix = readings[0].brix;
    }
    // ============================================================

    // Compare the AI's last live prediction (saved by PredictiveInsights.tsx) against what
    // actually happened, so we can measure real-world model accuracy over time instead of
    // just trusting it. See the "AI Prediction Accuracy" section in ReportsAnalytics.tsx.
    let aiAccuracy: any = null;
    try {
      const predSnap = await get(ref(db, 'fermentation/currentBatch/aiPrediction'));
      const prediction = predSnap.exists() ? predSnap.val() : null;

      if (prediction && typeof prediction.capturedAt === 'number') {
        const completedAt = Date.now();
        const actualDaysFromPrediction = Math.max(
          0,
          Math.round((completedAt - prediction.capturedAt) / (24 * 60 * 60 * 1000))
        );
        const daysError = actualDaysFromPrediction - (prediction.predictedDaysRemaining ?? 0);

        const predictedQualityGrade: 'premium' | 'good' | 'standard' =
          prediction.predictedQualityPercent >= 85 ? 'premium' : prediction.predictedQualityPercent >= 70 ? 'good' : 'standard';

        let actualQualityGrade: 'premium' | 'standard' | 'below' | 'unknown' = 'unknown';
        if (brixNow !== null) {
          if (brixNow >= 15 && brixNow <= 18) actualQualityGrade = 'premium';
          else if (brixNow >= 13 && brixNow < 15) actualQualityGrade = 'standard';
          else actualQualityGrade = 'below';
        }

        const qualityMatch =
          actualQualityGrade !== 'unknown' &&
          ((predictedQualityGrade === 'premium' && actualQualityGrade === 'premium') ||
            (predictedQualityGrade === 'good' && actualQualityGrade !== 'below') ||
            (predictedQualityGrade === 'standard' && actualQualityGrade !== 'premium'));

        // NEW: ABV accuracy. actualAbv uses the same Brix->ABV formula the
        // Python training pipeline uses (config.BRIX_TO_ABV_FACTOR = 0.59)
        // — keep these in sync if that constant ever changes.
        // Skipped when the drop isn't positive: a current reading at or above
        // OG means bad inputs (wrong OG or inflated refractometer), and
        // scoring that 0% against the prediction would poison the accuracy log.
        let actualAbv: number | null = null;
        if (startingBrix !== null && brixNow !== null && startingBrix - brixNow > 0.5) {
          actualAbv = (startingBrix - brixNow) * 0.59;
        }
        const predictedAbv: number | null = typeof prediction.predictedAbv === 'number' ? prediction.predictedAbv : null;
        const abvError = (predictedAbv !== null && actualAbv !== null) ? actualAbv - predictedAbv : null;

        aiAccuracy = {
          predictedAt: prediction.capturedAt,
          predictedDaysRemaining: prediction.predictedDaysRemaining ?? null,
          actualDaysFromPrediction,
          daysError,
          predictedQualityPercent: prediction.predictedQualityPercent ?? null,
          predictedQualityGrade,
          actualQualityGrade,
          qualityMatch,
          predictedRiskPercent: prediction.predictedRiskPercent ?? null,
          predictedAbv,
          actualAbv,
          abvError,
        };
      }
    } catch (e) {
      console.error("Failed to read AI prediction for accuracy tracking:", e);
    }

    const historyRef = push(ref(db, 'fermentation/history'));
    
    await set(historyRef, {
      batchId: activeBatchId || "Legacy Batch",
      startDate: activeBatchDetails?.startDate || "Unknown Date", 
      completedAt: Date.now(),
      finalYield: finalYield,
      fruitsUsed: activeBatchDetails?.fruitsUsed || "Unknown",
      targetBrixAchieved: brixNow !== null ? brixNow.toFixed(1) : "Unknown",
      startingBrix: startingBrix !== null ? startingBrix.toFixed(1) : "Unknown",
      averageTemp: tempNow !== null ? tempNow.toFixed(1) : "N/A",
      averagePh: phNow !== null ? phNow.toFixed(1) : "N/A",
      ...(aiAccuracy ? { aiAccuracy } : {})
    });

    // Archive the raw time series under the SAME push key as the history
    // summary above, so the ML pipeline can join them directly.
    await set(ref(db, `sensorArchive/${historyRef.key}`), {
      ph: phSnap.exists() ? phSnap.val() : null,
      temperature: tempSnap.exists() ? tempSnap.val() : null,
      pressurePSI: pressureSnap.exists() ? pressureSnap.val() : null,
      sugarHistory: sugarHistoryVal,
    });

    await set(ref(db, 'fermentation/currentBatch'), null);
    await set(ref(db, 'sensors/history'), null);
    await set(ref(db, 'sensors/sugar/history'), null);
    
    setIsStopModalOpen(false); 
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
    if (!db) return;

    const brix = Number(sugarInput);
    if (!Number.isFinite(brix) || brix < 0) return;

    const now = Date.now() + (serverOffsetRef.current || 0);
    const sugarCurrentRef = ref(db, 'sensors/sugar/current');

    // Archive the previous reading (if any) before overwriting it
    const prevSnap = await get(sugarCurrentRef);
    const prev = prevSnap.exists() ? prevSnap.val() : null;
    if (prev && typeof prev.time === 'number' && typeof prev.brix === 'number') {
      await push(ref(db, 'sensors/sugar/history'), {
        brix: Number(prev.brix),
        time: Number(prev.time),
        ...(typeof prev.instrument === 'string' ? { instrument: prev.instrument } : {}),
      });
    }

    await set(sugarCurrentRef, { brix, time: now, source: 'manual', instrument: sugarInstrument });

    sugarReminderNotifiedRef.current = false;
    setIsSugarModalOpen(false);
    setSugarInput('');
  };

  // Correct the active batch's Starting Brix (OG). Written straight into
  // the batch details record; the live Alcohol % switches to the sugar-drop
  // calculation as soon as a valid OG exists.
  const handleSaveOg = async (e: any) => {
    e.preventDefault();
    if (!db) return;
    const og = Number(ogInput);
    if (!Number.isFinite(og) || og <= 0 || og > 60) return;
    await update(ref(db, 'fermentation/currentBatch/details'), { initialBrix: og });
    setIsOgEditing(false);
    setOgInput('');
  };

  // Append one hydrometer-vs-app comparison. Purely additive — batch details,
  // sensors, and history are untouched, so this is safe on a live batch.
  const handleSaveHydroCheck = async (e: any) => {
    e.preventDefault();
    if (!db) return;
    const habv = Number(hydroAbvInput);
    if (!Number.isFinite(habv) || habv < 0 || habv > 60) return;
    await push(ref(db, 'fermentation/currentBatch/hydrometerChecks'), {
      checkedAt: Date.now() + (serverOffsetRef.current || 0),
      hydrometerAbv: habv,
      checkType: hydroCheckType,
      modelAbv: estimatedAbv !== null ? estimatedAbv.value : null,
      basis: estimatedAbv !== null ? estimatedAbv.basis : 'none',
      ogBrix: ogBrixForCheck,
      currentBrix: brixNow,
      factor: getBrixToAbvFactor(),
    });
    setIsHydroModalOpen(false);
    setHydroAbvInput('');
  };

  // Reminds the owner to measure sugar again every SUGAR_TEST_INTERVAL_DAYS (14) days.
  const daysSinceSugarTest = useMemo(() => {
    const reference = updatedAt ?? (typeof activeBatchDetails?.startedAt === 'number' ? activeBatchDetails.startedAt : null);
    if (!reference) return null;
    return Math.floor((Date.now() - reference) / (24 * 60 * 60 * 1000));
  }, [updatedAt, activeBatchDetails]);

  const sugarTestDue = isBatchActive && daysSinceSugarTest !== null && daysSinceSugarTest >= SUGAR_TEST_INTERVAL_DAYS;

  // Live tail of the hydrometer-check log (latest entry only). Read-only;
  // writing happens in handleSaveHydroCheck and never touches batch state.
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
      const chemistry = predictAbvFromBrixDrop(ogBrix, brixNow);
      if (chemistry !== null) return { value: chemistry, basis: 'measured' as const };
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
  }, [activeBatchDetails, isBatchActive, brixNow, phNow, pressureNow, tempNow]);

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

  // Latest hydrometer-check verdict. Actual checks should match the app now
  // (|Δ| ≤ 1). A potential check (what OG becomes fully dry) exceeds the live
  // app value by exactly the alcohol still locked in residual sugar, so the
  // expected gap is current × factor — that gap converging to ~0 at dryness
  // is the validation signal, not an error.
  const hydroMeter =
    lastHydroCheck !== null && typeof lastHydroCheck.hydrometerAbv === "number"
      ? Number(lastHydroCheck.hydrometerAbv) : null;
  const hydroModel =
    lastHydroCheck !== null && typeof lastHydroCheck.modelAbv === "number"
      ? Number(lastHydroCheck.modelAbv) : null;
  const hydroDelta = hydroMeter !== null && hydroModel !== null ? hydroMeter - hydroModel : null;
  const hydroType = lastHydroCheck !== null && lastHydroCheck.checkType === "potential" ? "potential" : "actual";
  const hydroCheckCur =
    lastHydroCheck !== null && typeof lastHydroCheck.currentBrix === "number" ? Number(lastHydroCheck.currentBrix) : null;
  const hydroFactor =
    lastHydroCheck !== null && typeof lastHydroCheck.factor === "number" && lastHydroCheck.factor > 0
      ? Number(lastHydroCheck.factor) : getBrixToAbvFactor();
  const hydroExpectedGap =
    hydroCheckCur !== null ? Math.max(0, hydroCheckCur * hydroFactor) : null;
  const hydroVerdict: "agree" | "consistent" | "check" | null =
    hydroDelta === null ? null
    : hydroType === "actual"
      ? (Math.abs(hydroDelta) <= 1 ? "agree" : "check")
      : (hydroExpectedGap !== null && Math.abs(hydroDelta - hydroExpectedGap) <= 1.5 ? "consistent" : "check");
  // A check row is a frozen snapshot of the moment it was logged — never a
  // live number. Dating it makes stale comparisons obvious at a glance.
  const hydroCheckedAt =
    lastHydroCheck !== null && typeof lastHydroCheck.checkedAt === "number"
      ? new Date(Number(lastHydroCheck.checkedAt)).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;

  const tempStatus = isBatchActive ? getStatus(tempNow, SCALING.temp.min, SCALING.temp.max) : "No Data";
  const brixStatus = getBrixStatus(brixNow, ogBrixForCheck, isBatchActive);
  const phStatus = isBatchActive ? getStatus(phNow, SCALING.ph.min, SCALING.ph.max) : "No Data";
  const pressureStatus = isBatchActive ? getStatus(pressureNow, 0, 30) : "No Data"; 

  if (!dbReady) {
    return (
      <div className="p-4">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-sm text-red-700 font-medium">Realtime Database not available</p>
            <p className="text-xs text-red-600 mt-1">Check your src/lib/firebase.ts configuration.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-20 max-w-xl mx-auto">
      
      {/* Header */}
      <div className="flex items-center gap-3 mb-2 pt-1">
        <Logo size="xl" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#8B1538]/70">Bunius-Sense</p>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
        </div>
      </div>

      {/* ALCOHOL HERO — dark wine card */}
      <div className="rounded-3xl bg-gradient-to-br from-[#23060F] via-[#4A0E1E] to-[#8B1538] p-5 shadow-xl shadow-[#8B1538]/25 ring-1 ring-white/10 text-[#FDF8F1]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200/90">Alcohol Content</p>
            <p className="font-bold tracking-tight mt-2 text-[2.75rem] leading-none">
              {estimatedAbv !== null ? (
                <>{estimatedAbv.value.toFixed(1)}<span className="font-medium text-white/60 text-lg ml-1">% ABV</span></>
              ) : (
                <span className="text-white/40">--</span>
              )}
            </p>
            <p className="text-xs text-white/55 mt-2">
              {estimatedAbv?.basis === 'measured'
                ? `From sugar drop (OG ${ogBrixForCheck?.toFixed(1)} − current)${updatedAt ? ` · logged ${new Date(updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`
                : 'Calibrated pH, temperature, pressure, and time estimate'}
            </p>
            {brixAboveOg && (
              <p className="text-xs text-amber-200 bg-white/10 ring-1 ring-white/15 rounded-xl p-2 mt-2">
                Current Brix is above starting Brix, so the chemistry estimate is skipped. Check the readings: starting Brix must be the Day-0 must (not the finish target), and use a hydrometer — refractometers read high once alcohol is present.
              </p>
            )}
          </div>
          <div className="w-12 h-12 shrink-0 rounded-2xl bg-white/10 ring-1 ring-white/20 flex items-center justify-center">
            <FlaskConicalIcon className="w-6 h-6 text-amber-200" />
          </div>
        </div>

        {/* Hydrometer check strip */}
        {isBatchActive && (
          <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">Hydrometer check</p>
              {hydroMeter !== null ? (
                <p className="text-xs text-white/75 mt-1">
                  Meter {hydroMeter.toFixed(1)}%{hydroType === "potential" ? " (potential)" : ""}
                  {" "}vs app{" "}
                  {hydroModel !== null && hydroDelta !== null
                    ? `${hydroModel.toFixed(1)}% (Δ ${hydroDelta >= 0 ? "+" : ""}${hydroDelta.toFixed(1)})`
                    : "—"}
                  {" · "}
                  {hydroVerdict === "agree" && (
                    <span className="text-emerald-300 font-semibold">agree ✓</span>
                  )}
                  {hydroVerdict === "consistent" && (
                    <span className="text-emerald-300 font-semibold">consistent ✓</span>
                  )}
                {hydroVerdict === "check" && (
                  <span className="text-amber-300 font-semibold">check readings</span>
                )}
                {hydroCheckedAt !== null && (
                  <span className="text-white/40"> · {hydroCheckedAt}</span>
                )}
                </p>
              ) : (
                <p className="text-xs text-white/40 mt-1">No check logged yet.</p>
              )}
            </div>
            <Button size="sm" variant="outline" className="bg-transparent text-white border-white/30 hover:bg-white/10 hover:text-white rounded-full shrink-0" onClick={() => setIsHydroModalOpen(true)}>
              Log check
            </Button>
          </div>
        )}
      </div>

      {/* BATCH CONTROL CARD */}
      <Card className={`${isBatchActive ? 'bg-gradient-to-r from-emerald-50 via-white to-white border-emerald-200' : 'bg-white border-dashed border-gray-300'} rounded-3xl shadow-sm`}>
        <CardContent className="p-4 flex justify-between items-center">
           <div>
             <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
               {isBatchActive && (
                 <span className="relative flex h-2.5 w-2.5">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                 </span>
               )}
               Batch Control
             </p>
             <p className="text-xs text-gray-600 mt-1">
               {isBatchActive ? `Currently monitoring ${activeBatchId}` : 'No active batch. Graphs will not record history.'}
             </p>
           </div>
            {isBatchActive ? (
               <Button 
                 onClick={() => setIsStopModalOpen(true)} 
                 size="sm" 
                 className="gap-1 bg-red-500 hover:bg-red-600 text-white shadow-sm border-none rounded-full"
               >
                 <StopCircleIcon className="w-4 h-4" /> End Batch
               </Button>
            ) : (
               <Button onClick={() => setIsStartModalOpen(true)} size="sm" className="gap-1 bg-[#8B1538] text-white hover:bg-[#6b102b] border-none shadow-md shadow-[#8B1538]/25 rounded-full">
                 <PlayCircleIcon className="w-4 h-4" /> Start New Batch
               </Button>
            )}
          </CardContent>
        </Card>

      {/* STARTING BRIX (OG) CORRECTION — only while a batch is active */}
      {isBatchActive && (
        <Card className={`${ogBrixForCheck !== null && !brixAboveOg ? 'bg-white border-black/5' : 'bg-amber-50 border-amber-200'} rounded-3xl shadow-sm`}>
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-bold text-gray-900">Starting Brix (OG)</p>
                <p className="text-xs text-gray-600 mt-1">
                  {ogBrixForCheck !== null
                    ? `Recorded OG: ${ogBrixForCheck.toFixed(1)} Brix`
                    : 'No OG recorded — Alcohol % is estimated, not measured.'}
                </p>
              </div>
              {!isOgEditing && (
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-white"
                  onClick={() => {
                    setOgInput(ogBrixForCheck !== null ? String(ogBrixForCheck) : '');
                    setIsOgEditing(true);
                  }}
                >
                  {ogBrixForCheck !== null ? 'Correct' : 'Set OG'}
                </Button>
              )}
            </div>
            {isOgEditing && (
              <form onSubmit={handleSaveOg} className="flex gap-2 mt-3">
                <Input
                  autoFocus
                  required
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="60"
                  placeholder="Day-0 must Brix, e.g. 30"
                  value={ogInput}
                  onChange={e => setOgInput(e.target.value)}
                  className="bg-white"
                />
                <Button type="submit" size="sm" className="bg-[#8B1538] hover:bg-[#6b102b] text-white border-none shrink-0">
                  Save
                </Button>
                <Button type="button" size="sm" variant="outline" className="bg-white shrink-0" onClick={() => setIsOgEditing(false)}>
                  Cancel
                </Button>
              </form>
            )}
            {isOgEditing && (
              <div className="mt-2">
                <OgCalculator onApply={(og) => setOgInput(String(og))} />
              </div>
            )}
            {isOgEditing && (
              <p className="text-xs text-gray-500 mt-2">
                OG is the must reading on Day 0, before fermentation — not the finish target. Refractometer is fine for this one reading.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className={`bg-gradient-to-br ${isBatchActive ? 'from-[#8B1538] via-[#6B1028] to-[#3d0a18]' : 'from-gray-400 to-gray-600'} text-white rounded-3xl border-0 shadow-lg shadow-[#8B1538]/20 ring-1 ring-white/10`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] opacity-70 mb-1">Wine Status</p>
                <p className="text-white font-bold text-xl">{isBatchActive ? 'Active' : 'Idle'}</p>
              </div>
              <FlaskConicalIcon className="w-8 h-8 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className={`bg-gradient-to-br ${isBatchActive ? 'from-[#2f5b1e] via-[#2D5016] to-[#16280c]' : 'from-gray-400 to-gray-600'} text-white rounded-3xl border-0 shadow-lg shadow-emerald-900/20 ring-1 ring-white/10`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] opacity-70 mb-1">System Stability</p>
                <p className="text-white font-bold text-xl">{isBatchActive ? 'Optimal' : 'Standby'}</p>
              </div>
              <TrendingUpIcon className="w-8 h-8 opacity-60" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sensor Readings */}
      <div className={!isBatchActive ? 'opacity-60 grayscale-[0.3] pointer-events-none' : ''}>
        <h2 className="text-gray-900 mb-3 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8B1538]">Real-time Sensors</span>
          {!isBatchActive && <span className="text-xs text-amber-600 font-bold px-2 py-1 bg-amber-100 rounded-full">Monitoring Disabled</span>}
        </h2>

        {/* Temperature Card */}
        <Card className="mb-3 rounded-3xl border-0 bg-white shadow-[0_2px_16px_-4px_rgba(60,10,25,0.15)] ring-1 ring-black/5 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-orange-100 rounded-2xl flex items-center justify-center">
                  <ThermometerIcon className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <CardTitle className="text-sm">Temperature</CardTitle>
                  <p className="text-xs text-gray-500">Optimal: {SCALING.temp.min}-{SCALING.temp.max}°C</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-900 font-bold text-2xl tracking-tight">
                  {!isBatchActive || tempNow == null ? "--" : `${tempNow.toFixed(1)}°C`}
                </p>
                <Badge variant="outline" className={badgeClass(tempStatus)}>
                  {tempStatus}
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={isBatchActive ? temperatureData : []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[24, 34]} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#f97316" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Pressure Card */}
        <Card className="mb-3 rounded-3xl border-0 bg-white shadow-[0_2px_16px_-4px_rgba(60,10,25,0.15)] ring-1 ring-black/5 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-sky-100 rounded-2xl flex items-center justify-center">
                  <GaugeIcon className="w-5 h-5 text-sky-700" />
                </div>
                <div>
                  <CardTitle className="text-sm">Pressure</CardTitle>
                  <p className="text-xs text-gray-500">Unit: PSI</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-900 font-bold text-2xl tracking-tight">
                  {!isBatchActive || pressureNow == null ? "--" : `${pressureNow.toFixed(2)} PSI`}
                </p>
                <Badge variant="outline" className={badgeClass(pressureStatus)}>
                  {pressureStatus}
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={isBatchActive ? pressureData : []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#0284c7" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Sugar Content Card */}
        <Card className="mb-3 rounded-3xl border-0 bg-white shadow-[0_2px_16px_-4px_rgba(60,10,25,0.15)] ring-1 ring-black/5 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-purple-100 rounded-2xl flex items-center justify-center">
                  <DropletIcon className="w-5 h-5 text-[#6B2C5D]" />
                </div>
                <div>
                  <CardTitle className="text-sm">Sugar Content</CardTitle>
                  <p className="text-xs text-gray-500">Target: {finishTargetBrix !== null ? `≤ ${finishTargetBrix} Brix` : "—"}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-900 font-bold text-2xl tracking-tight">
                  {!isBatchActive || brixNow == null ? "--" : `${brixNow.toFixed(1)} Brix`}
                </p>
                <Badge variant="outline" className={badgeClass(brixStatus)}>
                  {brixStatus}
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-0">
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={isBatchActive ? sugarData : []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 30]} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#6B2C5D" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>

            <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-gray-100 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs text-gray-500">Measured manually — no sugar sensor</p>
                <p className={`text-xs font-medium mt-0.5 ${sugarTestDue ? "text-amber-600" : "text-gray-600"}`}>
                  {daysSinceSugarTest === null
                    ? "No reading logged yet"
                    : daysSinceSugarTest === 0
                    ? "Last tested today"
                    : `Last tested ${daysSinceSugarTest} day${daysSinceSugarTest === 1 ? "" : "s"} ago`}
                  {sugarTestDue && " — due for retest"}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setIsSugarModalOpen(true)}
                disabled={!isBatchActive}
                className="w-full sm:w-auto bg-[#6B2C5D] hover:bg-[#4B1C3D] text-white shrink-0 rounded-full shadow-md shadow-[#6B2C5D]/25"
              >
                Log Sugar Test
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Acidity Card */}
        <Card className="rounded-3xl border-0 bg-white shadow-[0_2px_16px_-4px_rgba(60,10,25,0.15)] ring-1 ring-black/5 overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-red-100 rounded-2xl flex items-center justify-center">
                  <FlaskConicalIcon className="w-5 h-5 text-[#8B1538]" />
                </div>
                <div>
                  <CardTitle className="text-sm">Acidity (pH)</CardTitle>
                  <p className="text-xs text-gray-500">Optimal: {SCALING.ph.min}-{SCALING.ph.max}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-gray-900 font-bold text-2xl tracking-tight">{!isBatchActive || phNow == null ? "--" : `${phNow.toFixed(2)} pH`}</p>
                <Badge variant="outline" className={badgeClass(phStatus)}>
                  {phStatus}
                </Badge>
              </div>
            </div>

            {(isBatchActive && phData.length > 0) && (
              <div className="mt-3">
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={phData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[3.0, 4.2]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" stroke="#8B1538" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Alert */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircleIcon className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <p className="text-amber-900 text-sm font-semibold">System Notice</p>
              <p className="text-amber-700 text-xs mt-1">
                Sugar (Brix) is measured manually by the operator — log a new reading every {SUGAR_TEST_INTERVAL_DAYS} days. Graphs only record when a batch is active.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* START BATCH MODAL */}
      {isStartModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 bg-white rounded-3xl shadow-xl">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="font-bold text-lg">Initialize New Batch</h3>
                 <button onClick={() => setIsStartModalOpen(false)}><XIcon className="w-5 h-5 text-gray-500 hover:text-gray-900 transition-colors"/></button>
              </div>
              <form onSubmit={handleStartBatch} className="space-y-4">
                <Input required type="number" placeholder="Must Volume (Liters)" value={newBatch.volume} onChange={e => setNewBatch({...newBatch, volume: e.target.value})} />
                <Input required type="number" placeholder="Fruit Weight (kg)" value={newBatch.fruits} onChange={e => setNewBatch({...newBatch, fruits: e.target.value})} />
                <Input required type="number" step="0.1" min="0" max="40" placeholder="Starting Brix (OG) e.g. 30" value={newBatch.initialBrix} onChange={e => setNewBatch({...newBatch, initialBrix: e.target.value})} />
                <Input required type="number" step="0.1" placeholder="Target Brix" value={newBatch.targetBrix} onChange={e => setNewBatch({...newBatch, targetBrix: e.target.value})} />
                <p className="text-xs text-gray-500 -mt-2">Starting Brix is measured before fermentation (refractometer is fine on Day 0). It drives the live Alcohol % calculation.</p>
                <OgCalculator onApply={(og) => setNewBatch((b) => ({ ...b, initialBrix: String(og) }))} />
                <Button type="submit" className="w-full bg-[#8B1538] hover:bg-[#6b102b] py-6 text-white border-none transition-colors">Start Production</Button>
              </form>
            </Card>
          </motion.div>
        </div>
      )}

      {/* WARNING MODAL FOR ENDING BATCH */}
      {isStopModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 bg-white rounded-3xl border-red-200 shadow-xl">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center text-red-600">
                  <AlertTriangleIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-gray-900">End Current Batch?</h3>
                  <p className="text-sm text-gray-500 mt-2">
                    Are you sure you want to stop monitoring <strong className="text-gray-900">{activeBatchId}</strong>? This will archive the data and clear the live graphs.
                  </p>
                </div>
                <div className="flex gap-3 w-full mt-4">
                  <Button onClick={() => setIsStopModalOpen(false)} variant="outline" className="flex-1 text-gray-700 border-gray-300 bg-white">
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleStopBatch} 
                    className="flex-1 bg-[#8B1538] hover:bg-[#6b102b] text-white border-none shadow-md"
                  >
                    Confirm End
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      )}

      {/* LOG HYDROMETER CHECK MODAL — additive only, safe on a live batch */}
      {isHydroModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 bg-white rounded-3xl shadow-xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg">Log Hydrometer Check</h3>
                <button onClick={() => setIsHydroModalOpen(false)}><XIcon className="w-5 h-5 text-gray-500 hover:text-gray-900 transition-colors"/></button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Enter the ABV from your hydrometer math (e.g. (OG−FG) × 131.25). It is stored next to the app's current estimate — nothing is archived or cleared.
              </p>
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 -mt-1">
                <p className="text-xs text-amber-800">
                  Vinometer readings only count in <strong>dry</strong> wine (under ~3 Brix residual) — in sweet wine sugar chokes the capillary and reads falsely high. Never log a vinometer number taken above ~3 Brix here.
                </p>
              </div>
              <form onSubmit={handleSaveHydroCheck} className="space-y-4">
                <div className="flex gap-2">
                  {(['actual', 'potential'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setHydroCheckType(t)}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium capitalize transition-colors ${
                        hydroCheckType === t
                          ? 'bg-[#8B1538] text-white border-[#8B1538]'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      {t === 'actual' ? 'Actual (now)' : 'Potential (dry)'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 -mt-2">
                  {hydroCheckType === 'actual'
                    ? 'Use (OG−FG) × 131.25 from today\'s hydrometer pair — it should match the app.'
                    : 'Use the OG potential — expect a big Δ mid-batch that converges toward ~0 at dryness.'}
                </p>
                <Input
                  required
                  autoFocus
                  type="number"
                  step="0.1"
                  min="0"
                  max="60"
                  placeholder="Hydrometer ABV % (e.g. 17.0)"
                  value={hydroAbvInput}
                  onChange={e => setHydroAbvInput(e.target.value)}
                />
                <Button type="submit" className="w-full bg-[#8B1538] hover:bg-[#6b102b] py-6 text-white border-none transition-colors">
                  Save Check
                </Button>
              </form>
            </Card>
          </motion.div>
        </div>
      )}

      {/* LOG SUGAR TEST MODAL */}      {isSugarModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 bg-white rounded-3xl shadow-xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg">Log Sugar Test Result</h3>
                <button onClick={() => setIsSugarModalOpen(false)}><XIcon className="w-5 h-5 text-gray-500 hover:text-gray-900 transition-colors"/></button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Enter the Brix reading from your hydrometer/refractometer test. Measure again in {SUGAR_TEST_INTERVAL_DAYS} days.
              </p>
              <form onSubmit={handleLogSugarTest} className="space-y-4">
                <Input
                  required
                  autoFocus
                  type="number"
                  step="0.1"
                  min="0"
                  max="40"
                  placeholder="Brix reading (e.g. 16.5)"
                  value={sugarInput}
                  onChange={e => setSugarInput(e.target.value)}
                />
                <div className="flex gap-2">
                  {(['hydrometer', 'refractometer'] as const).map((inst) => (
                    <button
                      key={inst}
                      type="button"
                      onClick={() => setSugarInstrument(inst)}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium capitalize transition-colors ${
                        sugarInstrument === inst
                          ? 'bg-[#6B2C5D] text-white border-[#6B2C5D]'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      {inst}
                    </button>
                  ))}
                </div>
                {sugarInstrument === 'refractometer' && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    Refractometers read high once alcohol is present. Prefer a hydrometer for in-progress readings.
                  </p>
                )}
                <Button type="submit" className="w-full bg-[#6B2C5D] hover:bg-[#4B1C3D] py-6 text-white border-none transition-colors">
                  Save Reading
                </Button>
              </form>
            </Card>
          </motion.div>
        </div>
      )}

    </div>
  );
}