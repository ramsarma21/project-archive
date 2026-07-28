// Drop the REAL client at the foot of each authored climb, hold W+Shift (the
// world catches you), and record the running-game black box per climb. This is
// the admissible, fast reproduction path: real browser, real flow controller
// committing the real verb off geometry, with window.__diag capturing the
// solver-vs-spline divergence and the strict (no-ignore) hull embed each tick.
//
//   node .affordwork/drive-climbs.mjs [baseURL] [seed] [secondsPerClimb]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const SEED = process.argv[3] ?? "0xb057";
const SECS = Number(process.argv[4]) || 6;
const OUT = new URL("./climbs-out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// Each authored vertical ascent (climbs.ts), plus two inferred crate/hay climbs
// the prior telemetry flagged as the worst spline penetrators. foot -> top.
const CLIMBS = [
  ["C_SCAFF_FOOT", "C_SCAFF_1"],
  ["C_SCAFF_1", "C_SCAFF_2"],
  ["C_GALLERY_EMID", "C_CLOCK"],
  ["C_CLOCK", "C_CORNICE_E"],
  ["C_LEADS_TOWERFOOT", "C_TOWER_PLINTH"],
  ["D2_OUTSIDE", "E_BUTTRESS"],
  ["E_BUTTRESS", "E_LEANTO"],
  ["D_MEETING_ROOF", "E_RIDGE"],
  ["E_GAMBREL_S", "E_RIDGE_W"],
  ["E_RIDGE", "E_LOUVRE"],
  ["F_LOW", "F_CROWN"],
  ["B_CRATES_FOOT", "B_CRATES_A"],
  ["C_LANE_FOOT", "C_LANE_HAY"],
];

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
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
  const rt = window.__floor; if (!rt || !rt.motion) return null; const m = rt.motion;
  return { tick: rt.ticks, pos: { x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2) }, grounded: m.grounded, verb: rt.flow?.verb, preview: rt.flow?.previewVerb, phase: m.phase, speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2) };
}).catch(() => null);

const results = [];
for (const [foot, top] of CLIMBS) {
  const url = `${BASE}/src/mission/floor.html?at=${foot}&toward=${top}&bare=1&seed=${SEED}`;
  await page.goto(url, { waitUntil: "commit", timeout: 60000 });
  if (!(await waitRuntime())) { log(`${foot}->${top}: NO RUNTIME`); results.push({ foot, top, error: "no runtime" }); continue; }
  await sleep(1200);
  await page.mouse.click(640, 400).catch(() => {});
  await page.evaluate(() => { window.__diag?.reset?.(); }).catch(() => {});
  const before = await READ();
  // Aim straight at the top node so movement intent points up the climb.
  await page.evaluate(([f, t]) => {
    const nodes = window.__floor?.instance?.route?.nodes ?? null;
    // fall back: aim along +path using motion; but we passed toward= so spawn yaw already faces it.
    void f; void t; void nodes;
  }, [foot, top]).catch(() => {});
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  const start = Date.now();
  let jumpCd = 0;
  while (Date.now() - start < SECS * 1000) {
    const s = await READ();
    if (jumpCd > 0) jumpCd -= 1;
    if (s && s.grounded && jumpCd === 0 && ["JUMP", "JUMP_GAP", "LEAP_OF_FAITH"].includes(s.preview)) {
      await page.keyboard.press("Space").catch(() => {}); jumpCd = 4;
    }
    await sleep(70);
  }
  await page.keyboard.up("KeyW").catch(() => {});
  await page.keyboard.up("ShiftLeft").catch(() => {});
  const after = await READ();
  const diag = await page.evaluate(() => {
    const d = window.__diag; if (!d) return null;
    return { authored: d.authored, embeds: d.embeds };
  }).catch(() => null);

  // Summarise this climb.
  let maxDiv = 0, maxEmbed = 0, embedId = null, authoredTicks = 0;
  const verbs = new Set();
  if (diag) {
    authoredTicks = diag.authored.length;
    for (const a of diag.authored) {
      verbs.add(a.verb);
      if (a.divergenceM > maxDiv) maxDiv = a.divergenceM;
      if (a.deepestEmbedM > maxEmbed) { maxEmbed = a.deepestEmbedM; embedId = a.deepestEmbedId; }
    }
  }
  // Strict embeds across the whole segment (worst per collider).
  const strictWorst = new Map();
  if (diag) for (const e of diag.embeds) for (const s of e.strict) {
    if (!strictWorst.has(s.id) || s.depthM > strictWorst.get(s.id)) strictWorst.set(s.id, s.depthM);
  }
  const r = {
    foot, top,
    from: before?.pos, to: after?.pos,
    rose: before && after ? +(after.pos.y - before.pos.y).toFixed(2) : null,
    verbs: [...verbs],
    authoredTicks,
    maxDivergenceM: +maxDiv.toFixed(3),
    maxAuthoredEmbedM: +maxEmbed.toFixed(3),
    authoredEmbedId: embedId,
    strictEmbeds: [...strictWorst.entries()].map(([id, d]) => `${id}:${d.toFixed(3)}`),
    finalVerb: after?.verb,
    finalPhase: after?.phase,
  };
  results.push(r);
  log(`${foot}->${top}: rose ${r.rose}m verbs=${r.verbs.join(",")} maxDiv=${r.maxDivergenceM}m maxEmbed=${r.maxAuthoredEmbedM}m(${embedId ?? "-"}) strict=[${r.strictEmbeds.join(", ")}] from${JSON.stringify(r.from)} to${JSON.stringify(r.to)}`);
  // Save the full per-tick authored trace for the worst offenders.
  if (diag && (maxDiv > 0.05 || maxEmbed > 0.05)) {
    writeFileSync(`${OUT}${foot}__${top}.json`, JSON.stringify(diag.authored));
  }
}

writeFileSync(`${OUT}summary.json`, JSON.stringify(results, null, 2));
log("\npage errors:", perr.length, perr.slice(0, 3));
log("-> wrote", OUT);
await browser.close();
