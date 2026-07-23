// Exact static triangle budgets for every authored interior. Reads deployed
// GLB accessors directly, so textures need not decode under Node.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { INTERIORS } from "../../apps/web/src/world/interiorManifest.js";

function glbJson(path: string): any {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error(`${path}: not GLB`);
  const length = view.getUint32(12, true);
  return JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"));
}

const triangleCache = new Map<string, number>();
function triangles(folder: "props" | "structures", key: string): number {
  const cacheKey = `${folder}/${key}`;
  const cached = triangleCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const doc = glbJson(resolve(`apps/web/public/world/${folder}/${key}.glb`));
  let count = 0;
  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      count += Math.round((doc.accessors?.[accessorIndex]?.count ?? 0) / 3);
    }
  }
  triangleCache.set(cacheKey, count);
  return count;
}

const hero = new Set([
  "MERCER_PRESS",
  "THOMAS_COUNTINGHOUSE",
  "PIKE_OFFICE",
  "CUSTOM_HOUSE",
  "EXPLORE_tavern",
  "EXPLORE_church",
  "EXPLORE_warehouseHero",
]);
const rooms = Object.values(INTERIORS).map((def) => {
  let staticTriangles =
    triangles("structures", def.shellGlb) +
    triangles("structures", def.floorGlb);
  const assets: Record<string, number> = {};
  for (const placement of [...def.partitions, ...def.props]) {
    const folder = placement.glb.startsWith("int-partition-")
      ? "structures"
      : "props";
    const tris = triangles(folder, placement.glb);
    staticTriangles += tris;
    assets[placement.glb] = (assets[placement.glb] ?? 0) + tris;
  }
  const budget = def.id === "EXPLORE_church"
    ? 550000
    : hero.has(def.id)
      ? 450000
      : 220000;
  return {
    id: def.id,
    archetype: def.archetype,
    placements: def.props.length + def.partitions.length,
    staticTriangles,
    budget,
    ok: staticTriangles <= budget,
    assets,
  };
});
const failed = rooms.filter((room) => !room.ok);
const report = {
  generatedAt: new Date().toISOString(),
  rooms,
  failed: failed.map(({ id, staticTriangles, budget }) => ({
    id,
    staticTriangles,
    budget,
  })),
};
const output = resolve("assets/build/interior-static-budget-report.json");
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  output,
  maxCommon: Math.max(...rooms.filter((room) => !hero.has(room.id)).map((room) => room.staticTriangles)),
  maxHero: Math.max(...rooms.filter((room) => hero.has(room.id) && room.id !== "EXPLORE_church").map((room) => room.staticTriangles)),
  church: rooms.find((room) => room.id === "EXPLORE_church")?.staticTriangles,
  failed: report.failed,
}, null, 2));
if (failed.length) process.exit(1);

