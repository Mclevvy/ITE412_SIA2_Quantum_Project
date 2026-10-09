import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';
import { 
  CheckCircle2Icon, 
  CircleIcon, 
  CalendarIcon, 
  ClockIcon, 
  BrainCircuitIcon, 
  XIcon,
  ArchiveIcon,
  FileTextIcon,
  FlaskConicalIcon
} from 'lucide-react';

// Only the tfjs pieces this screen uses — see PredictiveInsights for why the
// `@tensorflow/tfjs` umbrella import was replaced (it dragged in converter/data).
import { tensor2d, type Tensor } from '@tensorflow/tfjs-core';
import { loadLayersModel, type LayersModel } from '@tensorflow/tfjs-layers';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-backend-cpu';
import { db } from '../lib/firebase';
import { ref, onValue } from 'firebase/database';
import { useHistoryList } from '../hooks/useHistoryList';
import { endBatch, startBatch as startBatchWrite } from '../lib/batchWrites';
import { resolveInitialBrix } from '../lib/abvModel';
import { sugarCurve, daysToTarget } from '../lib/fermentationCurve';
import { toFiniteNumber } from '../lib/num';
import OgCalculator from './OgCalculator';

// 1. SCALING CONSTANTS (Matches Python Exactly)
const SCALING = {
  brix: { min: 0, max: 30 },
  temp: { min: 15, max: 40 },
  ph: { min: 2.5, max: 4.5 }
};

const normalize = (val: number, min: number, max: number) => (val - min) / (max - min);

