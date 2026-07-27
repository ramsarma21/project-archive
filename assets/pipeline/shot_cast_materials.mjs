// Photograph the character cast under a DARK light rig, before and after the
// emissive fix, plus a scale ruler shot - without needing a dev server.
//
// WHY NOT shot_rig_clipsheet.mjs. That script is the right precedent and this
// borrows its fit/measure/bone-travel logic verbatim, but it has two properties
// that make it unable to see either defect being verified here:
//
//   1. It needs a running vite dev server for its own origin and for
//      /node_modules/three. There is none up, and starting one while three other
//      agents are working would touch shared dependency-optimisation state. So this
//      serves EVERYTHING - harness, three.js, and every GLB - off disk through
//      request interception against a fake origin. Nothing is written anywhere.
//   2. Its light rig is a bright hemisphere plus a 1.5-intensity sun, which is
//      exactly the condition under which an emissive body looks fine. The owner's
//      report - "all the npcs glow BRIGHT, but you literally cannot see anything
//      else at all" - only reproduces when the scene light is near zero, because
//      that is what makes a light-INDEPENDENT term the only thing on screen.
//
// So the dark row is the actual test: at ambient 0.02 a correct rig is nearly
// black and an emissive one is at full albedo. Before and after are rendered in the
// same frame from the same camera, so the difference cannot be a lighting change.
//
// Usage:
//   node assets/pipeline/shot_cast_materials.mjs /tmp/castqa
import { chromium } from "playwright";
import { mkdirSync, readFileSync, existsSync, statSync, globSync } from "node:fs";
import { join, resolve, extname } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const OUT = resolve(process.argv[2] ?? "/tmp/castqa");
mkdirSync(OUT, { recursive: true });

const ORIGIN = "http://cast-qa.invalid";
const WEB_MODULES = join(ROOT, "apps", "web", "node_modules");
const PUBLISHED = join(ROOT, "apps", "web", "public", "world", "characters");
const ROLLBACK = join(ROOT, "assets", "build", "characters-emissive-rollback");

/** The seven rigs whose albedo was wired in as emissive. */
const FIXED = ["dockhand", "goodwife", "agitator", "constable", "abigail", "taxclerk", "towncrier"];

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".json": "application/json",
};

const HARNESS = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>cast materials</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}
#label{position:fixed;left:0;bottom:0;margin:0;padding:8px 12px;background:rgba(10,14,20,.9);
color:#dce6f2;font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre}
#title{position:fixed;left:0;top:0;margin:0;padding:8px 12px;background:rgba(10,14,20,.9);
color:#ffd9a0;font:14px/1.4 ui-monospace,Menlo,monospace}</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js",
"three/":"/node_modules/three/"}}</script></head>
<body><pre id="title"></pre><pre id="label"></pre>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/node_modules/three/examples/jsm/loaders/GLTFLoader.js";

const params = new URLSearchParams(location.search);
const HEIGHT = Number(params.get("height") ?? "1.55");   // engine STAND_HEIGHT
const PITCH = Number(params.get("pitch") ?? "1.2");
const DIST = Number(params.get("dist") ?? "6.0");
const CLIP = params.get("clip") ?? "idle";
const AT = Number(params.get("t") ?? "0.9");
const AMBIENT = Number(params.get("ambient") ?? "1.0");
const RULER = params.get("ruler") === "1";
document.getElementById("title").textContent = params.get("title") ?? "";
const SUBJECTS = (params.get("rigs") ?? "").split(",").filter(Boolean).map((entry) => {
  const [url, label, tint] = entry.split("|");
  return { url, label: label || url, tint: tint || null };
});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(AMBIENT < 0.2 ? "#05070a" : "#8c9db1");
// AMBIENT is the whole experiment: at 1.0 this is the asset-sheet rig, at 0.02 it
// is the unlit scene the owner is looking at. Nothing else changes between rows.
scene.add(new THREE.HemisphereLight("#cddcf0", "#3c3a34", 1.35 * AMBIENT));
const sun = new THREE.DirectionalLight(0xffffff, 1.5 * AMBIENT);
sun.position.set(18, 26, 12);
scene.add(sun);

