// Photograph foot slide.
//
// A locomotion clip is root-motion-stripped, so nothing about looking at it in
// place tells you whether it agrees with the speed the body is being driven at.
// The disagreement only becomes visible once the two are put together, and then
// it is the most obvious artifact on the character: the planted foot skates.
//
// So this is a treadmill. The rig is drawn several times along a metre-marked
// floor, once per sample, at the world position a body travelling `speed` would
// have reached — and the clip is advanced by the SAME world time multiplied by
// the mixer timeScale under test. A rate that matches the stride leaves the
// planted foot standing on the same floor mark in consecutive samples; a rate
// that does not drags it, and the drag is drawn as a red bar under the foot.
//
// The number printed with each strip is the integral of that drag: metres of
// ground the planted foot crosses per stride cycle. It is the same quantity
// `measure_clip_rates.mjs` minimises, photographed rather than tabulated.
//
// Run with a dev server already up that serves node_modules (do NOT start one):
//   node assets/pipeline/shot_locomotion_treadmill.mjs http://127.0.0.1:5399 /tmp/gait
import { chromium } from "playwright";
import { mkdirSync, globSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const BASE = args[0] ?? "http://127.0.0.1:5399";
const OUT = resolve(args[1] ?? "/tmp/gait");
mkdirSync(OUT, { recursive: true });

const HARNESS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>treadmill</title>
<style>html,body{margin:0;height:100%;background:#8c9db1;overflow:hidden}
#label{position:fixed;left:0;top:0;margin:0;padding:10px 14px;background:rgba(10,14,20,.88);
color:#eaf1fa;font:14px/1.6 ui-monospace,Menlo,monospace;white-space:pre}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>
</head><body><pre id="label"></pre>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/node_modules/three/examples/jsm/loaders/GLTFLoader.js";
// A plain Object3D.clone() shares the Skeleton, so every copy on the strip
// would show whichever pose was applied last — a row of identical T-poses.
// This is the same clone RiggedCharacter uses for exactly the same reason.
import { clone as skeletonClone } from "/node_modules/three/examples/jsm/utils/SkeletonUtils.js";

const params = new URLSearchParams(location.search);
const HEIGHT = 1.55;                                  // engine STAND_HEIGHT
const CLIP = params.get("clip") ?? "run";
const SPEED = Number(params.get("speed") ?? "4.6");
const RATE = Number(params.get("rate") ?? "1");
const SAMPLES = Number(params.get("samples") ?? "7");
const TITLE = params.get("title") ?? "";
// Verb mode: instead of one stride cycle, span the mechanical window the verb
// actually holds the body for, starting at the clip's measured content offset.
// This is the only way to see what a player sees during a 380ms vault.
const WINDOW_MS = Number(params.get("window") ?? "0");
const OFFSET_MS = Number(params.get("offset") ?? "0");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#8c9db1");
scene.add(new THREE.HemisphereLight("#cddcf0", "#3c3a34", 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(6, 20, 14);
sun.castShadow = true;
scene.add(sun);

// One full stride cycle of world travel, plus a margin.
const loader = new GLTFLoader();
const gltf = await loader.loadAsync("/world/characters/playerboy-rigged.glb");

/** RiggedCharacter's fit: skinned bounds, feet on 0, height matched. */
function fit(root, height) {
  const measure = () => {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3(); const tmp = new THREE.Box3(); let any = false;
    root.traverse((o) => {
      if (o.isSkinnedMesh) { o.computeBoundingBox(); if (!o.boundingBox) return;
        tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld); }
      else if (o.isMesh) { tmp.setFromObject(o); } else return;
      any ? box.union(tmp) : box.copy(tmp); any = true;
    });
    return box;
  };
  const natural = measure().getSize(new THREE.Vector3()).y;
  root.scale.setScalar(height / natural);
  root.position.y -= measure().min.y;
  return natural;
}
function bone(root, name) {
  let found = null;
  root.traverse((o) => {
    if (!found && (o.name === name || o.name === "mixamorig" + name || o.name === "mixamorig:" + name)) found = o;
  });
  return found;
}

const clip = gltf.animations.find((c) => c.name === CLIP);
const cycleWorldSeconds = WINDOW_MS > 0 ? WINDOW_MS / 1000 : clip.duration / RATE;
const travel = SPEED * cycleWorldSeconds;

// Floor: half-metre stripes running along the direction of travel, so a planted
// foot that holds still holds still against something the eye can measure.
for (let i = -2; i <= Math.ceil(travel / 0.5) + 2; i++) {
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 4),
    new THREE.MeshStandardMaterial({ color: i % 2 ? "#6f6a5e" : "#7d7869", roughness: 1 }),
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(i * 0.5 + 0.25, -0.004, 0);
  stripe.receiveShadow = true;
  scene.add(stripe);
}

const toes = ["LeftToeBase", "RightToeBase"];
const bodies = [];
const contacts = [];
let lowest = [Infinity, Infinity];

// Pass one: find each toe's floor height, on a throwaway instance.
{
  const probe = skeletonClone(gltf.scene);
  fit(probe, HEIGHT);
  scene.add(probe);
  const mixer = new THREE.AnimationMixer(probe);
  mixer.clipAction(clip).play();
  const probes = toes.map((n) => bone(probe, n));
  for (let s = 0; s < 120; s++) {
    mixer.setTime((clip.duration * s) / 120);
    probe.updateMatrixWorld(true);
    for (let f = 0; f < 2; f++) {
      lowest[f] = Math.min(lowest[f], probes[f].getWorldPosition(new THREE.Vector3()).y);
    }
  }
  scene.remove(probe);
}

let slip = 0;
let prevWorld = [null, null];
const marks = [];
for (let s = 0; s < SAMPLES; s++) {
  const worldT = (cycleWorldSeconds * s) / (SAMPLES - 1);
  const body = skeletonClone(gltf.scene);
  fit(body, HEIGHT);
  body.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const next = list.map((m) => {
      const c = m.clone();
      c.side = THREE.DoubleSide;
      c.depthWrite = true;
      // Fade the earlier samples so the strip reads left to right in time.
      c.transparent = s < SAMPLES - 1;
      c.opacity = 0.35 + 0.65 * (s / (SAMPLES - 1));
      return c;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });
  const mixer = new THREE.AnimationMixer(body);
  mixer.clipAction(clip).play();
  mixer.setTime(Math.min(clip.duration, OFFSET_MS / 1000 + worldT * RATE));
  body.position.x = SPEED * worldT;
  body.rotation.y = Math.PI / 2;   // rest facing +Z, travel is +X
  body.updateMatrixWorld(true);
  scene.add(body);
  bodies.push(body);

  const probes = toes.map((n) => bone(body, n));
  for (let f = 0; f < 2; f++) {
    const p = probes[f].getWorldPosition(new THREE.Vector3());
    const planted = p.y <= lowest[f] + 0.03;
    if (planted) {
      marks.push({ x: p.x, z: p.z, foot: f });
      if (prevWorld[f]) slip += Math.hypot(p.x - prevWorld[f].x, p.z - prevWorld[f].z);
      prevWorld[f] = { x: p.x, z: p.z };
    } else prevWorld[f] = null;
  }
}

// The slide, drawn: a bar joining consecutive planted positions of one foot.
for (let i = 1; i < marks.length; i++) {
  if (marks[i].foot !== marks[i - 1].foot) continue;
  const a = marks[i - 1], b = marks[i];
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < 0.005) continue;
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.012, 0.07),
    new THREE.MeshBasicMaterial({ color: "#ff3020" }),
  );
  bar.position.set((a.x + b.x) / 2, 0.012, (a.z + b.z) / 2);
  bar.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
  scene.add(bar);
}

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
const mid = (SPEED * cycleWorldSeconds) / 2;
camera.position.set(mid, 1.5, Math.max(4.4, travel * 1.15));
camera.lookAt(mid, 0.72, 0);

