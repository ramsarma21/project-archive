import { useEffect, useState } from "react";
import { isControlTarget } from "./duelInput.js";

// The controls legend, HELD-TO-VIEW on Tab.
//
// A genuine held key rather than a toggle: the player holds Tab to read the controls
// and lets go to get back to the fight, exactly as a scoreboard works in the shooters
// this HUD is modelled on. It is workable in this input path because the duel/arena
// already owns the keyboard, so intercepting Tab is a matter of one guarded listener.
//
// TAB IS SPECIAL, so this is deliberately NOT routed through `createDuelInput` with the
// gameplay keys: Tab's browser default is focus traversal, and the ONE place it must
// keep that default is the evidence-card question overlay, where a keyboard user tabs
// between the answer box, the cards and Submit. So the rule is: while the duel has focus
// (nothing form-like is focused) Tab shows the legend and its focus-cycling is
// suppressed; the instant focus is in a control — which is exactly when the question
// overlay is open and being used — Tab is left completely alone. Screen-reader and
// keyboard-only users therefore never lose Tab where it matters, and a small persistent
// hint (rendered by the HUD) means the binding is still discoverable without holding it.
//
// The reducer below is pure so every edge case that could pin the legend on screen —
// a blur while held, the overlay opening while held, the surface being disabled — is
// asserted rather than hoped for. The hook is a thin DOM shell over it.

export const LEGEND_KEY = "Tab";

export interface LegendState {
  readonly held: boolean;
}

export type LegendEvent =
  | { readonly type: "KEYDOWN"; readonly key: string; readonly onControl: boolean }
  | { readonly type: "KEYUP"; readonly key: string }
  | { readonly type: "BLUR" }
  /** The surface stopped collecting (a question opened, the view unmounted). */
  | { readonly type: "DISABLE" };

export interface LegendResult {
  readonly state: LegendState;
  /** True when the caller must suppress the browser default (Tab focus-cycling). */
  readonly preventDefault: boolean;
}

export const LEGEND_HIDDEN: LegendState = { held: false };

/**
 * Fold one event into the legend state.
 *
 * - Tab down with the duel focused (not on a control) shows the legend AND asks the
 *   caller to suppress the focus cycle.
 * - Tab down while a control is focused (the open question overlay) is left alone: the
 *   legend does not show and the browser keeps Tab for navigation.
 * - Tab up, a blur, or a disable all hide it — the three ways it could otherwise stick.
 * - Any other key is inert.
 */
export function legendReducer(state: LegendState, event: LegendEvent): LegendResult {
  switch (event.type) {
    case "KEYDOWN":
      if (event.key !== LEGEND_KEY) return { state, preventDefault: false };
      if (event.onControl) return { state, preventDefault: false };
      return { state: { held: true }, preventDefault: true };
    case "KEYUP":
      if (event.key !== LEGEND_KEY) return { state, preventDefault: false };
      return { state: LEGEND_HIDDEN, preventDefault: false };
    case "BLUR":
    case "DISABLE":
      return { state: LEGEND_HIDDEN, preventDefault: false };
    default:
      return { state, preventDefault: false };
  }
}

/**
 * Hold-to-view controls legend, bound to the window.
 *
 * `enabled` is false while a question is open or the surface is torn down; disabling
 * hides the legend and stops it intercepting Tab, so the question overlay keeps Tab for
 * its own focus traversal.
 */
export function useControlsLegend(enabled: boolean): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHeld(false);
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== LEGEND_KEY) return;
      const onControl = isControlTarget(event.target);
      const result = legendReducer({ held }, { type: "KEYDOWN", key: event.key, onControl });
      if (result.preventDefault) event.preventDefault();
      setHeld(result.state.held);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== LEGEND_KEY) return;
      setHeld(false);
    };
    const onBlur = (): void => setHeld(false);
    const onVisibility = (): void => {
      if (document.hidden) setHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `held` is intentionally out of deps: the listeners read it via closure only for
    // the reducer's no-op branches, and re-binding on every keypress is wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return enabled && held;
}
