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
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-gray-900">Fruit Sorting</h1>
          <p className="text-sm text-gray-500">Color-based quality classification report</p>
        </div>
        <PaletteIcon className="w-6 h-6 text-[#8B1538]" />
      </div>

      {/* Mode Toggle */}
      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ScanLineIcon className="w-5 h-5 text-[#6B2C5D]" />
              <div>
                <Label htmlFor="auto-mode" className="cursor-pointer">
                  Automatic Sorting Mode
                </Label>
                <p className="text-xs text-gray-600">Color-based classification enabled</p>
              </div>
            </div>
            <Switch
              id="auto-mode"
              checked={autoMode}
              onCheckedChange={setAutoMode}
              className="data-[state=checked]:bg-[#8B1538]"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {autoMode ? "Auto mode is ON — generating report from classifications." : "Manual mode — report still available."}
          </p>
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-gray-900">{report.total}</p>
            <p className="text-xs text-gray-500 mt-1">Total</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-3 text-center">
            <p className="text-green-700">{report.qualified}</p>
            <p className="text-xs text-green-600 mt-1">Qualified</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-3 text-center">
            <p className="text-red-700">{report.rejected}</p>
            <p className="text-xs text-red-600 mt-1">Rejected</p>
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
              className="w-2 h-2 bg-[#8B1538] rounded-full"
            />
            Sorting Report (By Color)
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Average Confidence</span>
            <span className="text-gray-900">{report.avgConfidence}%</span>
          </div>

          <div className="space-y-2">
            {report.colorRows.map((row) => (
              <div key={row.color} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-gray-900 text-xs">{row.color}</Badge>
                    <span className="text-xs text-gray-500">
                      Pass rate: {row.passRate}% • Avg conf: {row.avgConfidence}%
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">Total: {row.total}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="rounded-md bg-green-50 border border-green-200 p-2 text-center">
                    <p className="text-green-700 text-sm">{row.qualified}</p>
                    <p className="text-xs text-green-700/80">Qualified</p>
                  </div>
                  <div className="rounded-md bg-red-50 border border-red-200 p-2 text-center">
                    <p className="text-red-700 text-sm">{row.rejected}</p>
                    <p className="text-xs text-red-700/80">Rejected</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Classifications */}
      <div>
        <h2 className="text-gray-900 mb-3">Recent Classifications</h2>
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
                <Card className={fruit.status === "qualified" ? "border-green-300" : "border-red-300"}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {fruit.status === "qualified" ? (
                          <CheckCircle2Icon className="w-5 h-5 text-green-600" />
                        ) : (
                          <XCircleIcon className="w-5 h-5 text-red-600" />
                        )}
                        <div>
                          <p className="text-sm text-gray-900">Fruit #{fruit.id}</p>
                          <p className="text-xs text-gray-500">Detected Color: {fruit.color}</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <Badge
                          variant={fruit.status === "qualified" ? "default" : "destructive"}
                          className={fruit.status === "qualified" ? "bg-green-500 text-xs" : "text-xs"}
                        >
                          {fruit.status === "qualified" ? "Qualified" : "Rejected"}
                        </Badge>
                        <p className="text-xs text-gray-600 mt-1">{fruit.confidence}%</p>
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