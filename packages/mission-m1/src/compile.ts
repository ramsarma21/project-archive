// Level data -> the engine's collision representation.
//
// This is the only place the level touches collision, and it produces exactly
// the two primitives @pa/engine-world already understands. There is no second
// representation to keep in sync: every query in this package — traversability,
// sight lines, cover, the duel's line-of-sight breaks — runs against the same
// CollisionWorld the player will actually move through.

import type {
  Blocker,
  ClimbVolume,
  CollisionWorld,
  GripSpec,
  LadderSpec,
  Platform,
} from "@pa/engine-world/collision";
import { rampStrips } from "./authoring.js";
import { LADDER_COLLISION_HALF_M, ladderLines } from "./level/ladderGeom.js";
import type { CrowdCluster } from "@pa/engine-world/stealth";
import type {
  ClimbSpec,
  DeckSpec,
  GripPlacementSpec,
  LadderPlacementSpec,
  MassSpec,
  MissionLevel,
} from "./types.js";

function blockerFrom(mass: MassSpec): Blocker {
  const base: Blocker = {
    id: mass.id,
    minX: mass.rect.minX,
    maxX: mass.rect.maxX,
    minZ: mass.rect.minZ,
    maxZ: mass.rect.maxZ,
    baseY: mass.baseY,
    topY: mass.topY,
    landable: mass.landable,
    tags: new Set(mass.tags),
  };
  if (mass.round) {
    const cx = (mass.rect.minX + mass.rect.maxX) / 2;
    const cz = (mass.rect.minZ + mass.rect.maxZ) / 2;
    return {
      ...base,
      footprint: {
        kind: "capsule",
        ax: cx,
        az: cz,
        bx: cx,
        bz: cz,
        radius: mass.round.radius,
      },
    };
  }
  if (mass.yaw !== undefined && mass.yaw !== 0) {
    const cx = (mass.rect.minX + mass.rect.maxX) / 2;
    const cz = (mass.rect.minZ + mass.rect.maxZ) / 2;
    return {
      ...base,
      footprint: {
        kind: "obb",
        cx,
        cz,
        halfX: (mass.rect.maxX - mass.rect.minX) / 2,
        halfZ: (mass.rect.maxZ - mass.rect.minZ) / 2,
        yaw: mass.yaw,
      },
    };
  }
  return base;
}

function platformFrom(spec: DeckSpec): Platform {
  return {
    id: spec.id,
    minX: spec.rect.minX,
    maxX: spec.rect.maxX,
    minZ: spec.rect.minZ,
    maxZ: spec.rect.maxZ,
    y: spec.y,
    tags: new Set(spec.tags),
  };
}

function climbVolumeFrom(spec: ClimbSpec): ClimbVolume {
  return {
    id: spec.id,
    minX: spec.rect.minX,
    maxX: spec.rect.maxX,
    minZ: spec.rect.minZ,
    maxZ: spec.rect.maxZ,
    minY: spec.standMinY,
    maxY: spec.standMaxY,
    toSurface: spec.onto,
  };
}

/**
 * Resolve a placed ladder into the engine's LadderSpec, reading the ladder top
 * off the surface it serves so base/top/face are all measured, never a second
 * hand-typed height. Returns null when the served surface is unknown, so a
 * misplaced ladder drops out rather than arming a climb onto nothing.
 *
 * INERT until a ladder is authored (see LadderPlacementSpec): with no
 * `level.ladders`, `world.ladders` is empty and nothing consults it.
 */
function ladderFrom(
  spec: LadderPlacementSpec,
  topYOf: (id: string) => number | null,
): LadderSpec | null {
  const topY = topYOf(spec.onto);
  if (topY === null) return null;
  return {
    id: spec.id,
    base: { x: spec.at[0], y: spec.at[1], z: spec.at[2] },
    topY,
    faceX: spec.faceX,
    faceZ: spec.faceZ,
    toSurface: spec.onto,
    widthM: spec.widthM ?? 0.6,
    rungGapM: spec.rungGapM ?? 0.3,
  };
}

/**
 * Resolve a placed grip into the engine's GripSpec, reading the top off the
 * served surface. Returns null when the surface is unknown, so a misplaced grip
 * drops out rather than arming a climb onto nothing.
 */
function gripFrom(
  spec: GripPlacementSpec,
  topYOf: (id: string) => number | null,
): GripSpec | null {
  const topY = topYOf(spec.onto);
  if (topY === null) return null;
  return {
    id: spec.id,
    base: { x: spec.at[0], y: spec.at[1], z: spec.at[2] },
    topY,
    faceX: spec.faceX,
    faceZ: spec.faceZ,
    toSurface: spec.onto,
    support: spec.support,
    kind: spec.kind,
  };
}

