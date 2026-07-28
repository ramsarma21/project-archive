// Measure a full driven mission run: time to REACHED_DUEL, objective progress,
// encounters (arm->resolve), max stall, and penetration (strict vs invariant).
import { chromium } from "playwright";
const BASE = process.argv[2] ?? "http://localhost:5373";
const CAP_S = Number(process.argv[3]) || 220;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JUMP = ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH", "DASH_JUMP"];

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const perr = []; page.on("pageerror", (e) => perr.push(String(e).slice(0, 160)));

const READ = () => page.evaluate(() => {
  const rt = window.__floor; if (!rt || !rt.motion) return null; const m = rt.motion;
  const req = rt.instance.objectives.filter((o) => o.required);
  const met = new Set(rt.satisfied);
  const cur = req.find((o) => !met.has(o.id)) ?? null;
  let wp = null;
  if (cur?.mark?.waypoint) { const w = cur.mark.waypoint(m.pos); if (w) wp = { x: w.pos.x, y: w.pos.y, z: w.pos.z }; }
  const ev = rt.encounterView;
  return {
    pos: { x: m.pos.x, y: m.pos.y, z: m.pos.z }, grounded: m.grounded,
    preview: rt.flow?.previewVerb, wp,
    beat: rt.beat ? rt.beat.phase : null,
    reqTotal: req.length, satisfied: [...rt.satisfied],
    enc: ev ? { id: ev.encounterId, phase: ev.phase } : null,
    encLocked: !!(rt.encounterLocked || rt.encounterOwnsInput),
    encPhases: rt.encounters.map((e) => ({ id: e.def?.id ?? e.id ?? "?", phase: e.phase })),
    outcome: rt.outcome ? { kind: rt.outcome.kind, code: rt.outcome.failure?.code ?? null } : null,
  };
}).catch(() => null);

async function aim(wp, pos) { if (!wp) return; const yaw = Math.atan2(wp.x - pos.x, wp.z - pos.z); await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, yaw).catch(() => {}); }
async function answer() {
  await page.keyboard.up("KeyW").catch(() => {});
  for (let i = 0; i < 120; i++) {
    const cur = await READ(); if (!cur?.enc || cur.enc.phase === "RESOLVED") break;
    const box = await page.$("#msn-enc-input");
    if (box && !(await box.evaluate((el) => el.disabled).catch(() => true))) {
      await box.click().catch(() => {});
      await box.fill("Lawful business; the stamp is Parliament's, and I carry cleared paper.").catch(() => {});
    }
    const btn = await page.$(".msn-enc-submit"); if (btn) await btn.click().catch(() => {});
    await sleep(180);
  }
  await page.keyboard.down("KeyW").catch(() => {});
}

await page.goto(`${BASE}/src/mission/floor.html?hold=0&seed=0xb057&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
for (let i = 0; i < 250; i++) { const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null); if (t !== null) break; await sleep(200); }
await sleep(4000);
await page.mouse.click(640, 400).catch(() => {});
await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});
await page.keyboard.down("ShiftLeft"); await page.keyboard.down("KeyW");

const start = Date.now();
let prev = null, stall = 0, maxStall = 0, stuckAt = null;
const encSeen = new Map(); // id -> Set of phases
let lastLogT = -5;
let outcome = null;
while ((Date.now() - start) / 1000 < CAP_S) {
  const s = await READ();
  if (!s) { await sleep(80); continue; }
  for (const e of s.encPhases) { if (!encSeen.has(e.id)) encSeen.set(e.id, new Set()); encSeen.get(e.id).add(e.phase); }
  if (s.outcome) { outcome = s.outcome; break; }
  if (s.enc && s.enc.phase !== "RESOLVED" && s.encLocked) { await answer(); prev = null; continue; }
  // Posting beat: tap F during the ACTIVE reaction window (keyboard auto-strikes the lit cell).
  if (s.beat === "ACTIVE" || s.beat === "STANCE") { await page.keyboard.press("KeyF").catch(() => {}); }
  await aim(s.wp, s.pos);
  if (s.grounded && JUMP.includes(s.preview)) await page.keyboard.press("Space").catch(() => {});
  // Unstick: if braking at an edge with forward intent, hop/drop off it.
  if (s.grounded && stall > 1.5) { await page.keyboard.press("Space").catch(() => {}); }
  // stall (only when free-running, not in encounter)
  if (prev && !s.encLocked && s.beat === null) { const moved = Math.hypot(s.pos.x - prev.x, s.pos.z - prev.z); if (moved < 0.05) stall += 0.09; else stall = 0; }
  if (stall > maxStall) maxStall = stall;
  if (stall > 3 && !stuckAt) stuckAt = { tS: +((Date.now()-start)/1000).toFixed(1), pos: s.pos, preview: s.preview, sat: s.satisfied.length };
  prev = s.pos;
  const tS = (Date.now() - start) / 1000;
  if (tS - lastLogT >= 5) { lastLogT = tS; console.log(`t=${tS.toFixed(0)}s pos=[${s.pos.x.toFixed(0)},${s.pos.y.toFixed(0)},${s.pos.z.toFixed(0)}] sat=${s.satisfied.length}/${s.reqTotal} enc=${s.enc?`${s.enc.id}:${s.enc.phase}`:"-"} beat=${s.beat??"-"} verb=${s.preview} stall=${stall.toFixed(1)}s`); }
  await sleep(80);
}
await page.keyboard.up("KeyW").catch(() => {}); await page.keyboard.up("ShiftLeft").catch(() => {});
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

const diag = await page.evaluate(() => {
  const d = window.__diag; if (!d) return null;
  let maxStrict = 0, maxInv = 0, strictId = null, invId = null;
  for (const e of d.embeds) {
    for (const s of e.strict) if (s.depthM > maxStrict) { maxStrict = s.depthM; strictId = s.id; }
    for (const s of e.invariant) if (s.depthM > maxInv) { maxInv = s.depthM; invId = s.id; }
  }
  return { embedTicks: d.embeds.length, maxStrict:+maxStrict.toFixed(3), strictId, maxInv:+maxInv.toFixed(3), invId, frames: d.frames.length };
}).catch(() => null);

console.log("\n==== RESULT ====");
console.log("elapsed(s):", elapsed, "outcome:", JSON.stringify(outcome));
console.log("maxStall(s):", maxStall.toFixed(1), "stuckAt:", JSON.stringify(stuckAt));
console.log("encounters:", [...encSeen.entries()].map(([id, set]) => `${id}:{${[...set].join(",")}}`).join("  "));
console.log("penetration:", JSON.stringify(diag));
console.log("pageerrors:", perr.length, perr.slice(0, 3));
await browser.close();
