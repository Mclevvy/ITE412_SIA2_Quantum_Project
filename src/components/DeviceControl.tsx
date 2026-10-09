import { useEffect, useState, useRef } from "react";
import { ref, onValue, get, update, push, serverTimestamp } from "firebase/database";
import { db } from "../lib/firebase";
import { writeErrorMessage } from "../lib/rtdbError";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  WifiIcon,
  WifiOffIcon,
  ThermometerIcon,
  CameraIcon,
  DropletIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  SettingsIcon,
  ActivityIcon,
  XIcon,
  ExternalLinkIcon,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";

interface Device {
  id: string;
  name: string;
  type: string;
  status: "online" | "offline" | "manual";
  icon: LucideIcon;
  lastUpdate: string;
  lastSeen?: number;
  value?: string;
  enabled: boolean;
  controlKey?: string;
}

const DEVICE_PORTAL_BASE = "http://192.168.4.1";
const OFFLINE_TIMEOUT_MS = 70000;

/**
 * ESP32 firmware commonly writes heartbeats as Unix SECONDS (time()), while
 * the web app compares against Date.now() MILLISECONDS. Comparing seconds
 * against ms always exceeds the timeout, so every device reads permanently
 * "offline" even with live sensor values flowing. Normalize both units here.
 */
function normalizeHeartbeat(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  if (value >= 1e12) return value; // already ms
  if (value >= 1e9) return value * 1000; // seconds → ms
  return undefined;
}

function readLastSeen(data: any): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  return normalizeHeartbeat(data.lastSeen ?? data.timestamp ?? data.updatedAt);
}

function getDeviceStatusFromLastSeen(lastSeen?: number): "online" | "offline" {
  if (!lastSeen) return "offline";
  return Date.now() - lastSeen <= OFFLINE_TIMEOUT_MS ? "online" : "offline";
}

function formatLastSeen(lastSeen?: number): string {
  if (!lastSeen) return "No heartbeat yet";

  const diff = Date.now() - lastSeen;

  if (diff < 5000) return "Just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)} sec ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;

  return new Date(lastSeen).toLocaleString();
}

