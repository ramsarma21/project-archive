// Verify steeple-meetinghouse-climbable.glb against the collision M1 authored.
//
// Same rule as verify_liberty_elm.mjs: the art fits the hull, never the reverse.
// A gallery that sits 40cm above the deck the player runs off is worse than no
// gallery, because they then leap from air — and on this asset that is not a
// hypothetical. Both leaps of faith launch off it.
//
// So nothing here is checked against a spec sheet. The two STEEPLE_* masses and
// the four ring decks are read straight out of the shipped GEOMETRY,
// `sceneryPlacements()` is asked where the steeple goes and how big, the fit
// `FittedGlb` performs is reproduced exactly, and every probe runs in that frame.
// A mesh that fits the hull but reaches the screen at the wrong size fails here
// rather than passing on a technicality.
//
// Six things are measured:
//   1. placement  one draw, bottom-aligned on the shaft base, not crushed by the
//                 contain-fit into a box smaller than the asset
//   2. shaft      the two non-landable masses are solid where the level says the
//                 player is stopped, so the climb has a wall to be beside
//   3. decks      for a grid over the standable part of every authored ring, the
//                 height of the first surface a falling foot meets
//   4. headroom   a 1.55m runner can stand up on each of those rings
//   5. the dive   the leap of faith is flown ballistically off the gallery lip
//                 with the engine's own gravity and run speed, and every step of
//                 the trajectory is checked for steeple geometry in the way
//   6. budget     file size and one texture atlas
//
// Run: node --import tsx assets/pipeline/verify_m1_steeple.mjs [file.glb]
//      ... [--size 7.4,21,7.4]   build/check ahead of an assets.ts sizeM change
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
const load = (...parts) => import(pathToFileURL(join(repoRoot, ...parts)));
const { GEOMETRY } = await load("packages", "mission-m1", "src", "level", "geometry.ts");
const { NODES, LINKS } = await load("packages", "mission-m1", "src", "level", "route.ts");
const { ASSETS } = await load("packages", "mission-m1", "src", "assets.ts");
const { sceneryPlacements } = await load("packages", "mission-m1", "src", "runtime.ts");
const { GRAVITY, RUNNING_JUMP_VY, RUN_SPEED, STEP_DOWN } = await load(
  "packages", "engine-world", "src", "playerMotion.ts",
);
const { CAPSULE_RADIUS, STAND_HEIGHT } = await load(
  "packages", "engine-world", "src", "collision.ts",
);

const ASSET_KEY = "steeple-meetinghouse-climbable";

const args = process.argv.slice(2);
const sizeFlag = args.indexOf("--size");
const sizeOverride =
  sizeFlag >= 0 ? args[sizeFlag + 1].split(",").map(Number) : null;
const fileArg = args.find(
  (a, i) => !a.startsWith("--") && !(sizeFlag >= 0 && i === sizeFlag + 1),
);
const target = resolve(
  fileArg ?? join(repoRoot, "apps", "web", "public", "world", "props", `${ASSET_KEY}.glb`),
);

// How far under the deck plane a foot may find stone before the player reads as
// walking on air, and how far over it before they read as sinking in. Asymmetric
// on purpose, and the low side is the engine's own step-down: a surface slightly
// low is absorbed and hidden by the boot, a surface high is a visible
// intersection with the leg.
const TOL_BELOW = STEP_DOWN;
const TOL_ABOVE = 0.05;
const GRID = 33;
// The build authors floor a hand's breadth in under the shaft so there is no
// crack of daylight at its foot. That undercut is invisible, but it does mean a
// probe sample must be clear of the shaft wall by more than the undercut before
// the wall, rather than the floor, is the first thing a downward ray can find.
const WALL_CLEARANCE = 0.16;
const BUDGET_MB = 4.0;

let failures = 0;
function fail(message) {
  console.error(`FAIL ${message}`);
  failures++;
  process.exitCode = 1;
}

// ---- the authored hull ------------------------------------------------------

const masses = GEOMETRY.masses.filter((m) => m.asset === ASSET_KEY);
const decks = GEOMETRY.decks
  .filter((d) => d.asset === ASSET_KEY)
  .slice()
  .sort((a, b) => a.y - b.y);
