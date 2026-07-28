// Attribute the intermittent frame spike (a ~211ms frame that drops ~10 sim
// ticks = the "random lurch") to its actual cost, with evidence.
//
// The sim is ruled out (0.04ms/tick, sim-cost.mjs), so a 211ms frame is
// render/browser: GC, shader/program compile on first sight of a material,
// texture upload, resource streaming, or a rare expensive JS task. This runs the
// real accelerated client, captures a Chrome devtools-timeline trace over the
// route via CDP, records window.__diag.frames (now carrying player position) and
// the Resource Timing entries, and reports: the spikes with WHERE on the route
// they landed, the largest trace events by duration and category (the cost), and
// any resource that finished loading mid-route (streaming).
//
// Intermittent: pass a run count; a single clean run proves nothing.
//   node .affordwork/spike-hunt.mjs [baseURL] [secondsPerRun] [runs]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const SECONDS = Number(process.argv[3]) || 75;
const RUNS = Number(process.argv[4]) || 3;
const OUT = new URL("./spike-out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const SPIKE_MS = 83; // the five-step catch-up window; over this drops sim ticks
const EVENT_MIN_US = 4000; // keep trace events >= 4ms to bound memory

const READ = (page) => page.evaluate(() => {
  const rt = window.__floor; if (!rt || !rt.motion) return null; const m = rt.motion;
  const req = rt.instance.objectives.filter((o) => o.required);
  const met = new Set(rt.satisfied);
  const cur = req.find((o) => !met.has(o.id)) ?? null;
  let wp = null;
  if (cur?.mark?.waypoint) { const w = cur.mark.waypoint(m.pos); if (w) wp = { x: w.pos.x, y: w.pos.y, z: w.pos.z, via: w.via }; }
  const ev = rt.encounterView;
  return { pos: { x: m.pos.x, z: m.pos.z, y: m.pos.y }, grounded: m.grounded, preview: rt.flow?.previewVerb, wp, enc: ev ? { id: ev.encounterId, phase: ev.phase } : null, encLocked: !!(rt.encounterLocked || rt.encounterOwnsInput), outcome: rt.outcome?.kind ?? null, civ: rt.civilians?.length ?? 0 };
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

async function oneRun(runIdx) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const client = await page.context().newCDPSession(page);
  const events = [];
  client.on("Tracing.dataCollected", (d) => {
    for (const e of d.value) {
      if (e.ph === "X" && typeof e.dur === "number" && e.dur >= EVENT_MIN_US) {
        events.push({ name: e.name, cat: e.cat, dur: e.dur, ts: e.ts });
      }
    }
  });

  await page.goto(`${BASE}/src/mission/floor.html?hold=0&seed=0xb057&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
  for (let i = 0; i < 250; i++) { const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null); if (t !== null) break; await sleep(200); }
  await sleep(3000);
  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});
  const resetMs = await page.evaluate(() => performance.now()).catch(() => 0);

  await client.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline,v8,gpu,blink.user_timing",
    transferMode: "ReportEvents",
    bufferUsageReportingInterval: 1000,
  });

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

  await client.send("Tracing.end");
  await new Promise((r) => client.once("Tracing.tracingComplete", r));

  const frames = await page.evaluate(() => window.__diag?.frames ?? []).catch(() => []);
  const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => ({
    name: r.name.split("/").slice(-1)[0].slice(0, 40) + (r.name.startsWith("blob:") ? " (blob)" : ""),
    end: r.responseEnd, dur: r.duration, size: r.transferSize || r.encodedBodySize || 0,
  }))).catch(() => []);
  await browser.close();
  return { frames, resources, events, resetMs };
}

const allSpikes = [];
const eventTotals = new Map(); // name -> {sumUs, count, maxUs}
let framesTotal = 0;
const midRouteResources = [];

for (let r = 0; r < RUNS; r++) {
  log(`\n--- run ${r + 1}/${RUNS} ---`);
  const { frames, resources, events, resetMs } = await oneRun(r);
  framesTotal += frames.length;
  const spikes = frames.filter((f) => f.deltaMs > SPIKE_MS);
  for (const s of spikes) allSpikes.push({ run: r + 1, ...s });
  log(`frames ${frames.length}, spikes(>${SPIKE_MS}ms) ${spikes.length}: ${spikes.map((s) => `${s.deltaMs.toFixed(0)}ms@(${s.pos.x.toFixed(0)},${s.pos.z.toFixed(0)})drop${s.droppedThisFrame}`).join("  ")}`);
  // Biggest trace events this run.
  events.sort((a, b) => b.dur - a.dur);
  log(`top trace events: ${events.slice(0, 6).map((e) => `${e.name} ${(e.dur / 1000).toFixed(0)}ms`).join(" | ")}`);
  for (const e of events) {
    const cur = eventTotals.get(e.name) ?? { sumUs: 0, count: 0, maxUs: 0 };
    cur.sumUs += e.dur; cur.count += 1; cur.maxUs = Math.max(cur.maxUs, e.dur);
    eventTotals.set(e.name, cur);
  }
  // Resources that finished loading mid-route (after the settle/reset) — streaming.
  for (const res of resources) {
    if (res.end > resetMs + 200 && (res.dur > 5 || res.size > 20000)) {
      midRouteResources.push({ run: r + 1, ...res, afterResetMs: +(res.end - resetMs).toFixed(0) });
    }
  }
}

writeFileSync(`${OUT}spikes.json`, JSON.stringify(allSpikes, null, 2));
writeFileSync(`${OUT}events.json`, JSON.stringify([...eventTotals.entries()].map(([name, v]) => ({ name, ...v })), null, 2));
writeFileSync(`${OUT}mid-route-resources.json`, JSON.stringify(midRouteResources, null, 2));

log(`\n================ SUMMARY over ${RUNS} runs, ${framesTotal} frames ================`);
log(`spikes >${SPIKE_MS}ms: ${allSpikes.length}  (${((allSpikes.length / framesTotal) * 100).toFixed(2)}% of frames)`);
if (allSpikes.length) {
  log(`spike sizes: ${allSpikes.map((s) => s.deltaMs.toFixed(0)).sort((a, b) => b - a).join(", ")}ms`);
  // Cluster spikes by rounded location.
  const byLoc = new Map();
  for (const s of allSpikes) { const k = `(${Math.round(s.pos.x / 5) * 5},${Math.round(s.pos.z / 5) * 5})`; byLoc.set(k, (byLoc.get(k) ?? 0) + 1); }
  log(`spike locations (x,z rounded to 5m): ${[...byLoc.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}×${n}`).join("  ")}`);
}
log(`\ntrace events by total time (the cost of the stalls):`);
const ranked = [...eventTotals.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.maxUs - a.maxUs);
for (const e of ranked.slice(0, 12)) {
  log(`  ${e.name.padEnd(28)} max ${(e.maxUs / 1000).toFixed(0)}ms  total ${(e.sumUs / 1000).toFixed(0)}ms  ×${e.count}`);
}
log(`\nresources finishing MID-ROUTE (streaming, top by size):`);
midRouteResources.sort((a, b) => b.size - a.size);
for (const res of midRouteResources.slice(0, 12)) {
  log(`  +${res.afterResetMs}ms  ${res.name}  ${(res.size / 1024).toFixed(0)}KB  ${res.dur.toFixed(0)}ms`);
}
if (midRouteResources.length === 0) log("  (none — all resources loaded before the route started)");
log(`\n-> wrote ${OUT}`);
