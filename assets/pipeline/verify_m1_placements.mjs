// Is every drawn object the shape of the collision it stands for, and is it over it?
//
// The pipeline has always asked the first half of this and never the second, and
// three separate defects hid in the gap.
//
//   the FIT check       does the mesh fill the box it is drawn into?
//                       `verify_m1_steeple.mjs` and `verify_m1_townhouse.mjs` ask
//                       this per axis, and it catches a stale or mis-scaled mesh.
//   the PLACEMENT check is the box the asset's shape, and is there anything under
//                       it? Nothing asked this. `roof-chimney-stack` fits all four
//                       of its boxes at scale 1.0000 with no shortfall on any axis
//                       and the asset is exactly right — and two of the four float
//                       3.1m over the roof they are supposed to sit on.
//
// Everything below is measured against the MESH, never against `sizeM`. The
// declaration is what the level believes the asset is and it can be stale: this is
// how `service-wall-end` came to be declared 0.6 x 3.4 x 1.2 against a mesh that
// is 1.0 deep, which made the one arcade bay authored at 1.2m look correct and the
// five correct ones look short. A declaration that disagrees with its own mesh is
// reported in its own right.
//
// Four questions, and the failures are different in kind:
//   SQUASHED     a PROP whose box is not the mesh's shape. A contain-fit takes the
//                smallest of three ratios, so the other two axes come out short by
//                exactly the amount the aspect disagrees. HOLLIS_BUTTRESS asks a
//                0.6m arcade pier to be a 2.4m buttress and gets 0.46m of it.
//   UNREACHED    a SHELL or MODULE — which are scaled ONTO their box rather than
//                inside it — with collision outside that box. An oversail there is
//                structurally undrawable, not merely undrawn.
//   UNSUPPORTED  a raised mass or a walked deck with no DRAWN surface at its plane.
//                This is the one that needs rays: the collision can say a flat
//                leads deck at 12.4m while the mesh under it is a pitched roof
//                whose ridge only touches 12.24m.
//   MISDECLARED  sizeM against the mesh's own bounding box.
//
// YAW IS PART OF THE FOOTPRINT
// ---------------------------
// Section 2 used to build a placement's world box from `size[0]` and `size[2]` and
// ignore `yaw`. That is not a rounding error, it is a transposition: a module run
// emits its tile as `[tileLength, height, tileDepth]` — its OWN length first — and
// then turns a quarter to put that length along the run, so every module laid
// along Z was measured against its own cross-section. ALLEY_LEANTO was reported
// 95.9% inside a box it is entirely inside; the stall canopies read 85.4% when
// they are 91.5%.
//
// The fix is not to strip yaw out but to model it, because yaw is load-bearing
// here: `compile.ts` turns a yawed mass into an `obb` footprint with the rect's
// own half extents, so yaw rotates the collision and the art together. Both sides
// are now oriented rectangles and the overlap between them is clipped exactly —
// see `placement_lib.mjs`, whose fixtures state the round trip as an invariant.
// The same file holds the contain-fit, shared with `verify_roofline_kit.mjs`,
// because two copies of one instrument's scale is how the two drifted apart.
//
// Run: node --import tsx assets/pipeline/verify_m1_placements.mjs [asset-key ...]
globalThis.self = globalThis;
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  containFitScale,
  coveredFraction,
  intersectionArea,
  partFootprint,
  placementFootprint,
  reachBeyond,
  supportPlane,
  supportsFrom,
} from "./placement_lib.mjs";
import { placeInto, sceneSource, surveyNearPlane } from "./placement_probe.mjs";
import { selfTestGate } from "./placement_selftest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const threeRoot = join(repoRoot, "apps", "web", "node_modules", "three");
const THREE = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);
const load = (...parts) => import(pathToFileURL(join(repoRoot, ...parts)));
const { M1_EFFIGY_RUN } = await load("packages", "mission-m1", "src", "level", "index.ts");
const { ASSETS } = await load("packages", "mission-m1", "src", "assets.ts");
const { sceneryPlacements } = await load("packages", "mission-m1", "src", "runtime.ts");

const argv = process.argv.slice(2);
const only = argv.filter((a) => !a.startsWith("--"));
const showSelfTest = argv.includes("--self-test") || argv.includes("--self-test-only");

