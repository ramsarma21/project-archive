// Does the delivered geometry actually PRESENT the surfaces the level's
// traversal was authored against?
//
// WHY THIS EXISTS. Every traversability guard in this repo runs against the
// authored collision hulls — hand-written literal coordinates in level/*.ts,
// planes invented by `compile.ts` and `authoring.ts` — and the runtime moves
// the same hulls. `assets.ts` states the philosophy outright: "the art moves to
// meet the collision, never the reverse." So the invariants report zero
// penetrations because they and the mover both run on the authored planes,
// while the player sees the imported meshes. Nothing in the tree can answer the
// only question that matters for a landing: *does the delivered Town House GLB,
// placed exactly as the game places it, actually have standable stone at 12.4m
// over (52, 4.6)?* A bounding-box gate (check-world-scale.mjs) cannot — an
// interior ledge, a roof that stops short, a cornice that draws below its plane
// are all invisible to an AABB. This is the missing instrument.
//
// WHAT IT DOES. For every authored standable affordance on the M1 route —
// roof/deck planes, landable prop tops (vault and cover surfaces), the arrival
// surfaces of the authored climbs, and the leap-of-faith catch targets — it:
//
//   1. loads the ACTUAL published GLB the game loads, and extracts its real
//      triangles using the same three.js-cross-checked decode that
//      check-world-scale.mjs uses (imported, not re-copied — a second copy of
//      the skinning/accessor/matrix maths is exactly the confident-false-report
//      risk that file's header warns about);
//   2. places those triangles with the SAME fit + placement transform the
//      runtime uses. It does not reimplement the placement — it calls the
//      level's own `sceneryPlacements()` for pos/size/yaw/fit, then reproduces
//      `InstancedProps.instanceMatrix` / `FittedGlb` / `ImportedStructure`
//      operation-for-operation (contain-fit for a PROP, per-axis fill for a
//      MODULE, per-axis + auto quarter-turn for a SHELL);
//   3. SECTIONS the real geometry — a downward ray-cast (point-in-triangle in
//      XZ, barycentric-interpolated height) at a grid of sample points across
//      the affordance's own authored footprint — and reports the mesh surface
//      height actually found there versus the authored plane, the fraction of
//      the footprint that has a standable (roughly horizontal) surface at the
//      plane, and whether there is simply NOTHING under the authored surface.
//
// HOW WE KNOW A REPORTED SURFACE IS REAL. Three independent checks, because this
// is the instrument everything else will rest on:
//   * `--selftest` builds synthetic box GLBs of known dimensions, places them
//     into known boxes, and asserts the ray-cast finds the top face at the
//     height geometry puts it — and that a mesh built 2m short reports a 2m
//     shortfall rather than a pass. If the sampler measured the wrong thing,
//     the selftest fails by construction.
//   * `--verify-fit` prints, for a placement, the placed bounding box next to
//     the authored `size`/`pos`, so the transform can be eyeballed against the
//     numbers assets.ts declares (a contain-fit lands one axis on the box and
//     the rest inside; a fill lands all three).
//   * a surface only counts if a roughly horizontal triangle is actually hit at
//     that (x,z): coverage is the fraction of the footprint with real geometry
//     underfoot, so a lucky single sample cannot carry an affordance.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not modify or score assets, it does
// not re-author a failing plane down to a deficient mesh, and it is NOT wired
// into the gate — it is expected to be red across much of M1 (the prior pass
// predicted this), and a red blocking gate would break the build for everyone.
// Run it, read the red list, decide the fix. See the footer for what wiring it
// in would take.
//
// Usage:
//   node --import tsx scripts/check-world-affordances.mjs            # the red list
//   node --import tsx scripts/check-world-affordances.mjs --selftest # prove the instrument
//   node --import tsx scripts/check-world-affordances.mjs --json     # machine-readable
//   node --import tsx scripts/check-world-affordances.mjs --all-nodes # include route-node cross-checks
//   node --import tsx scripts/check-world-affordances.mjs --verify-fit=TOWNHOUSE

import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  glbDocument,
  readAccessor,
  worldMatrices,
  transformPoint,
} from "./check-world-scale.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHED = join(ROOT, "apps", "web", "public", "world");

// ---------------------------------------------------------------- thresholds
// Fixed up front and JUSTIFIED, never tuned until the list turns green — tuning
// tolerances to pass would recreate the exact false-green the whole exercise is
// eliminating.

// A surface you can stand on without sliding off it. cos(45deg): a triangle
// whose normal is within 45 degrees of straight up. Roof leads, gallery decks
// and cart tops are near-flat; a 45-degree gambrel face is not somewhere the
// mover lands a walk.
const HORIZONTAL_NORMAL_Y = Math.cos((45 * Math.PI) / 180);

// Within this of the authored plane counts as "the surface is AT the plane".
// A third of a metre: tighter than the mover's own step tolerance, so a hit
// inside it is genuinely the authored surface and not a step away from it.
const ALIGN_BAND_M = 0.35;

// How far BELOW the plane to keep looking for any horizontal surface at all, to
// tell "the art is here but too low" apart from "there is nothing under this
// point". Deep enough to catch a roof that drew a whole storey short.
const DEEP_SEARCH_BELOW_M = 9;

// Art may overshoot the plane slightly (a board's own thickness); look a little
// above it so an overshoot reads as a small positive delta, not a miss.
const SEARCH_ABOVE_M = 0.6;

// Target sample spacing across a footprint, with a floor and a cap so a tiny
// ledge still gets a grid and a whole roof does not explode.
const SAMPLE_SPACING_M = 0.5;
const SAMPLE_MIN = 3;
const SAMPLE_MAX = 21;

const EPS = 1e-9;

// ---------------------------------------------------------------- known debt
// The itemised, ACCEPTED red list. This is the guard's whole purpose: the list
// may shrink freely, but the moment a NEW affordance goes red — or a listed one
// gets WORSE than its recorded number — the gate exits non-zero. It is not a
// mute: every entry is printed loudly, grouped by what it means, on every run,
// with the number it was accepted at. Same discipline as check-world-collision's
// KNOWN_DEBT and check-world-scale's — a decision on the record, not a silence.
//
// Do NOT add a row here you have not measured, and do NOT use the list to bury
// something fixable. Each row is keyed `KIND:id` and records the verdict rank,
// the coverage band, and the headline delta (medianDelta for a walked/arrived
// surface, maxDelta for a mass top) at the moment it was accepted. `gateWorse`
// below defines "worse" against exactly these.
//
// Recorded on branch workflow/mission-encounters against the published world at
// 81 satisfied / 26 flagged / 0 CRITICAL; three F_TREE rows (DECK:BOUGH_UPPER,
// CATCH:LEAP_CROWN, CATCH:LEAP_UPPER) retired on workflow/mission-flow when the
// Liberty Elm was rebuilt, leaving 22 accepted entries.
const DEBT_CATEGORIES = {
  "missing-or-short": "GENUINELY MISSING GEOMETRY / TOO-SHORT ASSET — a real defect, owned by the asset & authoring lanes, not this verifier.",
  "catch-radius": "CATCH RADIUS EXCEEDS ITS LANDING SURFACE — the dive/leap acceptance disc reaches past the wagon/bough it lands on. Owned by route authoring (route*.ts / climbs.ts), which is being re-authored; these may change or disappear.",
  "cover-proud": "COVER ART PROUD OF ITS COLLISION LINE — a peaked awning drawn above the vault top it stands for; the market-stall body itself is 0.45m short. A decision on intended height, not a hole.",
  "flat-plane-limit": "ACKNOWLEDGED FLAT-PLANE-SAMPLER LIMIT ON A NON-FLAT SHAPE — round/clustered obstacle tops, scaffold plank gaps, an offset/round bough tier. The mesh is present; the flat-plane test under-reads it.",
};

