import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import {
  DownloadIcon,
  TrendingUpIcon,
  DropletIcon,
  ThermometerIcon,
  FileTextIcon,
  FileSpreadsheetIcon,
  PrinterIcon,
  Loader2Icon,
  Trash2Icon,
  LeafIcon, // ✅ Added Leaf icon for Fruits
  FilterXIcon,
  SearchIcon,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import { db } from "../lib/firebase";
import { ref, set } from "firebase/database";
import { useHistoryList } from "../hooks/useHistoryList";
import { escapeHtml as esc, guardFormula as guard } from "../lib/exportGuards";
import BatchRecordSheet from "./BatchRecordSheet";

type TabType = "weekly" | "monthly" | "seasonal";
type ExportType = "pdf" | "excel" | "print";

export default function ReportsAnalytics() {
  const [activeTab, setActiveTab] = useState<TabType>("weekly");
  const [showExportMenu, setShowExportMenu] = useState(false);
  // Batch whose full sensor record is open in the detail sheet (null = closed).
  const [selectedReport, setSelectedReport] = useState<any>(null);
  // 1. FETCH ACTUAL FIREBASE HISTORY (shared hook: same path, mapping,
  // oldest-first sort, loading + clear-on-delete semantics preserved).
  // Malformed records (legacy/test/partial writes with no batchId) are
  // dropped instead of rendering blank "Unknown" cards. The count is shown,
  // and scripts/seedDemoBatch.mjs --clean-junk purges them for real.
  const {
    items: historicalData,
    isLoading,
    hiddenInvalidCount,
  } = useHistoryList("fermentation/history", {
    sort: (a, b) => (a.completedAt || 0) - (b.completedAt || 0),
    filter: (b) => typeof b.batchId === "string" && b.batchId.trim() !== "",
    clearOnEmpty: true,
  });

  // ✅ ACTION: Clear all old test data
  const [isWiping, setIsWiping] = useState(false);
  const [wipeError, setWipeError] = useState<string | null>(null);

  const handleWipeHistory = async () => {
    if (!db || isWiping) return;
    if (!window.confirm("Are you sure you want to permanently delete all historical batch reports? This is useful for clearing test data before your final defense.")) return;

    setIsWiping(true);
    setWipeError(null);
    try {
      await set(ref(db, 'fermentation/history'), null);
    } catch (error) {
      console.error("Failed to wipe history:", error);
      setWipeError("Couldn't delete the history — nothing was changed. Check your connection and try again.");
    } finally {
      setIsWiping(false);
    }
  };

  // 2. DYNAMIC METRICS CALCULATION (Now with precise decimal parsing)
  const avgTemp = useMemo(() => {
    if (historicalData.length === 0) return "--°C";
    const validTemps = historicalData.filter(d => d.averageTemp !== "N/A" && !isNaN(parseFloat(d.averageTemp)));
    if (validTemps.length === 0) return "--°C";
    
    const sum = validTemps.reduce((acc, curr) => acc + parseFloat(curr.averageTemp), 0);
    return `${(sum / validTemps.length).toFixed(1)}°C`;
  }, [historicalData]);

  const avgPh = useMemo(() => {
    if (historicalData.length === 0) return "-- pH";
    const validPh = historicalData.filter(d => d.averagePh !== "N/A" && !isNaN(parseFloat(d.averagePh)));
    if (validPh.length === 0) return "-- pH";
    
    const sum = validPh.reduce((acc, curr) => acc + parseFloat(curr.averagePh), 0);
    return `${(sum / validPh.length).toFixed(1)} pH`;
  }, [historicalData]);

  const totalYield = useMemo(() => {
    if (historicalData.length === 0) return "0L";
    const sum = historicalData.reduce((acc, curr) => {
      // ✅ FIX: Extract exact decimals for accurate math
      const match = String(curr.finalYield || "0").match(/\d+(\.\d+)?/);
      return acc + (match ? parseFloat(match[0]) : 0);
    }, 0);
    return `${sum.toFixed(1)}L`;
  }, [historicalData]);

  const totalFruits = useMemo(() => {
    if (historicalData.length === 0) return "0kg";
    const sum = historicalData.reduce((acc, curr) => {
      // ✅ FIX: Extract exact decimals for fruit weight
      const match = String(curr.fruitsUsed || "0").match(/\d+(\.\d+)?/);
      return acc + (match ? parseFloat(match[0]) : 0);
    }, 0);
    return `${sum.toFixed(1)}kg`;
  }, [historicalData]);

  // 3. DYNAMIC GRAPH DATA PROCESSING
  // NOTE: batchId is guarded — a single legacy/test/partial history record
  // without one used to throw inside render and blank the entire app (there
  // was no error boundary). Unknown ids render as "Unknown" instead.
  const weeklyGraphData = useMemo(() => {
    return historicalData.slice(-7).map(batch => ({
      batchId: String(batch.batchId ?? "Unknown").replace('Batch #', '#'),
      temperature: parseFloat(batch.averageTemp) || 0,
      sugar: parseFloat(batch.targetBrixAchieved) || 0,
      ph: parseFloat(batch.averagePh) || 0
    }));
  }, [historicalData]);

  const yieldGraphData = useMemo(() => {
    return historicalData.slice(-10).map(batch => {
       const match = String(batch.finalYield).match(/\d+(\.\d+)?/);
       return {
         batchId: String(batch.batchId ?? "Unknown").replace('Batch #', '#'),
         yield: match ? parseFloat(match[0]) : 0
       };
    });
  }, [historicalData]);

  const qualityDistribution = useMemo(() => {
    let premium = 0, standard = 0, below = 0;
    historicalData.forEach(batch => {
      const brix = parseFloat(batch.targetBrixAchieved);
      if (isNaN(brix)) return;
      
      if (brix >= 15 && brix <= 18) premium++;
      else if (brix >= 13 && brix < 15) standard++;
      else below++;
    });

    return [
      { name: "Premium (15-18 Brix)", value: premium, color: "var(--chart-4)" },
      { name: "Standard (13-14 Brix)", value: standard, color: "var(--chart-1)" },
      { name: "Below Standard", value: below, color: "var(--chart-2)" },
    ];
  }, [historicalData]);

  // 3b. BATCH REPORT FILTERS
  type QualityFilter = "all" | "premium" | "standard" | "below";
  type SortOrder = "newest" | "oldest";

  const [searchQuery, setSearchQuery] = useState("");
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  function getQualityGrade(brixRaw: unknown): QualityFilter | "unknown" {
    const brix = parseFloat(String(brixRaw));
    if (isNaN(brix)) return "unknown";
    if (brix >= 15 && brix <= 18) return "premium";
    if (brix >= 13 && brix < 15) return "standard";
    return "below";
  }

  const hasActiveFilters =
    searchQuery.trim() !== "" || qualityFilter !== "all" || dateFrom !== "" || dateTo !== "" || sortOrder !== "newest";

  const resetFilters = () => {
    setSearchQuery("");
    setQualityFilter("all");
    setDateFrom("");
    setDateTo("");
    setSortOrder("newest");
  };

  const filteredHistory = useMemo(() => {
    let data = [...historicalData];

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      data = data.filter((b) => String(b.batchId || "").toLowerCase().includes(q));
    }

    if (qualityFilter !== "all") {
      data = data.filter((b) => getQualityGrade(b.targetBrixAchieved) === qualityFilter);
    }

    if (dateFrom) {
      const fromTs = new Date(dateFrom).setHours(0, 0, 0, 0);
      data = data.filter((b) => typeof b.completedAt === "number" && b.completedAt >= fromTs);
    }

    if (dateTo) {
      const toTs = new Date(dateTo).setHours(23, 59, 59, 999);
      data = data.filter((b) => typeof b.completedAt === "number" && b.completedAt <= toTs);
    }

    data.sort((a, b) =>
      sortOrder === "newest" ? (b.completedAt || 0) - (a.completedAt || 0) : (a.completedAt || 0) - (b.completedAt || 0)
    );

    return data;
  }, [historicalData, searchQuery, qualityFilter, dateFrom, dateTo, sortOrder]);

  // 4. EXPORT ENGINE — exports the currently filtered batch list, so what you see
  // in the Production Reports Log below is exactly what gets exported.
  const getReportData = () => {
    return {
      title: hasActiveFilters
        ? `Filtered Fermentation History (${filteredHistory.length} of ${historicalData.length} batches)`
        : "Full Fermentation History",
      headers: ["Batch ID", "Start Date", "Completed At", "Final Yield", "Fruits Used", "Avg Temp", "Avg pH", "Final Brix"],
      rows: filteredHistory.map((item) => [
        item.batchId,
        item.startDate || "Unknown",
        typeof item.completedAt === "number" ? new Date(item.completedAt).toLocaleDateString() : "Unknown",
        item.finalYield || "Unknown",
        item.fruitsUsed || "Unknown",
        `${item.averageTemp}°C`,
        item.averagePh,
        item.targetBrixAchieved
      ]),
      sheetName: "Batch History",
    };
  };

  const exportToPDF = () => {
    const report = getReportData();
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Bunius-Sense Reports & Analytics", 14, 15);

    doc.setFontSize(12);
    doc.text(report.title, 14, 24);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 31);

    autoTable(doc, {
      head: [report.headers],
      body: report.rows,
      startY: 38,
    });

    doc.save(`BuniusSense-Report-${Date.now()}.pdf`);
  };

  const exportToExcel = () => {
    const report = getReportData();
    const workbook = XLSX.utils.book_new();

    const mainSheetData = [report.headers, ...report.rows.map((row) => row.map(guard))];
    const worksheet = XLSX.utils.aoa_to_sheet(mainSheetData);

    XLSX.utils.book_append_sheet(workbook, worksheet, report.sheetName);
    XLSX.writeFile(workbook, `BuniusSense-Report-${Date.now()}.xlsx`);
  };

  const printReport = () => {
    const report = getReportData();

    let html = `
      <html>
        <head>
          <title>Bunius-Sense ${esc(report.title)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
            h1, h2 { margin-bottom: 8px; }
            p { margin-top: 0; margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; margin-bottom: 24px; }
            th, td { border: 1px solid #ccc; padding: 10px; text-align: left; font-size: 12px; }
            th { background: #f5f5f5; }
          </style>
        </head>
        <body>
          <h1>Bunius-Sense Production Report</h1>
          <h2>${esc(report.title)}</h2>
          <p>Generated: ${esc(new Date().toLocaleString())}</p>
          <table>
            <thead>
              <tr>${report.headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${report.rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      alert("Popup blocked. Please allow popups to print the report.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    printWindow.focus();
    printWindow.print();
  };

  const handleExport = (type: ExportType) => {
    setShowExportMenu(false);
    if (type === "pdf") exportToPDF();
    if (type === "excel") exportToExcel();
    if (type === "print") printReport();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground">
         <Loader2Icon className="w-10 h-10 animate-spin text-primary mb-4" />
         <p>Loading historical data...</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-20 max-w-xl mx-auto">
      {/* Header & Export */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-foreground font-bold text-xl">Reports & Analytics</h1>
          <p className="text-sm text-muted-foreground">Production insights from {historicalData.length} completed batches</p>
        </div>

        <div className="flex gap-2">
          {/* ✅ NEW WIPE HISTORY BUTTON */}
          <Button
            size="icon"
            variant="outline"
            className="border-red-200 text-red-600 hover:bg-red-50"
            onClick={handleWipeHistory}
            disabled={historicalData.length === 0 || isWiping}
            aria-label="Delete all historical batch reports"
            title="Clear all historical data"
          >
            <Trash2Icon aria-hidden="true" className="w-4 h-4" />
          </Button>

          <div className="relative">
            <Button
              size="sm"
              onClick={() => setShowExportMenu((prev) => !prev)}
              disabled={historicalData.length === 0}
            >
              <DownloadIcon className="w-4 h-4 mr-2" />
              Export
            </Button>

            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-44 bg-card border border-border rounded-xl shadow-lg z-20 overflow-hidden">
                <button onClick={() => handleExport("pdf")} className="w-full px-4 py-3 text-left text-sm hover:bg-accent flex items-center gap-2 min-h-[44px]">
                  <FileTextIcon className="w-4 h-4 text-red-600" /> Export PDF
                </button>
                <button onClick={() => handleExport("excel")} className="w-full px-4 py-3 text-left text-sm hover:bg-accent flex items-center gap-2 min-h-[44px]">
                  <FileSpreadsheetIcon className="w-4 h-4 text-emerald-600" /> Export Excel
                </button>
                <button onClick={() => handleExport("print")} className="w-full px-4 py-3 text-left text-sm hover:bg-accent flex items-center gap-2 min-h-[44px]">
                  <PrinterIcon className="w-4 h-4 text-muted-foreground" /> Direct Print
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {wipeError && <p role="alert" className="text-sm text-destructive">{wipeError}</p>}

      {/* ✅ UPDATED METRIC CARDS (Now 4 Columns to include Fruits Used) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center flex flex-col justify-center h-full">
            <TrendingUpIcon className="w-5 h-5 mx-auto mb-1 text-emerald-700" />
            <p className="text-foreground font-bold text-lg tnum">{avgPh}</p>
            <p className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wider">Avg pH</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center flex flex-col justify-center h-full">
            <DropletIcon className="w-5 h-5 mx-auto mb-1 text-primary" />
            <p className="text-foreground font-bold text-lg tnum">{totalYield}</p>
            <p className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wider">Total Yield</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center flex flex-col justify-center h-full">
            <LeafIcon className="w-5 h-5 mx-auto mb-1 text-amber-700" />
            <p className="text-foreground font-bold text-lg tnum">{totalFruits}</p>
            <p className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wider">Fruit Used</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center flex flex-col justify-center h-full">
            <ThermometerIcon className="w-5 h-5 mx-auto mb-1 text-secondary-foreground" />
            <p className="text-foreground font-bold text-lg tnum">{avgTemp}</p>
            <p className="text-xs text-muted-foreground mt-0.5 uppercase tracking-wider">Avg Temp</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(value: string) => setActiveTab(value as TabType)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="weekly">Recent Trends</TabsTrigger>
          <TabsTrigger value="monthly">Yield Analysis</TabsTrigger>
          <TabsTrigger value="seasonal">Quality Spread</TabsTrigger>
        </TabsList>

        {historicalData.length === 0 ? (
           <Card className="mt-4 py-12 border-dashed bg-muted">
              <CardContent className="flex flex-col items-center text-center">
                <FileTextIcon className="w-12 h-12 text-muted-foreground mb-3" />
                <p className="text-muted-foreground font-medium">No Historical Data</p>
                <p className="text-xs text-muted-foreground mt-1">Start and complete a batch to generate analytics.</p>
              </CardContent>
           </Card>
        ) : (
          <>
            {/* TAB 1: Recent Trends */}
            <TabsContent value="weekly" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Batch Environment Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={weeklyGraphData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="batchId" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="temperature" stroke="var(--chart-3)" strokeWidth={2} dot={false} animationDuration={300} name="Temp (°C)" />
                      <Line yAxisId="right" type="monotone" dataKey="sugar" stroke="var(--chart-1)" strokeWidth={2} dot={false} animationDuration={300} name="Final Brix" />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 2: Yield Analysis */}
            <TabsContent value="monthly" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Production Yield per Batch (Liters)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={yieldGraphData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="batchId" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                      <Bar dataKey="yield" fill="var(--chart-1)" radius={[4, 4, 0, 0]} name="Yield (L)" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 3: Quality Spread */}
            <TabsContent value="seasonal" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Lifetime Quality Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={qualityDistribution.filter(d => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name.split(' ')[0]} ${((percent ?? 0) * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {qualityDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </TabsContent>
          </>
        )}
      </Tabs>

      {/* BATCH REPORT LIST */}
      {historicalData.length > 0 && (
        <div className="pt-6 mt-6 border-t border-border space-y-4">
          <h2 className="font-bold text-foreground flex items-center gap-2">
            <FileTextIcon className="w-5 h-5 text-primary" /> Production Reports Log
          </h2>
          <p className="text-xs text-muted-foreground mb-2">
            Showing {filteredHistory.length} of {historicalData.length} completed batches.
            {hiddenInvalidCount > 0 && (
              <> · {hiddenInvalidCount} invalid record{hiddenInvalidCount === 1 ? "" : "s"} hidden</>
            )}
          </p>

          {/* FILTER BAR */}
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end bg-muted border border-border rounded-2xl p-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                Search Batch ID
              </label>
              <div className="relative">
                <SearchIcon className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  placeholder="e.g. Batch #1234"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="text-sm pl-9"
                />
              </div>
            </div>

            <div className="min-w-[150px]">
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Quality</label>
              <select
                value={qualityFilter}
                onChange={(e) => setQualityFilter(e.target.value as QualityFilter)}
                className="min-h-[44px] w-full rounded-xl border border-input bg-input-background text-sm px-2 text-foreground"
              >
                <option value="all">All Grades</option>
                <option value="premium">Premium (15-18 Brix)</option>
                <option value="standard">Standard (13-14 Brix)</option>
                <option value="below">Below Standard</option>
              </select>
            </div>

            <div className="min-w-[130px]">
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="text-sm"
              />
            </div>

            <div className="min-w-[130px]">
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="text-sm"
              />
            </div>

            <div className="min-w-[140px]">
              <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Sort</label>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="min-h-[44px] w-full rounded-xl border border-input bg-input-background text-sm px-2 text-foreground"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
              </select>
            </div>

            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={resetFilters}
                className="gap-1 text-muted-foreground"
              >
                <FilterXIcon className="w-3.5 h-3.5" /> Clear Filters
              </Button>
            )}
          </div>

          <ScrollArea className="h-[400px]">
            <div className="space-y-3 pb-4">
               {filteredHistory.length === 0 ? (
                  <div className="flex flex-col items-center text-center py-10 text-muted-foreground">
                    <FilterXIcon className="w-8 h-8 mb-2" />
                    <p className="text-sm font-medium">No batches match your filters.</p>
                   <Button variant="outline" size="sm" onClick={resetFilters} className="mt-3">
                     Clear Filters
                   </Button>
                 </div>
               ) : (
               filteredHistory.map((report) => (
                  <Card
                    key={report.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedReport(report)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedReport(report);
                      }
                    }}
                    className="overflow-hidden border-l-4 border-l-emerald-600 cursor-pointer transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="font-bold text-sm text-foreground">{report.batchId}</p>
                           <p className="text-xs text-muted-foreground">Started: {report.startDate || "Unknown"}</p>
                           <p className="text-xs text-muted-foreground">Completed: {typeof report.completedAt === "number" ? new Date(report.completedAt).toLocaleDateString() : "Unknown"}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 rounded-full">
                            {report.finalYield} Yield
                          </Badge>
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 rounded-full">
                            {report.fruitsUsed} Fruit
                          </Badge>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Avg Temp</p>
                          <p className="text-sm font-medium">{report.averageTemp}°C</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Avg Acidity</p>
                          <p className="text-sm font-medium">{report.averagePh} pH</p>
                        </div>
<div>
                           <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Final Brix</p>
                           <p className="text-sm font-medium text-primary">{report.targetBrixAchieved}</p>
                        </div>
                      </div>

                      {/* AI ACCURACY — only for batches that captured a live
                          prediction to score (written by batchWrites.ts). */}
                      {report.aiAccuracy && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider mb-1">
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
                        </div>
                      )}

                      <p className="mt-3 pt-3 border-t border-border text-xs font-semibold text-primary flex items-center gap-1.5">
                        <FileTextIcon className="w-3.5 h-3.5" /> View full sensor record
                      </p>
                   </CardContent>
                 </Card>
               ))
               )}
            </div>
          </ScrollArea>
        </div>
      )}

      <BatchRecordSheet
        open={selectedReport !== null}
        onOpenChange={(o) => {
          if (!o) setSelectedReport(null);
        }}
        report={selectedReport}
      />
    </div>
  );
}