// Standalone weld/near-coincident-face measurement for a single GLB, replicating
// scripts/check-world-visual-sweep.mjs weldMetric() exactly (same COINCIDE/EPS,
// same same-facing dot>0.985), plus bbox + tris. So a rebuilt asset carries a
// real weld number without touching the world-audit gate.
// Usage: node assets/pipeline/measure_weld.mjs <glb> [<glb> ...]
globalThis.self = globalThis;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "../../node_modules/.pnpm/three@0.185.1/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../../node_modules/.pnpm/three@0.185.1/node_modules/three/examples/jsm/loaders/GLTFLoader.js";

function weldMetric(scene) {
  scene.updateMatrixWorld(true);
  const tris = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const area = normal.length() * 0.5;
      normal.normalize();
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
      let zeroUv = false;
      if (uv) {
        const u0 = uv.getX(ia), v0 = uv.getY(ia), u1 = uv.getX(ib), v1 = uv.getY(ib), u2 = uv.getX(ic), v2 = uv.getY(ic);
        zeroUv = Math.abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) * 0.5 < 1e-8;
      }
      tris.push({ c: new THREE.Vector3(cx, cy, cz), n: normal, area, zeroUv });
    }
  });
  const box = new THREE.Box3();
  for (const t of tris) box.expandByPoint(t.c);
  const sz = box.getSize(new THREE.Vector3());
  const diag = Math.hypot(sz.x, sz.y, sz.z) || 1;
  const EPS = diag * 1e-4;
  const COINCIDE = diag * 0.004;
  const CELL = COINCIDE;
  const grid = new Map();
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const key = `${Math.round(t.c.x / CELL)},${Math.round(t.c.y / CELL)},${Math.round(t.c.z / CELL)}`;
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push(i);
  }
  let pairs = 0;
  const neigh = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (const [key, bucket] of grid) {
    const [kx, ky, kz] = key.split(",").map(Number);
    for (const [dx, dy, dz] of neigh) {
      const other = dx || dy || dz ? grid.get(`${kx + dx},${ky + dy},${kz + dz}`) : bucket;
      if (!other) continue;
      for (const i of bucket) {
        for (const j of other) {
          if (j <= i && !(dx || dy || dz)) continue;
          const t1 = tris[i], t2 = tris[j];
          const d = t1.c.distanceTo(t2.c);
          if (d <= EPS || d > COINCIDE) continue;
          if (t1.n.dot(t2.n) > 0.985) pairs++;
        }
      }
    }
  }
  const zeroUv = tris.filter((t) => t.zeroUv).length;
  return { tris: tris.length, pairs, zeroUv };
}

const loader = new GLTFLoader();
for (const arg of process.argv.slice(2)) {
  const path = resolve(arg);
  const bytes = readFileSync(path);
  const gltf = await new Promise((res, rej) =>
    loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", res, rej));
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const m = weldMetric(gltf.scene);
  console.log(`${arg.split("/").pop()}  bbox ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)}  tris ${m.tris}  weldPairs ${m.pairs}  zeroUv ${m.zeroUv}`);
}