const KNOWN_DEBT = new Map([
  // --- genuinely missing geometry / too-short asset (2) ---
  // DECK:OLD_BRICK_WATCH resolved on branch workflow/mission-flow: the tower + watch
  // now draw `belfry-old-brick` (a re-key of bldg-brick.glb) whose flat roof lands
  // at 13.60m, so the posted guard stands on drawn geometry (satisfied, 100% at
  // plane) instead of floating 3.4m over the church roofline. Entry removed rather
  // than left describing a solved problem.
  ["MASS_TOP:ROPE_CAPSTAN", { category: "missing-or-short", rank: 2, band: 0.000, delta: -0.986, note: "rope-coil-large crown ~0.99m below its cover top; needs a taller vaultable asset through the pipeline." }],
  ["MASS_TOP:COVER_COILS_C", { category: "missing-or-short", rank: 2, band: 0.000, delta: -0.635, note: "rope-coil-large crown ~0.64m below its cover top; needs a taller vaultable asset through the pipeline." }],
  // --- DEAD WHARF warehouses. THE REGEN THESE THREE WERE WAITING FOR LANDED
  // (a72015e) AND DID NOT DELIVER WHAT THE NOTES PROMISED, so the notes are
  // rewritten against measurement rather than left describing a plan. Measured
  // off the placed GLBs 31-Jul: wharf-a tops out at 5.35 with one 14.8 m2 ridge
  // band AT the plane (z 1.41..3.19) over 4.55/4.70 aprons; wharf-b tops out at
  // 4.57 with one 20.6 m2 flat roof at 4.30 and nothing at 5.35 at all. There is
  // no taller roof on either asset, so "regen delivers a gallery at the box" was
  // never going to happen and these are not pending anything.
  //
  // wharf-b is therefore AUTHORED DOWN onto its drawn roof (roofY 4.30, see
  // level/wharf.ts) rather than held as debt: the ascent now mantles onto stone.
  // Its two entries stay only to cover the jetty over-claim that is left.
  ["DECK:WHARF_WAREHOUSE_A__ROOF", { category: "missing-or-short", rank: 3, band: 0.02, delta: -4.84, note: "MEASURED -0.61 / 15% at plane, far better than this recorded -4.84 (which predates a72015e and is kept only as the never-exceed ceiling). NOT pending a regen: wharf-a's ridge IS drawn at 5.35, but as a 1.78 m band (z 1.41..3.19) under a deck claiming the whole footprint, so 85% of the deck is the 4.55/4.70 apron. Narrowing the deck onto the ridge is the honest rect and it RE-MASSES THE DESCENT — the mound the body drops to sits at z 7..10, outside the band — so it needs a decision on how a pitched roof is walked, not an asset." }],
  ["DECK:WHARF_WAREHOUSE_B__ROOF", { category: "missing-or-short", rank: 3, band: 0.02, delta: -1.37, note: "Re-pointed 31-Jul from the phantom 5.35 to the drawn 4.30 flat roof; now -0.27 / 63% at plane, from 0%. What is left is the roof deck's own JETTY reaching past the mesh, not a missing roof." }],
  ["CLIMB_TO:CLIMBVOL_WHARF_ASC_2->WHARF_ASC_ROOF", { category: "missing-or-short", rank: 3, band: 0.00, delta: -1.88, note: "The mantle onto wharf-b's roof, re-pointed with the deck above to the drawn 4.30. Same jetty residue." }],
  // --- TOWN HOUSE repair-scaffold staging staircase (owner-accepted 31-Jul). The
  // ≤1.9 m mantle chain 5.6 -> 12.4 is a STAGGERED STAIRCASE of solid staging
  // blocks (masons' materials boarded onto the putlog frame), the same shape as
  // the proven wharf ascent: each block OVERLAPS the one below for support and
  // OVERHANGS it for the next lip. Two measured artifacts of that shape, neither a
  // hole and neither on the route's standing spots (the golden nodes stand on the
  // CLEAR part of each block): the first block sits on the 5.60 staging plank so it
  // occludes ~17% of that deck, and the crate-MOUND steps (alternated with
  // crate-STACK so the clusterer draws each block on its own) crown ~0.5 m proud of
  // their flat mantle plane — the collision top is flat and the mantle lands on it.
  // --- MERCHANT facade: PENDING-REGEN (owner-accepted 31-Jul). The bldg-merchant
  // mesh draws its south front ~2.1m below the authored storeys, so the re-massed
  // covert climb-in (a ≤1.9m mantle chain up the merchant's front) reads no surface
  // at its balcony / jettied gallery / eave planes. The STRUCTURE (route/climbs/
  // decks) is authored to the target so the route-graph gates are green; the mesh
  // fills in under the same key. Regen targets, south face over the window
  // (x 38.0..40.4), recorded so the asset worker rebuilds exactly these surfaces:
  //   balcony       top y = 4.00  (z −3.4..−2.6, ≥0.8 deep)
  //   jetty gallery top y = 5.70  (z −2.4..−1.6, oversailed south, ≥0.8 deep)
  //   eave / leads  top y = 7.10
  // Do NOT shrink the boxes; the regen targets them. See level/merchant.ts.
  ["DECK:MERCHANT_STRING", { category: "missing-or-short", rank: 3, band: 0.00, delta: -3.58, note: "PENDING-REGEN: the jettied gallery (5.70) reads ~3.6m below plane — the facade mesh tops out ~2.1m and never reaches the upper storey. Regen delivers the oversailed gallery at the 5.70 box." }],
  ["CLIMB_TO:CLIMBVOL_B_CRATES_B->M_LEDGE", { category: "missing-or-short", rank: 3, band: 0.00, delta: -1.88, note: "PENDING-REGEN: the mantle onto the balcony (4.0) reads ~1.9m below (facade draws its balcony ~2.1m low). Regen delivers the balcony at the 4.00 box." }],
  ["CLIMB_TO:CLIMBVOL_M_LEDGE->M_STRING", { category: "missing-or-short", rank: 3, band: 0.00, delta: -1.70, note: "PENDING-REGEN: the mantle onto the jettied gallery (5.70) reads ~1.7m below. Regen delivers the gallery at the 5.70 box (same as DECK:MERCHANT_STRING)." }],
  ["CLIMB_TO:CLIMBVOL_M_STRING->M_EAVE_S", { category: "missing-or-short", rank: 3, band: 0.00, delta: -4.98, note: "PENDING-REGEN: the last mantle onto the leads' south lip (7.1) reads ~5.0m below — the facade draws no upper storey. Regen delivers the eave/leads at the 7.10 box." }],
  // --- catch radius exceeds its landing surface (3) — route-authoring lane ---
  // LEAP_CROWN and LEAP_UPPER retired on branch workflow/mission-flow: the rebuilt
  // liberty-elm-hero.glb carries broad near-flat limb rafts that fill both leap
  // discs (crown NW, upper NE), so both now read 100% at plane. Entries removed
  // rather than left describing a solved problem.
  ["CATCH:LEAP_YARD_HAY", { category: "catch-radius", rank: 2, band: 0.594, delta: -0.074, note: "leap acceptance radius (1.6m) exceeds the hay-wain-loaded top; the annular gap is a real catch-vs-surface decision." }],
  ["CATCH:CATCH_LANE_HAY", { category: "catch-radius", rank: 1, band: 0.750, delta: -0.077, note: "acceptance radius reaches past the hay-wain top." }],
  ["CATCH:CATCH_PRINTSHOP_HAY", { category: "catch-radius", rank: 1, band: 0.875, delta: -0.079, note: "acceptance radius reaches slightly past the hay-wain top." }],
  // --- cover art proud of its collision line (6) ---
  ["MASS_TOP:STALL_0", { category: "cover-proud", rank: 1, band: 0.000, delta: 0.592, note: "market-awning canopy ~0.59m proud of the vault top; market-stall body itself ~0.45m short." }],
  ["MASS_TOP:STALL_1", { category: "cover-proud", rank: 1, band: 0.000, delta: 0.592, note: "market-awning canopy ~0.59m proud of the vault top; market-stall body itself ~0.45m short." }],
  ["MASS_TOP:STALL_2", { category: "cover-proud", rank: 1, band: 0.000, delta: 0.600, note: "market-awning canopy ~0.60m proud of the vault top; market-stall body itself ~0.45m short." }],
  ["MASS_TOP:STALL_3", { category: "cover-proud", rank: 1, band: 0.000, delta: 0.600, note: "market-awning canopy ~0.60m proud of the vault top; market-stall body itself ~0.45m short." }],
  ["MASS_TOP:STALL_4", { category: "cover-proud", rank: 1, band: 0.000, delta: 0.600, note: "market-awning canopy ~0.60m proud of the vault top; market-stall body itself ~0.45m short." }],
  ["MASS_TOP:DOCK_STALLS", { category: "cover-proud", rank: 1, band: 0.000, delta: 0.592, note: "market-awning canopy ~0.59m proud of the vault top; market-stall body itself ~0.45m short." }],
  // --- acknowledged flat-plane-sampler limit on a non-flat shape (12) ---
  ["DECK:SCAFFOLD_D2", { category: "flat-plane-limit", rank: 1, band: 0.89, delta: 0.00, note: "Staging boards are five planks with 0.02m gaps between them, and the sampler counts a gap as off-plane. Surface is -0.00m vs plane and 100% of the footprint has surface, so nothing is missing or low. This entry was briefly deleted on 31-Jul because its old note described the SCAFF_STEP_A crates that the staging regeneration removed; the note was stale but the partial read was not, and the band improved 0.83 -> 0.89 when the crates went." }],
  ["MASS_TOP:GAOL_BARRELS", { category: "flat-plane-limit", rank: 1, band: 0.222, delta: -0.067, note: "round/clustered barrel-group top; crowns reach the plane, no continuous surface." }],
  ["MASS_TOP:LIBERTY_BARRELS", { category: "flat-plane-limit", rank: 1, band: 0.222, delta: -0.067, note: "round/clustered barrel-group top; crowns reach the plane, no continuous surface." }],
  ["MASS_TOP:KING_LANE_BARRELS", { category: "flat-plane-limit", rank: 1, band: 0.222, delta: -0.067, note: "round/clustered barrel-group top; crowns reach the plane, no continuous surface." }],
  ["MASS_TOP:DOCK_BARRELS", { category: "flat-plane-limit", rank: 1, band: 0.222, delta: -0.067, note: "round/clustered barrel-group top; crowns reach the plane, no continuous surface." }],
  ["MASS_TOP:COVER_BARRELS_NE", { category: "flat-plane-limit", rank: 1, band: 0.125, delta: -0.088, note: "round/clustered barrel-group top; crowns reach the plane, no continuous surface." }],
  ["MASS_TOP:COVER_BARRELS_SW", { category: "flat-plane-limit", rank: 1, band: 0.125, delta: -0.088, note: "round/clustered barrel-group top; crowns reach the plane, no continuous surface." }],
  ["MASS_TOP:TREE_STALL", { category: "flat-plane-limit", rank: 1, band: 0.200, delta: -0.041, note: "market-stall cluster top; crowns reach the plane, no continuous surface." }],
  ["MASS_TOP:YARD_STAGE", { category: "flat-plane-limit", rank: 1, band: 0.200, delta: -0.067, note: "warehouse-platform-scale cluster; crown reaches the plane, no continuous surface." }],
  ["CLIMB_TO:CLIMBVOL_WHARF_ASC_1->WHARF_ASC_2", { category: "flat-plane-limit", rank: 1, band: 0.70, delta: -0.05, note: "wharf cargo mantle: crate-mound top drawn == collision (delta ~-0.03m), but the mantle's arrival footprint is laterally offset from the crate below it, so the offset heuristic reads ~78% not full. Mesh is present." }],
  // DECK:BOUGH_UPPER retired on branch workflow/mission-flow: the rebuilt
  // liberty-elm-hero.glb runs its limb raft in to the bole at the tier plane, so
  // the offset upper tier's deck∩trunk strip (which the sampler clips it to) is
  // now full wood — 100% at plane. Entry removed.
  ["DECK:OLD_BRICK__ROOF", { category: "flat-plane-limit", rank: 1, band: 0.732, delta: -0.075, note: "bldg-meeting-hollis roof deck reads ~73% at plane; a partial-coverage edge of the flat-plane sampler." }],
]);

// How much a debt entry may drift in the GOOD direction and still match, and how
// much numeric noise to tolerate before calling a change a regression. The
// sampler is deterministic on fixed geometry, so these only absorb float noise
// and small asset re-decimation jitter; a real worsening is far larger.
const DEBT_BAND_TOL = 0.03;
const DEBT_DELTA_TOL = 0.05;

// A row is WORSE than its recorded debt if its severity rank rose, its coverage
// band dropped, or its surface moved further from the authored plane (in either
// direction — a shortfall deepening or a proud top rising). Improvement (higher
// band, smaller |delta|, lower rank) never trips this.
function gateWorse(current, debt) {
  const reasons = [];
  if (current.rank > debt.rank) reasons.push(`severity rose ${debt.rank}->${current.rank}`);
  if (current.band < debt.band - DEBT_BAND_TOL) reasons.push(`coverage fell ${(debt.band * 100).toFixed(0)}%->${(current.band * 100).toFixed(0)}%`);
  if (Math.abs(current.delta) > Math.abs(debt.delta) + DEBT_DELTA_TOL) reasons.push(`surface moved from plane ${debt.delta.toFixed(2)}m->${current.delta.toFixed(2)}m`);
  return reasons;
}

// ---------------------------------------------------------------- geometry decode
/**
 * Every STATIC triangle of a GLB, in the mesh's own scene space (node
 * transforms applied) — the same space `new THREE.Box3().setFromObject(scene)`
 * measures, which is what both runtime fit paths start from.
 *
 * Skinned meshes are reported, not measured: `InstancedFittedGlb` refuses to
 * draw a skinned "prop" and `FittedGlb` would pose it by bones, so a skinned
 * affordance asset is a data error to surface rather than a surface to sample.
 * No affordance asset in M1 is skinned; if one becomes so this says which.
 */
