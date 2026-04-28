"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AuthErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Auth error boundary:", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
          <h2 className="font-display text-xl font-bold text-red-500">
            Wallet Setup Failed
          </h2>
          <p className="font-body text-sm text-muted">
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="rounded-sm border-2 border-foreground bg-primary px-4 py-2 font-body text-sm text-background shadow-[2px_2px_0_0_hsl(var(--foreground))]"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
