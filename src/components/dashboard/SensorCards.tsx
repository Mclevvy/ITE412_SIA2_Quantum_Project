import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropletIcon,
  FlaskConicalIcon,
  GaugeIcon,
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

interface SensorCardsProps {
  isBatchActive: boolean;
  tempNow: number | null;
  pressureNow: number | null;
  brixNow: number | null;
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
      <h2 className="text-gray-900 mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8B1538]">Real-time Sensors</span>
        {!isBatchActive && <span className="text-xs text-amber-600 font-bold px-2 py-1 bg-amber-100 rounded-full">Monitoring Disabled</span>}
      </h2>

      {/* Temperature Card */}
      <Card className="mb-3 rounded-3xl border-0 bg-white shadow-[0_2px_16px_-4px_rgba(60,10,25,0.15)] ring-1 ring-black/5 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-orange-100 rounded-2xl flex items-center justify-center">
                <ThermometerIcon className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <CardTitle className="text-sm">Temperature</CardTitle>
                <p className="text-xs text-gray-500">Optimal: {SCALING.temp.min}-{SCALING.temp.max}°C</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-gray-900 font-bold text-2xl tracking-tight">
                {!isBatchActive || tempNow == null ? "--" : `${tempNow.toFixed(1)}°C`}
              </p>
              <Badge variant="outline" className={badgeClass(tempStatus)}>
                {tempStatus}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={isBatchActive ? temperatureData : []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[24, 34]} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#f97316" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Pressure Card */}
      <Card className="mb-3 rounded-3xl border-0 bg-white shadow-[0_2px_16px_-4px_rgba(60,10,25,0.15)] ring-1 ring-black/5 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-sky-100 rounded-2xl flex items-center justify-center">
                <GaugeIcon className="w-5 h-5 text-sky-700" />
              </div>
              <div>
                <CardTitle className="text-sm">Pressure</CardTitle>
                <p className="text-xs text-gray-500">Unit: PSI</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-gray-900 font-bold text-2xl tracking-tight">
                {!isBatchActive || pressureNow == null ? "--" : `${pressureNow.toFixed(2)} PSI`}
              </p>
              <Badge variant="outline" className={badgeClass(pressureStatus)}>
                {pressureStatus}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={isBatchActive ? pressureData : []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#0284c7" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Sugar Content Card */}
      <Card className="mb-3 rounded-3xl border-0 bg-white shadow-[0_2px_16px_-4px_rgba(60,10,25,0.15)] ring-1 ring-black/5 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-purple-100 rounded-2xl flex items-center justify-center">
                <DropletIcon className="w-5 h-5 text-[#6B2C5D]" />
              </div>
              <div>
                <CardTitle className="text-sm">Sugar Content</CardTitle>
                <p className="text-xs text-gray-500">Target: {finishTargetBrix !== null ? `≤ ${finishTargetBrix} Brix` : "—"}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-gray-900 font-bold text-2xl tracking-tight">
                {!isBatchActive || brixNow == null ? "--" : `${brixNow.toFixed(1)} Brix`}
              </p>
              <Badge variant="outline" className={badgeClass(brixStatus)}>
                {brixStatus}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={isBatchActive ? sugarData : []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 30]} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#6B2C5D" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>

          <div className="flex flex-col gap-3 mt-3 pt-3 border-t border-gray-100 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Measured manually — no sugar sensor</p>
              <p className={`text-xs font-medium mt-0.5 ${sugarTestDue ? "text-amber-600" : "text-gray-600"}`}>
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
              className="w-full sm:w-auto bg-[#6B2C5D] hover:bg-[#4B1C3D] text-white shrink-0 rounded-full shadow-md shadow-[#6B2C5D]/25"
            >
              Log Sugar Test
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Acidity Card */}
      <Card className="rounded-3xl border-0 bg-white shadow-[0_2px_16px_-4px_rgba(60,10,25,0.15)] ring-1 ring-black/5 overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-red-100 rounded-2xl flex items-center justify-center">
                <FlaskConicalIcon className="w-5 h-5 text-[#8B1538]" />
              </div>
              <div>
                <CardTitle className="text-sm">Acidity (pH)</CardTitle>
                <p className="text-xs text-gray-500">Optimal: {SCALING.ph.min}-{SCALING.ph.max}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-gray-900 font-bold text-2xl tracking-tight">{!isBatchActive || phNow == null ? "--" : `${phNow.toFixed(2)} pH`}</p>
              <Badge variant="outline" className={badgeClass(phStatus)}>
                {phStatus}
              </Badge>
            </div>
          </div>

          {(isBatchActive && phData.length > 0) && (
            <div className="mt-3">
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={phData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[3.0, 4.2]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#8B1538" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
