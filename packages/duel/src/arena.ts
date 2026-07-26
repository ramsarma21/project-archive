// Duel arenas, composed from engine-world's collision builders.
//
// This is NOT a geometry system. Cover is a `Blocker` in the mission's
// CollisionWorld, built with engine-world's own `wallFromRect`, and every cover
// and line-of-sight question in the duel is answered by engine-world's
// `segmentOccluderIds` / `positionClear`. If the duel needed its own notion of a
// wall, that would be the fork this package exists to avoid.
//
// In production the arena arrives with the mission (the arena manifest in the
// mission container), and its visible form is imported GLB per the project's
// imported-visible-world rule. What is built here is the invisible collision
// shell only — which is exactly the category that rule permits procedural code
// for — so these helpers serve tests, tuning runs and the headless PvP authority.

import { platformFromRect, wallFromRect, type Blocker, type CollisionWorld } from "./engine.js";
import { FACE_OFF_SEPARATION_M } from "./tuning.js";
import type { BySide } from "./sides.js";
import type { Vec3 } from "./engine.js";

export interface CoverSpec {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  /** Top height. Chest-high cover stops an aimed shot; knee-high does not. */
  readonly topY: number;
}

export interface ArenaSpec {
  readonly arenaId: string;
  readonly halfExtentX: number;
  readonly halfExtentZ: number;
  readonly cover: readonly CoverSpec[];
}

export interface DuelArena {
  readonly spec: ArenaSpec;
  readonly world: CollisionWorld;
  readonly placement: BySide<{ readonly pos: Vec3; readonly yaw: number }>;
}

/** Chest-high enough to eat a shot aimed at a standing fighter. */
export const CHEST_COVER_HEIGHT = 1.25;
/** Low enough that a standing fighter is still exposed over it. */
export const LOW_COVER_HEIGHT = 0.7;

export function buildArena(spec: ArenaSpec): DuelArena {
  const walls: Blocker[] = spec.cover.map((cover) =>
    wallFromRect(cover.id, cover.x, cover.z, cover.halfX, cover.halfZ, {
      topY: cover.topY,
      landable: false,
      tags: ["DUEL_COVER"],
    }),
  );
  const bounds = {
    minX: -spec.halfExtentX,
    maxX: spec.halfExtentX,
    minZ: -spec.halfExtentZ,
    maxZ: spec.halfExtentZ,
  };
  const half = FACE_OFF_SEPARATION_M / 2;
  return {
    spec,
    world: {
      blockers: walls,
      platforms: [
        platformFromRect(
          `${spec.arenaId}.FLOOR`,
          bounds.minX,
          bounds.maxX,
          bounds.minZ,
          bounds.maxZ,
          0,
          ["DUEL_FLOOR"],
        ),
      ],
      bounds,
    },
    placement: {
      A: { pos: { x: 0, y: 0, z: -half }, yaw: 0 },
      B: { pos: { x: 0, y: 0, z: half }, yaw: Math.PI },
    },
  };
}

/**
 * The reference arena the tuning numbers were settled against: a 24x24 yard with
 * two chest-high pillars either side of centre, one low wall that does not
 * protect a standing fighter, and open lanes down both flanks. Enough cover that
 * hiding is possible and not so much that shooting is impossible.
 */
export function referenceArena(): DuelArena {
  return buildArena({
    arenaId: "DUEL.ARENA.REFERENCE",
    halfExtentX: 12,
    halfExtentZ: 12,
    cover: [
      { id: "COVER.PILLAR_WEST", x: -3.5, z: 0, halfX: 0.9, halfZ: 1.6, topY: CHEST_COVER_HEIGHT },
      { id: "COVER.PILLAR_EAST", x: 3.5, z: 0, halfX: 0.9, halfZ: 1.6, topY: CHEST_COVER_HEIGHT },
      { id: "COVER.CRATES_NORTH", x: 0, z: 5, halfX: 1.4, halfZ: 0.7, topY: LOW_COVER_HEIGHT },
      { id: "COVER.CRATES_SOUTH", x: 0, z: -5, halfX: 1.4, halfZ: 0.7, topY: LOW_COVER_HEIGHT },
    ],
  });
}

/** An empty yard: no cover at all. Used to isolate ballistics in tests. */
export function openArena(halfExtent = 14): DuelArena {
  return buildArena({
    arenaId: "DUEL.ARENA.OPEN",
    halfExtentX: halfExtent,
    halfExtentZ: halfExtent,
    cover: [],
  });
}
