// The rope-walk yard, as geometry the core owns and props the art pipeline made.
//
// Two rules shape this file.
//
// THE COVER YOU SEE IS THE COVER THAT STOPS A BALL. Every piece of cover is
// declared as "this imported prop, standing this tall", and both the collision
// footprint handed to the core and the size handed to the renderer are derived from
// the prop's own measured proportions. There is no second set of numbers to drift:
// a crate mound fitted to 1.30m is 2.04m x 1.47m on the ground because that is the
// asset's aspect ratio, and the blocker is exactly that rectangle.
//
// THE COLLISION SHELL IS THE ONLY PROCEDURAL GEOMETRY. Blockers, the floor plane
// and the bounds are invisible, which is the category the project's
// imported-visible-world rule permits code to build. Everything with pixels is an
// imported GLB, and anything visible that has NO blocker behind it is placed
// outside the arena bounds where the core has already clamped the player, so a
// player can never walk through something they can see.
//
// The layout has 180-degree rotational symmetry on purpose, so that it CAN serve
// PvP — where any asymmetry is an unfair spawn — the day the arenas are unified.
// It does not serve PvP yet: PvP still fights @pa/duel's generic `referenceArena()`
// (12x12, four cover), and this yard is 11x11 with eight. Merging the two needs a
// netcode golden-hash regeneration and a winnability retune; the staged plan is in
// docs/process/PvP-Arena-Unification-Plan.md. The symmetry is the down-payment on it.

import { CAPSULE_RADIUS } from "@pa/engine-world";
import {
  buildArena,
  FACE_OFF_SEPARATION_M,
  type ArenaSpec,
  type CoverSpec,
  type DuelArena,
} from "@pa/duel";

/**
 * Natural bounding size of each prop as exported, in metres, measured off the GLB
 * POSITION accessors. Meshy normalises its output to roughly two units on the
 * longest axis, so nothing here is a real-world dimension until it is fitted.
 */
export const PROP_NATURAL_SIZE: Readonly<Record<string, readonly [number, number, number]>> = {
  "crate-mound": [1.9, 1.21, 1.373],
  "crate-stack": [1.902, 1.368, 1.439],
  "barrel-group": [1.9, 0.893, 1.446],
  "firewood-stack": [1.896, 1.476, 0.981],
  "rope-coil-large": [1.896, 0.249, 1.877],
  "ropewalk-laying-rig": [1.898, 0.569, 0.541],
  "timber-crane": [1.75, 1.898, 0.947],
  "service-wall-straight": [1.901, 0.862, 0.422],
  "colonial-yard-ground": [22, 0.076, 10],
};

export interface FittedProp {
  readonly glbKey: string;
  /** Exact box to fit the prop into; uniform because the aspect is the asset's. */
  readonly size: readonly [number, number, number];
  readonly halfX: number;
  readonly halfZ: number;
}

/** Scale a prop uniformly until it stands `heightM` tall, and report its footprint. */
export function fitPropToHeight(glbKey: string, heightM: number): FittedProp {
  const natural = PROP_NATURAL_SIZE[glbKey];
  if (!natural) throw new Error(`no measured size for prop ${glbKey}`);
  const scale = heightM / natural[1];
  const size: [number, number, number] = [
    natural[0] * scale,
    heightM,
    natural[2] * scale,
  ];
  return { glbKey, size, halfX: size[0] / 2, halfZ: size[2] / 2 };
}

export interface CoverPlacement {
  readonly id: string;
  readonly glbKey: string;
  readonly x: number;
  readonly z: number;
  readonly heightM: number;
  /** Yaw applied to the visible prop AND to nothing else: the blocker is a broad AABB. */
  readonly yaw: number;
}

/**
 * The yard's cover.
 *
 * Heights are graded so a glance tells the player what a piece of cover does. The
 * grading is against the core's own numbers: an aimed shot travels at the target's
 * chest, which for a standing fighter is about 1.12m, so 1.30m stops it and 0.85m
 * does not. The low pieces are still real: they block movement, which is what makes
 * crossing the yard a decision.
 */
