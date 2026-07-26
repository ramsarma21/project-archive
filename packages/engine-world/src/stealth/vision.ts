// What a watcher can see, and how strongly.
//
// visibility() is the single detection function for the whole game. Its inputs are
// geometry, stance, motion, cover, light, crowd, and the scale an INVOKED ABILITY is
// currently applying — and nothing else. There is still no player identity, no skill
// term, no difficulty tier and no Standing multiplier in its signature, which is how
// "one difficulty, identical detection values for every player" is enforced rather
// than merely intended.
//
// The ability scale is not an exception to that rule and the distinction is not a
// matter of taste: it is neutral until a player spends a charge, it is bounded in
// time, and two players in identical geometry with the same effect invoked get the
// same number. `stealth/invokedAbility.ts` sets out the argument in full, along with
// the type-level guard that keeps a player attribute from ever appearing in it.
// `crowdBlend` is the precedent — also player-driven, also produced by an action
// rather than by an attribute, also just one more factor in the product.
//
// Occlusion uses the same zero-radius segment test the rest of the engine uses
// (collision.segmentClear), so a sightline that is blocked for the camera is
// blocked for a guard. The cone is feathered at its edge for feel but hard at
// its range: outside the range you are not seen at all.

import {
  STAND_HEIGHT,
  chestPosition,
  eyePosition,
  isCrouched,
  type CollisionWorld,
  type Vec3,
  segmentClear,
} from "../collision.js";
import { invokedAbilityScale } from "./invokedAbility.js";
import {
  STEALTH_TUNING,
  type PlayerExposure,
  type PlayerMotionRead,
  type StealthTuning,
} from "./tuning.js";

export interface WatcherEye {
  /** Watcher foot position. */
  position: Vec3;
  /** Unit facing in XZ. The effective facing, after attention turning. */
  forwardX: number;
  forwardZ: number;
  /** Body height. A crouching watcher looks from lower down. Defaults to standing. */
  capsuleHeight?: number;
  /** Cone half-angle. Falls back to the tuning default. */
  halfAngleRad?: number;
  /** Sight range. Falls back to the tuning default. */
  rangeM?: number;
  /** Colliders to ignore for LOS, e.g. the post the watcher is standing in. */
  ignore?: ReadonlySet<string>;
}

export interface PlayerSighting {
  /** Player foot position. */
  position: Vec3;
  /**
   * Live capsule height, straight off MotionState. The sight target is derived
   * from it rather than from a stance flag, so the silhouette a watcher resolves is
   * exactly the silhouette the collision capsule occupies — and exactly the one an
   * aimed shot resolves against.
   */
  capsuleHeight: number;
  exposure: PlayerExposure;
  motion: PlayerMotionRead;
  /** True while the capsule is behind hard cover from this watcher. */
  covered: boolean;
  /** Authored light at the player, [0,1]. 1 is full daylight. */
  lightLevel: number;
  /** Crowd blend strength, [0,1]. At 1 the cone is broken entirely. */
  crowdBlend: number;
  /**
   * Scale supplied by an invoked ability. 1, or absent, is no effect; 0 is a total
   * break. A SCALE rather than a strength, unlike `crowdBlend` above, because the
   * ability layer composes several effects multiplicatively before handing one
   * number down — flipping polarity at this boundary would be a bug waiting to
   * happen. See stealth/invokedAbility.ts.
   */
  abilityVisibilityScale?: number;
}

export interface VisibilityResult {
  /** [0,1]. Zero means this watcher has no contact at all this tick. */
  visibility: number;
  inCone: boolean;
  hasLineOfSight: boolean;
  distanceM: number;
  /** Component factors, for tuning readouts and tests. */
  coneFactor: number;
  distanceFactor: number;
  exposureFactor: number;
  motionFactor: number;
  coverFactor: number;
  lightFactor: number;
  crowdFactor: number;
  /** The invoked-ability scale that was applied. 1 when none was. */
  abilityFactor: number;
}

export const NO_VISIBILITY: VisibilityResult = {
  visibility: 0,
  inCone: false,
  hasLineOfSight: false,
  distanceM: Infinity,
  coneFactor: 0,
  distanceFactor: 0,
  exposureFactor: 0,
  motionFactor: 0,
  coverFactor: 0,
  lightFactor: 0,
  crowdFactor: 0,
  abilityFactor: 0,
};

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Eye point of a watcher, from the shared body model. */
export function eyePoint(watcher: WatcherEye): Vec3 {
  return eyePosition({
    pos: watcher.position,
    capsuleHeight: watcher.capsuleHeight ?? STAND_HEIGHT,
  });
}

/**
 * The point on the player a watcher's sightline is tested against: the same chest
 * landmark a duel aims a ball at.
 */