export function staticTriangles(document) {
  const world = worldMatrices(document);
  const nodes = document.json.nodes ?? [];
  const tris = [];
  let skinnedMeshes = 0;
  const problems = [];
  nodes.forEach((node, nodeIndex) => {
    if (node.mesh === undefined) return;
    if (node.skin !== undefined) {
      skinnedMeshes++;
      return;
    }
    const mesh = document.json.meshes?.[node.mesh];
    if (!mesh) return;
    const nodeWorld = world[nodeIndex];
    for (const primitive of mesh.primitives ?? []) {
      const positionIndex = primitive.attributes?.POSITION;
      if (positionIndex === undefined) continue;
      const positions = readAccessor(document, positionIndex);
      if (!positions) {
        problems.push(`POSITION accessor ${positionIndex} unreadable`);
        continue;
      }
      const count = document.json.accessors[positionIndex].count;
      const verts = new Array(count);
      for (let i = 0; i < count; i++) {
        verts[i] = transformPoint(
          nodeWorld,
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2],
        );
      }
      let indices = null;
      if (primitive.indices !== undefined) indices = readAccessor(document, primitive.indices);
      if (indices) {
        for (let i = 0; i + 2 < indices.length; i += 3) {
          const a = verts[indices[i]];
          const b = verts[indices[i + 1]];
          const c = verts[indices[i + 2]];
          if (a && b && c) tris.push([a, b, c]);
        }
      } else {
        for (let i = 0; i + 2 < count; i += 3) tris.push([verts[i], verts[i + 1], verts[i + 2]]);
      }
    }
  });
  return { tris, skinnedMeshes, problems };
}

export function triBounds(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris)
    for (const v of t)
      for (let a = 0; a < 3; a++) {
        if (v[a] < min[a]) min[a] = v[a];
        if (v[a] > max[a]) max[a] = v[a];
      }
  return { min, max };
}

// ---------------------------------------------------------------- placement transform
/**
 * The world-space transform the runtime applies to a placed asset, reproduced
 * operation-for-operation from `engine-world`:
 *
 *   fit   (FittedGlbInner / instanceMatrix / ImportedStructureInner):
 *           scale the natural mesh into `size` — contain-fit (uniform, the min
 *           ratio) for a PROP, per-axis fill for a MODULE, per-axis fill with an
 *           auto quarter-turn for a SHELL — then re-centre X/Z on the scaled
 *           bounds and ground Y on the scaled min.
 *   place (the <group> in M1Scenery): translate to `pos`, rotate by `yaw`.
 *
 * Returns a point mapper natural -> world.
 */
export function placementMapper(placement, naturalMin, naturalMax) {
  const natSize = [
    naturalMax[0] - naturalMin[0] || 1,
    naturalMax[1] - naturalMin[1] || 1,
    naturalMax[2] - naturalMin[2] || 1,
  ];
  let sx;
  let sy;
  let sz;
  let internalYaw = 0;
  if (placement.fit === "PROP") {
    const u = Math.min(
      placement.size[0] / natSize[0],
      placement.size[1] / natSize[1],
      placement.size[2] / natSize[2],
    );
    sx = sy = sz = u;
  } else if (placement.fit === "MODULE") {
    sx = placement.size[0] / natSize[0];
    sy = placement.size[1] / natSize[1];
    sz = placement.size[2] / natSize[2];
  } else {
    // SHELL: ImportedStructure auto-turns to put the mesh's long horizontal axis
    // along the room's long horizontal axis, then scales per axis onto the box.
    const sourceLongOnX = natSize[0] >= natSize[2];
    const targetLongOnX = placement.size[0] >= placement.size[2];
    const turn = sourceLongOnX !== targetLongOnX;
    const targetX = turn ? placement.size[2] : placement.size[0];
    const targetZ = turn ? placement.size[0] : placement.size[2];
    sx = targetX / natSize[0];
    sy = placement.size[1] / natSize[1];
    sz = targetZ / natSize[2];
    internalYaw = turn ? -Math.PI / 2 : 0;
  }

  // Centre/ground computed on the scaled, UNROTATED bounds — exactly the
  // `Box3().setFromObject(root)` the importers take after setting scale and
  // before setting rotation.
  const scMinX = naturalMin[0] * sx;
  const scMaxX = naturalMax[0] * sx;
  const scMinY = naturalMin[1] * sy;
  const scMinZ = naturalMin[2] * sz;
  const scMaxZ = naturalMax[2] * sz;
  const centreX = (scMinX + scMaxX) / 2;
  const centreZ = (scMinZ + scMaxZ) / 2;
  const groundY = scMinY;

  const ci = Math.cos(internalYaw);
  const si = Math.sin(internalYaw);
  const cy = Math.cos(placement.yaw);
  const syaw = Math.sin(placement.yaw);
  const [px, py, pz] = placement.pos;

  return (v) => {
    // scale
    let x = v[0] * sx;
    let y = v[1] * sy;
    let z = v[2] * sz;
    // internal quarter-turn (SHELL), about Y, BEFORE the centre/ground offset
    // is applied — matches T(position)*R(rot)*S(scale) with position taken from
    // the unrotated scaled box.
    if (internalYaw !== 0) {
      const rx = x * ci + z * si;
      const rz = -x * si + z * ci;
      x = rx;
      z = rz;
    }
    // centre X/Z, ground Y
    x -= centreX;
    z -= centreZ;
    y -= groundY;
    // place: rotate by yaw, translate to pos
    const wx = px + (x * cy + z * syaw);
    const wz = pz + (-x * syaw + z * cy);
    return [wx, py + y, wz];
  };
}

// ---------------------------------------------------------------- asset / placement caches
const naturalCache = new Map(); // assetPath -> { tris, min, max, skinnedMeshes, problems, missing }

function loadNatural(assetPath) {
  const cached = naturalCache.get(assetPath);
  if (cached) return cached;
  const file = join(PUBLISHED, assetPath.replace(/^world\//, ""));
  let record;
  if (!existsSync(file)) {
    record = { missing: true, tris: [], min: null, max: null, skinnedMeshes: 0, problems: [] };
  } else {
    const document = glbDocument(readFileSync(file));
    if (!document) {
      record = { unreadable: true, tris: [], min: null, max: null, skinnedMeshes: 0, problems: ["unparseable GLB"] };
    } else {
      const { tris, skinnedMeshes, problems } = staticTriangles(document);
      const b = tris.length ? triBounds(tris) : { min: null, max: null };
      record = { tris, min: b.min, max: b.max, skinnedMeshes, problems };
    }
  }
  naturalCache.set(assetPath, record);
  return record;
}

const placedCache = new Map(); // placement index -> { tris, min, max, status }

function loadPlaced(placement, index) {
  const cached = placedCache.get(index);
  if (cached) return cached;
  const natural = loadNatural(placement.assetPath);
  let record;
  if (natural.missing) record = { status: "MISSING", tris: [], min: null, max: null };
  else if (natural.unreadable) record = { status: "UNREADABLE", tris: [], min: null, max: null };
  else if (natural.skinnedMeshes > 0 && natural.tris.length === 0)
    record = { status: "SKINNED", tris: [], min: null, max: null };
  else if (natural.tris.length === 0) record = { status: "EMPTY", tris: [], min: null, max: null };
  else {
    const map = placementMapper(placement, natural.min, natural.max);
    const tris = natural.tris.map((t) => [map(t[0]), map(t[1]), map(t[2])]);
    const b = triBounds(tris);
    record = { status: "OK", tris, min: b.min, max: b.max, skinnedMeshes: natural.skinnedMeshes };
  }
  placedCache.set(index, record);
  return record;
}

// ---------------------------------------------------------------- the sampler
function rectsOverlapXZ(aMinX, aMaxX, aMinZ, aMaxZ, bMinX, bMaxX, bMinZ, bMaxZ) {
  return (
    Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX) > -EPS &&
    Math.min(aMaxZ, bMaxZ) - Math.max(aMinZ, bMinZ) > -EPS
  );
}

/** Point-in-triangle in the XZ plane (sign-consistent edge tests). */
function pointInTriXZ(px, pz, a, b, c) {
  const d1 = (px - b[0]) * (a[2] - b[2]) - (a[0] - b[0]) * (pz - b[2]);
  const d2 = (px - c[0]) * (b[2] - c[2]) - (b[0] - c[0]) * (pz - c[2]);
  const d3 = (px - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (pz - a[2]);
  const hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const hasPos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(hasNeg && hasPos);
}

/** Barycentric-interpolated Y of a triangle at (px,pz). */
function interpY(px, pz, a, b, c) {
  const denom = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(denom) < 1e-12) return null;
  const l1 = ((b[2] - c[2]) * (px - c[0]) + (c[0] - b[0]) * (pz - c[2])) / denom;
  const l2 = ((c[2] - a[2]) * (px - c[0]) + (a[0] - c[0]) * (pz - c[2])) / denom;
  const l3 = 1 - l1 - l2;
  return l1 * a[1] + l2 * b[1] + l3 * c[1];
}

function normalAbsY(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return Math.abs(ny / len);
}

function gridFor(minX, maxX, minZ, maxZ) {
  const nx = Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, Math.round((maxX - minX) / SAMPLE_SPACING_M)));
  const nz = Math.min(SAMPLE_MAX, Math.max(SAMPLE_MIN, Math.round((maxZ - minZ) / SAMPLE_SPACING_M)));
  return { nx, nz };
}

/** True if (px,pz) lies inside any of the given XZ rects (a punched-out hole). */
function pointInAnyRect(px, pz, rects) {
  for (const r of rects) {
    if (px >= r.minX && px <= r.maxX && pz >= r.minZ && pz <= r.maxZ) return true;
  }
  return false;
}

/**
 * Section the placed geometry over `rect` at authored height `h`.
 *
 * For each grid point, find the horizontal triangle whose interpolated height
 * is closest to `h` within [h - DEEP_SEARCH_BELOW, h + SEARCH_ABOVE]. That is
 * "the surface the mover would find at the plane" — reported as a distribution,
 * never a single sample.
 *
 * `opts.excludeRects` (optional): XZ rects to punch out of the sampled footprint
 * entirely — grid points inside them are not counted at all, not counted as
 * misses. This is how an annulus deck is judged on its ring: the solid rising
 * core it surrounds is a hole in the walkway, not a shortfall of it, so the core
 * footprint is removed from the denominator rather than dragging coverage down.
 *
 * `opts.circle` (optional) `{cx, cz, r}`: sample only the inscribed disc, not the
 * bounding square. A dive/leap catch is a circular acceptance radius, so the
 * square's corners lie outside the zone the game will ever catch a body in;
 * counting them measures a shape the game does not use. Points outside the disc
 * are not counted at all (like excludeRects), so a genuine shortfall INSIDE the
 * disc still reads red.
 */
