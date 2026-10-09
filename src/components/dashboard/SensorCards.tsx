import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DropletIcon,
  FlaskConicalIcon,
  GaugeIcon,
  MinusCircleIcon,
  ThermometerIcon,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { badgeClass } from "../../lib/sensorFormat";
import { SCALING } from "../../hooks/useDashboardLive";

interface ChartDatum {
  time: string;
  value: number;
}

/** Pairs every sensor status word with its pill icon (spec §1: never color alone). */
function StatusBadge({ status }: { status: string }) {
  const good = status === "Normal" || status === "On track";
  const bad = status === "Alert" || status === "Check OG";
  const Icon = good ? CheckCircle2Icon : bad ? AlertTriangleIcon : MinusCircleIcon;
  return (
    <Badge variant="outline" className={badgeClass(status)}>
      <Icon aria-hidden="true" />
      {status}
    </Badge>
  );
}

const tooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  fontSize: 12,
};

// Recharts honors the OS reduced-motion setting via this flag (see globals.css).
const reduceMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface SensorCardsProps {
  isBatchActive: boolean;
  tempNow: number | null;
  pressureNow: number | null;
  brixNow: number | null;
  brixSource?: string | null;
  phNow: number | null;
  tempStatus: string;
  brixStatus: string;
  phStatus: string;
  pressureStatus: string;
  temperatureData: ChartDatum[];
  pressureData: ChartDatum[];
  sugarData: ChartDatum[];
  phData: ChartDatum[];
  finishTargetBrix: number | null;
  daysSinceSugarTest: number | null;
  sugarTestDue: boolean;
  onLogSugar: () => void;
}

/** Real-time sensor cards with charts (moved verbatim out of Dashboard.tsx). */
export function SensorCards({
  isBatchActive,
  tempNow,
  pressureNow,
  brixNow,
  brixSource,
  phNow,
  tempStatus,
  brixStatus,
  phStatus,
  pressureStatus,
  temperatureData,
  pressureData,
  sugarData,
  phData,
  finishTargetBrix,
  daysSinceSugarTest,
  sugarTestDue,
  onLogSugar,
}: SensorCardsProps) {
  return (
    <div className={!isBatchActive ? 'opacity-60 grayscale-[0.3] pointer-events-none' : ''}>
      <h2 className="text-foreground mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Real-time Sensors</span>
        {!isBatchActive && <span className="text-xs text-amber-700 font-semibold px-2.5 py-0.5 bg-amber-50 border border-amber-200 rounded-full">Monitoring Disabled</span>}
      </h2>

      {/* Temperature Card */}
      <Card className="mb-3 rounded-2xl overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-orange-100 rounded-2xl flex items-center justify-center">
                <ThermometerIcon className="w-5 h-5 text-orange-700" />
              </div>
              <div>
                <CardTitle className="text-sm">Temperature</CardTitle>
                <p className="text-xs text-muted-foreground">Optimal: {SCALING.temp.min}-{SCALING.temp.max}°C</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-foreground font-bold text-2xl tracking-tight tnum">
                {!isBatchActive || tempNow == null ? "--" : `${tempNow.toFixed(1)}°C`}
              </p>
              <StatusBadge status={tempStatus} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={isBatchActive ? temperatureData : []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[24, 34]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="value" stroke="var(--chart-3)" strokeWidth={2.5} dot={false} animationDuration={300} isAnimationActive={!reduceMotion} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Pressure Card */}
      <Card className="mb-3 rounded-2xl overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-sky-100 rounded-2xl flex items-center justify-center">
                <GaugeIcon className="w-5 h-5 text-sky-700" />
              </div>
              <div>
                <CardTitle className="text-sm">Pressure</CardTitle>
                <p className="text-xs text-muted-foreground">Unit: PSI</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-foreground font-bold text-2xl tracking-tight tnum">
                {!isBatchActive || pressureNow == null ? "--" : `${pressureNow.toFixed(2)} PSI`}
              </p>
              <StatusBadge status={pressureStatus} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={isBatchActive ? pressureData : []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="value" stroke="var(--chart-5)" strokeWidth={2.5} dot={false} animationDuration={300} isAnimationActive={!reduceMotion} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Sugar Content Card */}
      <Card className="mb-3 rounded-2xl overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-secondary rounded-2xl flex items-center justify-center">
                <DropletIcon className="w-5 h-5 text-secondary-foreground" />
              </div>
              <div>
                <CardTitle className="text-sm">Sugar Content</CardTitle>
                <p className="text-xs text-muted-foreground">Target: {finishTargetBrix !== null ? `≤ ${finishTargetBrix} Brix` : "—"}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-foreground font-bold text-2xl tracking-tight tnum">
                {!isBatchActive || brixNow == null ? "--" : `${brixNow.toFixed(1)} Brix`}
              </p>
              {brixSource === 'predicted' && (
                <p className="text-xs text-muted-foreground">Soft sensor estimate</p>
              )}
              <StatusBadge status={brixStatus} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={isBatchActive ? sugarData : []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 30]} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="value" stroke="var(--chart-2)" strokeWidth={2.5} dot={false} animationDuration={300} isAnimationActive={!reduceMotion} />
            </LineChart>
          </ResponsiveContainer>

          <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-border sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Measured manually — no sugar sensor</p>
              <p className={`text-xs font-medium mt-0.5 ${sugarTestDue ? "text-amber-700" : "text-muted-foreground"}`}>
                {daysSinceSugarTest === null
                  ? "No reading logged yet"
                  : daysSinceSugarTest === 0
                  ? "Last tested today"
                  : `Last tested ${daysSinceSugarTest} day${daysSinceSugarTest === 1 ? "" : "s"} ago`}
                {sugarTestDue && " — due for retest"}
              </p>
            </div>
            <Button
              size="sm"
              onClick={onLogSugar}
              disabled={!isBatchActive}
              className="w-full sm:w-auto shrink-0 rounded-full shadow-md shadow-primary/25"
            >
              Log Sugar Test
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Acidity Card */}
      <Card className="rounded-2xl overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
                <FlaskConicalIcon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm">Acidity (pH)</CardTitle>
                <p className="text-xs text-muted-foreground">Optimal: {SCALING.ph.min}-{SCALING.ph.max}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-foreground font-bold text-2xl tracking-tight tnum">{!isBatchActive || phNow == null ? "--" : `${phNow.toFixed(2)} pH`}</p>
              <StatusBadge status={phStatus} />
            </div>
          </div>

          {(isBatchActive && phData.length > 0) && (
            <div className="mt-3">
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={phData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[3.0, 4.2]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} animationDuration={300} isAnimationActive={!reduceMotion} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
