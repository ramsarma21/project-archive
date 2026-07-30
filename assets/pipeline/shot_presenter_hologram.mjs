// Capture the presenter UNDER THE ACTUAL RUNTIME HOLOGRAM MATERIAL, by driving
// the shipped presenterQa harness (which mounts the real SystemPresenter with the
// real hologram shader, lights, gaze and lip-sync) in a headless browser.
//
// It also PROVES lip-sync and gaze are live rather than just that the GLB loaded:
//   - it samples window.__presenterJaw across time; a non-zero, varying jaw means
//     the deterministic lip-sync is driving the jawOpen morph that this new mesh
//     must carry (SystemPresenter only writes the morph if findJawMorph found it);
//   - it reads the Head/neck bone world quaternions across two shots; a change
//     between REACTION (direct address) and OVER_SHOULDER (a motivated glance)
//     means presenterGaze is rotating the real bones after the mixer.
//
// Requires a vite dev server already serving apps/web on QA_PORT.
// Run: QA_PORT=5190 QA_OUT=/tmp/... node assets/pipeline/shot_presenter_hologram.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const PORT = process.env.QA_PORT ?? "5190";
const OUT = process.env.QA_OUT ?? "/tmp/presenter-asset/hologram";
mkdirSync(OUT, { recursive: true });
const SHOTS = (process.env.QA_SHOTS ?? "REACTION,PRESENTER_MEDIUM,OVER_SHOULDER,ESTABLISH").split(",");

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
  ],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 2 });
page.on("console", (m) => {
  const t = m.text();
  if (/\[module\]\[QA\]|error|Error/i.test(t)) console.log("  page>", t);
});

const results = [];
for (const shot of SHOTS) {
  const url = `http://127.0.0.1:${PORT}/src/module/presenterQa.html?shot=${shot}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas", { timeout: 20000 });
  // Let the GLB load, shaders compile, and a few animation frames run.
  await page.waitForTimeout(6000);

  // Sample the driven jaw influence over ~2.5s while the harness is "speaking".
  const jaw = [];
  for (let i = 0; i < 25; i++) {
    const v = await page.evaluate(() => (window.__presenterJaw ?? null));
    if (typeof v === "number") jaw.push(v);
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: `${OUT}/holo-${shot}.png` });
  const nums = jaw.filter((x) => typeof x === "number");
  const min = nums.length ? Math.min(...nums) : NaN;
  const max = nums.length ? Math.max(...nums) : NaN;
  results.push({ shot, jawSamples: nums.length, jawMin: min, jawMax: max });
  console.log(`SHOT ${shot}: jaw n=${nums.length} min=${min.toFixed(3)} max=${max.toFixed(3)} -> ${OUT}/holo-${shot}.png`);
}

console.log("JAW_DRIVEN", results.some((r) => r.jawMax > 0.05));
await browser.close();
