// Verify + manifest the optimized interior STRUCTURAL kit (v4). For every key
// in interior_structures_spec.json it parses the optimized GLB with three's
// GLTFLoader and records: parse OK, bbox size, triangle count, embedded
// texture/material counts, and that there are NO skins/animations (structural
// shells must be static). It then writes an INDEPENDENT structural manifest
// (structures-manifest.json) recording key, bounds, entrance/open axis, target
// room archetypes, triangle count, texture info, concept source, and Meshy
// task ID. Read-only against everything except its own manifest output.
// Usage: node assets/pipeline/verify_interior_structures.mjs
globalThis.self = globalThis;
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "../../node_modules/.pnpm/three@0.185.1/node_modules/three/build/three.module.js";
import { GLTFLoader } from "../../node_modules/.pnpm/three@0.185.1/node_modules/three/examples/jsm/loaders/GLTFLoader.js";

const spec = JSON.parse(readFileSync(resolve("assets/pipeline/interior_structures_spec.json"), "utf8"));
const loader = new GLTFLoader();
const optimizerValidationPath = resolve(`${spec.optDir}/validation.json`);
const optimizerValidation = existsSync(optimizerValidationPath)
  ? JSON.parse(readFileSync(optimizerValidationPath, "utf8"))
  : { assets: [] };
const optimizerByKey = new Map(
  (optimizerValidation.assets ?? []).map((entry) => [entry.key, entry]),
);

// Parse the glTF JSON chunk straight out of the GLB so texture/material/rig
// counts are authoritative. (three's Node GLTFLoader cannot decode embedded
// JPEG blobs, so its material.map is null even when textures ARE embedded.)
function parseGlbJson(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  let offset = 12;
  while (offset < dv.byteLength) {
    const chunkLen = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (chunkType === 0x4e4f534a) {
      const json = new TextDecoder().decode(bytes.subarray(start, start + chunkLen));
      return JSON.parse(json);
    }
    offset = start + chunkLen + ((4 - (chunkLen % 4)) % 4);
  }
  throw new Error("no JSON chunk");
}

function readTaskId(rawGlbPath) {
  const p = resolve(rawGlbPath + ".task.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")).id ?? null;
  } catch {
    return null;
  }
}

