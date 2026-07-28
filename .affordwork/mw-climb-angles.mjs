// Drive the REAL client into each authored climb from the FRONT and from
// several off-axis approach angles, holding W+Shift. Read window.__diag per
// tick: spline-vs-solver divergence, deepest STRICT hull embed (no ignore),
// and the surface/lift. This is the admissible reproduction: real browser,
// real flow controller committing the real verb off geometry.
//
//   node .affordwork/mw-climb-angles.mjs [baseURL] [seconds]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:5273";
const SECS = Number(process.argv[3]) || 6;
const SEED = "0xb057";
const OUT = new URL("./climb-angles-out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// foot -> top, plus a back-off so there is a run-up along the on-axis line.
const CLIMBS = [
  ["D2_OUTSIDE", "E_BUTTRESS", 1.6],
  ["E_BUTTRESS", "E_LEANTO", 1.2],
  ["C_SCAFF_FOOT", "C_SCAFF_1", 1.2],
  ["D_MEETING_ROOF", "E_RIDGE", 1.6],
  ["E_RIDGE", "E_LOUVRE", 1.4],
  ["F_LOW", "F_CROWN", 1.2],
];
// Approach angle offsets (deg) added to the on-axis heading.
const ANGLES = [0, 30, -30, 70, 120];

const browser = await chromium.launch({ headless: true, executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
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
  return { tick: rt.ticks, pos: { x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2) }, grounded: m.grounded, verb: rt.flow?.verb, preview: rt.flow?.previewVerb, phase: m.phase, speed: +Math.hypot(m.vel.x, m.vel.z).toFixed(2) };
}).catch(() => null);

const results = [];
for (const [foot, top, back] of CLIMBS) {
  for (const deg of ANGLES) {
    const url = `${BASE}/src/mission/floor.html?at=${foot}&toward=${top}&back=${back}&bare=1&seed=${SEED}`;
    await page.goto(url, { waitUntil: "commit", timeout: 60000 });
    if (!(await waitRuntime())) { results.push({ foot, top, deg, error: "no runtime" }); continue; }
    await sleep(900);
    await page.mouse.click(640, 400).catch(() => {});
    // Rotate the look yaw off-axis by `deg` and reset the black box.
    await page.evaluate((d) => {
      const look = window.__look; if (look?.look) look.look.yaw = look.look.yaw + (d * Math.PI) / 180;
      window.__diag?.reset?.();
    }, deg).catch(() => {});
    const before = await READ();
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

    let maxDiv = 0, maxEmbed = 0, embedId = null, embedTick = null, embedPos = null, authoredTicks = 0, maxLift = 0;
    const verbs = new Set();
    if (diag) {
      authoredTicks = diag.authored.length;
      for (const a of diag.authored) {
        verbs.add(a.verb);
        if (a.divergenceM > maxDiv) maxDiv = a.divergenceM;
        if (a.deepestEmbedM > maxEmbed) { maxEmbed = a.deepestEmbedM; embedId = a.deepestEmbedId; }
        if ((a.liftM ?? 0) > maxLift) maxLift = a.liftM;
      }
    }
    const strictWorst = new Map();
    if (diag) for (const e of diag.embeds) for (const s of e.strict) {
      if (!strictWorst.has(s.id) || s.depthM > strictWorst.get(s.id).depthM) strictWorst.set(s.id, { depthM: s.depthM, tick: e.tick, pos: e.pos });
    }
    const r = {
      foot, top, deg,
      from: before?.pos, to: after?.pos,
      rose: before && after ? +(after.pos.y - before.pos.y).toFixed(2) : null,
      verbs: [...verbs], authoredTicks,
      maxDivergenceM: +maxDiv.toFixed(3),
      maxAuthoredEmbedM: +maxEmbed.toFixed(3), authoredEmbedId: embedId,
      maxLiftM: +maxLift.toFixed(2),
      strictEmbeds: [...strictWorst.entries()].map(([id, v]) => `${id}:${v.depthM.toFixed(3)}@t${v.tick}`),
      finalPhase: after?.phase,
    };
    results.push(r);
    console.log(`${foot}->${top} @${deg}deg: rose ${r.rose}m verbs=${r.verbs.join(",")} maxDiv=${r.maxDivergenceM} maxEmbed=${r.maxAuthoredEmbedM}(${embedId ?? "-"}) lift=${r.maxLiftM} strict=[${r.strictEmbeds.join(", ")}]`);
    if (diag && (maxEmbed > 0.08 || maxDiv > 0.1)) {
      writeFileSync(`${OUT}${foot}__${top}__${deg}.json`, JSON.stringify(diag.authored));
    }
  }
}
writeFileSync(`${OUT}summary.json`, JSON.stringify(results, null, 2));
console.log("\npage errors:", perr.length, perr.slice(0, 3));
await browser.close();
