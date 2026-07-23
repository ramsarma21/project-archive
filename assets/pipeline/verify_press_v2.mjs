// Verify modular press v2 and write dedicated provenance/animation sidecars.
// Usage: node assets/pipeline/verify_press_v2.mjs
globalThis.self = globalThis;
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRESS_V2_COMPONENTS, PRESS_V2_DIRS } from "./press_v2_queue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const GLB_PATH = resolve(ROOT, "assets/build/interior-kit-opt/press-common-operable-v2.glb");
const VERIFY_PATH = resolve(ROOT, "assets/build/interior-kit/press-common-operable-v2.verify.json");
const MANIFEST_PATH = resolve(ROOT, "assets/build/interior-kit/press-common-operable-v2.manifest.json");
const threeRoot = join(ROOT, "apps/web/node_modules/three");
const THREE = await import(pathToFileURL(join(threeRoot, "build/three.module.js")));
const { GLTFLoader } = await import(pathToFileURL(join(threeRoot, "examples/jsm/loaders/GLTFLoader.js")));

const REQUIRED_NODES = [
  "Press_Frame", "Press_Lever", "Press_Screw", "Press_Platen",
  "Press_Carriage", "Press_Tympan", "Press_Frisket",
];
const REQUIRED_CLIPS = [
  "pressPull", "pressRelease", "carriageIn", "carriageOut",
  "tympanOpen", "tympanClose",
];
const EXPECTED_CHANNELS = {
  pressPull: [
    "Press_Lever:rotation", "Press_Screw:rotation",
    "Press_Screw:translation", "Press_Platen:translation",
  ],
  pressRelease: [
    "Press_Lever:rotation", "Press_Screw:rotation",
    "Press_Screw:translation", "Press_Platen:translation",
  ],
  carriageIn: ["Press_Carriage:translation"],
  carriageOut: ["Press_Carriage:translation"],
  tympanOpen: ["Press_Tympan:rotation", "Press_Frisket:rotation"],
  tympanClose: ["Press_Tympan:rotation", "Press_Frisket:rotation"],
};

function glbChunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const binHeader = 20 + jsonLength;
  const binLength = view.getUint32(binHeader, true);
  return { json, bin: bytes.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function pngDimensions(data) {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47) return null;
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

function rounded(values, digits = 4) {
  return values.map((value) => Number(value.toFixed(digits)));
}

function boxRecord(box) {
  const size = box.getSize(new THREE.Vector3());
  return {
    min: rounded(box.min.toArray()),
    max: rounded(box.max.toArray()),
    size: rounded(size.toArray()),
  };
}

function transformRecord(object) {
  const worldPosition = object.getWorldPosition(new THREE.Vector3());
  const worldQuaternion = object.getWorldQuaternion(new THREE.Quaternion());
  return {
    parent: object.parent?.name || null,
    localPosition: rounded(object.position.toArray()),
    localQuaternion: rounded(object.quaternion.toArray()),
    pivotWorld: rounded(worldPosition.toArray()),
    worldQuaternion: rounded(worldQuaternion.toArray()),
  };
}

function ownBounds(object) {
  if (!object?.isMesh || !object.geometry) return new THREE.Box3().setFromObject(object);
  if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
  return object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
}

const bytes = readFileSync(GLB_PATH);
const { json, bin } = glbChunks(bytes);
const loader = new GLTFLoader();
const gltf = await new Promise((done, fail) => {
  loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", done, fail);
});

const scene = gltf.scene;
scene.updateMatrixWorld(true);
let triangles = 0;
let meshes = 0;
let skinnedMeshes = 0;
scene.traverse((object) => {
  if (object.isMesh) {
    meshes++;
    const index = object.geometry.index;
    triangles += (index ? index.count : object.geometry.attributes.position.count) / 3;
  }
  if (object.isSkinnedMesh) skinnedMeshes++;
});
triangles = Math.round(triangles);

const nodeTransforms = {};
for (const name of REQUIRED_NODES) {
  const object = scene.getObjectByName(name);
  nodeTransforms[name] = object ? transformRecord(object) : null;
}

const imageInfo = (json.images ?? []).map((image) => {
  const view = image.bufferView !== undefined ? json.bufferViews[image.bufferView] : null;
  const data = view ? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength) : null;
  return {
    name: image.name ?? null,
    mimeType: image.mimeType ?? null,
    embedded: Boolean(view || image.uri?.startsWith("data:")),
    dimensions: data && image.mimeType === "image/png" ? pngDimensions(data) : null,
  };
});

