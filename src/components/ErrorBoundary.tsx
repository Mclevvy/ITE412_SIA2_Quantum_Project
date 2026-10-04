import { Component } from "react";
import type { ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  screenName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time crashes (bad data shapes, failed lazy-chunk loads
 * after a redeploy, chart library edge cases) inside one screen so a single
 * failure can never blank the entire app again. Remount via `key` per
 * screen so navigating away and back retries cleanly.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[ErrorBoundary:${this.props.screenName ?? "screen"}]`, error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
          <p className="font-bold text-gray-900">Something went wrong here</p>
          <p className="text-sm text-gray-500 mt-1">
            The {this.props.screenName ?? "screen"} failed to load. Your data is safe —
            try reloading, and if it persists, check the latest entries for bad data.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 px-5 py-2.5 rounded-full bg-[#8B1538] hover:bg-[#6B1028] text-white text-sm font-medium transition-colors"
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
