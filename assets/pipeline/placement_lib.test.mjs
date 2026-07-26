// Fixtures for the M1 placement instruments.
//
// Same shape and the same runner as `collision_lib.test.mjs`, which is where
// pipeline unit tests live in this repo. There is no package.json under
// assets/pipeline — these scripts are run by hand and by CI, not installed — so
// the entry point is `node --test` on the file rather than a workspace `test`
// script. See `.github/workflows/ci.yml`, which runs every
// `assets/pipeline/*.test.mjs`.
//
// Two halves:
//   - the arithmetic in `placement_lib.mjs`, asserted directly. Pure, so these
//     are ordinary unit tests.
//   - the ten instrument invariants in `placement_selftest.mjs`, which need a
//     scene graph and so need three. Those are the ones that answer the four
//     defects found in these tools so far; each row names which. The verifiers
//     run the same rows before they measure anything, so this file and the tools
//     cannot disagree about what "correct" means.
//
// Run: node --test assets/pipeline/placement_lib.test.mjs
globalThis.self = globalThis;
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  clipConvex,
  containFitScale,
  convexHull,
  coveredFraction,
  fillScale,
  intersectionArea,
  orientedCorners,
  partFootprint,
  placementFootprint,
  polygonArea,
  reachBeyond,
  rotateXZ,
  shellFit,
  shellQuarterTurn,
  supportPlane,
  supportsFrom,
} from "./placement_lib.mjs";
import { footprintSamples } from "./placement_probe.mjs";
import { runSelfTests } from "./placement_selftest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THREE = await import(
  pathToFileURL(join(repoRoot, "apps", "web", "node_modules", "three", "build", "three.module.js"))
);

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

// ---- fits -------------------------------------------------------------------

test("containFitScale takes the smallest ratio, like FittedGlb", () => {
  // market-awning: a 1.90 x 1.56 x 1.57 mesh into a 3.2 x 2.6 x 2.4 box, so the
  // depth is what binds.
  approx(containFitScale([1.9, 1.56, 1.57], [3.2, 2.6, 2.4]), 2.4 / 1.57);
  approx(containFitScale([1, 1, 1], [3, 1, 1]), 1);
});

test("containFitScale does not depend on yaw: the fit is in local space", () => {
  // The renderer fits inside a group and the group turns afterwards, so there is
  // no yaw for a fit to see. A verifier that transposes the mesh for a yawed
  // placement is measuring a fit nothing performs: infill-lean-to's 1.90 x 1.45 x
  // 1.15 mesh is width-bound in its 3.0 x 3.85 x 3.2 box either way round, and
  // transposing it to 1.15 x 1.45 x 1.90 would report a height-bound fit instead.
  const natural = [1.9, 1.45, 1.15];
  const size = [3.0, 3.85, 3.2];
  approx(containFitScale(natural, size), 3.0 / 1.9);
  // The transposed reading is a different number, which is why it mattered.
  approx(containFitScale([natural[2], natural[1], natural[0]], size), 3.2 / 1.9);
  assert.notEqual(3.0 / 1.9, 3.2 / 1.9);
});

test("fillScale stretches every axis, like FittedGlb fill", () => {
  const s = fillScale([1.9, 0.86, 0.42], [4, 3.6, 0.6]);
  approx(s[0], 4 / 1.9);
  approx(s[1], 3.6 / 0.86);
  approx(s[2], 0.6 / 0.42);
});

test("shellQuarterTurn matches ImportedStructure", () => {
  // int-partition-board-a: a 1.90 x 1.90 x 0.23 board wall into a 0.5 x 1.6 x 4.4
  // slot. Long on its own X, long on the room's Z, so it turns.
  assert.equal(shellQuarterTurn([1.9, 1.9, 0.23], [0.5, 1.6, 4.4]), true);
  // int-shell-ropewalk-a is already square to its room.
  assert.equal(shellQuarterTurn([22, 8.6, 10], [22, 8.6, 10]), false);
  assert.equal(shellQuarterTurn([1.9, 1.9, 0.23], [0.5, 1.6, 4.4], false), false);
});

test("shellFit maps source X onto room depth when it turns", () => {
  const fit = shellFit([1.9, 1.9, 0.23], [0.5, 1.6, 4.4]);
  approx(fit.scale[0], 4.4 / 1.9);
  approx(fit.scale[2], 0.5 / 0.23);
  approx(fit.innerYaw, -Math.PI / 2);
});

