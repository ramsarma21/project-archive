// Slice the shipped bldg-brick mesh and look for the defect the owner and the
// visual sweep both saw: a torn, DOUBLED facade — window trim and mortar
// shredded into pale zigzag ribbons with ghosted, doubled frames, identical from
// every angle at near-normal light. "Doubled" and "identical from every angle"
// are the signatures of GEOMETRY, not lighting: two shells occupying the same
// space z-fight into ribbons, and exact-duplicate faces double every edge.
//
// This answers, with numbers rather than a hypothesis, whether the mesh carries:
//   - exact-duplicate triangles (the same three positions drawn twice) — the
//     "doubled" frames, and the classic Meshy double-shell / mirror-merge tell;
//   - near-coincident triangles (two surfaces within a hair of each other on
//     parallel planes) — the z-fighting that reads as a shredded ribbon;
//   - degenerate (zero-area) triangles — decimation slivers;
//   - unwelded vertices (positions that appear many times) — a mesh that was
//     never merged, so every course of brick is a free-floating quad.
// and reports the atlas and UV extent so a torn-UV reading can be told from a
// torn-GEOMETRY one.
//
// Run: node --import tsx assets/pipeline/probe_brick_facade.mjs [file.glb]
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

const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const target = resolve(
  fileArg ?? join(repoRoot, "apps", "web", "public", "world", "props", "bldg-brick.glb"),
);
if (!existsSync(target)) throw new Error(`missing: ${target}`);

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

console.log(`=== ${target.replace(repoRoot + "/", "")}`);
console.log(`file ${(statSync(target).size / 1024 / 1024).toFixed(3)} MiB`);

// Gather every triangle in world space, plus its UVs.
const meshes = [];
scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
console.log(`meshes ${meshes.length}`);

const box = new THREE.Box3().setFromObject(scene);
const sz = box.getSize(new THREE.Vector3());
const diag = Math.hypot(sz.x, sz.y, sz.z);
console.log(`natural bbox ${sz.x.toFixed(3)} x ${sz.y.toFixed(3)} x ${sz.z.toFixed(3)}  (diag ${diag.toFixed(3)})`);

const EPS = diag * 1e-4;           // weld / coincidence tolerance
const q = (v) => Math.round(v / EPS);
const tris = [];
let materials = new Set();
for (const mesh of meshes) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const idx = g.index;
  const count = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) if (m) materials.add(m.uuid);
  for (let i = 0; i < count; i += 3) {
    const ia = idx ? idx.getX(i) : i;
    const ib = idx ? idx.getX(i + 1) : i + 1;
    const ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia); mesh.localToWorld(a);
    b.fromBufferAttribute(pos, ib); mesh.localToWorld(b);
    c.fromBufferAttribute(pos, ic); mesh.localToWorld(c);
    const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() * 0.5;
    const uvs = uv ? [
      [uv.getX(ia), uv.getY(ia)], [uv.getX(ib), uv.getY(ib)], [uv.getX(ic), uv.getY(ic)],
    ] : null;
    tris.push({
      a: a.clone(), b: b.clone(), c: c.clone(), area,
      centroid: new THREE.Vector3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3),
      uvs,
    });
  }
}
console.log(`triangles ${tris.length}   materials ${materials.size}`);

// --- exact-duplicate faces: same three positions (order-independent) ----------
const faceKey = (t) => [
  `${q(t.a.x)},${q(t.a.y)},${q(t.a.z)}`,
  `${q(t.b.x)},${q(t.b.y)},${q(t.b.z)}`,
  `${q(t.c.x)},${q(t.c.y)},${q(t.c.z)}`,
].sort().join("|");
const seen = new Map();
let dupFaces = 0;
for (const t of tris) {
  const k = faceKey(t);
  const n = (seen.get(k) ?? 0) + 1;
  seen.set(k, n);
  if (n > 1) dupFaces++;
}
console.log(`\nexact-duplicate faces (same 3 positions drawn again): ${dupFaces}  (${(dupFaces / tris.length * 100).toFixed(1)}% of faces)`);

// --- degenerate faces ---------------------------------------------------------
const degen = tris.filter((t) => t.area < EPS * EPS).length;
console.log(`degenerate (near-zero-area) faces: ${degen}  (${(degen / tris.length * 100).toFixed(1)}%)`);

// --- unwelded vertices: how many distinct positions vs raw corners ------------
const posSet = new Set();
let corners = 0;
for (const t of tris) {
  for (const v of [t.a, t.b, t.c]) { posSet.add(`${q(v.x)},${q(v.y)},${q(v.z)}`); corners++; }
}
console.log(`vertices: ${corners} face-corners collapse to ${posSet.size} welded positions (${(corners / posSet.size).toFixed(1)}x)`);

