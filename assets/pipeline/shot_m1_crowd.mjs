// Player-scale captures of M1's three crowd volumes.
//
// Aimed at one question: does the market square already read as a market? The
// floor harness mounts the real mission — the same `createMissionRuntime`, the
// same `MissionStage` — so the crowd in these frames is the crowd the stealth
// field counts and a thrown bottle collides with, at the eye height the player
// actually has. An asset-sheet render would not answer the question, because a
// prop sheet cannot show whether a square is full.
//
// Vantages are route nodes, so every frame is somewhere the player could have
// reached rather than a flattering camera.
//
// Run: node assets/pipeline/shot_m1_crowd.mjs <baseUrl> <outDir>
import { chromium } from "/tmp/pw-check/node_modules/playwright/index.mjs";
import { globSync, mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:5251";
const outDir = process.argv[3] ?? "/tmp/m1crowd";
mkdirSync(outDir, { recursive: true });

const candidates = globSync(
  "/var/folders/**/cursor-sandbox-cache/*/playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const exe = candidates[0] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Standing where the route puts the player, facing into each crowd.
const SEED = "48879"; // 0xbeef, the seed the dressing probe measured.
const VANTAGES = [
  ["01-shambles-west-through", "at=B_DUCK&toward=B_STALL_GAP",
    "The Shambles crowd from the west end, looking east through it — the DIVERT_STALL_GAP throw line."],
  ["02-shambles-inside", "at=B_STREET_MID&toward=B_STREET_E",
    "Inside the Shambles crowd on the street line, looking east."],
  ["03-dock-across", "at=B2_CART_W&toward=B2_THRONG_E&back=3",
    "Dock Square from the west, the whole blend crossing in one frame."],
  ["04-dock-inside", "at=B2_THRONG_W&toward=B2_THRONG_E",
    "Standing in the Dock Square throng, which is where the blend is spent."],
  ["05-dock-from-well", "at=B2_WELL&toward=B2_DUCK",
    "From the town pump diagonally across the crossing."],
  ["06-liberty-west", "at=F_CROWD_E&toward=F_STALL_BACK",
    "The crowd under the elm, from the east."],
];

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ["--use-angle=metal", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 240));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 240)));

// Hide the HUD so the frame is the world, not the interface.
await page.addInitScript(() => {
  const hide = () => {
    if (document.getElementById("probe-hide")) return;
    const style = document.createElement("style");
    style.id = "probe-hide";
    style.textContent =
      "[class^='msn-hud'],[class*=' msn-hud'],.msn-curtain{display:none!important}";
    document.head?.appendChild(style);
  };
  if (document.head) hide();
  else document.addEventListener("DOMContentLoaded", hide);
});

for (const [name, query, caption] of VANTAGES) {
  const url = `${base}/src/mission/floor.html?${query}&seed=${SEED}`;
  errors.length = 0;

  // ~100MB of GLB streams in cold and the first frame of a fresh context is
  // empty sky, so the warm-up navigation is not optional.
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(9000);
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(9000);

  // Wind the dawn clock to the budget boundary and no further.
  //
  // Pre-dawn ambient is 0.34 and a dark frame cannot answer a question about how
  // full a square looks — but winding to SUN_UP is worse than dark, because
  // `dawnDispersal01` is zero until the 180s budget is spent and then empties every
  // cluster down to `crowdBlendMinDensity - 1`. At 15000 ticks the square holds 9
  // bodies rather than 36: that is the overrun state the level uses to take a
  // player's cover away, not the state the mission is played in. 180s exactly is
  // the brightest tick at which the crowd is still whole.
  const BUDGET_TICKS = 180 * 60;
  let stage = "?";
  let bodies = -1;
  for (let attempt = 0; attempt < 24; attempt++) {
    const read = await page.evaluate((ticks) => {
      const floor = window.__floor;
      if (!floor) return { stage: "NO_FLOOR", bodies: -1 };
      floor.ticks = ticks;
      return {
        stage: floor.dawn?.stage ?? "NO_DAWN",
        bodies: floor.civilians?.length ?? -1,
      };
    }, BUDGET_TICKS);
    stage = read.stage;
    bodies = read.bodies;
    await page.waitForTimeout(500);
    if (bodies === 36 && attempt >= 3) break;
  }

  const out = `${outDir}/${name}.png`;
  await page.screenshot({ path: out });
  console.log(`WROTE ${out}  dawn=${stage} civilians=${bodies}  — ${caption}`);
  if (errors.length) {
    const unique = [...new Set(errors.map((e) => e.split("\n")[0]))].slice(0, 5);
    console.log(`   console errors (${errors.length}): ${unique.join(" | ")}`);
  }
}

await browser.close();
