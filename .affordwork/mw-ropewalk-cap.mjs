// Directly test whether the authored leg speed cap (2.3 m/s onto the ropewalk
// tie beam) OUTLIVES its leg. Spawn at the hatch above the beam, drop onto it,
// walk it west, drop off into the hemp, and keep going — logging per tick the
// body position, speed, the guidance leg cap, verb, and committed objective.
// If `cap` stays 2.3 after the body has left the beam (y well below 5.2, off the
// board) while holding Shift, that is "cannot run": a cap that never retired.
//
//   node .affordwork/mw-ropewalk-cap.mjs [baseURL] [seed]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:5273";
const SEED = process.argv[3] ?? "0xb057";
const OUT = new URL("./ropewalk-cap/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader","--ignore-gpu-blocklist","--disable-background-timer-throttling","--disable-renderer-backgrounding"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const perr = [];
page.on("pageerror", (e) => perr.push(String(e).slice(0, 200)));

async function waitRuntime() {
  for (let i = 0; i < 200; i++) {
    const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
    if (t !== null) return true;
    await sleep(150);
  }
  return false;
}
const READ = () => page.evaluate(() => {
  const rt = window.__floor; if (!rt?.motion) return null; const m = rt.motion;
  const req = rt.instance.objectives.filter((o) => o.required);
  const met = new Set(rt.satisfied);
  const cur = req.find((o) => !met.has(o.id)) ?? null;
  let cap = null, wp = null, via = null;
  if (cur && cur.mark) {
    cap = cur.mark.speedCapMps ? cur.mark.speedCapMps(m.pos) : null;
    const w = cur.mark.waypoint ? cur.mark.waypoint(m.pos) : null;
    if (w) { wp = { x: +w.pos.x.toFixed(1), y: +w.pos.y.toFixed(1), z: +w.pos.z.toFixed(1) }; via = w.via; }
  }
  return {
    tick: rt.ticks,
    pos: { x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2) },
    grounded: m.grounded, phase: m.phase,
    speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2),
    verb: rt.flow?.verb ?? null,
    cap: cap != null ? +cap.toFixed(2) : null,
    objId: cur?.id ?? null, via, wp,
    outcome: rt.outcome ? rt.outcome.kind : null,
  };
}).catch(() => null);
async function aimYaw(dx, dz) {
  await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, Math.atan2(dx, dz));
}

await page.goto(`${BASE}/src/mission/floor.html?at=D2_ROOF_N&toward=D2_BEAM_MID&bare=1&seed=${SEED}`, { waitUntil: "commit", timeout: 60000 });
if (!(await waitRuntime())) { log("no runtime"); await browser.close(); process.exit(1); }
await sleep(1200);
await page.mouse.click(640, 400).catch(() => {});
await sleep(200);

const trace = [];
await page.keyboard.down("ShiftLeft");
await page.keyboard.down("KeyW");
const START = Date.now();
let stage = "drop"; // drop onto beam -> walk west -> off into hemp
let jumpCd = 0;
while (Date.now() - START < 18000) {
  const s = await READ();
  if (!s) { await sleep(80); continue; }
  trace.push(s);
  // Steering stages by position along the beam (beam z~21.3, x 76->63).
  if (stage === "drop" && s.pos.y <= 5.6 && Math.abs(s.pos.z - 21.3) < 1.5) stage = "west";
  if (stage === "west" && s.pos.x <= 63.5) stage = "off";
  if (stage === "drop") await aimYaw(76.1 - s.pos.x, 21.3 - s.pos.z);       // toward D2_BEAM_MID
  else if (stage === "west") await aimYaw(63.0 - s.pos.x, 21.3 - s.pos.z);  // toward D2_BEAM_W
  else await aimYaw(59.6 - s.pos.x, 21.8 - s.pos.z);                        // off toward D2_FLOOR_W
  if (jumpCd > 0) jumpCd -= 1;
  if (s.grounded && jumpCd === 0 && ["JUMP","JUMP_GAP","LEAP_OF_FAITH"].includes(s.verb)) { await page.keyboard.press("Space").catch(()=>{}); jumpCd = 4; }
  await sleep(80);
}
await page.keyboard.up("KeyW").catch(()=>{});
await page.keyboard.up("ShiftLeft").catch(()=>{});
writeFileSync(`${OUT}trace.json`, JSON.stringify(trace, null, 2));

// Report: the cap over the run, and specifically any tick where the body is
// OFF the beam (y < 4.8 or |z-21.3|>2) yet the cap is still non-null.
const onBeam = (s) => Math.abs(s.pos.y - 5.2) < 0.6 && Math.abs(s.pos.z - 21.3) < 1.2;
const offBeamCapped = trace.filter((s) => !onBeam(s) && s.cap != null && s.grounded);
log(`ticks=${trace.length}`);
const caps = [...new Set(trace.map((s)=>s.cap))];
log(`cap values seen: ${JSON.stringify(caps)}`);
log(`ticks capped while ON beam: ${trace.filter((s)=>onBeam(s)&&s.cap!=null).length}`);
log(`ticks capped while OFF beam (the bug, if >0): ${offBeamCapped.length}`);
for (const s of offBeamCapped.slice(0, 12)) log(`  OFF-BEAM CAP t${s.tick} @${JSON.stringify(s.pos)} cap=${s.cap} spd=${s.speed} verb=${s.verb} obj=${s.objId} via=${s.via}`);
// Also: the tail of the run, to see the final state.
log("tail:");
for (const s of trace.slice(-6)) log(`  t${s.tick} @${JSON.stringify(s.pos)} y=${s.pos.y} spd=${s.speed} cap=${s.cap} verb=${s.verb} via=${s.via}`);
log("page errors:", perr.length, perr.slice(0,3));
await browser.close();