// --- near-coincident parallel faces: the z-fight that reads as a ribbon --------
// Bucket triangle centroids into a grid a few EPS wide and, within a bucket,
// count pairs whose centroids are within a small multiple of EPS and whose
// planes are near-parallel: two skins of the same wall separated by <~2mm.
const CELL = Math.max(EPS * 40, diag * 0.004);
const near = new Map();
for (let i = 0; i < tris.length; i++) {
  const t = tris[i];
  const key = `${Math.round(t.centroid.x / CELL)},${Math.round(t.centroid.y / CELL)},${Math.round(t.centroid.z / CELL)}`;
  (near.get(key) ?? near.set(key, []).get(key)).push(i);
}
const normalOf = (t) => new THREE.Vector3().subVectors(t.b, t.a).cross(new THREE.Vector3().subVectors(t.c, t.a)).normalize();
let coincidentPairs = 0;
const COINCIDE = diag * 0.004; // ~ a few mm on this mesh's scale
for (const bucket of near.values()) {
  for (let x = 0; x < bucket.length; x++) {
    for (let y = x + 1; y < bucket.length; y++) {
      const t1 = tris[bucket[x]], t2 = tris[bucket[y]];
      if (faceKey(t1) === faceKey(t2)) continue; // counted as exact dup already
      const d = t1.centroid.distanceTo(t2.centroid);
      if (d > COINCIDE) continue;
      const n1 = normalOf(t1), n2 = normalOf(t2);
      if (Math.abs(n1.dot(n2)) > 0.985) coincidentPairs++;
    }
  }
}
console.log(`near-coincident parallel face pairs (<${COINCIDE.toFixed(4)}m apart, ~parallel): ${coincidentPairs}`);

// --- UV extent + broken UV faces ---------------------------------------------
let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, brokenUV = 0, uvFaces = 0;
for (const t of tris) {
  if (!t.uvs) continue;
  uvFaces++;
  for (const [u, v] of t.uvs) {
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
  }
  // Zero-area UV triangle: the face samples a single texel line -> a smear/ribbon.
  const [[u0, v0], [u1, v1], [u2, v2]] = t.uvs;
  const uvArea = Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) * 0.5;
  if (uvArea < 1e-8) brokenUV++;
}
if (uvFaces) {
  console.log(`\nUV extent u ${uMin.toFixed(3)}..${uMax.toFixed(3)}  v ${vMin.toFixed(3)}..${vMax.toFixed(3)}`);
  console.log(`faces with a zero-area UV triangle (sample a line -> smear): ${brokenUV} (${(brokenUV / uvFaces * 100).toFixed(1)}%)`);
}

// --- atlas dims (from the GLB JSON chunk) -------------------------------------
function atlases(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  const views = json.bufferViews ?? [];
  const binStart = 20 + jsonLength + 8;
  return (json.images ?? []).map((image) => {
    const view = views[image.bufferView] ?? {};
    const at = binStart + (view.byteOffset ?? 0);
    const bytes = buffer.subarray(at, at + (view.byteLength ?? 0));
    let w = 0, h = 0;
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      for (let o = 2; o + 9 < bytes.length; ) {
        if (bytes[o] !== 0xff) { o++; continue; }
        const marker = bytes[o + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          h = bytes.readUInt16BE(o + 5); w = bytes.readUInt16BE(o + 7); break;
        }
        o += 2 + bytes.readUInt16BE(o + 2);
      }
    } else if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      w = bytes.readUInt32BE(16); h = bytes.readUInt32BE(20);
    }
    return { mime: image.mimeType ?? "?", bytes: bytes.length, w, h };
  });
}
const at = atlases(data);
console.log(`\natlases ${at.length}` + at.map((a) => `  ${a.w}x${a.h} ${a.mime} ${(a.bytes / 1024 / 1024).toFixed(2)}MiB`).join(""));

// --- sliver / spike faces: the "torn paper flap" signature ---------------------
// A Meshy generation that decimated badly leaves needle triangles — one tiny
// angle, two long edges — that read as pale flaps standing off the wall. Count
// faces whose smallest interior angle is under 8 degrees but which are NOT
// near-zero-area (those are the degenerates already counted).
let slivers = 0;
const MIN_ANGLE = (8 * Math.PI) / 180;
for (const t of tris) {
  if (t.area < EPS * EPS) continue;
  const ab = new THREE.Vector3().subVectors(t.b, t.a);
  const bc = new THREE.Vector3().subVectors(t.c, t.b);
  const ca = new THREE.Vector3().subVectors(t.a, t.c);
  const la = ca.length(), lb = ab.length(), lc = bc.length();
  // angle at each vertex via law of cosines
  const angA = Math.acos(Math.min(1, Math.max(-1, (la * la + lb * lb - lc * lc) / (2 * la * lb || 1))));
  const angB = Math.acos(Math.min(1, Math.max(-1, (lb * lb + lc * lc - la * la) / (2 * lb * lc || 1))));
  const angC = Math.PI - angA - angB;
  if (Math.min(angA, angB, angC) < MIN_ANGLE) slivers++;
}
console.log(`sliver faces (min interior angle < 8deg, non-degenerate): ${slivers} (${(slivers / tris.length * 100).toFixed(1)}%)`);

// --- dump the atlas so a torn bake can be told from torn geometry -------------
if (process.argv.includes("--dump-atlas")) {
  const buffer = data;
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  const views = json.bufferViews ?? [];
  const binStart = 20 + jsonLength + 8;
  const { writeFileSync } = await import("node:fs");
  (json.images ?? []).forEach((image, i) => {
    const view = views[image.bufferView] ?? {};
    const start = binStart + (view.byteOffset ?? 0);
    const bytes = buffer.subarray(start, start + (view.byteLength ?? 0));
    const ext = (image.mimeType ?? "").includes("png") ? "png" : "jpg";
    const out = join(repoRoot, ".affordwork", "townhouse-fix", `brick-atlas-${i}.${ext}`);
    writeFileSync(out, bytes);
    console.log(`wrote atlas ${out}`);
  });
}