export function sampleSurface(candidates, rect, h, opts = {}) {
  const excludeRects = opts.excludeRects ?? null;
  const circle = opts.circle ?? null;
  const { nx, nz } = gridFor(rect.minX, rect.maxX, rect.minZ, rect.maxZ);
  // Pre-filter triangles to those whose XZ AABB overlaps the query rect and
  // whose height range is anywhere in the search column.
  const lo = h - DEEP_SEARCH_BELOW_M;
  const hi = h + SEARCH_ABOVE_M;
  const tris = [];
  const provider = [];
  for (const cand of candidates) {
    for (const t of cand.record.tris) {
      const tMinY = Math.min(t[0][1], t[1][1], t[2][1]);
      const tMaxY = Math.max(t[0][1], t[1][1], t[2][1]);
      if (tMaxY < lo || tMinY > hi) continue;
      const tMinX = Math.min(t[0][0], t[1][0], t[2][0]);
      const tMaxX = Math.max(t[0][0], t[1][0], t[2][0]);
      const tMinZ = Math.min(t[0][2], t[1][2], t[2][2]);
      const tMaxZ = Math.max(t[0][2], t[1][2], t[2][2]);
      if (!rectsOverlapXZ(tMinX, tMaxX, tMinZ, tMaxZ, rect.minX, rect.maxX, rect.minZ, rect.maxZ)) continue;
      tris.push(t);
      provider.push(cand.asset);
    }
  }

  let total = 0;
  let anyHits = 0;
  let bandHits = 0;
  const deltas = [];
  const providerCount = new Map();
  let nearestBelowGap = Infinity; // for samples with no band hit: how far down the nearest surface is

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const px = rect.minX + ((rect.maxX - rect.minX) * (i + 0.5)) / nx;
      const pz = rect.minZ + ((rect.maxZ - rect.minZ) * (j + 0.5)) / nz;
      if (excludeRects && pointInAnyRect(px, pz, excludeRects)) continue;
      if (circle && (px - circle.cx) ** 2 + (pz - circle.cz) ** 2 > circle.r * circle.r) continue;
      total++;
      // The HIGHEST horizontal surface at or below the plane (within the search
      // column) — the mover's own catch semantics: a descending capsule lands on
      // the topmost floor under it, not on whichever internal flat is nearest the
      // authored number. This is what stops a round barrel cluster or a stepped
      // stone reading as broken when its crown genuinely reaches the plane, while
      // leaving a true hole (no surface, or a surface a whole storey low) exactly
      // as red. It is a fidelity choice, not a loosened tolerance.
      let bestY = null;
      let bestProvider = null;
      for (let k = 0; k < tris.length; k++) {
        const t = tris[k];
        if (!pointInTriXZ(px, pz, t[0], t[1], t[2])) continue;
        if (normalAbsY(t[0], t[1], t[2]) < HORIZONTAL_NORMAL_Y) continue;
        const y = interpY(px, pz, t[0], t[1], t[2]);
        if (y === null || y < lo || y > hi) continue;
        if (bestY === null || y > bestY) {
          bestY = y;
          bestProvider = provider[k];
        }
      }
      if (bestY !== null) {
        anyHits++;
        deltas.push(bestY - h);
        providerCount.set(bestProvider, (providerCount.get(bestProvider) ?? 0) + 1);
        if (Math.abs(bestY - h) <= ALIGN_BAND_M) bandHits++;
        else if (bestY < h) nearestBelowGap = Math.min(nearestBelowGap, h - bestY);
      }
    }
  }

  deltas.sort((a, b) => a - b);
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
  let topProvider = null;
  let topProviderCount = -1;
  for (const [asset, n] of providerCount) if (n > topProviderCount) { topProvider = asset; topProviderCount = n; }
  return {
    total,
    coverageAny: total ? anyHits / total : 0,
    coverageBand: total ? bandHits / total : 0,
    medianDelta: median,
    minDelta: deltas.length ? deltas[0] : null,
    maxDelta: deltas.length ? deltas[deltas.length - 1] : null,
    nearestBelowGap: Number.isFinite(nearestBelowGap) ? nearestBelowGap : null,
    provider: topProvider,
    triCount: tris.length,
  };
}

// ---------------------------------------------------------------- climb face heuristic
/**
 * A lower-confidence check that the climb has a real face to go up: are there
 * near-VERTICAL triangles inside the foot footprint spanning the rise from the
 * standing height to the arrival height? Labelled uncertain because a climb face
 * can be textured onto an angled or recessed surface the runtime never tests, so
 * absence here is a flag to look, not a verdict.
 */
function sampleFace(candidates, rect, footY, destY) {
  const lo = Math.min(footY, destY);
  const hi = Math.max(footY, destY);
  if (hi - lo < 0.2) return { faceFraction: null, note: "rise too small to test" };
  const mid = (lo + hi) / 2;
  let vertical = 0;
  let any = 0;
  for (const cand of candidates) {
    for (const t of cand.record.tris) {
      const tMinY = Math.min(t[0][1], t[1][1], t[2][1]);
      const tMaxY = Math.max(t[0][1], t[1][1], t[2][1]);
      if (tMaxY < mid || tMinY > mid) continue; // must cross mid-rise
      const tMinX = Math.min(t[0][0], t[1][0], t[2][0]);
      const tMaxX = Math.max(t[0][0], t[1][0], t[2][0]);
      const tMinZ = Math.min(t[0][2], t[1][2], t[2][2]);
      const tMaxZ = Math.max(t[0][2], t[1][2], t[2][2]);
      if (!rectsOverlapXZ(tMinX, tMaxX, tMinZ, tMaxZ, rect.minX, rect.maxX, rect.minZ, rect.maxZ)) continue;
      any++;
      if (normalAbsY(t[0], t[1], t[2]) < 0.35) vertical++;
    }
  }
  return { faceFraction: any ? vertical / any : 0, crossing: any };
}

// ---------------------------------------------------------------- verdict
/**
 * Severity, judged by what KIND of affordance this is — which is exactly the
 * distinction the task draws:
 *
 *   MASS_TOP  a vault/obstacle/cover top. The question is "does the obstacle's
 *             TRUE mesh height match the authored blocker top the envelope check
 *             trusts?" — a top-reach question, not a continuous-plane one. A
 *             cluster of round barrels is a legitimate vault whose crowns reach
 *             the plane; scoring it on flat-plane coverage would be a false red.
 *             So it is judged on the HIGHEST horizontal surface found anywhere in
 *             the footprint (maxDelta), with coverage reported alongside so an
 *             obstacle that is round/partial is visible and labelled.
 *
 *   DECK / CLIMB_TO / CATCH  a surface you stand, arrive or land ON, across its
 *             extent. Judged on continuous coverage AT the plane plus the median
 *             delta: a roof with a hole, or one that sits a storey low, is a
 *             defect even if one corner reaches the plane.
 */
function severityOf(kind, result) {
  if (result.coverageAny < 0.05) return { rank: 4, label: "CRITICAL", reason: "no mesh surface anywhere under the authored plane" };

  if (kind === "MASS_TOP") {
    // Top-reach: how far the object's highest flat surface is BELOW the plane.
    const topDelta = result.maxDelta ?? -DEEP_SEARCH_BELOW_M;
    const topGap = topDelta < 0 ? -topDelta : 0;
    const overshoot = topDelta > 0 ? topDelta : 0;
    const partial = result.coverageBand < 0.5;
    const note = describeTop(result);
    // A SHORTFALL — the highest flat surface sits BELOW the authored blocker top,
    // so the envelope trusts a blocker the mesh does not reach: a real gap.
    if (topGap > 1.0) return { rank: 3, label: "SEVERE", reason: note };
    if (topGap > 0.5) return { rank: 2, label: "OFF", reason: note };
    if (topGap > ALIGN_BAND_M) return { rank: 1, label: "MARGINAL", reason: note };
    // OVERSHOOT is not a shortfall. The mesh sits PROUD of the authored blocker
    // top — solid geometry meets and exceeds the plane, which is the strongest
    // possible pass for a cover/vault mass (the blocker the envelope trusts is
    // fully backed). It is a peaked/sloped roof or an object drawn a touch taller
    // than its collision line, not "nothing here", so it gets its own verdict —
    // flagged for a human to confirm the extra height is intended (it matters
    // only where a precise landing height is needed), never counted as a hole.
    // Same numeric band as before; only the label and meaning are separated.
    if (overshoot > ALIGN_BAND_M) return { rank: 1, label: "PROUD", reason: `${note} (mesh proud of the authored blocker top; solid geometry backs the plane — correct for a cover/vault, confirm if a precise landing is needed)` };
    // Top reaches the plane. Partial coverage is expected of a round/clustered
    // obstacle (barrels, coils) and is NOT a hole — flag it, don't fail it.
    if (partial) return { rank: 1, label: "PARTIAL", reason: `${note} (top reaches plane; round/clustered obstacle, not a continuous surface)` };
    return { rank: 0, label: "OK", reason: note };
  }

  const d = result.medianDelta ?? 0;
  const absd = Math.abs(d);
  if (result.coverageBand < 0.25 || absd > 1.5) return { rank: 3, label: "SEVERE", reason: describe(result) };
  if (result.coverageBand < 0.6 || absd > ALIGN_BAND_M * 2) return { rank: 2, label: "OFF", reason: describe(result) };
  if (result.coverageBand < 0.9 || absd > ALIGN_BAND_M) return { rank: 1, label: "MARGINAL", reason: describe(result) };
  return { rank: 0, label: "OK", reason: describe(result) };
}

function describe(r) {
  const parts = [];
  if (r.medianDelta !== null) parts.push(`surface ${(r.medianDelta >= 0 ? "+" : "")}${r.medianDelta.toFixed(2)}m vs plane`);
  parts.push(`${Math.round(r.coverageBand * 100)}% of footprint at plane`);
  if (r.coverageBand < 0.9 && r.coverageAny > 0) parts.push(`${Math.round(r.coverageAny * 100)}% has any surface`);
  if (r.nearestBelowGap !== null && r.coverageBand < 0.6) parts.push(`nearest surface ${r.nearestBelowGap.toFixed(2)}m below`);
  return parts.join(", ");
}

function describeTop(r) {
  const parts = [];
  const top = r.maxDelta;
  if (top === null) parts.push("no flat top found");
  else parts.push(`highest flat top ${(top >= 0 ? "+" : "")}${top.toFixed(2)}m vs plane`);
  parts.push(`${Math.round(r.coverageBand * 100)}% of footprint at plane`);
  if (r.coverageAny < 0.95) parts.push(`${Math.round(r.coverageAny * 100)}% has any surface`);
  return parts.join(", ");
}

// ---------------------------------------------------------------- affordance enumeration
async function loadLevel() {
  const mod = await import(pathToFileURL(join(ROOT, "packages/mission-m1/src/index.ts")).href);
  const compileMod = await import(pathToFileURL(join(ROOT, "packages/mission-m1/src/compile.ts")).href);
  return {
    level: mod.M1_EFFIGY_RUN,
    placements: mod.sceneryPlacements(),
    compiled: compileMod.compileLevel(mod.M1_EFFIGY_RUN),
  };
}

function centredRect(x, z, half) {
  return { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half };
}

function intersectRect(a, b) {
  return {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minZ: Math.max(a.minZ, b.minZ),
    maxZ: Math.min(a.maxZ, b.maxZ),
  };
}
function rectValid(r) {
  return r.maxX - r.minX > 0.05 && r.maxZ - r.minZ > 0.05;
}

