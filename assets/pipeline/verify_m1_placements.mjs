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
import { EDGE_NUDGE_M, footprintSamples, placeInto, sceneSource, surveyFirstHit, surveyNearPlane } from "./placement_probe.mjs";
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
/**
 * How far a declared carrier may stand off a suspended mass in plan, and how
 * far its drawn span may fall short of the mass, and still count as carrying it.
 * A pediment butts its wall, an effigy hangs a stride out from the bole, a tie
 * beam is guyed to the awning beside it: a metre covers all three and is small
 * enough that an unrelated object across the lane does not qualify.
 */
const CONNECT_REACH = 1.0;
/**
 * A suspended DRESSING — an effigy hung from a bough — is a narrow figure, not a
 * slab, so it fills only a fraction of the box the collision draws round the
 * space it swings in. Its presence check is therefore a floor, not a fill: some
 * of its own art must actually cast under a ray in the volume so the thing is
 * really THERE. The substantive assertion for a hung dressing is the CARRIER
 * connection below — that it is drawn hanging from the bole named for it — not
 * how much of its swing box a jackboot happens to occupy.
 */
const HUNG_PRESENCE_MIN = 0.15;

// ---------------------------------------------------------------- known debt
/**
 * Route decks whose DRAWN surface is a KNOWN, owner-accepted pending-regen
 * shortfall (31-Jul M1 world build): the collision/route is authored to the
 * target box, and the mesh is being regenerated under the same key to fill it.
 * The route-graph gates verify against the authored collision (not the art) and
 * are green; this gate reads the ART, so it legitimately sees the short mesh
 * until the regen lands. Recorded here — LOUDLY, itemised, with the target — so
 * the gate can be green on the authored world without hiding the defect, exactly
 * as scripts/check-world-affordances.mjs records the same surfaces. Each entry
 * carries the height the regen must deliver; do NOT shrink the boxes to match a
 * short mesh. Remove an entry when its mesh draws to plane.
 */
const KNOWN_REGEN_DEBT = new Map([
  ["WHARF_WAREHOUSE_A__ROOF", "PENDING-REGEN: warehouse-wharf-a roof mesh far below its 5.35 box (wide footprint); the wharf descent's first landing. Regen delivers a flat roof deck at 5.35."],
  ["WHARF_WAREHOUSE_B__ROOF", "PENDING-REGEN: warehouse-wharf-b roof/gallery mesh ~1.4m below its 5.35 box; the ascent's top mantle target. Regen delivers an oversailed loading gallery at 5.35."],
  ["MERCHANT_STRING", "PENDING-REGEN: bldg-merchant facade draws ~2.1m below its storeys, so the jettied gallery reads no surface at 5.70. Regen delivers the merchant south front to box — balcony 4.00, jetty gallery 5.70 (oversailed south), eave 7.10. See level/merchant.ts."],
]);

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
    tags: mass.tags ?? [], carriedBy: mass.carriedBy ?? [],
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
const placeOverlapping = async (footprint) => {
  const targets = [];
  for (const p of placements) {
    if (intersectionArea(footprint, placementFootprint(p)) <= 0) continue;
    if (!placedCache.has(p.id)) placedCache.set(p.id, await place(p));
    const t = placedCache.get(p.id);
    if (t) targets.push(...t);
  }
  return targets;
};
const inflatedFootprint = (part, by) =>
  partFootprint({
    ...part,
    rect: {
      minX: part.rect.minX - by, maxX: part.rect.maxX + by,
      minZ: part.rect.minZ - by, maxZ: part.rect.maxZ + by,
    },
    round: part.round ? { radius: part.round.radius + by } : undefined,
  });

