import { useEffect, useMemo, useState } from "react";
import { onValue, push, ref, update } from "firebase/database";
import { db } from "../lib/firebase";
import { sorterDb } from "../lib/sorterFirebase";
import { summarizeSorting, countsFromKg, latestEntryKey, type SorterEntry } from "../lib/sortingStats";
import { writeErrorMessage } from "../lib/rtdbError";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CheckCircle2Icon, LayersIcon, PaletteIcon, ScaleIcon, XCircleIcon } from "lucide-react";
import { motion } from "motion/react";

type BatchDetails = {
  batchId?: string;
  /** Snapshot of the sorting log position when the batch started.
   *  Absent = not captured; { key: "" } = log was empty; { key: "b5" } = slice after b5. */
  sortingBaseline?: { key?: string };
  /** Hand-weighed harvest (kg) for a batch sorted manually — no machine log. */
  harvest?: { ripeKg?: unknown; unripeKg?: unknown };
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
  const [ripeInput, setRipeInput] = useState("");
  const [unripeInput, setUnripeInput] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, { count?: unknown; markedAt?: unknown }> | null>(null);
  const [ignoring, setIgnoring] = useState(false);
  const [ignoreError, setIgnoreError] = useState<string | null>(null);

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

  // Audit ranges for test bursts ignored via the baseline re-cut (best-effort).
  useEffect(() => {
    return onValue(ref(db, "fermentation/sorterSamples"), (snap) => {
      setSamples(snap.exists() ? (snap.val() as Record<string, { count?: unknown; markedAt?: unknown }>) : {});
    });
  }, []);

  // A batch with no baseline field is "not captured"; a baseline with key null
  // means the log was empty then, so every entry belongs to this batch.
  const baselinePresent = batch?.sortingBaseline !== undefined;
  const rawBaselineKey = batch?.sortingBaseline?.key;
  const baselineKey = typeof rawBaselineKey === "string" && rawBaselineKey !== "" ? rawBaselineKey : null;

  const liveSummary = useMemo(
    () => (entries !== null && baselinePresent ? summarizeSorting(entries, baselineKey) : null),
    [entries, baselinePresent, baselineKey]
  );

  // A batch sorted by hand has no machine log, but the weighed harvest is real:
  // convert kg → berries so the page still reports the actual result.
  const harvest = batch?.harvest;
  const ripeKg = typeof harvest?.ripeKg === "number" && Number.isFinite(harvest.ripeKg) ? harvest.ripeKg : null;
  const unripeKg = typeof harvest?.unripeKg === "number" && Number.isFinite(harvest.unripeKg) ? harvest.unripeKg : null;
  const manualSummary = useMemo(() => countsFromKg(ripeKg, unripeKg), [ripeKg, unripeKg]);

  // A recorded hand-weighed harvest means the batch was sorted by hand, so it
  // IS this batch's result — it wins over a leftover/empty machine log.
  const summary = manualSummary ?? liveSummary;

  // Entries after the baseline = what "Ignore entries so far" would skip.
  // Live total when attributable; whole-log total when the baseline key is gone.
  const wholeLogTotal = useMemo(
    () => (entries ? (summarizeSorting(entries, null)?.total ?? 0) : 0),
    [entries]
  );
  const ignoreCount = liveSummary ? liveSummary.total : wholeLogTotal;
  const showIgnore =
    !!batch && entries !== null && Object.keys(entries).length > 0 && ignoreCount > 0;

  const sampleSummary = useMemo(() => {
    if (!samples) return null;
    const records = Object.values(samples);
    if (!records.length) return null;
    let sum = 0;
    let max = 0;
    for (const r of records) {
      if (typeof r?.count === "number" && Number.isFinite(r.count)) sum += r.count;
      if (typeof r?.markedAt === "number" && Number.isFinite(r.markedAt) && r.markedAt > max) max = r.markedAt;
    }
    return { sum, max };
  }, [samples]);

  const ignoreEntriesSoFar = async () => {
    if (!entries || !batch) return;
    const key = latestEntryKey(entries);
    if (!key) return;
    const n = ignoreCount;
    if (n <= 0) return;
    if (!window.confirm(`Ignore ${n} sorter entries so far and count from the next berry?`)) return;
    setIgnoring(true);
    setIgnoreError(null);
    try {
      // Child-path merge so the rest of details survives; key stays a string.
      await update(ref(db, "fermentation/currentBatch"), { "details/sortingBaseline": { key } });
    } catch (error) {
      setIgnoreError(writeErrorMessage(error, "Couldn't save — check your connection."));
      return;
    } finally {
      setIgnoring(false);
    }
    try {
      await push(ref(db, "fermentation/sorterSamples"), {
        upToKey: key,
        count: n,
        markedAt: Date.now(),
        batchId: batch.batchId || "Unknown batch",
        reason: "test",
      });
    } catch {
      console.error("Couldn't record the ignored sorter range.");
    }
  };

  const blockedMessage = !batchLoaded
    ? "Loading batch…"
    : batchError
      ? "Couldn't read the active batch — check your connection."
      : !batch
        ? "No active batch — start one in the Tracker."
        : summary
          ? null
          : !sorterDb
            ? "Sorter not available — check the VITE_SORTER_* keys in .env."
            : sorterError
              ? "Sorter unreachable — check the bignaysorter connection."
              : !baselinePresent
                ? "Baseline not captured for this batch (started while the sorter was offline)."
                : entries === null
                  ? "Loading sorter data…"
                  : "Sorting log was reset — counts can't be attributed to this batch.";

  // Pre-flight: is the sorter reachable BEFORE starting a batch? Independent of
  // the batch, so you can check readiness on a fresh screen.
  const sorterStatus = !sorterDb
    ? { label: "Sorter not configured (VITE_SORTER_* missing)", tone: "bad" }
    : sorterError
      ? { label: "Sorter unreachable — check the bignaysorter connection", tone: "bad" }
      : entries === null
        ? { label: "Checking sorter…", tone: "muted" }
        : {
            label: `Sorter connected · ${Object.keys(entries).length} entries · last ${latestEntryKey(entries) ?? "none"}`,
            tone: "good",
          };

  const openEdit = () => {
    setRipeInput(ripeKg !== null ? String(ripeKg) : "");
    setUnripeInput(unripeKg !== null ? String(unripeKg) : "");
    setSaveError(null);
    setFormOpen(true);
  };

  const saveManualHarvest = async () => {
    const ripeRaw = ripeInput.trim();
    const unripeRaw = unripeInput.trim();
    const ripe = Number(ripeRaw);
    const unripe = Number(unripeRaw);
    // Guard on the trimmed string too: Number(" ") is 0, so a blank field would
    // otherwise save a fabricated 0 kg.
    if (!ripeRaw || !unripeRaw || !Number.isFinite(ripe) || !Number.isFinite(unripe) || ripe < 0 || unripe < 0) {
      setSaveError("Enter both weights as numbers ≥ 0 (kg).");
      return;
    }
    if (!batch) {
      setSaveError("No active batch.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Child paths so update() merges and leaves the rest of details intact.
      await update(ref(db, "fermentation/currentBatch"), {
        "details/harvest/ripeKg": ripe,
        "details/harvest/unripeKg": unripe,
      });
      setFormOpen(false);
    } catch (error) {
      setSaveError(writeErrorMessage(error, "Couldn't save — check your connection."));
    } finally {
      setSaving(false);
    }
  };

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

      <div className="flex justify-center">
        <Badge
          variant="outline"
          className={
            sorterStatus.tone === "good"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : sorterStatus.tone === "bad"
                ? "bg-red-50 text-[#B91C1C] border-red-200"
                : "bg-secondary text-secondary-foreground border-border"
          }
        >
          {sorterStatus.label}
        </Badge>
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
                  Weight = passed × 0.45 g (ripe) + rejected × 0.30 g (unripe). Tune in sortingStats.ts.
                </p>
              </CardContent>
            </Card>
          </motion.div>
        )
      )}

      {showIgnore && (
        <div className="text-center space-y-1">
          <Button variant="outline" size="sm" onClick={ignoreEntriesSoFar} disabled={ignoring}>
            {ignoring ? "Ignoring…" : "Ignore entries so far"}
          </Button>
          {ignoreError && <p className="text-xs text-destructive">{ignoreError}</p>}
        </div>
      )}

      {sampleSummary && (
        <p className="text-xs text-muted-foreground text-center">
          {`Ignoring ${sampleSummary.sum} test entries · last marked ${new Date(sampleSummary.max || Date.now()).toLocaleDateString()}`}
        </p>
      )}

      {batch && (manualSummary === null || formOpen) && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ScaleIcon className="w-4 h-4 text-primary" />
              Log manual sort
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sorted by hand? Enter the weighed kilos for {batch.batchId ?? "this batch"} — the page reports the equivalent berries.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="ripe-kg" className="text-xs">Ripe (kg)</Label>
                <Input
                  id="ripe-kg"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  placeholder="3.5"
                  value={ripeInput}
                  onChange={(e) => setRipeInput(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="unripe-kg" className="text-xs">Unripe (kg)</Label>
                <Input
                  id="unripe-kg"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  placeholder="1.4"
                  value={unripeInput}
                  onChange={(e) => setUnripeInput(e.target.value)}
                />
              </div>
            </div>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={saveManualHarvest} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              {manualSummary !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setFormOpen(false);
                    setSaveError(null);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {manualSummary !== null && !formOpen && (
        <div className="text-center">
          <Button variant="link" size="sm" onClick={openEdit}>
            Change harvest
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Live from the sorting machine · this batch only
      </p>
    </div>
  );
}
