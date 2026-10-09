import { useEffect, useMemo, useState } from "react";
import { get, ref } from "firebase/database";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  Loader2Icon,
  FileTextIcon,
  FileSpreadsheetIcon,
  PrinterIcon,
  FileXIcon,
} from "lucide-react";

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { db } from "../lib/firebase";
import { toPoints, toSugarHistoryPoints, type Point } from "../lib/sensorFormat";
import { escapeHtml as esc, guardFormula as guard } from "../lib/exportGuards";

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
const fmtDateTime = (ts: number) =>
  new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

type Series = { key: string; label: string; unit: string; color: string; points: Point[] };
type EventRow = { time: number; kind: "sugar" | "hydro" | "complete"; title: string; detail: string };

interface BatchRecordSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A row from `fermentation/history` (carries `id` = the archive key). */
  report: any | null;
}

/**
 * Per-batch "full record": the raw sensor archive (`sensorArchive/{id}`,
 * written atomically by endBatch) charted on one shared time axis, with the
 * batch's manual events (sugar tests, hydrometer checks) and the AI accuracy
 * mark, plus PDF/Excel/print export of the whole record.
 *
 * The archive is immutable, so it is read once with `get()` rather than
 * subscribed. Batches ended before archiving existed have no record — that
 * empty state is shown instead of an error.
 */
