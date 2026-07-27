// Choosing where a boss hides, from the arena's own imported cover — never a wall
// the duel invented.
//
// This is a pure query against the mission's `CollisionWorld`, exactly like the
// rest of the duel's spatial reasoning. It reads the blockers the arena was built
// from (`arenaSpec.ts` fits every one of them to an imported GLB's measured
// footprint and tags it DUEL_COVER), works out the point on the FAR side of each
// from the player, and keeps only the points that are actually standable and
// actually break the line of sight when the boss crouches there. So the cover the
// boss retreats to is the cover the player can see, and the occlusion is the
// engine's real segment test rather than a promise.
//
// WHY CROUCH IS PART OF "VALID". A chest-high crate does not break an eye-to-eye
// sightline for a STANDING fighter — its top is below eye height, so the line
// passes over it (this is the same fact that lets an aimed ball sail over a
// crouching target). A boss only becomes occluded by such cover once it drops
// behind it, so a cover point is validated against the crouched eye line. That is
// why the boss visibly lowers into cover: the stance is what the occlusion needs,
// not decoration.

import {
  CAPSULE_RADIUS,
  CROUCH_HEIGHT,
  STAND_HEIGHT,
  eyeHeightForCapsule,
  positionClear,
  segmentClear,
  sweepXZ,
  type CollisionWorld,
  type Vec3,
} from "./engine.js";

/** The tag `arena.ts` / `arenaSpec.ts` put on every cover blocker. */
export const DUEL_COVER_TAG = "DUEL_COVER";

/** Stand this far behind a piece of cover: clear of its footprint, tucked close. */
const COVER_STANDOFF_M = CAPSULE_RADIUS + 0.2;

/**
 * How close the boss has to end a straight swept approach to a cover point for
 * that point to count as reachable. One capsule plus the arrival radius: the boss
 * only has to get its body to the standoff, not to the exact centre, and the
 * runtime steering (`bossAi.ts`) does the last-metre wall-following.
 */
const COVER_REACH_TOLERANCE_M = CAPSULE_RADIUS + 0.45;

export interface CoverPoint {
  /** The arena blocker this point hides behind. */
  readonly coverId: string;
  readonly x: number;
  readonly z: number;
}

/** A circular exclusion the boss must not pick cover inside of, e.g. the player. */
export interface CoverExclusion {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * Extra validity filters layered on top of "standable and actually occludes".
 * Both default off, so `bossCoverPoints` without options behaves exactly as it
 * always did and every existing caller/test is unaffected.
 */
export interface CoverQueryOptions {
  /**
   * Reject any point the boss cannot actually walk to from here. A cover point
   * that is behind a wall the boss has no route around is not cover, it is a spot
   * the boss would grind toward forever — see the stall the nav diagnosis found.
   */
  readonly reachableFrom?: Vec3;
  /** The boss's own capsule height for the reachability sweep. */
  readonly capsuleHeight?: number;
  /** Points overlapping any of these are rejected (the player standing on one). */
  readonly blocked?: readonly CoverExclusion[];
}

/**
 * Can the boss actually reach `point` from `from` by walking?
 *
 * A straight swept capsule is a deliberately cheap proxy — the duel arena is a
 * room with freestanding cover, not a maze — and it ignores the cover blocker the
 * point hides behind, because the boss legitimately rounds its own target cover to
 * tuck in behind it (the runtime steering does that). What it will not ignore is a
 * DIFFERENT wall between the boss and the point: that is the genuinely unreachable
 * case this rejects, so the boss never commits to a cover point it can only grind
 * toward.
 */
export function isCoverReachable(
  world: CollisionWorld,
  from: Vec3,
  point: { readonly coverId?: string; readonly x: number; readonly z: number },
  capsuleHeight = STAND_HEIGHT,
): boolean {
  const ignore = point.coverId ? new Set([point.coverId]) : undefined;
  const swept = sweepXZ(
    world,
    from,
    { x: point.x, z: point.z },
    CAPSULE_RADIUS,
    capsuleHeight,
    ignore,
  );
  return Math.hypot(swept.x - point.x, swept.z - point.z) <= COVER_REACH_TOLERANCE_M;
}

function isExcluded(
  point: { readonly x: number; readonly z: number },
  exclusions: readonly CoverExclusion[] | undefined,
): boolean {
  if (!exclusions) return false;
  for (const exclusion of exclusions) {
    if (
      Math.hypot(point.x - exclusion.x, point.z - exclusion.z) <=
      exclusion.radius + CAPSULE_RADIUS
    ) {
      return true;
    }
  }
  return false;
}

interface Blockerish {
  readonly id: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly topY: number;
  readonly tags: ReadonlySet<string>;
}

function normalise(x: number, z: number): { x: number; z: number } {
  const length = Math.hypot(x, z);
  return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 1 };
}