const cadence = (2 / cycleWorldSeconds) * 60;
document.getElementById("label").textContent = WINDOW_MS > 0
  ? TITLE + "\\n" +
    "clip " + CLIP + "   timeScale " + RATE.toFixed(2) + "   start " + OFFSET_MS.toFixed(0) + " ms\\n" +
    "window " + WINDOW_MS.toFixed(0) + " ms shows clip " + OFFSET_MS.toFixed(0) + "-" +
      Math.min(clip.duration * 1000, OFFSET_MS + WINDOW_MS * RATE).toFixed(0) + " ms of " +
      (clip.duration * 1000).toFixed(0) + " ms  (" +
      (100 * Math.min(1, (WINDOW_MS * RATE) / (clip.duration * 1000))).toFixed(0) + "% of the file)"
  : TITLE + "\\n" +
    "clip " + CLIP + "   driven " + SPEED.toFixed(2) + " m/s   timeScale " + RATE.toFixed(3) + "\\n" +
    "cycle " + (cycleWorldSeconds * 1000).toFixed(0) + " ms   cadence " + cadence.toFixed(0) + " steps/min   " +
    "travel " + travel.toFixed(2) + " m\\n" +
    "planted-foot slide (red): " + (slip * 100).toFixed(1) + " cm across this cycle";

renderer.render(scene, camera);
window.__treadmill = { clip: CLIP, speed: SPEED, rate: RATE, slipM: slip, cadence };
window.__treadmillReady = true;
</script></body></html>
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
const page = await browser.newPage({ viewport: { width: 1500, height: 620 } });
page.on("pageerror", (error) => console.log("  pageerror:", String(error).slice(0, 300)));

