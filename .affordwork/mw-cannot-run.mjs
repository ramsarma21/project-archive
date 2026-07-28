// "Cannot run": drive the REAL guided route (aim at the wayfinder waypoint, hold
// W+Shift, jump when previewed, answer encounters) and flag every sustained
// stretch where the body is grounded, held forward, not in an encounter, yet
// cannot reach run speed. For each stretch, record the CAUSE the runtime exposes:
// the authored leg speed cap, a latched edge-brake hazard (flow.brakeDirX), a
// stuck crouch (capsuleHeight below stand), or an armed action. Real play only.
//
//   node .affordwork/mw-cannot-run.mjs [baseURL] [seed]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:5273";
const SEED = process.argv[3] ?? "0xb057";
const OUT = new URL("./cannot-run/", import.meta.url).pathname;
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
    await sleep(200);
  }
  return false;
}

const READ = () => page.evaluate(() => {
  const rt = window.__floor; if (!rt?.motion) return null; const m = rt.motion;
  const req = rt.instance.objectives.filter((o) => o.required);
  const met = new Set(rt.satisfied);
  const cur = req.find((o) => !met.has(o.id)) ?? null;
  let wp = null, cap = null;
  if (cur && cur.mark) {
    const w = cur.mark.waypoint ? cur.mark.waypoint(m.pos) : null;
    if (w) wp = { x: w.pos.x, y: w.pos.y, z: w.pos.z };
    cap = cur.mark.speedCapMps ? cur.mark.speedCapMps(m.pos) : null;
  }
  const ev = rt.encounterView;
  const f = rt.flow ?? {};
  return {
    tick: rt.ticks,
    pos: { x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2) },
    grounded: m.grounded,
    capsuleHeight: +(m.capsuleHeight ?? 0).toFixed(2),
    phase: m.phase,
    speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2),
    verb: f.verb ?? null, preview: f.previewVerb ?? null,
    braked: f.brakeDirX !== null && f.brakeDirX !== undefined,
    brakeDrop: f.brakeDropM ?? null,
    cooldown: f.cooldownTicks ?? 0,
    action: !!m.action,
    cap: cap != null ? +cap.toFixed(2) : null,
    wp, enc: ev ? { id: ev.encounterId, phase: ev.phase } : null,
    encLocked: !!(rt.encounterLocked || rt.encounterOwnsInput),
    outcome: rt.outcome ? rt.outcome.kind : null,
  };
}).catch(() => null);

async function aim(wp, pos) {
  if (!wp) return;
  const dx = wp.x - pos.x, dz = wp.z - pos.z;
  await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, Math.atan2(dx, dz));
}

async function handleEncounter() {
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  for (let i = 0; i < 120; i++) {
    const box = await page.$("#msn-enc-input");
    const cur = await READ();
    if (cur?.enc?.phase === "RESOLVED" || !cur?.enc) break;
    if (box) {
      const disabled = await box.evaluate((el) => el.disabled).catch(() => true);
      if (!disabled) {
        await box.click().catch(() => {});
        await box.type("I carry handbills for the printer on Queen Street; no stamp is owed on a broadside.", { delay: 1 }).catch(() => {});
        const submit = await page.$(".msn-enc-submit"); if (submit) await submit.click().catch(() => {});
      }
    }
    await sleep(200);
  }
  for (let i = 0; i < 40; i++) {
    const btn = await page.$(".msn-enc-submit"); const cur = await READ();
    if (!cur?.enc || cur.enc.phase !== "RESOLVED") break;
    if (btn) await btn.click().catch(() => {});
    await sleep(150);
  }
  await page.keyboard.down("ShiftLeft").catch(() => {});
  await page.keyboard.down("KeyW").catch(() => {});
}

await page.goto(`${BASE}/src/mission/floor.html?hold=0&seed=${SEED}&encounterVerdict=correct`, { waitUntil: "commit", timeout: 120000 });
if (!(await waitRuntime())) { log("no runtime"); await browser.close(); process.exit(1); }
await sleep(3000);
await page.mouse.click(640, 400).catch(() => {});
await sleep(300);
await page.keyboard.down("ShiftLeft");
await page.keyboard.down("KeyW");