/**
 * Is a boss crouched at `point` actually in cover from a standing player at
 * `playerPos`? Standable there AND the crouched eye-to-eye line is occluded.
 *
 * The whole "no lying UI" guarantee rests on this being the same query the rest of
 * the duel uses for sight, so the answer the question overlay is gated on is the
 * answer the renderer will draw.
 */
export function isBossInCoverAt(
  world: CollisionWorld,
  point: { x: number; z: number },
  playerPos: Vec3,
  playerCapsuleHeight = STAND_HEIGHT,
): boolean {
  const foot: Vec3 = { x: point.x, y: 0, z: point.z };
  if (
    point.x < world.bounds.minX ||
    point.x > world.bounds.maxX ||
    point.z < world.bounds.minZ ||
    point.z > world.bounds.maxZ
  ) {
    return false;
  }
  // Standable there, crouched, without intruding into the cover or another blocker.
  if (!positionClear(world, foot, CAPSULE_RADIUS, CROUCH_HEIGHT)) return false;
  const bossEye: Vec3 = { x: point.x, y: eyeHeightForCapsule(CROUCH_HEIGHT), z: point.z };
  const playerEye: Vec3 = {
    x: playerPos.x,
    y: playerPos.y + eyeHeightForCapsule(playerCapsuleHeight),
    z: playerPos.z,
  };
  return !segmentClear(world, bossEye, playerEye);
}

/**
 * Every cover point a boss could retreat to, ordered by how far the boss has to
 * travel to reach it (nearest first, ties broken by cover id so the order is
 * deterministic across machines). Each is guaranteed valid by `isBossInCoverAt`.
 *
 * A point is placed on the far side of the cover from the player, offset by the
 * cover's own extent along that axis plus a capsule standoff, so the boss ends up
 * tucked behind it rather than on top of it.
 */
export function bossCoverPoints(
  world: CollisionWorld,
  bossPos: Vec3,
  playerPos: Vec3,
  playerCapsuleHeight = STAND_HEIGHT,
  options: CoverQueryOptions = {},
): readonly CoverPoint[] {
  const bossCapsuleHeight = options.capsuleHeight ?? STAND_HEIGHT;
  const ranked: { point: CoverPoint; distance: number }[] = [];
  for (const blocker of world.blockers as readonly Blockerish[]) {
    if (!blocker.tags.has(DUEL_COVER_TAG)) continue;
    const cx = (blocker.minX + blocker.maxX) / 2;
    const cz = (blocker.minZ + blocker.maxZ) / 2;
    const halfX = (blocker.maxX - blocker.minX) / 2;
    const halfZ = (blocker.maxZ - blocker.minZ) / 2;
    const away = normalise(cx - playerPos.x, cz - playerPos.z);
    // Support distance of the AABB along `away`, so the point clears the footprint
    // whatever the cover's aspect and orientation to the player.
    const reach =
      Math.abs(away.x) * halfX + Math.abs(away.z) * halfZ + COVER_STANDOFF_M;
    const point: CoverPoint = {
      coverId: blocker.id,
      x: cx + away.x * reach,
      z: cz + away.z * reach,
    };
    if (!isBossInCoverAt(world, point, playerPos, playerCapsuleHeight)) continue;
    // Occupied (the player is standing on it) or genuinely unreachable points are
    // not cover the boss can use, so they are filtered before ranking rather than
    // committed to and ground toward.
    if (isExcluded(point, options.blocked)) continue;
    if (
      options.reachableFrom &&
      !isCoverReachable(world, options.reachableFrom, point, bossCapsuleHeight)
    ) {
      continue;
    }
    ranked.push({
      point,
      distance: Math.hypot(point.x - bossPos.x, point.z - bossPos.z),
    });
  }
  ranked.sort(
    (a, b) =>
      a.distance - b.distance || a.point.coverId.localeCompare(b.point.coverId),
  );
  return ranked.map((entry) => entry.point);
}

/**
 * The single cover point a boss should head for right now: the nearest valid one.
 * Recomputed each tick from live positions, so if the player moves and spoils the
 * first choice the boss deterministically falls to the next-best rather than
 * marching to a spot that no longer hides it. Null only when the arena offers no
 * valid cover at all — a case the shipped yard never hits and a test guards.
 */
export function nearestBossCover(
  world: CollisionWorld,
  bossPos: Vec3,
  playerPos: Vec3,
  playerCapsuleHeight = STAND_HEIGHT,
  options: CoverQueryOptions = {},
): CoverPoint | null {
  return (
    bossCoverPoints(world, bossPos, playerPos, playerCapsuleHeight, options)[0] ??
    null
  );
}
