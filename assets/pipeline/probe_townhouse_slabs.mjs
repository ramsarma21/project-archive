// Slice the shipped Town House mesh into height slabs and report, for each, how
// much of the building's plan actually has wall in it. A continuous building is
// solid (its facade present) at every height between the ground and the leads; a
// building drawn as separated storeys has bands where the only geometry is the
// thin authored ledge slab and the facade behind it is missing — which reads
// from the street as a floating cornice with sky under it.
//
// This is diagnosis, not a gate. It answers one question with evidence: is the
// gap the owner sees a hole in the mesh, or a scale/placement error? The scale
// is already known good (verify_m1_townhouse reports 1.0000), so a band here
// with facade present at the deck plane and absent just below it is the proof
// that the asset was authored as pieces.
//
// Run: node --import tsx assets/pipeline/probe_townhouse_slabs.mjs [file.glb]
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
const { ASSETS } = await load("packages", "mission-m1", "src", "assets.ts");

const ASSET_KEY = "bldg-townhouse-1713";
const target = resolve(
  process.argv[2] ??
    join(repoRoot, "apps", "web", "public", "world", "props", `${ASSET_KEY}.glb`),
);
if (!existsSync(target)) throw new Error(`missing: ${target}`);

const declared = ASSETS.find((a) => a.key === ASSET_KEY);
let [BX, BY, BZ] = declared.sizeM;

// Silence the node-side texture-blob warnings; they are harmless here.
const warn = console.warn;
console.warn = () => {};
const data = readFileSync(target);
const loader = new GLTFLoader();
const gltf = await new Promise((res, rej) =>
  loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", res, rej),
);
console.warn = warn;

const scene = gltf.scene;
scene.updateMatrixWorld(true);

// Work in the mesh's own frame (minY == 0), which verify confirms is the draw
// frame at scale 1.0000, so heights read directly as the authored bands.
const targets = [];
scene.traverse((o) => {
  if (o.isMesh) targets.push(o);
});

const box = new THREE.Box3().setFromObject(scene);
// The shipped mesh is exactly the declared box; a raw/intermediate generation is
// at an arbitrary scale, so drive the slabbing off the mesh's own extent.
BX = box.max.x - box.min.x;
BY = box.max.y - box.min.y;
BZ = box.max.z - box.min.z;
console.log(`=== ${target.replace(repoRoot + "/", "")}`);
console.log(`file ${(statSync(target).size / 1024 / 1024).toFixed(2)} MiB`);
console.log(
  `mesh bbox x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)}` +
    `  y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}` +
    `  z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`,
);

// The body footprint in mesh-local x/z. The building's plan centre is the box
// centre; the body wall is the declared width/depth. Ledges oversail it, so a
// facade sample is taken just inside each of the four body faces.
const cx = (box.min.x + box.max.x) / 2;
const cz = (box.min.z + box.max.z) / 2;

// Cast a horizontal ray straight through the building at a given height and
// bearing, and report whether it hits anything and how thick the first solid is.
// A facade present at height y stops the ray near the wall; a gap band lets it
// pass into open air where the only thing to hit is the far ledge lip or nothing.
const raycaster = new THREE.Raycaster();
raycaster.far = 40;
function hitInward(y, dir) {
  // Start well outside the box on the given axis, aim at the plan centre.
  const from =
    dir === "+x" ? new THREE.Vector3(box.min.x - 4, y, cz)
    : dir === "-x" ? new THREE.Vector3(box.max.x + 4, y, cz)
    : dir === "+z" ? new THREE.Vector3(cx, y, box.min.z - 4)
    : new THREE.Vector3(cx, y, box.max.z + 4);
  const v =
    dir === "+x" ? new THREE.Vector3(1, 0, 0)
    : dir === "-x" ? new THREE.Vector3(-1, 0, 0)
    : dir === "+z" ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 0, -1);
  raycaster.set(from, v);
  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length === 0) return null;
  // Distance from the box face to the first surface.
  const start = dir === "+x" ? box.min.x - 4 : dir === "-x" ? box.max.x + 4
    : dir === "+z" ? box.min.z - 4 : box.max.z + 4;
  return Math.abs(hits[0].distance - 4);
}

// Vertex population per slab, as a second, independent read on where the mesh
// actually has material — a raycast can miss a thin sliver, a vertex census
// cannot lie about an empty band.
const SLABS = Math.round(BY / 0.2);
const pop = new Array(SLABS).fill(0);
const spanX = new Array(SLABS).fill(null);
const spanZ = new Array(SLABS).fill(null);
for (const mesh of targets) {
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    mesh.localToWorld(v);
    const s = Math.min(SLABS - 1, Math.max(0, Math.floor((v.y - box.min.y) / BY * SLABS)));
    pop[s]++;
    const ex = spanX[s] ?? { lo: Infinity, hi: -Infinity };
    ex.lo = Math.min(ex.lo, v.x); ex.hi = Math.max(ex.hi, v.x); spanX[s] = ex;
    const ez = spanZ[s] ?? { lo: Infinity, hi: -Infinity };
    ez.lo = Math.min(ez.lo, v.z); ez.hi = Math.max(ez.hi, v.z); spanZ[s] = ez;
  }
}

const bands = (declared.standableAt ?? []).slice();
console.log(`\ndeclared standable bands: ${JSON.stringify(bands)}m`);
console.log(
  `\n  height(m)   verts  planX(m)  planZ(m)   facade hit from each face (m into ${BX.toFixed(0)}x${BZ.toFixed(0)} plan)`,
);
for (let s = 0; s < SLABS; s++) {
  const y = box.min.y + (s + 0.5) / SLABS * BY;
  const px = spanX[s] ? (spanX[s].hi - spanX[s].lo) : 0;
  const pz = spanZ[s] ? (spanZ[s].hi - spanZ[s].lo) : 0;
  const px_ = hitInward(y, "+x"), mx_ = hitInward(y, "-x");
  const pz_ = hitInward(y, "+z"), mz_ = hitInward(y, "-z");
  const f = (v) => (v === null ? "  --  " : v.toFixed(2).padStart(6));
  const nearBand = bands.some((b) => Math.abs(b - y) < BY / SLABS / 2 + 0.05);
  // A true void is a height at which a ray fired inward from every one of the
  // four faces finds NOTHING — no facade, no drum core, nothing between the
  // decks. A centred drum is hit by all four rays (far from the plane, but hit),
  // so it is not a void even though the facade edge is absent and a box's own
  // vertices only sit at its top and bottom.
  const anyHit = [px_, mx_, pz_, mz_].some((v) => v !== null);
  const flag =
    nearBand ? " <- deck" : !anyHit && pop[s] < 40 ? " <- EMPTY (sky band)" : "";
  console.log(
    `  ${y.toFixed(2).padStart(6)}   ${String(pop[s]).padStart(6)}  ` +
      `${px.toFixed(1).padStart(6)}  ${pz.toFixed(1).padStart(6)}   ` +
      `+x${f(px_)} -x${f(mx_)} +z${f(pz_)} -z${f(mz_)}${flag}`,
  );
}
