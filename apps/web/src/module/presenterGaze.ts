import type { ModuleShotKind } from "./moduleShots.js";

// ---------------------------------------------------------------------------
// Presenter gaze (pure, unit-testable).
//
// The owner's note was blunt: the presenter reads as if it is talking past the
// learner. The old rig turned its whole torso toward the side visual on the
// over-shoulder and focus shots, which is exactly the "staring away" the note
// describes. This file owns the maths that fixes it, as pure scalar functions
// so the clamps and the damping can be pinned without a canvas.
//
// The design, in one place:
//
//   The BODY faces the camera. `shotGaze(...).bodyYaw` is at or near zero on
//   every shot; the over-shoulder composition is done by the DOM layout and the
//   camera, not by rotating the figure away from the viewer.
//
//   The HEAD holds eye contact. It tracks the active camera within modest yaw
//   and pitch limits (there are no eye bones on this rig, so head orientation
//   IS the eye contact), and it takes a brief, motivated glance toward a
//   materializing visual and then returns to the viewer. `glanceEnvelope`
//   is that rise-hold-return curve.
//
//   Nothing snaps. `dampAngle` is a frame-rate-independent approach so a shot
//   change reads as a turn of the head, never a cut, and the clamps keep the
//   neck out of uncanny over-rotation.
//
// The rig glue (reading bone world transforms, applying the offset after the
// mixer) lives in SystemPresenter; everything here is a function of numbers.
// ---------------------------------------------------------------------------

/** Hard ceiling on how far the head may yaw off-forward, in radians (~26°). */
export const HEAD_YAW_LIMIT = 0.46;
/** Hard ceiling on head pitch, in radians (~16°). Kept small: a downcast or
 * upturned face reads as evasive or haughty, never as attention. */
export const HEAD_PITCH_LIMIT = 0.28;
/** Ceiling on how far the torso may turn off-camera, in radians (~9°). */
export const BODY_YAW_LIMIT = 0.16;

/** The gaze split: the neck carries a share and the head the rest, so no single
 * joint over-rotates to hit a target the two reach comfortably together. */
export const NECK_GAZE_SHARE = 0.4;
export const HEAD_GAZE_SHARE = 0.6;

export interface ShotGaze {
  /** Torso yaw off-camera. At/near zero on every shot: the body faces front. */
  readonly bodyYaw: number;
  /** A motivated head glance toward the active visual, in radians (signed). */
  readonly glanceYaw: number;
  /** A small standing head pitch for the shot, in radians. */
  readonly headPitch: number;
  /** 0..1 weight on holding camera eye-contact. Low on wide/back framings. */
  readonly contact: number;
}

/**
 * The gaze intent for each shot.
 *
 * Medium and reaction are direct address: full eye contact, no glance. The
 * over-shoulder and focus shots present a historical visual, so the head is
 * allowed a brief glance toward it (see `glanceEnvelope`) while still mostly
 * holding the viewer. Establishing is a wide of the room where forced eye
 * contact would look robotic, so its contact weight is low.
 */
export function shotGaze(shot: ModuleShotKind): ShotGaze {
  switch (shot) {
    case "ESTABLISH":
      return { bodyYaw: 0, glanceYaw: 0, headPitch: 0, contact: 0.2 };
    case "PRESENTER_MEDIUM":
      return { bodyYaw: 0, glanceYaw: 0, headPitch: 0, contact: 1 };
    case "OVER_SHOULDER":
      return { bodyYaw: 0.08, glanceYaw: 0.34, headPitch: 0, contact: 0.55 };
    case "VISUAL_FOCUS":
      return { bodyYaw: 0.06, glanceYaw: 0.22, headPitch: 0, contact: 0.45 };
    case "REACTION":
      return { bodyYaw: 0, glanceYaw: 0, headPitch: 0.03, contact: 1 };
    default:
      return { bodyYaw: 0, glanceYaw: 0, headPitch: 0, contact: 1 };
  }
}

/** Clamp an angle to a symmetric limit. */
export function clampAngle(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * Frame-rate-independent approach of `current` toward `target`.
 *
 * `rate` is the fraction of the remaining gap LEFT after one second; a smaller
 * rate is a faster move. Clamped `dt` so a stalled frame cannot overshoot.
 */
export function dampAngle(
  current: number,
  target: number,
  dt: number,
  rate: number,
): number {
  const k = 1 - Math.pow(rate, Math.min(Math.max(dt, 0), 0.1));
  return current + (target - current) * k;
}

/**
 * The brief-glance curve, as a function of seconds since the shot began.
 *
 * A visual materializes, the presenter looks at it, then returns to the viewer
 * while the shot is still up. The curve rises to 1, holds, and returns to 0, so
 * multiplying `glanceYaw` by it produces exactly "glance, then eye contact
 * again" without any per-frame state.
 */
export function glanceEnvelope(tSeconds: number): number {
  if (tSeconds <= 0) return 0;
  const riseEnd = 0.32;
  const holdEnd = 1.05;
  const returnEnd = 2.0;
  if (tSeconds < riseEnd) return smoothstep(tSeconds / riseEnd);
  if (tSeconds < holdEnd) return 1;
  if (tSeconds < returnEnd) {
    return 1 - smoothstep((tSeconds - holdEnd) / (returnEnd - holdEnd));
  }
  return 0;
}

/** Smooth 0..1 ramp with zero slope at both ends. */
function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * The head's target yaw for this frame: a blend of the camera-facing yaw
 * (weighted by the shot's eye-contact) and the motivated glance toward the
 * visual, clamped to the limit. Pure so the clamp behaviour is testable.
 */
export function headYawTarget(
  gaze: ShotGaze,
  glancePhase: number,
  cameraYaw: number,
): number {
  const glance = gaze.glanceYaw * Math.max(0, Math.min(1, glancePhase));
  const contact = cameraYaw * gaze.contact;
  return clampAngle(glance + contact, HEAD_YAW_LIMIT);
}

/** The head's target pitch for this frame, clamped. */
export function headPitchTarget(gaze: ShotGaze, cameraPitch: number): number {
  return clampAngle(gaze.headPitch + cameraPitch * gaze.contact, HEAD_PITCH_LIMIT);
}

/** The torso's target yaw for this frame, clamped small so it faces front. */
export function bodyYawTarget(gaze: ShotGaze): number {
  return clampAngle(gaze.bodyYaw, BODY_YAW_LIMIT);
}
