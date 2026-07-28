// Attribute the ROUTE-WINDOW program compiles (post-settle, while MOVING) to the
// exact programs that link, with the player position and frame cost at the moment
// each one appears. spike-programs.mjs records growth while stationary; this drives
// the same route spike-hunt does and records growth over the moving window, so a
// mid-route GetProgramiv is pinned to the program (depth vs beauty, and which) and
// the spot on the route it landed.
//
//   node .affordwork/spike-attrib.mjs [baseURL] [seconds] [runs]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const SECONDS = Number(process.argv[3]) || 18;
const RUNS = Number(process.argv[4]) || 4;
const OUT = new URL("./spike-attrib-out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const READ = (page) => page.evaluate(() => {
  const rt = window.__floor; if (!rt || !rt.motion) return null; const m = rt.motion;
  const req = rt.instance.objectives.filter((o) => o.required);
  const met = new Set(rt.satisfied);
  const cur = req.find((o) => !met.has(o.id)) ?? null;
  let wp = null;
  if (cur?.mark?.waypoint) { const w = cur.mark.waypoint(m.pos); if (w) wp = { x: w.pos.x, y: w.pos.y, z: w.pos.z, via: w.via }; }
  const ev = rt.encounterView;
  return { pos: { x: m.pos.x, z: m.pos.z, y: m.pos.y }, grounded: m.grounded, preview: rt.flow?.previewVerb, wp, enc: ev ? { id: ev.encounterId, phase: ev.phase } : null, encLocked: !!(rt.encounterLocked || rt.encounterOwnsInput), outcome: rt.outcome?.kind ?? null };
}).catch(() => null);

async function aim(page, wp, pos) {
  if (!wp) return;
  const yaw = Math.atan2(wp.x - pos.x, wp.z - pos.z);
  await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, yaw).catch(() => {});
}
async function answerEncounter(page) {
  await page.keyboard.up("KeyW").catch(() => {});
  for (let i = 0; i < 120; i++) {
    const box = await page.$("#msn-enc-input");
    const cur = await READ(page);
    if (cur?.enc?.phase === "RESOLVED" || !cur?.enc) break;
    if (box && !(await box.evaluate((el) => el.disabled).catch(() => true))) {
      await box.click().catch(() => {});
      await box.type("Lawful business; a broadside owes no stamp.", { delay: 1 }).catch(() => {});
    }
    const submit = await page.$(".msn-enc-submit"); if (submit) await submit.click().catch(() => {});
    await sleep(200);
  }
  await page.keyboard.down("KeyW").catch(() => {});
}

async function oneRun() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/src/mission/floor.html?hold=0&seed=0xb057&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
  for (let i = 0; i < 250; i++) { const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null); if (t !== null) break; await sleep(200); }
  await sleep(3000);
  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});

  // In-page recorder: capture the pre-existing program set, then over the moving
  // window record every NEW program with its cacheKey category, the frame cost it
  // landed on (diagΔ), and the player position at that moment. Runs concurrently
  // with the Node driving loop below (it yields on rAF so the driver interleaves).
  const recPromise = page.evaluate(async (nFrames) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const gl = window.__stage.gl;
    const seen = new Set();
    for (const p of gl.info.programs ?? []) seen.add(`${p.id}`);
    const growth = [];
    const catOf = (ck) => (ck ?? "").split(",")[0] || "?";
    for (let f = 0; f < nFrames; f++) {
      await raf();
      const programs = gl.info.programs ?? [];
      for (const p of programs) {
        if (!seen.has(`${p.id}`)) {
          seen.add(`${p.id}`);
          const dframes = window.__diag?.frames ?? [];
          const last = dframes[dframes.length - 1];
          const pos = window.__floor?.motion?.pos;
          growth.push({
            cat: catOf(p.cacheKey),
            name: p.name || "",
            deltaMs: last ? +last.deltaMs.toFixed(1) : null,
            pos: pos ? { x: +pos.x.toFixed(1), z: +pos.z.toFixed(1) } : null,
          });
        }
      }
    }
    return growth;
  }, SECONDS * 62);

  // Drive the route (same as spike-hunt), concurrent with the recorder.
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  const start = Date.now();
  while (Date.now() - start < SECONDS * 1000) {
    const s = await READ(page);
    if (!s) { await sleep(80); continue; }
    if (s.outcome) break;
    if (s.enc && s.enc.phase !== "RESOLVED" && s.encLocked) { await answerEncounter(page); continue; }
    await aim(page, s.wp, s.pos);
    if (s.grounded && ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH", "DASH_JUMP"].includes(s.preview)) await page.keyboard.press("Space").catch(() => {});
    await sleep(80);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});

  const growth = await recPromise;
  const frames = await page.evaluate(() => window.__diag?.frames ?? []).catch(() => []);
  await browser.close();
  return { growth, frames };
}

const allGrowth = [];
for (let r = 0; r < RUNS; r++) {
  log(`\n================ run ${r + 1}/${RUNS} ================`);
  const { growth, frames } = await oneRun();
  const spikes = frames.filter((f) => f.deltaMs > 83);
  const worst = frames.reduce((m, f) => Math.max(m, f.deltaMs), 0);
  log(`frames ${frames.length}, worst ${worst.toFixed(0)}ms, spikes>83 ${spikes.length}`);
  log(`NEW programs compiled in the moving route window: ${growth.length}`);
  for (const g of growth) {
    log(`  cat=${g.cat.padEnd(10)} name=${(g.name || "-").padEnd(14)} diagΔ=${g.deltaMs}ms  @(${g.pos?.x},${g.pos?.z})`);
  }
  allGrowth.push({ run: r + 1, growth });
}
writeFileSync(`${OUT}growth.json`, JSON.stringify(allGrowth, null, 2));

const byCat = new Map();
for (const r of allGrowth) for (const g of r.growth) byCat.set(g.cat, (byCat.get(g.cat) ?? 0) + 1);
log(`\n================ SUMMARY over ${RUNS} runs ================`);
log(`route-window compiles by category: ${[...byCat.entries()].map(([c, n]) => `${c}×${n}`).join("  ") || "(none)"}`);
log(`-> wrote ${OUT}`);
