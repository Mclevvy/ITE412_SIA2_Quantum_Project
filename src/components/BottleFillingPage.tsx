import React, { useState, useEffect } from 'react';

import { db } from "../lib/firebase";
import { ref, onValue } from 'firebase/database';
import { useHistoryList } from '../hooks/useHistoryList';
import { Activity, Droplets, Archive, Clock, CheckCircle, AlertCircle, Beaker } from 'lucide-react';

interface LiveData {
  status: 'offline' | 'idle' | 'filling' | 'completed';
  target_volume: number; // Set by the physical machine
  total_bottles: number; // Set by the physical machine
  current_bottle: number;
  ml_dispensed: number;
}

interface BatchReport {
  id: string;
  date: string;
  target_volume: number;
  total_bottles: number;
  total_yield_ml: number;
  source_batch_id: string; // Links back to the fermentation batch
}

interface ActiveFermentationBatch {
  id: string;
  mustVolume: number; // in Liters
}

// Parses strings like "10L" (as stored by FermentationTracker/Dashboard) into a number.
function parseVolumeLiters(raw: unknown): number {
  const match = String(raw ?? "0").match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

const BottleFillingMonitor = () => {
  const [liveData, setLiveData] = useState<LiveData>({
    status: 'offline',
    target_volume: 0,
    total_bottles: 0,
    current_bottle: 0,
    ml_dispensed: 0,
  });

  const [activeBatch, setActiveBatch] = useState<ActiveFermentationBatch | null>(null);
  // Batch reports history (shared hook: same node, mapping, reverse + latest 5)
  const { items: recentBatches } = useHistoryList('reports/bottling', {
    reverse: true,
    limit: 5,
  }) as { items: BatchReport[] };

  // 1. Listen to the Active Fermentation Batch
  // NOTE: FermentationTracker.tsx and Dashboard.tsx both write the active batch to
  // 'fermentation/currentBatch/details' (with the volume stored as a string like "10L"
  // under `initialVolume`). This used to point at a different, unused path
  // ('fermentation/active_batch' / `mustVolume`), so this panel never showed real data.
  useEffect(() => {
    const batchRef = ref(db, 'fermentation/currentBatch/details');
    const unsubscribe = onValue(batchRef, (snapshot) => {
      if (snapshot.exists()) {
        const details = snapshot.val();
        setActiveBatch({
          id: snapshot.key ?? details.batchId ?? 'active',
          mustVolume: parseVolumeLiters(details.initialVolume),
        });
      } else {
        setActiveBatch(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Listen to the Live ESP32 Telemetry (No sending commands, only reading)
  useEffect(() => {
    const liveRef = ref(db, 'system/bottle_filler/live');
    const unsubscribe = onValue(liveRef, (snapshot) => {
      if (snapshot.exists()) {
        setLiveData(snapshot.val());
      }
    });
    return () => unsubscribe();
  }, []);

  // Progress Calculations
  const bottleProgress = liveData.target_volume > 0 
    ? Math.min((liveData.ml_dispensed / liveData.target_volume) * 100, 100) 
    : 0;
    
  const batchProgress = liveData.total_bottles > 0 
    ? Math.min((liveData.current_bottle / liveData.total_bottles) * 100, 100) 
    : 0;

  return (
    <div className="p-4 max-w-xl mx-auto pb-20 space-y-6">
      
      {/* HEADER: System Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-6 rounded-2xl border border-border">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Bottling Monitor</h1>
          <p className="text-muted-foreground text-sm mt-1">Live machine telemetry and batch reports</p>
        </div>
        
        <div className="flex items-center gap-3">
          {liveData.status === 'offline' && (
            <div className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground border border-border rounded-full font-semibold text-sm">
              <AlertCircle className="w-4 h-4" /> MACHINE OFFLINE
            </div>
          )}
          {liveData.status === 'idle' && (
            <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-full font-semibold text-sm">
              <Clock className="w-4 h-4" /> WAITING FOR OPERATOR
            </div>
          )}
          {liveData.status === 'filling' && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-[#B91C1C] rounded-full font-semibold text-sm border border-red-200">
              <Activity className="w-4 h-4 animate-pulse" /> MACHINE RUNNING
            </div>
          )}
        </div>
      </div>

      {/* SOURCE BATCH INFO PANEL */}
      {activeBatch && (
        <div className="bg-primary text-primary-foreground rounded-2xl p-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-primary-foreground/20 p-3 rounded-2xl">
              <Beaker className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <p className="text-primary-foreground/80 text-xs font-semibold uppercase tracking-wider">Currently Bottling</p>
              <h3 className="text-xl font-bold">Active Fermentation Batch</h3>
            </div>
          </div>
          <div className="text-right">
            <p className="text-primary-foreground/80 text-xs font-semibold uppercase tracking-wider">Available Must Volume</p>
            <p className="text-2xl font-extrabold tnum">{activeBatch.mustVolume} Liters</p>
          </div>
        </div>
      )}

      {/* MAIN LIVE DASHBOARD (Only shows if machine is active or has data) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Card 1: Current Bottle Progress */}
        <div className="bg-card rounded-2xl border border-border p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-6">
            <div className="bg-primary/10 p-3 rounded-2xl">
              <Droplets className="w-6 h-6 text-primary" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Live Flow Sensor</span>
          </div>
          <div className="mb-2">
            <h2 className="text-4xl font-extrabold text-foreground tnum">
              {liveData.status === 'idle' ? '0' : liveData.ml_dispensed.toFixed(0)} 
              <span className="text-xl text-muted-foreground font-medium"> / {liveData.target_volume || 0} ml</span>
            </h2>
          </div>
          <div className="w-full h-4 bg-primary/15 rounded-full mt-6 overflow-hidden">
            <div className="h-full bg-primary transition-all duration-300 ease-out" style={{ width: `${bottleProgress}%` }} />
          </div>
          <p className="text-right text-xs text-muted-foreground font-semibold mt-2">
            {liveData.status === 'idle' ? 'Awaiting machine setup...' : `${bottleProgress.toFixed(1)}% Filled`}
          </p>
        </div>

        {/* Card 2: Overall Batch Progress */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex justify-between items-start mb-6">
            <div className="bg-muted p-3 rounded-2xl">
              <Archive className="w-6 h-6 text-muted-foreground" />
            </div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Machine Batch Status</span>
          </div>
          <div className="mb-2">
            <h2 className="text-4xl font-extrabold text-foreground tnum">
              {liveData.status === 'idle' ? '0' : liveData.current_bottle} 
              <span className="text-xl text-muted-foreground font-medium"> / {liveData.total_bottles || 0} Bottles</span>
            </h2>
          </div>
          <div className="w-full h-4 bg-primary/15 rounded-full mt-6 overflow-hidden">
            <div className="h-full bg-primary transition-all duration-500 ease-out" style={{ width: `${batchProgress}%` }} />
          </div>
          <p className="text-right text-xs text-muted-foreground font-semibold mt-2">
            {liveData.status === 'idle' ? 'Ready' : `Batch ${batchProgress.toFixed(0)}% Complete`}
          </p>
        </div>
      </div>

      {/* BATCH REPORTING TABLE */}
      <div className="bg-card rounded-2xl border border-border p-6 mt-8">
        <div className="flex items-center gap-3 mb-6">
          <CheckCircle className="w-5 h-5 text-emerald-600" />
          <h3 className="text-lg font-bold text-foreground">Completed Packaging Reports</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border uppercase tracking-wider text-xs">
                <th className="pb-3 font-semibold">Date & Time</th>
                <th className="pb-3 font-semibold">Machine Settings</th>
                <th className="pb-3 font-semibold">Total Packaged</th>
                <th className="pb-3 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              {recentBatches.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground italic">No packaging reports recorded yet.</td>
                </tr>
              ) : (
                recentBatches.map((batch) => (
                  <tr key={batch.id} className="border-b border-border last:border-0 hover:bg-accent transition-colors">
                    <td className="py-4 font-medium text-foreground">{new Date(batch.date).toLocaleString()}</td>
                    <td className="py-4">{batch.total_bottles} Bottles @ {batch.target_volume}ml</td>
                    <td className="py-4 font-bold text-primary tnum">{(batch.total_yield_ml / 1000).toFixed(2)} Liters</td>
                    <td className="py-4 text-right">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full border border-emerald-200">
                        Completed
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default BottleFillingMonitor;