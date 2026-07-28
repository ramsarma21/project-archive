// Inspect the work-ladder GLB: is it a leaning ladder (two rails + rungs) or a
// splayed A-frame trestle (four legs)? Reports bounds, per-height horizontal
// cross-section extents, and a crude rung count.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { glbDocument } from "../scripts/check-world-scale.mjs";
import { staticTriangles, triBounds } from "../scripts/check-world-affordances.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "apps", "web", "public", "world", "props", "work-ladder.glb");

const doc = glbDocument(readFileSync(FILE));
const { tris, skinnedMeshes } = staticTriangles(doc);
console.log(`tris=${tris.length} skinnedMeshes=${skinnedMeshes}`);
const b = triBounds(tris);
console.log(`bounds min=[${b.min.map((v) => v.toFixed(3))}] max=[${b.max.map((v) => v.toFixed(3))}]`);
const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
console.log(`size=[${size.map((v) => v.toFixed(3))}]`);

// Vertex cloud height distribution: for each horizontal slab, the X- and Z-
// extents of vertices in it. A leaning ladder's two rails give a roughly
// constant X-separation and a Z-extent that MARCHES with height (the lean); an
// A-frame trestle is WIDE at the bottom and pinches to near-zero at the top on
// BOTH horizontal axes.
const verts = [];
for (const t of tris) for (const v of t) verts.push(v);
const H = b.max[1] - b.min[1];
const SLABS = 12;
console.log("\n slab  yLo..yHi        xMin..xMax (Xext)     zMin..zMax (Zext)   nVerts");
for (let i = 0; i < SLABS; i++) {
  const yLo = b.min[1] + (H * i) / SLABS;
  const yHi = b.min[1] + (H * (i + 1)) / SLABS;
  let xmn = Infinity, xmx = -Infinity, zmn = Infinity, zmx = -Infinity, n = 0;
  for (const v of verts) {
    if (v[1] < yLo || v[1] >= yHi) continue;
    n++;
    if (v[0] < xmn) xmn = v[0];
    if (v[0] > xmx) xmx = v[0];
    if (v[2] < zmn) zmn = v[2];
    if (v[2] > zmx) zmx = v[2];
  }
  if (n === 0) { console.log(` ${i.toString().padStart(2)}  ${yLo.toFixed(2)}..${yHi.toFixed(2)}  (empty)`); continue; }
  const xe = xmx - xmn, ze = zmx - zmn;
  console.log(` ${i.toString().padStart(2)}  ${yLo.toFixed(2)}..${yHi.toFixed(2)}  ${xmn.toFixed(2)}..${xmx.toFixed(2)} (${xe.toFixed(2)})   ${zmn.toFixed(2)}..${zmx.toFixed(2)} (${ze.toFixed(2)})   ${n}`);
}

// Rung detection: scan Y for thin horizontal bands that span most of the X
// gauge (a rung connects the two rails). Count local maxima of vertex density
// in narrow Y bins that also have wide X-extent.
const BINS = 200;
const dens = new Array(BINS).fill(0);
for (const v of verts) {
  const t = (v[1] - b.min[1]) / H;
  const idx = Math.min(BINS - 1, Math.max(0, Math.floor(t * BINS)));
  dens[idx]++;
}
let peaks = 0;
for (let i = 1; i < BINS - 1; i++) {
  if (dens[i] > dens[i - 1] && dens[i] >= dens[i + 1] && dens[i] > (verts.length / BINS) * 1.5) peaks++;
}
console.log(`\n crude horizontal-density peaks (rung candidates): ${peaks}`);
