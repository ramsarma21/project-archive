import { useCallback, useMemo, useRef } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";

// ---------------------------------------------------------------------------
// Turntable spin controller.
//
// Input never touches React state. A pointer move only accumulates a *target*
// angle in a ref; the r3f frame loop owns the rendered angle and eases it toward
// that target every frame. That separation is what makes the spin smooth —
// pointer events arrive at the device's own irregular rate, so writing their
// deltas straight onto the model lands uneven steps on frame boundaries no
// matter how cheap the render is.
//
// Momentum works the same way: velocity advances the target, and the rendered
// angle keeps chasing it, so a flick, its decay and the ambient idle spin are
// all the same single easing with no seams between them.
//
// Every rate is per second and applied as an exponential approach
// (`1 - e^(-rate * dt)`), so the feel is identical at 30fps and 120fps.
// ---------------------------------------------------------------------------

/** Radians of yaw per pixel dragged. A full turn is roughly a 560px sweep. */
const DRAG_SENSITIVITY = 0.0112;
/** How fast the rendered angle closes on the target. Higher = tighter, rougher. */
const FOLLOW_RATE = 24;
/** Post-release decay: velocity e-folds this many times per second. */
const FRICTION_RATE = 1.15;
/** Ambient auto-spin, rad/s. Slow enough to read as display, not animation. */
const IDLE_SPIN_RATE = 0.22;
/** Quiet time before the turntable takes itself back over, seconds. */
const IDLE_RESUME_DELAY = 1.1;
/** How fast a coasting flick settles into the idle rate. */
const IDLE_BLEND_RATE = 1.2;
/** Smoothing on the measured drag rate, so a release is not handed a spike. */
const VELOCITY_SMOOTHING_RATE = 16;
/** Ceiling on a flick, rad/s, so a fast sweep stays readable. */
const MAX_VELOCITY = 12;
/**
 * Opening pose: square to the camera. The intro cuts to the player face-on and
 * crossfades into the hub, so any yaw here shows up as the figure turning
 * across the dissolve. Note this is the pose at mount only — the turntable
 * resumes its ambient spin IDLE_RESUME_DELAY later, so "face-on at rest" is a
 * property of the first beat, not a resting state.
 */
export const HOME_ANGLE = 0;
/** Pixels of travel that count as "the player has found the drag". */
const DRAG_INTENT_PX = 20;

export interface TurntableSpin {
  /** Rendered yaw. Written only by the frame loop. */
  angle: number;
  /** Where input says the yaw should be. Written only by the handlers. */
  target: number;
  /** rad/s, measured from what was actually drawn. */
  velocity: number;
  dragging: boolean;
  /** performance.now() of the last human input, ms. */
  lastInputAt: number;
}

export interface TurntableControl {
  spin: MutableRefObject<TurntableSpin>;
  /** Spread onto the drag surface behind the panels. */
  surfaceHandlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

export function useTurntable(options: { onFirstDrag?: () => void } = {}): TurntableControl {
  const spin = useRef<TurntableSpin>({
    angle: HOME_ANGLE,
    target: HOME_ANGLE,
    velocity: 0,
    dragging: false,
    lastInputAt: 0,
  });
  const lastX = useRef(0);
  const travelled = useRef(0);
  // Held in a ref so a new callback identity never rebuilds the handlers, which
  // would detach them mid-drag.
  const onFirstDrag = useRef(options.onFirstDrag);
  onFirstDrag.current = options.onFirstDrag;
  const announcedDrag = useRef(false);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Capture on the surface so the drag survives the pointer crossing a panel
    // or leaving the window entirely. It throws if the pointer is already gone,
    // which must not take the drag down with it.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* capture is an optimisation; the drag still tracks without it */
    }
    spin.current.dragging = true;
    spin.current.velocity = 0;
    // Drop the frame loop's easing lag so the grab starts from the drawn pose.
    spin.current.target = spin.current.angle;
    spin.current.lastInputAt = performance.now();
    lastX.current = event.clientX;
    travelled.current = 0;
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!spin.current.dragging) return;
    const deltaX = event.clientX - lastX.current;
    lastX.current = event.clientX;
    // Accumulate only. Velocity is measured in the frame loop from the angle it
    // actually drew, which is both smoother and free of event-rate bias.
    spin.current.target += deltaX * DRAG_SENSITIVITY;
    spin.current.lastInputAt = performance.now();

    travelled.current += Math.abs(deltaX);
    if (!announcedDrag.current && travelled.current >= DRAG_INTENT_PX) {
      announcedDrag.current = true;
      onFirstDrag.current?.();
    }
  }, []);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!spin.current.dragging) return;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released by the browser */
    }
    spin.current.dragging = false;
    spin.current.lastInputAt = performance.now();
  }, []);

  return useMemo(
    () => ({
      spin,
      surfaceHandlers: {
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        // A capture lost to a browser gesture must not leave the model stuck.
        onLostPointerCapture: endDrag,
      },
    }),
    [onPointerDown, onPointerMove, endDrag],
  );
}

/**
 * Advance the turntable one frame. Returns the yaw to apply.
 *
 * Reduced motion keeps the drag — that is direct manipulation, not decoration —
 * but drops the easing, the coasting momentum and the ambient auto-spin, so the
 * model moves only while it is being moved and then holds.
 */
export function stepTurntable(
  spin: TurntableSpin,
  deltaSeconds: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) {
    spin.velocity = 0;
    spin.angle = spin.target;
    return spin.angle;
  }

  // Floor guards a zero-delta frame; ceiling stops a backgrounded tab from
  // teleporting the model on its first frame back.
  const dt = Math.min(Math.max(deltaSeconds, 1 / 480), 1 / 20);
  const follow = 1 - Math.exp(-FOLLOW_RATE * dt);

  if (spin.dragging) {
    const next = spin.angle + (spin.target - spin.angle) * follow;
    // Measure from what was drawn, so releasing hands the flick exactly the
    // rate the eye was already tracking — no jump at the handover.
    const measured = (next - spin.angle) / dt;
    spin.velocity += (measured - spin.velocity) * (1 - Math.exp(-VELOCITY_SMOOTHING_RATE * dt));
    spin.velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, spin.velocity));
    spin.angle = next;
    return spin.angle;
  }

  // One damped approach with a moving rest point: zero while the flick is still
  // dying, then the turntable's own slow spin once the player has let go long
  // enough. The two rates are close, so crossing over is not perceptible.
  const idleFor = (performance.now() - spin.lastInputAt) / 1000;
  const resuming = idleFor > IDLE_RESUME_DELAY;
  spin.velocity +=
    ((resuming ? IDLE_SPIN_RATE : 0) - spin.velocity) *
    (1 - Math.exp(-(resuming ? IDLE_BLEND_RATE : FRICTION_RATE) * dt));

  spin.target += spin.velocity * dt;
  spin.angle += (spin.target - spin.angle) * follow;
  return spin.angle;
}