export const YARD_COVER: readonly CoverPlacement[] = [
  { id: "COVER.CRATE_MOUND_WEST", glbKey: "crate-mound", x: -3.6, z: 0.9, heightM: 1.3, yaw: 0 },
  { id: "COVER.CRATE_MOUND_EAST", glbKey: "crate-mound", x: 3.6, z: -0.9, heightM: 1.3, yaw: Math.PI },
  { id: "COVER.TIMBER_NORTHWEST", glbKey: "firewood-stack", x: -6.6, z: -3.4, heightM: 1.45, yaw: 0 },
  { id: "COVER.TIMBER_SOUTHEAST", glbKey: "firewood-stack", x: 6.6, z: 3.4, heightM: 1.45, yaw: Math.PI },
  { id: "COVER.BARRELS_NORTH", glbKey: "barrel-group", x: 2.1, z: 4.6, heightM: 0.85, yaw: 0 },
  { id: "COVER.BARRELS_SOUTH", glbKey: "barrel-group", x: -2.1, z: -4.6, heightM: 0.85, yaw: Math.PI },
  { id: "COVER.CRATES_WEST", glbKey: "crate-stack", x: -8.2, z: 4.2, heightM: 1.4, yaw: 0 },
  { id: "COVER.CRATES_EAST", glbKey: "crate-stack", x: 8.2, z: -4.2, heightM: 1.4, yaw: Math.PI },
];

export const YARD_HALF_EXTENT_X = 11;
export const YARD_HALF_EXTENT_Z = 11;

/** Every cover placement with its fitted footprint resolved. */
export function fittedCover(
  placements: readonly CoverPlacement[] = YARD_COVER,
): readonly (CoverPlacement & FittedProp)[] {
  return placements.map((placement) => ({
    ...placement,
    ...fitPropToHeight(placement.glbKey, placement.heightM),
  }));
}

export function yardArenaSpec(): ArenaSpec {
  const cover: CoverSpec[] = fittedCover().map((entry) => ({
    id: entry.id,
    x: entry.x,
    z: entry.z,
    halfX: entry.halfX,
    halfZ: entry.halfZ,
    topY: entry.heightM,
  }));
  return {
    arenaId: "DUEL.ARENA.ROPEWALK_YARD",
    halfExtentX: YARD_HALF_EXTENT_X,
    halfExtentZ: YARD_HALF_EXTENT_Z,
    cover,
  };
}

/** The arena, built by the core from the spec above. */
export function yardArena(): DuelArena {
  return buildArena(yardArenaSpec());
}

// ---- dressing --------------------------------------------------------------
//
// Visible, no blocker, and therefore placed strictly outside the bounds the core
// clamps movement to. A player cannot reach it, so it cannot be walked through.

export interface DressingPlacement {
  readonly glbKey: string;
  readonly x: number;
  readonly z: number;
  readonly heightM: number;
  readonly yaw: number;
}

/** Half a capsule of clearance, so the wall is never inside the player. */
const WALL_STANDOFF_M = CAPSULE_RADIUS + 0.2;

export interface GroundTile {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Millimetres of drop, to keep overlapping plates out of each other's depth. */
  readonly drop: number;
}

/**
 * Ground plates. `colonial-yard-ground` is authored at a real 22m x 10m, so the yard
 * is paved by tiling it rather than by stretching one copy over the whole floor and
 * smearing the cobbles.
 *
 * TWO THINGS ARE LOAD-BEARING HERE, both learned by looking at a render.
 *
 * The plates are turned across the duel axis and the middle one is centred, so the
 * lane the two fighters stand in is a SINGLE plate. Paving it as two columns put a
 * seam down x=0 — which is exactly the line of the duel — and it read as a pale
 * stripe the length of the yard.
 *
 * And they overlap rather than abut, each a few millimetres lower than the last.
 * Abutting plates leave a hairline of background between them; coplanar overlapping
 * ones z-fight. A 4mm step does neither and is invisible on cobbles.
 */