if (masses.length === 0) throw new Error(`no mass in GEOMETRY uses asset ${ASSET_KEY}`);
if (decks.length === 0) throw new Error(`no deck in GEOMETRY uses asset ${ASSET_KEY}`);

const shaft = masses.reduce((a, b) => {
  const areaOf = (m) => (m.rect.maxX - m.rect.minX) * (m.rect.maxZ - m.rect.minZ);
  return areaOf(b) > areaOf(a) ? b : a;
});
const baseY = Math.min(...masses.map((m) => m.baseY));

console.log(`=== ${target.replace(repoRoot + "/", "")}`);
if (!existsSync(target)) {
  fail(`missing: nothing is shipped at ${target}`);
  process.exit(1);
}
const bytes = statSync(target).size;
const megabytes = bytes / 1024 / 1024;
console.log(`file  ${megabytes.toFixed(2)} MiB (${bytes} bytes)`);

console.log(`\n--- authored collision, read from GEOMETRY ---`);
for (const mass of masses) {
  console.log(
    `${mass.id.padEnd(15)} mass  x ${mass.rect.minX.toFixed(2)}..${mass.rect.maxX.toFixed(2)}` +
      `  z ${mass.rect.minZ.toFixed(2)}..${mass.rect.maxZ.toFixed(2)}` +
      `  y ${mass.baseY.toFixed(2)}..${mass.topY.toFixed(2)}` +
      `  ${mass.landable === false ? "solid" : "landable"}`,
  );
}
for (const deck of decks) {
  console.log(
    `${deck.id.padEnd(15)} deck  x ${deck.rect.minX.toFixed(2)}..${deck.rect.maxX.toFixed(2)}` +
      `  z ${deck.rect.minZ.toFixed(2)}..${deck.rect.maxZ.toFixed(2)}` +
      `  y ${deck.y.toFixed(2)}   ${(deck.tags ?? []).join(" ")}`,
  );
}

// ---- the mesh ---------------------------------------------------------------

const data = readFileSync(target);

// Counted off the container, not off the loaded materials. Three cannot decode a
// GLB's embedded image in node — it wants a blob URL — so every material arrives
// with a null map and a texture count taken from them is always zero.
function atlasesInGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) return [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const kind = buffer.readUInt32LE(offset + 4);
    if (kind === 0x4e4f534a) {
      const json = JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString("utf8"));
      return (json.images ?? []).map((image, index) => {
        const view = json.bufferViews?.[image.bufferView];
        return {
          index,
          mimeType: image.mimeType ?? "?",
          bytes: view?.byteLength ?? 0,
        };
      });
    }
    offset += 8 + length;
  }
  return [];
}

const loader = new GLTFLoader();
const gltf = await new Promise((res, rej) =>
  loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", res, rej),
);
const scene = gltf.scene;
scene.updateMatrixWorld(true);

let tris = 0;
const atlases = atlasesInGlb(data);
scene.traverse((o) => {
  if (!o.isMesh) return;
  // Louvre slats and any stray inward-facing shell must still stop a probe ray.
  const materials = Array.isArray(o.material) ? o.material : [o.material];
  for (const material of materials) if (material) material.side = THREE.DoubleSide;
  const index = o.geometry.index;
  tris += (index ? index.count : o.geometry.attributes.position.count) / 3;
});

const box = new THREE.Box3().setFromObject(scene);
const size = box.getSize(new THREE.Vector3());
console.log(`\n--- mesh ---`);
console.log(`triangles ${Math.round(tris).toLocaleString()}   texture atlases ${atlases.length}`);
for (const image of atlases) {
  console.log(`  atlas ${image.index}  ${image.mimeType}  ${(image.bytes / 1024).toFixed(0)} KiB`);
}
console.log(
  `natural bbox  x=${size.x.toFixed(3)} y=${size.y.toFixed(3)} z=${size.z.toFixed(3)}` +
    `  minY=${box.min.y.toFixed(3)}`,
);

if (megabytes > BUDGET_MB) {
  fail(`${megabytes.toFixed(2)} MiB over the ${BUDGET_MB.toFixed(1)} MiB hero budget`);
}
if (atlases.length > 1) {
  fail(`${atlases.length} texture atlases; a hero landmark ships one`);
}

