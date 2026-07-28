// One command to answer "do the random slowdowns survive on MY machine?".
//
// The slow motion is dropped fixed steps: when a render frame takes longer than
// the five-step catch-up window (~83ms), advanceFieldClock runs 5 ticks and
// DISCARDS the rest, so sim time advances slower than wall time. Whether that
// happens is a question about the GPU frame cost on the real machine — the sim
// itself costs ~0.04ms/tick (see .affordwork/sim-cost.mjs), nowhere near the
// budget. Headless SwiftShader renders on the CPU and always blows the window,
// so it CANNOT answer this; this driver launches the owner's REAL Chrome with
// hardware acceleration, plays a route, and reads the in-game black box
// (window.__diag.frames) to print the dropped-step count and effective time
// scale. Run it on the machine where the slowdowns are felt.
//
//   node .affordwork/owner-frame-trace.mjs [baseURL] [seconds] [--headless]
//
// With no baseURL it starts the app itself on :5273. --headless uses new headless
// WITH the GPU (still representative on a machine that has one); omit it to watch.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const argv = process.argv.slice(2);
const headless = argv.includes("--headless");
const positional = argv.filter((a) => !a.startsWith("--"));
const BASE = positional[0] ?? "http://localhost:5273";
const SECONDS = Number(positional[1]) || 60;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "apps", "web");

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

// Start the worktree app if the base URL is not already serving.
let devServer = null;
if (!(await reachable(BASE))) {
  log(`starting the app (no server at ${BASE}) ...`);
  devServer = spawn(
    process.execPath,
    [join(webDir, "node_modules", "vite", "bin", "vite.js"), "--port", "5273", "--strictPort"],
    { cwd: webDir, stdio: "ignore" },
  );
  for (let i = 0; i < 60; i++) { if (await reachable(BASE)) break; await sleep(500); }
  if (!(await reachable(BASE))) { log("could not start the app"); process.exit(1); }
}

