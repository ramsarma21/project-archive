import {
  LOOK_TUNING,
  applyLookDelta,
  chaseCameraPosition,
  createLookState,
  lookForward,
  segmentClear,
  type CollisionWorld,
  type LookState,
  type Vec3,
} from "@pa/engine-world";

// ---------------------------------------------------------------------------
// PvP mouse look: the player owns where they are looking, and EVERYTHING reads it.
//
// This is the fix for the precession bug Sol measured — >1000 degrees of unasked
// strafe rotation in six seconds. The cause was a loop with gain: the camera
// followed the body's `motion.yaw`, the movement basis was derived from where the
// camera ended up, and `motion.yaw` chases the direction of travel, so one held
// strafe key fed its own output back into its own input. The cure is not a damping
// constant, it is a direction of flow — look yaw is an INPUT, owned here by the
// mouse, and the camera, the movement basis and the aim all read it. Nothing
// downstream of it (the body's facing, its velocity, the verb it is running) is
// ever allowed to write back into it. A loop that does not exist cannot precess.
//
// @pa/engine-world's `playerLook` owns what a look IS (travel turns it by
// displacement, never dt; pitch clamps; yaw wraps so ±pi never becomes a long
// turn) and where it puts a camera. This owns only the part that cannot be pure:
// asking the browser for the pointer and reading the deltas it hands back.
//
// It is deliberately the same shape as `apps/web/src/mission/missionLook.ts`, which
// is imported nowhere and edited nowhere here — the two are siblings so the two
// modes look the same way, not one depending on the other.
// ---------------------------------------------------------------------------

export interface PvpLookState {
  /** The look itself. Read by the frame; written only by `drainLook`. */
  look: LookState;
  /** Unread mouse travel in pixels, accumulated since the last drain. */
  pendingX: number;
  pendingY: number;
  /** True while the browser has actually granted the pointer. */
  pointerLocked: boolean;
  /** True while a drag-look is in progress (the unlocked fallback). */
  dragging: boolean;
  /** True once an authoritative aim has seeded the look, so it is not re-seeded. */
  seeded: boolean;
  /**
   * Whether the look is COLLECTING input. False while a question is open, the tab is
   * hidden, the window is blurred, or the view is torn down. A disabled look ignores
   * every mouse event and holds its yaw, so play resumes without a jump and without
   * replaying travel that arrived while nobody was steering.
   */
  enabled: boolean;
}

export function createPvpLookState(yaw = 0): PvpLookState {
  return {
    look: createLookState(yaw),
    pendingX: 0,
    pendingY: 0,
    pointerLocked: false,
    dragging: false,
    seeded: false,
    enabled: true,
  };
}

/**
 * Seed the look from an AUTHORITATIVE aim direction, once.
 *
 * The look must start pointing where the server already has the fighter aiming, or
 * the first frame would swing the camera to yaw 0. Applied once — after that the
 * mouse owns it and the server's aim is a lagged echo of this input, never a source
 * to snap back to.
 */
export function seedLookFromAim(
  state: PvpLookState,
  aimX: number,
  aimZ: number,
): void {
  if (state.seeded) return;
  if (!Number.isFinite(aimX) || !Number.isFinite(aimZ)) return;
  if (Math.hypot(aimX, aimZ) < 1e-6) return;
  state.look = { ...state.look, yaw: Math.atan2(aimX, aimZ) };
  state.seeded = true;
}

/**
 * Fold the frame's accumulated mouse travel into the look and clear it.
 *
 * Called once per rendered frame, before anything reads `state.look`. Draining once
 * a frame — rather than applying each mouse event as it lands — is what makes the
 * look the camera is placed from and the look the movement basis is built from the
 * same value within a frame, so the two cannot disagree by one event's worth of yaw.
 * And it is NOT dt-scaled: a mouse reports displacement, so the same gesture turns
 * the player the same amount at 30, 60 or 120 fps.
 */
export function drainLook(state: PvpLookState): LookState {
  if (state.pendingX !== 0 || state.pendingY !== 0) {
    state.look = applyLookDelta(state.look, state.pendingX, state.pendingY);
    state.pendingX = 0;
    state.pendingY = 0;
  }
  return state.look;
}

