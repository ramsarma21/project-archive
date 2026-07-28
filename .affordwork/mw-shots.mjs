// Scenery-accurate legibility stills at every decision point on the M1 SAFE
// route, framed as the player sees them (the chase camera). Each shot drops the
// player in at a route node facing the next one, lets the world render and the
// wayfinder/holds settle, frames the pitch for the feature, and screenshots.
//
//   node .affordwork/mw-shots.mjs [baseURL] [outDir] [tag]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5273";
const OUT = new URL(`./${process.argv[3] ?? "shots"}/`, import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// pitch presets (positive = camera high looking DOWN; low = look level/up)
const P = { UP: 0.02, LEVEL: 0.16, REST: 0.265, DOWN: 0.62, DEEP: 0.85 };

// [name, atNode, towardNode, back, pitch, note]
const SHOTS = [
  ["01-spawn",            "A_START",        "A_ALLEY_LIP",   0,   P.REST,  "spawn: where do I go first?"],
  ["02-leads-to-alley",   "A_SHEETS",       "A_ALLEY_LIP",   2,   P.DOWN,  "off the leads: the drop into the alley"],
  ["03-alley-descent",    "A_ALLEY_LIP",    "A_PLANK",       0,   P.DOWN,  "alley chain-drop: hoist plank / lean-to / crates"],
  ["04-shambles-entry",   "A_ALLEY_FLOOR",  "B_STREET_W",    1.5, P.REST,  "into the Shambles market lane"],
  ["05-canopy-climb",     "B_CRATES_FOOT",  "B_CANOPY_2_S",  2,   P.UP,    "climb up onto stall-2 awning (KEY hold)"],
  ["06-canopy-leaps",     "B_CANOPY_2",     "B_CANOPY_3",    1.5, P.LEVEL, "awning-to-awning leaps"],
  ["07-canopy-to-square", "B_CANOPY_4",     "B_GAP_N",       1,   P.DOWN,  "off the canopies down to the stall gap"],
  ["08-dock-square",      "B2_ENTER",       "B2_KERB",       2,   P.REST,  "into Dock Square / the throng (crowd blend)"],
  ["09-dock-vault",       "B2_GOODS_IN",    "B2_GOODS_OUT",  2,   P.REST,  "the barrel vault out of the square"],
  ["10-townhouse-scaffold","C_SCAFF_FOOT",  "C_SCAFF_1",     2.5, P.UP,    "the Town House scaffold (KEY: reads as a wall?)"],
  ["11-scaffold-gallery", "C_SCAFF_2",      "C_GALLERY_W",   1.5, P.LEVEL, "leap from scaffold onto the balcony gallery"],
  ["12-gallery-clock",    "C_GALLERY_EMID", "C_CLOCK",       1.5, P.UP,    "climb the clock ledge / cornice"],
  ["13-cornice-tower",    "C_LEADS_TOWERFOOT","C_TOWER_PLINTH",1.5,P.UP,   "the tower climb (the vista)"],
  ["14-tower-vista",      "C_TOWER_GALLERY","F_POST",        0,   P.LEVEL, "vista: the elm comes into sight (beacon)"],
  ["15-tower-to-roof",    "C_LEADS_E",      "D_GANTRY",      1.5, P.REST,  "down onto the south-row roofline"],
  ["16-roof-vaults",      "D_VAULT_IN_0",   "D_VAULT_OUT_0", 2,   P.REST,  "vaulting the roof chimneys"],
  ["17-roof-to-ropewalk", "D_SROOF_E",      "D2_ROOF_W",     1.5, P.DOWN,  "off the south row onto the ropewalk roof"],
  ["18-ropewalk-hatch",   "D2_ROOF_N",      "D2_BEAM_MID",   1.5, P.DOWN,  "through the hatch onto the tie beam (WALK)"],
  ["19-tie-beam",         "D2_BEAM_MID",    "D2_BEAM_W",     0,   P.LEVEL, "the 1.6m tie beam over the dark (KEY)"],
  ["20-hemp-descent",     "D2_BEAM_W",      "D2_BALES_HIGH", 0,   P.DOWN,  "down the hemp bales"],
  ["21-ropewalk-floor",   "D2_FLOOR_W",     "D2_VAULT_IN",   1.5, P.REST,  "capstan vault / slide / climb-over"],
  ["22-ropewalk-out",     "D2_DOOR",        "D2_OUTSIDE",    1.5, P.REST,  "the lit door out of the ropewalk"],
  ["23-south-face-climb", "D2_OUTSIDE",     "E_BUTTRESS",    1.5, P.UP,    "the sustained south-face climb (KEY)"],
  ["24-steeple-approach", "E_RIDGE",        "E_LOUVRE",      1,   P.UP,    "up the steeple to the gallery"],
  ["25-steeple-leap",     "E_GALLERY",      "F_CROWN",       0,   P.LEVEL, "THE LEAP OF FAITH into the crown (KEY)"],
  ["26-the-post",         "F_POST",         "F_CROWN_E",     0,   P.REST,  "the elm / the beat (nail the handbill)"],
  ["27-elm-descent",      "F_POST",         "F_POST_STEP",   0,   P.DOWN,  "down off the elm onto the low bough"],
  ["28-crowd-blend",      "F_STALL_BACK",   "F_CROWD_S",     1,   P.REST,  "the final crowd crossing under the elm"],
  ["29-the-gate",         "F_CROWD_E",      "G_GATE",        1.5, P.REST,  "the yard gate (3m gap in a 3.6m wall)"],
  ["30-the-yard",         "G_GATE",         "G_SPAWN",       1,   P.REST,  "the rope-walk yard / the duel"],
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
  let wp = null, via = null, title = null, rangeM = null, riseM = null, cap = null;
  if (cur?.mark) {
    const w = cur.mark.waypoint ? cur.mark.waypoint(m.pos) : null;
    if (w) { wp = { x: +w.pos.x.toFixed(1), y: +w.pos.y.toFixed(1), z: +w.pos.z.toFixed(1) }; via = w.via; }
    const r = cur.mark.rangeM ? cur.mark.rangeM(m.pos) : null; if (r) rangeM = +r.metres.toFixed(0);
    title = cur.mark.title; cap = cur.mark.speedCapMps ? cur.mark.speedCapMps(m.pos) : null;
    if (wp) riseM = +(wp.y - m.pos.y).toFixed(1);
  }
  const aff = rt.flow ?? {};
  return {
    tick: rt.ticks, pos: { x: +m.pos.x.toFixed(1), y: +m.pos.y.toFixed(1), z: +m.pos.z.toFixed(1) },
    grounded: m.grounded, verb: aff.verb ?? null, preview: aff.previewVerb ?? null,
    objId: cur?.id ?? null, title, via, rangeM, riseM, cap, wp,
  };
});

const results = [];
for (const [name, at, toward, back, pitch, note] of SHOTS) {
  const url = `${BASE}/src/mission/floor.html?at=${at}&toward=${toward}&back=${back}&encounterVerdict=correct`;
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  const up = await waitRuntime();
  if (!up) { log(`${name}: runtime FAILED`); results.push({ name, error: "no runtime" }); continue; }
  await sleep(3000); // GLBs + wayfinder commit + holds survey
  await page.evaluate((p) => { const L = window.__look; if (L?.look) L.look.pitch = p; }, pitch);
  await sleep(700);
  const s = await READ();
  await page.screenshot({ path: `${OUT}${name}.png` });
  results.push({ name, at, toward, note, state: s });
  log(`${name}  ${at}->${toward}  via=${s?.via} verb/prev=${s?.verb}/${s?.preview} wp=${JSON.stringify(s?.wp)} rise=${s?.riseM} range=${s?.rangeM} cap=${s?.cap ?? "-"}`);
}

writeFileSync(`${OUT}shots.json`, JSON.stringify(results, null, 2));
log("\npage errors:", perr.length, perr.slice(0, 3));
log("done ->", OUT);
await browser.close();