export default function BatchRecordSheet({ open, onOpenChange, report }: BatchRecordSheetProps) {
  const [archive, setArchive] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const historyKey: string | null = report?.id ?? null;
  const harvest = report?.harvest;
  // Strict `typeof number`: Number("") / Number([]) / Number(false) are all 0,
  // which would render a fabricated "0 kg" for a malformed record instead of "—".
  const ripeKg = typeof harvest?.ripeKg === "number" && Number.isFinite(harvest.ripeKg) ? harvest.ripeKg : null;
  const unripeKg = typeof harvest?.unripeKg === "number" && Number.isFinite(harvest.unripeKg) ? harvest.unripeKg : null;
  const hasHarvest = ripeKg !== null && unripeKg !== null;

  useEffect(() => {
    // Push-generated keys never contain these chars; guard anyway so a
    // malformed id degrades to the empty state instead of throwing
    // synchronously out of ref() (before the promise .catch can see it).
    if (!open || !historyKey || !db || /[.#$\[\]/]/.test(historyKey)) return;
    let cancelled = false;
    setIsLoading(true);
    setArchive(null);
    setNotFound(false);
    get(ref(db, `sensorArchive/${historyKey}`))
      .then((snap) => {
        if (cancelled) return;
        if (snap.exists()) setArchive(snap.val());
        else setNotFound(true);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, historyKey]);

  const series: Series[] = useMemo(() => {
    if (!archive) return [];
    return [
      { key: "temperature", label: "Temperature", unit: "°C", color: "var(--chart-3)", points: toPoints(archive.temperature) },
      { key: "ph", label: "pH", unit: "pH", color: "var(--chart-2)", points: toPoints(archive.ph) },
      { key: "pressurePSI", label: "Pressure", unit: "PSI", color: "var(--chart-5)", points: toPoints(archive.pressurePSI) },
      { key: "brix", label: "Brix (sugar)", unit: "°Bx", color: "var(--chart-1)", points: toSugarHistoryPoints(archive.sugarHistory) },
    ].filter((s) => s.points.length > 0);
  }, [archive]);

  const brixPoints = useMemo(() => toSugarHistoryPoints(archive?.sugarHistory), [archive]);

  const hydroChecks = useMemo<any[]>(() => {
    const obj = archive?.hydrometerChecks;
    if (!obj) return [];
    return Object.values(obj)
      .map((c: any) => ({ ...c, time: Number(c?.checkedAt) }))
      .filter((c: any) => Number.isFinite(c.time))
      .sort((a: any, b: any) => a.time - b.time);
  }, [archive]);

  const domain = useMemo<[number, number] | undefined>(() => {
    const times = series.flatMap((s) => s.points.map((p) => p.time));
    if (times.length === 0) return undefined;
    const completedAt = typeof report?.completedAt === "number" ? report.completedAt : 0;
    const max = Math.max(...times, completedAt);
    const min = Math.min(...times);
    return [min, max === min ? min + 60_000 : max];
  }, [series, report]);

  const events: EventRow[] = useMemo(() => {
    const out: EventRow[] = brixPoints.map((p) => ({
      time: p.time,
      kind: "sugar",
      title: "Sugar test",
      detail: `${p.value} °Bx`,
    }));
    hydroChecks.forEach((c) => {
      const model = c.modelAbv != null && Number.isFinite(Number(c.modelAbv)) ? Number(c.modelAbv).toFixed(1) : "—";
      const hyd = c.hydrometerAbv != null && Number.isFinite(Number(c.hydrometerAbv)) ? Number(c.hydrometerAbv).toFixed(1) : "—";
      out.push({
        time: c.time,
        kind: "hydro",
        title: `Hydrometer check${c.checkType ? ` (${c.checkType})` : ""}`,
        detail: `${hyd}% ABV vs model ${model}%`,
      });
    });
    if (typeof report?.completedAt === "number") {
      out.push({ time: report.completedAt, kind: "complete", title: "Batch completed", detail: "" });
    }
    return out.sort((a, b) => a.time - b.time);
  }, [brixPoints, hydroChecks, report]);

  // ── Export ──────────────────────────────────────────────────────────────
  const completedStr =
    typeof report?.completedAt === "number" ? new Date(report.completedAt).toLocaleString() : "Unknown";
  const summaryRows: [string, string][] = [
    ["Batch ID", String(report?.batchId ?? "Unknown")],
    ["Started", String(report?.startDate ?? "Unknown")],
    ["Completed", completedStr],
    ["Final Yield", String(report?.finalYield ?? "Unknown")],
    ["Fruits Used", String(report?.fruitsUsed ?? "Unknown")],
    ["Starting Brix", String(report?.startingBrix ?? "Unknown")],
    ["Target Brix", String(report?.targetBrix ?? "Unknown")],
    ["Final Brix (achieved)", String(report?.targetBrixAchieved ?? "Unknown")],
    ["Avg Temp (°C)", String(report?.averageTemp ?? "Unknown")],
    ["Avg pH", String(report?.averagePh ?? "Unknown")],
    ["Harvest Ripe (kg)", hasHarvest ? String(ripeKg) : "—"],
    ["Harvest Unripe (kg)", hasHarvest ? String(unripeKg) : "—"],
  ];
  const safeName = String(report?.batchId ?? "batch").replace(/[^\w-]+/g, "-");

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Batch Record — ${report?.batchId ?? "Unknown"}`, 14, 15);
    doc.setFontSize(9);
    doc.text("Bunius-Sense fermentation record", 14, 22);

    autoTable(doc, { head: [["Metric", "Value"]], body: summaryRows, startY: 28, theme: "grid", styles: { fontSize: 8 } });
    let y = (doc as any).lastAutoTable.finalY + 8;

    series.forEach((s) => {
      if (y > 235) {
        doc.addPage();
        y = 15;
      }
      doc.setFontSize(11);
      doc.text(`${s.label} (${s.unit})`, 14, y);
      autoTable(doc, {
        head: [["Time", s.label]],
        body: s.points.map((p: Point) => [fmtDateTime(p.time), String(p.value)]),
        startY: y + 2,
        theme: "striped",
        styles: { fontSize: 7 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    });

    if (events.length > 0) {
      if (y > 235) {
        doc.addPage();
        y = 15;
      }
      doc.setFontSize(11);
      doc.text("Event log", 14, y);
      autoTable(doc, {
        head: [["Time", "Event", "Detail"]],
        body: events.map((e: EventRow) => [fmtDateTime(e.time), e.title, e.detail]),
        startY: y + 2,
        theme: "striped",
        styles: { fontSize: 7 },
      });
    }

    doc.save(`BuniusSense-Batch-${safeName}-${Date.now()}.pdf`);
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Metric", "Value"], ...summaryRows.map((r) => r.map(guard))]),
      "Summary"
    );
    series.forEach((s) =>
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ["Time", s.label],
          ...s.points.map((p: Point) => [fmtDateTime(p.time), p.value].map(guard)),
        ]),
        s.label.slice(0, 31)
      )
    );
    if (events.length > 0) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ["Time", "Event", "Detail"],
          ...events.map((e: EventRow) => [fmtDateTime(e.time), e.title, e.detail].map(guard)),
        ]),
        "Events"
      );
    }
    XLSX.writeFile(wb, `BuniusSense-Batch-${safeName}-${Date.now()}.xlsx`);
  };

  const printRecord = () => {
    const table = (head: string[], rows: (string | number)[][]) => `
      <table>
        <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>`;
    const html = `
      <html>
        <head>
          <title>Bunius-Sense ${esc(report?.batchId ?? "Batch")} record</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
            h1, h2 { margin-bottom: 6px; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0 22px; }
            th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 11px; }
            th { background: #f5f5f5; }
          </style>
        </head>
        <body>
          <h1>Batch Record — ${esc(report?.batchId ?? "Unknown")}</h1>
          <p>Generated: ${esc(new Date().toLocaleString())}</p>
          <h2>Summary</h2>
          ${table(["Metric", "Value"], summaryRows)}
          ${series.map((s) => `<h2>${esc(s.label)} (${esc(s.unit)})</h2>${table(["Time", s.label], s.points.map((p: Point) => [fmtDateTime(p.time), p.value]))}`).join("")}
          ${events.length > 0 ? `<h2>Event log</h2>${table(["Time", "Event", "Detail"], events.map((e: EventRow) => [fmtDateTime(e.time), e.title, e.detail]))}` : ""}
        </body>
      </html>`;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      window.alert("Popup blocked. Please allow popups to print this record.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const hasData = series.length > 0 || events.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[90vh] max-h-[90vh] w-full sm:max-w-xl sm:mx-auto flex flex-col p-0 gap-0"
      >
        <SheetHeader className="shrink-0 border-b border-border p-4 pb-3">
          <SheetTitle className="text-base">{report?.batchId ?? "Batch record"}</SheetTitle>
          <SheetDescription>Full sensor record &amp; fermentation timeline</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* Summary (available even when no sensor archive exists) */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              ["Started", String(report?.startDate ?? "Unknown")],
              ["Completed", typeof report?.completedAt === "number" ? new Date(report.completedAt).toLocaleDateString() : "Unknown"],
              ["Yield", String(report?.finalYield ?? "Unknown")],
              ["Fruit", String(report?.fruitsUsed ?? "Unknown")],
              ["Avg Temp", `${report?.averageTemp ?? "—"}°C`],
              ["Avg pH", String(report?.averagePh ?? "—")],
              ["Start Brix", String(report?.startingBrix ?? "—")],
              ["Target Brix", String(report?.targetBrix ?? "—")],
              ["Final Brix", String(report?.targetBrixAchieved ?? "—")],
              // Three harvest cells, and only when present, so the 3-column grid
              // stays a whole number of rows (9 cells → 3 rows; 12 → 4 rows).
              // Records without harvest render exactly as before.
              ...(hasHarvest
                ? [
                    ["Ripe (kg)", String(ripeKg)],
                    ["Unripe (kg)", String(unripeKg)],
                    ["Harvest total (kg)", String(Number(ripeKg) + Number(unripeKg))],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-muted p-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
                <p className="text-sm font-semibold text-foreground tnum">{value}</p>
              </div>
            ))}
          </div>

          {report?.aiAccuracy && (
            <Card className="mb-4">
              <CardContent className="p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  AI Prediction Accuracy
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {typeof report.aiAccuracy.daysError === "number" && (
                    <span>Predicted {Math.abs(report.aiAccuracy.daysError)} days off</span>
                  )}
                  {typeof report.aiAccuracy.abvError === "number" && (
                    <span>ABV off by {Math.abs(report.aiAccuracy.abvError).toFixed(1)} pts</span>
                  )}
                  <span className={report.aiAccuracy.qualityMatch ? "text-emerald-700" : "text-amber-700"}>
                    {report.aiAccuracy.qualityMatch ? "✓" : "✗"} Quality grade matched
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2Icon className="w-8 h-8 animate-spin text-primary mb-3" />
              <p className="text-sm">Loading sensor record…</p>
            </div>
          ) : notFound || !hasData ? (
            <div className="flex flex-col items-center text-center py-14 text-muted-foreground">
              <FileXIcon className="w-10 h-10 mb-3" />
              <p className="text-sm font-medium">No sensor record archived for this batch.</p>
              <p className="text-xs mt-1">
                Raw sensor data is archived from the point this feature was added — older batches keep their summary only.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {series.map((s) => (
                  <Card key={s.key}>
                    <CardContent className="p-3">
                      <div className="flex items-baseline justify-between mb-1">
                        <p className="text-sm font-semibold text-foreground">{s.label}</p>
                        <span className="text-xs text-muted-foreground tnum">
                          {s.points.length} reading{s.points.length === 1 ? "" : "s"} · {s.unit}
                        </span>
                      </div>
                      <ResponsiveContainer width="100%" height={150}>
                        <LineChart data={s.points} margin={{ top: 6, right: 10, bottom: 0, left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis
                            dataKey="time"
                            type="number"
                            domain={domain ?? ["dataMin", "dataMax"]}
                            tick={{ fontSize: 9 }}
                            tickFormatter={fmtDate}
                          />
                          <YAxis tick={{ fontSize: 9 }} domain={["auto", "auto"]} width={38} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "var(--card)",
                              border: "1px solid var(--border)",
                              borderRadius: 12,
                              fontSize: 12,
                            }}
                            labelFormatter={(v: any) => fmtDateTime(Number(v))}
                            formatter={(v: any) => [`${v} ${s.unit}`, s.label]}
                          />
                          {hydroChecks.map((c: any) => (
                            <ReferenceLine key={c.time} x={c.time} stroke="var(--muted-foreground)" strokeDasharray="2 3" />
                          ))}
                          {typeof report?.completedAt === "number" && (
                            <ReferenceLine x={report.completedAt} stroke="var(--primary)" strokeDasharray="4 2" />
                          )}
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke={s.color}
                            strokeWidth={2}
                            dot={s.key === "brix" ? { r: 2.5 } : false}
                            animationDuration={300}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {events.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-bold text-foreground mb-2">Event log</p>
                  <div className="space-y-1.5">
                    {events.map((e, i) => (
                      <div key={`${e.kind}-${e.time}-${i}`} className="flex items-start gap-2 text-xs">
                        <span className="text-muted-foreground tnum shrink-0 w-24">{fmtDateTime(e.time)}</span>
                        <Badge
                          variant="outline"
                          className={
                            e.kind === "complete"
                              ? "rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
                              : e.kind === "hydro"
                                ? "rounded-full border-indigo-200 bg-indigo-50 text-indigo-700"
                                : "rounded-full border-border bg-muted text-muted-foreground"
                          }
                        >
                          {e.title}
                        </Badge>
                        {e.detail && <span className="text-foreground">{e.detail}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-3 grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" onClick={exportPDF}>
            <FileTextIcon className="w-4 h-4 mr-1.5" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <FileSpreadsheetIcon className="w-4 h-4 mr-1.5" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={printRecord}>
            <PrinterIcon className="w-4 h-4 mr-1.5" /> Print
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