function readAssembly(rawGlbPath) {
  const p = resolve(rawGlbPath.replace(/\.glb$/, ".glb.assembly.json"));
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const assets = {};
const problems = [];

for (const asset of spec.assets) {
  const rawGlb = `${spec.rawDir}/${asset.key}.glb`;
  const optGlb = `${spec.optDir}/${asset.key}.glb`;
  const conceptPath = `${spec.conceptDir}/${asset.key}.png`;
  const optAbs = resolve(optGlb);

  if (!existsSync(resolve(rawGlb))) {
    problems.push(`${asset.key}: raw GLB missing (${rawGlb})`);
  } else {
    try {
      parseGlbJson(readFileSync(resolve(rawGlb)));
    } catch (err) {
      problems.push(`${asset.key}: RAW_PARSE_FAIL ${String(err).slice(0, 120)}`);
    }
  }
  if (!existsSync(optAbs)) {
    problems.push(`${asset.key}: optimized GLB missing (${optGlb})`);
    assets[asset.key] = { status: "MISSING_GLB" };
    continue;
  }

  const bytes = readFileSync(optAbs);
  try {
    const gltf = await new Promise((res, rej) => {
      loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", res, rej);
    });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    const min = box.min.clone();
    box.getSize(size);

    let tris = 0, meshes = 0, skinned = 0;
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) skinned++;
      if (o.isMesh && o.geometry) {
        meshes++;
        const index = o.geometry.index;
        tris += (index ? index.count : o.geometry.attributes.position.count) / 3;
      }
    });

    // authoritative counts from the glTF JSON chunk (texture-decode independent)
    const doc = parseGlbJson(bytes);
    const images = doc.images?.length ?? 0;
    const glTextures = doc.textures?.length ?? 0;
    const materials = doc.materials?.length ?? 0;
    const skins = doc.skins?.length ?? 0;
    const anims = (doc.animations?.length ?? 0) || (gltf.animations?.length ?? 0);
    const doubleSided = (doc.materials ?? []).every((m) => m.doubleSided === true);
    const allFrontSide = (doc.materials ?? []).every((m) => m.doubleSided !== true);
    const normalImageMimes = [];
    let normalMaterialCount = 0;
    let tangentPrimitiveCount = 0;
    let normalPrimitiveCount = 0;
    for (const material of doc.materials ?? []) {
      if (material.normalTexture) {
        normalMaterialCount++;
        const texture = doc.textures?.[material.normalTexture.index];
        const image = texture ? doc.images?.[texture.source] : null;
        normalImageMimes.push(image?.mimeType ?? "unknown");
      }
    }
    for (const mesh of doc.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        const material = doc.materials?.[primitive.material];
        if (material?.normalTexture) {
          normalPrimitiveCount++;
          if (primitive.attributes?.TANGENT !== undefined) tangentPrimitiveCount++;
        }
      }
    }
    const normalMapsLossless = normalImageMimes.every((mime) => mime === "image/png");
    const tangentsComplete =
      normalPrimitiveCount === 0 || tangentPrimitiveCount === normalPrimitiveCount;
    const pbrSafe = (doc.materials ?? []).every((material) => {
      const pbr = material.pbrMetallicRoughness ?? {};
      const metallic = pbr.metallicFactor ?? 1;
      const roughness = pbr.roughnessFactor ?? 1;
      const roughMin = asset.key.includes("brick") ? 0.895 : 0.815;
      const roughMax = asset.key.includes("brick") ? 0.905 : 0.925;
      return metallic === 0 && roughness >= roughMin && roughness <= roughMax;
    });

    const hasTexture = images > 0 && glTextures > 0;
    const kind = asset.key.startsWith("int-floor-")
      ? "floor"
      : asset.key.startsWith("int-partition-")
        ? "partition"
        : "shell";
    // CANONICAL contract pivots: floors mount TOP at y=0 (max-Y≈0); shells and
    // partitions ground their base at y=0 (min-Y≈0).
    const max = box.max.clone();
    const pivotOk =
      kind === "floor" ? Math.abs(max.y) < 0.03 : Math.abs(min.y) < 0.03;
    // Double-sided is correct ONLY for thin partitions; thick shells/floors must
    // be front-side so inner backfaces do not stripe/z-fight from inside.
    const wantDoubleSided = kind === "partition";
    // Horizontal footprint anisotropy of the raw geometry.
    const footprint = [size.x, size.z].sort((a, b) => a - b);
    const anisotropy = footprint[1] / Math.max(footprint[0], 1e-3);
    const target = asset.targetProportion;
    const targetAnisotropy = target
      ? Math.max(...target) / Math.max(Math.min(...target), 1e-3)
      : anisotropy;
    const fitAnisotropy = Math.max(
      anisotropy / targetAnisotropy,
      targetAnisotropy / anisotropy,
    );
    const optimizer = optimizerByKey.get(asset.key);

    const flags = [];
    if (skinned > 0 || skins > 0) flags.push("HAS_SKIN");
    if (anims > 0) flags.push("HAS_ANIM");
    if (!hasTexture) flags.push("NO_TEXTURE");
    if (wantDoubleSided && !doubleSided) flags.push("PARTITION_NOT_DOUBLE_SIDED");
    if (!wantDoubleSided && !allFrontSide) flags.push("SHELL_FLOOR_NOT_FRONT_SIDE");
    if (normalMaterialCount > 0 && !normalMapsLossless) {
      flags.push(`NORMAL_NOT_PNG(${normalImageMimes.join("|")})`);
    }
    if (!tangentsComplete) {
      flags.push(`MISSING_TANGENTS(${tangentPrimitiveCount}/${normalPrimitiveCount})`);
    }
    if (!pbrSafe) flags.push("UNSAFE_PBR_VALUES");
    if (target && fitAnisotropy > 1.15) {
      flags.push(`HORIZONTAL_FIT_ANISOTROPY(${fitAnisotropy.toFixed(3)})`);
    }
    if (!optimizer) flags.push("NO_OPTIMIZER_VALIDATION");
    else if ((optimizer.flags ?? []).length) {
      flags.push(`OPTIMIZER_${optimizer.flags.join("+")}`);
    }
    if (!pivotOk)
      flags.push(
        kind === "floor"
          ? `FLOOR_TOP_NOT_ZERO(maxY=${max.y.toFixed(3)})`
          : `UNGROUNDED(minY=${min.y.toFixed(3)})`,
      );
    if (tris > asset.triBudget + 500) flags.push(`OVER_BUDGET(${Math.round(tris)}>${asset.triBudget})`);
    if (flags.length) problems.push(`${asset.key}: ${flags.join(", ")}`);

    assets[asset.key] = {
      status: flags.length ? "WARN" : "ok",
      flags,
      kind,
      geometryAnisotropy: Number(anisotropy.toFixed(3)),
      targetAnisotropy: Number(targetAnisotropy.toFixed(3)),
      horizontalFitAnisotropy: Number(fitAnisotropy.toFixed(3)),
      rawGlbPath: rawGlb,
      optimizedPath: optGlb,
      conceptSource: conceptPath,
      meshyTaskId: readTaskId(rawGlb),
      assembly: readAssembly(rawGlb),
      triBudget: asset.triBudget,
      tris: Math.round(tris),
      texBudget: asset.texBudget,
      meshes,
      materials,
      images,
      textures: glTextures,
      texturesEmbedded: hasTexture,
      doubleSided,
      allFrontSide,
      normalMaterialCount,
      normalImageMimes,
      normalMapsLossless,
      tangentPrimitiveCount,
      normalPrimitiveCount,
      tangentsComplete,
      pbrSafe,
      optimizerValidation: optimizer ?? null,
      hasSkin: skinned > 0 || skins > 0,
      animations: anims,
      bboxSize: [size.x, size.y, size.z].map((v) => Number(v.toFixed(3))),
      bboxMinY: Number(min.y.toFixed(4)),
      bboxMaxY: Number(max.y.toFixed(4)),
      bytes: bytes.length,
      entranceAxis: asset.entranceAxis,
      roomArchetypes: asset.archetypes,
      notes: asset.notes,
    };
    console.log(`${flags.length ? "WARN" : "OK  "} ${asset.key} bbox ${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)} tris ${Math.round(tris)} img ${images} tex ${glTextures} mat ${materials} 2s ${doubleSided} skin ${skinned + skins} anim ${anims} bytes ${bytes.length}${flags.length ? "  [" + flags.join(",") + "]" : ""}`);
  } catch (err) {
    problems.push(`${asset.key}: PARSE_FAIL ${String(err).slice(0, 200)}`);
    assets[asset.key] = { status: "PARSE_FAIL", error: String(err).slice(0, 300) };
    console.log(`FAIL ${asset.key}: ${err}`);
  }
}

