import {
  LOOK_TUNING,
  applyLookDelta,
  createLookState,
  type LookState,
} from "@pa/engine-world";

// ---------------------------------------------------------------------------
// Mouse look: the platform half.
//
// @pa/engine-world owns what a look IS and where it puts a camera. This owns the
// only part that cannot be pure — asking the browser for the pointer, and
// reading the deltas it hands back.
//
// Deltas ACCUMULATE HERE AND ARE DRAINED BY THE FRAME, rather than being applied
// to the look as they arrive. A mouse can report several moves between two
// animation frames and a high-polling-rate mouse reports many, so applying each
// one immediately would do the same arithmetic eight times to produce a value
// only the next frame will read. Draining once per frame also means the look
// the camera is placed from and the look the movement basis is built from are
// the same value within a frame, which is the property that stops the two
// disagreeing by one mouse event's worth of yaw.
//
// Two ways in, because one of them can fail. Pointer lock is the real one: the
// cursor disappears, travel is unbounded, and the player can spin past 180
// degrees without running out of desk. It needs a user gesture and it can be
// refused outright — an embedded frame, a locked-down school profile, a browser
// that has just had Escape pressed and imposes its short re-lock cooldown. So
// dragging with a held button does the same thing at the same sensitivity. That
// is a genuine fallback rather than a lesser mode: it is also how a trackpad
// user who dislikes losing their cursor can play.
// ---------------------------------------------------------------------------

export interface MissionLookState {
  /** The look itself. Read by the frame; written only by `drainLook`. */
  look: LookState;
  /** Unread mouse travel in pixels, accumulated since the last drain. */
  pendingX: number;
  pendingY: number;
  /** True while the browser has actually granted the pointer. */
  pointerLocked: boolean;
  /** True while a drag-look is in progress (the unlocked fallback). */
  dragging: boolean;
}

export function createMissionLookState(yaw: number): MissionLookState {
  return {
    look: createLookState(yaw),
    pendingX: 0,
    pendingY: 0,
    pointerLocked: false,
    dragging: false,
  };
}

/**
 * Fold the frame's accumulated mouse travel into the look and clear it.
 *
 * Called once per rendered frame, before anything reads `state.look`.
 */
export function drainLook(state: MissionLookState): LookState {
  if (state.pendingX !== 0 || state.pendingY !== 0) {
    state.look = applyLookDelta(state.look, state.pendingX, state.pendingY);
    state.pendingX = 0;
    state.pendingY = 0;
  }
  return state.look;
}

/**
 * A single mouse move can report an absurd delta when the pointer is warped —
 * a lock being granted, an OS window switch, a synthetic event. Clamping is
 * cheaper than the alternative, which is the camera snapping to a random
 * heading exactly once per session and looking like the bug this replaced.
 */
const MAX_DELTA_PX = 260;

function clampDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_DELTA_PX, Math.max(-MAX_DELTA_PX, value));
}

/**
 * Binds mouse look to a canvas and returns the unbind.
 *
 * The canvas rather than the window, for the pointer request and the drag: a
 * click on the HUD's abandon button is not a request to capture the mouse.
 * Movement is read from the document while locked, because a locked pointer
 * reports against the document rather than the element.
 */
export function attachMissionLook(
  state: MissionLookState,
  canvas: HTMLElement,
): () => void {
  const doc = canvas.ownerDocument;

  function onMouseMove(event: MouseEvent): void {
    if (!state.pointerLocked && !state.dragging) return;
    state.pendingX += clampDelta(event.movementX);
    state.pendingY += clampDelta(event.movementY);
  }

  function onPointerDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    if (state.pointerLocked) return;
    // Drag-look starts immediately and unconditionally. If the lock request
    // below succeeds it takes over on the next move; if it is refused, this is
    // already the working path and the player never sees a dead click.
    state.dragging = true;
    const request = canvas.requestPointerLock?.bind(canvas);
    if (!request) return;
    try {
      // Chrome returns a promise here and rejects it when the request is
      // refused (too soon after an Escape, most often). An unhandled rejection
      // in that case is noise in a console the owner is reading for real
      // problems, so it is swallowed deliberately — the drag fallback is
      // already carrying the interaction.
      const result = request() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === "function") {
        result.catch(() => undefined);
      }
    } catch {
      // Same reasoning; some browsers throw rather than reject.
    }
  }

  function endDrag(): void {
    state.dragging = false;
  }

  /**
   * A refused lock must NOT end the drag.
   *
   * This handler used to be `endDrag`, which tore down the fallback a few
   * hundred microseconds after `onPointerDown` set it up — in the exact case
   * the fallback exists to cover. Measured in Chrome: of a five-move drag,
   * one move landed before `pointerlockerror` arrived and the remaining four
   * were dropped, so a 150px gesture turned the camera by 30px worth and then
   * nothing. Held button, dead camera, which is "you can't move camera with
   * mouse like you need to".
   *
   * The drag ends where it should: on mouseup, or on losing the window.
   */
  function onPointerLockError(): void {
    state.pointerLocked = false;
  }

  function onPointerLockChange(): void {
    state.pointerLocked = doc.pointerLockElement === canvas;
    // A granted lock supersedes the drag, so releasing the button later does
    // not have to be the thing that ends looking.
    if (state.pointerLocked) state.dragging = false;
    // Travel captured across the transition belongs to neither mode.
    state.pendingX = 0;
    state.pendingY = 0;
  }

  canvas.addEventListener("mousedown", onPointerDown);
  doc.addEventListener("mousemove", onMouseMove);
  doc.addEventListener("mouseup", endDrag);
  doc.addEventListener("pointerlockchange", onPointerLockChange);
  doc.addEventListener("pointerlockerror", onPointerLockError);
  // Losing the window mid-drag must not leave the camera captured.
  window.addEventListener("blur", endDrag);

  return () => {
    canvas.removeEventListener("mousedown", onPointerDown);
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("mouseup", endDrag);
    doc.removeEventListener("pointerlockchange", onPointerLockChange);
    doc.removeEventListener("pointerlockerror", onPointerLockError);
    window.removeEventListener("blur", endDrag);
    if (doc.pointerLockElement === canvas) doc.exitPointerLock?.();
    state.dragging = false;
    state.pendingX = 0;
    state.pendingY = 0;
  };
}

/** Re-exported so the HUD legend and this module cannot disagree. */
export const LOOK_SENSITIVITY_RAD_PER_PX = LOOK_TUNING.radPerPixel;