const span = PITCH * Math.max(1, SUBJECTS.length - 1);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(span + 10, 12),
  new THREE.MeshStandardMaterial({ color: "#6f6a5e", roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.004;
scene.add(ground);

// A metre rule behind the row, so a height claim is readable off the picture
// instead of taken on trust. Unlit lines so they survive the dark rows.
if (RULER) {
  for (let i = 0; i <= 4; i++) {
    const y = i * 0.5;
    const major = i % 2 === 0;
    const points = [new THREE.Vector3(-span / 2 - 1.2, y, -0.9),
                    new THREE.Vector3(span / 2 + 1.2, y, -0.9)];
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: major ? 0xffcf6a : 0x50627a }),
    ));
  }
}

const LOOK = params.get("look") ? Number(params.get("look")) : HEIGHT * 0.55;
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
  // Exactly what RiggedCharacter.tsx does on load, including the fact that it
  // touches .color and never .emissive - which is why an emissive rig ignores its
  // crowd tint. Reproduced rather than corrected so the shot shows the real thing.
  let emissiveWatts = 0;
  const flags = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const next = list.map((material) => {
      const copy = material.clone();
      if (tint && copy.color) copy.color.multiply(tint);
      copy.side = THREE.DoubleSide;
      copy.depthWrite = true;
      copy.needsUpdate = true;
      if (copy.emissive) {
        const e = copy.emissive;
        emissiveWatts = Math.max(emissiveWatts, Math.max(e.r, e.g, e.b) * (copy.emissiveIntensity ?? 1));
        if (copy.emissiveMap) flags.add("emissiveMap");
      }
      flags.add("metal" + (copy.metalness ?? "?") + "/rough" + (copy.roughness ?? "?"));
      return copy;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });

  const natural = fit(root, HEIGHT);
  root.position.x = -span / 2 + index * PITCH;
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
    const bones = [];
    root.traverse((o) => { if (o.isBone) bones.push(o); });
    const tracked = bones.length > 0 ? bones : [root];
    const spans = tracked.map(() => ({
      min: new THREE.Vector3(Infinity, Infinity, Infinity),
      max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
    }));
    const sample = new THREE.Vector3();
    for (let step = 0; step <= 24; step++) {
      mixer.setTime((clip.duration * step) / 24);
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

  // Measured off the rendered frame, not inferred: the mean luminance of the
  // pixels this subject occupies. That is what "glows" means operationally.
  report.push({
    label: subject.label,
    clips: names.length,
    played: wanted ?? null,
    naturalHeight: Number(natural.toFixed(4)),
    fittedHeight: HEIGHT,
    emissiveWatts: Number(emissiveWatts.toFixed(3)),
    flags: [...flags].sort().join(" "),
    probeBone,
    motion: motion ? [motion.x, motion.y, motion.z].map((v) => Number(v.toFixed(4))) : null,
  });
}

renderer.render(scene, camera);

// Read the frame back off the GPU and measure it.
//
// MEAN luminance is the wrong statistic and measuring it first was a mistake: the
// bodies occupy a few per cent of the frame, so a cast that is glowing at full
// albedo against a black scene moves the mean from 6.6 to only 10.7 - a real 1.6x
// that badly understates what the eye sees. What the owner is describing is
// CONTRAST: a small number of pixels far brighter than everything around them. So
// the reported statistics are the brightest percentile and the share of pixels that
// stand clear of the background, and the mean is kept only for context.
const gl = renderer.getContext();
const w = gl.drawingBufferWidth;
const h = gl.drawingBufferHeight;
const pixels = new Uint8Array(w * h * 4);
gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
const histogram = new Uint32Array(256);
let sum = 0;
for (let i = 0; i < pixels.length; i += 4) {
  const l = Math.min(
    255,
    Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]),
  );
  histogram[l]++;
  sum += l;
}
const total = w * h;
const percentile = (fraction) => {
  let seen = 0;
  for (let l = 0; l < 256; l++) {
    seen += histogram[l];
    if (seen >= total * fraction) return l;
  }
  return 255;
};
// 40 is comfortably above the dark rows' background (#05070a, luma ~6) and far
// below a lit body, so this share is "how much of the screen is a glowing object".
let aboveBackground = 0;
for (let l = 40; l < 256; l++) aboveBackground += histogram[l];
window.__frameLuma = Number((sum / total).toFixed(2));
window.__frameP99 = percentile(0.99);
window.__frameP999 = percentile(0.999);
window.__frameLitShare = Number((aboveBackground / total).toFixed(5));