// ---- 1. the placement -------------------------------------------------------
// One draw for the asset, not one per collision entry, and reproduce FittedGlb's
// fit exactly: uniform contain-scale into the placement box, bbox centred on the
// placement in X/Z, bbox floor dropped to the placement Y. Everything after this
// is measured in that frame.

console.log(`\n--- the draw, from sceneryPlacements() ---`);
const draws = sceneryPlacements().filter((p) => p.asset === ASSET_KEY);
for (const p of draws) {
  console.log(
    `${p.id.padEnd(15)} ${p.kind.padEnd(5)} box ${p.size.map((v) => v.toFixed(2)).join(" x ")}` +
      `  at (${p.pos.map((v) => v.toFixed(2)).join(", ")})  covering ${p.parts.join(", ")}`,
  );
}
if (draws.length !== 1) {
  fail(
    `${draws.length} draws of one asset. A collision entry is not an object: the ` +
      `shaft, the spire and the four rings are one steeple and want one draw.`,
  );
}
const placement = draws[0];
if (!placement) {
  console.log("\nVERIFY FAILED");
  process.exit(1);
}

// The smallest box centred on the draw that reaches every part this asset owns.
// `drawBox` takes the plan centre from the union of the solids and the size from
// the declared sizeM, so a declared box too small in plan cannot be compensated
// for by the mesh: the ring simply is not drawn where the player stands on it.
const axis = { x: placement.pos[0], z: placement.pos[2] };
const owned = [
  ...masses.map((m) => ({ rect: m.rect, top: m.topY })),
  ...decks.map((d) => ({ rect: d.rect, top: d.y })),
];
const needed = [
  2 * Math.max(...owned.map((p) => Math.max(axis.x - p.rect.minX, p.rect.maxX - axis.x))),
  Math.max(...owned.map((p) => p.top)) - baseY,
  2 * Math.max(...owned.map((p) => Math.max(axis.z - p.rect.minZ, p.rect.maxZ - axis.z))),
];
const declared = ASSETS.find((a) => a.key === ASSET_KEY)?.sizeM;
console.log(
  `declared sizeM ${JSON.stringify(declared)}   reaches every authored part at ` +
    `[${needed.map((v) => v.toFixed(1)).join(", ")}] or wider`,
);
const shortInPlan =
  declared && (declared[0] < needed[0] - 0.01 || declared[2] < needed[2] - 0.01);
if (shortInPlan) {
  console.log(
    `\n*** assets.ts declares a box the collision does not fit inside. No mesh can\n` +
      `    fix this: drawBox() takes the plan centre from the union of the solids and\n` +
      `    the size from sizeM, so a ring that reaches ${(needed[0] / 2).toFixed(2)}m from the\n` +
      `    axis\n` +
      `    simply is not drawn where the player stands on it. The one-line change:\n` +
      `      sizeM: ${JSON.stringify(declared)}  ->  [${needed[0].toFixed(1)}, ` +
      `${Math.max(declared[1], size.y).toFixed(1)}, ${needed[2].toFixed(1)}]`,
  );
}

