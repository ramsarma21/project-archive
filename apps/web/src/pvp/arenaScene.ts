// The yard PvP draws, derived from the arena the AUTHORITY is simulating.
//
// WHY THIS IS NOT THE DUEL'S OWN `YARD_COVER`. The boss duel authors its cover as
// "this imported prop, standing this tall" and hands the core a blocker derived from
// the prop — the visible crate and the thing that stops a ball are one declaration.
// PvP cannot work that way: the arena is chosen in the API process, which calls
// @pa/duel's `referenceArena()`, and the browser is told nothing about it. So the
// derivation runs the other way here. The blockers come first, from the same
// function the route calls, and each one is filled with imported props sized to it.
//
// The consequence is the property that matters: the cover you can see is the cover
// that stops a ball, and the wall you can see is where the core stops your feet.
// Drawing the rope-walk yard instead would have put chest-high crates a metre off
// the pillars that actually block, and a wall a metre inside the bounds the player
// can reach — which is exactly the kind of mismatch that makes a legitimate
// line-of-sight break look like a bug.
//
// THE ONE COUPLING, NAMED. `referenceArena()` is read here because the snapshot has
// no field for an arena. That is fine while PvP has exactly one, and it is the first
// thing that has to change if it ever gains a second: the arena id belongs in the
// snapshot, not in a matching pair of hardcoded calls.
//
// Everything below is pure and unit-tested. No prop is invented: every glbKey is one
// the duel's own yard already ships, and every size is a measured natural size scaled
// by a ratio.

import { referenceArena, type CoverSpec } from "@pa/duel";
import {
  GROUND_TILES,
  GROUND_TILE_SIZE,
  PROP_NATURAL_SIZE,
  YARD_DRESSING,
  fitPropToHeight,
  perimeterWall,
  type DressingPlacement,
} from "../duel/arenaSpec.js";

/** One imported prop, placed and sized. The renderer does nothing but draw these. */
export interface ArenaProp {
  readonly id: string;
  readonly glbKey: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  /** Box to fit the prop into, in metres. */
  readonly size: readonly [number, number, number];
  /** Ground offset; only the paving plates use it. */
  readonly y: number;
}

export interface ArenaBounds {
  readonly halfExtentX: number;
  readonly halfExtentZ: number;
}

export interface DrawnArena {
  readonly arenaId: string;
  readonly bounds: ArenaBounds;
  readonly ground: readonly ArenaProp[];
  readonly cover: readonly ArenaProp[];
  readonly wall: readonly ArenaProp[];
  readonly dressing: readonly ArenaProp[];
}

/**
 * Which prop stands in for a blocker, by what the blocker DOES.
 *
 * The core grades cover by height against a standing chest, so the two heights are
 * two different pieces of information for the player and want two different
 * silhouettes: a mound you cannot shoot over, and barrels you can. Same assets the
 * duel's yard uses, so the two fights are furnished from one set.
 */
const CHEST_COVER_PROP = "crate-mound";
const LOW_COVER_PROP = "barrel-group";
/** Above this the blocker eats a shot aimed at a standing fighter. */
const CHEST_COVER_THRESHOLD_M = 1;

/**
 * Clearance between the yard's reachable edge and the fixtures beyond it.
 *
 * Dressing has no blocker, so it is only honest where the player cannot get to it.
 * The duel's yard is 11m and its fixtures sit just past that; the reference arena is
 * 12m, so every fixture is pushed out to clear the larger wall rather than being
 * re-authored at new coordinates.
 */
const DRESSING_CLEARANCE_M = 1.7;

/**
 * Scale a prop uniformly to sit inside a box, and report the size it ends up.
 *
 * Uniform, deliberately: a crate stretched to fill a rectangle reads as a bad asset
 * long before anybody works out that the rectangle was the point. Filling a wide
 * blocker is handled by repeating the prop instead — see `fillBlocker`.
 */
export function containFit(
  glbKey: string,
  box: readonly [number, number, number],
): readonly [number, number, number] {
  const natural = PROP_NATURAL_SIZE[glbKey];
  if (!natural) throw new Error(`no measured size for prop ${glbKey}`);
  const scale = Math.min(
    box[0] / natural[0],
    box[1] / natural[1],
    box[2] / natural[2],
  );
  return [natural[0] * scale, natural[1] * scale, natural[2] * scale];
}

/**
 * How many prop instances span a blocker, and how the span divides.
 *
 * A blocker is a rectangle the core chose; a prop has the aspect ratio the artist
 * made. One instance stretched over a long rectangle is wrong and one instance
 * centred in it leaves the ends of the blocker invisible — so the long axis is cut
 * into roughly square cells and each cell gets its own prop.
 */
