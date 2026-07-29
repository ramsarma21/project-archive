// Where the player is looking, and where that puts the camera.
//
// THIS IS THE ONLY THING THAT MAY WRITE CAMERA YAW.
//
// The bug this module exists to make impossible was a closed loop with gain.
// The chase camera was placed behind `motion.yaw`; the movement basis was then
// derived from where the camera had ended up; and `motion.yaw` chases whichever
// way the body is actually travelling. So holding one strafe key fed its own
// output back into its own input through a lagged follow, and the frame
// precessed forever — a measured 442 degrees in 3.6 seconds on a single held
// key, which is a player walking in circles they did not ask for.
//
// The fix is not a damping constant. It is a direction of flow: look yaw is an
// input, owned by the mouse, and everything else reads it. The camera is placed
// from it, the movement basis is built from it, and NOTHING downstream of it —
// not the body's facing, not its velocity, not the verb it is running — is
// allowed to write back into it. A loop that does not exist cannot be tuned
// into stability, and that is the whole of the guarantee.
//
// The body still turns to face where it is going. That is a third-person
// convention worth keeping and it is now purely cosmetic: it is read by the
// renderer and by the parkour probe, and by nothing that decides where the
// camera points.
//
// Pure: no THREE, no DOM, no wall clock, no randomness. The DOM half — pointer
// lock and the mousemove listener — lives in the app, because a mouse is a
// platform concern and this is the simulation's.

import {
  cameraSegmentOccluderIds,
  type CollisionWorld,
  type Vec3,
} from "./collision.js";

/**
 * Yaw convention matches the rest of the engine: forward is
 * `(sin(yaw), cos(yaw))`, so yaw 0 faces +Z and `Math.atan2(x, z)` recovers it.
 * Pitch is the camera's elevation above the focus; positive looks down at the
 * player from higher up.
 */
export interface LookState {
  yaw: number;
  pitch: number;
}

/**
 * The rig, in one place.
 *
 * `radPerPixel` is deliberately on the low side. The target player is eleven
 * years old on a school Chromebook trackpad, where a flick is a much larger
 * pixel delta than the same gesture on a mouse, and an over-sensitive camera on
 * a trackpad is indistinguishable from the bug above.
 */
export const LOOK_TUNING = {
  /** Radians of yaw per pixel of mouse travel. ~0.14 deg/px. */
  radPerPixel: 0.0024,
  /**
   * Pitch band. Asymmetric on purpose: this is a rooftop game, so being able to
   * look down over a lip and judge a drop is worth far more travel than being
   * able to look at the sky.
   */
  minPitchRad: -0.30,
  maxPitchRad: 1.05,
  /**
   * Rest pose. These three reproduce the framing that shipped, exactly: the old
   * camera sat 4.8m back and 2.5m up from the feet, looking at a point 1.2m up,
   * which is a radius of hypot(4.8, 1.3) at an elevation of atan2(1.3, 4.8).
   * Restating it as an orbit is what makes it steerable; it is deliberately not
   * an excuse to re-frame the shot, because the framing was not the complaint.
   */
  restPitchRad: 0.265,
  chaseDistanceM: 4.95,
  focusHeightM: 1.2,
  /**
   * Closest the camera may be pulled by geometry before it gives up and sits
   * inside the player's shoulder. Below this the rig is useless anyway.
   */
  minChaseDistanceM: 0.85,
  /** Standoff kept from whatever the camera backed into. */
  cameraSkinM: 0.30,
} as const;

export function createLookState(yaw: number): LookState {
  return { yaw, pitch: LOOK_TUNING.restPitchRad };
}

function clampPitch(pitch: number): number {
  return Math.min(
    LOOK_TUNING.maxPitchRad,
    Math.max(LOOK_TUNING.minPitchRad, pitch),
  );
}

/** Wrap to (-pi, pi] so yaw cannot drift to a magnitude that loses precision. */
function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Apply raw mouse travel, in pixels, to the look.
 *
 * Not frame-rate scaled, and that is correct rather than an oversight: a mouse
 * reports displacement, not velocity, so multiplying by dt would make the same
 * physical gesture turn the player further on a slow frame. Every mouse-look
 * implementation that feels wrong at variable frame rate has a dt in here.
 */
