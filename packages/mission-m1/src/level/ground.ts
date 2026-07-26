// M1 "The Effigy Run" — the ground.
//
// The run is eighty-eight metres of one road: Cornhill becoming Marlborough
// becoming Newbury becoming Orange, ending at the great elm on Essex Street.
// This file is what the player is running ON, and its only real job is that the
// road reads as a road. A single undifferentiated slab from the printshop to the
// tree would be honest about the collision — the floor genuinely is one plane at
// y=0 — and would throw away the one piece of information the surface can carry
// for free: which of these places is a thoroughfare and which is somewhere the
// town stops and stands.
//
// So four surfaces, and the difference between them is the mission's own shape:
//
//   the street    the spine. Cobbled, with wheel ruts running the direction of
//                 travel. 6.4m wide, which is exactly the STREET band the leap
//                 envelope is tuned against, so the paving and the gap a player
//                 has to clear are the same number.
//   the squares   Dock Square and the Town House square. Civic granite, no ruts:
//                 open ground, laid for standing on rather than driving down.
//                 The two sections where height is not the answer are the two
//                 sections paved like this.
//   the corner    the ground under the elm, which was Deacon Elliot's and was
//                 never a street at all. Trodden earth and grass, and it is what
//                 the road ends AT rather than continues through.
//   the lots      everything else: the alleys, the back lanes, the rope-walk and
//                 its yard. Broken stone and dirt.
//
// The plates are listed bottom-up and stacked a few millimetres apart, so where
// two surfaces meet the upper one covers the join rather than butting against it.
// That ordering is the only reason the list is ordered, and it carries two
// authored decisions: the carriageway is drawn OVER the square, because the Town
// House stood in the middle of the road and the road went round it; and the
// corner's earth is drawn OVER the end of the street, because the mission ends
// where the paving does.

import { rect } from "../authoring.js";
import type { Rect } from "../types.js";
import { DOCK_SQUARE } from "./dockSquare.js";
import { LEVEL_BOUNDS, LIBERTY_CORNER, SQUARE, STREET } from "./geometry.js";

export type GroundSurfaceKind = "LOT" | "SQUARE" | "OPEN_EARTH" | "STREET";

/**
 * How each surface's material meets the world.
 *
 * `tileM` is the real-world size of one edge of the tile, and it is a reading of
 * the image rather than a free parameter: the numbers below are the ones that put
 * a granite sett at about a quarter of a metre and a puddle at about one and a
 * half. `grain` says which world axis the image's own VERTICAL points along, and
 * it is likewise a fact about the picture — see `GroundGrain`.
 *
 * The materials are the road kit's own albedo tiles, re-encoded into the served
 * tree by assets/pipeline/sync_ground_materials.mjs.
 */
const SURFACE: Record<
  GroundSurfaceKind,
  { texturePath: string; tileM: number; grain: "X" | "Z" }
> = {
  // Wheel-polished ruts run down the image. Pointed along X they run down the
  // street; pointed the other way they would read as a row of cross-drains.
  // 6.4m to a tile is one tile across the carriageway, so the ruts sit at the
  // same place in the road for the whole length of the run instead of wandering.
  STREET: { texturePath: "world/textures/ground-street-cobble.jpg", tileM: 6.4, grain: "X" },
  // Large slabs among small setts, woven both ways. 8m to a tile puts the big
  // slabs at about a metre, which is what a civic square was laid in.
  SQUARE: { texturePath: "world/textures/ground-square-granite.jpg", tileM: 8, grain: "X" },
  // Mud, grass and standing water, with a foot-worn path down the image.
  OPEN_EARTH: { texturePath: "world/textures/ground-open-earth.jpg", tileM: 9, grain: "X" },
  // Broken stone and dirt in courses that run ACROSS the image, so this is the
  // one surface that asks for Z to lay its courses along the street.
  LOT: { texturePath: "world/textures/ground-yard-rubble.jpg", tileM: 7, grain: "Z" },
};

export interface GroundPlateSpec {
  readonly id: string;
  readonly surface: GroundSurfaceKind;
  readonly rect: Rect;
  readonly note?: string;
}

/**
 * How far the ground runs past the level's own bounds.
 *
 * The player is clamped to `LEVEL_BOUNDS`, but the camera is not the player: it
 * trails five metres back, and from the Town House tower it is looking out over
 * the whole peninsula. The skirt is what stops the far edge of the ground being a
 * hard line against the sky, and 90m is where the mission's fog has taken all but
 * a tenth of the contrast out of it.
 */
const SKIRT_M = 90;

function skirted(bounds: Rect, by: number): Rect {
  return rect(bounds.minX - by, bounds.maxX + by, bounds.minZ - by, bounds.maxZ + by);
}

/**
 * The ground, bottom plate first. Later plates are drawn over earlier ones.
 */
export const GROUND: GroundPlateSpec[] = [
  {
    id: "GROUND_LOTS",
    surface: "LOT",
    rect: skirted(LEVEL_BOUNDS, SKIRT_M),
    note: "The whole level and well past it. Every other plate is laid on top of this one, so no join anywhere in the mission can open onto sky.",
  },
  {
    id: "GROUND_DOCK_SQUARE",
    surface: "SQUARE",
    rect: DOCK_SQUARE,
    note: "The market floor the throng stands on.",
  },
  {
    id: "GROUND_TOWNHOUSE_SQUARE",
    surface: "SQUARE",
    rect: SQUARE,
    note: "Twenty-two metres across, which is why there is no leap here: the surface says so before the player tests it.",
  },
  {
    id: "GROUND_STREET",
    surface: "STREET",
    // West to the skirt, because a road that stops at the level's edge is a
    // road that ends in mid-air; east to a metre inside the Liberty corner, so
    // the corner's earth has something to overlap rather than abut.
    rect: rect(LEVEL_BOUNDS.minX - SKIRT_M, LIBERTY_CORNER.minX + 1, STREET.minZ, STREET.maxZ),
    note: "One plate for the whole run. Drawn over the squares, so the carriageway crosses them the way it crossed the real ones.",
  },
  {
    id: "GROUND_LIBERTY_CORNER",
    surface: "OPEN_EARTH",
    rect: LIBERTY_CORNER,
    note: "Elliot's ground, and the last plate laid: the paving arrives at the corner and stops, which is the whole geography of 14 August in one join.",
  },
];

/**
 * Millimetres of drop between one plate and the next.
 *
 * Four is the duel yard's proven number: enough that two plates never fight for
 * the same depth, small enough to be invisible on paving. The top plate sits one
 * step under the collision floor rather than on it, so a prop or a body standing
 * at y=0 is never inside the ground.
 */
const PLATE_STEP_M = 0.004;

/** Surface height for the plate at `index` in `GROUND`. */
export function groundPlateY(index: number, count: number = GROUND.length): number {
  return -(count - index) * PLATE_STEP_M;
}

export { SURFACE as GROUND_SURFACE };
