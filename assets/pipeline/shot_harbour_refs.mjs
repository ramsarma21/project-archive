// Render REFERENCE FRAMES for the harbour cutscene (File 1) out of our OWN
// production GLBs, so the video model (Runway/Kling/Seedance) anchors on the
// game's real art style and palette instead of inventing a generic dockside.
//
// This adapts the architecture of assets/pipeline/shot_rig_clipsheet.mjs — a
// self-served Playwright harness (inline HTML + import map + GLTFLoader,
// screenshotting a Three scene) — but with two differences that matter here:
//   1. It needs NO dev server and NO port. three.module.js, the jsm GLTFLoader
//      and every GLB are served from disk by intercepting requests, so nothing
//      contends with the owner's :5173 / :3001 stack.
//   2. Props are placed at REAL-WORLD scale in a composed dockside, not fitted
//      to a 1.55 m ruler. The wharf layout follows World-Design-Bible §"THE
//      WHARF" + §7 "Water & ships": moored brig + anchored snow + sloop +
//      rowboats, warehouses on the north side, water plane to the south/west.
//
// Physical surfaces are imported GLBs (wharf apron/pier, warehouses, ships,
// cargo, rigs). Only the water plane, sky, fog, lighting and contact shadows are
// procedural — which the imported-visible-world asset rule explicitly permits.
//
// Run (from anywhere; reads three + playwright from the hub node_modules):
//   node assets/pipeline/shot_harbour_refs.mjs
//   SHOT=shot1 node assets/pipeline/shot_harbour_refs.mjs   # one shot
//
// Env: SHOT (shot1|shot2|shot3|all), OUT (dir), THREE_DIR, PUBLIC, PW (playwright index.mjs)

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";

const HUB = "/Users/ramsarma/Projects/project-archive";
const THREE_DIR =
  process.env.THREE_DIR ??
  `${HUB}/node_modules/.pnpm/three@0.185.1/node_modules/three`;
const PW =
  process.env.PW ??
  `${HUB}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs`;
const WORKTREE = resolve(import.meta.dirname, "../..");
const PUBLIC = process.env.PUBLIC ?? join(WORKTREE, "apps/web/public");
const OUT = resolve(
  process.env.OUT ?? join(WORKTREE, "assets/reference/harbour-cutscene"),
);
mkdirSync(OUT, { recursive: true });

const { chromium } = await import(PW);

// ---------------------------------------------------------------------------
// Scene specifications. Numbers tuned by eye against the render; kept here so a
// re-tune is a one-file edit. Local frame: wharf deck top at y=0, the pier runs
// along +X, the harbour water is to -Z (and far), warehouses on the +Z (land)
// side. All lengths in metres.
// ---------------------------------------------------------------------------

const WATER_Y = -0.7;

// A dense line of moored / anchored hulls, reusing the three ship GLBs to read
// as "a forest of idle masts" (Bible encourages aggressive GLB reuse). Each:
// [key, x, z, rotY(rad), lengthM, draftM]. draft = how far the keel sits below
// the waterline.
const HARBOUR_SHIPS = [
  ["ship-brig-hero", 6, -9, 1.62, 26, 3.4], // hero brig broadside, near the apron
  ["ship-sloop", -14, -12, 1.4, 14, 1.9],
  ["ship-snow-background", -30, -26, 1.2, 22, 3.0],
  ["ship-snow-background", 26, -30, 2.1, 22, 3.0],
  ["ship-brig-hero", 2, -46, 1.5, 26, 3.4],
  ["ship-sloop", 34, -16, 1.9, 14, 1.9],
  ["ship-snow-background", -46, -44, 1.7, 22, 3.0],
];

const shipInstances = (list) =>
  list.map(([key, x, z, rotY, lengthM, draft]) => ({
    key,
    pos: [x, WATER_Y, z],
    rotY,
    targetLen: lengthM,
    axis: "maxH",
    keel: WATER_Y - draft,
  }));