// The instrument proves itself before it measures anything, and stops here if it
// cannot. Four defects in these tools have all been wrong numbers rather than
// errors, so a run that cannot demonstrate its own arithmetic reports nothing.
if (!selfTestGate({ THREE, label: "m1 placements", verbose: showSelfTest })) {
  process.exit(1);
}
if (argv.includes("--self-test-only")) process.exit(0);

/**
 * How short a contain-fit may draw an axis before the box is the wrong shape.
 *
 * Not zero, and not tight. A collision rect is a deliberate simplification of a
 * prop — a barrel in a square box legitimately leaves the corners empty — so this
 * is only ever asking whether the box and the mesh are the same KIND of shape.
 * Half is generous and still catches every real case: the worst here is 19%.
 */
const SQUASH_MIN = 0.5;
/** A drawn surface this far from a plane still carries it: the reader's step-down. */
const SUPPORT_TOL = 0.35;
/** Fraction of a walked surface that must have drawn stone under it. */
const SUPPORT_MIN = 0.9;
/** A part this far inside the box drawn for it is inside it. */
const REACH_MIN = 0.995;
const GRID = 5;

let failures = 0;
const fail = (message) => {
  console.error(`FAIL ${message}`);
  failures++;
  process.exitCode = 1;
};

// Only surfaces the route actually uses are gated. A squashed cover barrel is
// cosmetic and belongs in a report; a squashed buttress the route climbs, or a
// roof the route runs along, is a defect that ends a run.
const routeSurfaces = new Set(M1_EFFIGY_RUN.nodes.map((n) => n.surface));

// `yaw` and `round` come along because they are the footprint: `compile.ts`
// compiles a yawed mass to an oriented box and a round one to a capsule, so a
// checker that carries only the rect is checking a shape the mover never sees.
const parts = new Map();
for (const mass of M1_EFFIGY_RUN.masses) {
  parts.set(mass.id, {
    id: mass.id, kind: "MASS", rect: mass.rect, baseY: mass.baseY,
    topY: Number.isFinite(mass.topY) ? mass.topY : mass.baseY + 12,
    yaw: mass.yaw ?? 0, round: mass.round,
  });
}
for (const deck of M1_EFFIGY_RUN.decks) {
  parts.set(deck.id, {
    id: deck.id, kind: "DECK", rect: deck.rect, baseY: deck.y, topY: deck.y, yaw: 0,
  });
}

// ---- meshes -----------------------------------------------------------------