const jsonClipChannels = {};
for (const animation of json.animations ?? []) {
  jsonClipChannels[animation.name] = animation.channels.map((channel) =>
    `${json.nodes[channel.target.node]?.name}:${channel.target.path}`).sort();
}

const animationSamples = {};
for (const sourceClip of gltf.animations) {
  // Fresh parse per clip prevents one clip's terminal pose from contaminating
  // the next clip's t=0 sample.
  const sampleGltf = await new Promise((done, fail) => {
    loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", done, fail);
  });
  const sampleScene = sampleGltf.scene;
  const clip = sampleGltf.animations.find((candidate) => candidate.name === sourceClip.name);
  const mixer = new THREE.AnimationMixer(sampleScene);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  animationSamples[sourceClip.name] = [];
  for (const time of [0, clip.duration / 2, clip.duration]) {
    mixer.setTime(time);
    sampleScene.updateMatrixWorld(true);
    const nodes = {};
    for (const name of REQUIRED_NODES) {
      const object = sampleScene.getObjectByName(name);
      nodes[name] = object ? {
        transform: transformRecord(object),
        bounds: boxRecord(ownBounds(object)),
      } : null;
    }
    animationSamples[sourceClip.name].push({
      time: Number(time.toFixed(4)),
      sceneBounds: boxRecord(new THREE.Box3().setFromObject(sampleScene)),
      nodes,
    });
  }
  action.stop();
  mixer.uncacheRoot(sampleScene);
}

// Reload once after sampling to get an unmodified default-pose static bbox.
const staticGltf = await new Promise((done, fail) => {
  loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", done, fail);
});
const staticBounds = boxRecord(new THREE.Box3().setFromObject(staticGltf.scene));

const failures = [];
for (const name of REQUIRED_NODES) {
  if (!scene.getObjectByName(name)) failures.push(`missing node ${name}`);
}
for (const name of REQUIRED_CLIPS) {
  if (!gltf.animations.some((clip) => clip.name === name)) failures.push(`missing clip ${name}`);
  const actual = jsonClipChannels[name] ?? [];
  for (const channel of EXPECTED_CHANNELS[name]) {
    if (!actual.includes(channel)) failures.push(`${name} missing channel ${channel}`);
  }
}
if (triangles > 35000) failures.push(`triangle budget exceeded: ${triangles}`);
if (meshes !== 7) failures.push(`expected 7 meshes, got ${meshes}`);
if ((json.materials ?? []).length > 2) failures.push(`expected <=2 materials, got ${(json.materials ?? []).length}`);
if ((json.images ?? []).length > 2) failures.push(`expected <=2 images, got ${(json.images ?? []).length}`);
if (!imageInfo.every((image) => image.embedded)) failures.push("external texture detected");
if (imageInfo.some((image) => image.dimensions && image.dimensions.some((value) => value > 1024))) {
  failures.push("texture exceeds 1024");
}
if ((json.skins ?? []).length || skinnedMeshes) failures.push("unexpected rig/skin");
if (Math.abs(staticBounds.min[1]) > 0.005) failures.push(`not grounded: minY=${staticBounds.min[1]}`);

