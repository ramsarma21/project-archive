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

// ---- M1's shipped arena ------------------------------------------------------
//
// THE ARENA THE MISSION IS ACTUALLY FOUGHT IN, and it is not `referenceArena()`.
//
// `referenceArena()` above is a TUNING FIXTURE — 12x12 with four pieces of cover —
// and for a long time it was also the only arena any balance test drove, while M1
// shipped an 11x11 yard with eight. So every "winnability verified" claim in this
// package described a fight nobody plays. That is the same defect class as the
// replay harness ruled inadmissible for real-play claims: a test path that diverged
// from the shipped path and stayed green.
//
// WHY THESE NUMBERS ARE RESTATED HERE RATHER THAN IMPORTED. The authoring lives in
// `apps/web/src/duel/arenaSpec.ts`, because each piece of cover is "this imported
// GLB, standing this tall" and its footprint is derived from the prop's own measured
// proportions — `fitPropToHeight`. That is asset-pipeline data and a renderer
// concern, and this package is the headless core that also runs the PvP authority;
// it has no business knowing what a `crate-mound` is. But the core cannot import
// from `apps/web` either (the dependency runs the other way), so the shipped
// geometry has to exist here as plain rectangles.
//
// So the same fit arithmetic is applied to the same measured prop sizes, in the same
// order of operations, and the result is PINNED BIT-FOR-BIT against the app's own
// `yardArenaSpec()` by `apps/web/test/duelArena.test.ts`. Restating without pinning
// is how the SYMMETRIC_COMPLEMENT opt-in went missing from the real mission path; if
// a prop is added, moved or refitted, that pin fails and names this constant.

/**
 * One piece of yard cover, fitted the way the renderer fits it.
 *
 * `natural` is the prop's bounding size as exported (metres, off the GLB POSITION
 * accessors), and the prop is scaled UNIFORMLY until it stands `heightM` tall — so
 * the footprint is the asset's own aspect ratio, never a second set of numbers.
 * Mirrors `fitPropToHeight` term for term so the two cannot round differently.
 */
function fittedYardCover(
  id: string,
  x: number,
  z: number,
  natural: readonly [number, number, number],
  heightM: number,
): CoverSpec {
  const scale = heightM / natural[1];
  return {
    id,
    x,
    z,
    halfX: (natural[0] * scale) / 2,
    halfZ: (natural[2] * scale) / 2,
    topY: heightM,
  };
}

/** Measured natural sizes of the props M1's cover is fitted from. */
const CRATE_MOUND: readonly [number, number, number] = [1.9, 1.21, 1.373];
const CRATE_STACK: readonly [number, number, number] = [1.902, 1.368, 1.439];
const BARREL_GROUP: readonly [number, number, number] = [1.9, 0.893, 1.446];
const FIREWOOD_STACK: readonly [number, number, number] = [1.896, 1.476, 0.981];

export const ROPEWALK_YARD_HALF_EXTENT = 11;

/**
 * The rope-walk yard's cover, in the authored order.
 *
 * The layout has 180-degree rotational symmetry on purpose, so it can serve PvP the
 * day the arenas are unified. Heights are graded so a glance tells the player what a
 * piece of cover does: an aimed shot travels at the target's chest, about 1.12 m for
 * a standing fighter, so 1.30 m and above stops it and 0.85 m does not. The low
 * pieces are still real — they block movement, which is what makes crossing the yard
 * a decision.
 */
export function ropewalkYardArenaSpec(): ArenaSpec {
  return {
    arenaId: "DUEL.ARENA.ROPEWALK_YARD",
    halfExtentX: ROPEWALK_YARD_HALF_EXTENT,
    halfExtentZ: ROPEWALK_YARD_HALF_EXTENT,
    cover: [
      fittedYardCover("COVER.CRATE_MOUND_WEST", -3.6, 0.9, CRATE_MOUND, 1.3),
      fittedYardCover("COVER.CRATE_MOUND_EAST", 3.6, -0.9, CRATE_MOUND, 1.3),
      fittedYardCover("COVER.TIMBER_NORTHWEST", -6.6, -3.4, FIREWOOD_STACK, 1.45),
      fittedYardCover("COVER.TIMBER_SOUTHEAST", 6.6, 3.4, FIREWOOD_STACK, 1.45),
      fittedYardCover("COVER.BARRELS_NORTH", 2.1, 4.6, BARREL_GROUP, 0.85),
      fittedYardCover("COVER.BARRELS_SOUTH", -2.1, -4.6, BARREL_GROUP, 0.85),
      fittedYardCover("COVER.CRATES_WEST", -8.2, 4.2, CRATE_STACK, 1.4),
      fittedYardCover("COVER.CRATES_EAST", 8.2, -4.2, CRATE_STACK, 1.4),
    ],
  };
}

/**
 * M1's shipped arena. Drive balance measurements against THIS, paired with the
 * shipped boss profile (`m1BossProfile` in boss.ts) — the two are one configuration
 * and measuring either against the other's counterpart produces numbers that
 * describe no fight at all.
 */
export function ropewalkYardArena(): DuelArena {
  return buildArena(ropewalkYardArenaSpec());
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
