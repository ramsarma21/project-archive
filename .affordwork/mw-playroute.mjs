// Play the whole M1 SAFE route in the REAL browser and capture player-view
// frames at every decision point, climb entry, gap, and the yard — as the
// player sees them (the chase camera), not a debug cam.
//
// Steering: we point the LOOK yaw at the wayfinder's committed waypoint (the
// exact guidance the mission draws), hold W + Shift (Shift = auto-catch: the
// world climbs/vaults/drops FOR you), and press Space when the flow controller
// previews a jump/leap. Perspective encounters (guard questions) are answered
// through the real overlay with the deterministic dev authority.
//
//   node .affordwork/mw-playroute.mjs [baseURL] [outDir] [seed]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const OUT = process.argv[3]
  ? new URL(`./${process.argv[3]}/`, import.meta.url).pathname
  : new URL("./playroute/", import.meta.url).pathname;
const SEED = process.argv[4] ?? "0xb057";
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const perr = [];
const viol = [];
page.on("pageerror", (e) => perr.push(String(e).slice(0, 240)));
page.on("console", (m) => {
  const t = m.text();
  if (/non-penetration violated|climbSurfaceInvariant|violated/.test(t)) viol.push(t.slice(0, 200));
});

async function waitRuntime() {
  for (let i = 0; i < 200; i++) {
    const t = await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null);
    if (t !== null) return true;
    await sleep(200);
  }
  return false;
}

const READ = () =>
  page.evaluate(() => {
    const rt = window.__floor;
    if (!rt || !rt.motion) return null;
    const m = rt.motion;
    const req = rt.instance.objectives.filter((o) => o.required);
    const met = new Set(rt.satisfied);
    const cur = req.find((o) => !met.has(o.id)) ?? null;
    let wp = null, rangeM = null, riseM = null, via = null, title = null, cap = null, gw = null;
    if (cur && cur.mark) {
      const w = cur.mark.waypoint ? cur.mark.waypoint(m.pos) : null;
      if (w) { wp = { x: w.pos.x, y: w.pos.y, z: w.pos.z }; via = w.via; }
      const r = cur.mark.rangeM ? cur.mark.rangeM(m.pos) : null;
      if (r) rangeM = r.metres;
      title = cur.mark.title;
      cap = cur.mark.speedCapMps ? cur.mark.speedCapMps(m.pos) : null;
      const g = cur.mark.gateway ? cur.mark.gateway() : null;
      if (g) gw = { phase: g.phase, riseM: g.riseM, verbs: g.allowedVerbs };
      if (wp) riseM = +(wp.y - m.pos.y).toFixed(2);
    }
    const ev = rt.encounterView;
    return {
      tick: rt.ticks,
      pos: { x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2) },
      grounded: m.grounded,
      speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2),
      verb: rt.flow?.verb ?? null,
      preview: rt.flow?.previewVerb ?? null,
      objId: cur?.id ?? null,
      title, via, rangeM: rangeM != null ? +rangeM.toFixed(1) : null, riseM, cap, gw, wp,
      enc: ev ? { id: ev.encounterId, phase: ev.phase, verdict: ev.verdictKind } : null,
      encLocked: !!(rt.encounterLocked || rt.encounterOwnsInput),
      outcome: rt.outcome ? rt.outcome.kind : null,
    };
  }).catch(() => null);

// Point the look at a world target (yaw only steers movement; pitch frames it).
async function aim(wp, pos) {
  if (!wp) return;
  const dx = wp.x - pos.x, dz = wp.z - pos.z, dy = wp.y - pos.y;
  const yaw = Math.atan2(dx, dz);
  const horiz = Math.hypot(dx, dz) || 0.001;
  // Frame toward the target height, gently, clamped to a sane look range.
  let pitch = -Math.atan2(dy, horiz) * 0.55 - 0.06;
  pitch = Math.max(-0.5, Math.min(0.5, pitch));
  await page.evaluate(
    ([y, p]) => { const L = window.__look; if (L && L.look) { L.look.yaw = y; L.look.pitch = p; } },
    [yaw, pitch],
  );
}

