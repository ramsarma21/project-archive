// Photograph a re-textured character rig beside the player rig, with its clips
// actually running in a browser.
//
// The asset sheet cannot answer this one. Its `cells=` path draws through
// FittedGlb - the generic prop fitter - which produces exactly the failure this
// change must not cause: an unanimated, wrongly-scaled body standing next to a
// real one. It also resolves paths from M1's declared ASSETS, and the market's
// townsman/townswoman are not declared there, so `cells=townsman-rigged` 404s.
//
// So this builds the same comparison the sheet builds - subject beside the
// imported player rig, both fitted to STAND_HEIGHT, feet on a ground plate - but
// through a real SkinnedMesh and AnimationMixer, and it renders the pre-optimize
// file in the same frame as the post-optimize one. Every subject is measured as
// well as photographed: bone displacement under the mixer is reported per clip,
// so "the clips still play" is an assertion rather than an impression.
//
// The harness page and the pre-optimize GLBs are served by intercepting requests
// on the dev server's origin rather than by writing anything into
// public/world/characters. Nothing is staged in the deployed cast directory, so
// no run of this script can leave an artifact there or accidentally promote a rig.
//
// Run with the web dev server already up (do NOT start a second one):
//   node assets/pipeline/shot_rig_clipsheet.mjs http://127.0.0.1:5399 /tmp/rigqa
import { chromium } from "playwright";
import { mkdirSync, readFileSync, statSync, globSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const BASE = args[0] ?? "http://127.0.0.1:5399";
const OUT = resolve(args[1] ?? "/tmp/rigqa");
mkdirSync(OUT, { recursive: true });

// Subjects, as label=beforeGlb=afterGlb. Both sides are read off disk and served
// through request interception, so a candidate can be judged BEFORE it is
// deployed - which is the order that matters for a rig that might fail QA.
//
//   --rig 'pike=assets/build/characters-final/pike-production.glb=/tmp/pass2/pike.glb'
const requested = process.argv
  .slice(2)
  .filter((a) => a.startsWith("--rig="))
  .map((a) => a.slice("--rig=".length).split("="));

const SUBJECT_DEFS =
  requested.length > 0
    ? requested
    : [
        ["townsman", "assets/build/characters-final/townsman-native.glb",
          "apps/web/public/world/characters/townsman-rigged.glb"],
        ["townswoman", "assets/build/characters-final/townswoman-native.glb",
          "apps/web/public/world/characters/townswoman-rigged.glb"],
      ];

// Virtual URLs, fulfilled from disk by the router below. They are not on the dev
// server and never touch public/.
const VIRTUAL_GLB = new Map();
const SUBJECTS = SUBJECT_DEFS.map(([label, before, after]) => {
  const beforeUrl = `/__rigqa/${label}-before.glb`;
  const afterUrl = `/__rigqa/${label}-after.glb`;
  VIRTUAL_GLB.set(beforeUrl, resolve(ROOT, before));
  VIRTUAL_GLB.set(afterUrl, resolve(ROOT, after));
  return {
    label,
    beforeUrl,
    afterUrl,
    beforeMb: statSync(resolve(ROOT, before)).size / 1048576,
    afterMb: statSync(resolve(ROOT, after)).size / 1048576,
  };
});

const PLAYER = "/world/characters/playerboy-rigged.glb";

// An import map, because GLTFLoader is fetched straight out of node_modules and
// its bare `three` specifier is not rewritten for a page vite did not transform.
const HARNESS_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>rig clip sheet</title>
<style>html,body{margin:0;height:100%;background:#8c9db1;overflow:hidden}
#label{position:fixed;left:0;bottom:0;margin:0;padding:8px 12px;background:rgba(10,14,20,.86);
color:#dce6f2;font:13px/1.55 ui-monospace,Menlo,monospace;white-space:pre}</style>
<script type="importmap">
{"imports":{"three":"/node_modules/three/build/three.module.js"}}
</script>
</head>
<body><pre id="label"></pre>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/node_modules/three/examples/jsm/loaders/GLTFLoader.js";

const params = new URLSearchParams(location.search);
const HEIGHT = Number(params.get("height") ?? "1.55");   // engine STAND_HEIGHT
const PITCH = Number(params.get("pitch") ?? "1.5");
const DIST = Number(params.get("dist") ?? "5.2");
const CLIP = params.get("clip") ?? "idle";
const AT = Number(params.get("t") ?? "0.9");
const SUBJECTS = (params.get("rigs") ?? "").split(",").filter(Boolean).map((entry) => {
  const [url, label, tint] = entry.split("|");
  return { url, label: label || url, tint: tint || null };
});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#8c9db1");
// Matches the asset sheet's light rig so a judgement here transfers to that page.
scene.add(new THREE.HemisphereLight("#cddcf0", "#3c3a34", 1.35));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(18, 26, 12);
sun.castShadow = true;
scene.add(sun);

const span = PITCH * Math.max(1, SUBJECTS.length - 1);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(span + 10, 12),
  new THREE.MeshStandardMaterial({ color: "#6f6a5e", roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.004;
ground.receiveShadow = true;
scene.add(ground);

const LOOK = Number(params.get("look") ?? String(HEIGHT * 0.55));
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, params.get("look") ? LOOK : DIST * 0.36, DIST);
camera.lookAt(0, LOOK, 0);

const loader = new GLTFLoader();
const report = [];

/** Feet on y=0, total height == HEIGHT. Mirrors RiggedCharacter's measure/scale. */
function fit(root, height) {
  const measure = () => {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let any = false;
    root.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.computeBoundingBox();
        if (o.boundingBox) {
          tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
          any ? box.union(tmp) : box.copy(tmp);
          any = true;
        }
      } else if (o.isMesh) {
        tmp.setFromObject(o);
        any ? box.union(tmp) : box.copy(tmp);
        any = true;
      }
    });
    return box;
  };
  const natural = measure().getSize(new THREE.Vector3()).y;
  root.scale.setScalar(natural > 0.01 ? height / natural : 1);
  root.position.y -= measure().min.y;
  return natural;
}

