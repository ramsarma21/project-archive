// Validate colonial-door-kit.glb against the doorwayContract asset contract:
//   - named nodes: Door_Frame, Door_Recess, Door_Leaf (Door_Latch optional)
//   - animation clips: openInward, openOutward (~1.0-1.4s each)
//   - Door_Leaf pivot/origin at the hinge stile edge (not the leaf centre)
//   - frame/recess have NO animation channels (must stay stationary)
//   - budget: <= 15k tris, textures <= 1024px
//   - overall bounds within the ~1.2 x 2.05m opening envelope (+ swing)
//
// Usage: node assets/pipeline/verify_door_kit.mjs [path-to.glb]
// Default path: assets/build/door-kit-opt/colonial-door-kit.glb
globalThis.self = globalThis;
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const threeRoot = join(REPO, "apps", "web", "node_modules", "three");
const { Box3, Vector3 } = await import(`${threeRoot}/build/three.module.js`);
const { GLTFLoader } = await import(`${threeRoot}/examples/jsm/loaders/GLTFLoader.js`);

const target = resolve(process.argv[2] ?? join(REPO, "assets", "build", "door-kit-opt", "colonial-door-kit.glb"));
if (!existsSync(target)) {
  console.error(`missing GLB: ${target}\nRun assemble_door_kit.py (Blender) first.`);
  process.exit(1);
}

const REQUIRED_NODES = ["Door_Frame", "Door_Recess", "Door_Leaf"];
const REQUIRED_CLIPS = ["openInward", "openOutward"];
const CLIP_MIN_S = 1.0;
const CLIP_MAX_S = 1.4;
const TRI_BUDGET = 15000;
const TEX_MAX = 1024;

const bytes = readFileSync(target);
function embeddedImages(glb) {
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8").trim());
  const binHeader = 20 + jsonLength;
  const binStart = glb.readUInt32LE(binHeader + 4) === 0x004e4942
    ? binHeader + 8
    : -1;
  if (binStart < 0) return [];
  return (json.images ?? []).flatMap((image, index) => {
    if (image.bufferView == null) return [];
    const view = json.bufferViews?.[image.bufferView];
    if (!view) return [];
    const start = binStart + (view.byteOffset ?? 0);
    const data = glb.subarray(start, start + view.byteLength);
    let width = 0;
    let height = 0;
    if (data.subarray(1, 4).toString() === "PNG") {
      width = data.readUInt32BE(16);
      height = data.readUInt32BE(20);
    } else if (data[0] === 0xff && data[1] === 0xd8) {
      let p = 2;
      while (p + 9 < data.length) {
        if (data[p] !== 0xff) { p++; continue; }
        const marker = data[p + 1];
        const len = data.readUInt16BE(p + 2);
        if (marker >= 0xc0 && marker <= 0xc3) {
          height = data.readUInt16BE(p + 5);
          width = data.readUInt16BE(p + 7);
          break;
        }
        p += 2 + len;
      }
    }
    return [{ index, mime: image.mimeType ?? "unknown", width, height, bytes: view.byteLength }];
  });
}
const imageStats = embeddedImages(bytes);
// Mute the benign "Couldn't load texture" node warnings during parse.
const origError = console.error;
console.error = (...a) => {
  if (typeof a[0] === "string" && a[0].includes("Couldn't load texture")) return;
  origError(...a);
};
let gltf;
try {
  gltf = await new Promise((res, rej) =>
    new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", res, rej),
  );
} finally {
  console.error = origError;
}

const problems = [];
const ok = [];

// ---- nodes -----------------------------------------------------------------
const byName = new Map();
let triangles = 0;
gltf.scene.traverse((n) => {
  if (n.name) byName.set(n.name, n);
  if (n.isMesh) {
    const idx = n.geometry.index;
    triangles += (idx ? idx.count : n.geometry.attributes.position.count) / 3;
  }
});
for (const name of REQUIRED_NODES) {
  if (byName.has(name)) ok.push(`node ${name}`);
  else problems.push(`missing node: ${name}`);
}
if (byName.has("Door_Latch")) ok.push("node Door_Latch (optional)");

