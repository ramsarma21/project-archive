// Re-fit the existing `work-ladder` GLB into the M1 climb ladder, the way the
// sibling re-fitted `bldg-brick` into `belfry-old-brick`: no new art, only a
// scoped transform of a mesh that already exists.
//
// WHY. Meshy delivered `work-ladder.glb` as a standalone leaning work ladder on
// a braced frame, normalised to ~1.90m on its longest (vertical) axis with a
// natural bounding box of 0.78 x 1.90 x 1.14m. The M1 climbs it must serve rise
// 2.3-3.0m, and the level draws a lone prop by CONTAIN-FIT (the smallest of the
// three box/mesh ratios, uniform). A uniform fit of a 0.78-wide mesh up to a 3m
// rise draws a 1.2m-wide ladder — a gate no tradesman owned. The frame is also
// too splayed (1.14m deep) to lash flush against a wall or a scaffold standard.
//
// So the mesh is thinned on X and Z about its own centre — the rails brought to
// a climbable gauge and the braced frame stood more upright — while its HEIGHT
// is left untouched at 1.90m. Height-preserving matters twice: the ladder still
// contain-fits to any rise by its vertical axis (the honest binding axis for a
// ladder), and its longest axis stays inside the generator-normalised band
// [1.88, 1.92] that check-world-scale.mjs exempts, so the re-fit needs no new
// sizeM debt.
//
// The transform is a node scale, applied before the mesh's existing lift
// translation, so the ladder still stands with its feet on y=0. Textures,
// materials and the mesh itself are untouched.
//
// Run: node assets/pipeline/refit_work_ladder.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const FILE = join(ROOT, "apps", "web", "public", "world", "props", "work-ladder.glb");

// Thin the rails to a climbable gauge (X) and stand the leaning frame more
// upright (Z), both about the mesh centre. Height (Y) is left at 1.0.
const SCALE = [0.55, 1.0, 0.5];

const GLB_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

function readGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB");
  const total = buffer.readUInt32LE(8);
  const chunks = [];
  let offset = 12;
  while (offset < total) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 8 + length;
  }
  return chunks;
}

function pad(buffer, fill) {
  const remainder = buffer.length % 4;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}

function writeGlb(chunks) {
  const parts = [];
  for (const chunk of chunks) {
    const data = pad(chunk.data, chunk.type === JSON_CHUNK ? 0x20 : 0x00);
    const header = Buffer.alloc(8);
    header.writeUInt32LE(data.length, 0);
    header.writeUInt32LE(chunk.type, 4);
    parts.push(header, data);
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

const chunks = readGlb(readFileSync(FILE));
const jsonChunk = chunks.find((chunk) => chunk.type === JSON_CHUNK);
const json = JSON.parse(jsonChunk.data.toString("utf8"));

const roots = new Set();
for (const scene of json.scenes ?? []) for (const node of scene.nodes ?? []) roots.add(node);
if (roots.size === 0) throw new Error("no scene root nodes");

for (const index of roots) {
  const node = json.nodes[index];
  if (node.matrix) throw new Error(`node ${index} uses a baked matrix; re-fit expects TRS`);
  const prior = node.scale ?? [1, 1, 1];
  node.scale = [prior[0] * SCALE[0], prior[1] * SCALE[1], prior[2] * SCALE[2]];
}

jsonChunk.data = Buffer.from(JSON.stringify(json), "utf8");
writeFileSync(FILE, writeGlb(chunks));
console.log(`re-fit work-ladder.glb: scaled root node(s) by [${SCALE.join(", ")}] (X,Z thinned, Y kept)`);
