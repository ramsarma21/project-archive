// Camera framing per phase, as a pure function of the two bodies.
//
// The duel has three distinct things to look at and they want different cameras:
//
//   FACE_OFF          a two-shot. Both men, the yard between them, drifting in as
//                     the weapons come up. This is the player's first impression of
//                     the mode and it is composed, not a gameplay camera.
//   the question      the boss framed over the player's shoulder. He is the one
//                     asking, so he is the one in frame; the shoulder keeps the
//                     player present rather than making it a menu.
//   the engagement    over-the-shoulder, high and back. Height is load-bearing:
//                     the balls are slow and dodgeable BECAUSE they are visible,
//                     and a low camera hides the one coming at you.
//
// The caller smooths towards whatever this returns, so a phase change is a camera
// move rather than a cut.

import type { DuelPhase } from "@pa/duel";
import type { ActorPose } from "./duelRuntime.js";

export interface CameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
}

/**
 * Asset-inspection framings. Not a gameplay camera: a weapon parented to a bone can
 * only be judged close up, and "does the hand actually hold it" is the single most
 * visible defect this mode can ship, so looking at it is a first-class affordance
 * rather than something to rebuild by hand every time the grip is retuned.
 */
export type InspectFraming = "GRIP_A" | "GRIP_B";

export interface CameraInput {
  readonly phase: DuelPhase;
  /** 0..1 through the face-off, for the drift. */
  readonly faceOffProgress: number;
  readonly player: ActorPose;
  readonly opponent: ActorPose;
  /** Smoothed aim yaw; the engagement camera sits behind it. */
  readonly aimYaw: number;
  readonly playerDowned: boolean;
  readonly reducedMotion: boolean;
  readonly inspect?: InspectFraming | null;
}

/** Chest height of a standing fighter, which is also where an aimed ball travels. */
export const AIM_PLANE_Y = 1.12;

const ENGAGEMENT = { back: 4.9, height: 2.62, side: 0.72, look: 3.4, lookHeight: 1.24, fov: 46 };
/**
 * The question is a reverse angle on the opponent, close in.
 *
 * He is the one asking, so he has to be legible — and from the player's own shoulder,
 * fourteen metres away, he is eighty pixels of red coat. The simulation is frozen in
 * this phase and nothing is interactive, so the camera is free to take up the
 * coverage position a dialogue shot would: head and chest above the answer panel.
 */
const QUESTION = { back: 4.0, height: 1.72, side: 1.4, lookHeight: 0.95, fov: 34 };
/**
 * The face-off is shot from behind and outboard of the player, down the line to the
 * officer — not from the perpendicular bisector.
 *
 * That is a framing constraint, not a taste: the two stand FACE_OFF_SEPARATION_M
 * apart, and a camera on the bisector close enough to read either face needs a
 * ~80-degree horizontal lens to hold both. Shooting down the axis puts one man
 * large in the foreground and the other centred and small, which is also the
 * composition a confrontation wants. Everything is expressed as a fraction of the
 * real separation so it survives an arena with a different one.
 */
const FACE_OFF = {
  backFrom: 4.6,
  backTo: 3.7,
  sideFrom: 2.5,
  sideTo: 1.75,
  height: 1.95,
  lookAlong: 0.6,
  lookHeight: 1.24,
  fov: 37,
};
/**
 * A body on the ground needs a low camera aimed at the ground, and it needs to sit
 * ABOVE the middle of the frame, because the outcome panel takes the bottom third.
 * Framed at standing height it was hidden behind the panel and the shot was a wall.
 */
const RESOLVED = { back: 3.9, height: 1.45, lookHeight: 0.06, side: 0.9, fov: 44 };

function normalise(x: number, z: number): [number, number] {
  const length = Math.hypot(x, z);
  if (length < 1e-6) return [0, 1];
  return [x / length, z / length];
}

/**
 * Roughly where a fighter's gun hand sits in an aim pose, as a fraction of standing
 * height. Measured by eye off both rigs: an aimed pistol is held near shoulder line,
 * not at the hip.
 */
const HAND_HEIGHT_FRACTION = 0.82;
/** Right of body centre, along the aim, where an aimed hand ends up. */
const HAND_OUT_M = 0.2;
const HAND_FORWARD_M = 0.34;
const INSPECT = { distance: 1.55, height: 0.1, fov: 30 };