if (sizeOverride) {
  console.log(
    `\n*** --size ${sizeOverride.join(",")}: measuring against a PROPOSED box, not the\n` +
      `    one assets.ts declares. This is how the asset is built and checked ahead\n` +
      `    of that one-line change; it is not what the game draws today.`,
  );
  placement.size = sizeOverride;
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

// FittedGlb bottom-aligns and plan-centres on the bounding box, and the steeple
// is authored around exactly those two behaviours. Both sides of the contract
// are checked, because either one drifting puts every ring off its plane with
// nothing else complaining.
if (Math.abs(box.min.y) > 0.01) {
  fail(`mesh minY is ${box.min.y.toFixed(3)}, not 0: it will not bottom-align onto its base`);
}
const shaftAxis = {
  x: (shaft.rect.minX + shaft.rect.maxX) / 2,
  z: (shaft.rect.minZ + shaft.rect.maxZ) / 2,
};
if (Math.abs(axis.x - shaftAxis.x) > 0.05 || Math.abs(axis.z - shaftAxis.z) > 0.05) {
  fail(
    `the draw centres at (${axis.x.toFixed(2)}, ${axis.z.toFixed(2)}) but the shaft ` +
      `stands at (${shaftAxis.x.toFixed(2)}, ${shaftAxis.z.toFixed(2)})`,
  );
}
if (Math.abs(placed.min.y - baseY) > 0.01) {
  fail(`the draw stands at y ${placed.min.y.toFixed(2)}, not on the shaft base ${baseY.toFixed(2)}`);
}
// A steeple drawn short is the whole reason this section exists: the top ring is
// at 19.4m, so anything under the mesh's own height means the fit crushed it and
// every ring came down with it.
if (scale < 0.999) {
  fail(
    `contain-fit scale ${scale.toFixed(4)}: the box ` +
      `[${placement.size.map((v) => v.toFixed(1)).join(", ")}] is smaller than the ` +
      `${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}m mesh, so every ` +
      `authored ring is drawn ${((1 - scale) * placement.size[1]).toFixed(2)}m low`,
  );
}

// ---- is this mesh the one this hull asks for? -------------------------------
// A contain-fit takes the SMALLEST of the three box/mesh ratios, so a mesh short
// on ONE axis only is drawn at scale 1.0000 and looks perfect to every check that
// asks about scale. The Town House shipped that way — sizeM widened from 14.6 to
// 15.0 with no rebuild, a 14.6m mesh fitted at 1.0000 into a 15.0m box, and the
// outer 0.20m of each east face absent, which left a tenth of a deck the route
// stands on with nothing under it. Only a per-axis check catches it.
//
// The build pins the bounding box to the envelope with corner studs precisely so
// the mesh IS the box, so that is the contract and this states it: equal on all
// three axes to a millimetre. A stale mesh fails here by name rather than drawing
// short somewhere nobody is looking.
const BOX_EPS = 0.002;
const axes = [
  ["x", size.x, placement.size[0]],
  ["y", size.y, placement.size[1]],
  ["z", size.z, placement.size[2]],
];
console.log(
  `box match  ${axes
    .map(([name, mesh, box]) => `${name} ${mesh.toFixed(3)}/${box.toFixed(3)}`)
    .join("  ")}`,
);
for (const [name, mesh, box] of axes) {
  if (Math.abs(mesh - box) <= BOX_EPS) continue;
  fail(
    `the mesh is ${Math.abs(mesh - box).toFixed(3)}m ${mesh < box ? "short of" : "past"} its draw ` +
      `box on ${name} (${mesh.toFixed(3)} against ${box.toFixed(3)}). A single short axis is ` +
      `invisible to the contain-fit, so this draws at scale 1.0000 with ` +
      `${(Math.abs(mesh - box) / 2).toFixed(3)}m missing from each ${name} face. Rebuild it: the ` +
      `mesh was built against a different hull than the level now declares.`,
  );
}

const raycaster = new THREE.Raycaster();
raycaster.far = 200;
const targets = [];
scene.traverse((o) => {
  if (o.isMesh) targets.push(o);
});

function castDown(x, z, fromY) {
  raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length > 0 ? hits[0].point.y : null;
}

function castUp(x, z, fromY, limit) {
  raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, 1, 0));
  const hits = raycaster.intersectObjects(targets, false);
  for (const hit of hits) if (hit.point.y <= fromY + limit) return hit.point.y;
  return null;
}

/** Distance from `from` to the first surface along `direction`, or null. */
function castAlong(from, direction, limit) {
  raycaster.set(from, direction.clone().normalize());
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length > 0 && hits[0].distance <= limit ? hits[0].distance : null;
}

/** Does a non-landable mass fill the space a body standing on `y` would need? */
const spansPlane = (mass, y) => mass.topY > y + 0.02 && mass.baseY < y + 0.02;
const insideRect = (rect, x, z, shrink = 0) =>
  x > rect.minX + shrink && x < rect.maxX - shrink &&
  z > rect.minZ + shrink && z < rect.maxZ - shrink;

const solids = masses.filter((m) => m.landable === false);

// ---- 2. the shaft and the spire --------------------------------------------
// The level stops the player at these two boxes, so there has to be masonry on
// them: the six-hold climb is played with a hand on the shaft, and a shaft
// narrower than its collision is a player pressed against thin air.

