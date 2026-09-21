import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";

import LoginPage from "./components/LoginPage";
import Dashboard from "./components/Dashboard";
import FruitSorting from "./components/FruitSorting";
import FermentationTracker from "./components/FermentationTracker";
import NotificationCenter from "./components/NotificationCenter";
import ReportsAnalytics from "./components/ReportsAnalytics";
import PredictiveInsights from "./components/PredictiveInsights";
import DeviceControl from "./components/DeviceControl";
import Navigation from "./components/Navigation";
// ADDED: Import the new Bottle Filling Page
import BottleFillingPage from "./components/BottleFillingPage"; 

import { auth } from "./lib/firebase";
import { initializePushNotifications } from "./lib/pushNotifications";

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;

  return children;
}

function MainLayout() {
  const [currentScreen, setCurrentScreen] = useState("dashboard");

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

  return (
    <div className="min-h-screen bg-white">
      <div className="w-full bg-white min-h-screen pb-20">
        {/* Conditional Rendering based on currentScreen state */}
        {currentScreen === "dashboard" && (
          <Dashboard userRole={auth.currentUser?.email ?? "User"} />
        )}
        {currentScreen === "sorting" && <FruitSorting />}
        {currentScreen === "fermentation" && <FermentationTracker />}
        {/* ADDED: The new Bottle Filling render condition */}
        {currentScreen === "filling" && <BottleFillingPage />} 
        {currentScreen === "notifications" && <NotificationCenter />}
        {currentScreen === "reports" && <ReportsAnalytics />}
        {currentScreen === "insights" && <PredictiveInsights />}
        {currentScreen === "devices" && <DeviceControl />}

        <Navigation
          currentScreen={currentScreen}
          setCurrentScreen={setCurrentScreen}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* LOGIN */}
        <Route
          path="/"
          element={
            <LoginPage
              onLogin={() => {
                window.location.replace("/dashboard");
              }}
            />
          }
        />

        {/* DASHBOARD + APP */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
