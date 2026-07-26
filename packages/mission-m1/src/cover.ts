// Hard cover, measured against the collision the level already has.
//
// `visibility` in @pa/engine-world/stealth takes one boolean, `covered`, and
// multiplies the read by STEALTH_TUNING.coverFactor when it is set. The engine
// owns that factor; what a level owns is the GEOMETRIC QUESTION it answers, and
// that question is not "is the sightline blocked". A blocked sightline is
// already worth zero — `segmentClear` fails on the chest ray and `visibility`
// returns NO_VISIBILITY — so a predicate that reported full occlusion would be
// reporting something the field has already decided, and hard cover would carry
// on contributing nothing.
//
// The state `covered` exists for is the one in between: the mass is between you
// and the watcher, most of your body is behind it, and the chest landmark the
// field happens to trace is not. That is what being crouched behind a cart at
// an angle actually looks like, and it is the difference between a watcher
// resolving a person and resolving a shape that might be a person.
//
// So cover is measured as SILHOUETTE SCREENING: sample the body the watcher is
// actually looking at, count how much of it a blocker eats, and require the
// blocker to be close enough that the player is using it rather than standing
// in the far shadow of a building. Three numbers, all of them this level's own
// authoring policy rather than physics:
//
//   COVER_SAMPLE_HEIGHT_FRACTIONS  where the silhouette is sampled, as
//                                  fractions of the LIVE capsule height, so
//                                  crouching moves the samples with the body
//                                  exactly the way it moves the sight target.
//   COVER_MIN_SCREENED_FRACTION    how much of it has to be eaten. Half.
//   COVER_REACH_M                  how close the screening mass has to be.
//
// The middle number is the one that matters, and it is set at a half rather
// than lower on purpose. Cover composes MULTIPLICATIVELY with light, crowd,
// stance and motion, so a predicate that fired whenever any part of the body
// clipped a blocker would apply a flat 0.3 across most of the mission and make
// every other factor decorative — the dark arcade, the throng and the crouch
// would all be rounding errors on a number cover had already decided. At a half
// it fires where a player would say "I am behind that", and nowhere else.

import {
  CAPSULE_RADIUS,
  segmentOccluderIds,
  type CollisionWorld,
  type Vec3,
} from "@pa/engine-world/collision";
import { PARKOUR_TUNING } from "@pa/engine-world/parkour";
import { eyePoint, visibility, type WatcherEye } from "@pa/engine-world/stealth";
import type { CompiledLevel } from "./compile.js";
import { M1_EFFIGY_RUN } from "./level/index.js";
import { watcherPosesAtTick } from "./runtime.js";
import type { MissionLevel } from "./types.js";

/** Heights the silhouette is sampled at, as fractions of live capsule height. */
export const COVER_SAMPLE_HEIGHT_FRACTIONS = [0.2, 0.55, 0.9] as const;

/**
 * Lateral offsets across the body, in capsule radii, perpendicular to the
 * watcher. The two edges of the silhouette and nothing between them: a mass
 * that eats one shoulder and not the other is the whole shape of partial cover,
 * and the centre line is already what the field traces.
 */
export const COVER_SAMPLE_LATERAL_RADII = [-1, 1] as const;

/** Fraction of the sampled silhouette a blocker must eat to count as cover. */
export const COVER_MIN_SCREENED_FRACTION = 0.5;

/**
 * How close the screening mass has to be to count as cover the player is using.
 *
 * `PARKOUR_TUNING.obstacleProbeM` — the reach at which the movement layer
 * already treats an obstacle as yours and offers a verb against it. Taking the
 * number from there rather than inventing one keeps a single answer to "is that
 * piece of the world within arm's length", so the cart you can vault is the
 * cart you can hide behind, and neither meaning drifts from the other.
 */
export const COVER_REACH_M = PARKOUR_TUNING.obstacleProbeM;

export interface CoverRead {
  /** Feet position. */
  readonly pos: Vec3;
  /** Live capsule height, so stance has one source. */
  readonly capsuleHeight: number;
  /** Fixed-step index; patrol poses are a pure function of it. */
  readonly tick: number;
}

export interface CoverResult {
  covered: boolean;
  /** Which watcher the question was asked about, or null if none is in range. */
  watcherId: string | null;
  /**
   * True when this cone currently HAS the body: in range, inside the cone, and
   * with an unbroken line to the chest landmark the field traces.
   *
   * `coverAt` picks between cones on this, because cover cannot change a read
   * that has already resolved to zero. A watcher facing the other way is not
   * entitled to decide that you are standing in the open.
   */
  resolving: boolean;
  distanceM: number;
  /** Silhouette samples a blocker ate, over samples taken. */
  screened: number;
  samples: number;
  /** Ids of the masses doing the screening, nearest first. */
  screeningIds: string[];
}

const NO_COVER: CoverResult = {
  covered: false,
  watcherId: null,
  resolving: false,
  distanceM: Infinity,
  screened: 0,
  samples: 0,
  screeningIds: [],
};

