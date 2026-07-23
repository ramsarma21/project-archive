import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TARGETS = {
  "hearth-mantel": 8000, "bed-fourpost": 8000, "table-chairs-set": 8000,
  "storage-chest": 6000, "dresser-shelves": 8000, "washbasin-stand": 6000,
  "candle-sconce": 4000, "firewood-stack": 6000, "crate-stack": 6000,
  "spinning-wheel": 8000, "shop-counter-long": 8000, "clerk-desk": 8000,
  "barrel-group": 6000, "bookshelf-ledgers": 8000, "paper-satchel": 5000,
  "type-cases": 8000, "tankard-cluster": 5000, "tavern-bar-barrels": 8000,
  "notice-board": 8000, "cargo-net-bundle": 8000, "rope-coil-large": 6000,
};

function parseGlb(path) {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const length = view.getUint32(12, true);
  return { bytes, json: JSON.parse(bytes.subarray(20, 20 + length).toString("utf8")) };
}

const assets = {};
const failures = [];
for (const [sourceKey, budget] of Object.entries(TARGETS)) {
  const key = `${sourceKey}-interior-lod`;
  const path = resolve(`assets/build/interior-runtime-opt/${key}.glb`);
  if (!existsSync(path)) {
    failures.push(`${key}: missing`);
    continue;
  }
  const { bytes, json } = parseGlb(path);
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = json.accessors[primitive.indices ?? primitive.attributes.POSITION];
      triangles += Math.round((accessor?.count ?? 0) / 3);
    }
  }
  const embeddedTextures = (json.images ?? []).every(
    (image) => image.bufferView !== undefined || image.uri?.startsWith("data:"),
  );
  const ok =
    triangles <= budget + 50 &&
    !(json.animations?.length) &&
    !(json.skins?.length) &&
    embeddedTextures;
  if (!ok) failures.push(`${key}: tris=${triangles}/${budget} anim=${json.animations?.length ?? 0} skins=${json.skins?.length ?? 0} embedded=${embeddedTextures}`);
  assets[key] = {
    sourceKey,
    path: `assets/build/interior-runtime-opt/${key}.glb`,
    publicPath: `apps/web/public/world/props/${key}.glb`,
    triangles,
    budget,
    bytes: bytes.length,
    images: json.images?.length ?? 0,
    embeddedTextures,
    animations: json.animations?.length ?? 0,
    skins: json.skins?.length ?? 0,
    ok,
  };
}
const manifest = {
  generatedAt: new Date().toISOString(),
  pipeline: "existing imported production GLB -> Blender interior-only decimation/texture cap -> verification -> targeted sync; exterior source keys remain unchanged",
  assets,
  failures,
};
const output = resolve("assets/build/interior-runtime-opt/interior-runtime-lod-manifest.json");
writeFileSync(output, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ output, assets: Object.keys(assets).length, failures }, null, 2));
if (failures.length) process.exit(1);