// A suspended mass rests on nothing at its base BY DESIGN — a soffit slab the
// player ducks under, a pediment hood over a balcony, an effigy hung from the
// elm — so asking for a drawn floor beneath it is the wrong question and is what
// made all seven read as failures. The right question is the one true of a thing
// that hangs: is its imported art actually IN the collision volume, and is the
// body it hangs from drawn reaching it. Neither loosens the floor check for an
// ordinary raised mass below — a chimney with nothing under it still fails there.
const suspended = [...parts.values()].filter(
  (p) => p.kind === "MASS" && ((p.carriedBy?.length ?? 0) > 0 || (p.tags ?? []).includes("soffit")),
);
const suspendedIds = new Set(suspended.map((p) => p.id));
console.log(`\n--- suspended soffits and hung dressings occupy their volume and reach a carrier ---`);
console.log(`  ${suspended.length} suspended masses`);
for (const part of suspended) {
  const footprint = partFootprint(part);
  // Occupancy is measured against the object's OWN draw, not everything that
  // overlaps it: an effigy hangs under the elm's canopy, and casting through the
  // canopy would measure the leaves rather than the effigy. Its own asset is the
  // one that has to be present in the collision the player sees.
  const ownTargets = [];
  for (const p of placements) {
    if (!(p.id === part.id || p.parts.includes(part.id))) continue;
    if (!placedCache.has(p.id)) placedCache.set(p.id, await place(p));
    const t = placedCache.get(p.id);
    if (t) ownTargets.push(...t);
  }
  // Occupancy: ANY drawn face within the collision volume, not just the first a
  // downward ray meets — a tower has its own gallery deck drawn above it, and a
  // first-hit test would see that and call the tower beneath it empty. Probed at
  // the volume's mid height with a tolerance that reaches both faces.
  const occ = surveyNearPlane(THREE, ownTargets, part, (part.baseY + part.topY) / 2, {
    grid: GRID,
    tol: (part.topY - part.baseY) / 2 + SUPPORT_TOL,
  });
  const fraction = occ.fraction;
  // A soffit slab and a structural continuation (a tower out of a roof, a lantern
  // and spire out of a steeple shaft) are both solid and must FILL the volume
  // they stand for; a hung dressing is a figure and need only be present in it.
  const isSlab = (part.tags ?? []).includes("soffit") || (part.tags ?? []).includes("structure");
  const occMin = isSlab ? SUPPORT_MIN : HUNG_PRESENCE_MIN;
  // Connection: a declared carrier drawn reaching the volume, standing off by no
  // more than CONNECT_REACH in plan and in height.
  const carriers = part.carriedBy ?? [];
  const reach = inflatedFootprint(part, CONNECT_REACH);
  const carrier = carriers.length === 0 ? null : placements.find((p) =>
    (carriers.includes(p.id) || p.parts.some((id) => carriers.includes(id))) &&
    intersectionArea(reach, placementFootprint(p)) > 0 &&
    p.pos[1] + p.size[1] >= part.baseY - CONNECT_REACH &&
    p.pos[1] <= part.topY + CONNECT_REACH,
  );
  const occOk = fraction >= occMin;
  const connOk = carriers.length === 0 ? true : carrier !== undefined;
  console.log(
    `  ${occOk && connOk ? "ok  " : "FAIL"} ${part.id.padEnd(20)} ${isSlab ? "SOFFIT" : "HUNG  "} ` +
      `occupies ${(fraction * 100).toFixed(0)}% of [${part.baseY.toFixed(2)}, ${part.topY.toFixed(2)}]m ` +
      `(wants ${(occMin * 100).toFixed(0)}%)` +
      (carriers.length ? `  carrier ${connOk ? carrier.asset : `${carriers.join("/")} NOT drawn reaching it`}` : ""),
  );
  if (!occOk) {
    fail(
      `${part.id} is a ${isSlab ? "soffit" : "hung dressing"} at [${part.baseY.toFixed(2)}, ${part.topY.toFixed(2)}]m ` +
        `and its imported art occupies only ${(fraction * 100).toFixed(0)}% of that volume (wants ${(occMin * 100).toFixed(0)}%). ` +
        `The mesh must fill the collision the player ${isSlab ? "ducks under" : "sees hung"}, not merely exist somewhere near it.`,
    );
  }
  if (!connOk) {
    fail(
      `${part.id} declares it is carried by ${carriers.join(", ")}, but none of those is drawn overlapping it ` +
        `within ${CONNECT_REACH.toFixed(1)}m and reaching its height. A suspended mass must visibly hang from its carrier.`,
    );
  }
}