/**
 * Is `mass` a rising core the deck fully surrounds? — the deck extends beyond it
 * on all four sides, and the mass is a solid non-landable body rising above the
 * deck plane (a tower shaft, a steeple lantern, a tree trunk). Such a core is a
 * hole in the deck's walkway, not part of it.
 */
function isRisingCore(deck, m) {
  const surrounds =
    deck.rect.minX < m.rect.minX && deck.rect.maxX > m.rect.maxX &&
    deck.rect.minZ < m.rect.minZ && deck.rect.maxZ > m.rect.maxZ;
  const rises = m.landable === false && Number.isFinite(m.topY) && m.topY > deck.y + ALIGN_BAND_M;
  return surrounds && rises;
}

/** The rising-core rects of a deck named as a climb's `onto` target, if any. */
function ontoCoreRects(ontoId, compiled) {
  const deck = compiled.deckById.get(ontoId);
  if (!deck) return [];
  return (deck.carriedBy ?? [])
    .map((id) => compiled.massById.get(id))
    .filter((m) => m && isRisingCore(deck, m))
    .map((m) => ({ ...m.rect }));
}

/** Build the affordance list. Each entry: kind, id, section, h, rect, plus notes. */
function enumerateAffordances({ level, compiled }) {
  const massById = compiled.massById;
  const affordances = [];

  // 1. Decks — authored walking planes. Ramp strips are invisible stepped
  //    collision (the asset rule permits invisible navigation geometry), so they
  //    are excluded and counted, not sampled.
  let rampStrips = 0;
  for (const deck of compiled.decks) {
    if (deck.tags?.includes("ramp")) { rampStrips++; continue; }
    const deckRect = { ...deck.rect };
    let rect = { ...deck.rect };
    let footprintNote = "";
    // A carrier the deck FULLY SURROUNDS (the deck extends beyond it on all four
    // sides) that RISES above the deck plane as a solid non-landable mass is a
    // "rising core": a tower shaft, a steeple lantern. The deck is either a ring
    // around that core or a cap on top of it — a fact about the delivered mesh,
    // not the hull — so it is recorded here and resolved when the geometry is
    // actually sampled (see the annulus rescue in run()).
    const coreRects = [];
    if (deck.carriedBy && deck.carriedBy.length > 0) {
      const carriers = deck.carriedBy.map((id) => massById.get(id)).filter(Boolean);
      const supports = [];
      for (const m of carriers) {
        if (isRisingCore(deck, m)) coreRects.push({ ...m.rect });
        else supports.push(m);
      }
      // Sample over the deck ∩ the body that carries it from beneath: the jetty
      // lip that oversails the wall is authored standoff with deliberately no
      // mesh under it, and sampling it would be a false red. (Rising cores are
      // excluded from this clip — they do not carry the deck from beneath.)
      if (supports.length > 0) {
        const cu = {
          minX: Math.min(...supports.map((m) => m.rect.minX)),
          maxX: Math.max(...supports.map((m) => m.rect.maxX)),
          minZ: Math.min(...supports.map((m) => m.rect.minZ)),
          maxZ: Math.max(...supports.map((m) => m.rect.maxZ)),
        };
        const clipped = intersectRect(rect, cu);
        if (rectValid(clipped)) { rect = clipped; footprintNote = "over carrier"; }
      }
    }
    affordances.push({
      kind: "DECK",
      id: deck.id,
      section: deck.section,
      h: deck.y,
      rect,
      deckRect,
      coreRects,
      carriedBy: deck.carriedBy ?? [],
      note: footprintNote,
    });
  }

  // 2. Landable masses — vault/cover/obstacle tops the envelope check trusts.
  for (const mass of level.masses) {
    if (!mass.landable) continue;
    if (!Number.isFinite(mass.topY)) continue;
    affordances.push({
      kind: "MASS_TOP",
      id: mass.id,
      section: mass.section,
      h: mass.topY,
      rect: { ...mass.rect },
      round: Boolean(mass.round),
    });
  }

  // 3. Climb arrivals — is there a real surface to land on at the top of each
  //    authored ascent, plus a face to go up.
  for (const climb of level.climbs) {
    const destY = compiled.surfaceY(climb.onto);
    const ontoMass = massById.get(climb.onto);
    const ontoDeck = compiled.deckById?.get(climb.onto);
    const ontoRect = ontoMass ? { ...ontoMass.rect } : ontoDeck ? { ...ontoDeck.rect } : null;
    affordances.push({
      kind: "CLIMB_TO",
      id: climb.id,
      section: climb.section,
      h: destY,
      rect: { ...climb.rect },
      onto: climb.onto,
      ontoRect,
      footY: (climb.standMinY + climb.standMaxY) / 2,
      unresolved: destY === null,
    });
  }

  // 4. Leap-of-faith / dive catch targets. A catch is a circular acceptance
  //    radius, so it is sampled over the inscribed disc, not the bounding square
  //    (the corners are outside any body the dive resolves onto).
  for (const c of level.catches) {
    affordances.push({
      kind: "CATCH",
      id: c.id,
      section: c.section,
      h: c.centre[1],
      rect: centredRect(c.centre[0], c.centre[2], c.radiusM),
      circle: { cx: c.centre[0], cz: c.centre[2], r: c.radiusM },
      catchKind: c.kind,
    });
  }

  return { affordances, rampStrips };
}

// ---------------------------------------------------------------- run
function placedAabbOverlapsColumn(placed, rect, h) {
  if (!placed.min) return false;
  if (!rectsOverlapXZ(placed.min[0], placed.max[0], placed.min[2], placed.max[2], rect.minX, rect.maxX, rect.minZ, rect.maxZ)) return false;
  return placed.max[1] >= h - DEEP_SEARCH_BELOW_M - EPS && placed.min[1] <= h + SEARCH_ABOVE_M + EPS;
}

async function run(options) {
  const { level, placements, compiled } = await loadLevel();
  const { affordances, rampStrips } = enumerateAffordances({ level, compiled });

  // Pre-place every placement once (cached), and record load status.
  const placed = placements.map((p, i) => ({ placement: p, index: i, record: loadPlaced(p, i), asset: p.asset }));
  const loadStatus = new Map();
  for (const pl of placed) loadStatus.set(pl.record.status, (loadStatus.get(pl.record.status) ?? 0) + 1);

  // Climb LADDERS are excluded from the SURFACE sampler because they are NOT A
  // STANDABLE SURFACE — not because they lack collision. They are solid now (a
  // body cannot walk through one), but the mover never LANDS on a leaning ladder:
  // it is the thing the player grips and climbs, never a floor another affordance
  // rests on. Sampling one as "stone under this affordance" is wrong twice over —
  // it is not a floor, and this flat-plane placement cannot reproduce its lean, so
  // its upright rungs would poke a false surface over a real one (the leaning
  // ladder over the Hollis buttress read the buttress top +0.47m PROUD). Their
  // solidity is verified where it belongs: check-world-collision (a drawn solid)
  // and check-playthrough (no body inside one, no route walled). Here they are
  // excluded exactly as the ground plates are — present, not sampled as a surface.
  const sampleable = placed.filter((pl) => !pl.asset.startsWith("work-ladder"));

  const rows = [];
  for (const aff of affordances) {
    if (aff.unresolved || aff.h === null || aff.h === undefined) {
      rows.push({ ...aff, result: null, verdict: { rank: -1, label: "UNRESOLVED", reason: `onto '${aff.onto}' has no resolvable surface height` } });
      continue;
    }
    // Street-level affordances rest on the ground-plate system, not on scenery
    // GLBs; they are not sampled here and are trivially satisfied by the ground.
    if (aff.h <= 0.35) {
      rows.push({ ...aff, result: null, verdict: { rank: -2, label: "GROUND", reason: "street-level; carried by the ground plates, not a scenery GLB" } });
      continue;
    }
    const candidates = sampleable.filter((pl) => pl.record.status === "OK" && placedAabbOverlapsColumn(pl.record, aff.rect, aff.h));
    // Annulus decks: the deck surrounds a solid rising core (a tower shaft, a
    // steeple lantern). The standable walkway is the RING around that core, so
    // the core footprint is punched out of the sample — a hole in the walkway,
    // not a shortfall of it. A genuinely missing ring still reads red, because
    // the ring itself is what is now sampled.
    const excludeRects = aff.kind === "DECK" && aff.coreRects && aff.coreRects.length ? aff.coreRects : null;
    const baseOpts = {};
    if (excludeRects) baseOpts.excludeRects = excludeRects;
    if (aff.circle) baseOpts.circle = aff.circle;
    let result = sampleSurface(candidates, aff.rect, aff.h, baseOpts);
    let sampledRect = aff.rect;
    let modelNote = excludeRects ? "ring around a solid rising core" : "";
    let face = null;
    if (aff.kind === "CLIMB_TO" && aff.footY !== undefined) {
      face = sampleFace(candidates, aff.rect, aff.footY, aff.h);
    }
    let verdict = severityOf(aff.kind, result);

    // Offset / mantle climbs: the body does not rise straight up — it pulls up
    // onto an arrival surface that is laterally offset from where it stands (a
    // buttress top set back from the wall; a ridge or ledge the standing spot
    // only half overlaps, the rest of the foot hanging over the slope below).
    // The standing footprint then samples that lower surface and reads a miss.
    // When the standing-footprint sample is flagged AND the ascent's own `onto`
    // target genuinely presents a surface where the body arrives, re-judge on
    // that arrival footprint. Applies to any flagged rank (not only OFF/SEVERE),
    // because the mechanism is identical whether it scored 60% or 25%; it is
    // adopted ONLY when strictly better, so a genuine overhang past the ledge
    // edge or a gappy deck (the arrival is itself partial) stays flagged.
    if (aff.kind === "CLIMB_TO" && verdict.rank >= 1 && aff.ontoRect) {
      const arrival = intersectRect(aff.rect, aff.ontoRect);
      if (rectValid(arrival)) {
        const arrivalCands = sampleable.filter((pl) => pl.record.status === "OK" && placedAabbOverlapsColumn(pl.record, arrival, aff.h));
        // If the onto is itself an annulus deck, punch its rising core out of the
        // arrival too, so a climb whose footprint fell over the hole cannot pass.
        const arrivalExclude = ontoCoreRects(aff.onto, compiled);
        const arrivalResult = sampleSurface(arrivalCands, arrival, aff.h, arrivalExclude.length ? { excludeRects: arrivalExclude } : {});
        const arrivalVerdict = severityOf(aff.kind, arrivalResult);
        if (arrivalVerdict.rank < verdict.rank) {
          result = arrivalResult;
          verdict = arrivalVerdict;
          sampledRect = arrival;
          modelNote = "arrival offset from standing footprint (mantle)";
        }
      }
    }

    if (modelNote) verdict = { ...verdict, reason: `${verdict.reason} [${modelNote}]` };
    rows.push({ ...aff, rect: sampledRect, result, face, verdict, candidateAssets: [...new Set(candidates.map((c) => c.asset))] });
  }

  return { rows, rampStrips, loadStatus, placedCount: placements.length, options };
}