/** Horizontal distance from a point to a blocker's broad-phase footprint. */
function distanceToBlockerM(
  world: CollisionWorld,
  id: string,
  x: number,
  z: number,
): number {
  const blocker = world.blockers.find((candidate) => candidate.id === id);
  if (!blocker) return Infinity;
  const dx = Math.max(blocker.minX - x, 0, x - blocker.maxX);
  const dz = Math.max(blocker.minZ - z, 0, z - blocker.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * Cover between a body and one watcher.
 *
 * Split out from `coverAt` so a test can ask the question about a named cone
 * instead of about whichever cone happens to be nearest on a given tick.
 */
export function coverAgainst(
  world: CollisionWorld,
  watcher: WatcherEye & { id?: string },
  read: CoverRead,
): CoverResult {
  const eye = eyePoint(watcher);
  const dx = read.pos.x - eye.x;
  const dz = read.pos.z - eye.z;
  const distanceM = Math.hypot(dx, dz);

  // Whether this cone has the body at all is the shipped field's question, not
  // this file's: `visibility` owns range, cone half-angle and the chest ray, and
  // asking it rather than re-deriving the same three tests is what stops cover
  // and vision disagreeing about who can see whom. The terms that are not
  // geometry are neutral here on purpose — light, stance and crowd change the
  // strength of a read, never whether the cone contains a body.
  const resolved = visibility(world, watcher, {
    position: read.pos,
    capsuleHeight: read.capsuleHeight,
    exposure: "EXPOSED",
    motion: "SPRINT",
    covered: false,
    lightLevel: 1,
    crowdBlend: 0,
  });
  if (!resolved.inCone || !resolved.hasLineOfSight) {
    return { ...NO_COVER, watcherId: watcher.id ?? null, distanceM };
  }

  // Across the body, not along the sightline: the two edges of the silhouette
  // are what a mass at an angle eats one of.
  const inv = distanceM > 1e-9 ? 1 / distanceM : 0;
  const sideX = -dz * inv;
  const sideZ = dx * inv;

  const hits = new Map<string, number>();
  let screened = 0;
  let samples = 0;
  for (const lateral of COVER_SAMPLE_LATERAL_RADII) {
    for (const fraction of COVER_SAMPLE_HEIGHT_FRACTIONS) {
      samples += 1;
      const target: Vec3 = {
        x: read.pos.x + sideX * lateral * CAPSULE_RADIUS,
        y: read.pos.y + read.capsuleHeight * fraction,
        z: read.pos.z + sideZ * lateral * CAPSULE_RADIUS,
      };
      const occluders = segmentOccluderIds(world, eye, target, watcher.ignore);
      if (occluders.length === 0) continue;
      screened += 1;
      for (const id of occluders) hits.set(id, (hits.get(id) ?? 0) + 1);
    }
  }

  // A mass has to be within reach to be cover rather than a distant wall the
  // player happens to be lined up behind.
  const screeningIds = [...hits.keys()]
    .map((id) => ({
      id,
      distanceM: distanceToBlockerM(world, id, read.pos.x, read.pos.z),
    }))
    .filter((entry) => entry.distanceM <= COVER_REACH_M)
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((entry) => entry.id);

  return {
    covered:
      screeningIds.length > 0 &&
      samples > 0 &&
      screened / samples >= COVER_MIN_SCREENED_FRACTION,
    watcherId: watcher.id ?? null,
    resolving: true,
    distanceM,
    screened,
    samples,
    screeningIds,
  };
}

/**
 * Cover between a body and the nearest watcher that can currently see it.
 *
 * The field takes ONE `covered` boolean for every cone, so a level has to pick
 * which cone the question is about. The pick is the nearest cone that is
 * actually resolving the body, and both halves of that matter:
 *
 *   - resolving, because a watcher facing away or behind a wall has already
 *     produced zero and cover cannot improve on zero. Letting such a cone answer
 *     would report "exposed" on behalf of somebody who cannot see you.
 *   - nearest, because among the cones that can see you, the near one is the one
 *     about to resolve you, and its geometry is the one the player is playing
 *     against.
 *
 * With nobody resolving, the answer is NO_COVER — which is correct rather than
 * pessimistic: `covered` only ever multiplies a read that already exists.
 */
export function coverAt(
  compiled: CompiledLevel,
  seed: number,
  read: CoverRead,
  level: MissionLevel = M1_EFFIGY_RUN,
): CoverResult {
  const poses = watcherPosesAtTick(read.tick, seed, level);
  let best: CoverResult = NO_COVER;
  for (const pose of poses) {
    const watcher: WatcherEye & { id: string } = {
      id: pose.id,
      position: pose.position,
      forwardX: Math.sin(pose.baseYaw),
      forwardZ: Math.cos(pose.baseYaw),
      capsuleHeight: pose.capsuleHeight,
      halfAngleRad: pose.halfAngleRad,
      rangeM: pose.rangeM,
      ignore: pose.ignore,
    };
    const result = coverAgainst(compiled.world, watcher, read);
    if (!result.resolving) continue;
    if (result.distanceM < best.distanceM) best = result;
  }
  return best;
}

/**
 * The port's `coveredAt`, bound to one attempt.
 *
 * `MissionInstance.coveredAt` is handed a player read and nothing else, so the
 * seed — which the patrol phase is drawn from — has to be closed over here. One
 * of these per attempt, which is one per instance, which is the lifetime the
 * port already guarantees.
 */
export function coverPredicate(
  compiled: CompiledLevel,
  seed: number,
  level: MissionLevel = M1_EFFIGY_RUN,
): (read: CoverRead) => boolean {
  return (read) => coverAt(compiled, seed, read, level).covered;
}
