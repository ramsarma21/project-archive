// Before/after QA frames of the Liberty Elm from the player's eye — the ONLY
// instrument that can settle a purely-visual defect ("smeared column under
// shattered green planes"). A companion to the numeric affordance gate: the gate
// proves the play surface is intact, these prove the tree reads as a tree.
//
// The scene is pre-dawn (ambient 0.34), which is too dark to judge geometry, so
// the capture EXPLICITLY brightens it — tone-mapping exposure raised and every
// scene light boosted — exactly as a prior elm capture did. This is a
// capture-time lighting change, declared here, and changes nothing in the
// mission. Each frame's mean luminance is printed so an illegible (too-dark)
// frame is caught as a number, not shipped as a caption.
//
//   node assets/pipeline/shot_liberty_elm_qa.mjs --port 5291 --out .affordwork/elm-rebuild/before
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import zlib from "node:zlib";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = arg("--port", "5291");
const OUT = resolve(arg("--out", ".affordwork/elm-rebuild/shots"));
mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${PORT}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Make pre-dawn geometry legible. The mission re-asserts its exposure and light
// intensities every frame, so scaling them is undone before the screenshot. What
// DOES persist is a light we ADD ourselves: clone an existing light, turn it into
// a bright fill the mission does not manage, and drop it on the scene. This is a
// capture-time lighting change, declared, and touches nothing in the mission.
const BRIGHTEN = () => {
  const st = window.__stage;
  if (!st?.gl) return "no stage";
  st.gl.toneMappingExposure = 4.2;
  let seed = null;
  st.scene.traverse((o) => { if (o.isLight && !o.__qaFill && !seed) seed = o; o && o.isLight && (o.intensity *= 3); });
  if (!seed) return "no light to clone";
  // A hemisphere-ish fill from straight overhead, so the under-canopy crown and
  // the boughs are lit even where the dawn key does not reach.
  const fill = seed.clone();
  fill.__qaFill = true;
  fill.castShadow = false;
  fill.color && fill.color.setRGB(1, 0.96, 0.9);
  fill.intensity = 6.0;
  if (fill.position) fill.position.set(st.scene.position.x, 60, st.scene.position.z);
  if (fill.target && fill.target.position) fill.target.position.set(0, 0, 0);
  st.scene.add(fill);
  // A second fill from the camera side, so vertical bark and the trunk read.
  const key = seed.clone();
  key.__qaFill = true;
  key.castShadow = false;
  key.intensity = 5.0;
  if (key.position) key.position.set(120, 40, 40);
  st.scene.add(key);
  return `exposure=4.2 addedFills=2`;
};

async function boot(page, url) {
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  for (let i = 0; i < 300; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) return true;
    await sleep(200);
  }
  return false;
}

// The four canonical positions the task asks for: the base, the street (east),
// the east crowd edge, and standing on the crown bough.
const SHOTS = [
  ["A-base-close",  "F_STALL_BACK", [80.15, 0.8]],
  ["B-from-east",   "F_CROWD_E",    [80.15, 0.8]],
  ["C-from-street", "F_VAULT_OUT",  [80.15, 0.8]],
  ["D-from-crown",  "F_CROWN_E",    [80.15, 0.8]],
];

// Mean luminance of the frame, decoded straight from the PNG (Rec.709), so
// "legible" is a printed number rather than a claim.
function meanLuma(pngPath) {
  const buf = readFileSync(pngPath);
  // Minimal PNG decode via zlib on the IDAT stream.
  let w = 0, h = 0, bitDepth = 0, colorType = 0, cursor = 8;
  const idat = [];
  while (cursor + 8 <= buf.length) {
    const len = buf.readUInt32BE(cursor);
    const type = buf.toString("latin1", cursor + 4, cursor + 8);
    if (type === "IHDR") {
      w = buf.readUInt32BE(cursor + 8); h = buf.readUInt32BE(cursor + 12);
      bitDepth = buf[cursor + 16]; colorType = buf[cursor + 17];
    } else if (type === "IDAT") idat.push(buf.subarray(cursor + 8, cursor + 8 + len));
    else if (type === "IEND") break;
    cursor += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) return null;
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  let prev = Buffer.alloc(stride);
  let line = Buffer.alloc(stride);
  let sum = 0, n = 0, c = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[c++];
    raw.copy(line, 0, c, c + stride); c += stride;
    if (f === 1) for (let i = ch; i < stride; i++) line[i] = (line[i] + line[i - ch]) & 0xff;
    else if (f === 2) for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 0xff;
    else if (f === 3) for (let i = 0; i < stride; i++) { const l = i >= ch ? line[i - ch] : 0; line[i] = (line[i] + ((l + prev[i]) >> 1)) & 0xff; }
    else if (f === 4) for (let i = 0; i < stride; i++) { const l = i >= ch ? line[i - ch] : 0; const u = prev[i]; const ul = i >= ch ? prev[i - ch] : 0; const p = l + u - ul; const pa = Math.abs(p - l), pb = Math.abs(p - u), pc = Math.abs(p - ul); const nb = pa <= pb && pa <= pc ? l : pb <= pc ? u : ul; line[i] = (line[i] + nb) & 0xff; }
    for (let x = 0; x < stride; x += ch) { sum += 0.2126 * line[x] + 0.7152 * line[x + 1] + 0.0722 * line[x + 2]; n++; }
    const t = prev; prev = line; line = t;
  }
  return n ? sum / n / 255 : null;
}

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const results = [];
for (const [label, at, target] of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const url = `${BASE}/src/mission/floor.html?at=${at}&toward=F_POST&encounterVerdict=correct`;
  if (!(await boot(page, url))) { console.log(`${label}: runtime never came up`); await page.close(); continue; }
  await sleep(7000);
  const b = await page.evaluate(BRIGHTEN);
  const pos = await page.evaluate(() => { const m = window.__floor.motion.pos; return { x: m.x, z: m.z }; });
  await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, Math.atan2(target[0] - pos.x, target[1] - pos.z));
  await sleep(500);
  const file = join(OUT, `${label}.png`);
  await page.screenshot({ path: file });
  const luma = meanLuma(file);
  results.push({ label, luma });
  console.log(`${label}: ${b}  playerPos=(${pos.x.toFixed(1)},${pos.z.toFixed(1)})  meanLuma=${luma === null ? "?" : luma.toFixed(3)} ${luma !== null && luma < 0.12 ? "TOO DARK" : "legible"}`);
  await page.close();
}
await browser.close();
console.log("done ->", OUT);