// ---------------------------------------------------------------- reporting
function fmtRow(r) {
  const loc = `[${r.rect.minX.toFixed(1)}..${r.rect.maxX.toFixed(1)} x ${r.rect.minZ.toFixed(1)}..${r.rect.maxZ.toFixed(1)}]`;
  const head = `${r.verdict.label.padEnd(9)} ${r.section.padEnd(11)} ${r.kind.padEnd(9)} ${r.id}`;
  const claim = `plane ${Number(r.h).toFixed(2)}m ${loc}`;
  const prov = r.result?.provider ? `  <- ${r.result.provider}` : r.candidateAssets && r.candidateAssets.length ? `  <- ${r.candidateAssets.join(",")}` : "";
  let face = "";
  if (r.face && r.face.faceFraction !== null) face = `; face ${Math.round(r.face.faceFraction * 100)}% vertical (${r.face.crossing} tris)`;
  return `  ${head}\n      ${claim}\n      ${r.verdict.reason}${prov}${face}`;
}

function report(data) {
  const { rows } = data;
  const scored = rows.filter((r) => r.verdict.rank >= 0);
  const red = scored.filter((r) => r.verdict.rank >= 1).sort((a, b) => {
    if (b.verdict.rank !== a.verdict.rank) return b.verdict.rank - a.verdict.rank;
    const ad = a.result ? Math.abs(a.result.medianDelta ?? 0) + (1 - a.result.coverageBand) : 0;
    const bd = b.result ? Math.abs(b.result.medianDelta ?? 0) + (1 - b.result.coverageBand) : 0;
    return bd - ad;
  });
  const green = scored.filter((r) => r.verdict.rank === 0);
  const unresolved = rows.filter((r) => r.verdict.rank === -1);
  const ground = rows.filter((r) => r.verdict.rank === -2);

  console.log("world-affordances: does the delivered geometry present the surfaces the route was authored against?\n");
  console.log(`  ${data.placedCount} scenery placements; load status: ` +
    [...data.loadStatus.entries()].map(([k, v]) => `${k}=${v}`).join(", "));
  console.log(`  ${rampStripsLine(data)}`);
  console.log(`  ${scored.length} geometry-verifiable affordances scored; ${ground.length} street-level (ground plates); ${unresolved.length} unresolved.\n`);

  console.log(`  RESULT: ${green.length} satisfied, ${red.length} NOT satisfied (or flagged for review).`);
  const byRank = { CRITICAL: 0, SEVERE: 0, OFF: 0, MARGINAL: 0, PARTIAL: 0, PROUD: 0 };
  for (const r of red) byRank[r.verdict.label] = (byRank[r.verdict.label] ?? 0) + 1;
  console.log(`  breakdown: ${byRank.CRITICAL} CRITICAL (nothing under), ${byRank.SEVERE} SEVERE, ${byRank.OFF} OFF, ${byRank.MARGINAL} MARGINAL, ${byRank.PARTIAL} PARTIAL (round/clustered obstacle: top reaches plane, no continuous surface), ${byRank.PROUD} PROUD (mesh proud of the authored blocker top; a peaked/sloped cover or vault, not a hole).\n`);

  if (red.length) {
    console.log("  ===================== RANKED RED LIST =====================");
    for (const r of red) console.log(fmtRow(r));
    console.log("");
  }
  if (unresolved.length) {
    console.log("  ----- unresolved (authored 'onto' has no surface height; cannot score) -----");
    for (const r of unresolved) console.log(`    ${r.id}: ${r.verdict.reason}`);
    console.log("");
  }
  if (green.length) {
    console.log(`  ----- satisfied (${green.length}) -----`);
    for (const r of green) console.log(`    OK   ${r.section.padEnd(11)} ${r.kind.padEnd(9)} ${r.id}  (${r.verdict.reason})`);
    console.log("");
  }

  // per-section rollup
  const bySection = new Map();
  for (const r of scored) {
    const s = bySection.get(r.section) ?? { red: 0, green: 0 };
    if (r.verdict.rank >= 1) s.red++; else s.green++;
    bySection.set(r.section, s);
  }
  console.log("  ----- by section -----");
  for (const [s, v] of [...bySection.entries()].sort()) console.log(`    ${s.padEnd(12)} ${v.green} satisfied / ${v.red} red`);
}

function rampStripsLine(data) {
  return `${data.rampStrips} ramp strips excluded (invisible stepped collision under a dressing asset).`;
}

// ---------------------------------------------------------------- the gate
/** The headline number a debt row is judged on: a mass top's own reach, else the walked/arrived surface. */
function rowDelta(r) {
  if (!r.result) return 0;
  return r.kind === "MASS_TOP" ? (r.result.maxDelta ?? 0) : (r.result.medianDelta ?? 0);
}

/**
 * Compare the live measurement against KNOWN_DEBT and decide pass/fail.
 *
 * FAILS on: any flagged affordance NOT on the debt list (a previously satisfied
 * surface gone red), and any listed affordance measured WORSE than its recorded
 * number. PASSES a list that shrinks — an entry that improved off the list, or an
 * affordance a route edit removed, is reported, never failed. Prints the whole
 * debt list loudly, grouped by category, on every run.
 */
function gate(data, { reportOnly = false } = {}) {
  const flagged = data.rows.filter((r) => r.verdict.rank >= 1);
  const seen = new Set();
  const newlyRed = [];
  const worsened = [];
  const held = []; // matched a debt entry, not worse

  for (const r of flagged) {
    const key = `${r.kind}:${r.id}`;
    const debt = KNOWN_DEBT.get(key);
    const current = { rank: r.verdict.rank, band: r.result?.coverageBand ?? 0, delta: rowDelta(r) };
    if (!debt) { newlyRed.push({ key, r, current }); continue; }
    seen.add(key);
    const reasons = gateWorse(current, debt);
    if (reasons.length) worsened.push({ key, r, current, debt, reasons });
    else held.push({ key, r, current, debt });
  }
  const resolved = [...KNOWN_DEBT.keys()].filter((k) => !seen.has(k));

  // The debt, printed loudly, grouped by what it means.
  console.log("world-affordances GATE: the itemised, accepted red list — loud on every run.\n");
  console.log(`  ${data.placedCount} scenery placements; ${flagged.length} flagged, ${KNOWN_DEBT.size} on the debt list.\n`);
  const heldByKey = new Map(held.map((h) => [h.key, h]));
  const worseByKey = new Map(worsened.map((w) => [w.key, w]));
  for (const [cat, blurb] of Object.entries(DEBT_CATEGORIES)) {
    const keys = [...KNOWN_DEBT.entries()].filter(([, v]) => v.category === cat).map(([k]) => k);
    console.log(`  == ${cat} (${keys.length}) ==`);
    console.log(`     ${blurb}`);
    for (const key of keys) {
      const debt = KNOWN_DEBT.get(key);
      let status;
      if (worseByKey.has(key)) status = `WORSE: ${worseByKey.get(key).reasons.join("; ")}`;
      else if (heldByKey.has(key)) status = "held";
      else status = "RESOLVED (improved off the list — safe to remove)";
      console.log(`     - ${key}  [band ${(debt.band * 100).toFixed(0)}%, surface ${debt.delta.toFixed(2)}m]  ${status}`);
      console.log(`         ${debt.note}`);
    }
    console.log("");
  }

  const blocking = newlyRed.length > 0 || worsened.length > 0;
  if (newlyRed.length) {
    console.error(`  FAIL: ${newlyRed.length} affordance(s) newly flagged and NOT on the debt list (a regression):`);
    for (const n of newlyRed) {
      console.error(`    error: ${n.key}  ${n.r.verdict.label}  ${n.r.verdict.reason}`);
    }
    console.error("");
  }
  if (worsened.length) {
    console.error(`  FAIL: ${worsened.length} debt entr(y/ies) measured WORSE than recorded:`);
    for (const w of worsened) {
      console.error(`    error: ${w.key}  ${w.reasons.join("; ")}`);
    }
    console.error("");
  }
  if (resolved.length) {
    console.log(`  ${resolved.length} debt entr(y/ies) resolved (improved off the list; the list may shrink freely):`);
    for (const k of resolved) console.log(`    resolved: ${k}`);
    console.log("");
  }

  if (blocking && !reportOnly) {
    console.error("  A surface the route depends on regressed. Fix the asset/authoring so the mesh\n" +
      "  meets the plane again, or — only if it is a newly ACCEPTED, measured, itemised\n" +
      "  debt — add it to KNOWN_DEBT with its number and category. Never widen a\n" +
      "  threshold to make this pass.");
    return 1;
  }
  console.log(`world-affordances GATE: OK (${held.length} known debt held at or under its recorded number, ` +
    `${resolved.length} resolved; no new or worsened red).`);
  return 0;
}

