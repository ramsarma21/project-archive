// Reproduce the owner's report in the REAL running client (window.__floor /
// window.__diag), per the verification standard. Two scenarios:
//   A) Spawn on the crown (F_POST) and JUMP off the rim instead of taking the
//      authored climb-down. Record the real motion trajectory, __diag embeds,
//      and a legible screenshot of the landing.
//   B) Drive the roofline approach and watch WHERE ROPEWALK_STOP arms.
//
//   node .affordwork/repro-elm.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "repro-elm-out");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5273";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const READ = () => {
  const rt = window.__floor;
  if (!rt || !rt.motion) return null;
  const m = rt.motion;
  const ev = rt.encounterView;
  return {
    tick: rt.clock?.tick ?? rt.ticks ?? 0,
    pos: { x: +m.pos.x.toFixed(3), y: +m.pos.y.toFixed(3), z: +m.pos.z.toFixed(3) },
    phase: m.phase,
    grounded: m.grounded,
    vy: +m.vel.y.toFixed(2),
    preview: rt.flow?.previewVerb ?? null,
    encView: ev ? { id: ev.encounterId, phase: ev.phase } : null,
    encounters: (rt.encounters ?? []).map((e) => ({ id: e.def?.id ?? "?", phase: e.phase })),
    outcome: rt.outcome ? rt.outcome.kind : null,
  };
};
const DIAG = () => {
  const d = window.__diag;
  if (!d) return { available: false };
  let maxStrict = 0, strictId = null, minY = Infinity, deckHit = null;
  for (const e of d.embeds) {
    for (const s of e.strict) if (s.depthM > maxStrict) { maxStrict = s.depthM; strictId = s.id; }
    if (e.pos.y < minY) minY = e.pos.y;
    if (e.deckId) deckHit = e.deckId;
  }
  return { available: true, embedTicks: d.embeds.length, maxStrict: +maxStrict.toFixed(3), strictId, minEmbedY: minY === Infinity ? null : +minY.toFixed(3), deckHit };
};

async function boot(page, url) {
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  for (let i = 0; i < 300; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) return true;
    await sleep(200);
  }
  return false;
}

async function scenarioJump(browser) {
  log("\n===== A) JUMP off the crown rim (F_POST -> south rim) =====");
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  // Spawn on the crown facing SOUTH (toward the street below), so "run + jump"
  // takes the player off the rim the design warns about.
  const url = `${BASE}/src/mission/floor.html?at=F_POST&toward=F_CROWD_S&encounterVerdict=correct`;
  if (!(await boot(page, url))) { log("  runtime never came up"); await page.close(); return; }
  await sleep(6000); // GLBs settle
  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});
  const before = await page.evaluate(READ);
  log("  spawn:", JSON.stringify(before?.pos), "phase", before?.phase);
  await page.screenshot({ path: join(OUT, "A0-on-crown.png") }).catch(() => {});

  // Run forward (off the rim) and jump.
  await page.keyboard.down("KeyW");
  const traj = [];
  let minY = Infinity, jumped = false;
  for (let i = 0; i < 130; i++) {
    const s = await page.evaluate(READ).catch(() => null);
    if (s) {
      traj.push({ t: i, ...s.pos, phase: s.phase, vy: s.vy, grounded: s.grounded, enc: s.encView });
      minY = Math.min(minY, s.pos.y);
      // Jump once, early, while still on the bough.
      if (!jumped && i >= 3 && s.grounded) { await page.keyboard.press("Space").catch(() => {}); jumped = true; }
    }
    await sleep(50);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  const diag = await page.evaluate(DIAG);
  const end = await page.evaluate(READ);
  await page.screenshot({ path: join(OUT, "A1-after-jump.png") }).catch(() => {});
  log("  minY over run:", minY.toFixed(3));
  log("  landing:", JSON.stringify(end?.pos), "phase", end?.phase, "grounded", end?.grounded);
  log("  encounters:", JSON.stringify(end?.encounters));
  log("  __diag:", JSON.stringify(diag));
  writeFileSync(join(OUT, "A-trajectory.json"), JSON.stringify({ url, minY, traj, diag, end, errs }, null, 2));
  // Print the descent portion of the trajectory.
  log("  trajectory (every 6th sample): t x y z phase vy grounded");
  for (let i = 0; i < traj.length; i += 6) {
    const p = traj[i];
    log(`    ${String(p.t).padStart(3)}  ${p.x.toFixed(2).padStart(7)} ${p.y.toFixed(2).padStart(6)} ${p.z.toFixed(2).padStart(6)}  ${p.phase.padEnd(13)} vy=${String(p.vy).padStart(6)} g=${p.grounded}`);
  }
  await page.close();
}

async function scenarioRoofline(browser) {
  log("\n===== B) roofline approach: where does ROPEWALK_STOP arm? =====");
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const url = `${BASE}/src/mission/floor.html?at=D_SROOF_E&toward=D_MEETING_W&encounterVerdict=correct`;
  if (!(await boot(page, url))) { log("  runtime never came up"); await page.close(); return; }
  await sleep(6000);
  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => window.__diag?.reset?.()).catch(() => {});

  const aim = async (wp, pos) => {
    if (!wp) return;
    const yaw = Math.atan2(wp.x - pos.x, wp.z - pos.z);
    await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, yaw).catch(() => {});
  };
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  let armedAt = null;
  const MISSION_WP = () => {
    const rt = window.__floor;
    const req = rt.instance.objectives.filter((o) => o.required);
    const met = new Set(rt.satisfied);
    const cur = req.find((o) => !met.has(o.id)) ?? null;
    if (cur?.mark?.waypoint) { const w = cur.mark.waypoint(rt.motion.pos); if (w) return { x: w.pos.x, y: w.pos.y, z: w.pos.z }; }
    return null;
  };
  for (let i = 0; i < 120; i++) {
    const s = await page.evaluate(READ).catch(() => null);
    const wp = await page.evaluate(MISSION_WP).catch(() => null);
    if (s) {
      const rope = s.encounters.find((e) => e.id === "ROPEWALK_STOP");
      if (rope && rope.phase !== "DORMANT" && !armedAt) {
        armedAt = { pos: s.pos, phase: rope.phase };
        log(`  ROPEWALK_STOP armed at ${JSON.stringify(s.pos)} phase=${rope.phase}`);
        await page.screenshot({ path: join(OUT, "B-armed.png") }).catch(() => {});
      }
      if (s.preview && ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH", "DASH_JUMP"].includes(s.preview) && s.grounded) {
        await page.keyboard.press("Space").catch(() => {});
      }
      await aim(wp, s.pos);
    }
    await sleep(70);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  const end = await page.evaluate(READ);
  log("  end pos:", JSON.stringify(end?.pos), "encounters:", JSON.stringify(end?.encounters));
  writeFileSync(join(OUT, "B-armed.json"), JSON.stringify({ armedAt, end }, null, 2));
  await page.close();
}

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});
await scenarioJump(browser);
await scenarioRoofline(browser);
await browser.close();
log("\nDone. Screenshots + JSON in", OUT);