const componentProvenance = {};
for (const component of PRESS_V2_COMPONENTS) {
  const taskPath = resolve(ROOT, PRESS_V2_DIRS.raw, `${component.key}.glb.task.json`);
  const conceptPath = resolve(ROOT, PRESS_V2_DIRS.concepts, `${component.key}.png`);
  const rawPath = resolve(ROOT, PRESS_V2_DIRS.raw, `${component.key}.glb`);
  const optimizedPath = resolve(ROOT, PRESS_V2_DIRS.optimized, `${component.key}.glb`);
  const task = existsSync(taskPath) ? JSON.parse(readFileSync(taskPath, "utf8")) : {};
  const optimizedBytes = readFileSync(optimizedPath);
  const optimizedJson = glbChunks(optimizedBytes).json;
  const optimizedTris = (optimizedJson.meshes ?? []).reduce((total, mesh) =>
    total + mesh.primitives.reduce((meshTotal, primitive) => {
      const accessor = primitive.indices !== undefined
        ? optimizedJson.accessors[primitive.indices]
        : optimizedJson.accessors[primitive.attributes.POSITION];
      return meshTotal + Math.round((accessor?.count ?? 0) / 3);
    }, 0), 0);
  componentProvenance[component.node] = {
    key: component.key,
    conceptPath: `${PRESS_V2_DIRS.concepts}/${component.key}.png`,
    rawPath: `${PRESS_V2_DIRS.raw}/${component.key}.glb`,
    optimizedComponentPath: `${PRESS_V2_DIRS.optimized}/${component.key}.glb`,
    meshyTaskId: task.taskId ?? null,
    targetTris: component.targetTris,
    conceptBytes: readFileSync(conceptPath).length,
    rawBytes: readFileSync(rawPath).length,
    optimizedBytes: optimizedBytes.length,
    optimizedTris,
    prompt: component.prompt,
  };
}

const verify = {
  ok: failures.length === 0,
  failures,
  outputPath: "assets/build/interior-kit-opt/press-common-operable-v2.glb",
  bytes: bytes.length,
  triangles,
  meshes,
  materials: (json.materials ?? []).length,
  textures: (json.textures ?? []).length,
  images: imageInfo,
  skins: (json.skins ?? []).length,
  staticBounds,
  nodes: nodeTransforms,
  clips: gltf.animations.map((clip) => ({
    name: clip.name,
    duration: Number(clip.duration.toFixed(4)),
    tracks: clip.tracks.map((track) => track.name),
    keyframes: clip.tracks.map((track) => track.times.length),
    channels: jsonClipChannels[clip.name] ?? [],
  })),
  animationSamples,
};
writeFileSync(VERIFY_PATH, JSON.stringify(verify, null, 2));

const manifest = {
  generatedAt: new Date().toISOString(),
  asset: "press-common-operable-v2",
  outputPath: "assets/build/interior-kit-opt/press-common-operable-v2.glb",
  pipeline:
    "Gemini isolated concepts -> visual QA -> Meshy imported components -> Blender cleanup/decimation/orientation/pivots/parenting/shared 1024 atlas/keyframes -> GLB verification and sampled-frame QA",
  importedGeometryOnly: true,
  components: componentProvenance,
  stats: {
    bytes: bytes.length,
    triangles,
    bounds: staticBounds,
    meshes,
    materials: (json.materials ?? []).length,
    textures: imageInfo,
  },
  hierarchy: nodeTransforms,
  clips: verify.clips,
  targetTransforms: {
    pressPull:
      "Press_Lever sweeps from -50 to +35 degrees while Press_Screw rotates +85 degrees around local Y-up; Press_Screw and Press_Platen translate -0.03 on local Y-up, closing the measured rest gap to surface contact. Ends at full impression.",
    pressRelease:
      "Reverse of pressPull: +85 degrees/-0.03 returns to zero/up.",
    carriageOut:
      "Press_Carriage translates +0.72 along glTF local Z (toward pressman), clearing the parked lever/frame; children Press_Tympan and Press_Frisket follow.",
    carriageIn:
      "Reverse of carriageOut: local Z +0.72 returns to zero/in.",
    tympanOpen:
      "Press_Tympan rotates -78 degrees about its back-edge local X hinge; child Press_Frisket adds -8 degrees to avoid z-fighting while nested.",
    tympanClose:
      "Reverse of tympanOpen to both local rotations zero/closed.",
  },
  integration:
    "Later copy the GLB to apps/web/public/world/props/ and bind AnimationMixer clips by exact names. Do not combine with the old static press or ProceduralPress rig; replace both together to avoid duplicated mechanism geometry.",
  verifyPath: "assets/build/interior-kit/press-common-operable-v2.verify.json",
};
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({
  ok: verify.ok,
  failures,
  triangles,
  bytes: bytes.length,
  bounds: staticBounds,
  nodes: REQUIRED_NODES,
  clips: verify.clips.map(({ name, duration, tracks }) => ({ name, duration, tracks })),
  resources: { materials: verify.materials, images: imageInfo },
}, null, 2));
process.exit(failures.length ? 1 : 0);