// ---------------------------------------------------------------- selftest
function boxGlb({ sx, sy, sz }) {
  // A unit-ish box centred on X/Z, sitting from y=0 to y=sy, sized sx x sy x sz.
  const hx = sx / 2;
  const hz = sz / 2;
  const corners = [
    [-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz],
    [-hx, sy, -hz], [hx, sy, -hz], [hx, sy, hz], [-hx, sy, hz],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], // bottom
    [4, 6, 5], [4, 7, 6], // top
    [0, 4, 5], [0, 5, 1],
    [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3],
    [3, 7, 4], [3, 4, 0],
  ];
  const pos = Buffer.alloc(corners.length * 12);
  corners.forEach((c, i) => c.forEach((v, a) => pos.writeFloatLE(v, (i * 3 + a) * 4)));
  const idx = Buffer.alloc(faces.length * 3 * 2);
  let o = 0;
  for (const f of faces) for (const v of f) { idx.writeUInt16LE(v, o); o += 2; }
  const pad = (b) => Buffer.concat([b, Buffer.alloc((-b.length % 4 + 4) % 4)]);
  const posV = pad(pos);
  const idxV = pad(idx);
  const bin = Buffer.concat([posV, idxV]);
  const min = [-hx, 0, -hz];
  const max = [hx, sy, hz];
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: corners.length, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5123, count: faces.length * 3, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: posV.length, byteLength: idx.length },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((-jsonBuf.length % 4 + 4) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "world-afford-"));
  let failed = 0;
  const check = (label, ok, detail) => {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(46)} ${detail}`);
  };
  console.log("world-affordances selftest: place a box of known size and prove the ray-cast\n  finds its top face where geometry — not the authored number — puts it.\n");

  // A 4 x 3 x 4 box, natural. Place it (PROP contain-fit) into a box of the same
  // size at pos (10, 0, 20): the top should be an exact horizontal plane at 3m.
  const file = join(dir, "box.glb");
  writeFileSync(file, boxGlb({ sx: 4, sy: 3, sz: 4 }));
  const doc = glbDocument(readFileSync(file));
  const { tris } = staticTriangles(doc);
  const b = triBounds(tris);
  const place = (fit, size, pos, yaw) => {
    const map = placementMapper({ fit, size, pos, yaw }, b.min, b.max);
    return tris.map((t) => [map(t[0]), map(t[1]), map(t[2])]);
  };

  // Case 1: PROP fit into exactly its own box -> top at 3.0m.
  {
    const placedTris = place("PROP", [4, 3, 4], [10, 0, 20], 0);
    const cand = [{ asset: "box", record: { tris: placedTris, ...triBounds(placedTris) } }];
    const r = sampleSurface(cand, centredRect(10, 20, 1.5), 3.0);
    check("box top found at authored 3.0m", r.coverageBand > 0.95 && Math.abs(r.medianDelta) < 0.05,
      `coverage=${(r.coverageBand * 100).toFixed(0)}% delta=${r.medianDelta?.toFixed(3)}m`);
  }
  // Case 2: the SAME authored plane at 5.0m, mesh only reaches 3.0m -> a 2.0m
  // shortfall must be reported, not passed.
  {
    const placedTris = place("PROP", [4, 3, 4], [10, 0, 20], 0);
    const cand = [{ asset: "box", record: { tris: placedTris, ...triBounds(placedTris) } }];
    const r = sampleSurface(cand, centredRect(10, 20, 1.5), 5.0);
    check("mesh 2m short reports the shortfall", r.coverageBand < 0.05 && r.medianDelta !== null && Math.abs(r.medianDelta + 2) < 0.05,
      `coverage@plane=${(r.coverageBand * 100).toFixed(0)}% delta=${r.medianDelta?.toFixed(3)}m`);
  }
  // Case 3: nothing under the plane at all (sample away from the box).
  {
    const placedTris = place("PROP", [4, 3, 4], [10, 0, 20], 0);
    const cand = [{ asset: "box", record: { tris: placedTris, ...triBounds(placedTris) } }];
    const r = sampleSurface(cand, centredRect(40, 20, 1.5), 3.0);
    check("no geometry under plane -> nothing found", r.coverageAny < 0.05,
      `coverageAny=${(r.coverageAny * 100).toFixed(0)}%`);
  }
  // Case 4: contain-fit shrink. A 4x3x4 mesh into a WIDE box [12,3,4] contain-fits
  // uniformly by min ratio (3/3=1 on Y is the binder... here x ratio 3, y 1, z 1
  // -> min 1) so the top stays at 3.0m and the footprint stays 4 wide, NOT 12.
  {
    const placedTris = place("PROP", [12, 3, 4], [0, 0, 0], 0);
    const pb = triBounds(placedTris);
    check("contain-fit keeps top at 3.0m, width 4 not 12",
      Math.abs(pb.max[1] - 3) < 0.01 && Math.abs(pb.max[0] - pb.min[0] - 4) < 0.01,
      `placed size ${(pb.max[0] - pb.min[0]).toFixed(2)} x ${(pb.max[1] - pb.min[1]).toFixed(2)} x ${(pb.max[2] - pb.min[2]).toFixed(2)}`);
  }
  // Case 5: MODULE fill stretches per axis -> top rises to the box height.
  {
    const placedTris = place("MODULE", [12, 6, 4], [0, 0, 0], 0);
    const pb = triBounds(placedTris);
    check("MODULE fill reaches box top 6m and width 12",
      Math.abs(pb.max[1] - 6) < 0.01 && Math.abs(pb.max[0] - pb.min[0] - 12) < 0.01,
      `placed size ${(pb.max[0] - pb.min[0]).toFixed(2)} x ${(pb.max[1] - pb.min[1]).toFixed(2)} x ${(pb.max[2] - pb.min[2]).toFixed(2)}`);
  }
  // Case 6: yaw places the surface at the rotated world position. A box 4 wide
  // (x) and 8 DEEP (z), fitted 1:1, then yawed 90deg about (5,0,5): its deep
  // axis swings onto world X, so a point 3m along world X — which is OUTSIDE the
  // unrotated 4-wide footprint — must now be over the box top at 3.0m. If yaw
  // were ignored, this point would find nothing.
  {
    const deepFile = join(dir, "deep.glb");
    writeFileSync(deepFile, boxGlb({ sx: 4, sy: 3, sz: 8 }));
    const deepDoc = glbDocument(readFileSync(deepFile));
    const deepTris = staticTriangles(deepDoc).tris;
    const db = triBounds(deepTris);
    const map = placementMapper({ fit: "PROP", size: [4, 3, 8], pos: [5, 0, 5], yaw: Math.PI / 2 }, db.min, db.max);
    const placedTris = deepTris.map((t) => [map(t[0]), map(t[1]), map(t[2])]);
    const cand = [{ asset: "box", record: { tris: placedTris, ...triBounds(placedTris) } }];
    const rotated = sampleSurface(cand, centredRect(5 + 3, 5, 0.5), 3.0);
    // Control: the same point WITHOUT the yaw finds nothing (box only 4 wide).
    const flatMap = placementMapper({ fit: "PROP", size: [4, 3, 8], pos: [5, 0, 5], yaw: 0 }, db.min, db.max);
    const flatTris = deepTris.map((t) => [flatMap(t[0]), flatMap(t[1]), flatMap(t[2])]);
    const flatCand = [{ asset: "box", record: { tris: flatTris, ...triBounds(flatTris) } }];
    const unrotated = sampleSurface(flatCand, centredRect(5 + 3, 5, 0.5), 3.0);
    check("yaw rotates footprint into world",
      rotated.coverageBand > 0.9 && Math.abs(rotated.medianDelta) < 0.05 && unrotated.coverageAny < 0.05,
      `rotated cov=${(rotated.coverageBand * 100).toFixed(0)}% delta=${rotated.medianDelta?.toFixed(3)}m; unrotated finds ${(unrotated.coverageAny * 100).toFixed(0)}%`);
  }

  // ------------------------------------------------------------ shape models
  // The two selftests above prove the ray-cast reads a flat top honestly. These
  // prove the two SHAPE models the sampler must not misjudge — and, in both
  // directions, that the correction never manufactures a pass over geometry that
  // is genuinely absent or short.
  const placeBoxTris = (sx, sy, sz, cx, cz) => {
    const f = join(dir, `syn_${sx}_${sy}_${sz}_${cx}_${cz}.glb`);
    writeFileSync(f, boxGlb({ sx, sy, sz }));
    const d = glbDocument(readFileSync(f));
    const t0 = staticTriangles(d).tris;
    const bb = triBounds(t0);
    const map = placementMapper({ fit: "PROP", size: [sx, sy, sz], pos: [cx, 0, cz], yaw: 0 }, bb.min, bb.max);
    return t0.map((tr) => [map(tr[0]), map(tr[1]), map(tr[2])]);
  };
  const cand = (tris) => ({ asset: "syn", record: { tris, ...triBounds(tris) } });

  // Case 7 — ANNULUS (ring deck around a rising core). A ring surface at 3.0m
  // (outer 8x8, a 4x4 hole in the middle) with a SOLID CORE box rising through
  // that hole to 6.0m. This is the tower plinth / steeple crockets shape.
  {
    const ring = [
      placeBoxTris(8, 3, 2, 0, -3), // north strip, top at 3.0
      placeBoxTris(8, 3, 2, 0, 3), // south strip
      placeBoxTris(2, 3, 4, -3, 0), // west strip
      placeBoxTris(2, 3, 4, 3, 0), // east strip
    ].map(cand);
    const core = cand(placeBoxTris(4, 6, 4, 0, 0)); // rises to 6.0, no top at 3.0
    const all = [...ring, core];
    const deckRect = { minX: -4, maxX: 4, minZ: -4, maxZ: 4 };
    const coreRect = { minX: -2, maxX: 2, minZ: -2, maxZ: 2 };

    // The flat clip to the carrier core reads a false miss: the core is solid
    // rising geometry with nothing standable at the plane.
    const clip = sampleSurface(all, coreRect, 3.0);
    check("annulus: clip to rising core reads a hole", clip.coverageBand < 0.1,
      `core coverage@plane=${(clip.coverageBand * 100).toFixed(0)}%`);

    // Judged on the ring (core punched out) it is a full, flat walkway.
    const ring1 = sampleSurface(all, deckRect, 3.0, { excludeRects: [coreRect] });
    check("annulus: ring (core excluded) is a full walk", ring1.coverageBand > 0.95 && Math.abs(ring1.medianDelta) < 0.05 && severityOf("DECK", ring1).rank === 0,
      `ring coverage=${(ring1.coverageBand * 100).toFixed(0)}% delta=${ring1.medianDelta?.toFixed(3)}m verdict=${severityOf("DECK", ring1).label}`);

    // BOTH-DIRECTIONS: a genuinely absent ring (only the core exists) must still
    // read red after the core is excluded — the fix forgives the hole, never a
    // missing walkway.
    const empty = sampleSurface([core], deckRect, 3.0, { excludeRects: [coreRect] });
    check("annulus: absent ring still reads red", empty.coverageBand < 0.05 && severityOf("DECK", empty).rank >= 3,
      `coverage=${(empty.coverageBand * 100).toFixed(0)}% verdict=${severityOf("DECK", empty).label}`);
  }

  // Case 8 — OFFSET MANTLE (arrival laterally offset from the standing spot). A
  // buttress top at 2.6m over z[0,2]; the player stands at z[1.5,4], mostly OFF
  // the buttress and pulling up onto it. This is the D2->E_BUTTRESS shape.
  {
    const buttress = cand(placeBoxTris(4, 2.6, 2, 2, 1)); // footprint x[0,4] z[0,2], top 2.6
    const climbRect = { minX: 0, maxX: 4, minZ: 1.5, maxZ: 4 };
    const ontoRect = { minX: 0, maxX: 4, minZ: 0, maxZ: 2 };

    // Sampled at the standing footprint it reads a false miss (the body is mostly
    // over ground short of the ledge).
    const standing = sampleSurface([buttress], climbRect, 2.6);
    check("mantle: standing footprint reads a false miss", standing.coverageBand < 0.4 && severityOf("CLIMB_TO", standing).rank >= 2,
      `standing coverage=${(standing.coverageBand * 100).toFixed(0)}% verdict=${severityOf("CLIMB_TO", standing).label}`);

    // Sampled where the body arrives (climb ∩ onto) it is a full flat landing.
    const arrival = sampleSurface([buttress], intersectRect(climbRect, ontoRect), 2.6);
    check("mantle: arrival footprint is a full landing", arrival.coverageBand > 0.95 && severityOf("CLIMB_TO", arrival).rank === 0,
      `arrival coverage=${(arrival.coverageBand * 100).toFixed(0)}% delta=${arrival.medianDelta?.toFixed(3)}m verdict=${severityOf("CLIMB_TO", arrival).label}`);

    // BOTH-DIRECTIONS: a buttress built 2m short still reads red at the arrival —
    // the fix forgives an offset, never a missing or low arrival surface.
    const shortButtress = cand(placeBoxTris(4, 0.6, 2, 2, 1)); // top at 0.6, not 2.6
    const arrivalShort = sampleSurface([shortButtress], intersectRect(climbRect, ontoRect), 2.6);
    check("mantle: short arrival still reads red", arrivalShort.coverageBand < 0.05 && severityOf("CLIMB_TO", arrivalShort).rank >= 3,
      `coverage@plane=${(arrivalShort.coverageBand * 100).toFixed(0)}% delta=${arrivalShort.medianDelta?.toFixed(3)}m verdict=${severityOf("CLIMB_TO", arrivalShort).label}`);
  }

  // A horizontal disc of `r` at height `y`, as a triangle fan — geometry that
  // fills a circular acceptance radius but NOT the corners of its bounding box.
  const diskCand = (cx, cz, r, y, seg = 64) => {
    const tris = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 2 * Math.PI;
      const a1 = ((i + 1) / seg) * 2 * Math.PI;
      tris.push([[cx, y, cz], [cx + r * Math.cos(a0), y, cz + r * Math.sin(a0)], [cx + r * Math.cos(a1), y, cz + r * Math.sin(a1)]]);
    }
    return { asset: "disc", record: { tris, ...triBounds(tris) } };
  };

  // Case 9 — CATCH SAMPLED AS A CIRCLE. A dive catch is a circular acceptance
  // radius; the bounding square's corners lie outside the zone the game catches a
  // body in, and counting them measures a shape the game never uses.
  {
    const r = 2.0;
    const rect = centredRect(0, 0, r);
    const circle = { cx: 0, cz: 0, r };
    // A landing disc that fills the whole acceptance radius.
    const full = [diskCand(0, 0, r, 3.0)];
    const square = sampleSurface(full, rect, 3.0); // corners counted -> false miss
    const disc = sampleSurface(full, rect, 3.0, { circle }); // only the radius
    // The square counts its corners (outside the acceptance radius) as misses;
    // the disc does not. The corner artifact must be visible and removed.
    check("catch: square corners drag a full disc down", square.coverageBand < 0.85 && square.coverageBand < disc.coverageBand - 0.05,
      `square coverage=${(square.coverageBand * 100).toFixed(0)}% vs disc ${(disc.coverageBand * 100).toFixed(0)}%`);
    check("catch: circle sampling reads the full disc", disc.coverageBand > 0.95 && severityOf("CATCH", disc).rank === 0,
      `circle coverage=${(disc.coverageBand * 100).toFixed(0)}% verdict=${severityOf("CATCH", disc).label}`);

    // BOTH-DIRECTIONS: a landing smaller than the acceptance radius (a real
    // catch-radius-versus-surface gap) still reads red under circle sampling —
    // the annular gap inside the radius is a genuine miss, not a corner artifact.
    const smallDisc = [diskCand(0, 0, r * 0.5, 3.0)];
    const gap = sampleSurface(smallDisc, rect, 3.0, { circle });
    check("catch: surface smaller than radius still red", gap.coverageBand < 0.6 && severityOf("CATCH", gap).rank >= 2,
      `circle coverage=${(gap.coverageBand * 100).toFixed(0)}% verdict=${severityOf("CATCH", gap).label}`);
  }

  // Case 10 — SUB-SEVERE OFFSET CLIMB. The arrival rule applies at any flagged
  // rank, not only OFF/SEVERE: a MARGINAL standing footprint that half-overlaps
  // its ledge is the same mechanism as the buttress, and is re-judged on the
  // arrival. A genuine overhang (the ledge itself gappy) is NOT rescued.
  {
    const ledge = cand(placeBoxTris(4, 2.6, 3, 2, 1)); // ledge top 2.6 over z[-0.5,2.5]
    const lower = cand(placeBoxTris(4, 0.6, 2, 2, 4)); // a lower surface at 0.6 over z[3,5]
    const onto = { minX: 0, maxX: 4, minZ: -0.5, maxZ: 2.5 };
    const climbRect = { minX: 0, maxX: 4, minZ: 0.7, maxZ: 3.1 }; // 75% over ledge, tail over the low deck
    const standing = sampleSurface([ledge, lower], climbRect, 2.6);
    const sv = severityOf("CLIMB_TO", standing);
    check("subsevere climb: standing reads MARGINAL", sv.rank === 1,
      `standing coverage=${(standing.coverageBand * 100).toFixed(0)}% verdict=${sv.label}`);
    const arrival = sampleSurface([ledge, lower], intersectRect(climbRect, onto), 2.6);
    const av = severityOf("CLIMB_TO", arrival);
    check("subsevere climb: arrival clears it", av.rank < sv.rank && av.rank === 0,
      `arrival coverage=${(arrival.coverageBand * 100).toFixed(0)}% verdict=${av.label}`);

    // BOTH-DIRECTIONS: an overhang past a gappy ledge — the arrival footprint is
    // itself only partly covered, so it is NOT strictly better and stays flagged.
    const gappyLedge = cand(placeBoxTris(3, 2.6, 3, 1.5, 1)); // ledge only over x[0,3]
    const ontoGappy = { minX: 0, maxX: 4, minZ: -0.5, maxZ: 2.5 }; // authored wider than the mesh
    const climbG = { minX: 0, maxX: 4, minZ: 0, maxZ: 2 }; // x[3,4] hangs past the ledge
    const standG = sampleSurface([gappyLedge], climbG, 2.6);
    const arrG = sampleSurface([gappyLedge], intersectRect(climbG, ontoGappy), 2.6);
    check("subsevere climb: overhang not rescued", severityOf("CLIMB_TO", arrG).rank >= severityOf("CLIMB_TO", standG).rank && severityOf("CLIMB_TO", arrG).rank >= 1,
      `standing=${severityOf("CLIMB_TO", standG).label} arrival=${severityOf("CLIMB_TO", arrG).label}`);
  }

  // Case 11 — PROUD (overshoot) vs a shortfall. A mass top ABOVE the plane is
  // solid geometry meeting and exceeding the blocker — a peaked/sloped cover, not
  // a hole — and gets its own verdict, distinct from a top BELOW the plane.
  {
    const proudTop = cand(placeBoxTris(4, 3.5, 4, 0, 0)); // top at 3.5, plane 3.0 -> +0.5
    const rProud = sampleSurface([proudTop], centredRect(0, 0, 1.5), 3.0);
    check("proud: mesh above the plane reads PROUD", severityOf("MASS_TOP", rProud).label === "PROUD",
      `max=${rProud.maxDelta?.toFixed(2)} verdict=${severityOf("MASS_TOP", rProud).label}`);
    // BOTH-DIRECTIONS: a mass top BELOW the plane is a shortfall, never PROUD.
    const shortTop = cand(placeBoxTris(4, 2.5, 4, 0, 0)); // top at 2.5, plane 3.0 -> -0.5
    const rShort = sampleSurface([shortTop], centredRect(0, 0, 1.5), 3.0);
    const svShort = severityOf("MASS_TOP", rShort);
    check("proud: mesh below the plane is a shortfall, not proud", svShort.label !== "PROUD" && svShort.rank >= 1,
      `max=${rShort.maxDelta?.toFixed(2)} verdict=${svShort.label}`);
  }

  rmSync(dir, { recursive: true, force: true });
  console.log(failed === 0
    ? "\nworld-affordances selftest: OK (mesh height read honestly; a short mesh reads short; a ring\n  judged on its ring; a mantle where the body arrives; a catch over its acceptance disc;\n  and a top proud of its blocker told apart from a hole)"
    : `\nworld-affordances selftest: FAIL (${failed} case(s))`);
  return failed;
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) {
    process.exit(selfTest() === 0 ? 0 : 1);
  }
  const verifyFit = argv.find((a) => a.startsWith("--verify-fit="));
  const asJson = argv.includes("--json");
  const isGate = argv.includes("--gate");
  const reportOnly = argv.includes("--report");

  // The gate proves its instrument before it measures anything — a gate whose
  // sampler is wrong would fail (or pass) for the wrong reason.
  if (isGate && selfTest() !== 0) {
    console.error("\nworld-affordances: refusing to gate with a broken instrument.");
    process.exit(1);
  }

  const data = await run({ allNodes: argv.includes("--all-nodes") });

  if (isGate) {
    console.log("");
    process.exit(gate(data, { reportOnly }) === 0 ? 0 : 1);
  }

  if (verifyFit) {
    const id = verifyFit.split("=")[1];
    const { placements } = await loadLevel();
    const idx = placements.findIndex((p) => p.id === id);
    if (idx < 0) { console.error(`no placement ${id}`); process.exit(2); }
    const rec = loadPlaced(placements[idx], idx);
    const p = placements[idx];
    console.log(`placement ${id} (${p.asset}, fit ${p.fit})`);
    console.log(`  authored size ${p.size.map((v) => v.toFixed(2)).join(" x ")}m at pos ${p.pos.map((v) => v.toFixed(2)).join(", ")}, yaw ${p.yaw.toFixed(3)}`);
    if (rec.min) {
      console.log(`  placed bounds min ${rec.min.map((v) => v.toFixed(2)).join(", ")}  max ${rec.max.map((v) => v.toFixed(2)).join(", ")}`);
      console.log(`  placed size ${(rec.max[0] - rec.min[0]).toFixed(2)} x ${(rec.max[1] - rec.min[1]).toFixed(2)} x ${(rec.max[2] - rec.min[2]).toFixed(2)}m  (status ${rec.status})`);
    } else console.log(`  status ${rec.status}`);
    process.exit(0);
  }

  if (asJson) {
    console.log(JSON.stringify(data.rows.map((r) => ({
      kind: r.kind, id: r.id, section: r.section, h: r.h,
      rect: r.rect, verdict: r.verdict.label, reason: r.verdict.reason,
      result: r.result, face: r.face, candidateAssets: r.candidateAssets,
    })), null, 2));
    process.exit(0);
  }

  report(data);
  // Not a gate: this is a diagnostic and is EXPECTED red. Always exit 0 so it can
  // never break a build for anyone until the world is rebuilt to satisfy it.
  process.exit(0);
}

// ---------------------------------------------------------------- wiring it in
// HOW IT IS WIRED. `--gate` is a blocking step: `pnpm verify:affordances` runs it
// beside `assets:verify:collision` and `assets:verify:placement` in package.json
// and .github/workflows/ci.yml. It self-tests first (refuses to gate with a
// broken instrument), measures the published world, and exits non-zero on any
// affordance flagged that is NOT on KNOWN_DEBT, or any debt entry measured worse
// than its recorded number (see `gate` / `gateWorse`).
//
//   1. It does NOT require the whole list green — the world is not yet rebuilt to
//      present every surface. It requires the red list to never GROW silently:
//      the accepted debt is itemised, measured, categorised and printed loudly on
//      every run, and anything new or worsened fails. The list may shrink freely.
//   2. It runs under the TypeScript loader (`node --import tsx`) because it calls
//      the level's own `sceneryPlacements()`, so it lives beside `verify:content`
//      and the asset verifiers, which already do.
//   3. It never gates by loosening a tolerance: the horizontality band and align
//      tolerances are fixed. A regression is fixed in the asset/authoring lane,
//      or — only if it is a newly ACCEPTED, measured problem — added to KNOWN_DEBT
//      with its number and category. The debt list is a record, not a mute.
//   4. Nothing here weakens an existing invariant: the penetration/traversability
//      tests keep running on the authored hulls. This gate is ADDITIVE — it
//      asserts the delivered mesh MEETS those hulls, which nothing else does.
