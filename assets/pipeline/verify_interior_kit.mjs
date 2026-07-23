// Verify the optimized interior FURNISHING/TRADE kit GLBs and assemble the
// kit manifest. For each optimized GLB this:
//   - parses the raw GLB JSON chunk for authoritative counts of embedded images,
//     animations (must be 0), and skins/rigs (must be 0)
//   - loads it with three's GLTFLoader for bbox size, triangle count, meshes
//   - records provenance: concept path, Meshy task id (from <glb>.task.json),
//     budgets, intended use locations
// Writes:
//   assets/build/interior-kit/interior-kit-verify.json
//   assets/build/interior-kit/interior-kit-manifest.json
// Usage: node assets/pipeline/verify_interior_kit.mjs
globalThis.self = globalThis;
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { QUEUE, promptFor } from "./interior_kit_queue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const OPT_DIR = resolve(ROOT, "assets/build/interior-kit-opt");
const RAW_DIR = resolve(ROOT, "assets/build/interior-kit");
const threeRoot = join(ROOT, "apps", "web", "node_modules", "three");
const { Box3, Vector3 } = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js")));

// Read the JSON chunk of a binary glTF (GLB) container.
function readGlbJson(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLen = dv.getUint32(12, true);
  const jsonBytes = bytes.subarray(20, 20 + jsonLen);
  return JSON.parse(Buffer.from(jsonBytes).toString("utf8"));
}

const loader = new GLTFLoader();
const verify = {};
for (const entry of QUEUE) {
  const path = resolve(OPT_DIR, `${entry.key}.glb`);
  if (!existsSync(path)) { verify[entry.key] = { ok: false, error: "missing optimized GLB" }; continue; }
  const bytes = readFileSync(path);
  try {
    const json = readGlbJson(bytes);
    const images = (json.images ?? []).length;
    const embedded = (json.images ?? []).every((im) => im.bufferView !== undefined || (im.uri ?? "").startsWith("data:"));
    const animations = (json.animations ?? []).length;
    const skins = (json.skins ?? []).length;

    const gltf = await new Promise((res, rej) =>
      loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", res, rej));
    const box = new Box3().setFromObject(gltf.scene);
    const size = box.getSize(new Vector3());
    let meshes = 0, tris = 0, skinned = 0, bones = 0;
    gltf.scene.traverse((o) => {
      if (o.isMesh) { meshes++; const idx = o.geometry.index; tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3; }
      if (o.isSkinnedMesh) skinned++;
      if (o.isBone) bones++;
    });
    verify[entry.key] = {
      ok: true,
      bytes: bytes.length,
      bboxSize: [size.x, size.y, size.z].map((v) => Number(v.toFixed(3))),
      minY: Number(box.min.y.toFixed(3)),
      centerXZ: [Number(((box.min.x + box.max.x) / 2).toFixed(3)), Number(((box.min.z + box.max.z) / 2).toFixed(3))],
      tris: Math.round(tris),
      meshes,
      images,
      embeddedTextures: embedded,
      animations,
      skins,
      bones,
      withinTriBudget: Math.round(tris) <= entry.tris * 1.05,
      rigFree: animations === 0 && skins === 0 && skinned === 0 && bones === 0,
      grounded: Math.abs(box.min.y) <= 0.02,
    };
    const v = verify[entry.key];
    console.log(`${v.ok ? "OK" : "FAIL"} ${entry.key} bbox ${v.bboxSize.join("x")} tris ${v.tris}/${entry.tris} img ${v.images} anim ${v.animations} skin ${v.skins} minY ${v.minY}`);
  } catch (e) {
    verify[entry.key] = { ok: false, error: String(e?.message ?? e) };
    console.log(`FAIL ${entry.key}: ${e?.message ?? e}`);
  }
}

writeFileSync(resolve(RAW_DIR, "interior-kit-verify.json"), JSON.stringify(verify, null, 2));

// Assemble the manifest with provenance.
const assets = {};
for (const entry of QUEUE) {
  const v = verify[entry.key] ?? {};
  let taskId = null;
  const taskPath = resolve(RAW_DIR, `${entry.key}.glb.task.json`);
  if (existsSync(taskPath)) { try { taskId = JSON.parse(readFileSync(taskPath, "utf8")).taskId ?? null; } catch { /* ignore */ } }
  assets[entry.key] = {
    conceptPath: `assets/source/concepts/interior-kit/${entry.key}.png`,
    rawGlbPath: `assets/build/interior-kit/${entry.key}.glb`,
    optimizedPath: `assets/build/interior-kit-opt/${entry.key}.glb`,
    meshyTaskId: taskId,
    triBudget: entry.tris,
    texBudget: entry.tex,
    meshyPoly: entry.meshy,
    bboxSize: v.bboxSize ?? null,
    tris: v.tris ?? null,
    bytes: v.bytes ?? null,
    rigFree: v.rigFree ?? null,
    grounded: v.grounded ?? null,
    uses: entry.uses,
    reuse: entry.reuse,
    prompt: promptFor(entry),
  };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  kit: "interior-furnishing-trade",
  pipeline:
    "gen_interior_kit_concepts.mjs (Nano Banana Pro) -> visual QA -> gen_interior_kit_meshy.mjs (Meshy image-to-3D) -> optimize_interior_kit.py (Blender per-key tri/tex budgets, grounded, JPEG85, no anim) -> verify_interior_kit.mjs",
  integration:
    "Optimized GLBs live in assets/build/interior-kit-opt/. To deploy: copy into apps/web/public/world/props/ (or add the pair ['assets/build/interior-kit-opt','apps/web/public/world/props'] to assets/pipeline/sync_web.mjs). Not wired here to avoid touching shared sync_web/world files.",
  bboxNote:
    "Meshy normalizes output to ~1.9 max dimension; real-world size is applied at placement time in manifest.ts, not baked here.",
  assets,
};
writeFileSync(resolve(RAW_DIR, "interior-kit-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\nWROTE interior-kit-manifest.json (${Object.keys(assets).length} assets)`);

const bad = Object.entries(verify).filter(([, v]) => !v.ok || v.rigFree === false || v.withinTriBudget === false);
if (bad.length) { console.log("\nATTENTION:", bad.map(([k]) => k).join(", ")); process.exit(1); }
console.log("all verified clean");
