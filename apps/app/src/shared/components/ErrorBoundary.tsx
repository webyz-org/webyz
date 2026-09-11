import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches render errors so a bug in one card is a message with a reload
 * button, not a blank white page. Mounted once around the whole app and once
 * around the routed page inside the shell, so the header survives a page
 * crash and the user can still navigate away.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; title?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[webyz] render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-text-primary">{this.props.title ?? "Something went wrong"}</h1>
        <p className="mt-2 text-sm text-text-muted">
          This part of the page hit an error. Reloading usually fixes it; if it keeps happening, tell us what you were
          doing.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-black/[0.04] p-3 text-left text-xs text-text-secondary dark:bg-white/[0.06]">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Reload
        </button>
      </div>
    );
  }
}