async function handleEncounter(s, frames) {
  log(`  [encounter ${s.enc.id}] phase=${s.enc.phase} @${JSON.stringify(s.pos)}`);
  // Release movement while the stop is up.
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  // Wait until the answer dock is answerable (QUESTION + shot ready).
  let answered = false;
  for (let i = 0; i < 120; i++) {
    const box = await page.$("#msn-enc-input");
    const cur = await READ();
    if (cur?.enc?.phase === "RESOLVED") break;
    if (box) {
      const disabled = await box.evaluate((el) => el.disabled).catch(() => true);
      if (!disabled && !answered) {
        await page.screenshot({ path: `${OUT}enc-${s.enc.id}-question.png` }).catch(() => {});
        frames.push({ file: `enc-${s.enc.id}-question.png`, note: `guard question ${s.enc.id}`, ...cur });
        await box.click().catch(() => {});
        await box.type("I am carrying handbills for the printer on Queen Street; there is no stamp owed on a broadside and I am about lawful business.", { delay: 2 }).catch(() => {});
        const submit = await page.$(".msn-enc-submit");
        if (submit) await submit.click().catch(() => {});
        answered = true;
      }
    }
    await sleep(250);
  }
  // Resolved: capture the reaction, then Move on.
  const rez = await READ();
  await page.screenshot({ path: `${OUT}enc-${s.enc.id}-resolved.png` }).catch(() => {});
  frames.push({ file: `enc-${s.enc.id}-resolved.png`, note: `guard resolved ${s.enc.id} verdict=${rez?.enc?.verdict}`, ...rez });
  for (let i = 0; i < 40; i++) {
    const btn = await page.$(".msn-enc-submit");
    const cur = await READ();
    if (!cur?.enc || cur.enc.phase !== "RESOLVED") break;
    if (btn) await btn.click().catch(() => {});
    await sleep(200);
  }
  // Resume running.
  await page.keyboard.down("ShiftLeft").catch(() => {});
  await page.keyboard.down("KeyW").catch(() => {});
  await sleep(200);
}

// ---- 1. the briefing (the real first-run onboarding surface) --------------
log("== briefing ==");
await page.goto(`${BASE}/src/mission/floor.html?seed=${SEED}`, { waitUntil: "commit", timeout: 120000 });
for (let i = 0; i < 80; i++) {
  const has = await page.$(".visor, .visor-hold, [class*='visor']").catch(() => null);
  if (has) break;
  await sleep(200);
}
await sleep(3500);
await page.screenshot({ path: `${OUT}00-briefing.png` }).catch(() => {});
log("briefing captured");

// ---- 2. the run -----------------------------------------------------------
log("== run ==");
await page.goto(`${BASE}/src/mission/floor.html?hold=0&seed=${SEED}&encounterVerdict=correct`, {
  waitUntil: "commit",
  timeout: 120000,
});
if (!(await waitRuntime())) { log("runtime never came up"); await browser.close(); process.exit(1); }
await sleep(3500); // GLBs + first frames
await page.mouse.click(640, 400).catch(() => {}); // focus canvas
await sleep(400);

const frames = [];
const trace = [];
const milestones = [];
let lastVia = null, lastVerb = null, lastShot = 0, jumpCd = 0, shotN = 1;
let stallPos = null, stallTicks = 0;

// spawn frame
{
  const s0 = await READ();
  await aim(s0?.wp, s0?.pos);
  await sleep(200);
  await page.screenshot({ path: `${OUT}01-spawn.png` });
  frames.push({ file: "01-spawn.png", note: "spawn — first thing the player sees", ...(await READ()) });
  shotN = 2;
}

await page.keyboard.down("ShiftLeft");
await page.keyboard.down("KeyW");