const sourceCache = new Map();
/** The bytes read once, the natural size measured once, a fresh scene per draw. */
async function meshOf(assetPath) {
  if (sourceCache.has(assetPath)) return sourceCache.get(assetPath);
  const file = join(repoRoot, "apps", "web", "public", "world", assetPath.replace(/^world\//, ""));
  let value = null;
  if (existsSync(file)) {
    try {
      value = await sceneSource(THREE, GLTFLoader, readFileSync(file));
    } catch (error) {
      value = { error: String(error).slice(0, 80) };
    }
  }
  sourceCache.set(assetPath, value);
  return value;
}

/** A fresh copy of an asset, placed exactly as `M1Scenery` places it. */
async function place(placement) {
  const source = await meshOf(placement.assetPath);
  if (!source || source.error) return null;
  return placeInto(THREE, await source.next(), placement, source.natural).targets;
}

const placements = sceneryPlacements().filter((p) => !only.length || only.includes(p.asset));
console.log(`=== placements: the asset's shape, over the collision, on something drawn ===`);
console.log(`${placements.length} draws across ${new Set(placements.map((p) => p.asset)).size} assets`);

// ---- 1. boxes that are not the mesh's shape ---------------------------------
// Measured in the object's OWN frame, because that is where the fit happens:
// `M1Scenery` puts the mesh inside a group and turns the GROUP by yaw, so the
// contain-fit never sees a rotation. This section used to transpose the mesh for
// any placement past 30 degrees of yaw, which measured a fit nothing performs.
// No prop in M1 is yawed today, so that transpose reported nothing wrong — it was
// a wrong answer waiting for the first yawed prop.

console.log(`\n--- boxes that are not the shape of the mesh they draw ---`);
const squashed = [];
for (const placement of placements) {
  if (placement.fit !== "PROP") continue;
  const source = await meshOf(placement.assetPath);
  if (!source || source.error) continue;
  const mesh = source.natural;
  const scale = containFitScale(mesh, placement.size);
  const drawn = mesh.map((v) => v * scale);
  const fractions = drawn.map((v, i) => v / placement.size[i]);
  const worst = Math.min(...fractions);
  const gated = placement.parts.some((id) => routeSurfaces.has(id));
  squashed.push({ placement, mesh, drawn, worst, fractions, gated });
}
squashed.sort((a, b) => a.worst - b.worst);
const badShape = squashed.filter((r) => r.worst < SQUASH_MIN);
if (!badShape.length) console.log(`  none below ${(SQUASH_MIN * 100).toFixed(0)}% on any axis`);
for (const row of badShape) {
  const { placement, mesh, drawn, worst, fractions, gated } = row;
  const axes = ["x", "y", "z"];
  console.log(
    `  ${gated ? "ROUTE" : "     "} ${placement.id.padEnd(20)} ${placement.asset.padEnd(24)} ` +
      `box ${placement.size.map((v) => v.toFixed(2)).join(" x ")}  mesh ` +
      `${mesh.map((v) => v.toFixed(2)).join(" x ")}  -> draws ` +
      `${drawn.map((v) => v.toFixed(2)).join(" x ")}  worst ${(worst * 100).toFixed(0)}%`,
  );
  if (!gated) continue;
  const short = axes
    .map((name, i) => ({ name, drawn: drawn[i], box: placement.size[i], f: fractions[i] }))
    .filter((a) => a.f < 0.98);
  fail(
    `${placement.id} asks ${placement.asset} to be a different object: its box is ` +
      `${placement.size.map((v) => v.toFixed(2)).join("x")} against a mesh of ` +
      `${mesh.map((v) => v.toFixed(2)).join("x")}, so the contain-fit draws ` +
      short.map((a) => `${a.drawn.toFixed(2)}m of ${a.box.toFixed(2)}m on ${a.name}`).join(" and ") +
      `, and the route stands on it. Give it its own key or rebuild the asset; no ` +
      `placement can fix an aspect.`,
  );
}

// ---- 2. collision outside a box that fills itself ---------------------------
// Both footprints are oriented rectangles in the world and the overlap between
// them is clipped exactly, so a box that fits its part reads 100.0% rather than
// almost. The overrun is measured against the envelope of ALL the boxes drawn for
// a part rather than per tile: per tile, the second module of a wall reported the
// whole first half of the wall as an oversail, which is how the ropewalk tie beam
// came to be described as reaching 14.55m past a box it is 40% outside of.

console.log(`\n--- collision reaching outside a shell or module box ---`);
const reach = new Map();
for (const placement of placements) {
  if (placement.fit === "PROP") continue;
  const box = placementFootprint(placement);
  for (const id of placement.parts) {
    const part = parts.get(id);
    if (!part) continue;
    const prior = reach.get(id) ?? {
      part, boxes: [], asset: placement.asset, fit: placement.fit,
    };
    // A module run lays several tiles along one blocker, so coverage accumulates.
    prior.boxes.push(box);
    reach.set(id, prior);
  }
}
const unreached = [...reach.values()]
  .map((r) => {
    const footprint = partFootprint(r.part);
    return {
      ...r,
      fraction: coveredFraction(footprint, r.boxes),
      out: reachBeyond(footprint, r.boxes),
    };
  })
  .filter((r) => r.fraction < REACH_MIN)
  .sort((a, b) => a.fraction - b.fraction);
if (!unreached.length) console.log(`  none: every part sits inside the box drawn for it`);
for (const row of unreached) {
  const gated = routeSurfaces.has(row.part.id);
  console.log(
    `  ${gated ? "ROUTE" : "     "} ${row.part.id.padEnd(20)} ${row.part.kind} ` +
      `${(row.fraction * 100).toFixed(1)}% inside the ${row.asset} ${row.fit} box ` +
      `(reaches ${row.out.toFixed(2)}m past it)`,
  );
  if (!gated) continue;
  fail(
    `${row.part.id} lies ${((1 - row.fraction) * 100).toFixed(1)}% outside the ${row.fit} box drawn ` +
      `for it, by up to ${row.out.toFixed(2)}m, and the route stands on it. A ${row.fit.toLowerCase()} ` +
      `is scaled onto its box exactly, so an oversail cannot be drawn at all: bring the part inside ` +
      `the box or widen the box to carry it.`,
  );
}

// ---- 3. is anything actually drawn under it? --------------------------------
// The question the chimneys needed. Rays, because nothing cheaper can tell a flat
// collision deck from the pitched roof drawn beneath it.

console.log(`\n--- drawn surface under what the route stands on, and under every raised mass ---`);
const wanted = [...parts.values()].filter(
  (p) => routeSurfaces.has(p.id) || (p.kind === "MASS" && p.baseY > 0.01),
);
const placedCache = new Map();
const rows = [];
for (const part of wanted) {
  // Two different questions, and they are asked at two different heights. Where
  // the route stands ON a mass, the surface that matters is its TOP — probing its
  // base asks whether a hay wain rests on the ground, which is not in doubt.
  // Where a mass is merely raised, the question is its base. See `supportPlane`.
  const onRoute = routeSurfaces.has(part.id);
  const plane = supportPlane(part, onRoute);
  if (part.kind === "MASS" && !onRoute && part.baseY <= 0.01) continue;
  const footprint = partFootprint(part);
  const near = placements.filter((p) => {
    // A cluster draws several parts and one routinely carries another — the
    // steeple's gallery carries its own lantern, the elm's bough carries the
    // effigy hung on it — so a sibling's geometry counts. What cannot count is the
    // object's own draw standing at the very plane being asked about: a chimney is
    // not what holds a chimney up, and letting it count passed both floating ones.
    if (!supportsFrom(p, part.id, plane)) return false;
    // Overlap in plan, both sides oriented, so a quarter-turned module is looked
    // for where it is drawn rather than across its own cross-section.
    if (intersectionArea(footprint, placementFootprint(p)) <= 0) return false;
    return p.pos[1] <= plane + 0.02 && p.pos[1] + p.size[1] >= plane - SUPPORT_TOL - 0.02;
  });
  const targets = [];
  for (const p of near) {
    if (!placedCache.has(p.id)) placedCache.set(p.id, await place(p));
    const t = placedCache.get(p.id);
    if (t) targets.push(...t);
  }
  const survey = surveyNearPlane(THREE, targets, part, plane, { grid: GRID, tol: SUPPORT_TOL });
  rows.push({
    part, plane, fraction: survey.fraction, assets: [...new Set(near.map((p) => p.asset))],
  });
}
rows.sort((a, b) => a.fraction - b.fraction);
const dry = rows.filter((r) => r.fraction < SUPPORT_MIN);
console.log(`  ${rows.length} surfaces surveyed, ${dry.length} with less than ${(SUPPORT_MIN * 100).toFixed(0)}% drawn under them`);
for (const { part, plane, fraction, assets } of dry) {
  console.log(
    `  ${part.id.padEnd(20)} ${part.kind} at ${plane.toFixed(2)}m  ` +
      `${(fraction * 100).toFixed(0)}% has drawn surface  ` +
      `candidates: ${assets.join(", ") || "nothing overlaps it"}`,
  );
  fail(
    `${part.id} is ${part.kind === "DECK" ? "walked on" : "stood on"} at ${plane.toFixed(2)}m and only ` +
      `${(fraction * 100).toFixed(0)}% of its footprint has a drawn surface there. ` +
      `${assets.length ? `${assets.join(", ")} overlaps it but does not reach that height` : "nothing is drawn under it"}.`,
  );
}

// ---- 4. declarations that disagree with their own mesh ----------------------

console.log(`\n--- sizeM against the mesh it declares ---`);
let misdeclared = 0;
for (const asset of ASSETS) {
  if (asset.status !== "EXISTING") continue;
  if (only.length && !only.includes(asset.key)) continue;
  const source = await meshOf(asset.path);
  if (!source || source.error) continue;
  const n = source.natural;
  const off = n.map((value, axis) => Math.abs(value - asset.sizeM[axis]));
  if (Math.max(...off) <= 0.05) continue;
  misdeclared++;
  console.log(
    `  ${asset.key.padEnd(26)} declared ${asset.sizeM.map((v) => v.toFixed(2)).join(" x ")}  ` +
      `mesh ${n.map((v) => v.toFixed(2)).join(" x ")}`,
  );
}
if (!misdeclared) console.log(`  none: every declaration matches its mesh`);
else {
  console.log(
    `  ${misdeclared} declarations disagree with their mesh. Every box above is judged on the\n` +
      `  mesh, so this is not double-counted — but a stale sizeM is what makes a correct\n` +
      `  placement look wrong and a wrong one look correct.`,
  );
}

console.log(
  failures
    ? `\nPLACEMENTS FAILED (${failures} problem${failures === 1 ? "" : "s"})`
    : `\nPLACEMENTS OK: every surface the route uses is its asset's shape and has stone under it`,
);