export function desiredCamera(input: CameraInput): CameraPose {
  const { player, opponent } = input;
  const [axisX, axisZ] = normalise(opponent.x - player.x, opponent.z - player.z);
  // Right-handed perpendicular in the ground plane.
  const sideX = axisZ;
  const sideZ = -axisX;

  if (input.inspect) {
    const subject = input.inspect === "GRIP_A" ? player : opponent;
    const [faceX, faceZ] = normalise(Math.sin(subject.yaw), Math.cos(subject.yaw));
    // The subject's own right hand: right of centre, forward along its facing.
    const rightX = faceZ;
    const rightZ = -faceX;
    const handX = subject.x + rightX * -HAND_OUT_M + faceX * HAND_FORWARD_M;
    const handZ = subject.z + rightZ * -HAND_OUT_M + faceZ * HAND_FORWARD_M;
    const handY = subject.y + subject.capsuleHeight * HAND_HEIGHT_FRACTION;
    // Stand off to the weapon's outboard side, slightly ahead, at hand height.
    return {
      position: [
        handX + faceX * INSPECT.distance * 0.55 + rightX * -INSPECT.distance * 0.83,
        handY + INSPECT.height,
        handZ + faceZ * INSPECT.distance * 0.55 + rightZ * -INSPECT.distance * 0.83,
      ],
      target: [handX, handY, handZ],
      fov: INSPECT.fov,
    };
  }

  if (input.phase === "FACE_OFF") {
    const separation = Math.hypot(opponent.x - player.x, opponent.z - player.z);
    const progress = input.reducedMotion ? 1 : Math.min(1, Math.max(0, input.faceOffProgress));
    const back = FACE_OFF.backFrom + (FACE_OFF.backTo - FACE_OFF.backFrom) * progress;
    const side = FACE_OFF.sideFrom + (FACE_OFF.sideTo - FACE_OFF.sideFrom) * progress;
    return {
      position: [
        player.x - axisX * back + sideX * side,
        player.y + FACE_OFF.height,
        player.z - axisZ * back + sideZ * side,
      ],
      target: [
        player.x + axisX * separation * FACE_OFF.lookAlong,
        FACE_OFF.lookHeight,
        player.z + axisZ * separation * FACE_OFF.lookAlong,
      ],
      fov: FACE_OFF.fov,
    };
  }

  if (input.phase === "QUESTION_PENDING" || input.phase === "VERDICT_COMMITTED") {
    return {
      position: [
        opponent.x - axisX * QUESTION.back + sideX * QUESTION.side,
        opponent.y + QUESTION.height,
        opponent.z - axisZ * QUESTION.back + sideZ * QUESTION.side,
      ],
      target: [opponent.x, opponent.y + QUESTION.lookHeight, opponent.z],
      fov: QUESTION.fov,
    };
  }

  if (input.phase === "DUEL_RESOLVED" || input.phase === "ROUND_RESOLVED") {
    // Look at whoever is on the ground; if nobody is, hold the two-shot.
    const subject = input.playerDowned ? player : opponent;
    const fromX = input.playerDowned ? axisX : -axisX;
    const fromZ = input.playerDowned ? axisZ : -axisZ;
    return {
      position: [
        subject.x + fromX * RESOLVED.back + sideX * RESOLVED.side,
        subject.y + RESOLVED.height,
        subject.z + fromZ * RESOLVED.back + sideZ * RESOLVED.side,
      ],
      target: [subject.x, subject.y + RESOLVED.lookHeight, subject.z],
      fov: RESOLVED.fov,
    };
  }

  const [aimX, aimZ] = normalise(Math.sin(input.aimYaw), Math.cos(input.aimYaw));
  const rightX = aimZ;
  const rightZ = -aimX;
  return {
    position: [
      player.x - aimX * ENGAGEMENT.back + rightX * ENGAGEMENT.side,
      player.y + ENGAGEMENT.height,
      player.z - aimZ * ENGAGEMENT.back + rightZ * ENGAGEMENT.side,
    ],
    target: [
      player.x + aimX * ENGAGEMENT.look,
      player.y + ENGAGEMENT.lookHeight,
      player.z + aimZ * ENGAGEMENT.look,
    ],
    fov: ENGAGEMENT.fov,
  };
}