// The owner's real Chrome with hardware acceleration — NOT SwiftShader, so the
// frame cost is the GPU's, which is the whole point.
const browser = await chromium.launch({
  headless,
  executablePath: CHROME,
  args: headless
    ? ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
    : ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function waitRuntime() {
  for (let i = 0; i < 250; i++) {
    const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
    if (t !== null) return true;
    await sleep(200);
  }
  return false;
}
const READ = () => page.evaluate(() => {
  const rt = window.__floor; if (!rt || !rt.motion) return null; const m = rt.motion;
  const req = rt.instance.objectives.filter((o) => o.required);
  const met = new Set(rt.satisfied);
  const cur = req.find((o) => !met.has(o.id)) ?? null;
  let wp = null;
  if (cur?.mark?.waypoint) { const w = cur.mark.waypoint(m.pos); if (w) wp = { x: w.pos.x, y: w.pos.y, z: w.pos.z }; }
  const ev = rt.encounterView;
  return { pos: { x: m.pos.x, z: m.pos.z, y: m.pos.y }, grounded: m.grounded, preview: rt.flow?.previewVerb, wp, enc: ev ? { id: ev.encounterId, phase: ev.phase } : null, encLocked: !!(rt.encounterLocked || rt.encounterOwnsInput), outcome: rt.outcome?.kind ?? null };
}).catch(() => null);
async function aim(wp, pos) {
  if (!wp) return;
  const yaw = Math.atan2(wp.x - pos.x, wp.z - pos.z);
  await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, yaw).catch(() => {});
}
async function answerEncounter() {
  await page.keyboard.up("KeyW").catch(() => {});
  for (let i = 0; i < 120; i++) {
    const box = await page.$("#msn-enc-input");
    const cur = await READ();
    if (cur?.enc?.phase === "RESOLVED" || !cur?.enc) break;
    if (box && !(await box.evaluate((el) => el.disabled).catch(() => true))) {
      await box.click().catch(() => {});
      await box.type("Lawful business; a broadside owes no stamp.", { delay: 1 }).catch(() => {});
      const submit = await page.$(".msn-enc-submit"); if (submit) await submit.click().catch(() => {});
    }
    const btn = await page.$(".msn-enc-submit"); if (btn) await btn.click().catch(() => {});
    await sleep(200);
  }
  await page.keyboard.down("KeyW").catch(() => {});
}

log(`route run: ${BASE} for ${SECONDS}s (${headless ? "headless+GPU" : "headed"}) ...`);
await page.goto(`${BASE}/src/mission/floor.html?hold=0&seed=0xb057&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
if (!(await waitRuntime())) { log("runtime never came up"); await browser.close(); if (devServer) devServer.kill(); process.exit(1); }
await sleep(3000);
await page.mouse.click(640, 400).catch(() => {});
await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});
await page.keyboard.down("ShiftLeft");
await page.keyboard.down("KeyW");
const start = Date.now();
while (Date.now() - start < SECONDS * 1000) {
  const s = await READ();
  if (!s) { await sleep(80); continue; }
  if (s.outcome) break;
  if (s.enc && s.enc.phase !== "RESOLVED" && s.encLocked) { await answerEncounter(); continue; }
  await aim(s.wp, s.pos);
  if (s.grounded && ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH", "DASH_JUMP"].includes(s.preview)) {
    await page.keyboard.press("Space").catch(() => {});
  }
  await sleep(80);
}
await page.keyboard.up("KeyW").catch(() => {});
await page.keyboard.up("ShiftLeft").catch(() => {});

const frames = await page.evaluate(() => window.__diag?.frames ?? []).catch(() => []);
await browser.close();
if (devServer) devServer.kill();

if (!frames.length) { log("no frames captured (is this a dev build with the diag hook?)"); process.exit(1); }
const dl = frames.map((f) => f.deltaMs).sort((a, b) => a - b);
const pct = (p) => dl[Math.min(dl.length - 1, Math.floor(dl.length * p))];
const droppedFrames = frames.filter((f) => f.droppedThisFrame > 0).length;
// In-window drops only — the sum across the recorded frames. droppedTotal is
// cumulative since page load (it includes the GLB-load settle before the trace
// was reset), so it is not the gameplay number and must not drive the verdict.
const inWindowDropped = frames.reduce((a, f) => a + Math.max(0, f.droppedThisFrame), 0);
const slowTs = frames.filter((f) => f.timeScale < 0.999).length;
const budget = 1000 / 60;
const window5 = budget * 5;
log("\n================ FRAME TRACE ================");
log(`frames captured: ${frames.length}`);
log(`frame ms:  p50 ${pct(0.5).toFixed(1)}  p95 ${pct(0.95).toFixed(1)}  p99 ${pct(0.99).toFixed(1)}  max ${dl[dl.length - 1].toFixed(1)}`);
log(`60Hz budget ${budget.toFixed(1)}ms/tick; five-step catch-up window ${window5.toFixed(0)}ms (a frame longer than this DROPS sim steps = slow motion)`);
log(`frames over the ${window5.toFixed(0)}ms window: ${dl.filter((x) => x > window5).length}/${frames.length}`);
log(`gameplay frames that dropped sim steps: ${droppedFrames}/${frames.length}`);
log(`gameplay sim ticks discarded (slow motion): ${inWindowDropped}`);
log(`frames with timeScale<1 (reflex slow-mo, deliberate): ${slowTs}`);
log("\nVERDICT:");
if (inWindowDropped === 0 && pct(0.95) <= window5) {
  log("  Zero sim ticks discarded during play and no frame over the catch-up window:");
  log("  the slow motion does NOT reproduce on this machine at this route.");
} else if (inWindowDropped > 0) {
  log(`  ${inWindowDropped} sim ticks DISCARDED across ${droppedFrames} long frames during play — this IS the slow motion.`);
  log(`  It is RENDER-bound (the sim costs ~0.04ms/tick, .affordwork/sim-cost.mjs): profile the`);
  log(`  frames over ${window5.toFixed(0)}ms in Chrome's performance panel; they are GPU/draw cost, not the solver.`);
} else {
  log(`  No sim ticks discarded, but p95 frame (${pct(0.95).toFixed(1)}ms) is elevated — headroom is thin. Watch the max-frame outliers.`);
}