export function applyLookDelta(
  look: LookState,
  deltaXPx: number,
  deltaYPx: number,
  radPerPixel: number = LOOK_TUNING.radPerPixel,
): LookState {
  if (!Number.isFinite(deltaXPx) || !Number.isFinite(deltaYPx)) return look;
  return {
    yaw: wrapAngle(look.yaw - deltaXPx * radPerPixel),
    pitch: clampPitch(look.pitch + deltaYPx * radPerPixel),
  };
}

/** Unit XZ direction the player is looking, flattened to the ground plane. */
export function lookForward(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** Unit XZ direction to the player's right. */
export function lookRight(yaw: number): { x: number; z: number } {
  const forward = lookForward(yaw);
  return { x: -forward.z, z: forward.x };
}

/**
 * Resolve stick/WASD axes into a world-space direction.
 *
 * The one place camera-relative intent is computed. It takes the look yaw
 * rather than a camera object precisely so that no caller can be tempted to
 * derive the basis from where the camera physically ended up — which is what
 * closed the loop before, because the camera's position lags and is itself a
 * function of the body.
 */
export function lookMoveIntent(
  yaw: number,
  forwardAxis: number,
  rightAxis: number,
): { x: number; z: number } {
  const forward = lookForward(yaw);
  const right = lookRight(yaw);
  return {
    x: forward.x * forwardAxis + right.x * rightAxis,
    z: forward.z * forwardAxis + right.z * rightAxis,
  };
}

/** The point the camera is aimed at: the player's upper chest. */
export function chaseFocus(
  pos: Vec3,
  focusHeightM: number = LOOK_TUNING.focusHeightM,
): Vec3 {
  return { x: pos.x, y: pos.y + focusHeightM, z: pos.z };
}

/** Where the camera sits for a look and a focus, ignoring geometry. */
export function chaseCameraPosition(
  look: LookState,
  focus: Vec3,
  distanceM: number = LOOK_TUNING.chaseDistanceM,
): Vec3 {
  const forward = lookForward(look.yaw);
  const horizontal = Math.cos(look.pitch) * distanceM;
  return {
    x: focus.x - forward.x * horizontal,
    y: focus.y + Math.sin(look.pitch) * distanceM,
    z: focus.z - forward.z * horizontal,
  };
}

/**
 * How far the camera may sit back before something solid is between it and the
 * player.
 *
 * A rooftop route is the worst case for a chase camera: the player spends the
 * run next to chimneys, parapets and gable ends, and a camera four metres back
 * is regularly inside one. Left alone that reads as the world flickering, which
 * the owner would fairly call jank, and it also hides the geometry the next
 * jump has to be judged against.
 *
 * The common case is a single broad-phase query that finds nothing and returns
 * the full distance. Only an actually-occluded camera pays for the march.
 */
export function chaseCameraDistance(
  world: CollisionWorld,
  look: LookState,
  focus: Vec3,
  desiredDistanceM: number = LOOK_TUNING.chaseDistanceM,
  ignore?: ReadonlySet<string>,
): number {
  const full = chaseCameraPosition(look, focus, desiredDistanceM);
  if (cameraSegmentOccluderIds(world, focus, full, ignore).length === 0) {
    return desiredDistanceM;
  }
  // Walk in from the far end and take the last distance with a clear line. The
  // step is the skin, so the search resolution is the standoff it will apply.
  const step = LOOK_TUNING.cameraSkinM;
  for (
    let distance = desiredDistanceM - step;
    distance > LOOK_TUNING.minChaseDistanceM;
    distance -= step
  ) {
    const candidate = chaseCameraPosition(look, focus, distance);
    if (cameraSegmentOccluderIds(world, focus, candidate, ignore).length === 0) {
      return distance;
    }
  }
  return LOOK_TUNING.minChaseDistanceM;
}
