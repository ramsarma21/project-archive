import { test } from "node:test";
import assert from "node:assert/strict";

import { MODULE_RUNS, sceneryPlacements, type SceneryPlacement } from "../runtime.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import { ASSETS } from "../assets.js";

// The street shipped once with a third of its buildings drawn at half size. The
// cause was a contain-fit: it takes the SMALLEST of the three box/mesh ratios, so
// a town block 13m wide and 14m deep with a roof at 9.6m handed a house-shaped
// mesh scales the whole thing by the height and draws 6.5 x 9.6 x 5.6 — a correct
// house standing on a third of a civic block, with paving where the level says
// wall.
//
// The fix is that a `bldg-row-*` mesh is one HOUSE and a block is a terrace of
// them, so the block is covered by repeating the house at its own proportions.
// These are the properties that keep that true, and the two that keep it from
// going wrong in the other direction: a terrace that overhangs its corner, and a
// house stretched until its door is three metres wide.

const placements = sceneryPlacements();

const ROW_ASSETS = Object.entries(MODULE_RUNS)
  .filter(([, spec]) => spec.stance === "ROW")
  .map(([asset]) => asset);

/** Every block the level draws with a terrace, with the draws that cover it. */
const blocks = M1_EFFIGY_RUN.masses
  .filter((mass) => mass.asset && ROW_ASSETS.includes(mass.asset))
  .map((mass) => ({
    mass,
    spec: MODULE_RUNS[mass.asset!]!,
    draws: placements.filter((p) => p.parts.length === 1 && p.parts[0] === mass.id),
  }));

/** A placement's world footprint. `size` is house-local; a quarter turn swaps it. */
function planOf(p: SceneryPlacement) {
  const turned = Math.abs(Math.cos(p.yaw)) < 0.5;
  const halfX = (turned ? p.size[2] : p.size[0]) / 2;
  const halfZ = (turned ? p.size[0] : p.size[2]) / 2;
  return {
    minX: p.pos[0] - halfX,
    maxX: p.pos[0] + halfX,
    minZ: p.pos[2] - halfZ,
    maxZ: p.pos[2] + halfZ,
  };
}

const MM = 0.002;

test("the level has terraces to draw, and every one of them is a single block", () => {
  // A several-entry object takes its size from the asset's declared dimensions
  // instead, so a terrace spec on one would be dead code claiming to be a fix.
  assert.ok(blocks.length >= 7, `only ${blocks.length} terraced blocks found`);
  for (const { mass, draws } of blocks) {
    assert.ok(draws.length >= 1, `${mass.id} is drawn by nothing`);
    for (const draw of draws) {
      assert.equal(draw.fit, "MODULE", `${draw.id} must fill its own tile`);
    }
  }
});

test("a terrace is drawn to the whole of its own hull", () => {
  // The defect, stated as its own absence. The union of the houses is the block:
  // no paving inside a wall, and no wall outside the paving either.
  for (const { mass, draws } of blocks) {
    const plans = draws.map(planOf);
    const union = {
      minX: Math.min(...plans.map((r) => r.minX)),
      maxX: Math.max(...plans.map((r) => r.maxX)),
      minZ: Math.min(...plans.map((r) => r.minZ)),
      maxZ: Math.max(...plans.map((r) => r.maxZ)),
    };
    for (const edge of ["minX", "maxX", "minZ", "maxZ"] as const) {
      assert.ok(
        Math.abs(union[edge] - mass.rect[edge]) < MM,
        `${mass.id} ${edge}: terrace at ${union[edge].toFixed(3)}, block at ${mass.rect[edge].toFixed(3)}`,
      );
    }
    const top = Number.isFinite(mass.topY) ? mass.topY : mass.baseY;
    for (const draw of draws) {
      assert.ok(
        Math.abs(draw.pos[1] - mass.baseY) < MM &&
          Math.abs(draw.pos[1] + draw.size[1] - top) < MM,
        `${draw.id} runs ${draw.pos[1]}..${draw.pos[1] + draw.size[1]}, block ${mass.baseY}..${top}`,
      );
    }
  }
});

