import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { 
  SparklesIcon, 
  TrendingUpIcon, 
  AlertTriangleIcon, 
  AwardIcon,
  BrainCircuitIcon,
  FileTextIcon,
  FlaskConicalIcon
} from 'lucide-react';
import { motion } from 'motion/react';
// Import the three tfjs pieces this screen actually uses, not the `@tensorflow/tfjs`
// umbrella — the umbrella also pulls tfjs-converter + tfjs-data (and every kernel),
// which dominated the route's bundle. WebGL is the primary backend, CPU the fallback.
import { tensor2d, type Tensor } from '@tensorflow/tfjs-core';
import { loadLayersModel, type LayersModel } from '@tensorflow/tfjs-layers';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
import { db } from '../lib/firebase';
import { ref, onValue, get, set } from 'firebase/database';
import { useHistoryList } from '../hooks/useHistoryList';
import { computeLiveAbvFeatures } from '../lib/abvFeatures';

import { predictAbv, getModelInfo, predictAbvFromBrixDrop, resolveInitialBrix } from '../lib/abvModel';
import { sugarCurve, daysToTarget } from '../lib/fermentationCurve';
import { toFiniteNumber } from '../lib/num';
import { ABV_PREDICTION_INTERVAL_MS } from '../hooks/useSugarAutoLog';
const SCALING = {
  brix: { min: 0, max: 30 },
  temp: { min: 15, max: 40 },
  ph: { min: 2.5, max: 4.5 }
};
const normalize = (val: number, min: number, max: number) => (val - min) / (max - min);

