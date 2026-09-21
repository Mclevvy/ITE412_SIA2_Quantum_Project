import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
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
import * as tf from '@tensorflow/tfjs';
import { db } from '../lib/firebase';
import { ref, onValue, get, set } from 'firebase/database';
import { computeLiveAbvFeatures } from '../lib/abvFeatures';
import { predictAbv, getModelInfo } from '../lib/abvModel';

const SCALING = {
  brix: { min: 0, max: 30 },
  temp: { min: 15, max: 40 },
  ph: { min: 2.5, max: 4.5 }
};
const normalize = (val: number, min: number, max: number) => (val - min) / (max - min);
const toFiniteNumber = (value: unknown): number | null => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

// How often to re-run the ABV prediction. This one is heavier than the
// days/quality/risk network above (it reads the full sensor history, not
// just the latest live reading), so it runs on a timer rather than on
// every sensor tick.
const ABV_PREDICTION_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export default function PredictiveInsights() {
  const [model, setModel] = useState<tf.LayersModel | null>(null);
  const [currentTemp, setCurrentTemp] = useState<number | null>(null);
  const [currentPh, setCurrentPh] = useState<number | null>(null);
  const [currentBrix, setCurrentBrix] = useState<number | null>(null);
  const [batchDetails, setBatchDetails] = useState<any>(null);
  
  // ✅ ADDED: State for Historical Reports
  const [historicalReports, setHistoricalReports] = useState<any[]>([]);
  
  // AI Prediction States
  const [predDays, setPredDays] = useState<number | null>(null);
  const [predQuality, setPredQuality] = useState<number | null>(null);
  const [predRisk, setPredRisk] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("Waiting for data...");

  // NEW: ABV prediction state (edge Ridge model — see src/lib/abvModel.ts)
  const [predAbv, setPredAbv] = useState<number | null>(null);
  const [abvHistoryReady, setAbvHistoryReady] = useState(false);
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
        const m = await tf.loadLayersModel('/model_master/model.json');
        setModel(m);
      } catch (e) { 
        console.error("Failed to load Master AI. Check public/model_master/ folder."); 
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
        setCurrentBrix(toFiniteNumber(value?.brix ?? value?.sugarBrix));
      } else {
        setCurrentBrix(null);
      }
    });
    
    // Active Batch
    const unsubBatch = onValue(ref(db, 'fermentation/currentBatch/details'), (s) => {
      if(s.exists()) setBatchDetails(s.val());
      else setBatchDetails(null);
    });

    // ✅ ADDED: Listen to Firebase History Node
    const unsubHistory = onValue(ref(db, 'fermentation/history'), (snap) => {
       if (snap.exists()) {
         const data = snap.val();
         const formattedHistory = Object.keys(data).map(key => ({
           id: key,
           ...data[key]
         })).sort((a, b) => b.completedAt - a.completedAt);
         setHistoricalReports(formattedHistory);
       }
    });
    
    return () => { unsubSensors(); unsubSugar(); unsubBatch(); unsubHistory(); };
  }, []);

  useEffect(() => {
    if (!model || currentBrix === null || currentTemp === null || currentPh === null || !batchDetails) return;

    const targetBrixNum = batchDetails.targetBrix || 2;

    const nBrix = normalize(currentBrix, SCALING.brix.min, SCALING.brix.max);
    const nTemp = normalize(currentTemp, SCALING.temp.min, SCALING.temp.max);
    const nPh = normalize(currentPh, SCALING.ph.min, SCALING.ph.max);
    const nTarget = normalize(targetBrixNum, SCALING.brix.min, SCALING.brix.max);

    const input = tf.tensor2d([[nBrix, nTemp, nPh, nTarget]]);
    const predictions = model.predict(input) as tf.Tensor;
    const data = predictions.dataSync(); 

    setPredDays(Math.max(0, Math.ceil(data[0])));
    setPredQuality(Math.min(99, Math.max(1, Math.round(data[1]))));
    setPredRisk(Math.min(99, Math.max(1, Math.round(data[2]))));

    input.dispose();
    predictions.dispose();
  }, [currentBrix, currentTemp, currentPh, batchDetails, model]);

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
        const [phSnap, tempSnap, pressureSnap] = await Promise.all([
          get(ref(db, 'sensors/history/ph')),
          get(ref(db, 'sensors/history/temperature')),
          get(ref(db, 'sensors/history/pressurePSI')),
        ]);

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
  }, [batchDetails?.startedAt]);

  let qualityStatus = 'pending';
  let qualityLabel = 'Calculating...';
  if (predQuality !== null) {
    qualityStatus = 'excellent';
    qualityLabel = 'Premium Grade';
    if (predQuality < 70) { qualityStatus = 'warning'; qualityLabel = 'Standard Grade'; }
    else if (predQuality < 85) { qualityStatus = 'good'; qualityLabel = 'Good Grade'; }
  }

  let riskStatus = 'pending';
  let riskLabel = 'Calculating...';
  if (predRisk !== null) {
    riskStatus = 'safe';
    riskLabel = 'Very Low';
    if (predRisk > 60) { riskStatus = 'warning'; riskLabel = 'High Risk'; }
    else if (predRisk > 30) { riskStatus = 'good'; riskLabel = 'Moderate'; }
  }

  let expectedYield = "Calculating...";
  let yieldConfidence = 0;
  if (batchDetails) {
    const initVolString = String(batchDetails.initialVolume || "0");
    const volumeMatch = initVolString.match(/\d+/);
    const initialVolNum = volumeMatch ? parseInt(volumeMatch[0], 10) : 0;

    if (initialVolNum > 0) {
      expectedYield = `${Math.round(initialVolNum * 0.90)} Liters`;
      yieldConfidence = 85;
    }
  }

  // NEW: Estimated Alcohol Content insight. There's no principled
  // per-prediction confidence interval from this Ridge model yet (that
  // would need e.g. quantile regression or a bootstrap ensemble) — the
  // confidence shown is a static placeholder, not a real uncertainty
  // estimate. Revisit once enough real batches exist to compute one.
  let abvPrediction = "Calculating...";
  let abvStatus = 'pending';
  let abvConfidence: number | null = null;
  if (!abvHistoryReady) {
    abvPrediction = 'Collecting sensor history...';
  }
  if (predAbv !== null) {
    const cappedAbv = Math.min(20, Math.max(0, predAbv));
    abvPrediction = `~${cappedAbv.toFixed(1)}% ABV`;
    abvStatus = 'good';
    abvConfidence = 65;
    if (cappedAbv > 12) {
      abvStatus = 'warning';
      abvConfidence = 58;
    }
  }

  const insights = [
    {
      id: 1,
      title: 'Harvest Readiness',
      prediction: predDays === null ? 'Calculating...' : predDays <= 0 ? 'Ready Now' : `Ready in ~${predDays} days`,
      confidence: predDays === null ? null : 94,
      status: predDays === null ? 'pending' : predDays < 3 ? 'excellent' : 'optimal',
      icon: TrendingUpIcon,
      details: 'Based on biological fermentation curves',
      color: 'from-green-500 to-emerald-600',
    },
    {
      id: 2,
      title: 'Quality Score',
      prediction: qualityLabel,
      confidence: predQuality,
      status: qualityStatus,
      icon: AwardIcon,
      details: 'Multi-variable quality projection',
      color: 'from-[#8B1538] to-[#6B1028]',
    },
    {
      id: 3,
      title: 'Spoilage Risk',
      prediction: riskLabel,
      confidence: predRisk,
      status: riskStatus,
      icon: AlertTriangleIcon,
      details: 'Live environmental stress analysis',
      color: 'from-blue-500 to-cyan-600',
    },
    {
      id: 4,
      title: 'Expected Yield',
      prediction: expectedYield,
      confidence: yieldConfidence,
      status: 'good',
      icon: SparklesIcon,
      details: 'Projected final volume after filtration',
      color: 'from-[#6B2C5D] to-[#4B1C3D]',
    },
    {
      id: 5,
      title: 'Estimated Alcohol Content',
      prediction: abvPrediction,
      confidence: abvConfidence,
      status: abvStatus,
      icon: FlaskConicalIcon,
      details: 'From pH/temperature/pressure fermentation trend',
      color: 'from-amber-500 to-orange-600',
    },
  ];

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-gray-900 font-bold text-xl">Predictive Insights</h1>
          <p className="text-sm text-gray-500">AI-powered multi-variable analysis</p>
        </div>
        <BrainCircuitIcon className="w-6 h-6 text-[#8B1538]" />
      </div>

      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }}>
              <SparklesIcon className="w-6 h-6 text-[#6B2C5D]" />
            </motion.div>
            <div>
              <p className="text-gray-900 font-bold">
                {model ? "Neural Network Active" : "Initializing AI Engine..."}
              </p>
              <p className="text-xs text-gray-600">Last processed: {lastUpdated}</p>
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
                          <p className="text-xs text-gray-500 mt-1">{insight.details}</p>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Prediction</span>
                      <span className="text-gray-900 font-bold">{insight.prediction}</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">{insight.id === 3 ? "Risk Probability" : "Model Rating"}</span>
                        <Badge variant="outline" className="text-xs">{insight.confidence === null ? 'Pending' : `${insight.confidence}%`}</Badge>
                      </div>
                      <Progress value={insight.confidence} className="h-2" />
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t mt-2">
                      <span className="text-xs text-gray-500 uppercase font-medium">Status</span>
                      <Badge variant="outline" className={insight.status === 'optimal' || insight.status === 'excellent' ? 'border-green-500 text-green-600 bg-green-50' : insight.status === 'good' || insight.status === 'safe' ? 'border-blue-500 text-blue-600 bg-blue-50' : 'border-amber-500 text-amber-600 bg-amber-50'}>
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
        <Card className="bg-gray-50 border-dashed py-8">
           <CardContent className="text-center text-gray-500">
              <p>No active batch to analyze.</p>
              <p className="text-xs mt-1">Start a new batch in the Tracker to see live insights.</p>
           </CardContent>
        </Card>
      )}

      <Card className="bg-gray-50 border-gray-200">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Model Specifications</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-xs"><span className="text-gray-500">Architecture</span><span className="text-gray-900 font-medium">Multi-Output Dense Network</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-500">Training Data</span><span className="text-gray-900 font-medium">50,000 synthetic batches</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-500">Processor</span><span className="text-green-600 font-bold">TensorFlow.js (Edge AI)</span></div>
          <div className="flex justify-between text-xs pt-2 border-t border-gray-200 mt-2"><span className="text-gray-500">ABV Model</span><span className="text-gray-900 font-medium">Ridge Regression (Edge)</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-500">ABV Training Batches</span><span className="text-gray-900 font-medium">{abvModelInfo.nTrainingSamples}{abvModelInfo.nTrainingSamples < 20 ? ' (synthetic — see README)' : ''}</span></div>
        </CardContent>
      </Card>

      {/* ✅ ADDED: HISTORICAL AI REPORTS */}
      {historicalReports.length > 0 && (
        <div className="pt-6 mt-6 border-t border-gray-200 space-y-4">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <FileTextIcon className="w-5 h-5 text-[#8B1538]" /> AI Analysis Reports
          </h2>
          <p className="text-xs text-gray-500 mb-2">Final metrics of completed batches.</p>
          
          <ScrollArea className="h-64">
            <div className="space-y-3 pb-4">
               {historicalReports.map((report) => (
                 <Card key={report.id} className="overflow-hidden border-l-4 border-[#8B1538]">
                   <CardContent className="p-4">
                     <div className="flex justify-between items-start mb-3">
                       <div>
                         <p className="font-bold text-sm text-gray-900">{report.batchId}</p>
                         <p className="text-xs text-gray-500">Completed: {new Date(report.completedAt).toLocaleDateString()}</p>
                       </div>
                       <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                         {report.finalYield} Generated
                       </Badge>
                     </div>
                     
                     <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Avg Temp</p>
                         <p className="text-sm font-medium">{report.averageTemp}°C</p>
                       </div>
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Avg Acidity</p>
                         <p className="text-sm font-medium">{report.averagePh} pH</p>
                       </div>
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Target Brix</p>
                         <p className="text-sm font-medium text-green-600">{report.targetBrixAchieved}</p>
                       </div>
                       <div>
                         <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">Fruit Used</p>
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