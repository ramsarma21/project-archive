// Capture the mission clock as the player sees it: the sky, the HUD and the crowd
// at three points on the same run.
//
// The clock is tick-driven, so this script does not sleep for a guessed number of
// wall seconds — it waits on the simulation's own tick count through the floor
// harness's `window.__floor` handle. That distinction is not pedantry: headless
// chromium with a hundred megabytes of GLB in it drops fixed steps, so 180 wall
// seconds is not 180 simulated ones, and a shot taken on a stopwatch would be
// captioned with a time the run never reached.
//
// Run with a vite dev server already up:
//   node assets/pipeline/qa_dawn_clock_browser.mjs http://127.0.0.1:4939 .shots/dawn-clock
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:4939";
const OUT = resolve(process.argv[3] ?? ".shots/dawn-clock");
mkdirSync(OUT, { recursive: true });

// Two vantage points, both well outside the final court, so the one authored way
// to lose this floor cannot fire while the camera is parked there for four
// minutes. The tower gallery is 17.6 m up with the town, the elm and most of the
// sky in frame; the stall canopy looks east down the Shambles at a market crowd,
// which is what a thinning crowd has to be photographed against.
const RUNS = [
  {
    id: "vista",
    query: "at=C_TOWER_GALLERY&toward=F_CROWN&reduced=1",
    note: "the tower gallery: sky, town and HUD",
  },
  {
    id: "market",
    query: "at=B_CANOPY_1&toward=B_CANOPY_3&reduced=1",
    note: "a stall canopy over the Shambles crowd",
  },
];

/** Where on the clock to stop and look, as a function of the level's own budget. */
function marks(budgetS) {
  return [
    { name: "1-night", atS: 12, why: "twelve seconds in: full dark" },
    { name: "2-greying", atS: budgetS - 8, why: "eight seconds to dawn" },
    { name: "3-dawn", atS: budgetS + 12, why: "twelve seconds past dawn" },
    { name: "4-sun-up", atS: budgetS + 32, why: "the crowds have gone home" },
  ];
}

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
  if (/GLB load failed|Could not load|crowd parity/.test(text)) {
    missing.add(text.slice(0, 160));
  }
});
page.on("pageerror", (error) => missing.add(`pageerror ${String(error).slice(0, 200)}`));

// A hundred megabytes of GLB streams in on the first navigation and every run
// after it is served from the browser cache. Without this the first frame captured
// is an empty sky and the picture silently disagrees with the code.
console.log("warming the asset cache...");
await page.goto(`${BASE}/src/mission/floor.html?at=F_POST&reduced=1`, {
  waitUntil: "load",
});
await page.waitForSelector("canvas", { timeout: 60000 });
await page.waitForTimeout(35000);

const log = [];

for (const run of RUNS) {
  console.log(`\n=== ${run.id}: ${run.note}`);
  await page.goto(`${BASE}/src/mission/floor.html?${run.query}`, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 60000 });
  // The handle the harness publishes, once the first frame has stepped the run.
  await page.waitForFunction(() => (window.__floor?.ticks ?? 0) > 0, null, {
    timeout: 60000,
    polling: 250,
  });
  await page.waitForTimeout(12000);

  const budgetS = await page.evaluate(
    () => window.__floor.instance.traversalBudgetS,
  );
  console.log(`  the level declares a ${budgetS}s budget`);

  for (const mark of marks(budgetS)) {
    // Waiting on simulated seconds, never on wall seconds.
    await page.waitForFunction(
      (target) => (window.__floor?.dawn?.elapsedS ?? 0) >= target,
      mark.atS,
      { timeout: 900000, polling: 500 },
    );
    const read = await page.evaluate(() => {
      const runtime = window.__floor;
      const thickest = runtime.crowdClusters.reduce(
        (most, cluster) => Math.max(most, cluster.density),
        0,
      );
      return {
        elapsedS: Number(runtime.dawn.elapsedS.toFixed(2)),
        budgetS: runtime.dawn.budgetS,
        remainingS: Number(runtime.dawn.remainingS.toFixed(2)),
        pastS: Number(runtime.dawn.pastS.toFixed(2)),
        lift01: Number(runtime.dawn.lift01.toFixed(4)),
        stage: runtime.dawn.stage,
        shadowHold01: Number(runtime.dawn.shadowHold01.toFixed(4)),
        dispersal01: Number(runtime.dawn.dispersal01.toFixed(4)),
        civilians: runtime.civilians.length,
        thickestCrowd: thickest,
        droppedSteps: runtime.droppedSteps,
        outcome: runtime.outcome?.kind ?? null,
      };
    });
    const path = join(OUT, `${run.id}-${mark.name}.png`);
    await page.screenshot({ path });
    log.push({ run: run.id, mark: mark.name, why: mark.why, ...read });
    console.log(
      `  ${mark.name.padEnd(9)} t=${String(read.elapsedS).padStart(6)}s ` +
        `lift=${read.lift01.toFixed(3)} stage=${read.stage.padEnd(11)} ` +
        `bodies=${String(read.civilians).padStart(2)} thickest=${read.thickestCrowd} ` +
        `dropped=${read.droppedSteps}${read.outcome ? ` OUTCOME=${read.outcome}` : ""}`,
    );
    console.log(`             -> ${path}`);
  }
}

writeFileSync(join(OUT, "readings.json"), `${JSON.stringify(log, null, 2)}\n`);

if (missing.size > 0) {
  console.log("\nproblems reported by the page:");
  for (const entry of missing) console.log(" ", entry);
} else {
  console.log("\nevery world asset requested loaded, and no parity complaints");
}
await browser.close();