document.getElementById("label").textContent = report
  .map((row) =>
    row.label.padEnd(26) +
    " clips=" + String(row.clips).padStart(2) +
    " " + String(row.played).padEnd(9) +
    " natural=" + String(row.naturalHeight).padEnd(7) + "m" +
    " emissive=" + String(row.emissiveWatts).padEnd(5) +
    " travel=" + (row.motion ? row.motion.join("/") + "m" : "NONE") +
    " " + row.flags)
  .join("\\n") + "\\n" + "frame: mean luma=" + window.__frameLuma +
  "  p99=" + window.__frameP99 + "  p99.9=" + window.__frameP999 +
  "  pixels brighter than luma 40=" + (window.__frameLitShare * 100).toFixed(3) + "%";

window.__cast = report;
window.__castReady = true;
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
const page = await browser.newPage({ viewport: { width: 1600, height: 820 } });
page.on("pageerror", (error) => console.log("  pageerror:", String(error).slice(0, 300)));
page.on("console", (message) => {
  if (message.type() === "error") console.log("  console.error:", message.text().slice(0, 300));
});

// Everything is served off disk. No dev server, and nothing is written into the
// published tree, so no run of this script can promote or stage an asset.
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  const path = decodeURIComponent(url.pathname);
  if (path === "/harness.html") {
    return route.fulfill({ contentType: MIME[".html"], body: HARNESS });
  }
  let file = null;
  if (path.startsWith("/node_modules/")) {
    file = join(WEB_MODULES, path.slice("/node_modules/".length));
  } else if (path.startsWith("/before/")) {
    file = join(ROLLBACK, `${path.slice("/before/".length)}-rigged.PRE-EMISSIVE-FIX.glb`);
  } else if (path.startsWith("/after/")) {
    file = join(PUBLISHED, `${path.slice("/after/".length)}-rigged.glb`);
  }
  if (!file || !existsSync(file)) {
    return route.fulfill({ status: 404, body: `no such file: ${path}` });
  }
  return route.fulfill({
    contentType: MIME[extname(file)] ?? "application/octet-stream",
    body: readFileSync(file),
  });
});

function query(rigs, extra) {
  const params = new URLSearchParams({ rigs: rigs.map((parts) => parts.join("|")).join(",") });
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  return params.toString();
}

// M1's crowd tints, so "the tint now actually applies" is visible in the same shot.
const TINTS = ["#9a8b74", "#8d7c63", "#6f6552", "#7d8a72", "#8a7f6b", "#75695a", "#8f8574"];
const beforeRow = FIXED.map((r, i) => [`/before/${r}`, r, TINTS[i] ?? "#8d7c63"]);
const afterRow = FIXED.map((r, i) => [`/after/${r}`, r, TINTS[i] ?? "#8d7c63"]);

const DARK = { ambient: 0.02, pitch: 1.15, dist: 7.2 };
const LIT = { ambient: 1.0, pitch: 1.15, dist: 7.2 };

const SHOTS = [
  ["01-emissive-BEFORE-dark", query(beforeRow, {
    ...DARK, clip: "idle",
    title: "BEFORE - unlit scene (ambient 0.02): seven rigs glow at full albedo",
  })],
  ["02-emissive-AFTER-dark", query(afterRow, {
    ...DARK, clip: "idle",
    title: "AFTER - same unlit scene, same camera: the cast is lit by the scene, not by itself",
  })],
  ["03-emissive-BEFORE-lit", query(beforeRow, {
    ...LIT, clip: "idle", title: "BEFORE - fully lit (ambient 1.0): the defect is invisible here",
  })],
  ["04-emissive-AFTER-lit", query(afterRow, {
    ...LIT, clip: "idle",
    title: "AFTER - fully lit: still correct, and the crowd tints now apply",
  })],
  ["05-officer-ruler", query([
    ["/after/playerboy", "playerboy 1.55m RULER"],
    ["/after/officer", "officer BOSS"],
    ["/after/constable", "constable"],
  ], { ambient: 1.0, pitch: 1.0, dist: 5.0, ruler: 1, clip: "idle",
       title: "Officer scale: fitted to STAND_HEIGHT beside the 1.55m player. Rules at 0.5m." })],
  ["06-officer-duel-clips", query([
    ["/after/officer", "officer fire"],
    ["/after/playerboy", "playerboy 1.55m"],
  ], { ambient: 1.0, pitch: 1.0, dist: 4.2, ruler: 1, clip: "fire", t: 0.6,
       title: "Officer duel clip 'fire' at t=0.6s, beside the player ruler" })],
];

