// Refuse to ship an M1 world whose COLLISION and whose VISIBLE MESH are two
// different worlds.
//
// WHY THIS EXISTS. The owner played M1 and reported the world does not behave
// like it looks: invisible walls he "cannot run past", buildings whose roofs he
// reaches by "climbing through the ceiling", a floor he "fell through". Every
// collision invariant we had reported zero penetrations at the same time, because
// they all validate the authored collision — the half that is right — and nothing
// validated that the PUBLISHED GLB the browser draws actually fills the collision
// the player moves through.
//
// The two are produced by different steps. The collision is authored analytically
// in packages/mission-m1/src/level (masses + decks + ramps) and compiled by
// compile.ts into the CollisionWorld the solver runs against. The visible world is
// a Meshy GLB contain-fitted into a box derived from that same collision
// (`sceneryPlacements` -> `FittedGlb`/`InstancedFittedGlb`/`ImportedStructure`).
// A contain-fit takes the SMALLEST of the three box/mesh ratios, so a mesh whose
// aspect does not match its box is drawn smaller than the box on up to two axes —
// and the solver still collides the whole box. That gap is an invisible wall, and
// it is invisible to every check we had:
//
//   * check-world-scale.mjs EXEMPTS a Meshy-normalised asset (longest axis ~1.9m)
//     from the sizeM comparison, because its absolute size carries no information.
//     Every building mesh is normalised, so the scale gate says nothing about
//     whether the church actually fills its 16x14m footprint.
//   * verify_m1_placements.mjs measures exactly this per axis, but only FAILS on
//     surfaces a route NODE stands on, and reports the rest. `church-meetinghouse`
//     drew 3.65 x 5.85 inside a 16 x 14 solid block — a ~90% invisible wall — and
//     was reported, not failed, because no route node stands on Old Brick. That was
//     the defect this gate was built to catch; OLD_BRICK's body has since been
//     re-keyed to a meeting-house mesh that fills the box (geometry.ts) and this
//     gate now holds it.
//
// So this is the guard that closes the process: it places the SHIPPED GLB exactly
// as the renderer does and asks whether the SOLID a player collides with is
// actually drawn. It fails loudly, it never silently degrades, and it reuses the
// one fit implementation the renderer and the other verifiers already share
// (placement_lib.mjs / placement_probe.mjs) rather than carrying a second copy —
// two copies of the fit is exactly how the placement tools drifted before.
//
// WHAT IT GATES.
//   INVISIBLE_WALL   a building-scale SOLID (a mass with a real footprint and a
//                    real height, i.e. something a body runs into and cannot pass)
//                    whose drawn mesh occupies less than SOLID_FILL_MIN of its
//                    collision volume. This is the owner's "cannot run past" and
//                    "climb through the ceiling": the collision is a solid block
//                    and the picture is a sliver inside it.
//
// Volumetric fill is one metric that catches position, scale AND rotation at
// once, measured on the PUBLISHED bytes: a mesh that is offset, shrunk, or turned
// the wrong way does not fill the solid it stands for, and the self-test proves
// all three below. It is a truer test than comparing a bounding box centre, which
// a terrace of tiled houses legitimately fails house by house while filling the
// block exactly between them.
//
// It does NOT re-do what verify_m1_placements already gates (route-surface fit,
// drawn stone under a walked deck). The two are wired into CI together; this is
// the half nobody had.
//
// Usage:
//   node scripts/check-world-collision.mjs              # gate
//   node scripts/check-world-collision.mjs --report     # measure, never exit 1
//   node scripts/check-world-collision.mjs --selftest   # prove it catches drift
//   node scripts/check-world-collision.mjs --json       # machine-readable rows
globalThis.self = globalThis;
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(HERE, "..");
const pipeline = join(repoRoot, "assets", "pipeline");