/** The ground-plane aim direction the player is looking in. Shared by move and fire. */
export function lookAim(state: PvpLookState): { x: number; z: number } {
  return lookForward(state.look.yaw);
}

/**
 * Neutralize held and pending look input on a lifecycle or phase loss.
 *
 * When a question opens or the view unmounts, a held drag or a queue of pending
 * travel must not keep turning the camera into a phase the player is reading. This
 * drops the drag and discards accumulated travel; the look yaw itself is kept, so
 * the camera does not jump when play resumes.
 */
export function neutralizeLook(state: PvpLookState): void {
  state.dragging = false;
  state.pendingX = 0;
  state.pendingY = 0;
}

/**
 * A single mouse move can report an absurd delta when the pointer is warped — a lock
 * being granted, an OS window switch, a synthetic event. Clamping is cheaper than a
 * camera that snaps to a random heading once per session.
 */
const MAX_DELTA_PX = 260;

function clampDelta(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_DELTA_PX, Math.max(-MAX_DELTA_PX, value));
}

/**
 * Elements a look-capture click must not start on. A click on the HUD, a button or a
 * form control is not a request to capture the mouse. The canvas scoping already
 * keeps most of these out (the listener is on the canvas), and this is defence in
 * depth for a control drawn ON the canvas.
 */
function isCaptureTarget(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null;
  if (!el || typeof el.tagName !== "string") return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return false;
  }
  if (el.isContentEditable) return false;
  if (typeof el.closest === "function" && el.closest("button, input, textarea, select, [contenteditable=\"true\"]")) {
    return false;
  }
  return true;
}

/** Imperative handle over an attached look — detach, and enable/disable collection. */
export interface PvpLookController {
  detach(): void;
  /**
   * Turn input collection on or off. Disabling neutralizes held/pending input and
   * drops an owned pointer lock; enabling resumes WITHOUT replaying any travel that
   * arrived while disabled.
   */
  setEnabled(enabled: boolean): void;
}

/**
 * Bind PvP mouse look to a canvas and return an imperative controller.
 *
 * The canvas rather than the window for the pointer request and the drag: a click on
 * the HUD's forfeit button is not a request to capture the mouse. Movement is read
 * from the document while locked, because a locked pointer reports against the
 * document rather than the element. Two ways in: pointer lock (the real one, so a
 * player can spin past 180 degrees without running out of desk) and a held-button
 * drag fallback for when lock is refused — an embedded frame, a locked-down school
 * profile, or a trackpad user who dislikes losing their cursor.
 *
 * The LOOK LIFECYCLE is owned here: a question, a blur, a hidden tab, a pagehide or a
 * detach all disable collection, clear pending travel and the drag, and exit the
 * pointer lock — but only if THIS canvas owns it, never someone else's.
 */