function WifiSetupModal({
  open,
  onClose,
  deviceName = "Sensor Module",
}: {
  open: boolean;
  onClose: () => void;
  deviceName?: string;
}) {
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "fail">("idle");
  const [msg, setMsg] = useState("");

  if (!open) return null;

  const openPortal = () => window.open(`${DEVICE_PORTAL_BASE}/`, "_blank");
  const openScanPage = () => window.open(`${DEVICE_PORTAL_BASE}/scanpage`, "_blank");

  async function saveWifi() {
    setStatus("saving");
    setMsg("");

    try {
      const res = await fetch(`${DEVICE_PORTAL_BASE}/wifi`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ssid, pass }).toString(),
      });

      const text = await res.text();

      if (!res.ok) {
        setStatus("fail");
        setMsg(text || "Save failed. Please try again.");
        return;
      }

      setStatus("ok");
      setMsg(
        "Saved! The device will restart and connect to the new Wi-Fi. The FERMA_SETUP hotspot will disappear."
      );
    } catch {
      setStatus("fail");
      setMsg(
        "Cannot reach the device portal. Make sure you are connected to the device hotspot (FERMA_SETUP_XXXX) and try again."
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-safe">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full sm:max-w-lg bg-card rounded-t-3xl sm:rounded-2xl shadow-xl p-4 sm:p-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-foreground font-semibold">Configure Wi-Fi</p>
            <p className="text-sm text-muted-foreground">{deviceName}</p>
          </div>
          <Button variant="outline" size="icon" onClick={onClose} aria-label="Close">
            <XIcon className="w-4 h-4" />
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Steps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="flex gap-2">
                <Badge variant="outline" className="text-xs">
                  1
                </Badge>
                <span>
                  Power the device. If it can’t connect, it creates a hotspot like{" "}
                  <b>FERMA_SETUP_XXXX</b> (password: <b>ferma1234</b>).
                </span>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-xs">
                  2
                </Badge>
                <span>Connect your phone/laptop to that hotspot.</span>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-xs">
                  3
                </Badge>
                <span>Use the portal or enter SSID/password below.</span>
              </div>

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="w-full" onClick={openPortal}>
                  <ExternalLinkIcon className="w-4 h-4 mr-2" />
                  Open Portal
                </Button>
                <Button variant="outline" className="w-full" onClick={openScanPage}>
                  <ExternalLinkIcon className="w-4 h-4 mr-2" />
                  Open Scan Page
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Set Wi-Fi from the app</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <Label htmlFor="wifi-ssid">Wi-Fi name (SSID)</Label>
                <Input
                  id="wifi-ssid"
                  value={ssid}
                  onChange={(e) => setSsid(e.target.value)}
                  placeholder="SSID (Wi-Fi name)"
                  autoComplete="off"
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="wifi-password">Wi-Fi password</Label>
                <Input
                  id="wifi-password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="Password"
                  type="password"
                  autoComplete="new-password"
                  className="mt-1"
                />
              </div>

              <Button
                className="w-full"
                onClick={saveWifi}
                disabled={status === "saving" || !ssid.trim()}
              >
                {status === "saving" ? "Saving..." : "Save Wi-Fi & Restart"}
              </Button>

              {status !== "idle" && (
                <div
                  className={`text-sm p-2 rounded-xl border ${
                    status === "ok"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : status === "fail"
                      ? "bg-red-50 text-[#B91C1C] border-red-200"
                      : "bg-muted text-muted-foreground border-border"
                  }`}
                >
                  {msg}
                </div>
              )}

              <p className="text-xs text-muted-foreground pt-1">
                This works only while the device is in Setup Mode and you are connected to its
                hotspot.
              </p>
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}

export default function DeviceControl() {
  const [devices, setDevices] = useState<Device[]>([
    {
      id: "1",
      name: "Temperature Sensor",
      type: "sensor",
      status: "offline",
      icon: ThermometerIcon,
      lastUpdate: "Waiting for device...",
      value: "-- °C",
      enabled: true,
      controlKey: "sugarMonitor",
    },
    {
      id: "2",
      name: "Sugar Test (Manual)",
      type: "manual",
      status: "manual",
      icon: DropletIcon,
      lastUpdate: "No manual reading yet",
      value: "-- Brix",
      enabled: true,
      // No controlKey: this isn't ESP32 hardware — the operator logs Brix by hand
      // from the Dashboard. See handleLogSugarTest() in Dashboard.tsx.
    },
    {
      id: "3",
      name: "Acidity Sensor",
      type: "sensor",
      status: "offline",
      icon: FlaskConicalIcon,
      lastUpdate: "Waiting for device...",
      value: "-- pH",
      enabled: true,
      controlKey: "sugarMonitor",
    },
    {
      id: "4",
      name: "Camera Module",
      type: "camera",
      status: "offline",
      icon: CameraIcon,
      lastUpdate: "Waiting for device...",
      value: "Unavailable",
      enabled: true,
      controlKey: "sugarMonitor",
    },
    {
      id: "5",
      name: "Backup Sensor",
      type: "sensor",
      status: "offline",
      icon: ActivityIcon,
      lastUpdate: "No heartbeat",
      value: "N/A",
      enabled: false,
    },
  ]);

  const [wifiModalOpen, setWifiModalOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ✅ Track offline notifications to avoid spamming the database
  const hasNotifiedOfflineRef = useRef<boolean>(false);
  // Freshest heartbeat seen from each source. The dedicated status node wins;
  // live sensor data is the fallback for firmware that never writes it.
  const statusLastSeenRef = useRef<number | undefined>(undefined);
  const sensorsUpdatedAtRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const controlRef = ref(db, "deviceControl/sugarMonitor");
    const statusRef = ref(db, "deviceStatus/sugarMonitor");
    const currentRef = ref(db, "sensors/current");
    // Brix readings live under sensors/sugar/current/brix (see Dashboard.tsx / FermentationTracker.tsx),
    // not sensors/current/sugarBrix — that path is never written, so it was read here separately.
    const sugarRef = ref(db, "sensors/sugar/current");

    // ✅ Helper to push offline notification
    const checkAndNotifyOfflineStatus = async (status: string) => {
        if (!db) return;
        
        if (status === "offline" && !hasNotifiedOfflineRef.current) {
            hasNotifiedOfflineRef.current = true;
            try {
                await push(ref(db, 'notifications'), {
                    type: 'warning',
                    title: 'Device Offline',
                    message: 'The sensor module (temperature & pH) has lost connection or stopped sending heartbeats.',
                    timestamp: serverTimestamp(),
                    iconName: 'WifiOffIcon',
                    unread: true
                });
            } catch (e) {
                console.error("Failed to send offline notification:", e);
            }
        } else if (status === "online" && hasNotifiedOfflineRef.current) {
            // Reset the flag if it comes back online, optionally send a success notification
            hasNotifiedOfflineRef.current = false;
             try {
                await push(ref(db, 'notifications'), {
                    type: 'success',
                    title: 'Device Online',
                    message: 'The sensor module (temperature & pH) has reconnected successfully.',
                    timestamp: serverTimestamp(),
                    iconName: 'WifiIcon',
                    unread: true
                });
            } catch (e) {
                console.error("Failed to send online notification:", e);
            }
        }
    };

    // Effective heartbeat: dedicated status node first, live sensor data as
    // fallback. Without the fallback, firmware that streams sensor values but
    // never writes deviceStatus/... shows permanently "offline" ("No
    // heartbeat yet") despite fresh readings.
    const effectiveStatus = () => {
      const lastSeen = statusLastSeenRef.current ?? sensorsUpdatedAtRef.current;
      return {
        lastSeen,
        status: getDeviceStatusFromLastSeen(lastSeen),
        lastUpdate: formatLastSeen(lastSeen),
      };
    };

    const unsubControl = onValue(controlRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      setDevices((prev) =>
        prev.map((device) =>
          device.controlKey === "sugarMonitor"
            ? {
                ...device,
                enabled: typeof data.enabled === "boolean" ? data.enabled : device.enabled,
              }
            : device
        )
      );
    });

    const unsubStatus = onValue(statusRef, (snapshot) => {
      statusLastSeenRef.current = readLastSeen(snapshot.val());
      const { lastSeen, status, lastUpdate } = effectiveStatus();

      // Check and trigger notification on status change
      checkAndNotifyOfflineStatus(status);

      setDevices((prev) =>
        prev.map((device) =>
          device.controlKey === "sugarMonitor"
            ? { ...device, lastSeen, status, lastUpdate }
            : device
        )
      );
    });

    const unsubCurrent = onValue(currentRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      // Fresh sensor values prove the module is alive — feed them into the
      // heartbeat fallback so status tracks reality.
      const sensorsFresh = normalizeHeartbeat(data.updatedAt ?? data.time);
      if (sensorsFresh !== undefined) sensorsUpdatedAtRef.current = sensorsFresh;
      const eff = effectiveStatus();

      setDevices((prev) =>
        prev.map((device) => {
          let next = device;

          if (device.name === "Temperature Sensor") {
            next =
              typeof data.temperature === "number"
                ? { ...next, value: `${data.temperature.toFixed(1)}°C` }
                : next;
          }

          if (device.name === "Acidity Sensor") {
            next =
              typeof data.ph === "number"
                ? { ...next, value: `${data.ph.toFixed(2)} pH` }
                : next;
          }

          if (device.name === "Camera Module") {
            next = { ...next, value: "Monitoring" };
          }

          if (device.controlKey === "sugarMonitor") {
            next = { ...next, lastSeen: eff.lastSeen, status: eff.status, lastUpdate: eff.lastUpdate };
          }

          return next;
        })
      );
    });

    const unsubSugar = onValue(sugarRef, (snapshot) => {
      const data = snapshot.val();
      const brix = typeof data?.brix === "number" ? data.brix : null;
      const time = typeof data?.time === "number" ? data.time : undefined;
      if (brix === null) return;

      setDevices((prev) =>
        prev.map((device) =>
          device.name === "Sugar Test (Manual)"
            ? { ...device, value: `${brix.toFixed(1)} Brix`, lastUpdate: time ? formatLastSeen(time) : device.lastUpdate }
            : device
        )
      );
    });

    const interval = setInterval(() => {
      const eff = effectiveStatus();
      // Also check periodically in case the database value hasn't changed but the local time has passed the timeout
      checkAndNotifyOfflineStatus(eff.status);
      setDevices((prev) =>
        prev.map((device) =>
          device.controlKey === "sugarMonitor"
            ? { ...device, lastSeen: eff.lastSeen, status: eff.status, lastUpdate: eff.lastUpdate }
            : device
        )
      );
    }, 5000);

    return () => {
      unsubControl();
      unsubStatus();
      unsubCurrent();
      unsubSugar();
      clearInterval(interval);
    };
  }, []);

  const toggleDevice = async (id: string) => {
    const currentDevice = devices.find((d) => d.id === id);
    if (!currentDevice || currentDevice.status === "offline") return;

    if (currentDevice.controlKey !== "sugarMonitor") {
      alert("This device isn't connected to ESP32 hardware control. (Sugar Test is logged manually from the Dashboard.)");
      return;
    }

    const newEnabled = !currentDevice.enabled;

    setDevices((prev) =>
      prev.map((device) =>
        device.controlKey === "sugarMonitor"
          ? { ...device, enabled: newEnabled }
          : device
      )
    );

    setLoadingId(id);

    try {
      await update(ref(db, `deviceControl/${currentDevice.controlKey}`), {
        enabled: newEnabled,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error("Failed to toggle device:", error);

      setDevices((prev) =>
        prev.map((device) =>
          device.controlKey === "sugarMonitor"
            ? { ...device, enabled: currentDevice.enabled }
            : device
        )
      );

      alert(writeErrorMessage(error, "Failed to update device state in Firebase."));
    } finally {
      setLoadingId(null);
    }
  };

  // Refresh previously only recomputed from LOCAL state, so it could never
  // fix a stale/missed listener update — the button visibly did nothing. It
  // now re-reads the three source paths from Firebase and applies them.
  const refreshAllDevices = async () => {
    if (!db || refreshing) return;
    setRefreshing(true);
    try {
      const [statusSnap, currentSnap, sugarSnap] = await Promise.all([
        get(ref(db, "deviceStatus/sugarMonitor")),
        get(ref(db, "sensors/current")),
        get(ref(db, "sensors/sugar/current")),
      ]);

      const current = currentSnap.val();
      const lastSeen =
        readLastSeen(statusSnap.val()) ??
        normalizeHeartbeat(current?.updatedAt ?? current?.time);
      const computedStatus = getDeviceStatusFromLastSeen(lastSeen);
      const sugarBrix = typeof sugarSnap.val()?.brix === "number" ? sugarSnap.val().brix : null;
      const sugarTime = typeof sugarSnap.val()?.time === "number" ? sugarSnap.val().time : undefined;

      setDevices((prev) =>
        prev.map((device) => {
          if (device.controlKey === "sugarMonitor") {
            const next = { ...device, lastSeen, status: computedStatus, lastUpdate: formatLastSeen(lastSeen) };
            if (device.name === "Temperature Sensor" && typeof current?.temperature === "number") {
              next.value = `${current.temperature.toFixed(1)}°C`;
            }
            if (device.name === "Acidity Sensor" && typeof current?.ph === "number") {
              next.value = `${current.ph.toFixed(2)} pH`;
            }
            if (device.name === "Camera Module" && current) {
              next.value = "Monitoring";
            }
            return next;
          }
          if (device.name === "Sugar Test (Manual)" && sugarBrix !== null) {
            return {
              ...device,
              value: `${sugarBrix.toFixed(1)} Brix`,
              lastUpdate: sugarTime ? formatLastSeen(sugarTime) : device.lastUpdate,
            };
          }
          return device;
        })
      );
    } catch (error) {
      console.error("Failed to refresh devices:", error);
    } finally {
      setRefreshing(false);
    }
  };

  // Count only real ESP32 hardware toward online/total — the manual-entry
  // row and the placeholder backup row can never be "online" and previously
  // dragged the headline count down permanently.
  const hardwareDevices = devices.filter((d) => d.controlKey === "sugarMonitor");
  const onlineDevices = hardwareDevices.filter((d) => d.status === "online").length;
  const totalDevices = hardwareDevices.length;
  const systemActive = devices.some(
    (d) => d.controlKey === "sugarMonitor" && d.status === "online" && d.enabled
  );

  return (
    <div className="p-4 space-y-4 pb-20 max-w-xl mx-auto">
      <WifiSetupModal
        open={wifiModalOpen}
        onClose={() => setWifiModalOpen(false)}
        deviceName="Sensor Module"
      />

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-foreground font-bold text-xl">Device Control</h1>
          <p className="text-sm text-muted-foreground">Manage your IoT devices</p>
        </div>
        <SettingsIcon className="w-6 h-6 text-primary" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-foreground font-bold text-2xl tnum">
                  {onlineDevices}/{totalDevices}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Devices Online</p>
              </div>
              <WifiIcon className="w-8 h-8 text-emerald-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-foreground font-bold text-2xl">{systemActive ? "Active" : "Inactive"}</p>
                <p className="text-xs text-muted-foreground mt-1">System Status</p>
              </div>
              <motion.div
                animate={systemActive ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <ActivityIcon className="w-8 h-8 opacity-80" />
              </motion.div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Button variant="outline" className="w-full rounded-full" onClick={refreshAllDevices} disabled={refreshing}>
        <RefreshCwIcon className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
        {refreshing ? "Refreshing..." : "Refresh All Devices"}
      </Button>

      <div>
        <h2 className="text-foreground font-bold mb-3">Connected Devices</h2>
        <div className="space-y-3">
          {devices.map((device, index) => {
            const Icon = device.icon;

            return (
              <motion.div
                key={device.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className={device.status === "offline" ? "opacity-60" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          device.status === "online"
                            ? "bg-emerald-100"
                            : device.status === "manual"
                            ? "bg-secondary"
                            : "bg-muted"
                        }`}
                      >
                        <Icon
                          className={`w-6 h-6 ${
                            device.status === "online"
                              ? "text-emerald-700"
                              : device.status === "manual"
                              ? "text-secondary-foreground"
                              : "text-muted-foreground"
                          }`}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-foreground font-medium">{device.name}</p>
                          {device.status === "online" && (
                            <Badge
                              variant="outline"
                              className="bg-emerald-50 border-emerald-200 text-emerald-700 rounded-full text-xs"
                            >
                              <WifiIcon className="w-3 h-3 mr-1" />
                              Online
                            </Badge>
                          )}
                          {device.status === "offline" && (
                            <Badge
                              variant="outline"
                              className="bg-muted border-border text-muted-foreground rounded-full text-xs"
                            >
                              <WifiOffIcon className="w-3 h-3 mr-1" />
                              Offline
                            </Badge>
                          )}
                          {device.status === "manual" && (
                            <Badge
                              variant="outline"
                              className="bg-secondary border-border text-secondary-foreground rounded-full text-xs"
                            >
                              Manual Entry
                            </Badge>
                          )}

                          {device.status !== "manual" && (device.enabled ? (
                            <Badge variant="outline" className="rounded-full text-xs">
                              Enabled
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-amber-50 border-amber-200 text-amber-700 rounded-full text-xs"
                            >
                              Disabled
                            </Badge>
                          ))}
                        </div>

                        <p className="text-sm text-muted-foreground mt-1">
                          {device.value} • {device.lastUpdate}
                        </p>
                      </div>

                      {device.status !== "manual" && (
                        <Switch
                          checked={device.enabled}
                          onCheckedChange={() => toggleDevice(device.id)}
                          disabled={
                            device.status === "offline" ||
                            loadingId === device.id ||
                            device.controlKey !== "sugarMonitor"
                          }
                        />
                      )}
                    </div>

                    {device.name === "Temperature Sensor" && (
                      <div className="pt-3">
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => setWifiModalOpen(true)}
                        >
                          Change Wi-Fi (Setup Mode)
                        </Button>
                        <p className="text-xs text-muted-foreground mt-2">
                          Use this when deploying to a different network while the device is sealed. Covers the temperature &amp; pH sensor module.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">System Health</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Network Latency</span>
            <span className="text-emerald-700">
              {systemActive ? "Connected" : "Unavailable"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Data Accuracy</span>
            <span className="text-muted-foreground">
              Not measured
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Last Calibration</span>
            <span className="text-foreground">Not recorded</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Next Maintenance</span>
            <span className="text-amber-700">Not scheduled</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}