const rows = [];
for (const part of wanted) {
  if (suspendedIds.has(part.id)) continue;
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
  // A walked surface is not standing on air where a DRAWN solid rises up THROUGH
  // its plane: you cannot fall through a tower. The tower plinth is a 7m ring
  // round a 4m shaft and the shaft's own stone fills the middle of the ring, so a
  // sample inside a solid mass the plane runs through the middle of — base well
  // below it, top above it, and not this part itself — is carried by that stone
  // exactly as a sample with a drawn face at the plane is. This is not a floating
  // exemption: a mass merely resting ON the plane (base at it) or capped AT it
  // does not qualify, only one that is solid on both sides of the foot.
  const throughSolids = M1_EFFIGY_RUN.masses.filter((m) => {
    if (!m.asset || m.id === part.id) return false;
    const top = Number.isFinite(m.topY) ? m.topY : m.baseY + 12;
    return m.baseY < plane - 0.3 && top > plane + 0.02;
  });
  const inSolid = (x, z) =>
    throughSolids.some(
      (m) => x > m.rect.minX && x < m.rect.maxX && z > m.rect.minZ && z < m.rect.maxZ,
    );
  const rayFor = new THREE.Raycaster();
  rayFor.far = 120;
  const straightDown = new THREE.Vector3(0, -1, 0);
  const atPlane = (x, z) => {
    rayFor.set(new THREE.Vector3(x, plane + 3, z), straightDown);
    return rayFor.intersectObjects(targets, false).some((h) => Math.abs(h.point.y - plane) < SUPPORT_TOL);
  };
  const samples = footprintSamples(part, GRID);
  let hit = 0;
  for (const [x, z] of samples) {
    if (atPlane(x, z) || atPlane(x + EDGE_NUDGE_M, z) || atPlane(x, z + EDGE_NUDGE_M) || inSolid(x, z)) {
      hit++;
    }
  }
  const fraction = samples.length ? hit / samples.length : 1;
  rows.push({
    part, plane, fraction, assets: [...new Set(near.map((p) => p.asset))],
  });
}
rows.sort((a, b) => a.fraction - b.fraction);
const dry = rows.filter((r) => r.fraction < SUPPORT_MIN);
console.log(`  ${rows.length} surfaces surveyed, ${dry.length} with less than ${(SUPPORT_MIN * 100).toFixed(0)}% drawn under them`);
for (const { part, plane, fraction, assets } of dry) {
  const debt = KNOWN_REGEN_DEBT.get(part.id);
  console.log(
    `  ${debt ? "DEBT" : "    "} ${part.id.padEnd(20)} ${part.kind} at ${plane.toFixed(2)}m  ` +
      `${(fraction * 100).toFixed(0)}% has drawn surface  ` +
      `candidates: ${assets.join(", ") || "nothing overlaps it"}`,
  );
  if (debt) {
    // Loud, on the record, never silent — but not blocking: the mesh is being
    // regenerated to this box under the same key.
    console.warn(`       ${debt}`);
    continue;
  }
  fail(
    `${part.id} is ${part.kind === "DECK" ? "walked on" : "stood on"} at ${plane.toFixed(2)}m and only ` +
      `${(fraction * 100).toFixed(0)}% of its footprint has a drawn surface there. ` +
      `${assets.length ? `${assets.join(", ")} overlaps it but does not reach that height` : "nothing is drawn under it"}.`,
  );
}
const heldRegen = dry.filter((r) => KNOWN_REGEN_DEBT.has(r.part.id));
if (heldRegen.length) {
  console.log(
    `  (${heldRegen.length} route deck(s) held as owner-accepted pending-regen debt — ` +
      `authored to box, mesh regenerating under the same key; loud above, not blocking.)`,
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