for (let index = 0; index < SUBJECTS.length; index++) {
  const subject = SUBJECTS[index];
  const gltf = await loader.loadAsync(subject.url);
  const root = gltf.scene;
  const tint = subject.tint ? new THREE.Color(subject.tint) : null;
  const flags = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const next = list.map((material) => {
      const copy = material.clone();
      if (tint && copy.color) copy.color.multiply(tint);
      copy.side = THREE.DoubleSide;   // matches RiggedCharacter
      copy.depthWrite = true;
      copy.needsUpdate = true;
      flags.add(copy.transparent ? "transparentDraw" : "opaqueDraw");
      const map = copy.map;
      if (map && map.image) {
        flags.add("albedo" + (map.image.width ?? "?") + "x" + (map.image.height ?? "?"));
      }
      return copy;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });

  const natural = fit(root, HEIGHT);
  root.position.x = -span / 2 + index * PITCH;
  // These rigs already rest facing +Z, which is toward the camera. The yaw param
  // turns them away when a shot wants the back (the vest seams are on that side).
  root.rotation.y = Number(params.get("yaw") ?? "0");
  scene.add(root);

  const names = gltf.animations.map((clip) => clip.name);
  const wanted = names.includes(CLIP) ? CLIP : names[0];
  const clip = gltf.animations.find((candidate) => candidate.name === wanted);
  let motion = null;
  let probeBone = null;
  if (clip) {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    // Does the mixer actually move the skeleton? Track EVERY bone's world
    // position across the clip and report the largest travel. Naming-agnostic on
    // purpose: this cast mixes mixamorig-prefixed rigs with bare-named ones
    // (dockhand's root bone is "Hips"), so probing a fixed bone name reports a
    // false zero on half the crowd.
    const bones = [];
    root.traverse((o) => {
      if (o.isBone) bones.push(o);
    });
    const tracked = bones.length > 0 ? bones : [root];
    const spans = tracked.map(() => ({
      min: new THREE.Vector3(Infinity, Infinity, Infinity),
      max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
    }));
    const sample = new THREE.Vector3();
    const steps = 24;
    for (let step = 0; step <= steps; step++) {
      mixer.setTime((clip.duration * step) / steps);
      root.updateMatrixWorld(true);
      for (let i = 0; i < tracked.length; i++) {
        tracked[i].getWorldPosition(sample);
        spans[i].min.min(sample);
        spans[i].max.max(sample);
      }
    }
    let best = -1;
    for (let i = 0; i < spans.length; i++) {
      const travel = spans[i].max.clone().sub(spans[i].min);
      if (travel.length() > best) {
        best = travel.length();
        motion = travel;
        probeBone = tracked[i].name || "root";
      }
    }
    mixer.setTime(Math.min(AT, clip.duration));
    root.updateMatrixWorld(true);
  }

  report.push({
    label: subject.label,
    clips: names.length,
    clipNames: names,
    played: wanted ?? null,
    naturalHeight: Number(natural.toFixed(3)),
    flags: [...flags].sort().join(" "),
    probeBone,
    motion: motion ? [motion.x, motion.y, motion.z].map((v) => Number(v.toFixed(4))) : null,
  });
}

document.getElementById("label").textContent = report
  .map(
    (row) =>
      row.label.padEnd(28) +
      " clips=" + String(row.clips).padStart(2) +
      "  playing=" + String(row.played).padEnd(9) +
      "  boneTravel=" + (row.motion ? row.motion.join(" / ") + "m" : "NONE") +
      "  " + row.flags,
  )
  .join("\\n");

