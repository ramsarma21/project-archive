// Capture the Town House as the mission actually draws it.
//
// verify_m1_townhouse.mjs proves the arithmetic — one draw, scale 1.0000, every
// deck the box reaches on plane to a millimetre. This is the other half of the
// same question, and it is not a number: the building has to read as the Old
// State House from the street the run comes up, the runner's feet have to meet
// the leads they are standing on, and the vista off the tower has to have the
// elm in it. Those are things you check by looking.
//
// The shots are chosen off the route, not off a turntable. Every one of them is a
// place the player is actually standing in section C.
//
// Run with a vite dev server already up:
//   node assets/pipeline/shot_townhouse_in_place.mjs http://127.0.0.1:4941 outDir
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:4941";
const OUT = resolve(process.argv[3] ?? ".shots/townhouse-in-place");
mkdirSync(OUT, { recursive: true });

// M1 runs at full dark, three minutes to dawn, and that is the mission — so the
// honest frame is dark and a dark frame is useless for judging brickwork. Each
// shot is therefore taken twice: once as the player sees it, and once with the
// HUD hidden and the canvas pushed up four stops. The second is a darkroom print
// of the first, not a different render: the filter is CSS on the canvas element,
// so nothing about the scene, the lighting or the asset changes.
const DARKROOM = `
  canvas { filter: brightness(4.2) saturate(1.15) contrast(0.92) !important; }
  body > *:not(canvas) :is(header, aside, footer, nav, section, ul, ol),
  [class*="hud"], [class*="Hud"], [class*="overlay"], [class*="panel"] { display: none !important; }
`;

const SHOTS = [
  // The vista the whole route is built around: 17.6m up the tower, looking at
  // the elm. From here the effigy is in sight and every metre after is downhill
  // toward it. If the lookout is not under the camera this shot is inside stone.
  ["vista-elm-from-the-tower", "at=C_TOWER_GALLERY&toward=F_CROWN&reduced=1"],
  // The approach, from the head of the street the run comes up. This is the
  // shot that says whether the building reads as the Old State House.
  ["approach-from-the-west", "at=C_SCAFF_1&toward=C_LEADS_S&back=16&reduced=1"],
  // From the square, looking up the east front: the gable, the clock, the lion
  // and unicorn, and the arcade the road ran round.
  ["east-front-from-the-square", "at=C_GALLERY_EMID&toward=C_GALLERY_W&back=22&reduced=1"],
  // Standing on the leads at 12.4m, at the foot of the tower.
  ["on-the-leads", "at=C_LEADS_S&toward=C_LEADS_TOWERFOOT&reduced=1"],
  // The tower plinth ring at 15.2m, the last walk-around before the lookout.
  ["tower-plinth-ring", "at=C_TOWER_PLINTH&toward=C_TOWER_GALLERY&reduced=1"],
  // The north balcony at 5.6m under the pediment. Fully open to the Old Brick
  // watch except here, which is the one thing that makes the reflex beat work —
  // and the height that is not drawn until sizeM moves.
  ["north-balcony-under-the-hood", "at=C_GALLERY_HOOD&toward=C_GALLERY_E&reduced=1"],
  // The clock ledge at 8.4m, on the east front, mid-climb.
  ["clock-ledge", "at=C_CLOCK&toward=C_CORNICE_E&reduced=1"],
  // From the north lane at street level, looking up at the balcony the fast line
  // comes over. This is the shot that shows the 5.6m gallery in profile, which is
  // the one an 11m draw box could not draw at all.
  ["north-front-from-the-lane", "at=C_LANE_N_E&toward=C_GALLERY_HOOD&reduced=1"],
  // The whole building from the north-west corner of the square, which is where
  // the run first has it in frame.
  ["whole-building-from-the-street", "at=C_LEADS_S&toward=C_GALLERY_W&back=26&reduced=1"],
];

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const missing = new Set();
page.on("response", (response) => {
  if (response.status() >= 400 && response.url().includes("/world/")) {
    missing.add(`${response.status()} ${new URL(response.url()).pathname}`);
  }
});
page.on("console", (message) => {
  const text = message.text();
  if (/GLB load failed|Could not load/.test(text)) missing.add(text.slice(0, 140));
});

// A hundred megabytes of GLB streams in on the first navigation and every shot
// after it is served from the browser cache. Without a warm-up the first frame
// captured is an empty sky, and the picture silently disagrees with the code.
console.log("warming the asset cache...");
await page.goto(`${BASE}/src/mission/floor.html?at=C_LEADS_S&reduced=1`, { waitUntil: "load" });
await page.waitForSelector("canvas", { timeout: 60000 });
await page.waitForTimeout(35000);

const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
for (const [name, query] of SHOTS.filter(([n]) => !only || only.test(n))) {
  await page.goto(`${BASE}/src/mission/floor.html?${query}`, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await page.waitForTimeout(9000);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  console.log("WROTE", path);
  const handle = await page.addStyleTag({ content: DARKROOM });
  await page.waitForTimeout(600);
  const lit = join(OUT, `${name}-lit.png`);
  await page.screenshot({ path: lit });
  await handle.evaluate((node) => node.remove());
  console.log("WROTE", lit);
}

await browser.close();
if (missing.size) {
  console.error(`\nassets that did not load:`);
  for (const line of missing) console.error(`  ${line}`);
  process.exitCode = 1;
} else {
  console.log("\nevery /world/ request served");
}