console.log(`\n--- the solids: masonry where the player is stopped ---`);
for (const mass of solids) {
  // A spire's box is not a wall. The level declares it as a conservative bound on
  // something that tapers to a point, so demanding it be full would fail every
  // spire ever built; what matters is that it is THERE and that it stays inside
  // the bound, because outside it the vane balcony is a surface someone stands on.
  const tapers = (mass.tags ?? []).includes("spire");
  const half = {
    x: (mass.rect.maxX - mass.rect.minX) / 2,
    z: (mass.rect.maxZ - mass.rect.minZ) / 2,
  };
  const centre = {
    x: (mass.rect.minX + mass.rect.maxX) / 2,
    z: (mass.rect.minZ + mass.rect.maxZ) / 2,
  };
  // Probed inward from just outside the face. Further out would report a ring
  // ledge instead of the wall; on the axis it would report whatever is tucked
  // inside. This is the one offset that answers the question asked.
  const STAND_OFF = 1.2;
  const faces = [
    ["east ", new THREE.Vector3(-1, 0, 0), half.x],
    ["west ", new THREE.Vector3(1, 0, 0), half.x],
    ["north", new THREE.Vector3(0, 0, 1), half.z],
    ["south", new THREE.Vector3(0, 0, -1), half.z],
  ];
  // Sampled clear of the top and bottom seams, where a cornice legitimately
  // stands proud of the wall and a ring floor legitimately runs in under it.
  const from = mass.baseY + 0.5;
  const to = mass.topY - 0.5;
  const steps = Math.max(2, Math.round((to - from) / 0.6));
  let thin = 0;
  let rows = 0;
  const detail = [];
  for (let s = 0; s <= steps; s++) {
    const y = from + ((to - from) * s) / steps;
    if (y > mass.topY - 0.05) continue;
    const found = [];
    for (const [, direction, reach] of faces) {
      const origin = new THREE.Vector3(
        centre.x - direction.x * (reach + STAND_OFF),
        y,
        centre.z - direction.z * (reach + STAND_OFF),
      );
      const distance = castAlong(origin, direction, reach + STAND_OFF + 0.5);
      found.push(distance === null ? null : reach + STAND_OFF - distance);
    }
    rows++;
    const hit = found.filter((v) => v !== null).length;
    // Half-width measured back from the axis. Allowed to be a little inside the
    // collision: a moulded face and a recessed louvre panel both cut inward from
    // the plane the player is stopped by, and neither is a thin wall.
    const worst = hit ? Math.min(...found.filter((v) => v !== null)) : 0;
    const widest = hit ? Math.max(...found.filter((v) => v !== null)) : 0;
    const bound = Math.min(half.x, half.z);
    const ok = tapers
      ? hit === 4 && widest <= bound + 0.02
      : hit === 4 && worst >= bound * 0.82;
    if (!ok) thin++;
    detail.push({ y, hit, worst, widest, ok });
  }
  console.log(
    `${mass.id}  ${(half.x * 2).toFixed(1)} x ${(half.z * 2).toFixed(1)}m, ` +
      `${tapers ? "tapering" : "solid"} ${mass.baseY.toFixed(1)}..${mass.topY.toFixed(1)}m`,
  );
  for (const row of detail) {
    console.log(
      `  y=${row.y.toFixed(1).padStart(5)}  faces ${row.hit}/4  ` +
        (tapers
          ? `half-width ${row.worst.toFixed(2)}..${row.widest.toFixed(2)}m  ${row.ok ? "ok" : "OUTSIDE ITS BOUND"}`
          : `half-width min ${row.worst.toFixed(2)}m  ${row.ok ? "ok" : "THIN"}`),
    );
  }
  if (thin > 0) {
    fail(
      tapers
        ? `${mass.id}: ${thin}/${rows} sections missing or reaching outside the declared spire`
        : `${mass.id}: ${thin}/${rows} sections thinner than the authored solid`,
    );
  } else {
    console.log(
      tapers
        ? `  ok: ${rows}/${rows} sections present and inside the declared taper`
        : `  ok: ${rows}/${rows} sections carry masonry to the collision face`,
    );
  }
}

// ---- 3. the ring surfaces ---------------------------------------------------
// The standable part of a ring is its rect minus the plan footprint of every
// non-landable mass that fills the space a standing body needs. That is the same
// rule the hull exporter authored the floors against, so the two cannot drift.

