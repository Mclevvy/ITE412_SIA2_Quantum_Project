import type { Dispatch, SetStateAction } from "react";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { AlertTriangleIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import OgCalculator from "../OgCalculator";
import { SUGAR_TEST_INTERVAL_DAYS } from "../../hooks/useDashboardLive";

interface NewBatchForm { volume: string; fruits: string; targetBrix: string; initialBrix: string; }

interface BatchModalsProps {
  isStartModalOpen: boolean;
  setIsStartModalOpen: (v: boolean) => void;
  newBatch: NewBatchForm;
  setNewBatch: Dispatch<SetStateAction<NewBatchForm>>;
  onStartBatch: (e: any) => void;
  isStopModalOpen: boolean;
  setIsStopModalOpen: (v: boolean) => void;
  isEndingBatch: boolean;
  activeBatchId: string | null;
  onStopBatch: () => void;
  isHydroModalOpen: boolean;
  setIsHydroModalOpen: (v: boolean) => void;
  hydroCheckType: 'actual' | 'potential';
  setHydroCheckType: (v: 'actual' | 'potential') => void;
  hydroAbvInput: string;
  setHydroAbvInput: (v: string) => void;
  onSaveHydroCheck: (e: any) => void;
  isSugarModalOpen: boolean;
  setIsSugarModalOpen: (v: boolean) => void;
  sugarInput: string;
  setSugarInput: (v: string) => void;
  sugarInstrument: 'hydrometer' | 'refractometer';
  setSugarInstrument: (v: 'hydrometer' | 'refractometer') => void;
  onLogSugarTest: (e: any) => void;
}

/** Start/stop/sugar/hydrometer modals (moved verbatim out of Dashboard.tsx). */
export function BatchModals({
  isStartModalOpen,
  setIsStartModalOpen,
  newBatch,
  setNewBatch,
  onStartBatch,
  isStopModalOpen,
  setIsStopModalOpen,
  isEndingBatch,
  activeBatchId,
  onStopBatch,
  isHydroModalOpen,
  setIsHydroModalOpen,
  hydroCheckType,
  setHydroCheckType,
  hydroAbvInput,
  setHydroAbvInput,
  onSaveHydroCheck,
  isSugarModalOpen,
  setIsSugarModalOpen,
  sugarInput,
  setSugarInput,
  sugarInstrument,
  setSugarInstrument,
  onLogSugarTest,
}: BatchModalsProps) {
  return (
    <>
      {/* START BATCH MODAL */}
      {isStartModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 rounded-3xl shadow-xl">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="font-bold text-lg">Initialize New Batch</h3>
                 <button aria-label="Close dialog" onClick={() => setIsStartModalOpen(false)}><XIcon className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors"/></button>
              </div>
              <form onSubmit={onStartBatch} className="space-y-4">
                <Input required type="number" placeholder="Must Volume (Liters)" value={newBatch.volume} onChange={e => setNewBatch({...newBatch, volume: e.target.value})} />
                <Input required type="number" placeholder="Fruit Weight (kg)" value={newBatch.fruits} onChange={e => setNewBatch({...newBatch, fruits: e.target.value})} />
                <Input required type="number" step="0.1" min="0" max="40" placeholder="Starting Brix (OG) e.g. 30" value={newBatch.initialBrix} onChange={e => setNewBatch({...newBatch, initialBrix: e.target.value})} />
                <Input required type="number" step="0.1" placeholder="Target Brix" value={newBatch.targetBrix} onChange={e => setNewBatch({...newBatch, targetBrix: e.target.value})} />
                <p className="text-xs text-muted-foreground -mt-2">Starting Brix is measured before fermentation (refractometer is fine on Day 0). It drives the live Alcohol % calculation.</p>
                <OgCalculator onApply={(og) => setNewBatch((b) => ({ ...b, initialBrix: String(og) }))} />
                <Button type="submit" className="w-full py-6 transition-colors">Start Production</Button>
              </form>
            </Card>
          </motion.div>
        </div>
      )}

      {/* WARNING MODAL FOR ENDING BATCH */}
      {isStopModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 rounded-3xl border-red-200 shadow-xl">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-14 h-14 bg-red-100 rounded-2xl flex items-center justify-center text-red-600">
                  <AlertTriangleIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-foreground">End Current Batch?</h3>
                  <p className="text-sm text-muted-foreground mt-2">
                    Are you sure you want to stop monitoring <strong className="text-foreground">{activeBatchId}</strong>? This will archive the data and clear the live graphs.
                  </p>
                </div>
                <div className="flex gap-3 w-full mt-4">
                  <Button onClick={() => setIsStopModalOpen(false)} disabled={isEndingBatch} variant="outline" className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    onClick={onStopBatch}
                    disabled={isEndingBatch}
                    className="flex-1 shadow-md"
                  >
                    {isEndingBatch ? "Ending…" : "Confirm End"}
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>
      )}

      {/* LOG HYDROMETER CHECK MODAL — additive only, safe on a live batch */}
      {isHydroModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 rounded-3xl shadow-xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg">Log Hydrometer Check</h3>
                <button aria-label="Close dialog" onClick={() => setIsHydroModalOpen(false)}><XIcon className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors"/></button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Enter the ABV from your hydrometer math (e.g. (OG−FG) × 131.25). It is stored next to the app's current estimate — nothing is archived or cleared.
              </p>
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 -mt-1">
                <p className="text-xs text-amber-800">
                  Vinometer readings only count in <strong>dry</strong> wine (under ~3 Brix residual) — in sweet wine sugar chokes the capillary and reads falsely high. Never log a vinometer number taken above ~3 Brix here.
                </p>
              </div>
              <form onSubmit={onSaveHydroCheck} className="space-y-4">
                <div className="flex gap-2">
                  {(['actual', 'potential'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setHydroCheckType(t)}
                      className={`flex-1 py-2 px-3 rounded-full border text-sm font-medium capitalize transition-colors ${
                        hydroCheckType === t
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border hover:border-primary/40'
                      }`}
                    >
                      {t === 'actual' ? 'Actual (now)' : 'Potential (dry)'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
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
                <Button type="submit" className="w-full py-6 transition-colors">
                  Save Check
                </Button>
              </form>
            </Card>
          </motion.div>
        </div>
      )}

      {/* LOG SUGAR TEST MODAL */}      {isSugarModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-full max-w-sm">
            <Card className="p-6 rounded-3xl shadow-xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-lg">Log Sugar Test Result</h3>
                <button aria-label="Close dialog" onClick={() => setIsSugarModalOpen(false)}><XIcon className="w-5 h-5 text-muted-foreground hover:text-foreground transition-colors"/></button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Enter the Brix reading from your hydrometer/refractometer test. Measure again in {SUGAR_TEST_INTERVAL_DAYS} days.
              </p>
              <form onSubmit={onLogSugarTest} className="space-y-4">
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
                      className={`flex-1 py-2 px-3 rounded-full border text-sm font-medium capitalize transition-colors ${
                        sugarInstrument === inst
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border hover:border-primary/40'
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
                <Button type="submit" className="w-full py-6 transition-colors">
                  Save Reading
                </Button>
              </form>
            </Card>
          </motion.div>
        </div>
      )}
    </>
  );
}
