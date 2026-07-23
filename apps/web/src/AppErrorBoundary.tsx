import { Component, type ErrorInfo, type ReactNode } from "react";

// Render-tree error boundary around the game (feel-audit-1 P0-3): an uncaught
// exception inside Play used to unmount the whole React tree with nothing
// actionable on screen — the audited "silent crash to the home screen".
// Instead, surface the diagnostics and keep an explicit exit path. The save
// is event-sourced and persisted per committed event, so nothing is lost.
interface BoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export class AppErrorBoundary extends Component<
  { onReset: () => void; children: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Game render error", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center">
        <div className="card game-error-card">
          <div className="archive-kicker">ARCHIVE // FIELD LINK INTERRUPTED</div>
          <h1>The game hit an unexpected error</h1>
          <p className="sub">
            Your progress is saved after every committed action, so resuming is
            safe. The details below help the team find the cause.
          </p>
          <pre className="game-error-detail">
            {String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error)}
            {this.state.componentStack
              ? `\n--- component stack ---${this.state.componentStack}`
              : ""}
          </pre>
          <button
            className="btn-primary"
            onClick={() => {
              this.setState({ error: null, componentStack: null });
              this.props.onReset();
            }}
          >
            Back to profiles
          </button>
        </div>
      </div>
    );
  }
}
