// Capture the Liberty elm as the mission actually draws it.
//
// verify_liberty_elm.mjs proves the arithmetic — one draw, scale 1.0000, every
// tier under the foot. This is the other half of the same question, because the
// bar for a tree is not a number: it has to read as a tree at the right size
// from the vista where the player first sees it, and the runner's feet have to
// meet the limb they are standing on. Those are things you check by looking.
//
// The ropewalk shots are here for the same reason. It is the mission's only
// interior, it lives under world/structures rather than world/props, and for as
// long as the renderer prefixed a fixed directory it drew nothing at all.
//
// Run with a vite dev server already up:
//   node assets/pipeline/shot_elm_in_place.mjs http://127.0.0.1:4939 outDir
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:4939";
const OUT = resolve(process.argv[3] ?? "assets/build/world-m1-elm/qa");
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  // The vista the route is built around: 17.6m up the Town House tower, where
  // the effigy comes into sight and every metre after is downhill toward it.
  ["ingame-vista-townhouse", "at=C_TOWER_GALLERY&toward=F_CROWN&reduced=1"],
  // Standing on the crown bough, in the beat's own stance: the 8.3m tier where
  // the handbill is nailed up.
  ["ingame-crown-bough", "at=F_POST&reduced=1"],
  // Out along the crown limb, clear of the bole.
  ["ingame-crown-limb", "at=F_CROWN_E&toward=F_CROWN&reduced=1"],
  // The approach, from the roof the leap of faith leaves from.
  ["ingame-approach", "at=E_ELLIOT_LIP&toward=F_CROWN&reduced=1"],
  // From the yard gate, looking back west at the whole tree from street level.
  ["ingame-from-the-yard", "at=G_GATE&toward=F_CROWN&back=8&reduced=1"],
  // Inside the ropewalk, on the tie beam four metres over an unlit floor.
  ["ingame-ropewalk-inside", "at=D2_BEAM_E&toward=D2_BEAM_W&reduced=1"],
  // And the shed from outside, so the shell is visible as a shed.
  ["ingame-ropewalk-outside", "at=D2_OUTSIDE&toward=D2_DOOR&back=14&reduced=1"],
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

// A hundred megabytes of GLB streams in on the first navigation, and every shot
// after it is served from the browser cache. Without a warm-up the first frame
// captured is an empty sky and the picture silently disagrees with the code.
console.log("warming the asset cache...");
await page.goto(`${BASE}/src/mission/floor.html?at=F_POST&reduced=1`, { waitUntil: "load" });
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(30000);

for (const [name, query] of SHOTS) {
  await page.goto(`${BASE}/src/mission/floor.html?${query}`, { waitUntil: "load" });
  // The canvas suspends while every GLB streams in; there is no single ready
  // event, so settle on a fixed dwell and let the HUD prove the run is live.
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(12000);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  console.log("WROTE", path);
}

if (missing.size > 0) {
  console.log("\nassets that did not load:");
  for (const entry of missing) console.log(" ", entry);
} else {
  console.log("\nevery world asset requested loaded");
}
await browser.close();
