import { useEffect, useRef, useState } from "react";
import { get, onValue, ref, update } from "firebase/database";
import { fillerDb } from "../lib/fillerFirebase";
import { db } from "../lib/firebase";
import { useHistoryList } from "../hooks/useHistoryList";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Button } from "./ui/button";
import {
  Activity,
  AlertCircle,
  Archive,
  Beaker,
  CheckCircle,
  Clock,
  Droplets,
  HelpCircle,
  RotateCcw,
  WifiOff,
  XCircle,
} from "lucide-react";

// Validation: the wine-filler project is external/untrusted — every rendered
// field is validated here first. Anything malformed degrades to spec copy
// ("—", "Unknown batch", "Unknown filler status"), never a throw.
type FillStatus = "pass" | "fail" | "manual" | "unknown";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const validBatchId = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;

const validTime = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

const validTargetMl = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 5000 ? v : null;

const validActualMl = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10000 ? v : null;

const validStatus = (v: unknown): FillStatus =>
  v === "pass" ? "pass" : v === "fail" ? "fail" : v === "manual" ? "manual" : "unknown";

interface FillerLive {
  stage: string;
  batchId: string | null;
  startTime: number | null;
  targetMl: number | null;
  dispensedMl: number | null;
}

// Object with a non-empty stage → live state (bad numbers become null → "—").
// Anything else (primitive, missing/empty stage) → null = malformed.
function parseCurrentBatch(raw: unknown): FillerLive | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.stage !== "string" || raw.stage.length === 0) return null;
  const d = isRecord(raw.details) ? raw.details : {};
  return {
    stage: raw.stage,
    batchId: validBatchId(d.batchId),
    startTime: validTime(d.startTime),
    targetMl: validTargetMl(d.targetVolumeMl),
    dispensedMl: validActualMl(d.dispensedMl),
  };
}

const statusLabel = (s: FillStatus) =>
  s === "pass" ? "Passed" : s === "fail" ? "Failed" : s === "manual" ? "Manual" : "Unknown";

// Firmware times are millis-since-boot until NTP lands: < 1e12 renders as
// uptime duration, >= 1e12 as a date (untouched once real epoch-ms flows).
const formatFillerTime = (t: number): string =>
  t < 1e12
    ? t < 60000
      ? `${Math.floor(t / 1000)} sec after machine boot`
      : `${Math.floor(t / 60000)} min after machine boot`
    : new Date(t).toLocaleString();