const manifest = {
  factory: spec.factory,
  generatedAt: new Date().toISOString(),
  scope: "Canonical imported structural kit for all 36 interiors. Eight four-wall-plus-ceiling shells and three separate floor tiles are runtime-integrated through the interior-only canonical loader.",
  pipeline: "gen_concept_image.mjs (Nano Banana, canonical ENCLOSED-room template) -> visual QA/regenerate -> gen_interior_structures_meshy.mjs (Meshy image-to-3D; fall back to modularComponents + Blender assembly if Meshy cannot close a room) -> optimize_interiors_v4_structures.py (Blender: join, merge doubles, drop duplicate/degenerate faces, consistent normals, decimate to 40k/8k, front-side thick materials / double-sided only partitions, safe PBR values, pivot shells floor-center min-Y=0 / floors top max-Y=0, textures AUTO/never-JPEG + tangents, writes validation.json) -> verify_interior_structures.mjs (three GLTFLoader parse + bbox/tris/textures/pivot/side/anisotropy checks)",
  budgets: { shells: "40000 tris / 1024 tex", partitions: "8000 tris / 512 tex", floors: "8000 tris / 1024 tex" },
  bboxNote: "CANONICAL contract: shells are four walls + ceiling ONLY (no floor, no open cutaway side, entrance on -Z), pivot at floor center (min-Y≈0); floors mount their top surface at y=0 (max-Y≈0); X/Z centered. Real-world room sizes are applied at placement time with <=1.15x horizontal anisotropy.",
  doubleSidedNote: "Front-side (thick) materials for shells and floors so inner backfaces do not stripe/z-fight from inside; ONLY thin partitions are double-sided. Normal maps stay lossless PNG (Non-Color) with exported tangents. Invisible colliders/triggers are added procedurally at placement.",
  integration: {
    status: "INTEGRATED",
    runtime: "packages/engine-world/src/InteriorStructure.tsx + packages/chapter-boston-world/src/world/InteriorDirector.tsx",
    manifest: "packages/chapter-boston-world/src/world/interiorManifest.ts (all eight shell keys canonical, yaw 0)",
    deployedDir: "apps/web/public/world/structures",
  },
  assets,
};

writeFileSync(resolve(`${spec.rawDir}/structures-manifest.json`), JSON.stringify(manifest, null, 2));
console.log(`\nWROTE ${spec.rawDir}/structures-manifest.json (${Object.keys(assets).length} assets)`);
if (problems.length) {
  console.log("\n=== FLAGS/PROBLEMS ===");
  for (const p of problems) console.log(" -", p);
}
console.log(`VERIFY DONE problems=${problems.length}`);
if (problems.length) process.exitCode = 1;
