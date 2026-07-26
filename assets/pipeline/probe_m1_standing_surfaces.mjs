// Coverage for named route-bearing surfaces, whether they pass or fail.
//
// `verify_m1_placements.mjs` is a gate: it prints a surface only when less than
// 90% of its footprint has drawn stone under it, which is right for a gate and
// useless for reporting progress — a surface that goes from 0% to 100% leaves the
// output entirely and the number never appears. This asks the same question about
// specific surfaces and always prints the answer.
//
// The placement, the contain-fit, the bottom-align, the 5x5 grid, the 0.35m
// step-down and the sibling-geometry rule are all the verifier's, deliberately:
// a probe that measured this its own way would be a second opinion rather than a
// progress report on the first.
//
// Run: node --import tsx assets/pipeline/probe_m1_standing_surfaces.mjs [PART_ID ...]
globalThis.self = globalThis;
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const threeRoot = join(repoRoot, "apps", "web", "node_modules", "three");
const THREE = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);
const load = (...parts) => import(pathToFileURL(join(repoRoot, ...parts)));
const { M1_EFFIGY_RUN } = await load("packages", "mission-m1", "src", "level", "index.ts");
const { sceneryPlacements } = await load("packages", "mission-m1", "src", "runtime.ts");

const WANTED = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["HAY_WAIN_W", "HAY_WAIN_E", "HOLLIS_BUTTRESS"];

const SUPPORT_TOL = 0.35;
const SUPPORT_MIN = 0.9;
const GRID = 5;

const parts = new Map();
for (const mass of M1_EFFIGY_RUN.masses) {
  parts.set(mass.id, {
    id: mass.id, kind: "MASS", rect: mass.rect, baseY: mass.baseY,
    topY: Number.isFinite(mass.topY) ? mass.topY : mass.baseY + 12,
  });
}
for (const deck of M1_EFFIGY_RUN.decks) {
  parts.set(deck.id, { id: deck.id, kind: "DECK", rect: deck.rect, baseY: deck.y, topY: deck.y });
}
const routeSurfaces = new Set(M1_EFFIGY_RUN.nodes.map((n) => n.surface));

const sceneCache = new Map();
async function meshOf(assetPath) {
  if (sceneCache.has(assetPath)) return sceneCache.get(assetPath);
  const file = join(repoRoot, "apps", "web", "public", "world", assetPath.replace(/^world\//, ""));
  let value = null;
  if (existsSync(file)) {
    const data = readFileSync(file);
    try {
      const gltf = await new Promise((res, rej) =>
        new GLTFLoader().parse(
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", res, rej,
        ),
      );
      const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
      value = { json: data, natural: { x: size.x, y: size.y, z: size.z } };
    } catch (error) {
      value = { error: String(error).slice(0, 80) };
    }
  }
  sceneCache.set(assetPath, value);
  return value;
}

async function place(placement) {
  const entry = await meshOf(placement.assetPath);
  if (!entry || entry.error) return null;
  const data = entry.json;
  const gltf = await new Promise((res, rej) =>
    new GLTFLoader().parse(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", res, rej,
    ),
  );
  const scene = gltf.scene;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) if (m) m.side = THREE.DoubleSide;
  });
  scene.updateMatrixWorld(true);
  const n = entry.natural;
  if (placement.fit === "PROP") {
    scene.scale.setScalar(
      Math.min(placement.size[0] / n.x, placement.size[1] / n.y, placement.size[2] / n.z),
    );
  } else {
    scene.scale.set(placement.size[0] / n.x, placement.size[1] / n.y, placement.size[2] / n.z);
  }
  scene.rotation.y = placement.yaw ?? 0;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const centre = box.getCenter(new THREE.Vector3());
  scene.position.set(
    placement.pos[0] - centre.x, placement.pos[1] - box.min.y, placement.pos[2] - centre.z,
  );
  scene.updateMatrixWorld(true);
  const targets = [];
  scene.traverse((o) => {
    if (o.isMesh) targets.push(o);
  });
  return targets;
}

const placements = sceneryPlacements();
const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const placedCache = new Map();

for (const id of WANTED) {
  const part = parts.get(id);
  if (!part) {
    console.log(`${id.padEnd(18)} no such collision part`);
    continue;
  }
  const onRoute = routeSurfaces.has(part.id);
  const plane = part.kind === "DECK" ? part.baseY : onRoute ? part.topY : part.baseY;
  const near = placements.filter((p) => {
    if (p.parts.includes(part.id) && Math.abs(p.pos[1] - plane) < 0.01) return false;
    const bx0 = p.pos[0] - p.size[0] / 2, bx1 = p.pos[0] + p.size[0] / 2;
    const bz0 = p.pos[2] - p.size[2] / 2, bz1 = p.pos[2] + p.size[2] / 2;
    return (
      bx1 > part.rect.minX && bx0 < part.rect.maxX &&
      bz1 > part.rect.minZ && bz0 < part.rect.maxZ &&
      p.pos[1] <= plane + 0.02 && p.pos[1] + p.size[1] >= plane - SUPPORT_TOL - 0.02
    );
  });
  const targets = [];
  for (const p of near) {
    if (!placedCache.has(p.id)) placedCache.set(p.id, await place(p));
    const t = placedCache.get(p.id);
    if (t) targets.push(...t);
  }
  let hit = 0;
  let total = 0;
  let lowest = Infinity;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = part.rect.minX + ((i + 0.5) / GRID) * (part.rect.maxX - part.rect.minX);
      const z = part.rect.minZ + ((j + 0.5) / GRID) * (part.rect.maxZ - part.rect.minZ);
      total++;
      raycaster.set(new THREE.Vector3(x, plane + 3.0, z), new THREE.Vector3(0, -1, 0));
      const hits = raycaster.intersectObjects(targets, false);
      const carried = hits.filter((h) => Math.abs(h.point.y - plane) < SUPPORT_TOL);
      if (carried.length) {
        hit++;
        lowest = Math.min(lowest, Math.max(...carried.map((h) => h.point.y)));
      }
    }
  }
  const fraction = total ? hit / total : 1;
  const assets = [...new Set(near.map((p) => p.asset))];
  console.log(
    `${id.padEnd(18)} ${part.kind} ${onRoute ? "ROUTE" : "     "} plane ${plane.toFixed(2)}m  ` +
      `${(fraction * 100).toFixed(0)}% of ${total} samples carried  ` +
      `${fraction >= SUPPORT_MIN ? "OK  " : "DRY "}` +
      `${Number.isFinite(lowest) ? `lowest carried face ${lowest.toFixed(3)}m  ` : ""}` +
      `drawn by: ${assets.join(", ") || "nothing"}`,
  );
}
