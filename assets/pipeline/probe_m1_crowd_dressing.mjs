// What is already standing inside M1's blend volumes.
//
// Written to answer one question with measurements rather than opinion: does the
// square already read as a market, and would a `crowd-market-1765` GLB be drawn
// at all? Both halves matter, and the second is the one that decides the asset.
//
// `sceneryPlacements()` derives every visible object from the collision hull, and
// it reads `level.masses` and `level.decks` ONLY — never `level.blend`. So a
// blend volume's `asset` field has no consumer in the draw path, and the only
// code that reads it is route.test.ts's declaration-consistency check. This
// prints that fact per volume alongside the dressing and the bodies, so the
// conclusion is checkable rather than asserted.
//
// Run: node --import tsx assets/pipeline/probe_m1_crowd_dressing.mjs
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (...parts) => import(pathToFileURL(join(repoRoot, ...parts)));

const { M1_EFFIGY_RUN } = await load("packages", "mission-m1", "src", "level", "index.ts");
const { ASSETS } = await load("packages", "mission-m1", "src", "assets.ts");
const { sceneryPlacements, civiliansAtTick } = await load(
  "packages", "mission-m1", "src", "runtime.ts",
);
const { compileLevel } = await load("packages", "mission-m1", "src", "compile.ts");
const { STEALTH_TUNING } = await load(
  "packages", "engine-world", "src", "stealth", "tuning.ts",
);

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const placements = sceneryPlacements(level);
const declared = new Map(ASSETS.map((asset) => [asset.key, asset]));

// A seed, so the crowd is the crowd an actual attempt would place.
const SEED = 0xbeef;
const civilians = civiliansAtTick(0, SEED, level, compiled);

/** A placement's world footprint. `size` is object-local; a quarter turn swaps it. */
function planOf(p) {
  const turned = Math.abs(Math.cos(p.yaw)) < 0.5;
  const halfX = (turned ? p.size[2] : p.size[0]) / 2;
  const halfZ = (turned ? p.size[0] : p.size[2]) / 2;
  return {
    minX: p.pos[0] - halfX,
    maxX: p.pos[0] + halfX,
    minZ: p.pos[2] - halfZ,
    maxZ: p.pos[2] + halfZ,
  };
}

/** Nearest distance from a disc centre to a placement's footprint, 0 if inside. */
function gapToDisc(p, cx, cz) {
  const plan = planOf(p);
  const dx = Math.max(plan.minX - cx, 0, cx - plan.maxX);
  const dz = Math.max(plan.minZ - cz, 0, cz - plan.maxZ);
  return Math.hypot(dx, dz);
}

console.log(`M1 blend volumes, seed 0x${SEED.toString(16)}`);
console.log(`crowd blend floor (crowdBlendMinDensity): ${STEALTH_TUNING.crowdBlendMinDensity} bodies\n`);

let totalBodies = 0;
for (const volume of level.blend) {
  const [cx, , cz] = volume.centre;
  const area = Math.PI * volume.radiusM ** 2;

  const inside = civilians.filter(
    (civilian) =>
      Math.hypot(civilian.pos.x - cx, civilian.pos.z - cz) <= volume.radiusM,
  );
  totalBodies += inside.length;
  const rigs = [...new Set(inside.map((civilian) => civilian.rigKey))].sort();
  const stooped = inside.filter((civilian) => civilian.capsuleHeight < 1.2).length;

  const dressing = placements
    .map((p) => ({ p, gap: gapToDisc(p, cx, cz) }))
    .filter((entry) => entry.gap <= volume.radiusM)
    .sort((a, b) => a.gap - b.gap);

  console.log(`=========== ${volume.id}  (${volume.section})`);
  console.log(
    `  disc            centre (${cx}, ${cz})  r=${volume.radiusM}m  area ${area.toFixed(0)} m2`,
  );
  console.log(
    `  declared asset  ${volume.asset}  status=${declared.get(volume.asset)?.status}  ` +
      `sizeM ${JSON.stringify(declared.get(volume.asset)?.sizeM)}`,
  );
  console.log(
    `  DRAWN AS SCENERY? ${
      placements.some((p) => p.asset === volume.asset)
        ? "yes"
        : "NO — sceneryPlacements() reads masses and decks, never blend"
    }`,
  );
  console.log(
    `  rigged bodies   authored ${volume.civilians}, placed ${inside.length}` +
      ` (${stooped} stooped), ${(area / Math.max(inside.length, 1)).toFixed(1)} m2 each`,
  );
  console.log(`  rigs in use     ${rigs.join(", ")}`);
  console.log(`  hides player?   ${inside.length >= STEALTH_TUNING.crowdBlendMinDensity ? "yes" : "NO"}` +
      ` (needs ${STEALTH_TUNING.crowdBlendMinDensity})`);
  console.log(`  dressing within the disc: ${dressing.length} draws`);
  for (const { p, gap } of dressing) {
    console.log(
      `    ${p.asset.padEnd(26)} ${p.id.padEnd(20)} ` +
        `${gap === 0 ? "inside" : `${gap.toFixed(2)}m out`}  ` +
        `size ${p.size.map((v) => v.toFixed(2)).join(" x ")}`,
    );
  }
  console.log();
}

console.log(`total rigged civilians drawn in the level: ${totalBodies}`);