// ---- footprints -------------------------------------------------------------

test("rotateXZ is the same right-handed yaw the engine uses", () => {
  const [x, z] = rotateXZ(1, 0, Math.PI / 2);
  approx(x, 0);
  approx(z, -1);
});

test("a module box turned a quarter swaps which world axis carries its length", () => {
  const flat = placementFootprint({ pos: [0, 0, 0], size: [4, 1, 1], yaw: 0 });
  const turned = placementFootprint({ pos: [0, 0, 0], size: [4, 1, 1], yaw: Math.PI / 2 });
  const spanX = (poly) => Math.max(...poly.map((p) => p[0])) - Math.min(...poly.map((p) => p[0]));
  const spanZ = (poly) => Math.max(...poly.map((p) => p[1])) - Math.min(...poly.map((p) => p[1]));
  approx(spanX(flat), 4);
  approx(spanZ(flat), 1);
  approx(spanX(turned), 1);
  approx(spanZ(turned), 4);
});

test("a yawed mass footprint is its rect turned about its own centre, like compile.ts", () => {
  const part = { rect: { minX: -2, maxX: 2, minZ: -0.5, maxZ: 0.5 }, yaw: Math.PI / 2 };
  const poly = partFootprint(part);
  const spanX = Math.max(...poly.map((p) => p[0])) - Math.min(...poly.map((p) => p[0]));
  const spanZ = Math.max(...poly.map((p) => p[1])) - Math.min(...poly.map((p) => p[1]));
  approx(spanX, 1);
  approx(spanZ, 4);
});

test("a round mass footprint is a circle of its own radius", () => {
  const poly = partFootprint({
    rect: { minX: 78.1, maxX: 79.9, minZ: 8.1, maxZ: 9.9 },
    round: { radius: 0.9 },
  });
  // A 256-gon inscribed in the circle, so 0.01% under the true area — four orders
  // of magnitude below the tightest threshold either verifier gates on.
  approx(polygonArea(poly), Math.PI * 0.9 * 0.9, 1e-3);
  assert.ok(polygonArea(poly) < Math.PI * 0.9 * 0.9);
});

// ---- overlap ----------------------------------------------------------------

test("polygonArea is orientation-blind", () => {
  const square = orientedCorners({ cx: 0, cz: 0, halfX: 1, halfZ: 2 });
  approx(polygonArea(square), 8);
  approx(polygonArea([...square].reverse()), 8);
});

test("clipConvex intersects two overlapping squares exactly", () => {
  const a = orientedCorners({ cx: 0, cz: 0, halfX: 1, halfZ: 1 });
  const b = orientedCorners({ cx: 1, cz: 0, halfX: 1, halfZ: 1 });
  approx(polygonArea(clipConvex(a, b)), 2);
});

test("clipConvex of a 45-degree square against an axis-aligned one", () => {
  const box = orientedCorners({ cx: 0, cz: 0, halfX: 1, halfZ: 1 });
  const diamond = orientedCorners({ cx: 0, cz: 0, halfX: 1, halfZ: 1, yaw: Math.PI / 4 });
  // Two 2x2 squares at 45 degrees overlap in a regular octagon: 8(sqrt(2) - 1).
  // The closed form matters more than the number — it is the case a sampled grid
  // gets wrong and an exact clip gets right.
  approx(intersectionArea(box, diamond), 8 * (Math.SQRT2 - 1));
});

test("coveredFraction sums a tiled run and clamps an overlap", () => {
  const blocker = { rect: { minX: 0, maxX: 10, minZ: 0, maxZ: 1 } };
  const tiles = [
    { pos: [2.5, 0, 0.5], size: [5, 1, 1], yaw: 0 },
    { pos: [7.5, 0, 0.5], size: [5, 1, 1], yaw: 0 },
  ].map(placementFootprint);
  approx(coveredFraction(partFootprint(blocker), tiles), 1);
  const doubled = [...tiles, ...tiles];
  approx(coveredFraction(partFootprint(blocker), doubled), 1);
});

test("coveredFraction reads a transposed module box as the quarter it is", () => {
  const blocker = { rect: { minX: -0.5, maxX: 0.5, minZ: -2, maxZ: 2 } };
  const turned = { pos: [0, 0, 0], size: [4, 1, 1], yaw: Math.PI / 2 };
  approx(coveredFraction(partFootprint(blocker), [placementFootprint(turned)]), 1);
  approx(
    coveredFraction(partFootprint(blocker), [placementFootprint({ ...turned, yaw: 0 })]),
    0.25,
  );
});