const START = Date.now();
const MAX_MS = 210000;
while (Date.now() - START < MAX_MS) {
  const s = await READ();
  if (!s) { await sleep(100); continue; }
  trace.push(s);

  if (s.outcome) { log(`OUTCOME: ${s.outcome} @${JSON.stringify(s.pos)}`); break; }

  if (s.enc && s.enc.phase !== "RESOLVED" && (s.encLocked || s.enc.phase === "QUESTION" || s.enc.phase === "APPROACH")) {
    await handleEncounter(s, frames);
    jumpCd = 0;
    continue;
  }

  await aim(s.wp, s.pos);

  // Jump / leap when the flow previews one.
  if (jumpCd > 0) jumpCd -= 1;
  if (s.grounded && jumpCd === 0 &&
      ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH", "DASH_JUMP"].includes(s.preview)) {
    await page.keyboard.press("Space").catch(() => {});
    jumpCd = 4;
  }

  // Milestones: section (via) change.
  if (s.via && s.via !== lastVia) {
    milestones.push({ tick: s.tick, via: s.via, pos: s.pos, verb: s.verb });
    lastVia = s.via;
  }

  const now = Date.now();
  const verbShot = s.verb && s.verb !== "NONE" && s.verb !== lastVerb &&
    ["CLIMB_UP", "CLIMB_OVER", "VAULT", "JUMP", "JUMP_GAP", "LEAP_OF_FAITH", "DASH", "SLIDE", "HANG_DROP", "RUN_OFF"].includes(s.verb);
  const periodic = now - lastShot > 2600;
  if (verbShot || periodic) {
    const tag = verbShot ? `verb-${s.verb}` : "step";
    const file = `${String(shotN).padStart(2, "0")}-${tag}.png`;
    await page.screenshot({ path: `${OUT}${file}` }).catch(() => {});
    frames.push({ file, note: `${s.via ?? "?"} · ${s.verb}/${s.preview}`, ...s });
    shotN += 1;
    lastShot = now;
  }
  if (s.verb && s.verb !== "NONE") lastVerb = s.verb;

  // Stall detection.
  if (stallPos && Math.hypot(s.pos.x - stallPos.x, s.pos.z - stallPos.z) < 0.2 && s.grounded && !s.enc) {
    stallTicks += 1;
  } else {
    stallTicks = 0;
    stallPos = s.pos;
  }
  if (stallTicks > 45) {
    log(`STALL ~${(stallTicks * 0.09).toFixed(1)}s @${JSON.stringify(s.pos)} via=${s.via} verb=${s.verb} preview=${s.preview} wp=${JSON.stringify(s.wp)} rise=${s.riseM}`);
    await page.screenshot({ path: `${OUT}STALL-${shotN}.png` }).catch(() => {});
    frames.push({ file: `STALL-${shotN}.png`, note: `STALL ${s.via} ${s.verb}`, ...s });
    shotN += 1;
    // nudge: jump once to try to unstick, then keep going a bit before giving up
    await page.keyboard.press("Space").catch(() => {});
    stallTicks = 0;
    if ((trace.filter((t) => t._stallmark).length) > 6) { log("giving up after repeated stalls"); break; }
    s._stallmark = true;
  }

  await sleep(90);
}

await page.keyboard.up("KeyW").catch(() => {});
await page.keyboard.up("ShiftLeft").catch(() => {});

const fin = await READ();
await page.screenshot({ path: `${OUT}99-final.png` });
frames.push({ file: "99-final.png", note: "final", ...fin });

writeFileSync(`${OUT}frames.json`, JSON.stringify(frames, null, 2));
writeFileSync(`${OUT}trace.json`, JSON.stringify(trace, null, 2));
writeFileSync(`${OUT}milestones.json`, JSON.stringify(milestones, null, 2));

log("\n--- milestones (section changes) ---");
for (const m of milestones) log(`  t${m.tick} ${m.via}  @${JSON.stringify(m.pos)} ${m.verb}`);
log("\nfinal:", JSON.stringify(fin));
log("violations:", viol.length, viol.slice(0, 4));
log("page errors:", perr.length, perr.slice(0, 3));
log("frames:", frames.length, "-> ", OUT);
await browser.close();
