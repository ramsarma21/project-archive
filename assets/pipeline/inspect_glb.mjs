// Inspect a character GLB: animation clips (name/duration), bone names,
// mesh bounds, texture count. Node-side three GLTFLoader.
// Usage: node assets/pipeline/inspect_glb.mjs file.glb [more.glb ...]
globalThis.self = globalThis;
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// three lives in apps/web/node_modules; resolve it relative to the repo root
// so this script runs from anywhere.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const threeRoot = join(repoRoot, "apps", "web", "node_modules", "three");
const { AnimationMixer, Box3, LoopOnce, Vector3 } = await import(
  pathToFileURL(join(threeRoot, "build", "three.module.js"))
);
const { GLTFLoader } = await import(pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js")));

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node inspect_glb.mjs file.glb [...]");
  process.exit(1);
}

const loader = new GLTFLoader();

function glbJson(data) {
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error("not a binary glTF");
  const jsonLength = data.readUInt32LE(12);
  const jsonType = data.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error("first GLB chunk is not JSON");
  return JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8").trim());
}

function rootTranslation(clip) {
  const tracks = clip.tracks.filter(
    (track) =>
      /hips/i.test(track.name) &&
      (track.name.endsWith(".position") || track.name.endsWith(".translation")),
  );
  if (tracks.length === 0) return "NONE";
  return tracks
    .map((track) => {
      const stride = track.getValueSize();
      const labels = ["x", "y", "z"];
      const axes = labels.slice(0, stride).map((label, axis) => {
        let min = Infinity;
        let max = -Infinity;
        for (let i = axis; i < track.values.length; i += stride) {
          min = Math.min(min, track.values[i]);
          max = Math.max(max, track.values[i]);
        }
        const first = track.values[axis];
        const last = track.values[track.values.length - stride + axis];
        return `${label}Δ=${(max - min).toFixed(6)} end=${(last - first).toFixed(6)}`;
      });
      return `${track.name}[${axes.join(" ")}]`;
    })
    .join("; ");
}

function worldRootTranslation(scene, clip) {
  const hips = scene.getObjectByName("mixamorigHips");
  if (!hips) return "NO_HIPS";
  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const sample = new Vector3();
  const first = new Vector3();
  const last = new Vector3();
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const samples = Math.max(2, Math.ceil(clip.duration * 30) + 1);
  for (let i = 0; i < samples; i++) {
    mixer.setTime((clip.duration * i) / (samples - 1));
    scene.updateMatrixWorld(true);
    hips.getWorldPosition(sample);
    if (i === 0) first.copy(sample);
    if (i === samples - 1) last.copy(sample);
    min.min(sample);
    max.max(sample);
  }
  mixer.stopAllAction();
  return ["x", "y", "z"]
    .map(
      (axis) =>
        `${axis}Δ=${(max[axis] - min[axis]).toFixed(6)} end=${(last[axis] - first[axis]).toFixed(6)}`,
    )
    .join(" ");
}

for (const file of files) {
  const path = resolve(file);
  const data = readFileSync(path);
  const json = glbJson(data);
  const gltf = await new Promise((res, rej) =>
    loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", res, rej),
  );
  const clips = gltf.animations.map((a) => `${a.name}:${a.duration.toFixed(2)}s`);
  const bones = [];
  let meshCount = 0;
  let skinned = 0;
  gltf.scene.traverse((o) => {
    if (o.isBone) bones.push(o.name);
    if (o.isMesh) meshCount++;
    if (o.isSkinnedMesh) skinned++;
  });
  const box = new Box3().setFromObject(gltf.scene);
  const size = box.getSize(new Vector3());
  console.log(`=== ${file}`);
  console.log(`clips(${gltf.animations.length}): ${clips.join(", ") || "NONE"}`);
  console.log(`bones(${bones.length}): ${bones.slice(0, 12).join(", ")}${bones.length > 12 ? " ..." : ""}`);
  console.log(`meshes: ${meshCount} (skinned ${skinned})`);
  const images = json.images ?? [];
  const embeddedImages = images.filter(
    (image) => Number.isInteger(image.bufferView) && typeof image.mimeType === "string",
  ).length;
  console.log(
    `resources: materials=${json.materials?.length ?? 0} textures=${json.textures?.length ?? 0} images=${images.length} embedded=${embeddedImages} external=${images.length - embeddedImages}`,
  );
  console.log(`bounds: x=${size.x.toFixed(2)} y=${size.y.toFixed(2)} z=${size.z.toFixed(2)} minY=${box.min.y.toFixed(3)}`);
  for (const clip of gltf.animations) {
    console.log(`root ${clip.name}: ${rootTranslation(clip)}`);
    console.log(`worldRoot ${clip.name}: ${worldRootTranslation(gltf.scene, clip)}`);
  }
}