console.log(`\n--- ring surfaces (grid ${GRID}x${GRID}, tolerance -${TOL_BELOW}m / +${TOL_ABOVE}m) ---`);
const deckReport = [];
for (const deck of decks) {
  const { rect, y } = deck;
  const blocking = solids.filter((m) => spansPlane(m, y));
  let blocked = 0;
  let covered = 0;
  let air = 0;
  let above = 0;
  let dyMin = Infinity;
  let dyMax = -Infinity;
  let dySum = 0;
  const worstAir = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = rect.minX + ((i + 0.5) / GRID) * (rect.maxX - rect.minX);
      const z = rect.minZ + ((j + 0.5) / GRID) * (rect.maxZ - rect.minZ);
      // Inside a solid the player cannot be, and the masonry there rises well
      // above the ring, so those samples are neither the art's job to cover nor
      // fair to call an intersection. Shrunk by the wall clearance so a sample
      // hugging the shaft is not judged against the shaft's own face.
      if (blocking.some((m) => insideRect(m.rect, x, z, -WALL_CLEARANCE))) {
        blocked++;
        continue;
      }
      const hitY = castDown(x, z, y + 0.6);
      if (hitY === null || hitY < y - TOL_BELOW) {
        air++;
        if (worstAir.length < 4) worstAir.push([x, z, hitY]);
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
  const standable = GRID * GRID - blocked;
  const pct = standable > 0 ? (covered / standable) * 100 : 0;
  console.log(
    `${deck.id.padEnd(16)} y=${y.toFixed(2)}  ${standable} standable samples ` +
      `(${blocked} inside ${blocking.map((m) => m.id).join("/") || "nothing"})`,
  );
  console.log(
    `  on the plane ${covered}/${standable} (${pct.toFixed(1)}%)  ` +
      `dy min ${dyMin === Infinity ? "n/a" : dyMin.toFixed(3)} ` +
      `max ${dyMax === -Infinity ? "n/a" : dyMax.toFixed(3)} ` +
      `mean ${covered ? (dySum / covered).toFixed(3) : "n/a"}`,
  );
  console.log(`  walking on air ${air}   art above the plane ${above}`);
  for (const [x, z, hitY] of worstAir) {
    console.log(
      `    air at (${x.toFixed(2)}, ${z.toFixed(2)}) — ` +
        `${hitY === null ? "nothing below at all" : `next surface ${hitY.toFixed(2)}m`}`,
    );
  }
  deckReport.push({ id: deck.id, y, pct, air, above });
  if (standable === 0) {
    fail(`${deck.id}: no standable area at all inside the draw box, so no floor can be drawn`);
  } else if (pct < 95) {
    fail(`${deck.id}: only ${pct.toFixed(1)}% of the authored ring has stone under the foot`);
  }
  if (above > 0) fail(`${deck.id}: ${above} samples sit above the plane the player walks on`);
}

// ---- 4. headroom ------------------------------------------------------------
// A ledge you cannot stand up on is not a ledge. This is where the stage above
// oversails the ring below, which on a steeple is everywhere.

console.log(`\n--- headroom over each ring (a ${STAND_HEIGHT.toFixed(2)}m runner) ---`);
for (const deck of decks) {
  const { rect, y } = deck;
  const blocking = solids.filter((m) => spansPlane(m, y));
  let low = 0;
  let samples = 0;
  let worst = Infinity;
  let worstAt = null;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = rect.minX + ((i + 0.5) / GRID) * (rect.maxX - rect.minX);
      const z = rect.minZ + ((j + 0.5) / GRID) * (rect.maxZ - rect.minZ);
      if (blocking.some((m) => insideRect(m.rect, x, z, -WALL_CLEARANCE))) continue;
      samples++;
      const ceiling = castUp(x, z, y + 0.05, STAND_HEIGHT + 0.6);
      const clear = ceiling === null ? Infinity : ceiling - y;
      if (clear < worst) {
        worst = clear;
        worstAt = [x, z];
      }
      if (clear < STAND_HEIGHT) low++;
    }
  }
  const pct = samples ? (low / samples) * 100 : 0;
  console.log(
    `${deck.id.padEnd(16)} lowest ceiling ${worst === Infinity ? "open sky" : `${worst.toFixed(2)}m`}` +
      `${worstAt && worst !== Infinity ? ` at (${worstAt[0].toFixed(2)}, ${worstAt[1].toFixed(2)})` : ""}` +
      `   crouch-only ${low}/${samples} (${pct.toFixed(1)}%)`,
  );
  // A steeple's rings are overhung by the stage above by design, so a minority
  // of a ring being duck-under is authored rather than broken. A majority means
  // the art has closed the ledge in.
  if (pct > 40) {
    fail(`${deck.id}: ${pct.toFixed(0)}% of the ring has under ${STAND_HEIGHT}m of headroom`);
  }
}

