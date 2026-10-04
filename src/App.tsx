import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";
import type { ReactNode } from "react";

import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";
import Navigation from "./components/Navigation";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PinSetup, PinUnlock, PinManage } from "./components/PinLock";

import { AuthProvider, useAuth } from "./lib/auth";
import ProtectedRoute from "./ProtectedRoute";
import { hasPin, wasPinSkipped } from "./lib/pinLock";
import { initializePushNotifications } from "./lib/pushNotifications";

const FruitSorting = lazy(() => import("./components/FruitSorting"));
const FermentationTracker = lazy(() => import("./components/FermentationTracker"));
const BottleFillingPage = lazy(() => import("./components/BottleFillingPage"));
const NotificationCenter = lazy(() => import("./components/NotificationCenter"));
const ReportsAnalytics = lazy(() => import("./components/ReportsAnalytics"));
const PredictiveInsights = lazy(() => import("./components/PredictiveInsights"));
const DeviceControl = lazy(() => import("./components/DeviceControl"));

export const VALID_SCREENS = [
  "dashboard",
  "sorting",
  "fermentation",
  "filling",
  "notifications",
  "reports",
  "insights",
  "devices",
] as const;

export type ScreenId = (typeof VALID_SCREENS)[number];

function isScreenId(value: string | undefined): value is ScreenId {
  return (VALID_SCREENS as readonly string[]).includes(value ?? "");
}

/**
 * Device-PIN gate around the authenticated app. First launch after sign-in
 * offers PIN setup (once); every later launch with a live Firebase session
 * asks for the PIN instead of the password. The unlock lives only in memory,
 * so it naturally resets on sign-out or full restart. PIN changes made from
 * the More sheet notify via the "bunius:pin-changed" window event.
 */
function AuthedGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pinKnown, setPinKnown] = useState(() => hasPin());

  useEffect(() => {
    const refresh = () => setPinKnown(hasPin());
    window.addEventListener("bunius:pin-changed", refresh);
    return () => window.removeEventListener("bunius:pin-changed", refresh);
  }, []);

  if (pinKnown && !unlocked) {
    return <PinUnlock onUnlock={() => setUnlocked(true)} />;
  }
  if (!pinKnown && !wasPinSkipped()) {
    return (
      <PinSetup
        onDone={(created) => {
          setPinKnown(hasPin());
          if (created) setUnlocked(true);
        }}
      />
    );
  }
  return <>{children}</>;
}

function MainLayout() {
  const { screen } = useParams<{ screen?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const currentScreen: ScreenId = isScreenId(screen) ? screen : "dashboard";

  useEffect(() => {
    if (screen !== undefined && !isScreenId(screen)) {
      navigate("/app/dashboard", { replace: true });
    }
  }, [screen, navigate]);

  useEffect(() => {
    let cleanup: (() => Promise<void>) | undefined;
    let cancelled = false;

    initializePushNotifications()
      .then((removeListeners) => {
        if (cancelled) {
          void removeListeners();
          return;
        }
        cleanup = removeListeners;
      })
      .catch((error) => {
        // Push permissions are optional; the dashboard remains usable if a
        // device or an emulator does not support native push registration.
        console.warn("[push] initialization skipped", error);
      });

    return () => {
      cancelled = true;
      void cleanup?.();
    };
  }, []);

  const goToScreen = (next: string) => {
    if (next !== currentScreen) navigate(`/app/${next}`);
  };

  const [pinManageOpen, setPinManageOpen] = useState(false);

  const closePinManage = () => {
    setPinManageOpen(false);
    window.dispatchEvent(new Event("bunius:pin-changed"));
  };

  return (
    <div className="min-h-screen bg-[#FAF6F1]">
      <div className="w-full bg-[#FAF6F1] min-h-screen pb-20">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-24 text-gray-500 animate-pulse">
              Loading…
            </div>
          }
        >
          {/* Per-screen boundary (keyed): a crash or failed chunk load in one
              tab shows a recoverable message instead of blanking the app. */}
          <ErrorBoundary key={currentScreen} screenName={currentScreen}>
            {currentScreen === "dashboard" && <Dashboard userRole={user?.email ?? "User"} />}
            {currentScreen === "sorting" && <FruitSorting />}
            {currentScreen === "fermentation" && <FermentationTracker />}
            {currentScreen === "filling" && <BottleFillingPage />}
            {currentScreen === "notifications" && <NotificationCenter />}
            {currentScreen === "reports" && <ReportsAnalytics />}
            {currentScreen === "insights" && <PredictiveInsights />}
            {currentScreen === "devices" && <DeviceControl />}
          </ErrorBoundary>
        </Suspense>

        <Navigation currentScreen={currentScreen} onNavigate={goToScreen} onManagePin={() => setPinManageOpen(true)} />

        {pinManageOpen && (
          <div className="fixed inset-0 z-[60] overflow-y-auto">
            <PinManage onDone={closePinManage} />
          </div>
        )}
      </div>
    </div>
  );
}

function LoginRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (!loading && user) return <Navigate to="/app/dashboard" replace />;
  return <LoginPage onLogin={() => navigate("/app/dashboard", { replace: true })} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LoginRoute />} />
          {/* Backwards compatibility with the old single dashboard path. */}
          <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
          <Route
            path="/app/:screen?"
            element={
              <ProtectedRoute>
                <AuthedGate>
                  <MainLayout />
                </AuthedGate>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