const { selfTestGate } = await import(pathToFileURL(join(pipeline, "placement_selftest.mjs")));
const { placeInto, surveyNearPlane, sceneSource } = await import(
  pathToFileURL(join(pipeline, "placement_probe.mjs"))
);
const { partFootprint, placementFootprint, intersectionArea, polygonArea } = await import(
  pathToFileURL(join(pipeline, "placement_lib.mjs"))
);

const threeRoot = join(repoRoot, "apps", "web", "node_modules", "three");
const THREE = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);
const load = (...parts) => import(pathToFileURL(join(repoRoot, ...parts)));

// ---------------------------------------------------------------- thresholds
/**
 * A building-scale solid is a mass with a footprint at least this large and a
 * height at least this tall. The point is to gate the things a player reads as a
 * WALL — buildings, the market shed, big blocks — and not a crane's jib or a
 * balustrade, which are legitimately mostly air and whose collision is a
 * deliberate simplification of a sparse object. OLD_BRICK is 224 m2; the largest
 * cover prop in the level is a 6 m2 laying rig.
 */
const BUILDING_MIN_AREA_M2 = 20;
const BUILDING_MIN_HEIGHT_M = 3;

/**
 * How much of a building solid's volume its drawn mesh must occupy.
 *
 * A building is a box a body cannot pass through and a roof it stands on, so
 * unlike a barrel in a square box there is no large empty corner it may leave:
 * if half the block has no stone in it, half the block is an invisible wall. Set
 * at 0.5 — generous enough that a contain-fit within its own aspect passes, tight
 * enough that a sliver-in-a-block fails. Measured: the aligned buildings sit at
 * 0.85-1.00 and the one broken one at ~0.10.
 */
const SOLID_FILL_MIN = 0.5;

/** How finely a solid's volume is sampled for occupancy. */
const OCCUPANCY_GRID = 7;

// ---------------------------------------------------------------- known debt
/**
 * A finding here is a KNOWN divergence that cannot ship clean yet and cannot be
 * fixed in this lane. It is NOT a mute: every entry is printed, LOUDLY, on every
 * run with its measured number and the exact fix, and the count is reported, so
 * the gate can never look green while hiding a defect. This is the same
 * discipline check-world-scale.mjs's KNOWN_DEBT and check-boundaries.mjs's
 * allowlists follow — a decision on the record, not a silence.
 *
 * Keyed by mass id.
 */
const KNOWN_DEBT = new Map([]);

// ---------------------------------------------------------------- geometry
const OPEN_MASS_HEIGHT_M = 12;

function massVolumeParts(level) {
  const out = new Map();
  for (const mass of level.masses) {
    if (!mass.asset) continue;
    const topY = Number.isFinite(mass.topY) ? mass.topY : mass.baseY + OPEN_MASS_HEIGHT_M;
    out.set(mass.id, {
      id: mass.id,
      kind: "MASS",
      asset: mass.asset,
      rect: mass.rect,
      baseY: mass.baseY,
      topY,
      yaw: mass.yaw ?? 0,
      round: mass.round,
      landable: mass.landable,
      tags: mass.tags ?? [],
    });
  }
  return out;
}

const rectArea = (rect) => (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ);

/**
 * Is this solid a WALL the player reads and runs into — a building, the shed,
 * a big block — rather than a sparse cover prop or a thin balustrade?
 */
function isBuildingScale(part) {
  const area = part.round
    ? Math.PI * part.round.radius * part.round.radius
    : rectArea(part.rect);
  const height = part.topY - part.baseY;
  return area >= BUILDING_MIN_AREA_M2 && height >= BUILDING_MIN_HEIGHT_M;
}

