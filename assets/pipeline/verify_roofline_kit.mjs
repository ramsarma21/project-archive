// Verify the roofline kit against the collision M1 already authored.
//
// Same rule as the elm's verifier and the same reason for existing: the art fits
// the hull, never the reverse, so this reads the hull out of GEOMETRY and
// measures the shipped mesh against it rather than against a spec sheet. And
// like that one, every probe runs in the frame the mission actually draws —
// `sceneryPlacements()` is asked where each prop goes, FittedGlb's contain-fit
// and bottom-align are reproduced exactly, and only then is anything measured.
// A mesh that fits its hull perfectly and reaches the screen at a third of its
// size has to fail here, because that is the failure the asset sheet exists for.
//
// Two kinds of check, because this kit has two kinds of asset:
//
//   DECK  a surface. Cast rays straight down over a grid on the authored rect
//         and ask, for each one, the height of the first thing a falling foot
//         meets. Anything more than TOL_ABOVE over the plane is a boot sunk
//         into the prop; anything under TOL_BELOW is a foot on air.
//
//   MASS  a volume. The box the mesh actually draws is compared to the box the
//         player is stopped by, axis for axis, because a uniformly-scaled mesh
//         in a box shaped nothing like it draws a fraction of itself and lands
//         in the right place anyway. This is the check that catches one key
//         being asked to be two different objects.
//
// ONE SCENE PER DRAW
// ------------------
// This file used to load one scene per ASSET and reuse it across that asset's
// draws. The fit recomputed its bounding box from the scene it had just moved,
// so only the first draw of a key landed where the level puts it and every later
// one was positioned against a box that had already been translated. It did not
// error: `roof-chimney-stack` reported CHIMNEY_0 at 100.0% and CHIMNEY_1,
// ROPEWALK_VENT_0 and ROPEWALK_VENT_1 at 0.0% — from an identical mesh, in an
// identical box, at scale 1.0000 — and three of those four zeros were the tool's.
//
// The fit and the survey now live in `placement_probe.mjs`, shared with
// `verify_m1_placements.mjs` so the two cannot drift apart again, and a scene is
// PARSED FRESH for every draw. Resetting the transform between draws would also
// have worked, but it is the same discipline that failed the first time: it asks
// a future editor to remember every field that has to be put back, and forgetting
// produces a plausible wrong number rather than a crash. A scene that has never
// been touched cannot be measured against a stale box, and `placeInto` refuses a
// scene it has already placed so the old pattern cannot come back quietly.
//
// Run: node --import tsx assets/pipeline/verify_roofline_kit.mjs
globalThis.self = globalThis;
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DECK_MIN_PCT,
  FOOTPRINT_TOL,
  MASS_TOP_MIN_PCT,
  TOL_ABOVE,
  placeInto,
  sceneSource,
  shortfallOf,
  surveyFirstHit,
} from "./placement_probe.mjs";
import { selfTestGate } from "./placement_selftest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const threeRoot = join(repoRoot, "apps", "web", "node_modules", "three");
const THREE = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);
const { sceneryPlacements } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "runtime.ts"))
);
const { M1_EFFIGY_RUN } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "level", "index.ts"))
);

const args = process.argv.slice(2);
const keys = args.filter((arg) => !arg.startsWith("--"));
/** `--self-test` lists every invariant; `--self-test-only` stops after them. */
const showSelfTest = args.includes("--self-test") || args.includes("--self-test-only");
const KEYS = keys.length
  ? keys
  : ["roof-plank-gantry", "roof-ridge-walk", "roof-chimney-stack", "service-wall-end"];

// The instrument proves itself before it measures anything. A tool that has been
// wrong four times does not get to report a number on trust.
if (!selfTestGate({ THREE, label: "roofline kit", verbose: showSelfTest })) {
  process.exit(1);
}
if (args.includes("--self-test-only")) process.exit(0);

const GRID = 21;

let failures = 0;
function fail(message) {
  console.error(`  FAIL ${message}`);
  failures++;
  process.exitCode = 1;
}

const placements = sceneryPlacements();
const decksById = new Map(M1_EFFIGY_RUN.decks.map((deck) => [deck.id, deck]));
const massesById = new Map(M1_EFFIGY_RUN.masses.map((mass) => [mass.id, mass]));