export default function FermentationTracker() {
  const [stages, setStages] = useState<any[]>([]);
  const [details, setDetails] = useState<any>(null);
  const { items: historicalBatches } = useHistoryList('fermentation/history', {
    sort: (a, b) => b.completedAt - a.completedAt, // Sort newest first
  });
  
  const [currentBrix, setCurrentBrix] = useState<number | null>(null);
  const [currentTemp, setCurrentTemp] = useState<number | null>(null);
  const [currentPh, setCurrentPh] = useState<number | null>(null);
  // Sugar soft sensor inputs: the batch's logged tests + the latest reading.
  const [sugarHistory, setSugarHistory] = useState<Record<string, { brix?: unknown; time?: unknown }> | null>(null);
  const [sugarCurrent, setSugarCurrent] = useState<{ brix: number; time: number; source?: string | null } | null>(null);
  const [daysSource, setDaysSource] = useState<'curve' | 'model' | 'linear'>('linear');
  
  const [model, setModel] = useState<LayersModel | null>(null);
  const [modelError, setModelError] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>("Initializing...");
  const [estDate, setEstDate] = useState<string>("--");
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [newBatch, setNewBatch] = useState({ volume: '', fruits: '', targetBrix: '2.0', initialBrix: '' });

  // 1. LOAD THE 50k MASTER AI MODEL
  useEffect(() => {
    async function loadModel() {
      try {
        const m = await loadLayersModel('/model_master/model.json');
        setModel(m);
      } catch (e) {
        console.warn("AI Model not found. Check public/model_master/ folder.");
        setModelError(true);
      }
    }
    loadModel();
  }, []);

  // 2. LISTEN TO LIVE FIREBASE SENSORS & HISTORY
  useEffect(() => {
    if (!db) return;
    
    // Listen to Current Active Batch
    const unsubBatch = onValue(ref(db, 'fermentation/currentBatch'), (snap) => {
      if (snap.exists()) {
        setStages(snap.val().stages || []);
        setDetails(snap.val().details || null);
      } else {
        setStages([]);
        setDetails(null);
      }
    });

    // Listen to the latest manual sugar test (object: brix + time) and the
    // batch's full test log — the soft sensor's raw material.
    const unsubSugar = onValue(ref(db, 'sensors/sugar/current'), (snap) => {
      if (!snap.exists()) {
        setCurrentBrix(null);
        setSugarCurrent(null);
        return;
      }
      const v = snap.val();
      const brix = typeof v === 'number' ? v : v?.brix;
      if (typeof brix !== 'number' || !Number.isFinite(brix)) return;
      setCurrentBrix(brix);
      const time = typeof v === 'number' ? null : v?.time;
      // `source` reaches buildPoints so a soft-sensor estimate is never fed
      // back into its own curve fit.
      const source = typeof v === 'number' || typeof v?.source !== 'string' ? null : v.source;
      setSugarCurrent(typeof time === 'number' && Number.isFinite(time) ? { brix, time, source } : null);
    });
    const unsubSugarHist = onValue(ref(db, 'sensors/sugar/history'), (snap) => {
      setSugarHistory(snap.exists() ? snap.val() : null);
    });

    const unsubSensors = onValue(ref(db, 'sensors/current'), (snap) => {
      if (snap.exists()) {
        const value = snap.val();
        setCurrentTemp(toFiniteNumber(value.temperature));
        setCurrentPh(toFiniteNumber(value.ph));
      } else {
        setCurrentTemp(null);
        setCurrentPh(null);
      }
    });

    return () => { unsubBatch(); unsubSugar(); unsubSugarHist(); unsubSensors(); };
  }, []);

  // 3. MULTI-OUTPUT PREDICTION
  useEffect(() => {
    if (!details) {
      setTimeRemaining("--");
      setEstDate("--");
      return;
    }
    
    if (currentBrix === null || currentTemp === null || currentPh === null) return;

    const targetBrixNum = details.targetBrix || 2;

    if (currentBrix <= targetBrixNum) {
      setTimeRemaining("Ready for Harvest!"); 
      setEstDate("Today"); 
      return;
    }

    let daysRemaining = 0;

    // Soft sensor first: fit this batch's real sugar logs to a decay curve
    // (re-fit at every new test). The net and the linear rate are
    // progressively worse fallbacks.
    const curve = sugarCurve(
      { startedAt: details.startedAt, og: resolveInitialBrix(details), targetBrix: targetBrixNum },
      sugarHistory,
      sugarCurrent
    );
    const curveDays = curve ? daysToTarget(curve, targetBrixNum, Date.now()) : null;

    if (curveDays !== null) {
      daysRemaining = Math.ceil(curveDays);
      setDaysSource('curve');
    } else if (model) {
      const nBrix = normalize(currentBrix, SCALING.brix.min, SCALING.brix.max);
      const nTemp = normalize(currentTemp, SCALING.temp.min, SCALING.temp.max);
      const nPh = normalize(currentPh, SCALING.ph.min, SCALING.ph.max);
      const nTarget = normalize(targetBrixNum, SCALING.brix.min, SCALING.brix.max);

      const input = tensor2d([[nBrix, nTemp, nPh, nTarget]]);
      const prediction = model.predict(input) as Tensor;
      const data = prediction.dataSync();
      
      daysRemaining = Math.max(0, Math.ceil(data[0]));
      setDaysSource('model');
      
      input.dispose(); 
      prediction.dispose();
    } else {
      daysRemaining = Math.max(0, Math.ceil((currentBrix - targetBrixNum) / 1.2));
      setDaysSource('linear');
    }

    setTimeRemaining(`${daysRemaining} Days`);
    const future = new Date();
    future.setDate(future.getDate() + daysRemaining);
    setEstDate(future.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));

  }, [currentBrix, currentTemp, currentPh, details, model, sugarHistory, sugarCurrent]);

  // 4. START BATCH
  const startBatch = async (e: any) => {
    e.preventDefault();
    if (!db) return;

    // Validate BEFORE writing: Number('') is 0 and a cleared field yields NaN,
    // which RTDB rejects — the batch would be left half-created.
    const initialBrix = Number(newBatch.initialBrix);
    if (!Number.isFinite(initialBrix) || initialBrix <= 0) {
      console.error("Start Batch: starting Brix (OG) must be a number above 0", newBatch.initialBrix);
      window.alert("Enter the Starting Brix (OG) — the Day-0 must reading, e.g. 30.");
      return;
    }

    try {
      // Shared writer (src/lib/batchWrites.ts) — same atomic record + sensor
      // clears as the Dashboard's Start Batch, so no second code path can drift.
      await startBatchWrite({
        db,
        volume: newBatch.volume,
        fruits: newBatch.fruits,
        targetBrix: Number(newBatch.targetBrix),
        initialBrix,
        overallProgress: 10,
      });
    } catch (error) {
      console.error("Failed to start batch:", error);
      window.alert("Could not start the batch. Check your connection and try again.");
      return;
    }
    setIsModalOpen(false);
  };

  // ✅ 5. COMPLETE BATCH & GENERATE REPORT
  const completeBatch = async () => {
    if (!db || !details || isCompleting) return;

    // In-flight guard: a double-tap used to push two history records.
    setIsCompleting(true);

    try {
      // Shared writer (src/lib/batchWrites.ts) — identical record shape, sensor
      // archive and cleanup as the Dashboard's End Batch, so Reports & Analytics
      // reads a measured final Brix instead of the target.
      await endBatch({ db, details, currentBrix, currentTemp, currentPh });
    } catch (error) {
      console.error("Failed to complete batch:", error);
      window.alert("Could not archive this batch. It is still active — check your connection and try again.");
      setIsCompleting(false);
    }
  };

  return (
    <div className="p-4 space-y-4 pb-20 max-w-xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="font-bold text-xl text-foreground">Batch Tracker</h1>
        {details ? (
           <Button onClick={completeBatch} disabled={isCompleting} className="bg-emerald-600 hover:bg-emerald-700 rounded-full">
             <ArchiveIcon className="w-4 h-4 mr-2" /> {isCompleting ? "Completing…" : "Complete Batch"}
           </Button>
        ) : (
           <Button onClick={() => setIsModalOpen(true)}>New Batch</Button>
        )}
      </div>

      {details ? (
        <>
          {/* Active Batch View */}
          <Card className="bg-primary text-primary-foreground p-6 rounded-2xl">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs opacity-80 uppercase">Current Batch</p>
                <p className="text-lg font-bold">{details.batchId}</p>
                <p className="text-xs opacity-80 mt-1">Started: {details.startDate || "Unknown"}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-extrabold tnum">{details.overallProgress || 0}%</p>
              </div>
            </div>
            <Progress value={details.overallProgress || 0} className="h-2 mt-4 bg-primary-foreground/20 [&_[data-slot=progress-indicator]]:bg-primary-foreground" />
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4">
              <CalendarIcon className="w-5 h-5 text-primary mb-2" />
              <p className="text-xs text-muted-foreground">Est. Harvest</p>
              <p className="font-bold text-foreground">{estDate}</p>
            </Card>
            <Card className="p-4">
              <ClockIcon className="w-5 h-5 text-emerald-600 mb-2" />
              <p className="text-xs text-muted-foreground">Remaining</p>
              <p className="font-bold text-foreground">{timeRemaining}</p>
            </Card>
          </div>

          <div className={`p-3 rounded-xl border flex items-center gap-3 text-xs ${model ? 'bg-secondary border-border text-secondary-foreground' : 'bg-muted border-border text-muted-foreground'}`}>
            <BrainCircuitIcon className={`w-5 h-5 ${model ? 'animate-pulse' : ''}`} />
            <p>{daysSource === 'curve' ? "Soft sensor active: estimating from your sugar test logs." : model ? "Model estimate (Brix, temp, pH + target)" : modelError ? "Offline estimate (simple rate)" : "Loading model…"}</p>
          </div>

          <div className="space-y-4">
            <h2 className="font-bold text-foreground">Production Timeline</h2>
            {stages.map((s) => (
              <div key={s.id} className="flex gap-4 items-start">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${s.status === 'completed' ? 'bg-emerald-500' : s.status === 'active' ? 'bg-primary' : 'bg-muted'}`}>
                  {s.status === 'completed' ? <CheckCircle2Icon className="w-5 h-5 text-white" /> : <CircleIcon className="w-4 h-4 text-white/50" />}
                </div>
                <Card className="flex-1 p-3">
                  <div className="flex justify-between">
                    <p className="font-bold text-sm">{s.name}</p>
                    <Badge variant="outline" className="text-xs uppercase rounded-full">{s.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{s.date}</p>
                </Card>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* Empty State */
        <Card className="bg-muted border-dashed py-12">
           <CardContent className="flex flex-col items-center justify-center text-center">
              <FlaskConicalIcon className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground font-medium">No Active Fermentation</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">Initialize a new batch to start tracking.</p>
              <Button onClick={() => setIsModalOpen(true)}>Initialize Batch</Button>
           </CardContent>
        </Card>
      )}

      {/* ✅ HISTORICAL BATCH REPORTS */}
      {historicalBatches.length > 0 && (
        <div className="pt-6 mt-6 border-t border-border space-y-4">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <FileTextIcon className="w-5 h-5 text-primary" /> Production Reports
          </h2>
          
          <ScrollArea className="h-64">
            <div className="space-y-3 pb-4">
               {historicalBatches.map((batch) => (
                  <Card key={batch.id} className="overflow-hidden">
                    <div className="h-1 bg-primary" />
                    <CardHeader className="py-3 bg-muted">
                      <div className="flex justify-between items-center">
                        <CardTitle className="text-sm font-bold">{batch.batchId}</CardTitle>
                        <span className="text-xs text-muted-foreground">
                          {new Date(batch.completedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="py-3">
                      <div className="grid grid-cols-2 gap-y-2 text-sm">
                        <div>
                          <p className="text-muted-foreground text-xs">Final Yield</p>
                          <p className="font-medium text-emerald-700">{batch.finalYield}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">Fruits Used</p>
                          <p className="font-medium">{batch.fruitsUsed}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">Avg Temp</p>
                          <p className="font-medium">{batch.averageTemp}°C</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground text-xs">Final Brix</p>
                          <p className="font-medium">{batch.targetBrixAchieved}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Initialize Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6 rounded-3xl">
            <div className="flex justify-between items-center mb-4">
               <h3 className="font-bold text-lg">Initialize New Batch</h3>
               <button aria-label="Close dialog" onClick={() => setIsModalOpen(false)}><XIcon className="w-5 h-5 text-muted-foreground"/></button>
            </div>
            <form onSubmit={startBatch} className="space-y-4">
              <Input required type="number" placeholder="Must Volume (Liters)" onChange={e => setNewBatch({...newBatch, volume: e.target.value})} />
              <Input required type="number" placeholder="Fruit Weight (kg)" onChange={e => setNewBatch({...newBatch, fruits: e.target.value})} />
              <Input required type="number" step="0.1" min="0" max="40" placeholder="Starting Brix (OG) e.g. 30" value={newBatch.initialBrix} onChange={e => setNewBatch({...newBatch, initialBrix: e.target.value})} />
              <Input required type="number" step="0.1" placeholder="Target Brix" value={newBatch.targetBrix} onChange={e => setNewBatch({...newBatch, targetBrix: e.target.value})} />
              <OgCalculator onApply={(og) => setNewBatch((b) => ({ ...b, initialBrix: String(og) }))} />
              <Button type="submit" className="w-full py-6">Start Production</Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}