export function attachPvpLook(state: PvpLookState, canvas: HTMLElement): PvpLookController {
  const doc = canvas.ownerDocument;

  function exitLockIfOwned(): void {
    if (doc.pointerLockElement === canvas) doc.exitPointerLock?.();
  }

  // Drop everything transient: drag, pending travel and an owned lock. Leaves the
  // yaw and the `enabled` flag alone, so the caller decides re-enablement and play
  // resumes from the same heading.
  function clearAndRelease(): void {
    neutralizeLook(state);
    exitLockIfOwned();
  }

  function onMouseMove(event: MouseEvent): void {
    if (!state.enabled) return;
    if (!state.pointerLocked && !state.dragging) return;
    state.pendingX += clampDelta(event.movementX);
    state.pendingY += clampDelta(event.movementY);
  }

  function onPointerDown(event: MouseEvent): void {
    if (!state.enabled) return;
    if (event.button !== 0) return;
    if (!isCaptureTarget(event.target)) return;
    if (state.pointerLocked) return;
    // Drag-look starts immediately and unconditionally. If the lock request below
    // succeeds it takes over on the next move; if it is refused, this is already the
    // working path and the player never sees a dead click.
    state.dragging = true;
    const request = canvas.requestPointerLock?.bind(canvas);
    if (!request) return;
    try {
      const result = request() as unknown as Promise<void> | undefined;
      if (result && typeof result.catch === "function") result.catch(() => undefined);
    } catch {
      // Some browsers throw rather than reject; the drag is already carrying it.
    }
  }

  function endDrag(): void {
    state.dragging = false;
  }

  // A refused lock must NOT end the drag — the drag is the fallback for exactly that
  // case. See missionLook.ts for the measured regression this guards.
  function onPointerLockError(): void {
    state.pointerLocked = false;
  }

  function onPointerLockChange(): void {
    state.pointerLocked = doc.pointerLockElement === canvas;
    if (state.pointerLocked) state.dragging = false;
    state.pendingX = 0;
    state.pendingY = 0;
  }

  function onVisibility(): void {
    if (doc.hidden) clearAndRelease();
  }
  function onLifecycleLoss(): void {
    clearAndRelease();
  }

  canvas.addEventListener("mousedown", onPointerDown as EventListener);
  doc.addEventListener("mousemove", onMouseMove as EventListener);
  doc.addEventListener("mouseup", endDrag);
  doc.addEventListener("pointerlockchange", onPointerLockChange);
  doc.addEventListener("pointerlockerror", onPointerLockError);
  doc.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onLifecycleLoss);
  window.addEventListener("pagehide", onLifecycleLoss);

  return {
    detach(): void {
      canvas.removeEventListener("mousedown", onPointerDown as EventListener);
      doc.removeEventListener("mousemove", onMouseMove as EventListener);
      doc.removeEventListener("mouseup", endDrag);
      doc.removeEventListener("pointerlockchange", onPointerLockChange);
      doc.removeEventListener("pointerlockerror", onPointerLockError);
      doc.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onLifecycleLoss);
      window.removeEventListener("pagehide", onLifecycleLoss);
      clearAndRelease();
    },
    setEnabled(enabled: boolean): void {
      if (!enabled) clearAndRelease();
      state.enabled = enabled;
    },
  };
}

// ---------------------------------------------------------------------------
// Camera collision, verified — never an unchecked fallback.
// ---------------------------------------------------------------------------

/**
 * A chase distance whose camera-to-focus segment is VERIFIED clear of the world.
 *
 * engine-world's own `chaseCameraDistance` returns its 0.85m minimum as an UNCHECKED
 * fallback when even that is occluded — a camera the geometry is still inside. PvP
 * must never present that: this marches from the desired distance toward the focus
 * and returns the first distance whose segment is actually clear; if nothing external
 * clears, it returns 0 — the focus itself, which is clear by definition. So the
 * result is always a verified point, never a hopeful one.
 */
export function clearChaseDistance(
  world: CollisionWorld,
  look: LookState,
  focus: Vec3,
  desired: number = LOOK_TUNING.chaseDistanceM,
  ignore?: ReadonlySet<string>,
): number {
  const step = LOOK_TUNING.cameraSkinM;
  for (let distance = desired; distance > 0; distance -= step) {
    if (segmentClear(world, focus, chaseCameraPosition(look, focus, distance), ignore)) {
      return distance;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// The one shared ground-point convention, for the reticle and every ground mark.
// ---------------------------------------------------------------------------

/** The reticle never reaches past this, so a near-flat look does not fling it away. */
export const RETICLE_MAX_REACH_M = 7;

/**
 * The ground point an aim reaches — clamped to a reach and to the arena bounds, in
 * the ONE XZ convention the reticle and the projectile marks both use (x -> x,
 * z -> z). The aim is normalized here, so a non-unit direction cannot stretch it.
 */
export function aimGroundPoint(
  origin: { readonly x: number; readonly z: number },
  aim: { readonly x: number; readonly z: number },
  bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number },
  reach: number = RETICLE_MAX_REACH_M,
): { readonly x: number; readonly z: number } {
  const length = Math.hypot(aim.x, aim.z);
  const nx = length > 1e-6 ? aim.x / length : 0;
  const nz = length > 1e-6 ? aim.z / length : 0;
  const clamped = Math.min(reach, RETICLE_MAX_REACH_M);
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, origin.x + nx * clamped)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, origin.z + nz * clamped)),
  };
}

/** Re-exported so a HUD legend and this module cannot disagree. */
export const PVP_LOOK_SENSITIVITY_RAD_PER_PX = LOOK_TUNING.radPerPixel;