const BottleFillingMonitor = () => {
  const unconfigured = fillerDb === null;

  const [live, setLive] = useState<FillerLive | null>(null);
  const [liveLoaded, setLiveLoaded] = useState(unconfigured);
  const [fillerError, setFillerError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [fermentingId, setFermentingId] = useState<string | null>(null);

  // Currently-fermenting batch id (primary db, read-only, presence only).
  useEffect(() => {
    return onValue(ref(db, "fermentation/currentBatch/details"), (snap) => {
      setFermentingId(snap.exists() ? validBatchId(snap.val()?.batchId) : null);
    });
  }, []);

  // Single filler source: filling/currentBatch. Never throws — listener errors
  // and malformed snapshots land in the error state with last-good kept.
  useEffect(() => {
    if (fillerDb === null) return;
    let cancelled = false;
    try {
      const unsubscribe = onValue(
        ref(fillerDb, "filling/currentBatch"),
        (snapshot) => {
          if (cancelled) return;
          if (!snapshot.exists()) {
            setLive(null);
            setFillerError(false);
          } else {
            const parsed = parseCurrentBatch(snapshot.val());
            if (parsed) {
              setLive(parsed);
              setFillerError(false);
            } else {
              setFillerError(true);
            }
          }
          setLiveLoaded(true);
        },
        () => {
          if (cancelled) return;
          setFillerError(true);
          setLiveLoaded(true);
        },
      );
      return () => {
        cancelled = true;
        unsubscribe();
      };
    } catch {
      if (!cancelled) {
        setFillerError(true);
        setLiveLoaded(true);
      }
    }
  }, [retryKey]);

  // Filler history newest-first on the filler project; staged chip on primary.
  const { items: fillerHistory } = useHistoryList(
    "filling/history",
    { reverse: true, limit: 50 },
    fillerDb,
  );
  const { items: fermaHistory } = useHistoryList("fermentation/history", {
    sort: (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0),
    limit: 1,
  });

  const history = fillerHistory.map((item) => ({
    key: String(item.id),
    batch: validBatchId(item.batchId) ?? "Unknown batch",
    actual: validActualMl(item.actualVolumeMl),
    status: validStatus(item.status),
  }));

  const latestFerma = fermaHistory[0];
  const stagedId = validBatchId(latestFerma?.batchId);
  const stagedYield =
    typeof latestFerma?.finalYield === "string" && latestFerma.finalYield.length > 0
      ? latestFerma.finalYield
      : "—";
  const stagedKey =
    typeof latestFerma?.id === "string" && latestFerma.id.length > 0 ? latestFerma.id : null;

  // Fill-to-report linkage (Addendum A): primary-db writes only, never filler.
  const linkedRef = useRef<Set<string>>(new Set());

  // Seed already-linked keys once per staged-batch change (single read).
  useEffect(() => {
    linkedRef.current = new Set();
    if (!stagedKey || /[.#$\[\]/]/.test(stagedKey)) return;
    let cancelled = false;
    get(ref(db, `fermentation/history/${stagedKey}/fills`))
      .then((snap) => {
        if (!cancelled && snap.exists()) linkedRef.current = new Set(Object.keys(snap.val() ?? {}));
      })
      .catch((err) => console.error("fill link seed failed", err));
    return () => {
      cancelled = true;
    };
  }, [stagedKey]);

  // Link each completed fill (valid endTime) once, using validated values only.
  useEffect(() => {
    if (!stagedKey || /[.#$\[\]/]/.test(stagedKey)) return;
    fillerHistory.forEach((item) => {
      const fillerKey = typeof item?.id === "string" ? item.id : null;
      if (!fillerKey || /[.#$\[\]/]/.test(fillerKey) || linkedRef.current.has(fillerKey)) return;
      const end = validTime(item.endTime);
      const actual = validActualMl(item.actualVolumeMl);
      if (end == null || actual == null) return;
      update(ref(db, `fermentation/history/${stagedKey}/fills`), {
        [fillerKey]: { actualVolumeMl: actual, status: validStatus(item.status), endTime: end, fillerBatchId: validBatchId(item.batchId) ?? "Unknown batch" },
      })
        .then(() => linkedRef.current.add(fillerKey))
        .catch((err) => console.error("fill link failed", err));
    });
  }, [fillerHistory, stagedKey]);

  type PageStatus =
    | "unconfigured"
    | "loading"
    | "idle"
    | "filling"
    | "done"
    | "unknown"
    | "error";
  let pageStatus: PageStatus = "loading";
  if (unconfigured) pageStatus = "unconfigured";
  else if (fillerError) pageStatus = "error";
  else if (!liveLoaded) pageStatus = "loading";
  else if (live === null) pageStatus = history.length > 0 ? "done" : "idle";
  else if (live.stage === "idle") pageStatus = "idle";
  else if (live.stage === "filling" || live.stage === "dispensing") pageStatus = "filling";
  else if (live.stage === "done") pageStatus = "done";
  else if (live.stage === "error") pageStatus = "error";
  else pageStatus = "unknown";

  const statusBadge = (() => {
    switch (pageStatus) {
      case "unconfigured":
        return (
          <Badge variant="outline">
            <WifiOff />
            Filler not connected
          </Badge>
        );
      case "loading":
        return (
          <Badge variant="secondary">
            <Activity className="animate-pulse" />
            Reading filler…
          </Badge>
        );
      case "idle":
        return (
          <Badge variant="secondary">
            <Clock />
            Waiting for operator
          </Badge>
        );
      case "filling":
        return (
          <Badge>
            <Activity className="animate-pulse" />
            Filling — {live?.batchId ?? "Unknown batch"}
          </Badge>
        );
      case "done":
        return (
          <Badge>
            <CheckCircle />
            Fill complete
          </Badge>
        );
      case "unknown":
        return (
          <Badge variant="outline">
            <HelpCircle />
            Unknown filler status
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive">
            <AlertCircle />
            Filler data unavailable
          </Badge>
        );
    }
  })();

  // Live volume card values. Bad numbers → "—" + "Reading filler…".
  const targetLabel = live?.targetMl != null ? `${live.targetMl}` : "—";
  const actualLabel = live?.dispensedMl != null ? `${live.dispensedMl}` : "—";
  const hasNumbers = live?.targetMl != null && live?.dispensedMl != null;
  const pct =
    hasNumbers && live?.targetMl && live?.dispensedMl != null
      ? Math.min(Math.max((live.dispensedMl / live.targetMl) * 100, 0), 100)
      : 0;
  const volumeCaption =
    pageStatus === "idle"
      ? "Awaiting machine setup…"
      : hasNumbers
        ? `${Math.round(pct)}% Filled`
        : "Reading filler…";

  const showLiveCards =
    !unconfigured && (live !== null || pageStatus === "idle" || pageStatus === "loading");

  return (
    <div className="p-4 max-w-xl mx-auto pb-20 space-y-6">
      {/* HEADER: System Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card p-6 rounded-2xl border border-border">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Bottling Monitor</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live filler state and fill history
          </p>
        </div>

        <div role="status" aria-live="polite" className="flex items-center gap-3">
          {statusBadge}
        </div>
      </div>

      {pageStatus === "unconfigured" && (
        <div className="bg-card p-6 rounded-2xl border border-border">
          <p className="text-muted-foreground text-sm">
            Filler database isn&apos;t configured. Add VITE_FILLER_* vars and reload.
          </p>
        </div>
      )}

      {pageStatus === "error" && (
        <div className="bg-card p-6 rounded-2xl border border-destructive/50 space-y-4">
          <p className="text-muted-foreground text-sm">
            {!fillerError && live?.stage === "error"
              ? "Filler reported an error."
              : "Couldn't read the filler database. Check connection and retry."}
          </p>
          <Button
            variant="outline"
            size="lg"
            className="min-h-[44px]"
            onClick={() => {
              setFillerError(false);
              setRetryKey((k) => k + 1);
            }}
          >
            <RotateCcw />
            Retry
          </Button>
        </div>
      )}

      {/* STAGED CHIP: latest finished fermentation batch (primary db, read-only) */}
      <div className="bg-primary text-primary-foreground rounded-2xl p-6 flex items-center gap-4">
        <div className="bg-primary-foreground/20 p-3 rounded-2xl shrink-0">
          <Beaker className="w-6 h-6 text-primary-foreground" />
        </div>
        <p className="text-xl font-bold">
          {stagedId
            ? `Ready to fill: ${stagedId} · ${stagedYield}`
            : "No finished batch — end a fermentation batch to stage one."}
        </p>
      </div>
      {fermentingId && (
        <p className="text-sm text-muted-foreground">
          Fermenting now: {fermentingId} (not ended)
        </p>
      )}

      {/* MAIN LIVE DASHBOARD */}
      {showLiveCards && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: Live Fill Progress */}
          <div className="bg-card rounded-2xl border border-border p-6 relative overflow-hidden">
            <div className="flex justify-between items-start mb-6">
              <div className="bg-primary/10 p-3 rounded-2xl">
                <Droplets className="w-6 h-6 text-primary" />
              </div>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                Live Fill
              </span>
            </div>
            <div className="mb-2">
              <h2 className="text-4xl font-extrabold text-foreground tnum">
                {pageStatus === "idle" ? "0" : actualLabel}
                <span className="text-xl text-muted-foreground font-medium">
                  {" "}
                  / {targetLabel} ml
                </span>
              </h2>
            </div>
            <Progress value={pageStatus === "idle" ? 0 : pct} aria-label="Fill progress" />
            <p className="text-right text-xs text-muted-foreground font-semibold mt-2">
              {volumeCaption}
            </p>
          </div>

          {/* Card 2: Filler Batch Details */}
          <div className="bg-card rounded-2xl border border-border p-6">
            <div className="flex justify-between items-start mb-6">
              <div className="bg-muted p-3 rounded-2xl">
                <Archive className="w-6 h-6 text-muted-foreground" />
              </div>
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                Filler Batch
              </span>
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-2xl font-extrabold text-foreground">
                {live?.batchId ?? "Unknown batch"}
              </p>
              <p className="text-muted-foreground">
                Started:{" "}
                {live?.startTime != null ? formatFillerTime(live.startTime) : "—"}
              </p>
              <p className="text-muted-foreground">
                Target: {live?.targetMl != null ? `${live.targetMl} ml` : "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* FILL HISTORY (last-good kept visible in error state) */}
      {!unconfigured && (
        <div className="bg-card rounded-2xl border border-border p-6 mt-8">
          <div className="flex items-center gap-3 mb-6">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-bold text-foreground">Fill History</h3>
          </div>
          <ul className="divide-y divide-border">
            {history.length === 0 ? (
              <li className="py-8 text-center text-muted-foreground italic text-sm">
                No fill history yet.
              </li>
            ) : (
              history.map((row) => (
                <li
                  key={row.key}
                  className="py-4 flex items-center justify-between gap-3 text-sm"
                >
                  <span className="font-medium text-foreground">
                    {row.batch} · {row.actual != null ? `${row.actual} ml` : "— ml"}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground font-semibold">
                    {row.status === "pass" ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600" />
                    ) : row.status === "fail" ? (
                      <XCircle className="w-4 h-4 text-destructive" />
                    ) : row.status === "manual" ? (
                      <Clock className="w-4 h-4" />
                    ) : (
                      <HelpCircle className="w-4 h-4" />
                    )}
                    {statusLabel(row.status)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default BottleFillingMonitor;