/**
 * The SOLID a placed ladder now is. The owner's complaint was "still phasing
 * through, this time on a ladder" — a non-colliding ladder is one the body walks
 * through. This makes it a real obstacle: a capsule footprint along the leaning
 * run (the same line the ladder is DRAWN on, from `ladderLines`), rising the full
 * height it serves, so a body meeting the ladder head-on is stopped a body-radius
 * in front of it rather than passing through it.
 *
 * It is narrow on purpose (`LADDER_COLLISION_HALF_M`): the climber is stopped a
 * full body-radius in front of the foot and climbs from there, staying outside
 * the inward-leaning rails, so the body rests TANGENT to the solid (zero embed)
 * for the whole ascent and the non-penetration invariant stays clean. Tagged
 * `ladder` so the affordance verifier can tell a climbed face from a floor.
 */
function ladderBlockers(level: MissionLevel): Blocker[] {
  return ladderLines(level).map((line) => {
    const r = LADDER_COLLISION_HALF_M;
    return {
      id: `LADDERCOL_${line.id}`,
      minX: Math.min(line.foot[0], line.top[0]) - r,
      maxX: Math.max(line.foot[0], line.top[0]) + r,
      minZ: Math.min(line.foot[2], line.top[2]) - r,
      maxZ: Math.max(line.foot[2], line.top[2]) + r,
      baseY: line.footY,
      topY: line.topY,
      landable: false,
      tags: new Set<string>(["ladder"]),
      footprint: {
        kind: "capsule",
        ax: line.foot[0],
        az: line.foot[2],
        bx: line.top[0],
        bz: line.top[2],
        radius: r,
      },
    } satisfies Blocker;
  });
}

export interface CompiledLevel {
  world: CollisionWorld;
  /** Every deck including the strips a ramp expands into. */
  decks: DeckSpec[];
  massById: Map<string, MassSpec>;
  deckById: Map<string, DeckSpec>;
  /** Surface height lookup for a deck or a landable mass top. */
  surfaceY: (id: string) => number | null;
}

export function compileLevel(level: MissionLevel): CompiledLevel {
  const decks: DeckSpec[] = [...level.decks];
  for (const ramp of level.ramps) decks.push(...rampStrips(ramp));

  const massById = new Map(level.masses.map((mass) => [mass.id, mass]));
  const deckById = new Map(decks.map((spec) => [spec.id, spec]));
  const surfaceY = (id: string): number | null => {
    const asDeck = deckById.get(id);
    if (asDeck) return asDeck.y;
    const asMass = massById.get(id);
    if (asMass && asMass.landable && Number.isFinite(asMass.topY)) {
      return asMass.topY;
    }
    if (id === "GROUND") return 0;
    return null;
  };

  // Placed ladders resolve their top off the served surface, so the ascent is
  // measured from the object. Empty today (no ladder is authored yet); the pipe
  // exists so a placement lights the tested `alignClimbToLadder` predicate up.
  const ladders = (level.ladders ?? []).flatMap((placement) => {
    const ladder = ladderFrom(placement, surfaceY);
    return ladder ? [ladder] : [];
  });
  // Grips resolve their top off the served surface too, so a masonry set-off or
  // a bough climb is measured from the object like a ladder.
  const grips = (level.grips ?? []).flatMap((placement) => {
    const grip = gripFrom(placement, surfaceY);
    return grip ? [grip] : [];
  });

  const world: CollisionWorld = {
    blockers: [...level.masses.map(blockerFrom), ...ladderBlockers(level)],
    platforms: decks.map(platformFrom),
    bounds: {
      minX: level.bounds.minX,
      maxX: level.bounds.maxX,
      minZ: level.bounds.minZ,
      maxZ: level.bounds.maxZ,
    },
    climbVolumes: level.climbs.map(climbVolumeFrom),
    ladders,
    grips,
  };

  return {
    world,
    decks,
    massById,
    deckById,
    surfaceY: (id) => surfaceY(id),
  };
}

/** The authored crowds, in the shape the stealth field consumes. */
export function crowdClustersOf(level: MissionLevel): CrowdCluster[] {
  return level.blend.map((volume) => ({
    id: volume.id,
    x: volume.centre[0],
    z: volume.centre[2],
    radiusM: volume.radiusM,
    density: volume.civilians,
  }));
}

/**
 * Authored light at a point. The smallest volume containing it wins, so a
 * lamplit doorway inside an unlit shed reads as lamplit.
 */
export function lightLevelAt(
  level: MissionLevel,
  ambient: number,
  x: number,
  z: number,
): number {
  let best: { area: number; level: number } | null = null;
  for (const volume of level.light) {
    const { minX, maxX, minZ, maxZ } = volume.rect;
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    const area = (maxX - minX) * (maxZ - minZ);
    if (!best || area < best.area) best = { area, level: volume.level };
  }
  return best ? best.level : ambient;
}