export default function PredictiveInsights() {
  const [model, setModel] = useState<LayersModel | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [currentTemp, setCurrentTemp] = useState<number | null>(null);
  const [currentPh, setCurrentPh] = useState<number | null>(null);
  const [currentBrix, setCurrentBrix] = useState<number | null>(null);
  const [batchDetails, setBatchDetails] = useState<any>(null);
  // Sugar soft sensor inputs: the batch's logged tests + the latest reading.
  const [sugarHistory, setSugarHistory] = useState<Record<string, { brix?: unknown; time?: unknown }> | null>(null);
  const [sugarCurrent, setSugarCurrent] = useState<{ brix: number; time: number; source?: string | null } | null>(null);
  
  // Historical reports (shared hook: same path, mapping, newest-first sort)
  const { items: historicalReports } = useHistoryList('fermentation/history', {
    sort: (a, b) => b.completedAt - a.completedAt,
  });
  
  // AI Prediction States
  const [predDays, setPredDays] = useState<number | null>(null);
  const [predDaysSource, setPredDaysSource] = useState<'curve' | 'model' | null>(null);
  const [predQuality, setPredQuality] = useState<number | null>(null);
  const [predRisk, setPredRisk] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("Waiting for data...");

  // NEW: ABV prediction state (edge Ridge model — see src/lib/abvModel.ts)
  const [predAbv, setPredAbv] = useState<number | null>(null);
  const [abvHistoryReady, setAbvHistoryReady] = useState(false);
  const [abvBasis, setAbvBasis] = useState<'measured' | 'soft' | 'estimated'>('estimated');
  const [abvModelInfo] = useState(() => getModelInfo());

  // Refs so the ABV prediction effect (below) can read the LATEST
  // days/quality/risk values when it writes aiPrediction, without
  // re-running its own (expensive, full-history-reading) effect every
  // time those fast-updating values change.
  const latestFastPredictionsRef = useRef({ predDays, predQuality, predRisk });
  useEffect(() => {
    latestFastPredictionsRef.current = { predDays, predQuality, predRisk };
  }, [predDays, predQuality, predRisk]);

  useEffect(() => {
    async function loadModel() {
      try {
        const m = await loadLayersModel('/model_master/model.json');
        setModel(m);
      } catch (e) { 
        console.error("Failed to load Master AI. Check public/model_master/ folder.");
        setModelError("Model unavailable — check connection");
      }
    }
    loadModel();
  }, []);

  useEffect(() => {
    if (!db) return;
    
    // Live Sensors
    const unsubSensors = onValue(ref(db, 'sensors/current'), (s) => {
      if (s.exists()) {
        const value = s.val();
        setCurrentTemp(toFiniteNumber(value.temperature));
        setCurrentPh(toFiniteNumber(value.ph));
        setLastUpdated(new Date().toLocaleTimeString());
      } else {
        setCurrentTemp(null);
        setCurrentPh(null);
      }
    });
    const unsubSugar = onValue(ref(db, 'sensors/sugar/current'), (s) => {
      if (s.exists()) {
        const value = s.val();
        const brix = toFiniteNumber(value?.brix ?? value?.sugarBrix);
        setCurrentBrix(brix);
        const time = toFiniteNumber(value?.time);
        // `source` must survive into sugarCurve, or the soft sensor would fit
        // its own auto-logged estimates (see fermentationCurve.buildPoints).
        setSugarCurrent(
          brix !== null && time !== null
            ? { brix, time, source: typeof value?.source === 'string' ? value.source : null }
            : null
        );
      } else {
        setCurrentBrix(null);
        setSugarCurrent(null);
      }
    });
    const unsubSugarHist = onValue(ref(db, 'sensors/sugar/history'), (s) => {
      setSugarHistory(s.exists() ? s.val() : null);
    });
    
    // Active Batch
    const unsubBatch = onValue(ref(db, 'fermentation/currentBatch/details'), (s) => {
      if(s.exists()) setBatchDetails(s.val());
      else setBatchDetails(null);
    });

    // History now comes from useHistoryList above (same node + mapping).
    
    return () => { unsubSensors(); unsubSugar(); unsubSugarHist(); unsubBatch(); };
  }, []);

  useEffect(() => {
    // No active batch: nothing to compute (the cards aren't rendered either).
    if (!batchDetails) {
      setPredDays(null);
      setPredDaysSource(null);
      setPredQuality(null);
      setPredRisk(null);
      return;
    }

    const targetBrixNum = batchDetails.targetBrix || 2;
    const hasInputs = currentBrix !== null && currentTemp !== null && currentPh !== null;

    // Run the net once when it's loaded and all four inputs exist; it yields
    // all three outputs. Quality + Spoilage Risk are the ONLY outputs that
    // require the net, so they're computed here — independently of the
    // ready-now short-circuit below, which used to leave these two cards on
    // "Calculating…" forever for a batch at/below target.
    let modelDays: number | null = null;
    if (model && hasInputs) {
      const input = tensor2d([[
        normalize(currentBrix!, SCALING.brix.min, SCALING.brix.max),
        normalize(currentTemp!, SCALING.temp.min, SCALING.temp.max),
        normalize(currentPh!, SCALING.ph.min, SCALING.ph.max),
        normalize(targetBrixNum, SCALING.brix.min, SCALING.brix.max),
      ]]);
      const predictions = model.predict(input) as Tensor;
      const data = predictions.dataSync();
      input.dispose();
      predictions.dispose();
      modelDays = Math.max(0, Math.ceil(data[0]));
      setPredQuality(Math.min(99, Math.max(1, Math.round(data[1]))));
      setPredRisk(Math.min(99, Math.max(1, Math.round(data[2]))));
    } else {
      setPredQuality(null);
      setPredRisk(null);
    }

    // No live reading yet — the cards explain which input is missing rather
    // than spinners that never resolve.
    if (!hasInputs) {
      setPredDays(null);
      setPredDaysSource(null);
      return;
    }

    // Already at/below target (same guard FermentationTracker uses): the
    // model would report a fraction of a day forever — ceil then displayed
    // "~1 days" no matter how long the batch sat finished. Say Ready Now.
    if (currentBrix! <= targetBrixNum) {
      setPredDays(0);
      return;
    }

    // Soft sensor first: fit this batch's real sugar logs to a decay curve
    // (per-batch, self-correcting at every new test). Only days-remaining
    // prefers real data; quality/risk above come from the net.
    const curve = sugarCurve(
      { startedAt: batchDetails.startedAt, og: resolveInitialBrix(batchDetails), targetBrix: targetBrixNum },
      sugarHistory,
      sugarCurrent
    );
    const curveDays = curve ? daysToTarget(curve, targetBrixNum, Date.now()) : null;

    if (curveDays !== null) {
      setPredDays(Math.ceil(curveDays));
      setPredDaysSource('curve');
    } else if (modelDays !== null) {
      setPredDays(modelDays);
      setPredDaysSource('model');
    } else {
      setPredDays(null);
      setPredDaysSource(null);
    }
  }, [currentBrix, currentTemp, currentPh, batchDetails, model, sugarHistory, sugarCurrent]);

  // NEW: ABV prediction — reads the full sensor history for the active
  // batch (not just the latest reading), computes the same trend features
  // the Python training pipeline uses, and runs the exported Ridge model
  // client-side. Also writes the combined prediction snapshot to
  // fermentation/currentBatch/aiPrediction, which handleStopBatch's
  // accuracy-tracking logic reads — previously nothing wrote this path.
  useEffect(() => {
    if (!db || !batchDetails?.startedAt) {
      setPredAbv(null);
      return;
    }

    let cancelled = false;

    async function runAbvPrediction() {
      try {
        const [phSnap, tempSnap, pressureSnap, sugarSnap] = await Promise.all([
          get(ref(db, 'sensors/history/ph')),
          get(ref(db, 'sensors/history/temperature')),
          get(ref(db, 'sensors/history/pressurePSI')),
          get(ref(db, 'sensors/sugar/current')),
        ]);

        // Chemistry first: with OG on record and a current Brix reading,
        // ABV is arithmetic — not a model guess. Same formula the batch-end
        // accuracy check uses, so prediction and actual stay consistent.
        const ogBrix = resolveInitialBrix(batchDetails);
        const currentBrixRaw = sugarSnap.exists() ? sugarSnap.val()?.brix : null;
        const currentBrixNum =
          typeof currentBrixRaw === 'number' && Number.isFinite(currentBrixRaw) ? currentBrixRaw : null;
        const sugarInstrument = sugarSnap.exists() && typeof sugarSnap.val()?.instrument === 'string' ? sugarSnap.val().instrument : 'hydrometer';
        const chemistryAbv = predictAbvFromBrixDrop(ogBrix, currentBrixNum, sugarInstrument);
        if (chemistryAbv !== null) {
          if (cancelled) return;
          setAbvHistoryReady(true);
          setAbvBasis(sugarSnap.val()?.source === 'predicted' ? 'soft' : 'measured');
          setPredAbv(chemistryAbv);
          const { predDays: latestDays, predQuality: latestQuality, predRisk: latestRisk } = latestFastPredictionsRef.current;
          await set(ref(db, 'fermentation/currentBatch/aiPrediction'), {
            capturedAt: Date.now(),
            predictedDaysRemaining: latestDays,
            predictedQualityPercent: latestQuality,
            predictedRiskPercent: latestRisk,
            predictedAbv: chemistryAbv,
          });
          return;
        }

        const hasHistory = [phSnap, tempSnap, pressureSnap].every((snapshot) => {
          const value = snapshot.val();
          return snapshot.exists() && value && Object.keys(value).length > 0;
        });
        if (!hasHistory) {
          setAbvHistoryReady(false);
          setPredAbv(null);
          return;
        }
        setAbvHistoryReady(true);
        setAbvBasis('estimated');

        const features = computeLiveAbvFeatures(
          phSnap.exists() ? phSnap.val() : null,
          tempSnap.exists() ? tempSnap.val() : null,
          pressureSnap.exists() ? pressureSnap.val() : null,
          batchDetails.startedAt
        );

        const abv = predictAbv(features);
        if (cancelled) return;
        setPredAbv(abv);

        const { predDays: latestDays, predQuality: latestQuality, predRisk: latestRisk } = latestFastPredictionsRef.current;
        await set(ref(db, 'fermentation/currentBatch/aiPrediction'), {
          capturedAt: Date.now(),
          predictedDaysRemaining: latestDays,
          predictedQualityPercent: latestQuality,
          predictedRiskPercent: latestRisk,
          predictedAbv: abv,
        });
      } catch (e) {
        console.error("ABV prediction failed:", e);
      }
    }

    runAbvPrediction();
    const interval = setInterval(runAbvPrediction, ABV_PREDICTION_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Intentionally only re-runs when the batch itself changes (new
    // startedAt) — NOT on every predDays/predQuality/predRisk tick, since
    // this effect does a full sensor-history read each time it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchDetails]);

  // Why a card has no number yet — the model load and the (rare) live Brix
  // reading are the real waits, so name the one that's blocking instead of a
  // "Calculating…" that looks identical in every case.
  const waitingLabel =
    currentBrix === null ? 'Waiting for a Brix reading' : 'Waiting for sensor data';

  let qualityStatus = 'pending';
  let qualityLabel = waitingLabel;
  if (modelError) qualityLabel = 'Model unavailable';
  else if (!model) qualityLabel = 'Loading model…';
  if (predQuality !== null) {
    qualityStatus = 'good';
    qualityLabel = `${predQuality}/100`;
  }

  let riskStatus = 'pending';
  let riskLabel = waitingLabel;
  if (modelError) riskLabel = 'Model unavailable';
  else if (!model) riskLabel = 'Loading model…';
  if (predRisk !== null) {
    riskStatus = 'good';
    riskLabel = `${predRisk}/100`;
  }

  let expectedYield = "Calculating...";
  if (batchDetails) {
    const initVolString = String(batchDetails.initialVolume || "0");
    const volumeMatch = initVolString.match(/\d+/);
    const initialVolNum = volumeMatch ? parseInt(volumeMatch[0], 10) : 0;

    if (initialVolNum > 0) {
      expectedYield = `${Math.round(initialVolNum * 0.90)} Liters`;
    }
  }

  // NEW: Estimated Alcohol Content insight. This Ridge model has no
  // per-prediction uncertainty yet (that would need e.g. quantile
  // regression or a bootstrap ensemble) — so no confidence is shown.
  // Revisit once enough real batches exist to compute one.
  let abvPrediction = "Calculating...";
  let abvStatus = 'pending';
  let abvDetails = 'From current pH, temperature & pressure (experimental)';
  if (!abvHistoryReady) {
    abvPrediction = 'Collecting sensor history...';
  }
  if (predAbv !== null) {
    const cappedAbv = Math.min(25, Math.max(0, predAbv));
    abvPrediction = `~${cappedAbv.toFixed(1)}% ABV`;
    abvStatus = 'good';
    if (abvBasis === 'measured') {
      abvDetails = 'From sugar drop (measured)';
    } else if (abvBasis === 'soft') {
      abvDetails = 'From sugar drop (soft-sensor estimate)';
    } else {
      abvDetails = 'Rough estimate (unvalidated model)';
      if (cappedAbv > 12) {
        abvStatus = 'warning';
      }
    }
  }

  const insights = [
    {
      id: 1,
      title: 'Harvest Readiness',
      valueLabel: 'Estimate',
      prediction: predDays === null ? 'Calculating...' : predDays <= 0 ? 'Ready Now' : `Ready in ~${predDays} days`,
      status: predDays === null ? 'pending' : predDays < 3 ? 'excellent' : 'optimal',
      icon: TrendingUpIcon,
      details: predDaysSource === 'curve' ? 'From your sugar test logs (fitted decay curve)' : 'From fermentation model (synthetic-trained, unvalidated)',
      color: 'from-green-500 to-emerald-600',
    },
    {
      id: 2,
      title: 'Quality Score',
      valueLabel: 'Model score 0–100 · higher is better',
      prediction: qualityLabel,
      status: qualityStatus,
      icon: AwardIcon,
      details: 'Uncalibrated estimate from temperature, pH & Brix — not a lab measurement',
      color: 'from-primary to-primary/60',
    },
    {
      id: 3,
      title: 'Spoilage Risk',
      valueLabel: 'Model risk 0–100 · lower is better',
      prediction: riskLabel,
      status: riskStatus,
      icon: AlertTriangleIcon,
      details: 'Uncalibrated estimate from temperature, pH & Brix — not a lab test',
      color: 'from-blue-500 to-cyan-600',
    },
    {
      id: 4,
      title: 'Expected Yield',
      valueLabel: 'Projected volume',
      prediction: expectedYield,
      status: 'good',
      icon: SparklesIcon,
      details: 'Rough estimate (assumes ~10% loss)',
      color: 'from-secondary-foreground to-secondary-foreground/60',
    },
    {
      id: 5,
      title: 'Estimated Alcohol Content',
      valueLabel: 'Estimate',
      prediction: abvPrediction,
      status: abvStatus,
      icon: FlaskConicalIcon,
      details: abvDetails,
      color: 'from-amber-500 to-orange-600',
    },
  ];

  return (
    <div className="p-4 space-y-4 pb-20 max-w-xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-foreground font-bold text-xl">Predictive Insights</h1>
          <p className="text-sm text-muted-foreground">Sensor-based estimates & model projections</p>
        </div>
        <BrainCircuitIcon className="w-6 h-6 text-primary" />
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}>
              <SparklesIcon className="w-6 h-6 text-secondary-foreground" />
            </motion.div>
            <div>
              <p className="text-foreground font-bold">
                {model ? "Model loaded" : modelError ?? "Initializing AI Engine..."}
              </p>
              <p className="text-xs text-muted-foreground">Sensor updated: {lastUpdated}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ✅ CONDITIONAL RENDERING: Only show predictions if there is an active batch */}
      {batchDetails ? (
        <div className="space-y-4">
          {insights.map((insight, index) => {
            const Icon = insight.icon;
            return (
              <motion.div key={insight.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }}>
                <Card className="overflow-hidden">
                  <div className={`h-2 bg-gradient-to-r ${insight.color}`} />
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${insight.color} flex items-center justify-center`}>
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <CardTitle className="text-sm">{insight.title}</CardTitle>
                          <p className="text-xs text-muted-foreground mt-1">{insight.details}</p>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{insight.valueLabel}</span>
                      <span className="text-foreground font-bold text-right tnum">{insight.prediction}</span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-border mt-2">
                      <span className="text-xs text-muted-foreground uppercase font-medium">Status</span>
                      <Badge variant="outline" className={insight.status === 'optimal' || insight.status === 'excellent' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : insight.status === 'good' || insight.status === 'safe' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>
                        {insight.status.charAt(0).toUpperCase() + insight.status.slice(1)}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <Card className="bg-muted border-dashed py-8">
           <CardContent className="text-center text-muted-foreground">
              <p>No active batch to analyze.</p>
              <p className="text-xs mt-1">Start a new batch in the Tracker to see live insights.</p>
           </CardContent>
        </Card>
      )}

      <Card className="bg-muted border-border">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Model Specifications</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Architecture</span><span className="text-foreground font-medium">Multi-Output Dense Network</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Training Data</span><span className="text-foreground font-medium">Synthetic (count unverified)</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Processor</span><span className="text-emerald-700 font-bold">TensorFlow.js (Edge AI)</span></div>
          <div className="flex justify-between text-xs pt-2 border-t border-border mt-2"><span className="text-muted-foreground">ABV Model</span><span className="text-foreground font-medium">Ridge Regression (Edge)</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">ABV Training Batches</span><span className="text-foreground font-medium">{abvModelInfo.nTrainingSamples} (synthetic)</span></div>
        </CardContent>
      </Card>

      {/* ✅ ADDED: HISTORICAL AI REPORTS */}
      {historicalReports.length > 0 && (
        <div className="pt-6 mt-6 border-t border-border space-y-4">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <FileTextIcon className="w-5 h-5 text-primary" /> Batch Reports
          </h2>
          <p className="text-xs text-muted-foreground mb-2">Final metrics of completed batches.</p>
          
          <ScrollArea className="h-64">
            <div className="space-y-3 pb-4">
               {historicalReports.map((report) => (
                 <Card key={report.id} className="overflow-hidden border-l-4 border-l-primary">
                   <CardContent className="p-4">
                     <div className="flex justify-between items-start mb-3">
                       <div>
                         <p className="font-bold text-sm text-foreground">{report.batchId}</p>
                         <p className="text-xs text-muted-foreground">Completed: {new Date(report.completedAt).toLocaleDateString()}</p>
                       </div>
                       <Badge variant="outline" className="bg-secondary text-secondary-foreground border-border">
                         {report.finalYield} Generated
                       </Badge>
                     </div>
                     
                     <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
                       <div>
                         <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Avg Temp</p>
                         <p className="text-sm font-medium">{report.averageTemp}°C</p>
                       </div>
                       <div>
                         <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Avg Acidity</p>
                         <p className="text-sm font-medium">{report.averagePh} pH</p>
                       </div>
                       <div>
                         <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Target Brix</p>
                         <p className="text-sm font-medium text-emerald-700">{report.targetBrixAchieved}</p>
                       </div>
                       <div>
                         <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Fruit Used</p>
                         <p className="text-sm font-medium">{report.fruitsUsed}</p>
                       </div>
                     </div>
                   </CardContent>
                 </Card>
               ))}
            </div>
          </ScrollArea>
        </div>
      )}

    </div>
  );
}