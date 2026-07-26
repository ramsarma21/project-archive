// What would it cost to make `crowd-market-1765` actually draw?
//
// The key is declared NEEDED but nothing loads it: `sceneryPlacements()` derives
// every visible object from `level.masses` and `level.decks`, and a blend volume
// is neither. So delivering the GLB is not enough — a mass or a deck carrying the
// key has to be authored inside the blend discs before a single triangle reaches
// the screen.
//
// This measures what that would do, because a mass is COLLISION as well as art.
// `placeCluster` walks a body outward from a seeded angle and keeps it only if
// `positionClear` says the capsule fits, and it silently drops a body that never
// finds room — `if (!pos) continue`. So a solid 4 x 1.8 x 4 box standing in the
// middle of a blend disc does not just add scenery, it evicts the rigged bodies
// the blend is counted from.
//
// Run against the shipped level, so the numbers are the level's, not a model's.
//
// Run: node --import tsx assets/pipeline/probe_m1_crowd_counterfactual.mjs
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (...parts) => import(pathToFileURL(join(repoRoot, ...parts)));

const { M1_EFFIGY_RUN } = await load("packages", "mission-m1", "src", "level", "index.ts");
const { ASSETS } = await load("packages", "mission-m1", "src", "assets.ts");
const { civiliansAtTick } = await load("packages", "mission-m1", "src", "runtime.ts");
const { compileLevel } = await load("packages", "mission-m1", "src", "compile.ts");
const { STEALTH_TUNING } = await load(
  "packages", "engine-world", "src", "stealth", "tuning.ts",
);

const KEY = "crowd-market-1765";
const declared = ASSETS.find((asset) => asset.key === KEY);
const [sx, sy, sz] = declared.sizeM;
const FLOOR = STEALTH_TUNING.crowdBlendMinDensity;

const level = M1_EFFIGY_RUN;
const SEEDS = [0xbeef, 0xb057, 0x51de, 7, 11, 13, 0xcafe, 99];

/** Bodies per cluster for a level, at a seed. */
function census(target, seed) {
  const bodies = civiliansAtTick(0, seed, target, compileLevel(target));
  const perCluster = new Map();
  for (const volume of target.blend) {
    const [cx, , cz] = volume.centre;
    perCluster.set(
      volume.id,
      bodies.filter(
        (body) => Math.hypot(body.pos.x - cx, body.pos.z - cz) <= volume.radiusM,
      ).length,
    );
  }
  return perCluster;
}

// One knot per blend volume, at the volume's own centre, sized exactly as
// assets.ts declares it. This is the minimum authoring that would make the
// delivered GLB visible at all.
const knots = level.blend.map((volume) => ({
  id: `${volume.id}_KNOT`,
  section: volume.section,
  asset: KEY,
  rect: {
    minX: volume.centre[0] - sx / 2,
    maxX: volume.centre[0] + sx / 2,
    minZ: volume.centre[2] - sz / 2,
    maxZ: volume.centre[2] + sz / 2,
  },
  baseY: 0,
  topY: sy,
  landable: false,
  tags: ["crowd"],
}));

const withKnots = { ...level, masses: [...level.masses, ...knots] };

console.log(
  `${KEY}: declared ${sx} x ${sy} x ${sz} m, one knot per blend volume at its centre\n` +
    `blend floor: ${FLOOR} bodies\n`,
);

const rows = [];
for (const seed of SEEDS) {
  const before = census(level, seed);
  const after = census(withKnots, seed);
  for (const volume of level.blend) {
    rows.push({
      seed,
      id: volume.id,
      before: before.get(volume.id),
      after: after.get(volume.id),
    });
  }
}

console.log("seed        volume              bodies before  after   lost  blends?");
let worst = Infinity;
let anyBroken = false;
for (const row of rows) {
  const lost = row.before - row.after;
  const blends = row.after >= FLOOR;
  worst = Math.min(worst, row.after);
  if (!blends) anyBroken = true;
  console.log(
    `0x${row.seed.toString(16).padEnd(8)} ${row.id.padEnd(20)} ` +
      `${String(row.before).padStart(11)}  ${String(row.after).padStart(5)}  ` +
      `${String(lost).padStart(5)}  ${blends ? "yes" : "NO — VERB OFF"}`,
  );
}

const lostTotal = rows.reduce((sum, row) => sum + (row.before - row.after), 0);
console.log(
  `\nbodies evicted across ${rows.length} cluster/seed pairs: ${lostTotal}` +
    `  (worst surviving cluster: ${worst} against a floor of ${FLOOR})`,
);
console.log(
  anyBroken
    ? "AT LEAST ONE CLUSTER FALLS BELOW THE FLOOR: the asset would switch blending off."
    : "No cluster falls below the floor, but every evicted body is a body the " +
        "square loses to make room for a knot that cannot be counted, thrown at, " +
        "or animated.",
);

// ---- and what it does to the route -----------------------------------------
//
// A mass is collision, so the only authoring that makes this asset visible also
// puts a solid 4m box in the middle of each crossing the player runs through.
// The level verifies its own traversability; ask it.
const { verifyLevel } = await load("packages", "mission-m1", "src", "traversal.ts");

function routeHealth(target) {
  const { nodeProblems, linkVerdicts } = verifyLevel(target, compileLevel(target));
  return {
    badNodes: [...nodeProblems.entries()].map(([id, why]) => `${id}: ${why.join("; ")}`),
    badLinks: linkVerdicts
      .filter((verdict) => !verdict.ok)
      .map((verdict) => `${verdict.id ?? `${verdict.from}->${verdict.to}`}: ${verdict.problems?.join("; ") ?? verdict.why ?? "not ok"}`),
  };
}

const before = routeHealth(level);
const after = routeHealth(withKnots);
console.log(`\n--- traversability -------------------------------------------`);
console.log(`shipped level   ${before.badNodes.length} bad nodes, ${before.badLinks.length} bad links`);
console.log(`with the knots  ${after.badNodes.length} bad nodes, ${after.badLinks.length} bad links`);

const newNodes = after.badNodes.filter((row) => !before.badNodes.includes(row));
const newLinks = after.badLinks.filter((row) => !before.badLinks.includes(row));
if (newNodes.length) {
  console.log(`\nnodes the knots break (${newNodes.length}):`);
  for (const row of newNodes) console.log(`  ${row}`);
}
if (newLinks.length) {
  console.log(`\nlinks the knots break (${newLinks.length}):`);
  for (const row of newLinks) console.log(`  ${row}`);
}
if (!newNodes.length && !newLinks.length) {
  console.log("\nthe knots break no authored node or link.");
}