test("a terrace divides its block exactly, so no house overhangs the corner", () => {
  // Counting houses with `ceil` instead of `round` is what drew the duel yard's
  // gate shut, and a house reaching past a corner here would close an alley the
  // route runs down. Equal houses that abut are the whole of the guarantee.
  for (const { mass, draws } of blocks) {
    const first = draws[0]!;
    for (const draw of draws) {
      assert.ok(
        Math.abs(draw.size[0] - first.size[0]) < MM &&
          Math.abs(draw.size[2] - first.size[2]) < MM,
        `${draw.id} is ${draw.size.join("x")} where its neighbours are ${first.size.join("x")}`,
      );
    }
    const plans = draws.map(planOf);
    const width = mass.rect.maxX - mass.rect.minX;
    const depth = mass.rect.maxZ - mass.rect.minZ;
    // No overhang and no gap: the houses tile the block, so their areas sum to it.
    const area = plans.reduce(
      (sum, r) => sum + (r.maxX - r.minX) * (r.maxZ - r.minZ),
      0,
    );
    assert.ok(
      Math.abs(area - width * depth) < 0.01,
      `${mass.id} houses cover ${area.toFixed(2)}m2 of a ${(width * depth).toFixed(2)}m2 block`,
    );
  }
});

test("no house in a terrace is stretched out of recognition", () => {
  // A block filled by one stretched copy is worse than a small correct one: at
  // 22m of frontage it is a 22m door. The houses are counted so that each stays
  // near the mesh's own plan, and half again is the loosest that has ever looked
  // like a building — the tall south row, whose 8.3m plot is a 12m block.
  const LIMIT = 1.5;
  for (const { mass, spec, draws } of blocks) {
    const [naturalFrontage, naturalHeight, naturalPlot] = spec.naturalM;
    const scale = draws[0]!.size[1] / naturalHeight;
    const frontage = naturalFrontage * scale;
    const plot = naturalPlot * scale;
    for (const draw of draws) {
      const alongFrontage = draw.size[0] / frontage;
      const alongPlot = draw.size[2] / plot;
      assert.ok(
        alongFrontage <= LIMIT && 1 / alongFrontage <= LIMIT,
        `${mass.id} frontage is ${alongFrontage.toFixed(2)}x the mesh's own`,
      );
      assert.ok(
        alongPlot <= LIMIT && 1 / alongPlot <= LIMIT,
        `${mass.id} plot is ${alongPlot.toFixed(2)}x the mesh's own`,
      );
    }
  }
});

test("every module run is measured off a shipped mesh, not guessed", () => {
  // Meshy normalises an export to roughly two units on its longest axis, so a
  // natural size whose longest axis is not about 1.9 was either transposed or
  // invented — and either one is a silent forty per cent error in a building.
  for (const [asset, spec] of Object.entries(MODULE_RUNS)) {
    const longest = Math.max(...spec.naturalM);
    assert.ok(
      longest > 1.85 && longest < 1.95,
      `${asset} naturalM ${JSON.stringify(spec.naturalM)} is not a Meshy export's bounds`,
    );
    assert.ok(
      spec.naturalM.every((value) => value > 0),
      `${asset} naturalM has a zero axis`,
    );
  }
});

test("the roof runs land on a roof that is drawn", () => {
  // The point of the whole thing. Three of the mission's roof lines cross these
  // blocks, and before the terrace the shambles' three nodes stood up to 3.7m
  // clear of any drawn geometry: the player was running on air that held them up.
  for (const { mass, draws } of blocks) {
    const plans = draws.map(planOf);
    const onThisBlock = M1_EFFIGY_RUN.nodes.filter(
      (node) =>
        node.surface.startsWith(`${mass.id}__`) &&
        // Nodes the level itself puts outside the block — a dive lip half a
        // step past the parapet — are the level's business, not the terrace's.
        node.pos[0] >= mass.rect.minX &&
        node.pos[0] <= mass.rect.maxX &&
        node.pos[2] >= mass.rect.minZ &&
        node.pos[2] <= mass.rect.maxZ,
    );
    for (const node of onThisBlock) {
      assert.ok(
        plans.some(
          (r) =>
            node.pos[0] >= r.minX &&
            node.pos[0] <= r.maxX &&
            node.pos[2] >= r.minZ &&
            node.pos[2] <= r.maxZ,
        ),
        `${node.id} stands on ${node.surface} at ${node.pos.join(", ")}, outside every house of ${mass.id}`,
      );
    }
  }
});

