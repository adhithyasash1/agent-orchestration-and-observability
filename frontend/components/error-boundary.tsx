"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ padding: "2rem", color: "var(--color-danger)" }}>
            <strong>Something went wrong.</strong>
            <pre style={{ fontSize: "12px", marginTop: "8px" }}>
              {this.state.error?.message}
            </pre>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

export function PageError() {
  return (
    <div className="rounded-2xl border border-danger/20 bg-danger/5 p-8 text-sm text-danger">
      <strong>Something went wrong.</strong>
      <p className="mt-2 text-muted-foreground">
        This page hit an unexpected error. Refreshing usually clears transient issues.
      </p>
    </div>
  );
}