const SCENES = {
  // SHOT 1 — WIDE: the port shut. High, wide, looking down the wharf into a
  // forest of masts and moored hulls, warehouses to the side, dead cargo on the
  // apron. Overcast, muted maritime palette.
  shot1: {
    viewport: [1280, 720],
    dsr: 2,
    camera: { pos: [-33, 10.5, 17], look: [9, 0.2, -20], fov: 52 },
    env: {
      sky: "#b7c1cb",
      fog: ["#aeb8c2", 44, 230],
      hemi: ["#cbd5e0", "#41433f", 1.15],
      sun: { pos: [-30, 40, 24], intensity: 0.85, color: "#f2efe6" },
      exposure: 1.02,
    },
    water: { y: WATER_Y, color: "#4a544e", size: 900, rough: 0.5 },
    instances: [
      // The apron / deck the port works from.
      { key: "colonial-wharf-apron", pos: [4, 0, 6], rotY: 0, targetLen: 66, axis: "x", base: 0 },
      // Low pier edge modules with fender piles along the waterline (z≈0).
      { key: "wharf-pier-module", pos: [-22, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [-10, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [2, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [14, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [26, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      // A finger pier running out into the water.
      { key: "colonial-wharf-pier-finger", pos: [18, 0, -9], rotY: Math.PI / 2, targetLen: 22, axis: "maxH", base: 0 },
      // Warehouses / counting houses along the north (land) side, framing.
      { key: "bldg-warehouse-wharf-a", pos: [-20, 0, 18], rotY: Math.PI, targetLen: 16, axis: "maxH", base: 0 },
      { key: "bldg-warehouse-wharf-b", pos: [2, 0, 19], rotY: Math.PI, targetLen: 11, axis: "maxH", base: 0 },
      { key: "bldg-warehouse-wharf-a", pos: [32, 0, 17.5], rotY: Math.PI, targetLen: 16, axis: "maxH", base: 0 },
      // Idle dockside machinery + cargo left unmoved.
      { key: "timber-crane", pos: [6, 0, 4], rotY: -0.3, targetLen: 5.2, axis: "y", base: 0 },
      { key: "crate-mound", pos: [-18, 0, 6], rotY: 0.4, targetLen: 2.4, axis: "maxH", base: 0 },
      { key: "crate-stack", pos: [-4, 0, 7], rotY: -0.2, targetLen: 2.2, axis: "maxH", base: 0 },
      { key: "barrel-group", pos: [22, 0, 7], rotY: 0, targetLen: 1.1, axis: "y", base: 0 },
      { key: "barrel-group", pos: [-11, 0, 8.5], rotY: 0.5, targetLen: 1.1, axis: "y", base: 0 },
      { key: "rope-coil-large", pos: [10, 0, 2.5], rotY: 0, targetLen: 2.0, axis: "x", base: 0 },
      { key: "cargo-net-bundle", pos: [0, 0, 5.5], rotY: 0.2, targetLen: 2.6, axis: "y", base: 0 },
      { key: "fish-flakes-rack", pos: [-27, 0, 10], rotY: 0, targetLen: 5, axis: "x", base: 0 },
      { key: "bollard", pos: [-16, 0, 1.2], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      { key: "bollard", pos: [10, 0, 1.2], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      // Small craft at the pier.
      { key: "rowboat", pos: [-2, WATER_Y, -3.5], rotY: 0.5, targetLen: 4.5, axis: "maxH", keel: WATER_Y - 0.35 },
      { key: "rowboat", pos: [30, WATER_Y, -4], rotY: 1.1, targetLen: 4.5, axis: "maxH", keel: WATER_Y - 0.35 },
      { key: "buoy", pos: [-24, WATER_Y, -13], rotY: 0, targetLen: 1.0, axis: "maxH", keel: WATER_Y - 0.3 },
      ...shipInstances(HARBOUR_SHIPS),
    ],
  },

  // SHOT 2 — MID: the people it idled. Eye-level on the planks, a short line of
  // idle working figures (our rigs), the dead harbour behind them.
  shot2: {
    viewport: [1280, 720],
    dsr: 2,
    camera: { pos: [-5.8, 1.62, 8.8], look: [2.6, 1.15, -7], fov: 46 },
    env: {
      sky: "#b7c1cb",
      fog: ["#aeb8c2", 30, 170],
      hemi: ["#cbd5e0", "#41433f", 1.15],
      sun: { pos: [-24, 34, 20], intensity: 0.8, color: "#f2efe6" },
      exposure: 1.03,
    },
    water: { y: WATER_Y, color: "#4a544e", size: 900, rough: 0.5 },
    instances: [
      { key: "colonial-wharf-apron", pos: [4, 0, 6], rotY: 0, targetLen: 66, axis: "x", base: 0 },
      // Low fender-pile edge at the waterline, behind the line of workers.
      { key: "wharf-pier-module", pos: [-6, 0, -2.6], rotY: 0, targetLen: 1.6, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [6, 0, -2.6], rotY: 0, targetLen: 1.6, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [18, 0, -2.6], rotY: 0, targetLen: 1.6, axis: "y", base: 0 },
      { key: "bollard", pos: [-10, 0, -1.8], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      { key: "bollard", pos: [12, 0, -1.8], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      // The idle line of tradespeople (rest facing +Z, toward camera).
      { key: "dockhand-rigged", pos: [-1.8, 0, 2.2], rotY: 0.25, fitHeight: 1.78, clip: "idle", t: 0.55 }, // fisherman
      { key: "townsman-rigged", pos: [1.8, 0, 1.5], rotY: -0.1, fitHeight: 1.76, clip: "idle", t: 0.6 }, // cooper
      { key: "dockhand-rigged", pos: [4.2, 0, 2.2], rotY: -0.3, fitHeight: 1.78, clip: "idle", t: 0.35 }, // porter
      { key: "goodwife-rigged", pos: [6.6, 0, 2.5], rotY: -0.5, fitHeight: 1.66, clip: "idle", t: 0.5 }, // woman
      // The cooper's own barrels; a coil no ship will carry.
      { key: "barrel-group", pos: [0.4, 0, 3.4], rotY: 0.6, targetLen: 1.1, axis: "y", base: 0 },
      { key: "rope-coil-large", pos: [-3.8, 0, 2.9], rotY: 0, targetLen: 2.0, axis: "x", base: 0 },
      { key: "crate-stack", pos: [12.5, 0, 2.6], rotY: -0.3, targetLen: 2.2, axis: "maxH", base: 0 },
      // The shut harbour behind them: moored hulls + a forest of masts.
      { key: "ship-brig-hero", pos: [9, WATER_Y, -13], rotY: 1.62, targetLen: 26, axis: "maxH", keel: WATER_Y - 3.4 },
      { key: "ship-sloop", pos: [-12, WATER_Y, -15], rotY: 1.3, targetLen: 14, axis: "maxH", keel: WATER_Y - 1.9 },
      { key: "ship-snow-background", pos: [28, WATER_Y, -30], rotY: 2.0, targetLen: 22, axis: "maxH", keel: WATER_Y - 3.0 },
      { key: "ship-snow-background", pos: [-30, WATER_Y, -34], rotY: 1.5, targetLen: 22, axis: "maxH", keel: WATER_Y - 3.0 },
    ],
  },

  // SHOT 3 — CLOSE: one ruined man. Head-and-shoulders of the dockworker rig,
  // a moored hull soft in the fog behind him.
  shot3: {
    viewport: [1280, 720],
    dsr: 2,
    camera: { pos: [0.33, 1.5, 1.15], look: [0.02, 1.45, 0], fov: 28 },
    env: {
      sky: "#b3bdc7",
      fog: ["#aab4be", 6, 60],
      hemi: ["#cbd5e0", "#41433f", 1.2],
      sun: { pos: [-8, 20, 14], intensity: 0.72, color: "#f2efe6" },
      exposure: 1.05,
    },
    water: { y: WATER_Y, color: "#4a544e", size: 900, rough: 0.5 },
    instances: [
      { key: "dockhand-rigged", pos: [0, 0, 0], rotY: 0.32, fitHeight: 1.78, clip: "idle", t: 1.2 },
      { key: "ship-snow-background", pos: [-6, WATER_Y, -22], rotY: 1.5, targetLen: 22, axis: "maxH", keel: WATER_Y - 3.0 },
      { key: "ship-brig-hero", pos: [9, WATER_Y, -30], rotY: 1.7, targetLen: 26, axis: "maxH", keel: WATER_Y - 3.4 },
    ],
  },
};

// ---------------------------------------------------------------------------
// The browser-side scene builder, injected into the served page.
// ---------------------------------------------------------------------------
const PAGE_HTML = (sceneJson) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>harbour refs</title>
<style>html,body{margin:0;height:100%;background:#b7c1cb;overflow:hidden}</style>
<script type="importmap">{"imports":{"three":"/three.module.js"}}</script>
</head><body>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/jsm/loaders/GLTFLoader.js";

const SCENE = ${sceneJson};
const diag = [];
window.__diag = diag;

const [VW, VH] = SCENE.viewport;
const DSR = SCENE.dsr ?? 2;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(DSR);
renderer.setSize(VW, VH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = SCENE.env.exposure ?? 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const canvas = renderer.domElement;
canvas.style.width = VW + "px";
canvas.style.height = VH + "px";
document.body.appendChild(canvas);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SCENE.env.sky);
if (SCENE.env.fog) scene.fog = new THREE.Fog(SCENE.env.fog[0], SCENE.env.fog[1], SCENE.env.fog[2]);

const [hs, hg, hi] = SCENE.env.hemi;
scene.add(new THREE.HemisphereLight(new THREE.Color(hs), new THREE.Color(hg), hi));
const sun = new THREE.DirectionalLight(new THREE.Color(SCENE.env.sun.color), SCENE.env.sun.intensity);
sun.position.set(...SCENE.env.sun.pos);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 220;
const S = 70;
sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);

if (SCENE.water) {
  const w = SCENE.water;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w.size, w.size),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(w.color), roughness: w.rough ?? 0.5, metalness: 0.0 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = w.y;
  water.receiveShadow = true;
  scene.add(water);
}

const camera = new THREE.PerspectiveCamera(SCENE.camera.fov, VW / VH, 0.05, 2000);
camera.position.set(...SCENE.camera.pos);
camera.lookAt(...SCENE.camera.look);

const loader = new GLTFLoader();

function bbox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let any = false;
  root.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.computeBoundingBox();
      if (o.boundingBox) { tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld); any ? box.union(tmp) : box.copy(tmp); any = true; }
    } else if (o.isMesh) {
      tmp.setFromObject(o); any ? box.union(tmp) : box.copy(tmp); any = true;
    }
  });
  return box;
}

async function place(inst) {
  const gltf = await loader.loadAsync("/world/" + resolveKey(inst.key));
  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { if (m) { m.side = THREE.DoubleSide; m.needsUpdate = true; } }
  });

  // Play a clip pose for rigs.
  if (inst.clip && gltf.animations && gltf.animations.length) {
    const names = gltf.animations.map((c) => c.name);
    const name = names.includes(inst.clip) ? inst.clip : names[0];
    const clip = gltf.animations.find((c) => c.name === name);
    if (clip) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      mixer.setTime(Math.min(inst.t ?? 0.6, clip.duration));
      root.updateMatrixWorld(true);
    }
  }

  // Scale.
  let box = bbox(root);
  const size = box.getSize(new THREE.Vector3());
  let scale = 1;
  if (inst.fitHeight) {
    scale = size.y > 0.01 ? inst.fitHeight / size.y : 1;
  } else if (inst.targetLen) {
    const axisLen =
      inst.axis === "x" ? size.x :
      inst.axis === "z" ? size.z :
      inst.axis === "y" ? size.y :
      Math.max(size.x, size.z); // "maxH": largest horizontal dimension
    scale = axisLen > 0.01 ? inst.targetLen / axisLen : 1;
  }
  root.scale.setScalar(scale);

  // Rotate before we re-measure for the vertical seat.
  root.rotation.y = inst.rotY ?? 0;
  box = bbox(root);

  // Vertical seat: props/rigs sit their base on inst.base; ships sink so the
  // keel (box.min.y) lands at inst.keel.
  const targetBase = inst.keel != null ? inst.keel : (inst.base ?? 0);
  root.position.y += targetBase - box.min.y;
  root.position.x = inst.pos[0];
  root.position.z = inst.pos[2];

  scene.add(root);
  const fin = bbox(root);
  diag.push({
    key: inst.key,
    natural: [round(size.x), round(size.y), round(size.z)],
    scale: round(scale),
    drawn: [round(fin.max.x - fin.min.x), round(fin.max.y - fin.min.y), round(fin.max.z - fin.min.z)],
    clips: gltf.animations ? gltf.animations.map((c) => c.name) : [],
  });
}

const KEY_DIR = {
  "dockhand-rigged": "characters", "townsman-rigged": "characters",
  "townswoman-rigged": "characters", "goodwife-rigged": "characters",
  "agitator-rigged": "characters", "towncrier-rigged": "characters",
};
function resolveKey(key) {
  const dir = KEY_DIR[key] ?? "props";
  return dir + "/" + key + ".glb";
}
const round = (n) => Math.round(n * 1000) / 1000;

try {
  for (const inst of SCENE.instances) {
    try { await place(inst); }
    catch (e) { diag.push({ key: inst.key, error: String(e).slice(0, 200) }); }
  }
  renderer.render(scene, camera);
  // Re-render a few frames so late-decoded JPEG textures appear.
  let n = 0;
  const loop = () => { renderer.render(scene, camera); if (++n < 120) requestAnimationFrame(loop); };
  loop();
  window.__ready = true;
} catch (e) {
  window.__error = String(e);
  window.__ready = true;
}
</script>
</body></html>`;

// ---------------------------------------------------------------------------
// Node: launch, serve everything from disk, screenshot each shot.
// ---------------------------------------------------------------------------
const MIME = {
  ".js": "text/javascript", ".mjs": "text/javascript",
  ".glb": "model/gltf-binary", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".bin": "application/octet-stream",
};

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
  ],
});

const shots = (process.env.SHOT ?? "all") === "all"
  ? Object.keys(SCENES)
  : [process.env.SHOT];

let currentSceneJson = "{}";
const page = await browser.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || /error|fail/i.test(t)) console.log("  page>", t.slice(0, 300));
});
page.on("pageerror", (e) => console.log("  pageerror>", String(e).slice(0, 300)));

await page.route("**/*", (route) => {
  let path = new URL(route.request().url()).pathname;
  if (process.env.DBG) console.log("  route:", path);
  try {
    if (path.startsWith("/three.") && path.endsWith(".js")) {
      // three 0.185 splits into three.module.js + three.core.js.
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(join(THREE_DIR, "build", path.slice(1))) });
    }
    if (path.startsWith("/jsm/")) {
      const file = join(THREE_DIR, "examples/jsm", path.slice("/jsm/".length));
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(file) });
    }
    if (path.startsWith("/world/")) {
      const file = join(PUBLIC, path.slice(1));
      if (!existsSync(file)) return route.fulfill({ status: 404, body: "missing " + path });
      return route.fulfill({ contentType: MIME[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE_HTML(currentSceneJson) });
  } catch (e) {
    return route.fulfill({ status: 500, body: String(e) });
  }
});

for (const shot of shots) {
  const scene = SCENES[shot];
  if (!scene) { console.log("no such shot:", shot); continue; }
  currentSceneJson = JSON.stringify(scene);
  const [VW, VH] = scene.viewport;
  await page.setViewportSize({ width: VW, height: VH });
  await page.goto("http://harbour.local/index.html?shot=" + shot, { waitUntil: "load" });
  const ok = await page
    .waitForFunction("window.__ready === true", { timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) { console.log(`SKIP ${shot} (scene did not finish building)`); continue; }
  const err = await page.evaluate("window.__error ?? null");
  if (err) console.log(`  ${shot} __error:`, err);
  await page.waitForTimeout(3500); // let JPEG textures decode + the render loop settle
  const file = join(OUT, `${shot}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: VW, height: VH } });
  const diag = await page.evaluate("window.__diag");
  console.log(`WROTE ${file}`);
  for (const d of diag) {
    if (d.error) console.log(`   !! ${d.key}: ${d.error}`);
    else console.log(`   ${String(d.key).padEnd(26)} nat=${d.natural.join("x")} scale=${d.scale} drawn=${d.drawn.join("x")}${d.clips.length ? "  clips=[" + d.clips.join(",") + "]" : ""}`);
  }
}

await browser.close();
console.log("DONE ->", OUT);