export const GROUND_TILES: readonly GroundTile[] = [
  { x: 0, z: 0, yaw: Math.PI / 2, drop: 0 },
  { x: -9.6, z: 0, yaw: Math.PI / 2, drop: 0.004 },
  { x: 9.6, z: 0, yaw: Math.PI / 2, drop: 0.008 },
  // Runs off past the yard wall, so a camera looking down at the wall sees ground
  // behind it rather than sky.
  { x: 0, z: -14.5, yaw: 0, drop: 0.012 },
  { x: 0, z: 14.5, yaw: 0, drop: 0.016 },
];

export const GROUND_TILE_SIZE = PROP_NATURAL_SIZE["colonial-yard-ground"]!;

/** The yard wall: one imported module, tiled along each side, just out of reach. */
export function perimeterWall(
  halfX = YARD_HALF_EXTENT_X,
  halfZ = YARD_HALF_EXTENT_Z,
  heightM = 1.15,
): readonly DressingPlacement[] {
  const fitted = fitPropToHeight("service-wall-straight", heightM);
  const span = fitted.size[0];
  const out: DressingPlacement[] = [];
  const runX = Math.ceil((halfX * 2) / span);
  const runZ = Math.ceil((halfZ * 2) / span);
  for (let i = 0; i < runX; i++) {
    const x = -halfX + span * (i + 0.5);
    out.push({ glbKey: "service-wall-straight", x, z: -(halfZ + WALL_STANDOFF_M), heightM, yaw: 0 });
    out.push({ glbKey: "service-wall-straight", x, z: halfZ + WALL_STANDOFF_M, heightM, yaw: Math.PI });
  }
  for (let i = 0; i < runZ; i++) {
    const z = -halfZ + span * (i + 0.5);
    out.push({ glbKey: "service-wall-straight", x: -(halfX + WALL_STANDOFF_M), z, heightM, yaw: Math.PI / 2 });
    out.push({ glbKey: "service-wall-straight", x: halfX + WALL_STANDOFF_M, z, heightM, yaw: -Math.PI / 2 });
  }
  return out;
}

/** Rope-walk fixtures beyond the wall: the yard is somewhere, not a box. */
export const YARD_DRESSING: readonly DressingPlacement[] = [
  { glbKey: "timber-crane", x: -13.4, z: -8.6, heightM: 4.6, yaw: 0.5 },
  { glbKey: "timber-crane", x: 13.4, z: 8.6, heightM: 4.2, yaw: -2.3 },
  { glbKey: "rope-coil-large", x: -12.8, z: 1.6, heightM: 0.42, yaw: 0.3 },
  { glbKey: "rope-coil-large", x: -12.4, z: 3.4, heightM: 0.36, yaw: 1.1 },
  { glbKey: "rope-coil-large", x: 12.8, z: -1.6, heightM: 0.42, yaw: -0.6 },
  { glbKey: "ropewalk-laying-rig", x: 12.6, z: 4.4, heightM: 0.95, yaw: Math.PI / 2 },
  { glbKey: "ropewalk-laying-rig", x: -12.6, z: -4.4, heightM: 0.95, yaw: Math.PI / 2 },
  { glbKey: "crate-stack", x: 12.9, z: -7.4, heightM: 1.5, yaw: 0.4 },
  { glbKey: "crate-mound", x: -13.1, z: 7.2, heightM: 1.35, yaw: -0.4 },
  { glbKey: "firewood-stack", x: 0.4, z: -13.2, heightM: 1.5, yaw: 0.1 },
  { glbKey: "barrel-group", x: -2.6, z: 13.1, heightM: 0.95, yaw: 0.9 },
];

/** Where the two fighters stand for the face-off, from the core's own separation. */
export const FACE_OFF_HALF_SEPARATION_M = FACE_OFF_SEPARATION_M / 2;
