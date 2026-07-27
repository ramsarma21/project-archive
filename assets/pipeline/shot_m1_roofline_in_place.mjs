// Look at the roofline in the running game, from the route's own vantages.
//
// Two rebuilds reached this file having never been seen in the renderer. The
// building pass authored seven flat lead decks and swapped two source bodies on
// arithmetic grounds, and it was verified with Blender renders because no dev
// server was up. The surface pass then flattened the canopies, widened the plank
// walk and hung the deck dressings under their own planes. Every one of those is a
// number that now checks out and a picture nobody had looked at.
//
// So the frames are route nodes rather than turntable angles: each one is a place
// the player actually stands, looking where they are actually going. A lead flat
// that measures 100% and reads as a grey slab in the sky is still wrong, and this
// is the only thing that can say so.
//
// Run with a vite dev server already up:
//   node assets/pipeline/shot_m1_roofline_in_place.mjs http://127.0.0.1:5173 outDir [filter]
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173";
const OUT = resolve(process.argv[3] ?? ".shots/m1-roofline-in-place");
mkdirSync(OUT, { recursive: true });

// M1 runs at full dark three minutes before dawn, so the honest frame is dark and
// a dark frame cannot say whether lead reads as lead. Each shot is taken twice:
// once as the player sees it, once with the HUD hidden and the canvas pushed up
// four stops. The second is a darkroom print of the first — the filter is CSS on
// the canvas, so nothing about the scene, its lighting or its assets changes.
const DARKROOM = `
  canvas { filter: brightness(4.2) saturate(1.15) contrast(0.92) !important; }
  body > *:not(canvas) :is(header, aside, footer, nav, section, ul, ol),
  [class*="hud"], [class*="Hud"], [class*="overlay"], [class*="panel"] { display: none !important; }
`;

