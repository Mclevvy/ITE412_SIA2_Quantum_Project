import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  AlertCircleIcon,
  FlaskConicalIcon,
  PlayCircleIcon,
  StopCircleIcon,
  TrendingUpIcon,
} from "lucide-react";
import OgCalculator from "../OgCalculator";
import { SUGAR_TEST_INTERVAL_DAYS } from "../../hooks/useDashboardLive";

interface ControlCardsProps {
  isBatchActive: boolean;
  activeBatchId: string | null;
  ogBrixForCheck: number | null;
  brixAboveOg: boolean;
  isOgEditing: boolean;
  ogInput: string;
  setOgInput: (v: string) => void;
  setIsOgEditing: (v: boolean) => void;
  onOpenStart: () => void;
  onOpenStop: () => void;
  onSaveOg: (e: any) => void;
}

/** Batch control, OG correction, status overview, and system notice (moved verbatim out of Dashboard.tsx). */
export function ControlCards({
  isBatchActive,
  activeBatchId,
  ogBrixForCheck,
  brixAboveOg,
  isOgEditing,
  ogInput,
  setOgInput,
  setIsOgEditing,
  onOpenStart,
  onOpenStop,
  onSaveOg,
}: ControlCardsProps) {
  return (
    <>
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
                 onClick={onOpenStop}
                 size="sm"
                 className="gap-1 bg-red-500 hover:bg-red-600 text-white shadow-sm border-none rounded-full"
               >
                 <StopCircleIcon className="w-4 h-4" /> End Batch
               </Button>
            ) : (
               <Button onClick={onOpenStart} size="sm" className="gap-1 bg-[#8B1538] text-white hover:bg-[#6b102b] border-none shadow-md shadow-[#8B1538]/25 rounded-full">
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
              <form onSubmit={onSaveOg} className="flex gap-2 mt-3">
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
                 <p className="text-[11px] uppercase tracking-[0.18em] opacity-90 mb-1">Wine Status</p>
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
                 <p className="text-[11px] uppercase tracking-[0.18em] opacity-90 mb-1">System Stability</p>
                <p className="text-white font-bold text-xl">{isBatchActive ? 'Monitoring' : 'Standby'}</p>
              </div>
              <TrendingUpIcon className="w-8 h-8 opacity-60" />
            </div>
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
    </>
  );
}