test("convexHull wraps a tiled run into one envelope", () => {
  const hull = convexHull([
    [0, 0], [5, 0], [5, 1], [0, 1],
    [5, 0], [10, 0], [10, 1], [5, 1],
  ]);
  approx(polygonArea(hull), 10);
});

test("reachBeyond is zero inside and the overrun outside", () => {
  const box = [placementFootprint({ pos: [0, 0, 0], size: [4, 1, 2], yaw: 0 })];
  approx(reachBeyond(partFootprint({ rect: { minX: -1, maxX: 1, minZ: -0.5, maxZ: 0.5 } }), box), 0);
  approx(
    reachBeyond(partFootprint({ rect: { minX: -1, maxX: 2.7, minZ: -0.5, maxZ: 0.5 } }), box),
    0.7,
  );
});

test("reachBeyond measures a tiled run against the whole run, not one tile", () => {
  // The defect this replaces: taken per tile, the second module of a wall
  // reported the whole first half of the wall as an overrun, which is how a tie
  // beam 40% outside its box came to be described as reaching 14.55m past it.
  const blocker = { rect: { minX: 0, maxX: 20, minZ: 0, maxZ: 1 } };
  const tiles = [
    { pos: [4.75, 0, 0.5], size: [9.5, 1, 1], yaw: 0 },
    { pos: [14.25, 0, 0.5], size: [9.5, 1, 1], yaw: 0 },
  ].map(placementFootprint);
  approx(reachBeyond(partFootprint(blocker), tiles), 1);
});

// ---- sampling ---------------------------------------------------------------

test("footprintSamples covers a rect and follows a yaw", () => {
  const flat = footprintSamples({ rect: { minX: 0, maxX: 2, minZ: 0, maxZ: 1 } }, 4);
  assert.equal(flat.length, 16);
  assert.ok(flat.every(([x, z]) => x > 0 && x < 2 && z > 0 && z < 1));

  const turned = footprintSamples(
    { rect: { minX: -2, maxX: 2, minZ: -0.5, maxZ: 0.5 }, yaw: Math.PI / 2 },
    5,
  );
  const spanZ = Math.max(...turned.map((p) => p[1])) - Math.min(...turned.map((p) => p[1]));
  assert.ok(spanZ > 3, `a quarter-turned 4m blocker samples along Z, got ${spanZ.toFixed(2)}m`);
});

test("footprintSamples drops the corners of a round footprint", () => {
  const round = footprintSamples(
    { rect: { minX: -0.9, maxX: 0.9, minZ: -0.9, maxZ: 0.9 }, round: { radius: 0.9 } },
    21,
  );
  assert.ok(round.length < 441 && round.length > 300, `got ${round.length} samples`);
  assert.ok(round.every(([x, z]) => Math.hypot(x, z) <= 0.9 + 1e-9));
});

// ---- policy -----------------------------------------------------------------

test("supportPlane asks about the top of a mass the route stands on", () => {
  assert.equal(supportPlane({ kind: "MASS", baseY: 12.4, topY: 13.45 }, true), 13.45);
  assert.equal(supportPlane({ kind: "MASS", baseY: 12.4, topY: 13.45 }, false), 12.4);
  assert.equal(supportPlane({ kind: "DECK", baseY: 5.2, topY: 5.2 }, true), 5.2);
});

test("supportsFrom refuses a draw as its own support at its own base", () => {
  const own = { parts: ["CHIMNEY_1"], pos: [68.15, 12.4, 6.15] };
  assert.equal(supportsFrom(own, "CHIMNEY_1", 12.4), false);
  assert.equal(supportsFrom(own, "CHIMNEY_1", 13.45), true);
  assert.equal(supportsFrom({ parts: ["ROOF"], pos: [68, 12.4, 6] }, "CHIMNEY_1", 12.4), true);
});

// ---- the instrument invariants ---------------------------------------------

const rows = runSelfTests({ THREE });

test("every instrument invariant holds", () => {
  const broken = rows.filter((row) => !row.ok);
  assert.deepEqual(
    broken.map((row) => `${row.name}: ${row.detail}`),
    [],
  );
  assert.ok(rows.length >= 10, `expected the full invariant set, got ${rows.length}`);
});

for (const row of rows) {
  test(`invariant (catches defect ${row.catches}): ${row.name}`, () => {
    assert.ok(row.ok, row.detail);
  });
}
