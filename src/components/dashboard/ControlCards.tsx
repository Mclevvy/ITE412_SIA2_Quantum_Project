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
      <Card className={`${isBatchActive ? 'border-emerald-200' : 'border-dashed'} rounded-2xl`}>
        <CardContent className="p-4 flex justify-between items-center">
           <div>
              <p className="text-sm font-bold text-foreground flex items-center gap-2">
               {isBatchActive && (
                 <span className="relative flex h-2.5 w-2.5">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                 </span>
               )}
               Batch Control
             </p>
              <p className="text-xs text-muted-foreground mt-1">
               {isBatchActive ? `Currently monitoring ${activeBatchId}` : 'No active batch. Graphs will not record history.'}
             </p>
           </div>
            {isBatchActive ? (
                <Button
                  onClick={onOpenStop}
                  size="sm"
                  variant="destructive"
                  className="gap-1 rounded-full"
                >
                 <StopCircleIcon className="w-4 h-4" /> End Batch
               </Button>
            ) : (
                <Button onClick={onOpenStart} size="sm" className="gap-1 rounded-full shadow-md shadow-primary/25">
                 <PlayCircleIcon className="w-4 h-4" /> Start New Batch
               </Button>
            )}
          </CardContent>
        </Card>

      {/* STARTING BRIX (OG) CORRECTION — only while a batch is active */}
      {isBatchActive && (
        <Card className={`${ogBrixForCheck !== null && !brixAboveOg ? '' : 'bg-amber-50 border-amber-200'} rounded-2xl`}>
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm font-bold text-foreground dark:text-amber-950">Starting Brix (OG)</p>
                <p className="text-xs text-muted-foreground dark:text-amber-800 mt-1">
                  {ogBrixForCheck !== null
                    ? `Recorded OG: ${ogBrixForCheck.toFixed(1)} Brix`
                    : 'No OG recorded — Alcohol % is estimated, not measured.'}
                </p>
              </div>
              {!isOgEditing && (
                <Button
                  size="sm"
                  variant="outline"
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
                  className="bg-input-background"
                />
                <Button type="submit" size="sm" className="shrink-0">
                  Save
                </Button>
                <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setIsOgEditing(false)}>
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
              <p className="text-xs text-muted-foreground mt-2">
                OG is the must reading on Day 0, before fermentation — not the finish target. Refractometer is fine for this one reading.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className={`${isBatchActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'} rounded-2xl border-0`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                 <p className="text-[11px] uppercase tracking-[0.18em] opacity-90 mb-1">Wine Status</p>
                <p className="font-bold text-xl">{isBatchActive ? 'Active' : 'Idle'}</p>
              </div>
              <FlaskConicalIcon className="w-8 h-8 opacity-60" />
            </div>
          </CardContent>
        </Card>

        <Card className={`${isBatchActive ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'} rounded-2xl border-0`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                 <p className="text-[11px] uppercase tracking-[0.18em] opacity-90 mb-1">System Stability</p>
                <p className="font-bold text-xl">{isBatchActive ? 'Monitoring' : 'Standby'}</p>
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