renderer.render(scene, camera);
window.__clipsheet = report;
window.__clipsheetReady = true;
</script>
</body></html>
`;

const candidates = globSync(
  "/var/folders/**/cursor-sandbox-cache/*/playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const executablePath = candidates[0] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 780 } });
page.on("pageerror", (error) => console.log("  pageerror:", String(error).slice(0, 300)));
page.on("console", (message) => {
  if (message.type() === "error") console.log("  console.error:", message.text().slice(0, 300));
});

// The harness page and the pre-optimize GLBs, served on the dev server's origin
// without existing on it.
await page.route("**/__rigqa/**", (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith(".glb")) {
    const file = VIRTUAL_GLB.get(path);
    if (!file) return route.fulfill({ status: 404, body: "no such staged rig" });
    return route.fulfill({ contentType: "model/gltf-binary", body: readFileSync(file) });
  }
  return route.fulfill({ contentType: "text/html; charset=utf-8", body: HARNESS_HTML });
});

// The five rigs CIVILIAN_RIGS cycles, wearing the tints M1 assigns, so "still
// five varied people rather than three" is checkable in one frame.
const CROWD = [
  ["/world/characters/townsman-rigged.glb", "townsman NEW", "#8d7c63"],
  ["/world/characters/townswoman-rigged.glb", "townswoman NEW", "#6f6552"],
  ["/world/characters/dockhand-rigged.glb", "dockhand", "#9a8b74"],
  ["/world/characters/goodwife-rigged.glb", "goodwife", "#8d7c63"],
  ["/world/characters/agitator-rigged.glb", "agitator", "#6f6552"],
];

/** Built through URLSearchParams: a tint's leading `#` would otherwise cut the
 *  query short as a fragment and silently drop every subject after the first. */
function sheetQuery(rigs, extra) {
  const params = new URLSearchParams({ rigs: rigs.map((parts) => parts.join("|")).join(",") });
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  return params.toString();
}

const WIDE = { pitch: 1.5, dist: 5.4 };
const CLOSE = { pitch: 0.9, dist: 2.4 };
const HEAD = { pitch: 0.55, dist: 1.15, look: 1.42 };
const ROW = { pitch: 1.15, dist: 6.4 };

/**
 * The standard sheet for one rig. A re-encoded albedo fails visibly in three
 * places and nowhere else: the face, the high-frequency cloth seams on the back,
 * and any large flat gradient. So every subject gets a full-body scale check
 * against the ruler, a head-and-shoulders, a back, and two clips in motion.
 */
function subjectShots(subject, index) {
  const n = String(index + 1).padStart(2, "0");
  const pair = (suffix = "") => [
    [subject.beforeUrl, `BEFORE ${subject.beforeMb.toFixed(2)}MB${suffix}`],
    [subject.afterUrl, `AFTER ${subject.afterMb.toFixed(2)}MB${suffix}`],
  ];
  return [
    [`${n}-${subject.label}-a-ruler`, sheetQuery(
      [...pair(), [PLAYER, "playerboy ruler 1.55m"]], { clip: "idle", ...WIDE })],
    [`${n}-${subject.label}-b-head`, sheetQuery(pair(), { clip: "idle", ...HEAD })],
    [`${n}-${subject.label}-c-back`, sheetQuery(pair(), { clip: "idle", yaw: Math.PI, ...CLOSE })],
    [`${n}-${subject.label}-d-front-close`, sheetQuery(pair(), { clip: "idle", ...CLOSE })],
    [`${n}-${subject.label}-e-walk`, sheetQuery(pair(" walk"), { clip: "walk", t: 0.5, ...WIDE })],
    [`${n}-${subject.label}-f-talk`, sheetQuery(pair(" talk"), { clip: "talk", t: 2, ...WIDE })],
  ];
}

const SHOTS = SUBJECTS.flatMap(subjectShots);
// The crowd row only means something when the market rigs are the subjects.
if (SUBJECTS.some((s) => s.label === "townsman")) {
  SHOTS.push(
    ["90-crowd-five-rigs-idle", sheetQuery(CROWD, { clip: "idle", ...ROW })],
    ["91-crowd-five-rigs-walk", sheetQuery(CROWD, { clip: "walk", t: 0.5, ...ROW })],
    ["92-crowd-five-rigs-talk", sheetQuery(CROWD, { clip: "talk", t: 1.5, ...ROW })],
  );
}

let failures = 0;
for (const [name, query] of SHOTS) {
  await page.goto(`${BASE}/__rigqa/sheet.html?${query}`, { waitUntil: "load" });
  const ok = await page
    .waitForFunction("window.__clipsheetReady === true", { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    console.log(`SKIP  ${name} (harness did not finish loading)`);
    failures++;
    continue;
  }
  await page.waitForTimeout(300);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  const report = await page.evaluate("window.__clipsheet");
  console.log(`WROTE ${path}`);
  for (const row of report) {
    const dead = row.motion && row.motion.every((v) => v < 0.0005);
    console.log(
      `   ${row.label.padEnd(28)} clips=${String(row.clips).padStart(2)} ` +
        `playing=${String(row.played).padEnd(10)} ` +
        `boneTravel=${row.motion ? row.motion.join("/") + "m" : "NONE"}` +
        `${dead ? "  <-- STATIC" : ""} @${row.probeBone ?? "-"} ` +
        `natural=${row.naturalHeight}m ${row.flags}`,
    );
    if (!row.motion || dead) failures++;
  }
}

await browser.close();
console.log(failures === 0 ? "\nALL SHOTS OK - every subject animated" : `\n${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
