// Capture the two standable props as the mission actually draws them.
//
// `verify_m1_placements.mjs` and `probe_m1_standing_surfaces.mjs` prove the
// arithmetic: bounds equal to the declaration, a contain-fit at 1.0000, and 25 of
// 25 rays finding drawn surface at the plane the route stands on. This is the
// other half, and it is not a number — the dive target has to READ as a thing you
// aim a leap at from the pentice above it, and the buttress has to read as the
// first hold of a climb rather than as a box against a wall.
//
// The frames are route nodes, not turntable angles: every one is somewhere the
// player is actually standing.
//
// Run with a vite dev server already up:
//   node assets/pipeline/shot_m1_standing_in_place.mjs http://127.0.0.1:4941 outDir
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:4941";
const OUT = resolve(process.argv[3] ?? ".shots/m1-standing-in-place");
mkdirSync(OUT, { recursive: true });

// M1 runs at full dark three minutes before dawn, so the honest frame is dark and
// a dark frame is useless for judging hay or granite. Each shot is taken twice:
// once as the player sees it, once with the HUD hidden and the canvas pushed up
// four stops. The second is a darkroom print of the first — the filter is CSS on
// the canvas, so nothing about the scene, the lighting or the asset changes.
const DARKROOM = `
  canvas { filter: brightness(4.2) saturate(1.15) contrast(0.92) !important; }
  body > *:not(canvas) :is(header, aside, footer, nav, section, ul, ol),
  [class*="hud"], [class*="Hud"], [class*="overlay"], [class*="panel"] { display: none !important; }
`;

const SHOTS = [
  // The dive. A_PENTICE -> A_HAY_W is a DROP the player commits to, so this is
  // the frame that decides whether the landing reads as big enough to aim at.
  // `hay-cart` stood here with its top 1.17m under the surface that catches you.
  ["wain-dive-target-from-the-pentice", "at=A_PENTICE&toward=A_HAY_W&reduced=1"],
  // Standing on the load at 2.20m, looking along the run to the second wain.
  // Both wains are in frame: they are 2.2m apart and must not overhang.
  ["wain-standing-on-the-load", "at=A_HAY_W&toward=A_HAY&reduced=1"],
  // From the street the run drops into, looking back at the pair under the
  // printshop's south-east corner.
  ["wain-pair-from-the-street", "at=A_STREET&toward=A_HAY&reduced=1"],
  // Out of the ropewalk door. The buttress is the first of six holds, and this is
  // the frame that says whether the player can see it is climbable.
  ["buttress-out-of-the-ropewalk-door", "at=D2_OUTSIDE&toward=E_BUTTRESS&reduced=1"],
  // Backed off down the lane, for the whole mass against the meeting house wall.
  ["buttress-from-down-the-lane", "at=D2_OUTSIDE&toward=E_BUTTRESS&back=6&reduced=1"],
  // Left standing on top of it at 2.60m, facing the next hold. This is the shot
  // the 1.45m standable-span floor exists for: a body has to fit up here.
  ["buttress-standing-on-top", "at=E_BUTTRESS&toward=E_LEANTO&reduced=1"],
];

// CHROME_BIN is an escape hatch, not a preference. Playwright resolves its
// browser out of PLAYWRIGHT_BROWSERS_PATH and then appends a platform folder it
// picks itself, and in a sandboxed session it asked for a mac-x64 shell on an
// arm64 machine with an arm64 build sitting right there. An explicit
// executablePath skips the whole resolution and costs nothing when the default
// works, which is why it is a fallback rather than a requirement.
const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
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

// The whole world streams in on the first navigation and every shot after it is
// served from the browser cache. Without a warm-up the first frame captured is an
// empty sky, and the picture silently disagrees with the code.
console.log("warming the asset cache...");
await page.goto(`${BASE}/src/mission/floor.html?at=A_HAY_W&reduced=1`, { waitUntil: "load" });
await page.waitForSelector("canvas", { timeout: 60000 });
await page.waitForTimeout(35000);

const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
for (const [name, query] of SHOTS.filter(([n]) => !only || only.test(n))) {
  await page.goto(`${BASE}/src/mission/floor.html?${query}`, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  const handle = await page.addStyleTag({ content: DARKROOM });
  await page.waitForTimeout(600);
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
