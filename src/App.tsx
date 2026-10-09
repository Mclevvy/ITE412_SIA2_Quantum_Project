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
import { signOut } from "firebase/auth";
import { auth } from "./lib/firebase";
import {
  hasPinFor,
  wasPinSkippedFor,
  getTrustedSince,
  setTrustedSince,
  clearPin,
  clearTrust,
  MAX_SESSION_MS,
} from "./lib/pinLock";
import { clearDeviceTokens, initializePushNotifications } from "./lib/pushNotifications";
import { useSugarAutoLog } from "./hooks/useSugarAutoLog";

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
 * Trusted-device gate around the authenticated app.
 *
 *   FIRST LOGIN (email+password) → PIN setup offered once per account
 *     → trusted device created (trust timestamp stored, 60-day max)
 *   EVERY LAUNCH within the window → PIN unlocks the live session
 *   LOGOUT or 60-DAY EXPIRY → trust destroyed → email+password again
 *
 * The PIN never carries its own lifetime: it only unlocks a trusted
 * session while device trust is valid. Unlock state lives in memory, so it
 * resets on sign-out or restart. PIN changes from the More sheet notify via
 * the "bunius:pin-changed" window event.
 */
function AuthedGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const [unlocked, setUnlocked] = useState(false);
  const [pinKnown, setPinKnown] = useState(() => hasPinFor(uid));
  const [trust, setTrust] = useState<"checking" | "ok" | "expired">("checking");
  // Bump after setup/skip so the gate re-reads storage even when pinKnown
  // itself didn't change value (React bails out on identical state, which
  // previously left the setup screen stuck after Skip).
  const [, setGateTick] = useState(0);
  const refreshGate = () => {
    setPinKnown(hasPinFor(uid));
    setGateTick((t) => t + 1);
  };

  useEffect(() => {
    window.addEventListener("bunius:pin-changed", refreshGate);
    return () => window.removeEventListener("bunius:pin-changed", refreshGate);
  }, [uid]);

  // Trust lifetime: grandfather pre-existing sessions into a fresh 60-day
  // window once; afterwards an expired trust forces password re-auth.
  useEffect(() => {
    if (!uid) return;
    let since = getTrustedSince();
    if (since === null) {
      since = Date.now();
      setTrustedSince(since);
    }
    if (Date.now() - since > MAX_SESSION_MS) {
      clearPin();
      clearTrust();
      setTrust("expired");
      // Rules require auth.uid === $uid on deviceTokens, so this must be written
      // while the session is still alive — and awaited, or the delete can lose
      // the race against the token revocation below.
      clearDeviceTokens(uid).then(() => {
        void signOut(auth).catch(() => undefined);
      });
    } else {
      setTrust("ok");
    }
  }, [uid]);

  if (trust !== "ok") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#2A0A12]">
        <div className="animate-pulse text-white/60">
          {trust === "expired" ? "Session expired — signing out…" : "Checking session…"}
        </div>
      </div>
    );
  }
  if (pinKnown && !unlocked) {
    return <PinUnlock uid={uid} onUnlock={() => setUnlocked(true)} />;
  }
  if (!pinKnown && !wasPinSkippedFor(uid)) {
    return (
      <PinSetup
        uid={uid}
        onDone={(created) => {
          refreshGate();
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

  // Soft-sensor auto-log lives here, not on the Insights screen: it must keep
  // the Dashboard's live reading fresh no matter which tab is open.
  useSugarAutoLog();

  const [pinManageOpen, setPinManageOpen] = useState(false);

  const closePinManage = () => {
    setPinManageOpen(false);
    window.dispatchEvent(new Event("bunius:pin-changed"));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="w-full bg-background min-h-screen pb-20">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-24 text-muted-foreground animate-pulse">
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
            <PinManage uid={user?.uid ?? ""} onDone={closePinManage} />
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