await page.route("**/__gait/**", (route) =>
  route.fulfill({ contentType: "text/html; charset=utf-8", body: HARNESS_HTML }),
);

// Before/after for every locomotion clip whose authored speed moved, at the
// speed the motion code actually drives it.
const SHOTS = [
  ["01-run-before", { clip: "run", speed: 4.6, rate: 4.6 / 2.81, title: "BEFORE  run, authored speed recorded as 2.81 m/s" }],
  ["02-run-after", { clip: "run", speed: 4.6, rate: 4.6 / 5.8, title: "AFTER   run, authored speed measured at 5.80 m/s" }],
  ["03-dash-before", { clip: "run", speed: 6.67, rate: 1, title: "BEFORE  burst: dash fell back to run and was left at 1.0" }],
  ["04-dash-after", { clip: "run", speed: 6.67, rate: 6.67 / 5.8, title: "AFTER   burst: the fallback is stride-matched to the burst speed" }],
  ["05-crouchwalk-before", { clip: "crouchWalk", speed: 1.15, rate: 1.15 / 1.7, title: "BEFORE  crouchWalk, authored speed recorded as 1.70 m/s" }],
  ["06-crouchwalk-after", { clip: "crouchWalk", speed: 1.15, rate: 1.15 / 1.28, title: "AFTER   crouchWalk, authored speed measured at 1.28 m/s" }],
  ["07-walk-before", { clip: "walk", speed: 2.3, rate: 2.3 / 1.55, title: "BEFORE  walk, authored speed recorded as 1.55 m/s" }],
  ["08-walk-after", { clip: "walk", speed: 2.3, rate: 2.3 / 1.57, title: "AFTER   walk, authored speed measured at 1.57 m/s (barely moved)" }],

  // Verb windows: what a player actually sees while the physics holds them.
  ["10-vault-before", { clip: "vault", speed: 4.6, rate: 1, window: 380, offset: 0,
    title: "BEFORE  vault had no measured length, so its rate defaulted to 1.0" }],
  ["11-vault-after", { clip: "vault", speed: 4.6, rate: 4, window: 380, offset: 0,
    title: "AFTER   vault fitted to its content and held at the 4x ceiling" }],
  ["12-mantle-before", { clip: "mantle", speed: 4.6, rate: 8.6, window: 450, offset: 0,
    title: "BEFORE  mantle at 8.6x: the whole 3.9s performance inside 450 ms" }],
  ["13-mantle-after", { clip: "mantle", speed: 4.6, rate: 4, window: 450, offset: 0,
    title: "AFTER   mantle held at the 4x ceiling, overrunning and blended out" }],
  ["14-leapland-before", { clip: "leapOfFaithLand", speed: 0, rate: 10.46, window: 800, offset: 0,
    title: "BEFORE  leapOfFaithLand at 10.5x from t=0: a fifth of it is lying still" }],
  ["15-leapland-after", { clip: "leapOfFaithLand", speed: 0, rate: 4, window: 800, offset: 2500,
    title: "AFTER   4x, opening on the get-up instead of on 2.5s of dead air" }],
  ["16-droproll-before", { clip: "dropRoll", speed: 3.9, rate: 3.05, window: 400, offset: 0,
    title: "BEFORE  dropRoll at 3.05x, fitted to a length it does not have (1830 ms)" }],
  ["17-droproll-after", { clip: "dropRoll", speed: 3.9, rate: 1.94, window: 400, offset: 0,
    title: "AFTER   dropRoll at 1.94x, fitted to its measured 1163 ms of content" }],
];

let failures = 0;
for (const [name, spec] of SHOTS) {
  const query = new URLSearchParams({
    clip: spec.clip,
    speed: String(spec.speed),
    rate: String(spec.rate),
    samples: "7",
    window: String(spec.window ?? 0),
    offset: String(spec.offset ?? 0),
    title: spec.title,
  });
  await page.goto(`${BASE}/__gait/strip.html?${query}`, { waitUntil: "load" });
  const ok = await page
    .waitForFunction("window.__treadmillReady === true", { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    console.log(`SKIP  ${name}`);
    failures++;
    continue;
  }
  await page.waitForTimeout(250);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  const report = await page.evaluate("window.__treadmill");
  console.log(
    `WROTE ${path}\n   ${spec.clip} @${spec.speed}m/s rate=${report.rate.toFixed(3)} ` +
      `cadence=${report.cadence.toFixed(0)}spm slide=${(report.slipM * 100).toFixed(1)}cm/cycle`,
  );
}

await browser.close();
process.exit(failures === 0 ? 0 : 1);