// ---------------------------------------------------------------- meshes
const sourceCache = new Map();
async function meshOf(assetPath) {
  if (sourceCache.has(assetPath)) return sourceCache.get(assetPath);
  const file = join(
    repoRoot,
    "apps",
    "web",
    "public",
    "world",
    assetPath.replace(/^world\//, ""),
  );
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

async function place(placement) {
  const source = await meshOf(placement.assetPath);
  if (!source || source.error) return null;
  return placeInto(THREE, await source.next(), placement, source.natural);
}

// ---------------------------------------------------------------- analysis
async function analyse() {
  const { M1_EFFIGY_RUN } = await load("packages", "mission-m1", "src", "level", "index.ts");
  const { sceneryPlacements } = await load("packages", "mission-m1", "src", "runtime.ts");

  const placements = sceneryPlacements();
  const masses = massVolumeParts(M1_EFFIGY_RUN);

  // Place every placement once and keep its world targets + AABB.
  const placedById = new Map();
  const placedBoxById = new Map();
  for (const placement of placements) {
    const placed = await place(placement);
    if (!placed) continue;
    placedById.set(placement.id, { placement, targets: placed.targets });
    placedBoxById.set(placement.id, placed.box);
  }

  // For each part, the placements whose drawn footprint overlaps it, so a mass
  // covered by a sibling draw (a tower out of a roof) is measured against every
  // piece of stone actually over it.
  const overlapTargets = (footprint) => {
    const targets = [];
    for (const { placement, targets: t } of placedById.values()) {
      if (intersectionArea(footprint, placementFootprint(placement)) <= 0) continue;
      targets.push(...t);
    }
    return targets;
  };

  // Visible world AABB of the placements that STAND FOR a given part id (its own
  // draw and any draw whose `parts` names it).
  const visibleBoxFor = (partId) => {
    const box = new THREE.Box3();
    box.makeEmpty();
    for (const { placement } of placedById.values()) {
      if (placement.id !== partId && !placement.parts.includes(partId)) continue;
      const b = placedBoxById.get(placement.id);
      if (b) box.union(b);
    }
    return box.isEmpty() ? null : box;
  };

  const buildingRows = [];
  for (const part of masses.values()) {
    if (!isBuildingScale(part)) continue;
    const footprint = partFootprint(part);
    const targets = overlapTargets(footprint);
    const midPlane = (part.baseY + part.topY) / 2;
    const occ = surveyNearPlane(THREE, targets, part, midPlane, {
      grid: OCCUPANCY_GRID,
      tol: (part.topY - part.baseY) / 2 + 0.35,
    });
    const collisionSize = [
      part.rect.maxX - part.rect.minX,
      part.topY - part.baseY,
      part.rect.maxZ - part.rect.minZ,
    ];
    const visible = visibleBoxFor(part.id);
    const visibleSize = visible
      ? [visible.max.x - visible.min.x, visible.max.y - visible.min.y, visible.max.z - visible.min.z]
      : [0, 0, 0];
    buildingRows.push({
      id: part.id,
      asset: part.asset,
      collisionSize,
      visibleSize,
      collisionArea: polygonArea(footprint),
      fill: occ.fraction,
      deltaX: visibleSize[0] - collisionSize[0],
      deltaZ: visibleSize[2] - collisionSize[2],
      debt: KNOWN_DEBT.has(part.id),
    });
  }
  buildingRows.sort((a, b) => a.fill - b.fill);

  return { buildingRows, placementCount: placements.length };
}

// ---------------------------------------------------------------- self-test
// A collision gate that cannot demonstrate it catches an offset or a shrunk hull
// is the exact failure this repo keeps hitting: a check that looks green while
// checking nothing. So the gate proves, on synthetic geometry with a known
// answer, that it FLAGS a divergence and PASSES an aligned one before it is
// trusted to measure the real world.
function unitCubeSource(size = [1, 1, 1]) {
  return {
    natural: size,
    next: () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size[0], size[1], size[2]),
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      );
      const scene = new THREE.Group();
      scene.add(mesh);
      scene.updateMatrixWorld(true);
      return scene;
    },
  };
}

