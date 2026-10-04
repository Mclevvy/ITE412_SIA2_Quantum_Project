import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-pulse text-gray-500">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;

  return <>{children}</>;
}