for (const key of KEYS) {
  const draws = placements.filter((placement) => placement.asset === key);
  if (draws.length === 0) {
    console.log(`\n=== ${key}\n  nothing in the level draws this key`);
    continue;
  }
  const path = resolve(repoRoot, "apps", "web", "public", draws[0].assetPath);
  console.log(`\n=== ${key}`);
  if (!existsSync(path)) {
    fail(`nothing shipped at ${path.replace(repoRoot + "/", "")}`);
    continue;
  }
  const bytes = statSync(path).size;
  const source = await sceneSource(THREE, GLTFLoader, readFileSync(path));
  const [nx, ny, nz] = source.natural;
  console.log(
    `  file    ${(bytes / 1024).toFixed(0)} KiB   ${source.tris.toLocaleString()} tris   ` +
      `natural ${nx.toFixed(3)} x ${ny.toFixed(3)} x ${nz.toFixed(3)}` +
      `   minY ${source.naturalMinY.toFixed(4)}`,
  );
  console.log(`  drawn   ${draws.length} time${draws.length === 1 ? "" : "s"}`);

  // FittedGlb bottom-aligns on the bounding box, so a mesh whose floor is not at
  // zero is lifted by exactly that much wherever it is placed.
  if (Math.abs(source.naturalMinY) > 0.001) {
    fail(
      `mesh minY is ${source.naturalMinY.toFixed(4)}, not 0: every placement is offset by that`,
    );
  }

  for (const placement of draws) {
    const placed = placeInto(THREE, await source.next(), placement, source.natural);
    const drawn = placed.drawn;
    const targets = placed.targets;
    const label = placement.id.padEnd(18);
    const scaleText =
      placed.uniformScale !== null
        ? `scale ${placed.uniformScale.toFixed(4)}`
        : `scale ${placed.scale.map((v) => v.toFixed(4)).join("/")}`;
    console.log(
      `  ${label} box ${placement.size.map((v) => v.toFixed(2)).join(" x ")}` +
        `  ${scaleText}` +
        `  draws ${drawn.x.toFixed(2)} x ${drawn.y.toFixed(2)} x ${drawn.z.toFixed(2)}`,
    );

    if (placed.uniformScale !== null && placed.uniformScale < 0.999) {
      // Not fatal on its own — one key drawn at several boxes can only match the
      // tightest — but it is always worth saying out loud.
      console.log(
        `  ${" ".repeat(18)} note: contain-fit shrank it to ` +
          `${(placed.uniformScale * 100).toFixed(1)}% ` +
          `because the box is a different shape from the mesh`,
      );
    }

    if (placement.kind === "DECK") {
      for (const partId of placement.parts) {
        const deck = decksById.get(partId);
        if (!deck) continue;
        const survey = surveyFirstHit(THREE, targets, deck, deck.y, { grid: GRID });
        console.log(
          `  ${" ".repeat(18)} ${partId} y=${deck.y.toFixed(2)}  ` +
            `on the plane ${survey.covered}/${survey.total} (${survey.pct.toFixed(1)}%)  ` +
            `dy min ${survey.dyMin === null ? "n/a" : survey.dyMin.toFixed(3)} ` +
            `max ${survey.dyMax === null ? "n/a" : survey.dyMax.toFixed(3)} ` +
            `mean ${survey.dyMean === null ? "n/a" : survey.dyMean.toFixed(3)}`,
        );
        console.log(
          `  ${" ".repeat(18)} walking on air ${survey.air}   art above the deck ${survey.above}`,
        );
        if (survey.pct < DECK_MIN_PCT) {
          fail(`${partId}: only ${survey.pct.toFixed(1)}% of the deck has wood under the foot`);
        }
        if (survey.above > 0) {
          fail(
            `${partId}: ${survey.above} samples sit more than ${(TOL_ABOVE * 1000).toFixed(0)}mm ` +
              `above the plane the player walks on`,
          );
        }
      }
      continue;
    }

    // A mass. Does the drawn box fill the box the player is stopped by?
    for (const partId of placement.parts) {
      const mass = massesById.get(partId);
      if (!mass) continue;
      const want = [
        mass.rect.maxX - mass.rect.minX,
        mass.topY - mass.baseY,
        mass.rect.maxZ - mass.rect.minZ,
      ];
      const got = [drawn.x, drawn.y, drawn.z];
      const short = shortfallOf(want, got);
      console.log(
        `  ${" ".repeat(18)} ${partId} collision ${want.map((v) => v.toFixed(2)).join(" x ")}` +
          `  shortfall ${short.map((v) => (v > 0 ? "+" : "") + v.toFixed(2)).join(" / ")}` +
          `  ${mass.landable === false ? "not landable" : "landable"}`,
      );
      const axes = ["x", "height", "z"];
      short.forEach((value, axis) => {
        if (value > FOOTPRINT_TOL) {
          fail(
            `${partId}: the draw is ${value.toFixed(2)}m short on ${axes[axis]} ` +
              `(${got[axis].toFixed(2)}m of a ${want[axis].toFixed(2)}m collision), so the player ` +
              `meets ${axes[axis] === "height" ? "collision above the art" : "collision beside the art"}`,
          );
        }
      });

      if (mass.landable !== false) {
        const survey = surveyFirstHit(THREE, targets, mass, mass.topY, { grid: GRID });
        console.log(
          `  ${" ".repeat(18)} ${partId} top y=${mass.topY.toFixed(2)}  ` +
            `on the plane ${survey.covered}/${survey.total} (${survey.pct.toFixed(1)}%)  ` +
            `above ${survey.above}   air ${survey.air}`,
        );
        if (survey.above > 0) {
          fail(`${partId}: ${survey.above} samples sit above the top the player vaults`);
        }
        if (survey.pct < MASS_TOP_MIN_PCT) {
          fail(
            `${partId}: only ${survey.pct.toFixed(1)}% of the top is at the height the player ` +
              `lands on`,
          );
        }
      }
    }
  }
}

console.log(
  failures === 0
    ? `\nVERIFY OK: ${KEYS.length} assets, every draw reproduced and measured against GEOMETRY`
    : `\nVERIFY FAILED: ${failures} problem${failures === 1 ? "" : "s"}`,
);