const SHOTS = [
  // ---- the seven rebuilt building roofs ---------------------------------
  // Standing on the Town House leads at 12.40m looking east along them. This is
  // the deck the whole D roofline hangs off and the one a captain's walk would
  // have failed: it has to be lead from parapet to parapet.
  ["a-townhouse-leads-looking-east", "at=C_LEADS_S&toward=C_LEADS_NE&reduced=1"],
  // The south row from the fire board, which is the first thing the route crosses
  // after the leads. Two roofs at one height with a plank between them.
  ["b-south-row-from-the-fire-board", "at=D_GANTRY&toward=D_VAULT_IN_0&reduced=1"],
  // Along the south row past both chimney stacks. The stacks are the check that
  // the flat is where the collision says: they stood 3.10m off the old ridge.
  ["c-south-row-along-the-vault-rhythm", "at=D_SROOF_N&toward=D_SROOF_E&reduced=1"],
  // The north row, 5.3m below the south. The only crossing of Orange Street.
  ["d-north-row-descending", "at=D_NROOF_W&toward=D_NROOF_E&reduced=1"],
  // The shambles: six shopfronts on one block, so its lead flat is the one where
  // a party wall falls on the probe's own centre line.
  ["e-shambles-roof-along-the-run", "at=B_SHED_W&toward=B_SHED_E&reduced=1"],
  // Backed off the market shed for the whole roofline against the sky. A slab
  // reads as a slab from here and a parapet reads as a parapet.
  ["f-market-shed-roofline-from-the-street", "at=B_STREET_MID&toward=B_SHED_MID&reduced=1"],

  // ---- the two source swaps --------------------------------------------
  // `bldg-printshop` is now the street-warehouse body: a boarded commercial front
  // with loading doors, because the generated printing office was a 2.1m-walled
  // cottage and no scale fits that into 13 x 7.1 x 14m. From the street it either
  // reads as a printing house on Queen Street or it does not.
  ["g-printshop-body-from-the-street", "at=A_STREET&toward=A_HAY&back=9&reduced=1"],
  // And from its own leads, which is where the mission opens.
  ["h-printshop-leads-at-the-opening", "at=A_START&toward=A_SHEETS&reduced=1"],
  // `bldg-meeting-hollis` is the church body with its steeple cut and the whole
  // thing quarter-turned. M1 draws the steeple as its own climbable asset, so the
  // join between the two is the thing to look at.
  ["i-meeting-house-from-the-ropewalk-lane", "at=D2_OUTSIDE&toward=E_MEETING_S&back=9&reduced=1"],
  ["j-meeting-house-from-elliot-roof", "at=E_ELLIOT_ROOF&toward=E_RIDGE&reduced=1"],

  // ---- the deck dressings, hung under their planes ---------------------
  // MEETING_RIDGE at 11.20m. The gambrel walk now has its boards ON the plane
  // instead of above it — and the meeting house body stops at 8.20m, so this is
  // also the frame that says whether three metres of roof are missing under it.
  ["k-meeting-ridge-from-the-gambrel-climb", "at=E_GAMBREL_S&toward=E_RIDGE_W&reduced=1"],
  ["l-meeting-ridge-standing-on-it", "at=E_RIDGE&toward=E_LOUVRE&reduced=1"],
  // The fire board off the leads, 30mm of pine now under the boot rather than
  // over it, spanning a gap with nothing else in it.
  ["m-fire-board-standing-on-it", "at=D_GANTRY&toward=D_SROOF_W&reduced=1"],

  // ---- the flattened canopies ------------------------------------------
  // The stall canopies at 2.55m: five of them in a row, every one of which used
  // to touch its deck on one ridge line.
  ["n-stall-canopies-from-the-shed", "at=B_SHED_W&toward=B_CANOPY_0&reduced=1"],
  ["o-stall-canopy-standing-on-it", "at=B_CANOPY_2&toward=B_CANOPY_4&reduced=1"],
  // A_PENTICE is a launch point — A_PENTICE -> A_HAY_W is a dive onto a hay wain —
  // so this pentice carries a committed leap and had to be right.
  ["p-printshop-pentice-and-the-dive", "at=A_PENTICE&toward=A_HAY_W&reduced=1"],
  ["q-printshop-pentice-from-the-sign", "at=A_SIGN&toward=A_PENTICE&reduced=1"],
  // The two lean-tos, which are mono-pitch rather than ridged: the flattening had
  // no ridge to work from and took the whole slope up to the plane.
  ["r-alley-leanto-from-the-plank", "at=A_PLANK&toward=A_LEANTO&reduced=1"],
  ["s-hollis-leanto-from-the-buttress", "at=E_BUTTRESS&toward=E_LEANTO&reduced=1"],

  // ---- the plank walks -------------------------------------------------
  // The hoist plank across Dassett Alley, 2.95 x 2.40m of deck that was drawing
  // 0.95m of board 0.69m over the player's head.
  ["t-hoist-plank-standing-on-it", "at=A_PLANK&toward=A_ALLEY_LIP&reduced=1"],
  // And the ropewalk's tie beam: nineteen metres of it, four tiles, in the dark.
  ["u-tie-beam-from-the-roof-hatch", "at=D2_ROOF_N&toward=D2_BEAM_MID&reduced=1"],
  ["v-tie-beam-standing-on-it", "at=D2_BEAM_MID&toward=D2_BEAM_W&reduced=1"],

  // ---- the four art gaps, closed --------------------------------------
  // MEETING_RIDGE's dressing is now `roof-ridge-monitor`: three metres of
  // louvred lantern from the building's lead flat at 8.20 up to the walk at
  // 11.20. Shots k and l above are already pointed at it and are the before/
  // after pair — k is the one that showed three metres of sky. This is its
  // north elevation from across the ropewalk roof, which is the only place in
  // the level the whole thing is visible against anything.
  ["w-meeting-monitor-north-elevation", "at=D2_ROOF_N&toward=E_GAMBREL_S&back=6&reduced=1"],
  ["w2-meeting-monitor-from-the-roof-lip", "at=D2_ROOF_N&toward=E_GAMBREL_S&reduced=1"],
  // `bldg-meeting-hollis` itself, which has never been looked at: every vantage
  // on the ground is blocked by the ropewalk's wall to the north or by the
  // Liberty Elm's 16 x 18m canopy to the south, and the canopy reaches z=8.8,
  // which is past the building's own south wall. Standing ON the ropewalk roof
  // at 8.60m clears the first and is nowhere near the second.
  //
  // back=0 rather than backed off, and that is load-bearing: the ropewalk's roof
  // has a HATCH in it at z 19.8..22.8 — the one the route drops through — so any
  // `back` between about 1 and 5 walks the camera's own subject straight down it.
  // The first attempt at this frame did exactly that and came back as a full
  // screen of the tarring shed's boarding, from the inside.
  ["x-meeting-house-over-the-ropewalk-roof", "at=D2_ROOF_N&toward=E_MEETING_S&reduced=1"],
  ["x2-meeting-house-from-the-shed-roof", "at=D2_ROOF_N&toward=E_MEETING_S&back=7&reduced=1"],
  // `printshop-sign-hood` at 6.20m, from the pentice 1.8m under it — the angle
  // the descent actually meets it at — and from the eave lip above.
  ["y-sign-hood-from-the-pentice", "at=A_PENTICE&toward=A_SIGN&reduced=1"],
  ["z-sign-hood-from-the-eave", "at=A_EAVE_S&toward=A_SIGN&reduced=1"],
  // `bldg-scaffold-run`: eleven metres and two lifts, which is the whole point
  // of the key. The street shot is the one that says whether it is a run or a
  // bay, because the bay is what the old art drew.
  // Backed off along C_SQUARE_W rather than C_SQUARE_NW: the NW corner's own
  // line runs south-west into the north row, and seven metres of it puts the
  // camera inside the gaol.
  ["aa-scaffold-run-from-the-square", "at=C_SQUARE_W&toward=C_SCAFF_FOOT&back=5&reduced=1"],
  ["aa2-scaffold-run-from-the-lane", "at=C_SQUARE_NW&toward=C_SCAFF_FOOT&reduced=1"],
  ["ab-scaffold-lower-staging", "at=C_SCAFF_1&toward=C_GALLERY_W&reduced=1"],
  ["ac-scaffold-top-staging", "at=C_SCAFF_2&toward=C_GALLERY_W&reduced=1"],
  // `yard-kerb-stone`: 0.34m, so the question is whether it reads as a step at
  // all from the throng's own eye line before you are standing on it.
  ["ad-pump-kerb-across-the-yard", "at=B2_THRONG_W&toward=B2_KERB&reduced=1"],
  ["ae-pump-kerb-standing-on-it", "at=B2_KERB&toward=B2_WELL&reduced=1"],
];