// ---- engagement yaw, damped and loop-free ---------------------------------
//
// THE WILD-SPIN ROOT CAUSE, and why the cure is a direction of flow rather than a
// constant. The engagement camera used to orbit behind the player's AIM yaw, and the
// aim is the screen pointer cast onto the ground plane THROUGH THIS CAMERA. So a held,
// off-centre pointer fed a loop with gain: the camera turned to sit behind the aim,
// which moved where screen-centre pointed, which pushed the aim further the same way,
// which turned the camera again — a constant angular velocity for as long as the mouse
// sat off-centre, i.e. the frame spinning "wildly". No damping constant fixes an
// integrator with positive feedback; it only slows the runaway.
//
// The fix is to anchor the orbit to a value the pointer cannot write back into: the
// authoritative player->opponent axis. The camera is allowed a BOUNDED lean toward the
// aim (`engagementCameraYaw`), and a bounded function of the aim saturates instead of
// integrating — hold the pointer anywhere and the camera settles at the lean limit
// rather than spinning past it. On top of that the yaw is closed with a frame-rate
// independent exponential approach AND a hard max slew rate, so even a fast axis change
// (crossing past the opponent) reads as a controlled swing. Nothing here touches the
// aim vector, the raycast or authority — only which yaw the camera is placed from.

/** Largest angle the engagement camera may lean off the opponent axis toward the aim. */
export const ENGAGEMENT_MAX_LEAN_RAD = 0.62; // ~35 degrees
/** Exponential closing rate for the engagement yaw (per second). */
export const ENGAGEMENT_YAW_RATE = 3.6;
/** Hard cap on how fast the camera yaw may slew, radians per second (~170 deg/s). */
export const ENGAGEMENT_MAX_YAW_RATE = 3.0;

function wrapAngle(radians: number): number {
  let value = radians;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

/**
 * The yaw the engagement camera should orbit behind: the opponent axis, plus a lean
 * toward the aim CLAMPED to `maxLean`. Pure, and the anchor of the anti-spin fix — the
 * lean is a bounded function of the aim, so it can never accumulate into a spin.
 */
export function engagementCameraYaw(
  axisYaw: number,
  aimYaw: number,
  maxLean: number = ENGAGEMENT_MAX_LEAN_RAD,
): number {
  const lean = wrapAngle(aimYaw - axisYaw);
  const clamped = Math.max(-maxLean, Math.min(maxLean, lean));
  return axisYaw + clamped;
}

/**
 * Damp an angle toward a goal, FRAME-RATE INDEPENDENT and slew-clamped.
 *
 * The exponential term `1 - e^(-rate*dt)` closes the same fraction of the remaining
 * angle per unit time regardless of how the frame is subdivided, so 60fps and 120fps
 * reach the same place after the same wall time. The slew clamp then bounds the
 * per-second angular velocity, which is the hard guarantee that no input or target jump
 * can whip the frame around. Always takes the shortest way round, so ±pi is never a
 * long turn.
 */
export function dampAngle(
  current: number,
  goal: number,
  rate: number,
  maxRatePerSec: number,
  dt: number,
): number {
  const step = Math.max(0, dt);
  const delta = wrapAngle(goal - current);
  const alpha = 1 - Math.exp(-Math.max(0, rate) * step);
  let move = delta * alpha;
  const cap = Math.max(0, maxRatePerSec) * step;
  if (move > cap) move = cap;
  else if (move < -cap) move = -cap;
  return current + move;
}

/** How fast the camera closes on its target pose, per phase. */
export function cameraFollowRate(phase: DuelPhase): number {
  switch (phase) {
    case "FACE_OFF":
      return 1.6;
    case "QUESTION_PENDING":
    case "VERDICT_COMMITTED":
      return 2.4;
    case "ROUND_RESOLVED":
    case "DUEL_RESOLVED":
      return 1.9;
    default:
      return 6.5;
  }
}

/** Frame-rate independent exponential approach. */
export function approach(current: number, goal: number, rate: number, dt: number): number {
  const alpha = 1 - Math.exp(-rate * Math.max(0, dt));
  return current + (goal - current) * alpha;
}
