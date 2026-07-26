import { test } from "node:test";
import assert from "node:assert/strict";

import { groundPlacements, type GroundPlacement } from "../runtime.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import { LEVEL_BOUNDS, LIBERTY_CORNER, SQUARE, STREET } from "../level/geometry.js";
import { DOCK_SQUARE } from "../level/dockSquare.js";
import { GROUND } from "../level/ground.js";

// The mission shipped once with a walkable floor and no art under it: every
// building, prop and civilian stood against open sky. These are the properties
// that make that unshippable again, plus the two that keep the fix from
// introducing the defect the duel yard's ground had.

const plates = groundPlacements();
const NODE_STRIDE = 0.5;

function covers(plate: GroundPlacement, x: number, z: number): boolean {
  return x >= plate.minX && x <= plate.maxX && z >= plate.minZ && z <= plate.maxZ;
}

/** The plate a player standing here is looking down at: the highest that covers. */
function topPlateAt(x: number, z: number): GroundPlacement | null {
  let top: GroundPlacement | null = null;
  for (const plate of plates) {
    if (covers(plate, x, z) && (top === null || plate.y > top.y)) top = plate;
  }
  return top;
}

test("there is ground everywhere the player can stand", () => {
  // Every metre of the level's own bounds, which is exactly where movement is
  // clamped. A hole here is a hole in the sky under somebody's feet.
  for (let x = LEVEL_BOUNDS.minX; x <= LEVEL_BOUNDS.maxX; x += 1) {
    for (let z = LEVEL_BOUNDS.minZ; z <= LEVEL_BOUNDS.maxZ; z += 1) {
      assert.ok(topPlateAt(x, z), `no ground at ${x}, ${z}`);
    }
  }
});

test("every authored route node has ground under it", () => {
  for (const node of M1_EFFIGY_RUN.nodes) {
    assert.ok(
      topPlateAt(node.pos[0], node.pos[2]),
      `${node.id} at ${node.pos.join(", ")} stands over nothing`,
    );
  }
});

test("the ground runs past the bounds, so no edge of it faces the camera", () => {
  // The camera trails the player and the tower vista looks out over the whole
  // level; a plate stopping at the bounds puts a hard line against the sky.
  const base = plates[0]!;
  assert.ok(
    base.minX < LEVEL_BOUNDS.minX - 40 &&
      base.maxX > LEVEL_BOUNDS.maxX + 40 &&
      base.minZ < LEVEL_BOUNDS.minZ - 40 &&
      base.maxZ > LEVEL_BOUNDS.maxZ + 40,
    "the bottom plate does not overhang the level far enough to be lost in fog",
  );
});

// ---------------------------------------------------------------------------
// the seam
// ---------------------------------------------------------------------------

test("the street is one plate, so no join runs down the line of the run", () => {
  // The duel yard's ground was first laid as two columns of plates meeting at
  // x=0 — down the axis both duellists stand on — and it read as a pale stripe
  // the length of the yard. The street is the same shape of mistake waiting to
  // happen, eighty-eight metres long, so it is drawn as a single plate.
  const street = plates.filter((plate) => plate.id === "GROUND_STREET");
  assert.equal(street.length, 1, "the run is paved by more than one plate");
  const [run] = street as [GroundPlacement];
  assert.equal(run.minZ, STREET.minZ);
  assert.equal(run.maxZ, STREET.maxZ);
  assert.ok(
    run.minX <= LEVEL_BOUNDS.minX && run.maxX >= LIBERTY_CORNER.minX,
    "the paving does not reach from the level's west edge to the elm",
  );
});

