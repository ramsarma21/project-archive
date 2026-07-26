import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";

// Loading gate for imported assets in the duel.
//
// The project's imported-visible-world rule is explicit that a missing or failed
// physical asset renders NOTHING — never a primitive stand-in — so this boundary's
// fallback is always null and there is no debug-shell option to pass. It exists so
// that one unavailable prop takes itself off screen instead of taking the whole
// duel down through the app error boundary.
//
// `@pa/engine-world` has an equivalent (`GlbBoundary`) but does not export it from
// its package root, and the app is only allowed to import that package through its
// public surface.

interface Props {
  readonly children: ReactNode;
  readonly label: string;
  readonly onRetry?: () => void;
}

interface State {
  readonly failed: boolean;
}

export class GlbGate extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[duel] ${this.props.label} failed to load`, error, info.componentStack);
    this.props.onRetry?.();
  }

  render(): ReactNode {
    if (this.state.failed) return null;
    return <Suspense fallback={null}>{this.props.children}</Suspense>;
  }
}