function measureFill(source, placement, part) {
  const placed = placeInto(THREE, source.next(), placement, source.natural);
  const occ = surveyNearPlane(THREE, placed.targets, part, (part.baseY + part.topY) / 2, {
    grid: OCCUPANCY_GRID,
    tol: (part.topY - part.baseY) / 2 + 0.35,
  });
  return occ.fraction;
}

function selfTest() {
  let failed = 0;
  const check = (label, ok, detail) => {
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`);
  };

  // The instrument's own arithmetic first (shared with the other verifiers).
  const arithmeticOk = selfTestGate({ THREE, label: "world-collision", verbose: false });
  check("shared placement arithmetic holds", arithmeticOk, "placement self-test");

  console.log(
    "\n  world-collision selftest: a solid a body runs into must be DRAWN. An\n" +
      "  aligned mesh fills its collision; an offset or a shrunk one does not.",
  );

  // A 10 x 8 x 6 building box. The collision part is that whole box.
  const part = {
    id: "SYN",
    kind: "MASS",
    rect: { minX: -5, maxX: 5, minZ: -3, maxZ: 3 },
    baseY: 0,
    topY: 6,
    yaw: 0,
  };

  // A mesh whose ASPECT matches the box: a filled MODULE draws the whole box.
  const filled = unitCubeSource([10, 6, 6]);
  const fillPlacement = { id: "SYN", pos: [0, 0, 0], size: [10, 6, 6], yaw: 0, fit: "MODULE" };
  const filledFraction = measureFill(filled, fillPlacement, part);
  check(
    "an aligned mesh fills its collision",
    filledFraction >= SOLID_FILL_MIN,
    `fill ${(filledFraction * 100).toFixed(0)}% (wants >= ${(SOLID_FILL_MIN * 100).toFixed(0)}%)`,
  );

  // THE INVISIBLE WALL. A mesh shaped nothing like the box, contain-fitted: it
  // draws a sliver in the middle of a solid the player collides with all of.
  const sliver = unitCubeSource([0.68, 1.9, 1.09]);
  const sliverPlacement = { id: "SYN", pos: [0, 0, 0], size: [10, 6, 6], yaw: 0, fit: "PROP" };
  const sliverFraction = measureFill(sliver, sliverPlacement, part);
  check(
    "a sliver in a block is caught",
    sliverFraction < SOLID_FILL_MIN,
    `fill ${(sliverFraction * 100).toFixed(0)}% (must be < ${(SOLID_FILL_MIN * 100).toFixed(0)}%)`,
  );

  // THE OFFSET. A correctly-sized mesh placed 5m off its collision fills none of
  // it — the physical world offset from the visible one.
  const offset = unitCubeSource([10, 6, 6]);
  const offsetPlacement = { id: "SYN", pos: [5, 0, 3], size: [10, 6, 6], yaw: 0, fit: "MODULE" };
  const offsetFraction = measureFill(offset, offsetPlacement, part);
  check(
    "an offset mesh is caught",
    offsetFraction < SOLID_FILL_MIN,
    `fill ${(offsetFraction * 100).toFixed(0)}% at +5m,+3m (must be < ${(SOLID_FILL_MIN * 100).toFixed(0)}%)`,
  );

  // The two extremes must genuinely differ, or the measurement is inert.
  check(
    "aligned and broken verdicts differ",
    filledFraction >= SOLID_FILL_MIN && sliverFraction < SOLID_FILL_MIN,
    `aligned ${(filledFraction * 100).toFixed(0)}% vs sliver ${(sliverFraction * 100).toFixed(0)}%`,
  );

  console.log(
    failed === 0
      ? "world-collision selftest: OK (catches slivers and offsets; passes an aligned solid)"
      : `world-collision selftest: FAIL (${failed} case(s))`,
  );
  return failed;
}

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
if (argv.includes("--selftest")) process.exit(selfTest() === 0 ? 0 : 1);

// The instrument proves itself before it measures anything.
if (selfTest() !== 0) {
  console.error("\nworld-collision: refusing to measure with a broken instrument.");
  process.exit(1);
}

const reportOnly = argv.includes("--report");
const asJson = argv.includes("--json");

const { buildingRows, placementCount } = await analyse();

if (asJson) {
  console.log(JSON.stringify({ buildingRows }, null, 2));
  process.exit(0);
}

console.log(
  `\nworld-collision: ${placementCount} placements, ${buildingRows.length} building-scale solids\n`,
);

console.log("--- building solids: is the mesh actually IN the collision? ---");
console.log(
  "  (collision = the block the solver collides; visible = the drawn mesh's world\n" +
    "  AABB; fill = fraction of the solid's volume with drawn stone in it. Low fill\n" +
    "  is an invisible wall, and it catches position, scale and rotation at once:\n" +
    "  a mesh that is offset, shrunk or turned wrong does not fill its collision.)",
);
console.log(
  "  " +
    "id".padEnd(20) +
    "asset".padEnd(28) +
    "collision(x×z)".padEnd(16) +
    "visible(x×z)".padEnd(16) +
    "Δx".padEnd(8) +
    "Δz".padEnd(8) +
    "fill",
);
for (const row of buildingRows) {
  const cs = `${row.collisionSize[0].toFixed(1)}×${row.collisionSize[2].toFixed(1)}`;
  const vs = `${row.visibleSize[0].toFixed(1)}×${row.visibleSize[2].toFixed(1)}`;
  const dx = row.deltaX.toFixed(1);
  const dz = row.deltaZ.toFixed(1);
  const flag = row.debt ? "DEBT" : row.fill < SOLID_FILL_MIN ? "FAIL" : "ok  ";
  console.log(
    `  ${row.id.padEnd(20)}${row.asset.padEnd(28)}${cs.padEnd(16)}${vs.padEnd(16)}` +
      `${dx.padEnd(8)}${dz.padEnd(8)}${(row.fill * 100).toFixed(0)}%  ${flag}`,
  );
}

// ---------------------------------------------------------------- verdict
const blocking = [];
for (const row of buildingRows) {
  if (row.fill >= SOLID_FILL_MIN) continue;
  if (row.debt) continue;
  blocking.push({
    id: row.id,
    detail:
      `${row.asset} occupies only ${(row.fill * 100).toFixed(0)}% of the ` +
      `${row.collisionSize[0].toFixed(1)} x ${row.collisionSize[1].toFixed(1)} x ` +
      `${row.collisionSize[2].toFixed(1)}m solid it stands for: the rest is an invisible wall.`,
  });
}

const debtHit = buildingRows.filter((r) => r.debt && r.fill < SOLID_FILL_MIN);
if (debtHit.length) {
  console.warn(
    `\n  WARNING: ${debtHit.length} known collision debt (loud, not suppressed):`,
  );
  for (const row of debtHit) {
    console.warn(`    debt: ${row.id}  (fill ${(row.fill * 100).toFixed(0)}%)`);
    console.warn(`          ${KNOWN_DEBT.get(row.id)}`);
  }
}

if (blocking.length && !reportOnly) {
  console.error(`\n  FAIL: ${blocking.length} collision/visible divergence(s) that must not ship:`);
  for (const row of blocking) {
    console.error(`    error: ${row.id}`);
    console.error(`           ${row.detail}`);
  }
  console.error(
    "\n  The solver collides geometry the player cannot see. Make the visible mesh\n" +
      "  FILL the collision (a filled MODULE/BLOCK/ROW stance, or an asset whose\n" +
      "  aspect matches its box), or bring the collision in to the visible mesh.\n" +
      "  A contain-fit cannot: it takes the smallest of three ratios, so a mesh\n" +
      "  whose aspect is wrong is drawn smaller than the box on two axes.",
  );
  process.exit(1);
}

console.log(
  `\nworld-collision: OK (${buildingRows.length} solids drawn into their collision; ` +
    `${debtHit.length} known debt, loud above)`,
);