const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// M1's world is tens of megabytes of GLB and the `load` event does not fire until
// the last byte of it has arrived, so the default 30s navigation budget times out
// on a machine doing anything else. `domcontentloaded` plus an explicit wait for
// the canvas is the same guarantee with a clock that fits the payload.
page.setDefaultNavigationTimeout(240000);
page.setDefaultTimeout(240000);

const missing = new Set();
page.on("response", (response) => {
  if (response.status() >= 400 && response.url().includes("/world/")) {
    missing.add(`${response.status()} ${new URL(response.url()).pathname}`);
  }
});
page.on("console", (message) => {
  const text = message.text();
  if (/GLB load failed|Could not load|THREE.WebGLRenderer: Context Lost/.test(text)) {
    missing.add(text.slice(0, 140));
  }
});

// The whole world streams in on the first navigation and every shot after it is
// served from the browser cache. Without a warm-up the first frame captured is an
// empty sky, and the picture silently disagrees with the code.
console.log("warming the asset cache...");
await page.goto(`${BASE}/src/mission/floor.html?at=D_GANTRY&reduced=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("canvas", { timeout: 60000 });
await page.waitForTimeout(40000);

const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
for (const [name, query] of SHOTS.filter(([n]) => !only || only.test(n))) {
  await page.goto(`${BASE}/src/mission/floor.html?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  const handle = await page.addStyleTag({ content: DARKROOM });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${name}-lit.png`) });
  await handle.evaluate((node) => node.remove());
  console.log("WROTE", name);
}

await browser.close();
if (missing.size) {
  console.error(`\nassets that did not load:`);
  for (const line of missing) console.error(`  ${line}`);
  process.exitCode = 1;
} else {
  console.log("\nevery /world/ request served");
}
