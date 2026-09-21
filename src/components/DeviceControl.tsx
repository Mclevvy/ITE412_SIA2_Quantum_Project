import { useEffect, useState, useRef } from "react";
import { ref, onValue, update, push, serverTimestamp } from "firebase/database";
import { db } from "../lib/firebase";

import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-4 sm:p-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-900 font-semibold">Configure Wi-Fi</p>
            <p className="text-sm text-gray-500">{deviceName}</p>
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
            <CardContent className="space-y-2 text-sm text-gray-600">
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
              <Input
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                placeholder="SSID (Wi-Fi name)"
              />
              <Input
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="Password"
                type="password"
              />

              <Button
                className="w-full bg-[#8B1538] hover:bg-[#6B1028]"
                onClick={saveWifi}
                disabled={status === "saving" || !ssid.trim()}
              >
                {status === "saving" ? "Saving..." : "Save Wi-Fi & Restart"}
              </Button>

              {status !== "idle" && (
                <div
                  className={`text-sm p-2 rounded ${
                    status === "ok"
                      ? "bg-green-50 text-green-700"
                      : status === "fail"
                      ? "bg-red-50 text-red-700"
                      : "bg-gray-50 text-gray-700"
                  }`}
                >
                  {msg}
                </div>
              )}

              <p className="text-xs text-gray-500 pt-1">
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

  // ✅ Track offline notifications to avoid spamming the database
  const hasNotifiedOfflineRef = useRef<boolean>(false);

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
      const data = snapshot.val();
      const lastSeen = data?.lastSeen as number | undefined;
      const computedStatus = getDeviceStatusFromLastSeen(lastSeen);
      const lastUpdate = formatLastSeen(lastSeen);
      
      // Check and trigger notification on status change
      checkAndNotifyOfflineStatus(computedStatus);

      setDevices((prev) =>
        prev.map((device) =>
          device.controlKey === "sugarMonitor"
            ? {
                ...device,
                lastSeen,
                status: computedStatus,
                lastUpdate,
              }
            : device
        )
      );
    });

    const unsubCurrent = onValue(currentRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      setDevices((prev) =>
        prev.map((device) => {
          if (device.name === "Temperature Sensor") {
            return {
              ...device,
              value:
                typeof data.temperature === "number"
                  ? `${data.temperature.toFixed(1)}°C`
                  : device.value,
            };
          }

          if (device.name === "Acidity Sensor") {
            return {
              ...device,
              value:
                typeof data.ph === "number"
                  ? `${data.ph.toFixed(2)} pH`
                  : device.value,
            };
          }

          if (device.name === "Camera Module") {
            return {
              ...device,
              value: "Monitoring",
            };
          }

          return device;
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
      setDevices((prev) =>
        prev.map((device) => {
          if (device.controlKey === "sugarMonitor") {
            const computedStatus = getDeviceStatusFromLastSeen(device.lastSeen);
            // Also check periodically in case the database value hasn't changed but the local time has passed the timeout
            checkAndNotifyOfflineStatus(computedStatus);
            return {
                ...device,
                status: computedStatus,
                lastUpdate: formatLastSeen(device.lastSeen),
              }
          }
          return device;
        })
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

      alert("Failed to update device state in Firebase.");
    } finally {
      setLoadingId(null);
    }
  };

  const refreshAllDevices = async () => {
    setDevices((prev) =>
      prev.map((device) =>
        device.controlKey === "sugarMonitor"
          ? {
              ...device,
              status: getDeviceStatusFromLastSeen(device.lastSeen),
              lastUpdate: formatLastSeen(device.lastSeen),
            }
          : device
      )
    );
  };

  const onlineDevices = devices.filter((d) => d.status === "online").length;
  const totalDevices = devices.length;
  const systemActive = devices.some(
    (d) => d.controlKey === "sugarMonitor" && d.status === "online" && d.enabled
  );

  return (
    <div className="p-4 space-y-4">
      <WifiSetupModal
        open={wifiModalOpen}
        onClose={() => setWifiModalOpen(false)}
        deviceName="Sensor Module"
      />

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-gray-900">Device Control</h1>
          <p className="text-sm text-gray-500">Manage your IoT devices</p>
        </div>
        <SettingsIcon className="w-6 h-6 text-[#8B1538]" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-gradient-to-br from-[#2D5016] to-[#1D3010] text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white">
                  {onlineDevices}/{totalDevices}
                </p>
                <p className="text-xs opacity-90 mt-1">Devices Online</p>
              </div>
              <WifiIcon className="w-8 h-8 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-[#8B1538] to-[#6B1028] text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white">{systemActive ? "Active" : "Inactive"}</p>
                <p className="text-xs opacity-90 mt-1">System Status</p>
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

      <Button variant="outline" className="w-full" onClick={refreshAllDevices}>
        <RefreshCwIcon className="w-4 h-4 mr-2" />
        Refresh All Devices
      </Button>

      <div>
        <h2 className="text-gray-900 mb-3">Connected Devices</h2>
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
                            ? "bg-green-100"
                            : device.status === "manual"
                            ? "bg-purple-100"
                            : "bg-gray-100"
                        }`}
                      >
                        <Icon
                          className={`w-6 h-6 ${
                            device.status === "online"
                              ? "text-green-600"
                              : device.status === "manual"
                              ? "text-[#6B2C5D]"
                              : "text-gray-400"
                          }`}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-gray-900">{device.name}</p>
                          {device.status === "online" && (
                            <Badge
                              variant="outline"
                              className="border-green-500 text-green-600 text-xs"
                            >
                              <WifiIcon className="w-3 h-3 mr-1" />
                              Online
                            </Badge>
                          )}
                          {device.status === "offline" && (
                            <Badge
                              variant="outline"
                              className="border-gray-400 text-gray-500 text-xs"
                            >
                              <WifiOffIcon className="w-3 h-3 mr-1" />
                              Offline
                            </Badge>
                          )}
                          {device.status === "manual" && (
                            <Badge
                              variant="outline"
                              className="border-purple-400 text-[#6B2C5D] text-xs"
                            >
                              Manual Entry
                            </Badge>
                          )}

                          {device.status !== "manual" && (device.enabled ? (
                            <Badge variant="outline" className="text-xs">
                              Enabled
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-amber-500 text-amber-600 text-xs"
                            >
                              Disabled
                            </Badge>
                          ))}
                        </div>

                        <p className="text-sm text-gray-500 mt-1">
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
                          className="data-[state=checked]:bg-[#8B1538]"
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
                        <p className="text-xs text-gray-500 mt-2">
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
            <span className="text-gray-600">Network Latency</span>
            <span className="text-green-600">
              {systemActive ? "Connected" : "Unavailable"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Data Accuracy</span>
            <span className="text-green-600">
              {systemActive ? "98.5%" : "Unavailable"}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Last Calibration</span>
            <span className="text-gray-900">Oct 15, 2025</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Next Maintenance</span>
            <span className="text-amber-600">In 12 days</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}