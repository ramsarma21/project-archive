import { useEffect, useRef } from "react";

// Window-level key binding for mechanic actions. Mechanic panels advertise
// SPACE, but a button-focused onKeyDown only works while the button owns
// focus — dead for anyone who last clicked the world or plays keyboard-only
// (feel-audit-1 P1-2). This listens at the window, skipping text inputs.
// preventDefault on the keydown also suppresses the browser's synthetic
// button activation, so a focused button never double-fires.
export function useMechanicActionKey(handlers: {
  enabled: boolean;
  onDown: () => void;
  onUp?: () => void;
  codes?: readonly string[];
}) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const matches = (event: KeyboardEvent) =>
      (ref.current.codes ?? ["Space", "Enter"]).includes(event.code);
    const editable = (event: KeyboardEvent) => {
      const target = event.target;
      // Range sliders are NOT text entry: after adjusting an alignment
      // slider (mouse drag or arrow keys) it keeps focus, and Space must
      // still commit the stage for keyboard players.
      if (target instanceof HTMLInputElement) return target.type !== "range";
      return (
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      );
    };
    const down = (event: KeyboardEvent) => {
      if (!ref.current.enabled || event.repeat || !matches(event) || editable(event)) return;
      event.preventDefault();
      ref.current.onDown();
    };
    const up = (event: KeyboardEvent) => {
      if (!ref.current.enabled || !matches(event) || editable(event)) return;
      ref.current.onUp?.();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}
