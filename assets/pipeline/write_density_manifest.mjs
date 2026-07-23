// Build assets/build/world-v3/density-kit-manifest.json for the outdoor-density
// batch: key -> { glbPath, publicPath, conceptPath, group, bboxSize, minY,
// triangles, triBudget, maxTex, notes }. Measurements come from the OPTIMIZED
// GLB in assets/build/world-v3-opt (the deploy source).
globalThis.self = globalThis;
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const kit = JSON.parse(readFileSync(join(here, "density_kit.json"), "utf8"));

const threeRoot = resolve(repoRoot, "apps", "web", "node_modules", "three");
const { Box3, Vector3 } = await import(`${threeRoot}/build/three.module.js`);
const { GLTFLoader } = await import(`${threeRoot}/examples/jsm/loaders/GLTFLoader.js`);
const loader = new GLTFLoader();

const optDir = join(repoRoot, "assets", "build", "world-v3-opt");
const manifest = {};
const missing = [];
for (const asset of kit.assets) {
  const optPath = join(optDir, `${asset.key}.glb`);
  if (!existsSync(optPath)) {
    missing.push(asset.key);
    continue;
  }
  const bytes = readFileSync(optPath);
  const gltf = await new Promise((res, rej) =>
    loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", res, rej),
  );
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  let triangles = 0;
  let textures = 0;
  gltf.scene.traverse((n) => {
    if (n.isMesh) {
      const idx = n.geometry.index;
      triangles += (idx ? idx.count : n.geometry.attributes.position.count) / 3;
      const mat = n.material;
      if (mat && mat.map) textures++;
    }
  });
  manifest[asset.key] = {
    glbPath: `assets/build/world-v3/${asset.key}.glb`,
    optimizedPath: `assets/build/world-v3-opt/${asset.key}.glb`,
    publicPath: `apps/web/public/world/props/${asset.key}.glb`,
    conceptPath: `assets/source/concepts/density/${asset.key}.png`,
    group: asset.group,
    bboxSize: [Number(size.x.toFixed(3)), Number(size.y.toFixed(3)), Number(size.z.toFixed(3))],
    minY: Number(box.min.y.toFixed(4)),
    triangles: Math.round(triangles),
    triBudget: asset.triBudget,
    maxTex: asset.maxTex,
    fileBytes: bytes.length,
    notes: asset.notes,
  };
}

const output = {
  _meta: {
    batch: kit._meta.batch,
    generatedAt: new Date().toISOString(),
    axes: kit._meta.axes,
    budgets: kit._meta.budgets,
    note: "bboxSize measured from optimized GLB (Meshy normalizes to ~1.9-unit box; NOT meters). Layout must scale each module to real footprint. minY≈0 means module rests on ground plane after fitting.",
    scope: "Assets generated/verified only. Placements NOT integrated into District/world code (ground/door/water/population/artifact/traversal/interior workers active).",
  },
  ...manifest,
};
const out = join(repoRoot, "assets", "build", "world-v3", "density-kit-manifest.json");
writeFileSync(out, JSON.stringify(output, null, 2) + "\n");
console.log("WROTE", out, Object.keys(manifest).length, "assets");
if (missing.length) console.log("MISSING (not yet optimized):", missing.join(", "));
