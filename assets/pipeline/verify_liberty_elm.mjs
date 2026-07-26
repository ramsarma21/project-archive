// Verify liberty-elm-hero.glb against the collision M1 already authored.
//
// The level agent's rule is that the art fits the hull, never the reverse: a
// bough that sits 40cm above the deck the player walks on reads as a bug, not
// as scenery. So this does not check the tree against a spec sheet — it reads
// LIBERTY_ELM_TRUNK and the three BOUGH_* entries straight out of the shipped
// GEOMETRY and measures the mesh against those, so the check cannot drift from
// what the player actually feels.
//
// Three things are measured, and all three are measured on the mesh AS DRAWN.
// `sceneryPlacements()` is asked where the tree goes and how big, the fit
// `FittedGlb` performs is reproduced exactly, and every probe below runs in that
// frame — so this cannot pass a mesh that fits the hull but reaches the screen
// at the wrong size, which is the failure it was written during:
//   1. placement one draw for the asset, at the size the asset was authored to
//   2. bole      solid from the ground to 12m and ~1.8m across, so every tier
//                is a walk-around rather than a pole with platforms on it
//   3. tiers     for a grid over each authored rect, the height of the first
//                surface a falling foot meets, against that tier's deck plane
//
// Run: node --import tsx assets/pipeline/verify_liberty_elm.mjs [file.glb]
globalThis.self = globalThis;
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const threeRoot = join(repoRoot, "apps", "web", "node_modules", "three");
const THREE = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);
const { GEOMETRY } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "level", "geometry.ts"))
);
const { sceneryPlacements } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "runtime.ts"))
);

const ASSET_KEY = "liberty-elm-hero";
const target = resolve(
  process.argv[2] ?? join(repoRoot, "apps", "web", "public", "world", "props", `${ASSET_KEY}.glb`),
);

// How far under the deck plane a foot may find wood before the player reads as
// walking on air, and how far over it before the player reads as sinking in.
// Asymmetric on purpose: a surface slightly low is hidden by the boot, a
// surface high is a visible intersection.
const TOL_BELOW = 0.35;
const TOL_ABOVE = 0.05;
const GRID = 25;

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

// ---- the authored hull ------------------------------------------------------

const trunk = GEOMETRY.masses.find((m) => m.asset === ASSET_KEY);
const tiers = GEOMETRY.decks.filter((d) => d.asset === ASSET_KEY);
if (!trunk) throw new Error(`no mass in GEOMETRY uses asset ${ASSET_KEY}`);
if (tiers.length === 0) throw new Error(`no deck in GEOMETRY uses asset ${ASSET_KEY}`);

const boleRadius = trunk.round?.radius ?? (trunk.rect.maxX - trunk.rect.minX) / 2;

console.log(`=== ${target.replace(repoRoot + "/", "")}`);
if (!existsSync(target)) {
  fail(`missing: nothing is shipped at ${target}`);
  process.exit(1);
}
const bytes = statSync(target).size;
console.log(`file  ${(bytes / 1024 / 1024).toFixed(2)} MiB (${bytes} bytes)`);

console.log(`\n--- authored collision, read from GEOMETRY ---`);
console.log(
  `${trunk.id.padEnd(18)} mass  x ${trunk.rect.minX.toFixed(2)}..${trunk.rect.maxX.toFixed(2)}` +
    `  z ${trunk.rect.minZ.toFixed(2)}..${trunk.rect.maxZ.toFixed(2)}` +
    `  y ${trunk.baseY.toFixed(2)}..${trunk.topY.toFixed(2)}  round r=${boleRadius.toFixed(2)}`,
);
for (const tier of tiers) {
  console.log(
    `${tier.id.padEnd(18)} deck  x ${tier.rect.minX.toFixed(2)}..${tier.rect.maxX.toFixed(2)}` +
      `  z ${tier.rect.minZ.toFixed(2)}..${tier.rect.maxZ.toFixed(2)}` +
      `  y ${tier.y.toFixed(2)}`,
  );
}

// ---- the mesh ---------------------------------------------------------------

const data = readFileSync(target);
const loader = new GLTFLoader();
const gltf = await new Promise((res, rej) =>
  loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", res, rej),
);
const scene = gltf.scene;
scene.updateMatrixWorld(true);

let tris = 0;
scene.traverse((o) => {
  if (!o.isMesh) return;
  // Leaf cards and any stray inward-facing shell must still stop a probe ray.
  const materials = Array.isArray(o.material) ? o.material : [o.material];
  for (const material of materials) if (material) material.side = THREE.DoubleSide;
  const index = o.geometry.index;
  tris += (index ? index.count : o.geometry.attributes.position.count) / 3;
});

