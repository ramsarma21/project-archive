// Photograph the asset sheet, so an art judgement is made against a picture.
//
// /src/world/assetSheet.html draws any GLB into the exact box the level hands
// FittedGlb, with the imported player rig beside it as a 1.55m ruler. That is the
// only place a fit failure is obvious: a mesh whose proportions disagree with its
// box draws a fraction of itself and still lands in the right place, which reads
// as "the art is a bit thin" in a mission eighty metres long and as a doll's
// house next to a boy here.
//
// Run with the web dev server already up (do NOT start a second one):
//   node assets/pipeline/shot_asset_sheet.mjs http://127.0.0.1:5173 assets/build/world-m1-roofline-opt/qa
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "../..");
const BASE = process.argv[2] ?? "http://127.0.0.1:5173";
const OUT = resolve(process.argv[3] ?? "assets/build/world-m1-roofline-opt/qa");
mkdirSync(OUT, { recursive: true });

const SHOTS = [
  // The pier in the box the arcade actually gives it, with the Town House it
  // stands under beside it. Both at once because the pier's job is to be that
  // building's ground floor, so its brick has to be that building's brick.
  [
    "pier-against-townhouse",
    "cells=service-wall-end:0.6x3.4x1.0,bldg-townhouse-civic:11x17.6x11&pitch=13&dist=40",
  ],
  // The pier as a run of five, which is what Dock Square is: an arcade reads or
  // fails as a rhythm, not as one pier.
  [
    "pier-arcade-run",
    "cells=" + Array(5).fill("service-wall-end:0.6x3.4x1.0").join(",") + "&pitch=2.8&dist=17",
  ],
  // The pier alone, close, beside the ruler. A single cell wants pitch=1: the
  // sheet lays out on PITCH * max(1, n-1), so one cell at pitch 6 stands three
  // metres off centre and half out of frame.
  ["pier-close", "cells=service-wall-end:0.6x3.4x1.0&pitch=1&dist=8"],
  // And the same key in the box the Hollis buttress hands it, which is the
  // failure this kit cannot fix in art.
  ["pier-as-hollis-buttress", "cells=service-wall-end:2.4x2.6x1.2&pitch=1&dist=9"],
  // The rope house in the box the level gives it, from outside, with the rig for
  // scale. `fill=1` because a structural shell is scaled per axis onto its box,
  // which is what the mission does with this one.
  // pitch is what sizes the ground plate as well as the spacing, so a single
  // cell at pitch 1 stands on a one-metre strip and looks like it is floating.
  ["ropewalk-outside", "cells=int-shell-ropewalk-a:22x8.6x10&fill=1&pitch=24&dist=34"],
  // High enough to see the leads and the hatch the player drops through.
  ["ropewalk-from-above", "cells=int-shell-ropewalk-a:22x8.6x10&fill=1&pitch=24&dist=52"],
  // The north face, where the door is, close.
  ["ropewalk-door", "cells=int-shell-ropewalk-a:22x8.6x10&fill=1&pitch=8&dist=17"],
];

// The other half of the evidence: the mission's own harness, drawing the level
// rather than a cell. `at=` is an authored anchor in the route.
const PLACE_SHOTS = [
  // The rope house from the street it stands on, from its own roof, and from the
  // tie beam inside it.
  ["place-ropewalk-outside", "at=D2_OUTSIDE&toward=D2_DOOR&back=16&reduced=1"],
  ["place-ropewalk-roof", "at=D2_ROOF_W&toward=D2_ROOF_N&reduced=1"],
  ["place-ropewalk-inside", "at=D2_BEAM_E&toward=D2_BEAM_W&reduced=1"],
  // Down the Dock Square arcade, at the height the player runs it, which is the
  // only place the piers are a rhythm rather than a prop.
  ["place-arcade-lane", "at=B2_ARCADE_PIER&toward=B2_ARCADE_N&reduced=1"],
  ["place-arcade-mouth", "at=B2_ARCADE_MOUTH&toward=B2_ARCADE_S&reduced=1"],
];

const shellCandidates = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  join(ROOT, ".pw-browsers"),
  "/tmp/pw-browsers",
].filter(Boolean);

async function launch() {
  const { statSync } = await import("node:fs");
  for (const base of shellCandidates) {
    for (const leaf of [
      "chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chromium-1228/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
    ]) {
      const path = join(base, leaf);
      try {
        statSync(path);
        return chromium.launch({
          executablePath: path,
          args: ["--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
        });
      } catch {
        /* next */
      }
    }
  }
  throw new Error(`no chromium under ${shellCandidates.join(", ")}`);
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const missing = new Set();
page.on("response", (response) => {
  if (response.status() >= 400 && response.url().includes("/world/")) {
    missing.add(`${response.status()} ${new URL(response.url()).pathname}`);
  }
});
page.on("console", (message) => {
  const text = message.text();
  if (/GLB load failed|Could not load|Failed to/.test(text)) missing.add(text.slice(0, 160));
  if (message.type() === "error") console.log("  console.error:", text.slice(0, 400));
});
// A blank page here is almost always a module that failed to evaluate, and the
// sheet imports @pa/mission-m1, so say so rather than timing out on a selector.
page.on("pageerror", (error) => console.log("  pageerror:", String(error).slice(0, 400)));

for (const [name, query] of SHOTS) {
  await page.goto(`${BASE}/src/world/assetSheet.html?${query}`, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 30000 });
  // No single ready event exists while the GLBs stream and suspend; settle on a
  // dwell, the same way the elm's in-place harness does.
  await page.waitForTimeout(9000);
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  console.log("WROTE", path);
}

if (process.env.SKIP_IN_PLACE !== "1") {
  // A hundred megabytes of level streams in on the first navigation; without a
  // warm-up the first capture is an empty sky.
  //
  // The dwell is also the light. M1's clock IS the light level — the run opens in
  // full dark and the three minutes are the last of the night — so a shot taken
  // twelve seconds after load is a photograph of a black rectangle whatever the
  // art is. PLACE_DWELL_MS near the end of the clock is how the mission's own
  // harness gets asked for daylight.
  const dwell = Number(process.env.PLACE_DWELL_MS ?? "") || 12000;
  console.log(`warming the level, then dwelling ${(dwell / 1000).toFixed(0)}s per shot...`);
  await page.goto(`${BASE}/src/mission/floor.html?at=D2_OUTSIDE&reduced=1`, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(30000);
  for (const [name, query] of PLACE_SHOTS) {
    await page.goto(`${BASE}/src/mission/floor.html?${query}`, { waitUntil: "load" });
    const live = await page
      .waitForSelector("canvas", { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (!live) {
      console.log(`SKIP  ${name} (the mission harness did not come up)`);
      continue;
    }
    await page.waitForTimeout(dwell);
    const path = join(OUT, `${name}.png`);
    await page.screenshot({ path });
    console.log("WROTE", path);
  }
}

if (missing.size > 0) {
  console.log("\nassets that did not load:");
  for (const entry of missing) console.log(" ", entry);
} else {
  console.log("\nevery world asset requested loaded");
}
await browser.close();
