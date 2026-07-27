// Measure the EFFECTIVE height of a character GLB the way the renderer does.
//
// WHY THIS EXISTS. `officer-rigged.glb` shipped with its mesh ~92x too small and
// nobody saw it, because both runtime loaders normalise a rig by
// `height / measuredHeight`. The defect was therefore invisible on screen and
// only visible in the file. Every measurement that mattered today came out wrong
// at least once because it was taken at the wrong level:
//
//   * raw POSITION accessor min/max ignores node transforms, so a rig that is
//     correct-but-scaled-by-a-parent reads as broken;
//   * `Box3.setFromObject` on a skinned scene reads the UNPOSED geometry through
//     the mesh node's matrix, and glTF says a skinned mesh node's own transform
//     is ignored, so that reads the wrong thing too;
//   * only the skinning matrices tell you where the vertices actually land.
//
// So this probe reproduces `SkinnedMesh.computeBoundingBox()` + `matrixWorld`,
// which is literally the expression `RiggedCharacter.tsx` and `DuelActor.tsx`
// measure, and reports the raw bounds alongside it so the two can be compared.
// The gap between the two columns is the whole diagnosis.
//
// Usage: node assets/pipeline/probe_rig_scale.mjs file.glb [more.glb ...]
globalThis.self = globalThis;
import { readFileSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const threeRoot = join(repoRoot, "apps", "web", "node_modules", "three");
const { Box3, Vector3 } = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);

function glbJson(data) {
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error("not a binary glTF");
  const jsonLength = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").trim());
}

/** Raw POSITION accessor bounds, straight out of the JSON. No transforms. */
function rawPositionBounds(json) {
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = json.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;
      for (let axis = 0; axis < 3; axis++) {
        box.min[axis] = Math.min(box.min[axis], accessor.min[axis]);
        box.max[axis] = Math.max(box.max[axis], accessor.max[axis]);
      }
    }
  }
  return box;
}

/**
 * Exactly what the two runtime loaders compute: skinned bounds through the bone
 * matrices, unioned with any static mesh, in scene space.
 */
export function effectiveBounds(scene) {
  scene.updateMatrixWorld(true);
  const box = new Box3();
  const scratch = new Box3();
  let any = false;
  scene.traverse((node) => {
    const skinned = node;
    if (skinned.isSkinnedMesh) {
      skinned.computeBoundingBox();
      if (!skinned.boundingBox) return;
      scratch.copy(skinned.boundingBox).applyMatrix4(skinned.matrixWorld);
    } else if (node.isMesh) {
      scratch.setFromObject(node);
    } else return;
    any ? box.union(scratch) : box.copy(scratch);
    any = true;
  });
  return any ? box : null;
}

const argv = process.argv.slice(2);
const crossCheck = argv.includes("--cross-check");
const files = argv.filter((arg) => !arg.startsWith("--"));
if (files.length === 0) {
  console.error("usage: node probe_rig_scale.mjs [--cross-check] file.glb [...]");
  process.exit(1);
}

// scripts/check-world-scale.mjs reimplements the skinning bounds in plain JS so
// that `lint` never depends on an installed three.js. A reimplementation is only
// worth having if it is provably the same, so --cross-check runs both and requires
// them to agree. Without this the guard's central claim would be an assertion.
let guardBounds = null;
let guardDocument = null;
if (crossCheck) {
  const guard = await import(pathToFileURL(join(repoRoot, "scripts", "check-world-scale.mjs")));
  guardBounds = guard.effectiveBounds;
  guardDocument = (data) => {
    const jsonLength = data.readUInt32LE(12);
    const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").trim());
    let binary = null;
    let cursor = 20 + jsonLength;
    while (cursor + 8 <= data.length) {
      const length = data.readUInt32LE(cursor);
      if (data.readUInt32LE(cursor + 4) === 0x004e4942) {
        binary = data.subarray(cursor + 8, cursor + 8 + length);
        break;
      }
      cursor += 8 + length;
    }
    return { json, binary };
  };
}

const loader = new GLTFLoader();
let worstDisagreement = 0;
let worstFile = null;
console.log(
  "file".padEnd(24) +
    "rawH".padStart(10) +
    "effH".padStart(10) +
    "ratio".padStart(9) +
    "effX".padStart(8) +
    "effZ".padStart(8) +
    "minY".padStart(9) +
    "  clips" +
    (crossCheck ? "   guardH      disagreement" : ""),
);
for (const file of files) {
  const path = resolve(file);
  const data = readFileSync(path);
  const json = glbJson(data);
  const gltf = await new Promise((res, rej) =>
    loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", res, rej),
  );
  const raw = rawPositionBounds(json);
  const rawH = raw.max[1] - raw.min[1];
  const box = effectiveBounds(gltf.scene);
  const size = box ? box.getSize(new Vector3()) : new Vector3();
  const effH = size.y;
  let suffix = "";
  if (crossCheck) {
    const guard = guardBounds(guardDocument(data));
    const guardH = guard.size ? guard.size[1] : NaN;
    // Relative, because the two implementations accumulate float error in
    // different orders and an absolute epsilon would mean different things at
    // 0.019m and at 1.9m.
    const disagreement = effH > 0 ? Math.abs(guardH - effH) / effH : Math.abs(guardH - effH);
    if (disagreement > worstDisagreement) {
      worstDisagreement = disagreement;
      worstFile = basename(file);
    }
    suffix = `  ${guardH.toFixed(4).padStart(9)}  ${disagreement.toExponential(2).padStart(10)}`;
  }
  console.log(
    basename(file).replace(/\.glb$/, "").padEnd(24) +
      rawH.toFixed(4).padStart(10) +
      effH.toFixed(4).padStart(10) +
      (rawH > 0 ? (effH / rawH).toFixed(4) : "n/a").padStart(9) +
      size.x.toFixed(3).padStart(8) +
      size.z.toFixed(3).padStart(8) +
      (box ? box.min.y.toFixed(4) : "n/a").padStart(9) +
      `  ${String(gltf.animations.length).padEnd(3)}` +
      suffix,
  );
}

if (crossCheck) {
  const TOLERANCE = 1e-6;
  const ok = worstDisagreement <= TOLERANCE;
  console.log(
    `\ncross-check: worst disagreement between three.js and check-world-scale.mjs is ` +
      `${worstDisagreement.toExponential(3)}` +
      (worstFile ? ` (${worstFile})` : ""),
  );
  console.log(
    ok
      ? `cross-check: PASS - the guard's plain-JS skinning matches the renderer within ${TOLERANCE}`
      : `cross-check: FAIL - the guard does not measure what the renderer draws`,
  );
  process.exit(ok ? 0 : 1);
}