export function sightTarget(player: PlayerSighting): Vec3 {
  return chestPosition({
    pos: player.position,
    capsuleHeight: player.capsuleHeight,
  });
}

/**
 * How strongly this watcher sees this player, right now.
 *
 * The factors multiply, so any one of them reaching zero is a complete break:
 * out of the cone, behind a wall, or fully blended into a crowd all produce
 * exactly zero rather than a small residue that would creep toward detection.
 */
export function visibility(
  world: CollisionWorld,
  watcher: WatcherEye,
  player: PlayerSighting,
  tuning: StealthTuning = STEALTH_TUNING,
): VisibilityResult {
  const halfAngle = watcher.halfAngleRad ?? tuning.coneHalfAngleRad;
  const rangeM = watcher.rangeM ?? tuning.coneRangeM;
  const eye = eyePoint(watcher);
  const target = sightTarget(player);

  const dx = target.x - eye.x;
  const dz = target.z - eye.z;
  const distanceM = Math.hypot(dx, dz);
  if (distanceM > rangeM) {
    return { ...NO_VISIBILITY, distanceM };
  }

  const forwardLength = Math.hypot(watcher.forwardX, watcher.forwardZ) || 1;
  const invDistance = distanceM > 1e-9 ? 1 / distanceM : 0;
  const dot =
    (watcher.forwardX / forwardLength) * dx * invDistance +
    (watcher.forwardZ / forwardLength) * dz * invDistance;
  const coneEdge = Math.cos(halfAngle);
  const inCone = distanceM <= rangeM && dot + 1e-12 >= coneEdge;
  if (!inCone) {
    return { ...NO_VISIBILITY, distanceM };
  }

  const hasLineOfSight = segmentClear(world, eye, target, watcher.ignore);
  if (!hasLineOfSight) {
    return { ...NO_VISIBILITY, distanceM, inCone: true };
  }

  const coneFactor = smoothstep(coneEdge, 1, dot);
  const distanceFactor =
    1 -
    smoothstep(tuning.coneNearRangeFraction, 1, distanceM / rangeM);
  const exposureFactor = tuning.exposure[player.exposure];
  const motionFactor = tuning.motion[player.motion];
  const coverFactor = player.covered ? tuning.coverFactor : 1;
  const lightFactor =
    tuning.darkFactor + (1 - tuning.darkFactor) * clamp01(player.lightLevel);
  const crowdFactor = 1 - clamp01(player.crowdBlend);
  const abilityFactor = invokedAbilityScale(player.abilityVisibilityScale ?? 1);

  return {
    visibility: clamp01(
      coneFactor *
        distanceFactor *
        exposureFactor *
        motionFactor *
        coverFactor *
        lightFactor *
        crowdFactor *
        abilityFactor,
    ),
    inCone: true,
    hasLineOfSight: true,
    distanceM,
    coneFactor,
    distanceFactor,
    exposureFactor,
    motionFactor,
    coverFactor,
    lightFactor,
    crowdFactor,
    abilityFactor,
  };
}

/**
 * Derive the motion read from what the movement layer is doing. Kept here so
 * the mapping from motion phase to detectability is one decision in one place
 * rather than a guess at each call site.
 */
export function motionReadFor(input: {
  speedMps: number;
  /** Live capsule height. Stance is derived from the body, not asserted. */
  capsuleHeight: number;
  sprinting: boolean;
  traversing: boolean;
}): PlayerMotionRead {
  if (input.traversing) return "TRAVERSAL";
  if (isCrouched(input.capsuleHeight)) {
    return input.speedMps > 0.1 ? "CROUCH_MOVE" : "CROUCH_STILL";
  }
  if (input.speedMps <= 0.1) return "STILL";
  return input.sprinting ? "SPRINT" : "WALK";
}

/**
 * Unit XZ direction from a watcher to a point, for turning a cone toward an
 * attention target.
 */
export function yawToward(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Shortest signed angular difference from `a` to `b`. */
export function shortestAngleDelta(a: number, b: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * Turn a facing toward a target at a bounded rate. A cone that snaps to a
 * diversion is a bug you can see: the turn has to take time or throwing an object
 * reads as a cheat rather than a trick.
 */
export function turnTowardYaw(
  currentYaw: number,
  targetYaw: number,
  dt: number,
  tuning: StealthTuning = STEALTH_TUNING,
): number {
  const maxStep = tuning.attentionTurnRadPerSecond * dt;
  const delta = shortestAngleDelta(currentYaw, targetYaw);
  if (Math.abs(delta) <= maxStep) return targetYaw;
  return currentYaw + Math.sign(delta) * maxStep;
}
