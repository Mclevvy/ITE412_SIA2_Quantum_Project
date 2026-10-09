import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { CheckCircle2Icon, XCircleIcon, ScanLineIcon, PaletteIcon } from "lucide-react";
import { motion } from "motion/react";

type FruitStatus = "qualified" | "unqualified";

type SortedFruit = {
  id: number;
  color: string;
  status: FruitStatus;
  confidence: number;
};

type ColorStats = {
  total: number;
  qualified: number;
  rejected: number;
  confSum: number;
};

type ColorMap = Record<string, ColorStats>;

export default function FruitSorting() {
  const [autoMode, setAutoMode] = useState(true);

  // Sample results after color-based sorting/classification
  const sortedFruits: SortedFruit[] = [
    { id: 1, color: "Dark Red", status: "qualified", confidence: 95 },
    { id: 2, color: "Purple", status: "qualified", confidence: 88 },
    { id: 3, color: "Green", status: "unqualified", confidence: 92 },
    { id: 4, color: "Dark Red", status: "qualified", confidence: 96 },
    { id: 5, color: "Brown", status: "unqualified", confidence: 85 },
    { id: 6, color: "Purple", status: "qualified", confidence: 90 },
  ];

  const report = useMemo(() => {
    const total = sortedFruits.length;
    const qualified = sortedFruits.filter((f) => f.status === "qualified").length;
    const rejected = total - qualified;

    const byColor: ColorMap = sortedFruits.reduce<ColorMap>((acc, item) => {
      const key = item.color?.trim() || "Unknown";

      if (!acc[key]) {
        acc[key] = { total: 0, qualified: 0, rejected: 0, confSum: 0 };
      }

      acc[key].total += 1;
      if (item.status === "qualified") acc[key].qualified += 1;
      else acc[key].rejected += 1;

      acc[key].confSum += item.confidence ?? 0;

      return acc;
    }, {});

    const colorRows = Object.entries(byColor)
      .map(([color, v]) => {
        const avgConfidence = v.total ? Math.round(v.confSum / v.total) : 0;
        const passRate = v.total ? Math.round((v.qualified / v.total) * 100) : 0;

        return {
          color,
          total: v.total,
          qualified: v.qualified,
          rejected: v.rejected,
          avgConfidence,
          passRate,
        };
      })
      .sort((a, b) => b.total - a.total);

    const avgConfidence =
      total > 0
        ? Math.round(sortedFruits.reduce((s, f) => s + (f.confidence ?? 0), 0) / total)
        : 0;

    return { total, qualified, rejected, colorRows, avgConfidence };
  }, [sortedFruits]);

  return (
    <div className="p-4 space-y-4 pb-20 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-foreground font-bold text-xl">Fruit Sorting</h1>
          <p className="text-sm text-muted-foreground">Color-based quality classification report</p>
        </div>
        <PaletteIcon className="w-6 h-6 text-primary" />
      </div>

      {/* Sample-data notice: these rows are placeholders, not live classifier output */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="p-3">
          <p className="text-xs text-amber-800 font-medium">Sample data — no live classifier connected</p>
        </CardContent>
      </Card>

      {/* Mode Toggle */}
      <Card className="bg-secondary border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ScanLineIcon className="w-5 h-5 text-secondary-foreground" />
              <div>
                <Label htmlFor="auto-mode" className="cursor-pointer">
                  Automatic Sorting Mode
                </Label>
                <p className="text-xs text-muted-foreground">Color-based classification enabled</p>
              </div>
            </div>
            <Switch
              id="auto-mode"
              checked={autoMode}
              onCheckedChange={setAutoMode}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {autoMode ? "Auto mode is ON — generating report from classifications." : "Manual mode — report still available."}
          </p>
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-foreground text-2xl font-bold tnum">{report.total}</p>
            <p className="text-xs text-muted-foreground mt-1">Total</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-3 text-center">
            <p className="text-emerald-700 text-2xl font-bold tnum">{report.qualified}</p>
            <p className="text-xs text-emerald-700 mt-1">Qualified</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-3 text-center">
            <p className="text-[#B91C1C] text-2xl font-bold tnum">{report.rejected}</p>
            <p className="text-xs text-[#B91C1C] mt-1">Rejected</p>
          </CardContent>
        </Card>
      </div>

      {/* Sorting Report */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <motion.div
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              className="w-2 h-2 bg-primary rounded-full"
            />
            Sorting Report (By Color)
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Average sample score</span>
            <span className="text-foreground font-bold tnum">{report.avgConfidence}</span>
          </div>

          <div className="space-y-2">
            {report.colorRows.map((row) => (
              <div key={row.color} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="rounded-full text-xs">{row.color}</Badge>
                    <span className="text-xs text-muted-foreground">
                      Pass rate: {row.passRate}% • Avg score: {row.avgConfidence}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">Total: {row.total}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2 text-center">
                    <p className="text-emerald-700 text-sm font-bold tnum">{row.qualified}</p>
                    <p className="text-xs text-emerald-700">Qualified</p>
                  </div>
                  <div className="rounded-xl bg-red-50 border border-red-200 p-2 text-center">
                    <p className="text-[#B91C1C] text-sm font-bold tnum">{row.rejected}</p>
                    <p className="text-xs text-[#B91C1C]">Rejected</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Classifications */}
      <div>
        <h2 className="text-foreground font-bold mb-3">Recent Classifications</h2>
        <div className="space-y-2">
          {sortedFruits
            .slice()
            .reverse()
            .slice(0, 8)
            .map((fruit, idx) => (
              <motion.div
                key={fruit.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className={fruit.status === "qualified" ? "border-emerald-200" : "border-red-200"}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {fruit.status === "qualified" ? (
                          <CheckCircle2Icon className="w-5 h-5 text-emerald-600" />
                        ) : (
                          <XCircleIcon className="w-5 h-5 text-red-600" />
                        )}
                        <div>
                          <p className="text-sm text-foreground font-medium">Fruit #{fruit.id}</p>
                          <p className="text-xs text-muted-foreground">Detected Color: {fruit.color}</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <Badge
                          variant="outline"
                          className={fruit.status === "qualified" ? "bg-emerald-50 text-emerald-700 border-emerald-200 rounded-full text-xs" : "bg-red-50 text-[#B91C1C] border-red-200 rounded-full text-xs"}
                        >
                          {fruit.status === "qualified" ? "Qualified" : "Rejected"}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
        </div>
      </div>
    </div>
  );
}