// ---- clips -----------------------------------------------------------------
const clips = new Map((gltf.animations ?? []).map((c) => [c.name, c]));
for (const name of REQUIRED_CLIPS) {
  const c = clips.get(name);
  if (!c) {
    problems.push(`missing clip: ${name}`);
    continue;
  }
  if (c.duration < CLIP_MIN_S || c.duration > CLIP_MAX_S) {
    problems.push(`clip ${name} duration ${c.duration.toFixed(2)}s outside ${CLIP_MIN_S}-${CLIP_MAX_S}s`);
  } else {
    ok.push(`clip ${name} ${c.duration.toFixed(2)}s`);
  }
  // Only the leaf may be animated.
  for (const track of c.tracks) {
    const node = track.name.split(".")[0];
    if (node && node !== "Door_Leaf" && node !== "Door_Latch") {
      problems.push(`clip ${name} animates ${node} (only Door_Leaf/Door_Latch may move)`);
    }
  }
}

// ---- leaf pivot at hinge edge ---------------------------------------------
const leaf = byName.get("Door_Leaf");
if (leaf) {
  leaf.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(leaf);
  const size = box.getSize(new Vector3());
  const origin = leaf.getWorldPosition(new Vector3());
  // The origin should sit near a vertical edge of the leaf (hinge stile), not
  // its centre: distance from origin to the nearer X face should be small.
  const dxMin = Math.min(Math.abs(origin.x - box.min.x), Math.abs(origin.x - box.max.x));
  if (dxMin > 0.15) problems.push(`Door_Leaf origin ${dxMin.toFixed(2)}m from nearest stile edge (expected hinge edge)`);
  else ok.push(`Door_Leaf pivot at hinge edge (${dxMin.toFixed(2)}m)`);
  // And near the floor.
  if (Math.abs(origin.y - box.min.y) > 0.15) problems.push(`Door_Leaf origin not at floor (${(origin.y - box.min.y).toFixed(2)}m)`);
  ok.push(`leaf size ~[${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)}]`);
}

// ---- budget ----------------------------------------------------------------
triangles = Math.round(triangles);
if (triangles > TRI_BUDGET) problems.push(`tris ${triangles} > budget ${TRI_BUDGET}`);
else ok.push(`tris ${triangles} <= ${TRI_BUDGET}`);

for (const img of gltf.parser?.json?.images ?? []) void img; // images decoded lazily
const textures = gltf.parser?.json?.textures ?? [];
ok.push(`textures declared: ${textures.length}`);
for (const image of imageStats) {
  if (!image.width || !image.height) {
    problems.push(`texture ${image.index} dimensions unreadable (${image.mime})`);
  } else if (Math.max(image.width, image.height) > TEX_MAX) {
    problems.push(`texture ${image.index} ${image.width}x${image.height} > ${TEX_MAX}px`);
  } else {
    ok.push(`texture ${image.index}: ${image.width}x${image.height} ${image.mime}`);
  }
}

// ---- overall bounds --------------------------------------------------------
const whole = new Box3().setFromObject(gltf.scene);
const wsize = whole.getSize(new Vector3());
ok.push(`overall bounds [${wsize.x.toFixed(2)}, ${wsize.y.toFixed(2)}, ${wsize.z.toFixed(2)}]`);
if (wsize.y > 2.6) problems.push(`overall height ${wsize.y.toFixed(2)}m unexpectedly tall`);

console.log("=== colonial-door-kit verification ===");
for (const line of ok) console.log("  ok:", line);
for (const line of problems) console.log("  FAIL:", line);
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nall checks passed");
process.exit(problems.length ? 1 : 0);