// ---- 5. the dive ------------------------------------------------------------
// The signature move. Flown with the engine's own gravity, jump velocity and run
// speed off the authored takeoff node, and every step checked for steeple
// geometry inside the capsule. This is the one probe that answers the question
// the mission actually asks of this asset.

console.log(`\n--- the leaps of faith, flown ballistically ---`);
// The bearing is read off the route rather than assumed. Both dives happen to
// leave northward, but a probe that hardcodes that would silently stop checking
// the day a leap node moves — and this is the one probe whose whole job is the
// move nobody survives getting wrong.
const nodeById = new Map(NODES.map((n) => [n.id, n]));
const leaps = LINKS.filter((l) => {
  const from = nodeById.get(l.from);
  return (
    from &&
    decks.some((d) => d.id === from.surface) &&
    (l.verb?.includes("LEAP") || l.kind?.includes("LEAP"))
  );
});
if (leaps.length === 0) fail("no leap link in the route leaves this asset");

for (const leap of leaps) {
  const node = nodeById.get(leap.from);
  const to = nodeById.get(leap.to);
  const deck = decks.find((d) => d.id === node.surface);
  const [nx, ny, nz] = node.pos;
  const heading = new THREE.Vector3(to.pos[0] - nx, 0, to.pos[2] - nz).normalize();
  const gap = Math.hypot(to.pos[0] - nx, to.pos[2] - nz);
  const standing = castDown(nx, nz, ny + 0.6);
  console.log(
    `${leap.id} off ${deck.id} (${leap.line} ${leap.verb})`,
  );
  console.log(
    `  takeoff (${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)}) heading ` +
      `(${heading.x.toFixed(2)}, ${heading.z.toFixed(2)}) toward ${leap.to}, ` +
      `${gap.toFixed(2)}m across and ${(ny - to.pos[1]).toFixed(2)}m down`,
  );
  if (standing === null || Math.abs(standing - ny) > TOL_BELOW) {
    fail(
      `${node.id}: the takeoff itself has ` +
        `${standing === null ? "nothing" : `stone at ${standing.toFixed(2)}m, not ${ny.toFixed(2)}m`}` +
        ` under it — the mission's signature move leaves from air`,
    );
  } else {
    console.log(`  takeoff underfoot: stone at ${standing.toFixed(3)}m (dy ${(standing - ny).toFixed(3)})`);
  }

  // Fly it, and sweep the capsule rather than a point: a rail 200mm to the side
  // of the centre line still takes a shoulder off.
  const STEP = 0.04;
  const speed = leap.speedMps ?? RUN_SPEED;
  let blockedAt = null;
  let leftTheDeck = null;
  const trace = [];
  for (let t = 0; t < 4.0; t += STEP) {
    const travelled = speed * t;
    const y = ny + RUNNING_JUMP_VY * t - 0.5 * GRAVITY * t * t;
    const x = nx + heading.x * travelled;
    const z = nz + heading.z * travelled;
    if (y < ny - 12) break;
    // Still over the platform being run across: that is a run, not the dive.
    const overDeck =
      x > deck.rect.minX && x < deck.rect.maxX && z > deck.rect.minZ && z < deck.rect.maxZ;
    if (overDeck && y <= ny + 0.02) continue;
    if (leftTheDeck === null && !overDeck) leftTheDeck = { travelled, y };
    // Sweep the capsule's width and its whole height, and look up as well as
    // along: on this tower the thing in the way of a leap is never in front of
    // the player, it is the ring above them.
    let near = null;
    for (const side of [-1, 0, 1]) {
      const ox = x - heading.z * side * CAPSULE_RADIUS * 0.9;
      const oz = z + heading.x * side * CAPSULE_RADIUS * 0.9;
      const ceiling = castUp(ox, oz, y + 0.1, STAND_HEIGHT);
      const ahead = castAlong(
        new THREE.Vector3(ox, y + STAND_HEIGHT * 0.5, oz), heading, CAPSULE_RADIUS,
      );
      const hit = ceiling !== null ? ceiling : ahead !== null ? y + STAND_HEIGHT * 0.5 : null;
      if (hit !== null && (near === null || hit < near.hit)) {
        near = { travelled, y, hit, x: ox, z: oz };
      }
    }
    if (near && (blockedAt === null || near.hit < blockedAt.hit)) blockedAt = near;
    if (trace.length < 12 && Math.round(t / STEP) % 8 === 0) {
      trace.push(
        `    +${travelled.toFixed(2)}m out, y ${y.toFixed(2)}m${near ? "  <-- surface at " + near.hit.toFixed(2) + "m" : ""}`,
      );
    }
  }
  console.log(trace.join("\n"));
  if (leftTheDeck) {
    console.log(
      `  leaves the platform ${leftTheDeck.travelled.toFixed(2)}m out at y ` +
        `${leftTheDeck.y.toFixed(2)}m (${(leftTheDeck.y - ny).toFixed(2)}m above the takeoff)`,
    );
  }
  if (!blockedAt) {
    console.log(`  corridor clear: nothing of the steeple is inside the dive`);
    continue;
  }

  // Something is in the arc. Whether that is this mesh's fault is a different
  // question from whether it is there, and conflating the two is how an art pass
  // ends up deleting a ring the player stands on. A ring the level authored over
  // a take-off HAS to be drawn — the player walks on it — so the only thing the
  // art is answerable for is how far below its own plane it hangs, and the budget
  // for that is exactly enough to leave a standing runner under it.
  const explaining = decks
    .filter(
      (d) =>
        d.y > blockedAt.y &&
        blockedAt.x > d.rect.minX && blockedAt.x < d.rect.maxX &&
        blockedAt.z > d.rect.minZ && blockedAt.z < d.rect.maxZ,
    )
    .sort((a, b) => a.y - b.y)[0];
if (!explaining) {
    fail(
      `${leap.id}: a surface at ${blockedAt.hit.toFixed(2)}m is in the dive ` +
        `${blockedAt.travelled.toFixed(2)}m out, and no authored ring explains it`,
    );
    continue;
  }
  const nextDown = decks.filter((d) => d.y < explaining.y).sort((a, b) => b.y - a.y)[0];
  const budget = nextDown ? explaining.y - nextDown.y - STAND_HEIGHT : 1.0;
  const hang = explaining.y - blockedAt.hit;
  console.log(
    `  the arc passes under ${explaining.id} at ${explaining.y.toFixed(2)}m, ` +
      `${blockedAt.travelled.toFixed(2)}m out and ${(blockedAt.y - ny).toFixed(2)}m up`,
  );
  console.log(
    `  its underside is ${blockedAt.hit.toFixed(2)}m — hanging ${(hang * 1000).toFixed(0)}mm below ` +
      `its own plane, against a ${(budget * 1000).toFixed(0)}mm budget`,
  );
  if (hang > budget + 0.01) {
    fail(
      `${leap.id}: ${explaining.id}'s cornice hangs ${(hang * 1000).toFixed(0)}mm below its ` +
        `plane, ${((hang - budget) * 1000).toFixed(0)}mm more than the headroom under it allows`,
    );
  } else {
    console.log(
      `  the art is inside its budget: what the arc clips is the authored plane itself. ` +
        `${explaining.id} is a ring the player stands on and reaches ${
          heading.z < 0 ? "as far north as" : "as far as"
        } the take-off, so no mesh can be out of its way. LEVEL NOTE, not an art defect.`,
    );
  }
}

// ---- verdict ----------------------------------------------------------------

console.log("");
for (const row of deckReport) {
  console.log(
    `${row.id.padEnd(16)} y=${row.y.toFixed(2)}  ${row.pct.toFixed(1)}% underfoot  ` +
      `${row.air} air  ${row.above} intersecting`,
  );
}
console.log(
  failures
    ? `\nVERIFY FAILED (${failures} problem${failures === 1 ? "" : "s"})`
    : `\nVERIFY OK: one draw, ${(size.y * scale).toFixed(2)}m tall on the shaft axis, ` +
        `all ${decks.length} authored climb stages underfoot, both dives clear`,
);
