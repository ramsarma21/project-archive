// Legible, brightened frames of the Liberty Elm from a player's eye, to settle
// the ONLY question a numeric trace cannot: does the tree draw as a tree, or as
// the "smeared squat cylinder under shattered green planes" the owner saw?
//
// The scene is pre-dawn (ambient 0.34), so the capture explicitly lights it:
// tone-mapping exposure is raised and every scene light boosted. This is a
// capture-time lighting change, declared here, not a change to the mission.
//   node .affordwork/capture-elm.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "elm-shots");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:5273";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Raise exposure and boost every light so pre-dawn geometry is legible.
const BRIGHTEN = () => {
  const st = window.__stage;
  if (!st?.gl) return "no stage";
  st.gl.toneMappingExposure = 3.2;
  let lights = 0;
  st.scene.traverse((o) => { if (o.isLight) { o.intensity *= 6; lights++; } });
  return `exposure=3.2 lightsBoosted=${lights}`;
};
const AIM = (yaw) => { const L = window.__look; if (L?.look) L.look.yaw = yaw; };

async function boot(page, url) {
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  for (let i = 0; i < 300; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) return true;
    await sleep(200);
  }
  return false;
}

const browser = await chromium.launch({ headless: true, executablePath: CHROME, args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });

const SHOTS = [
  // label, at-node, look-target [x,z]  (aim yaw computed from the player pos)
  ["A-base-close",  "F_STALL_BACK", [80.15, 0.8]],   // at the base, looking at the bole
  ["B-from-east",   "F_CROWD_E",    [80.15, 0.8]],    // stand east, whole tree to the west
  ["C-from-street", "F_VAULT_OUT",  [80.15, 0.8]],    // further east on the crossing
  ["D-from-crown",  "F_CROWN_E",    [80.15, 0.8]],    // up on a limb, canopy around
];

for (const [label, at, target] of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const url = `${BASE}/src/mission/floor.html?at=${at}&toward=F_POST&encounterVerdict=correct`;
  if (!(await boot(page, url))) { console.log(`${label}: runtime never came up`); await page.close(); continue; }
  await sleep(7000); // GLBs load + settle
  const b = await page.evaluate(BRIGHTEN);
  // Aim at the trunk from the player's actual position.
  const pos = await page.evaluate(() => { const m = window.__floor.motion.pos; return { x: m.x, z: m.z }; });
  await page.evaluate((y) => { const L = window.__look; if (L?.look) L.look.yaw = y; }, Math.atan2(target[0] - pos.x, target[1] - pos.z));
  await sleep(500);
  await page.screenshot({ path: join(OUT, `${label}.png`) });
  console.log(`${label}: ${b}  playerPos=(${pos.x.toFixed(1)},${pos.z.toFixed(1)})`);
  await page.close();
}
await browser.close();
console.log("done ->", OUT);
