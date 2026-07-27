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
  Platform,
} from "@pa/engine-world/collision";
import { rampStrips } from "./authoring.js";
import type { CrowdCluster } from "@pa/engine-world/stealth";
import type { ClimbSpec, DeckSpec, MassSpec, MissionLevel } from "./types.js";

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

  const world: CollisionWorld = {
    blockers: level.masses.map(blockerFrom),
    platforms: decks.map(platformFrom),
    bounds: {
      minX: level.bounds.minX,
      maxX: level.bounds.maxX,
      minZ: level.bounds.minZ,
      maxZ: level.bounds.maxZ,
    },
    climbVolumes: level.climbs.map(climbVolumeFrom),
  };

  const massById = new Map(level.masses.map((mass) => [mass.id, mass]));
  const deckById = new Map(decks.map((spec) => [spec.id, spec]));

  return {
    world,
    decks,
    massById,
    deckById,
    surfaceY: (id) => {
      const asDeck = deckById.get(id);
      if (asDeck) return asDeck.y;
      const asMass = massById.get(id);
      if (asMass && asMass.landable && Number.isFinite(asMass.topY)) {
        return asMass.topY;
      }
      if (id === "GROUND") return 0;
      return null;
    },
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