export function blockerCells(
  widthM: number,
  depthM: number,
): { readonly alongX: number; readonly alongZ: number } {
  const long = Math.max(widthM, depthM);
  const short = Math.max(1e-3, Math.min(widthM, depthM));
  const count = Math.max(1, Math.round(long / short));
  return widthM >= depthM ? { alongX: count, alongZ: 1 } : { alongX: 1, alongZ: count };
}

/** Fill one blocker with props that together occupy it and never overhang it. */
export function fillBlocker(cover: CoverSpec): readonly ArenaProp[] {
  const width = cover.halfX * 2;
  const depth = cover.halfZ * 2;
  const glbKey =
    cover.topY >= CHEST_COVER_THRESHOLD_M ? CHEST_COVER_PROP : LOW_COVER_PROP;
  const cells = blockerCells(width, depth);
  const cellWidth = width / cells.alongX;
  const cellDepth = depth / cells.alongZ;
  const size = containFit(glbKey, [cellWidth, cover.topY, cellDepth]);

  const out: ArenaProp[] = [];
  for (let ix = 0; ix < cells.alongX; ix++) {
    for (let iz = 0; iz < cells.alongZ; iz++) {
      out.push({
        id: `${cover.id}#${ix}.${iz}`,
        glbKey,
        x: cover.x - cover.halfX + cellWidth * (ix + 0.5),
        z: cover.z - cover.halfZ + cellDepth * (iz + 0.5),
        // Alternating quarter-turns so a repeated prop does not read as a repeated
        // prop. Cosmetic: the blocker is a broad box and does not turn with it.
        yaw: (ix + iz) % 2 === 0 ? 0 : Math.PI,
        size,
        y: 0,
      });
    }
  }
  return out;
}

/**
 * Push a fixture out until it clears the yard.
 *
 * Chebyshev distance rather than Euclidean, because the thing being cleared is a
 * square wall: a fixture at (12.4, 0.5) is inside a 12m yard's wall on the x side
 * however far it is from the middle.
 */
export function pushOutside(
  placement: DressingPlacement,
  minReach: number,
): DressingPlacement {
  const reach = Math.max(Math.abs(placement.x), Math.abs(placement.z));
  if (reach >= minReach || reach < 1e-6) return placement;
  const scale = minReach / reach;
  return { ...placement, x: placement.x * scale, z: placement.z * scale };
}

/** A fixture stands at its authored height; the duel's own helper does the fitting. */
function dressingProp(
  placement: DressingPlacement,
  index: number,
  prefix: string,
): ArenaProp {
  return {
    id: `${prefix}.${placement.glbKey}.${index}`,
    glbKey: placement.glbKey,
    x: placement.x,
    z: placement.z,
    yaw: placement.yaw,
    size: fitPropToHeight(placement.glbKey, placement.heightM).size,
    y: 0,
  };
}

/** The paving, tiled from the duel's own real-scale ground plate. */
function groundProps(): readonly ArenaProp[] {
  return GROUND_TILES.map((tile) => ({
    id: `ground.${tile.x}.${tile.z}`,
    glbKey: "colonial-yard-ground",
    x: tile.x,
    z: tile.z,
    yaw: tile.yaw,
    size: GROUND_TILE_SIZE,
    // The plate is a slab: sunk by its own thickness so its top face is y=0, and
    // each plate a few millimetres lower than the last so overlaps do not z-fight.
    y: -GROUND_TILE_SIZE[1] - tile.drop,
  }));
}

/**
 * The whole drawn yard for the arena the server is simulating.
 *
 * Takes the arena so a test can hand it a different one, and defaults to the one the
 * PvP route actually builds.
 */
export function drawnArena(
  arena: ReturnType<typeof referenceArena> = referenceArena(),
): DrawnArena {
  const { halfExtentX, halfExtentZ } = arena.spec;
  const minReach = Math.max(halfExtentX, halfExtentZ) + DRESSING_CLEARANCE_M;
  return {
    arenaId: arena.spec.arenaId,
    bounds: { halfExtentX, halfExtentZ },
    ground: groundProps(),
    cover: arena.spec.cover.flatMap(fillBlocker),
    wall: perimeterWall(halfExtentX, halfExtentZ).map((placement, index) =>
      dressingProp(placement, index, "wall"),
    ),
    dressing: YARD_DRESSING.map((placement, index) =>
      dressingProp(pushOutside(placement, minReach), index, "dressing"),
    ),
  };
}