test("a building described in parts is drawn once", () => {
  // The Town House shipped for a day as two buildings. Its pediment hood hangs
  // 1.7m clear above the balcony it shelters, which is head height rather than the
  // step the clusterer looks for, so the hood never joined the building — it
  // became an object in its own right and drew the WHOLE Town House again,
  // contain-fitted into its own 3.6 x 0.5 x 2.6m box: a 2.8%-scale doll's house
  // hanging in the air at eye level beside the real one.
  //
  // Stated without reference to size, because a fragment is not always small: a
  // draw standing inside a several-part draw of the same asset is that asset
  // rendered twice, once as the object and once as one of its own pieces.
  const wholes = placements.filter((p) => p.parts.length > 1);
  for (const piece of placements) {
    if (piece.parts.length > 1) continue;
    const inside = wholes.filter((whole) => {
      if (whole.asset !== piece.asset) return false;
      const hull = planOf(whole);
      const here = planOf(piece);
      return (
        here.minX >= hull.minX - 1 &&
        here.maxX <= hull.maxX + 1 &&
        here.minZ >= hull.minZ - 1 &&
        here.maxZ <= hull.maxZ + 1
      );
    });
    assert.deepEqual(
      inside.map((p) => p.id),
      [],
      `${piece.id} draws ${piece.asset} at ${piece.size.join(" x ")}m inside ` +
        `${inside.map((p) => p.id).join(", ")}, which already draws the whole of it`,
    );
  }
});

test("a fitting on a surface is not squeezed into the surface's slab", () => {
  // A deck's box is a slab of `DECK_THICKNESS_M`, invented so a surface has a box
  // at all. Nothing about it is a statement of how tall the object is, and for a
  // fitting taller than the slab it becomes the binding ratio of the contain-fit:
  // the printer's sign board came out 62cm wide on a 3.2m ledge and his drying
  // rack 26cm on a 2.6m one, both perfectly proportioned and both too small to
  // find. Every deck that draws on its own must be boxed at its asset's height.
  const declared = new Map(ASSETS.map((asset) => [asset.key, asset.sizeM]));
  for (const placement of placements) {
    if (placement.kind !== "DECK" || placement.fit === "MODULE") continue;
    const height = declared.get(placement.asset)?.[1];
    if (height === undefined) continue;
    assert.ok(
      Math.abs(placement.size[1] - height) < 1e-6,
      `${placement.id} is boxed ${placement.size[1]}m tall but ${placement.asset} is ${height}m`,
    );
  }
});

test("a building is anchored on the ground it stands on", () => {
  // Stonework above the ground floor oversails: the Town House's hood reaches
  // 2.6m north of the wall it is bolted to. Centring a building on every solid it
  // owns rather than on its footing slides it off the footprint the player walks
  // into, so the draw's plan centre has to be the footing's.
  for (const placement of placements) {
    if (placement.parts.length < 2) continue;
    const parts = M1_EFFIGY_RUN.masses.filter((mass) => placement.parts.includes(mass.id));
    if (parts.length === 0) continue;
    const baseY = Math.min(...parts.map((mass) => mass.baseY));
    const footing = parts.filter((mass) => mass.baseY <= baseY + 1e-6);
    const centre = (values: number[]) => (Math.min(...values) + Math.max(...values)) / 2;
    assert.ok(
      Math.abs(placement.pos[0] - centre(footing.flatMap((m) => [m.rect.minX, m.rect.maxX]))) <
        1e-6 &&
        Math.abs(placement.pos[2] - centre(footing.flatMap((m) => [m.rect.minZ, m.rect.maxZ]))) <
          1e-6,
      `${placement.id} is drawn at ${placement.pos[0]}, ${placement.pos[2]} but its footing ` +
        `[${footing.map((m) => m.id).join(", ")}] is centred elsewhere`,
    );
  }
});