const trace = [];
const START = Date.now();
let jumpCd = 0;
while (Date.now() - START < 220000) {
  const s = await READ();
  if (!s) { await sleep(90); continue; }
  trace.push(s);
  if (s.outcome) { log(`OUTCOME ${s.outcome} @${JSON.stringify(s.pos)}`); break; }
  if (s.enc && s.enc.phase !== "RESOLVED" && (s.encLocked || s.enc.phase === "QUESTION" || s.enc.phase === "APPROACH")) { await handleEncounter(); jumpCd = 0; continue; }
  await aim(s.wp, s.pos);
  if (jumpCd > 0) jumpCd -= 1;
  if (s.grounded && jumpCd === 0 && ["JUMP","JUMP_GAP","LEAP_OF_FAITH","DASH_JUMP"].includes(s.preview)) { await page.keyboard.press("Space").catch(() => {}); jumpCd = 4; }
  await sleep(90);
}
await page.keyboard.up("KeyW").catch(() => {});
await page.keyboard.up("ShiftLeft").catch(() => {});

// Analysis: "cannot run" = grounded, no encounter, no action, no cooldown, held
// forward, yet speed < RUN threshold for a sustained window. Attribute a cause.
const RUN = 3.0; // sprintThreshold-ish; below this the body is not running
const zones = [];
let run = null;
for (const s of trace) {
  const trying = s.grounded && !s.enc && !s.action && s.phase === "GROUNDED";
  const slow = s.speed < RUN;
  if (trying && slow) {
    if (!run) run = { fromTick: s.tick, pos0: s.pos, samples: [] };
    run.samples.push(s);
  } else if (run) {
    if (run.samples.length >= 10) zones.push(run);
    run = null;
  }
}
if (run && run.samples.length >= 10) zones.push(run);

const summary = zones.map((z) => {
  const n = z.samples.length;
  const capped = z.samples.filter((s) => s.cap != null).length;
  const braked = z.samples.filter((s) => s.braked).length;
  const crouched = z.samples.filter((s) => s.capsuleHeight > 0 && s.capsuleHeight < 1.5).length;
  const cooldown = z.samples.filter((s) => s.cooldown > 0).length;
  const minCap = Math.min(...z.samples.map((s) => (s.cap == null ? Infinity : s.cap)));
  const meanSpeed = +(z.samples.reduce((a, s) => a + s.speed, 0) / n).toFixed(2);
  const last = z.samples[n - 1];
  const moved = +Math.hypot(last.pos.x - z.pos0.x, last.pos.z - z.pos0.z).toFixed(2);
  let cause = "unexplained";
  if (capped / n > 0.6) cause = `authored leg cap (min ${minCap})`;
  else if (braked / n > 0.4) cause = "latched edge brake";
  else if (crouched / n > 0.6) cause = "stuck crouch";
  else if (cooldown / n > 0.6) cause = "verb cooldown";
  else if (moved < 0.4) cause = "stall (blocked, not a speed clamp)";
  return { fromTick: z.fromTick, durS: +(n * 0.09).toFixed(1), pos: z.pos0, meanSpeed, movedM: moved, capped, braked, crouched, cooldown, n, cause };
});

writeFileSync(`${OUT}trace.json`, JSON.stringify(trace));
writeFileSync(`${OUT}zones.json`, JSON.stringify(summary, null, 2));
log(`\nticks=${trace.length} last=${JSON.stringify(trace.at(-1)?.pos)} outcome=${trace.at(-1)?.outcome}`);
log(`"cannot run" zones (>=~0.9s slow while trying): ${summary.length}`);
for (const z of summary) log(`  t${z.fromTick} ${z.durS}s @${JSON.stringify(z.pos)} mean=${z.meanSpeed} moved=${z.movedM}m cap=${z.capped}/${z.n} brake=${z.braked} crouch=${z.crouched} cd=${z.cooldown} => ${z.cause}`);
log("page errors:", perr.length, perr.slice(0, 3));
await browser.close();