const box = new THREE.Box3().setFromObject(scene);
const size = box.getSize(new THREE.Vector3());
console.log(`\n--- mesh ---`);
console.log(`triangles ${Math.round(tris).toLocaleString()}`);
console.log(
  `natural bbox  x=${size.x.toFixed(3)} y=${size.y.toFixed(3)} z=${size.z.toFixed(3)}` +
    `  minY=${box.min.y.toFixed(3)}`,
);

// ---- 1. the placement -------------------------------------------------------
// One draw for the asset, not one per collision entry. Ask the level where the
// tree goes and reproduce FittedGlb's fit exactly: uniform contain-scale into
// the placement box, bbox centred on the placement in X/Z, bbox floor dropped
// to the placement Y. Everything after this is measured in that frame, so a
// tree that fits the hull but is drawn at a tenth of its size fails here rather
// than passing on a technicality.

console.log(`\n--- the draw, from sceneryPlacements() ---`);
const draws = sceneryPlacements().filter((p) => p.asset === ASSET_KEY);
for (const p of draws) {
  console.log(
    `${p.id.padEnd(18)} ${p.kind.padEnd(5)} box ${p.size.map((v) => v.toFixed(2)).join(" x ")}` +
      `  at (${p.pos.map((v) => v.toFixed(2)).join(", ")})  covering ${p.parts.join(", ")}`,
  );
}
if (draws.length !== 1) {
  fail(
    `${draws.length} draws of one asset. A collision entry is not an object: ` +
      `the bole and the three limbs are one tree and want one draw, sized to the tree.`,
  );
}

const placement = draws[0];
if (!placement) {
  console.log("\nVERIFY FAILED");
  process.exit(1);
}

const scale = Math.min(
  placement.size[0] / size.x,
  placement.size[1] / size.y,
  placement.size[2] / size.z,
);
scene.scale.setScalar(scale);
scene.updateMatrixWorld(true);
const scaled = new THREE.Box3().setFromObject(scene);
const scaledCentre = scaled.getCenter(new THREE.Vector3());
scene.position.set(
  placement.pos[0] - scaledCentre.x,
  placement.pos[1] - scaled.min.y,
  placement.pos[2] - scaledCentre.z,
);
scene.updateMatrixWorld(true);

// The bole axis is wherever the draw actually put it, not where the trunk rect
// says it should be. Those must agree; that is the next check.
const axis = { x: placement.pos[0], z: placement.pos[2] };
const trunkAxis = {
  x: (trunk.rect.minX + trunk.rect.maxX) / 2,
  z: (trunk.rect.minZ + trunk.rect.maxZ) / 2,
};

const placed = new THREE.Box3().setFromObject(scene);
console.log(
  `scale ${scale.toFixed(4)}  draws ${(size.x * scale).toFixed(2)} x ` +
    `${(size.y * scale).toFixed(2)} x ${(size.z * scale).toFixed(2)} m`,
);
console.log(
  `placed extent x ${placed.min.x.toFixed(2)}..${placed.max.x.toFixed(2)}` +
    `  y ${placed.min.y.toFixed(2)}..${placed.max.y.toFixed(2)}` +
    `  z ${placed.min.z.toFixed(2)}..${placed.max.z.toFixed(2)}`,
);

// FittedGlb bottom-aligns and centres on the bounding box, and the elm was
// authored around exactly those two behaviours: minY 0 and the box centre on
// the bole. Both sides of that contract are checked, because either one
// drifting puts the tree off its own trunk with nothing else complaining.
if (Math.abs(box.min.y) > 0.01) {
  fail(`mesh minY is ${box.min.y.toFixed(3)}, not 0: it will not bottom-align onto its base`);
}
if (Math.abs(axis.x - trunkAxis.x) > 0.05 || Math.abs(axis.z - trunkAxis.z) > 0.05) {
  fail(
    `the draw centres at (${axis.x.toFixed(2)}, ${axis.z.toFixed(2)}) but the bole ` +
      `stands at (${trunkAxis.x.toFixed(2)}, ${trunkAxis.z.toFixed(2)})`,
  );
}
if (Math.abs(placed.min.y - trunk.baseY) > 0.01) {
  fail(`the draw stands at y ${placed.min.y.toFixed(2)}, not on the trunk's base ${trunk.baseY.toFixed(2)}`);
}
// A tree drawn short is the whole reason this section exists. The tallest tier
// is at 11.2m and the crown carries on well above it, so anything under the
// mesh's own height means the fit crushed it.
if (size.y * scale < size.y - 0.1) {
  fail(
    `drawn ${(size.y * scale).toFixed(2)}m against a ${size.y.toFixed(2)}m tree: ` +
      `the fit is shrinking it into a box smaller than the asset`,
  );
}

const raycaster = new THREE.Raycaster();
raycaster.far = 100;
const targets = [];
scene.traverse((o) => {
  if (o.isMesh) targets.push(o);
});

function castDown(x, z, fromY) {
  raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length > 0 ? hits[0].point.y : null;
}

