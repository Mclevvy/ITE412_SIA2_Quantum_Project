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

import * as tf from '@tensorflow/tfjs';
import { db } from '../lib/firebase';
import { ref, onValue, set, push } from 'firebase/database';

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
  const [historicalBatches, setHistoricalBatches] = useState<any[]>([]);
  
  const [currentBrix, setCurrentBrix] = useState<number | null>(null);
  const [currentTemp, setCurrentTemp] = useState<number | null>(null);
  const [currentPh, setCurrentPh] = useState<number | null>(null);
  
  const [model, setModel] = useState<tf.LayersModel | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string>("Initializing...");
  const [estDate, setEstDate] = useState<string>("--");
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newBatch, setNewBatch] = useState({ volume: '', fruits: '', targetBrix: '2.0' });

  // 1. LOAD THE 50k MASTER AI MODEL
  useEffect(() => {
    async function loadModel() {
      try {
        const m = await tf.loadLayersModel('/model_master/model.json');
        setModel(m);
      } catch (e) {
        console.warn("AI Model not found. Check public/model_master/ folder.");
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

    // Listen to Historical Batches
    const unsubHistory = onValue(ref(db, 'fermentation/history'), (snap) => {
       if (snap.exists()) {
         const data = snap.val();
         const formattedHistory = Object.keys(data).map(key => ({
           id: key,
           ...data[key]
         })).sort((a, b) => b.completedAt - a.completedAt); // Sort newest first
         setHistoricalBatches(formattedHistory);
       }
    });

    const unsubSugar = onValue(ref(db, 'sensors/sugar/current/brix'), (snap) => {
      if (snap.exists()) setCurrentBrix(snap.val());
    });

    const unsubSensors = onValue(ref(db, 'sensors/current'), (snap) => {
      if (snap.exists()) {
        setCurrentTemp(snap.val().temperature);
        setCurrentPh(snap.val().ph);
      }
    });

    return () => { unsubBatch(); unsubHistory(); unsubSugar(); unsubSensors(); };
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

    if (model) {
      const nBrix = normalize(currentBrix, SCALING.brix.min, SCALING.brix.max);
      const nTemp = normalize(currentTemp, SCALING.temp.min, SCALING.temp.max);
      const nPh = normalize(currentPh, SCALING.ph.min, SCALING.ph.max);
      const nTarget = normalize(targetBrixNum, SCALING.brix.min, SCALING.brix.max);

      const input = tf.tensor2d([[nBrix, nTemp, nPh, nTarget]]);
      const prediction = model.predict(input) as tf.Tensor;
      const data = prediction.dataSync();
      
      daysRemaining = Math.max(0, Math.ceil(data[0]));
      
      input.dispose(); 
      prediction.dispose();
    } else {
      daysRemaining = Math.max(0, Math.ceil((currentBrix - targetBrixNum) / 1.2));
    }

    setTimeRemaining(`${daysRemaining} Days`);
    const future = new Date();
    future.setDate(future.getDate() + daysRemaining);
    setEstDate(future.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));

  }, [currentBrix, currentTemp, currentPh, details, model]);

  // 4. START BATCH
  const startBatch = async (e: any) => {
    e.preventDefault();
    if (!db) return;
    
    await set(ref(db, 'fermentation/currentBatch'), {
      details: {
        batchId: `Batch #${Date.now().toString().slice(-4)}`,
        overallProgress: 10,
        initialVolume: `${newBatch.volume}L`,
        fruitsUsed: `${newBatch.fruits}kg`,
        targetBrix: Number(newBatch.targetBrix),
        startDate: new Date().toLocaleDateString()
      },
      stages: [
        { id: 1, name: 'Sorting', status: 'completed', date: new Date().toLocaleDateString() },
        { id: 2, name: 'Fermentation', status: 'active', date: new Date().toLocaleDateString(), progress: 0 },
        { id: 3, name: 'Filtration', status: 'pending', date: 'TBD' },
        { id: 4, name: 'Harvest', status: 'pending', date: 'TBD' }
      ]
    });
    setIsModalOpen(false);
  };

  // ✅ 5. COMPLETE BATCH & GENERATE REPORT (Crash-Proof Version)
  const completeBatch = async () => {
    if (!db || !details) return;

    // 1. Save to History Node
    const historyRef = push(ref(db, 'fermentation/history'));
    
    // Attempt to calculate yield safely
    const initVolMatch = String(details.initialVolume || "0").match(/\d+/);
    const initialVolNum = initVolMatch ? parseInt(initVolMatch[0], 10) : 0;
    const finalYield = initialVolNum > 0 ? `${Math.round(initialVolNum * 0.90)}L` : "Unknown";

    // ✅ FIX: Added fallbacks (|| "Unknown") to prevent Firebase 'undefined' crashes
    await set(historyRef, {
      batchId: details.batchId || "Legacy Batch",
      startDate: details.startDate || "Unknown Date", 
      completedAt: Date.now(),
      finalYield: finalYield,
      fruitsUsed: details.fruitsUsed || "Unknown",
      targetBrixAchieved: details.targetBrix || "Unknown",
      averageTemp: currentTemp !== null ? currentTemp.toFixed(1) : "N/A",
      averagePh: currentPh !== null ? currentPh.toFixed(1) : "N/A"
    });

    // 2. Clear Active Batch
    await set(ref(db, 'fermentation/currentBatch'), null);
  };

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="flex justify-between items-center">
        <h1 className="font-bold text-xl text-gray-900">Batch Tracker</h1>
        {details ? (
           <Button onClick={completeBatch} className="bg-green-600 hover:bg-green-700">
             <ArchiveIcon className="w-4 h-4 mr-2" /> Complete Batch
           </Button>
        ) : (
           <Button onClick={() => setIsModalOpen(true)} className="bg-[#8B1538]">New Batch</Button>
        )}
      </div>

      {details ? (
        <>
          {/* Active Batch View */}
          <Card className="bg-gradient-to-br from-[#8B1538] to-[#6B1028] text-white p-6 rounded-2xl shadow-lg">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs opacity-80 uppercase">Current Batch</p>
                <p className="text-lg font-bold">{details.batchId}</p>
                <p className="text-xs opacity-80 mt-1">Started: {details.startDate || "Unknown"}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black">{details.overallProgress || 0}%</p>
              </div>
            </div>
            <Progress value={details.overallProgress || 0} className="h-2 mt-4 bg-white/20" />
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4 border-none bg-slate-50">
              <CalendarIcon className="w-5 h-5 text-[#8B1538] mb-2" />
              <p className="text-xs text-gray-500">Est. Harvest</p>
              <p className="font-bold text-gray-900">{estDate}</p>
            </Card>
            <Card className="p-4 border-none bg-slate-50">
              <ClockIcon className="w-5 h-5 text-green-600 mb-2" />
              <p className="text-xs text-gray-500">Remaining</p>
              <p className="font-bold text-gray-900">{timeRemaining}</p>
            </Card>
          </div>

          <div className={`p-3 rounded-xl border flex items-center gap-3 text-xs ${model ? 'bg-purple-50 border-purple-100 text-purple-700' : 'bg-gray-50 border-gray-100 text-gray-500'}`}>
            <BrainCircuitIcon className={`w-5 h-5 ${model ? 'animate-pulse' : ''}`} />
            <p>{model ? "AI Model Active: Processing Brix, Temp, & pH." : "AI Offline: Using standard linear math."}</p>
          </div>

          <div className="space-y-4">
            <h2 className="font-bold text-gray-900">Production Timeline</h2>
            {stages.map((s) => (
              <div key={s.id} className="flex gap-4 items-start">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${s.status === 'completed' ? 'bg-green-500' : s.status === 'active' ? 'bg-[#8B1538]' : 'bg-gray-200'}`}>
                  {s.status === 'completed' ? <CheckCircle2Icon className="w-5 h-5 text-white" /> : <CircleIcon className="w-4 h-4 text-white/50" />}
                </div>
                <Card className="flex-1 p-3">
                  <div className="flex justify-between">
                    <p className="font-bold text-sm">{s.name}</p>
                    <Badge variant="outline" className="text-[10px] uppercase">{s.status}</Badge>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">{s.date}</p>
                </Card>
              </div>
            ))}
          </div>
        </>
      ) : (
        /* Empty State */
        <Card className="bg-gray-50 border-dashed py-12">
           <CardContent className="flex flex-col items-center justify-center text-center">
              <FlaskConicalIcon className="w-12 h-12 text-gray-300 mb-4" />
              <p className="text-gray-500 font-medium">No Active Fermentation</p>
              <p className="text-sm text-gray-400 mt-1 mb-4">Initialize a new batch to start tracking.</p>
              <Button onClick={() => setIsModalOpen(true)} className="bg-[#8B1538]">Initialize Batch</Button>
           </CardContent>
        </Card>
      )}

      {/* ✅ HISTORICAL BATCH REPORTS */}
      {historicalBatches.length > 0 && (
        <div className="pt-6 mt-6 border-t border-gray-200 space-y-4">
          <h2 className="font-bold text-gray-900 flex items-center gap-2">
            <FileTextIcon className="w-5 h-5 text-[#8B1538]" /> Production Reports
          </h2>
          
          <ScrollArea className="h-64">
            <div className="space-y-3 pb-4">
               {historicalBatches.map((batch) => (
                 <Card key={batch.id} className="overflow-hidden">
                   <div className="h-1 bg-[#8B1538]" />
                   <CardHeader className="py-3 bg-gray-50">
                     <div className="flex justify-between items-center">
                       <CardTitle className="text-sm font-bold">{batch.batchId}</CardTitle>
                       <span className="text-xs text-gray-500">
                         {new Date(batch.completedAt).toLocaleDateString()}
                       </span>
                     </div>
                   </CardHeader>
                   <CardContent className="py-3">
                     <div className="grid grid-cols-2 gap-y-2 text-sm">
                       <div>
                         <p className="text-gray-500 text-xs">Final Yield</p>
                         <p className="font-medium text-green-700">{batch.finalYield}</p>
                       </div>
                       <div>
                         <p className="text-gray-500 text-xs">Fruits Used</p>
                         <p className="font-medium">{batch.fruitsUsed}</p>
                       </div>
                       <div>
                         <p className="text-gray-500 text-xs">Avg Temp</p>
                         <p className="font-medium">{batch.averageTemp}°C</p>
                       </div>
                       <div>
                         <p className="text-gray-500 text-xs">Target Brix</p>
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
          <Card className="w-full max-w-sm p-6 bg-white rounded-3xl">
            <div className="flex justify-between items-center mb-4">
               <h3 className="font-bold text-lg">Initialize New Batch</h3>
               <button onClick={() => setIsModalOpen(false)}><XIcon className="w-5 h-5 text-gray-500"/></button>
            </div>
            <form onSubmit={startBatch} className="space-y-4">
              <Input required type="number" placeholder="Must Volume (Liters)" onChange={e => setNewBatch({...newBatch, volume: e.target.value})} />
              <Input required type="number" placeholder="Fruit Weight (kg)" onChange={e => setNewBatch({...newBatch, fruits: e.target.value})} />
              <Input required type="number" step="0.1" placeholder="Target Brix" value={newBatch.targetBrix} onChange={e => setNewBatch({...newBatch, targetBrix: e.target.value})} />
              <Button type="submit" className="w-full bg-[#8B1538] py-6">Start Production</Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}