test("no plate boundary runs lengthwise inside the street", () => {
  // Any plate drawn OVER the street either spans the whole carriageway or keeps
  // out of it. A plate whose long edge fell between the kerbs would put a line
  // down the run, whatever it was made of.
  const run = plates.find((plate) => plate.id === "GROUND_STREET")!;
  for (const plate of plates) {
    if (plate.id === run.id || plate.y < run.y) continue;
    const overlaps = plate.minX < run.maxX && plate.maxX > run.minX;
    if (!overlaps) continue;
    assert.ok(
      plate.minZ <= STREET.minZ && plate.maxZ >= STREET.maxZ,
      `${plate.id} is drawn over the street and its edge falls inside the carriageway`,
    );
  }
});

test("the tile's grain runs with the direction of travel on the street", () => {
  // The cobble material carries its wheel ruts down its own vertical axis.
  // Turned the other way they read as a row of cross-drains.
  const run = plates.find((plate) => plate.id === "GROUND_STREET")!;
  assert.equal(run.grain, "X");
  assert.equal(
    run.tileM,
    STREET.maxZ - STREET.minZ,
    "one tile should span the carriageway exactly, so the ruts hold their line",
  );
});

test("plates overlap at different heights, so they neither gap nor z-fight", () => {
  const heights = plates.map((plate) => plate.y);
  assert.equal(new Set(heights).size, plates.length, "two plates are coplanar");
  for (const plate of plates) {
    assert.ok(plate.y < 0, `${plate.id} is at or above the collision floor`);
    assert.ok(plate.y > -0.05, `${plate.id} sits far enough below to read as a step`);
  }
  // Declaration order is the layering. `ground.ts` lists bottom-up.
  for (let index = 1; index < plates.length; index++) {
    assert.ok(
      plates[index]!.y > plates[index - 1]!.y,
      `${plates[index]!.id} is declared after ${plates[index - 1]!.id} and drawn below it`,
    );
  }
});

// ---------------------------------------------------------------------------
// the reading
// ---------------------------------------------------------------------------

test("a player can tell the street from the open ground", () => {
  // The bar the ground has to clear: standing anywhere on the run, the surface
  // underfoot is the road's, and standing in either square or at the corner it
  // is not. One undifferentiated slab would pass every test above and fail this.
  const streetTexture = plates.find((plate) => plate.id === "GROUND_STREET")!.texturePath;

  // Unbroken from the west edge to where the corner's earth takes over. The
  // stretch under the Town House is included on purpose: the building is drawn
  // over the carriageway, and the carriageway still has to be there, because it
  // is what a player sees entering and leaving the island.
  for (let x = LEVEL_BOUNDS.minX; x < LIBERTY_CORNER.minX; x += NODE_STRIDE) {
    assert.equal(
      topPlateAt(x, 0)!.texturePath,
      streetTexture,
      `the middle of the run at x=${x} is not paved as a street`,
    );
  }

  for (const [label, area] of [
    ["the Town House square", SQUARE],
    ["Dock Square", DOCK_SQUARE],
    ["the Liberty corner", LIBERTY_CORNER],
  ] as const) {
    // Sampled off the carriageway, which deliberately crosses two of the three.
    const z = label === "Dock Square" ? 18 : label === "the Liberty corner" ? -6 : 9;
    const x = (area.minX + area.maxX) / 2;
    const top = topPlateAt(x, z)!;
    assert.notEqual(
      top.texturePath,
      streetTexture,
      `${label} is paved as a street, so it does not read as open ground`,
    );
  }
});

test("every surface a plate names is a served texture path", () => {
  for (const plate of plates) {
    assert.match(
      plate.texturePath,
      /^world\/textures\/[a-z0-9-]+\.jpg$/,
      `${plate.id} names ${plate.texturePath}, which is not a path in the served world`,
    );
    assert.ok(plate.tileM > 0.5, `${plate.id} has an implausible tile size`);
  }
});

test("each plate is declared once and drawn once", () => {
  const ids = GROUND.map((plate) => plate.id);
  assert.equal(new Set(ids).size, ids.length, "two ground plates share an id");
  assert.equal(plates.length, GROUND.length);
});