// Probed inward from a collar just clear of the root flare. Starting further
// out would report a limb instead of the bole, and starting on the axis would
// report whatever the limbs tuck inside it; between the flare and the limbs
// there is nothing but trunk, so this is the one radius that answers the
// question asked.
const BOLE_PROBE_FROM = 1.9;

function boleRadiusAt(y, angle) {
  const dx = -Math.cos(angle);
  const dz = -Math.sin(angle);
  raycaster.set(
    new THREE.Vector3(axis.x - dx * BOLE_PROBE_FROM, y, axis.z - dz * BOLE_PROBE_FROM),
    new THREE.Vector3(dx, 0, dz),
  );
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length > 0 ? BOLE_PROBE_FROM - hits[0].distance : null;
}

// ---- 2. the bole ------------------------------------------------------------
// "Solid to twelve metres" and 1.8m across, so the player walks around the bole
// on every tier instead of past a pole.

console.log(`\n--- bole: solid to ${trunk.topY.toFixed(1)}m, ${(boleRadius * 2).toFixed(1)}m across ---`);
const boleRows = [];
let boleBad = 0;
for (let h = 0.4; h <= trunk.topY - 0.05; h += 0.4) {
  const radii = [];
  for (let i = 0; i < 12; i++) {
    const r = boleRadiusAt(h, (i / 12) * Math.PI * 2);
    if (r !== null) radii.push(r);
  }
  const hit = radii.length;
  const min = hit ? Math.min(...radii) : 0;
  const max = hit ? Math.max(...radii) : 0;
  // Flutes cut inward from the authored radius, so allow a tenth of it.
  const ok = hit === 12 && min >= boleRadius * 0.9;
  if (!ok) boleBad++;
  boleRows.push({ h, hit, min, max, ok });
}
for (const row of boleRows) {
  console.log(
    `  y=${row.h.toFixed(1).padStart(5)}  hits ${row.hit}/12  ` +
      `r min ${row.min.toFixed(2)} max ${row.max.toFixed(2)}  ${row.ok ? "ok" : "THIN"}`,
  );
}
if (boleBad > 0) fail(`bole: ${boleBad}/${boleRows.length} sections thinner than the authored trunk`);
else console.log(`  bole ok: ${boleRows.length}/${boleRows.length} sections solid to ${trunk.topY.toFixed(1)}m`);

// ---- 3. the tier surfaces ---------------------------------------------------

console.log(`\n--- tier surfaces (grid ${GRID}x${GRID}, tolerance -${TOL_BELOW}m / +${TOL_ABOVE}m) ---`);
for (const tier of tiers) {
  const { rect, y } = tier;
  let inside = 0;
  let covered = 0;
  let air = 0;
  let above = 0;
  let dyMin = Infinity;
  let dyMax = -Infinity;
  let dySum = 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = rect.minX + ((i + 0.5) / GRID) * (rect.maxX - rect.minX);
      const z = rect.minZ + ((j + 0.5) / GRID) * (rect.maxZ - rect.minZ);
      // The bole is a solid non-landable mass through every tier, so its own
      // footprint is not standable and is not the art's job to cover.
      if (Math.hypot(x - axis.x, z - axis.z) < boleRadius) {
        inside++;
        continue;
      }
      const hitY = castDown(x, z, y + 0.5);
      if (hitY === null || hitY < y - TOL_BELOW) {
        air++;
        continue;
      }
      if (hitY > y + TOL_ABOVE) {
        above++;
        continue;
      }
      covered++;
      const dy = hitY - y;
      dyMin = Math.min(dyMin, dy);
      dyMax = Math.max(dyMax, dy);
      dySum += dy;
    }
  }
  const standable = GRID * GRID - inside;
  const pct = (covered / standable) * 100;
  console.log(
    `${tier.id.padEnd(13)} y=${y.toFixed(2)}  ${standable} standable samples ` +
      `(${inside} inside the bole)`,
  );
  console.log(
    `  on the plane ${covered}/${standable} (${pct.toFixed(1)}%)  ` +
      `dy min ${dyMin === Infinity ? "n/a" : dyMin.toFixed(3)} ` +
      `max ${dyMax === -Infinity ? "n/a" : dyMax.toFixed(3)} ` +
      `mean ${covered ? (dySum / covered).toFixed(3) : "n/a"}`,
  );
  console.log(`  walking on air ${air}   art above the deck ${above}`);
  if (pct < 95) fail(`${tier.id}: only ${pct.toFixed(1)}% of the authored deck has wood under the foot`);
  if (above > 0) fail(`${tier.id}: ${above} samples sit above the deck plane the player walks on`);
}

console.log(
  process.exitCode
    ? "\nVERIFY FAILED"
    : `\nVERIFY OK: one draw, ${(size.y * scale).toFixed(2)}m tall on the bole axis, ` +
        `every tier under the foot`,
);
