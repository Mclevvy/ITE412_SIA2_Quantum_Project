import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "firebase/database";
import { db } from "../lib/firebase";
import { sorterDb } from "../lib/sorterFirebase";
import { summarizeSorting, type SorterEntry } from "../lib/sortingStats";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { CheckCircle2Icon, LayersIcon, PaletteIcon, ScaleIcon, XCircleIcon } from "lucide-react";
import { motion } from "motion/react";

type BatchDetails = {
  batchId?: string;
  /** Snapshot of the sorting log position when the batch started.
   *  Absent = not captured; { key: null } = log was empty; { key: "b5" } = slice after b5. */
  sortingBaseline?: { key?: string | null };
};

function formatWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${grams.toFixed(1)} g`;
}

export default function FruitSorting() {
  const [batch, setBatch] = useState<BatchDetails | null>(null);
  const [batchLoaded, setBatchLoaded] = useState(false);
  const [batchError, setBatchError] = useState(false);
  const [entries, setEntries] = useState<Record<string, SorterEntry> | null>(null);
  const [sorterError, setSorterError] = useState(false);

  // Active batch: its id and the sorting baseline captured at Start Batch.
  useEffect(() => {
    return onValue(
      ref(db, "fermentation/currentBatch/details"),
      (snap) => {
        setBatch(snap.exists() ? (snap.val() as BatchDetails) : null);
        setBatchError(false);
        setBatchLoaded(true);
      },
      () => {
        setBatchError(true); // don't hang on "Loading…" forever
        setBatchLoaded(true);
      }
    );
  }, []);

  // The sorting machine's append-only log (separate project, read-only).
  useEffect(() => {
    if (!sorterDb) return;
    return onValue(
      ref(sorterDb, "bignay_sorter"),
      (snap) => {
        setEntries(snap.exists() ? (snap.val() as Record<string, SorterEntry>) : {});
        setSorterError(false);
      },
      () => setSorterError(true)
    );
  }, []);

  // A batch with no baseline field is "not captured"; a baseline with key null
  // means the log was empty then, so every entry belongs to this batch.
  const baselinePresent = batch?.sortingBaseline !== undefined;
  const baselineKey = batch?.sortingBaseline?.key ?? null;

  const summary = useMemo(
    () => (entries !== null && baselinePresent ? summarizeSorting(entries, baselineKey) : null),
    [entries, baselinePresent, baselineKey]
  );

  const blockedMessage = !batchLoaded
    ? "Loading batch…"
    : batchError
      ? "Couldn't read the active batch — check your connection."
      : !batch
        ? "No active batch — start one in the Tracker."
        : !sorterDb
          ? "Sorter not available — check the VITE_SORTER_* keys in .env."
          : sorterError
            ? "Sorter unreachable — check the bignaysorter connection."
            : !baselinePresent
              ? "Baseline not captured for this batch (started while the sorter was offline)."
              : entries !== null && summary === null
                ? "Sorting log was reset — counts can't be attributed to this batch."
                : null;

  return (
    <div className="p-4 space-y-4 pb-20 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-foreground font-bold text-xl">Fruit Sorting</h1>
          <p className="text-sm text-muted-foreground">
            {batch?.batchId ? `${batch.batchId} · color-based classification` : "Color-based quality classification report"}
          </p>
        </div>
        <PaletteIcon className="w-6 h-6 text-primary" />
      </div>

      {blockedMessage ? (
        <Card className="bg-muted border-dashed">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">{blockedMessage}</p>
          </CardContent>
        </Card>
      ) : (
        summary && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* Per-batch totals */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <LayersIcon className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                  <p className="text-foreground text-2xl font-bold tnum">{summary.total}</p>
                  <p className="text-xs text-muted-foreground mt-1">Total</p>
                </CardContent>
              </Card>
              <Card className="bg-emerald-50 border-emerald-200">
                <CardContent className="p-3 text-center">
                  <CheckCircle2Icon className="w-4 h-4 mx-auto text-emerald-600 mb-1" />
                  <p className="text-emerald-700 text-2xl font-bold tnum">{summary.passed}</p>
                  <p className="text-xs text-emerald-700 mt-1">Passed</p>
                </CardContent>
              </Card>
              <Card className="bg-red-50 border-red-200">
                <CardContent className="p-3 text-center">
                  <XCircleIcon className="w-4 h-4 mx-auto text-red-600 mb-1" />
                  <p className="text-[#B91C1C] text-2xl font-bold tnum">{summary.rejected}</p>
                  <p className="text-xs text-[#B91C1C] mt-1">Rejected</p>
                </CardContent>
              </Card>
            </div>

            {/* Estimated weight */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ScaleIcon className="w-4 h-4 text-primary" />
                  Estimated Batch Weight
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Estimated weight</span>
                  <span className="text-foreground font-bold text-right tnum">
                    {formatWeight(summary.estimatedWeightG)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Pass rate</span>
                  <Badge variant="outline" className="bg-secondary text-secondary-foreground border-border">
                    {summary.total ? Math.round((summary.passed / summary.total) * 100) : 0}%
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground pt-2 border-t border-border mt-2">
                  Weight = passed × 0.45 g (ripe) + rejected × 0.30 g (unripe). Tune in `sortingStats.ts`.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )
      )}

      <p className="text-xs text-muted-foreground text-center">
        Live from the sorting machine · this batch only
      </p>
    </div>
  );
}