let failures = 0;
const luma = {};
for (const [name, q] of SHOTS) {
  await page.goto(`${ORIGIN}/harness.html?${q}`, { waitUntil: "load" });
  const ok = await page
    .waitForFunction("window.__castReady === true", { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    console.log(`SKIP  ${name} (harness did not finish loading)`);
    failures++;
    continue;
  }
  await page.waitForTimeout(250);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  const report = await page.evaluate("window.__cast");
  luma[name] = {
    luma: await page.evaluate("window.__frameLuma"),
    p99: await page.evaluate("window.__frameP99"),
    p999: await page.evaluate("window.__frameP999"),
    litShare: await page.evaluate("window.__frameLitShare"),
  };
  console.log(
    `WROTE ${path}   mean=${luma[name].luma} p99=${luma[name].p99} p99.9=${luma[name].p999} ` +
      `lit=${(luma[name].litShare * 100).toFixed(3)}%`,
  );
  for (const row of report) {
    const dead = row.motion && row.motion.every((v) => v < 0.0005);
    console.log(
      `   ${row.label.padEnd(24)} clips=${String(row.clips).padStart(2)} ` +
        `playing=${String(row.played).padEnd(10)} natural=${String(row.naturalHeight).padEnd(8)}m ` +
        `emissive=${String(row.emissiveWatts).padEnd(5)} ` +
        `travel=${row.motion ? row.motion.join("/") + "m" : "NONE"}${dead ? "  <-- STATIC" : ""} ` +
        `${row.flags}`,
    );
    if (!row.motion || dead) failures++;
  }
}

// The claim under test, stated as a measurement: in a dark scene the fixed cast
// must be dramatically dimmer than the broken one, and in a lit scene the two
// should be comparable.
const darkBefore = luma["01-emissive-BEFORE-dark"];
const darkAfter = luma["02-emissive-AFTER-dark"];
if (darkBefore && darkAfter) {
  const litDrop = darkBefore.litShare / Math.max(darkAfter.litShare, 1e-5);
  console.log(
    `\nunlit scene (ambient 0.02), same camera and geometry both sides:` +
      `\n  pixels brighter than luma 40:  ${(darkBefore.litShare * 100).toFixed(3)}% -> ` +
      `${(darkAfter.litShare * 100).toFixed(3)}%   (${litDrop.toFixed(0)}x less glowing surface)` +
      `\n  brightest percentile (p99):    ${darkBefore.p99} -> ${darkAfter.p99}` +
      `\n  p99.9:                         ${darkBefore.p999} -> ${darkAfter.p999}` +
      `\n  mean (diluted by background):  ${darkBefore.luma} -> ${darkAfter.luma}`,
  );
  const lit = luma["04-emissive-AFTER-lit"];
  if (lit) {
    console.log(
      `  and when the scene IS lit the fixed cast still reads normally: ` +
        `p99=${lit.p99}, lit share ${(lit.litShare * 100).toFixed(3)}%`,
    );
  }
  // In a dark scene a correct rig must not be a light source. Both statistics have
  // to move, so a change in one alone cannot pass this.
  if (!(litDrop > 5 && darkAfter.p99 < darkBefore.p99 / 2)) {
    console.log("FAIL the cast is still self-lit in a dark scene");
    failures++;
  }
}

await browser.close();
console.log(failures === 0 ? "\nALL SHOTS OK" : `\n${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
