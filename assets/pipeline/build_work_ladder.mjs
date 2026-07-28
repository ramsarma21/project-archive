// Build the M1 climb ladder as honest leaning-ladder geometry: TWO rails and a
// run of RUNGS at a fixed human spacing, generated procedurally the same way
// build_roofline_kit builds its decks — a pipeline-authored GLB, not a Three
// primitive at runtime (the imported-visible-world rule admits pipeline GLBs).
//
// WHY A GENERATOR AND NOT THE DELIVERED MESH. The Meshy "work-ladder" delivered
// a braced trestle: two rails but a splayed back frame that, drawn upright and
// floating under a deck, reads as a four-legged A-frame standing in open air
// (the owner's screenshot). No placement transform turns a trestle into a
// leaning ladder, and a UNIFORM contain-fit of any single mesh to a 2.3-3.0m
// rise scales the rungs with the rise — 1.2x-1.58x — so they land at ~0.4-0.5m,
// nothing a leg steps on. Both defects are structural to "one fixed mesh,
// uniformly scaled".
//
// THE FIX IS RUNGS FROM COUNT, NOT SCALE. A ladder is a LENGTH of a repeating
// object, so one GLB per rung COUNT is generated (8..11 rungs). Each is built at
// real metres with rungs exactly RUNG_GAP_M apart, so a rise is served by the
// variant whose count matches it and the placement scales the length by <=5% —
// the rungs stay human at every rise. Rails run the mesh's +Y (length) axis;
// `ladderPlacements` in runtime.ts leans the whole thing on its foot with the
// pitch the scenery model now carries.
//
// Colour is a mid oak brown baseColorFactor, deliberately NOT near-white: the
// playthrough world census fails a lit mesh with no map and a near-white colour
// (the "white box" signature), and a hand-built ladder has no texture map.
//
// Run: node assets/pipeline/build_work_ladder.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const OUT_DIR = join(ROOT, "apps", "web", "public", "world", "props");

// ---- human ladder dimensions (metres) -------------------------------------
const RUNG_GAP_M = 0.3; // rung-to-rung, the stride a leg actually takes
const FIRST_RUNG_M = 0.15; // lowest rung above the foot
const GAUGE_M = 0.43; // outer rail-to-rail width (a shoulder-wide ladder)
const RAIL_THICK_X = 0.05; // rail square section, across the gauge
const RAIL_THICK_Z = 0.05; // rail square section, through the depth
const RUNG_THICK_Y = 0.036; // a rung is ~thumb-thick
const RUNG_THICK_Z = 0.045;
const OAK = [0.34, 0.22, 0.12, 1.0]; // mid oak, not near-white

const COUNTS = [8, 9, 10, 11];

// ---- a tiny box-mesh GLB writer (positions + normals + indices + material) --
function boxMesh(cx, cy, cz, hx, hy, hz, out) {
  // 8 corners, 6 faces, outward normals per face (flat-shaded).
  const faces = [
    { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
    { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
  ];
  for (const f of faces) {
    const base = out.positions.length / 3;
    for (const v of f.v) {
      out.positions.push(cx + v[0], cy + v[1], cz + v[2]);
      out.normals.push(f.n[0], f.n[1], f.n[2]);
    }
    out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function ladderMesh(count) {
  const out = { positions: [], normals: [], indices: [] };
  const length = FIRST_RUNG_M + (count - 1) * RUNG_GAP_M + FIRST_RUNG_M; // symmetric margins
  const railCx = (GAUGE_M - RAIL_THICK_X) / 2; // rail centre inset from the gauge edge
  // Two rails, running the full length along +Y.
  boxMesh(-railCx, length / 2, 0, RAIL_THICK_X / 2, length / 2, RAIL_THICK_Z / 2, out);
  boxMesh(railCx, length / 2, 0, RAIL_THICK_X / 2, length / 2, RAIL_THICK_Z / 2, out);
  // Rungs between the rails' inner faces.
  const rungHalfX = (GAUGE_M - 2 * RAIL_THICK_X) / 2 + 0.005;
  for (let k = 0; k < count; k++) {
    const y = FIRST_RUNG_M + k * RUNG_GAP_M;
    boxMesh(0, y, 0, rungHalfX, RUNG_THICK_Y / 2, RUNG_THICK_Z / 2, out);
  }
  return { out, length };
}

// ---- pack one mesh as a GLB ------------------------------------------------
function f32(arr) {
  const b = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) b.writeFloatLE(arr[i], i * 4);
  return b;
}
function u32(arr) {
  const b = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) b.writeUInt32LE(arr[i], i * 4);
  return b;
}
function pad4(b, fill) {
  const r = b.length % 4;
  return r === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - r, fill)]);
}
function vecMin(a, stride, off) {
  const m = [Infinity, Infinity, Infinity];
  for (let i = 0; i < a.length; i += stride) for (let c = 0; c < 3; c++) m[c] = Math.min(m[c], a[i + off + c]);
  return m;
}
function vecMax(a, stride, off) {
  const m = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i += stride) for (let c = 0; c < 3; c++) m[c] = Math.max(m[c], a[i + off + c]);
  return m;
}

function writeGlb(mesh, file) {
  const posBuf = f32(mesh.positions);
  const nrmBuf = f32(mesh.normals);
  const idxBuf = u32(mesh.indices);
  const bin = Buffer.concat([pad4(posBuf, 0), pad4(nrmBuf, 0), pad4(idxBuf, 0)]);
  const posOff = 0;
  const nrmOff = pad4(posBuf, 0).length;
  const idxOff = nrmOff + pad4(nrmBuf, 0).length;
  const vcount = mesh.positions.length / 3;
  const json = {
    asset: { version: "2.0", generator: "build_work_ladder" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "work-ladder" }],
    materials: [
      {
        name: "oak",
        pbrMetallicRoughness: { baseColorFactor: OAK, metallicFactor: 0.0, roughnessFactor: 0.9 },
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vcount, type: "VEC3", min: vecMin(mesh.positions, 3, 0), max: vecMax(mesh.positions, 3, 0) },
      { bufferView: 1, componentType: 5126, count: vcount, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmBuf.length, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBuf.length, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  jsonBuf = pad4(jsonBuf, 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(file, Buffer.concat([header, jh, jsonBuf, bh, bin]));
}

mkdirSync(OUT_DIR, { recursive: true });
const summary = [];
for (const count of COUNTS) {
  const { out, length } = ladderMesh(count);
  const file = join(OUT_DIR, `work-ladder-${count}.glb`);
  writeGlb(out, file);
  summary.push({ count, lengthM: +length.toFixed(3), file: `work-ladder-${count}.glb`, tris: out.indices.length / 3 });
}
console.log("built leaning-ladder variants (rungs at %sm gauge %sm):", RUNG_GAP_M, GAUGE_M);
for (const s of summary) console.log(`  ${s.file}: ${s.count} rungs, length ${s.lengthM}m, ${s.tris} tris`);
