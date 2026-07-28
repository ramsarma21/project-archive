// After-fix stills at the KEY action spots, dropped in AT the take-off (back=0)
// so the newly-armed action cue is on screen — the "CLIMB UP" / "VAULT" / "LEAP"
// the run-mark now posts instead of receding into the hold.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const OUT = new URL(`./${process.argv[3] ?? "shots-after"}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const P = { UP: 0.05, LEVEL: 0.18, REST: 0.265, DOWN: 0.6 };

// [name, at, toward, back, pitch]
const SHOTS = [
  ["05-canopy-climb",     "B_CRATES_FOOT",    "B_CANOPY_2_S",   0, P.UP],
  ["09-dock-vault",       "B2_GOODS_IN",      "B2_GOODS_OUT",   0, P.REST],
  ["10-townhouse-scaffold","C_SCAFF_FOOT",    "C_SCAFF_1",      0, P.UP],
  ["12-gallery-clock",    "C_GALLERY_EMID",   "C_CLOCK",        0, P.UP],
  ["13-cornice-tower",    "C_LEADS_TOWERFOOT","C_TOWER_PLINTH", 0, P.UP],
  ["16-roof-vaults",      "D_VAULT_IN_0",     "D_VAULT_OUT_0",  0, P.REST],
  ["18-ropewalk-hatch",   "D2_ROOF_N",        "D2_BEAM_MID",    0, P.DOWN],
  ["23-south-face-climb", "D2_OUTSIDE",       "E_BUTTRESS",     0, P.UP],
  ["25-steeple-leap",     "E_GALLERY",        "F_CROWN",        0, P.LEVEL],
  // approach framing: 3m back from the scaffold, to show the cue arrives BEFORE
  // the player commits, not just once they are on the take-off.
  ["10b-scaffold-approach","C_SCAFF_FOOT",    "C_SCAFF_1",      3, P.LEVEL],
];

const browser = await chromium.launch({
  headless: true, executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
    "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
});
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
  let action = null, via = null, rangeM = null;
  if (cur?.mark) {
    const w = cur.mark.waypoint ? cur.mark.waypoint(m.pos) : null; if (w) via = w.via;
    const r = cur.mark.rangeM ? cur.mark.rangeM(m.pos) : null; if (r) rangeM = +r.metres.toFixed(0);
    const g = cur.mark.gateway ? cur.mark.gateway() : null;
    if (g) action = { kind: g.kind, phase: g.phase, riseM: +g.riseM.toFixed(1) };
  }
  return { tick: rt.ticks, via, rangeM, action };
});

const results = [];
for (const [name, at, toward, back, pitch] of SHOTS) {
  await page.goto(`${BASE}/src/mission/floor.html?at=${at}&toward=${toward}&back=${back}&encounterVerdict=correct`,
    { waitUntil: "commit", timeout: 120000 });
  if (!(await waitRuntime())) { log(`${name}: no runtime`); continue; }
  await sleep(3000);
  await page.evaluate((p) => { const L = window.__look; if (L?.look) L.look.pitch = p; }, pitch);
  await sleep(700);
  const s = await READ();
  await page.screenshot({ path: `${OUT}${name}.png` });
  results.push({ name, at, toward, ...s });
  log(`${name}  ${at}->${toward}  via=${s?.via} action=${JSON.stringify(s?.action)} range=${s?.rangeM}`);
}
writeFileSync(`${OUT}after.json`, JSON.stringify(results, null, 2));
log("\npage errors:", perr.length, perr.slice(0, 3));
log("done ->", OUT);
await browser.close();
