import { Component, type ReactNode } from "react";

// ---- Error boundary so a missing/failed GLB degrades to a placeholder ----
// TRANSIENT failures retry (feel-audit-1 P1-12): dev-server hiccups and
// aborted in-flight fetches (net::ERR_ABORTED on double-mount churn) used to
// latch `failed` for the whole session, leaving imported-only rigs invisible
// — markers and exchanges attached to empty air, a QA fail state under the
// imported-visible-world law. Each retry evicts the rejected loader cache
// entry (onBeforeRetry) and re-suspends with exponential backoff.
export class GlbBoundary extends Component<
  {
    fallback: ReactNode;
    children: ReactNode;
    onBeforeRetry?: () => void;
    maxRetries?: number;
  },
  { failed: boolean; attempts: number }
> {
  state = { failed: false, attempts: 0 };
  private retryTimer = 0;
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    const max = this.props.maxRetries ?? 3;
    if (this.state.attempts >= max) {
      console.error("GLB load failed permanently after retries", error);
      return;
    }
    const delay = 600 * 2 ** this.state.attempts;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => {
      this.props.onBeforeRetry?.();
      this.setState((state) => ({ failed: false, attempts: state.attempts + 1 }));
    }, delay);
  }
  componentWillUnmount() {
    window.clearTimeout(this.retryTimer);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
