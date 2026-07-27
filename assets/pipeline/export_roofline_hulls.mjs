// Dump the hull M1 authored for the roofline kit into plain JSON the Blender
// build step reads.
//
// Same discipline as export_elm_hull.mjs and for the same reason: the build must
// not carry its own copy of the numbers. But this kit has a second problem the
// elm did not, and it is the whole reason this file exists rather than a spec
// sheet in the Python.
//
// The elm is a several-entry cluster, so `drawBox` sizes it from the asset's
// DECLARED dimensions and the tree is authored to those. Every asset in this kit
// is a ONE-entry cluster, and for those `drawBox` ignores assets.ts entirely and
// sizes the box from the collision entry itself:
//
//   a MASS  gets  [rect width, topY - baseY, rect depth]   based at baseY
//   a DECK  gets  [rect width, 0.35,         rect depth]   based at deck.y
//
// So a deck's dressing is bottom-aligned ON the plane the player walks on, not
// top-aligned to it. That single fact decides the shape of two of these props:
// the walking surface of a plank has to sit within a few centimetres of the
// BOTTOM of its own bounding box, or the board draws above the deck and the
// runner's feet sink into it. It also means one key drawn at several entries
// gets several different boxes, which is how the arcade pier and the Hollis
// buttress ended up asking one mesh for two incompatible aspect ratios.
//
// WHY THIS FILE CAN NEVER GO STALE QUIETLY AGAIN
// ---------------------------------------------
// The JSON it writes is the Blender build's only input, so it is a source of
// truth that a rebuild acts on. It had drifted a long way behind the level —
// HOLLIS_BUTTRESS still drawn by `service-wall-end` after being re-keyed to
// `buttress-stepped-stone`, ARCADE_PIER_S still 1.2m deep after the colonnade was
// regularised to 1.0, the ropewalk roof decks still carrying eaves that had been
// deleted — and it happened to still produce the correct pier, which is the worst
// possible state: correct output from stale input, with nothing to say so.
//
// Two things now stop that:
//
//   `buildInputs`   the DERIVED numbers `build_roofline_kit.py` fits to, written
//                   into the file beside the raw geometry. `draw_box` reduces a
//                   key's several boxes to their per-axis minimum, so three
//                   disagreeing boxes and one agreeing box can collapse to the
//                   same fit — which is exactly how the drift stayed invisible.
//                   Writing the reduction down is what makes a re-target visible.
//
//   `--check`       regenerates in memory and diffs against what is on disk,
//                   naming every field that moved and saying whether any of them
//                   is a `buildInputs` field. Exits non-zero on any drift, so it
//                   can be wired into a gate.
//
// A write is never silent either: it prints the same diff it is about to apply.
//
// The regeneration that cleared the drift, and why it re-targeted nothing
// ----------------------------------------------------------------------
// 62 fields had moved, of which 6 were fit boxes. None of the 6 is a value
// `build_roofline_kit.py` reads:
//
//   roof-plank-gantry.fitBox[1]   0.35 -> 0.03    `build_gantry` reads box[0] and
//   roof-ridge-walk.fitBox[1]     0.35 -> 0.042   box[2]; both spend their vertical
//                                                 budget on constants (THICK, WALK_Y).
//   service-wall-end.fitBox[1]    2.6  -> 3.4     the pier build asks for
//   ...fitBoxByTag.prop[1]        2.6  -> 3.4     prefer_tag="arcade", and
//   ...fitBoxByTag.climb          removed         fitBoxByTag.arcade did not move.
//   ...fitBoxByTag.cover          added           `climb` left with HOLLIS_BUTTRESS.
//
// The raw fields the build reads were all unchanged as well: the ropewalk's masses
// (`_door_gap`, wall thickness), its `draws[0].pos` X and Z (`_local_frame`), and
// the four INNER roof-deck edges `_hatch` takes — ROOF_W.maxX, ROOF_E.minX,
// ROOF_N.maxZ, ROOF_S.minZ. The eaves that were deleted only moved the OUTER
// edges, which nothing reads. So the file was brought up to date without aiming
// the build at anything new, and `--check` is what keeps it that way.
//
// Run this before a rebuild. The build acts on this file, so a stale one is a
// build aimed at last week's level.
//
// Run:   node --import tsx assets/pipeline/export_roofline_hulls.mjs
// Check: node --import tsx assets/pipeline/export_roofline_hulls.mjs --check
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { sceneryPlacements } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "runtime.ts"))
);
const { M1_EFFIGY_RUN } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "level", "index.ts"))
);
const { ASSETS } = await import(
  pathToFileURL(join(repoRoot, "packages", "mission-m1", "src", "assets.ts"))
);

/**
 * The keys this pipeline owns. The Town House and the steeple are not ours.
 *
 * `roof-ridge-walk` is still here with nothing drawing it. That is not an
 * oversight: MEETING_RIDGE was re-keyed to `roof-ridge-monitor` because 42mm of
 * leaded walk cannot also be the three metres of building underneath it, and the
 * walk's own 0.042/0.042 contract is worth keeping intact and buildable rather
 * than being quietly redefined to serve a draw it no longer has. A key with no
 * draws reports `fitBox: null` and the build skips it.
 */
const KEYS = [
  "roof-plank-gantry",
  "roof-ridge-walk",
  "roof-ridge-monitor",
  "roof-chimney-stack",
  "service-wall-end",
  "int-shell-ropewalk-a",
  "printshop-sign-hood",
  "bldg-scaffold-run",
  "yard-kerb-stone",
];

const declared = new Map(ASSETS.map((asset) => [asset.key, asset]));
const placements = sceneryPlacements();
const round4 = (value) => Number(value.toFixed(4));

/**
 * `build_roofline_kit.py`'s `draw_box`, mirrored: the per-axis MINIMUM over the
 * boxes that matter, so the tightest one sits at scale 1.0 and the looser ones
 * are left with a small gap.
 *
 * `byTag` covers the same function's `prefer_tag` argument, which the pier build
 * passes as "arcade" to keep the Hollis buttress out of the reduction. Emitted for
 * every tag present rather than for the one tag the build happens to ask for, so
 * this does not have to know the build's arguments.
 */
function fitBoxes(draws, masses) {
  const reduce = (subset) =>
    subset.length
      ? [0, 1, 2].map((axis) => round4(Math.min(...subset.map((draw) => draw.size[axis]))))
      : null;
  const byTag = {};
  for (const tag of new Set(masses.flatMap((mass) => mass.tags ?? []))) {
    const tagged = new Set(masses.filter((mass) => (mass.tags ?? []).includes(tag)).map((m) => m.id));
    const chosen = draws.filter((draw) => draw.parts.some((id) => tagged.has(id)));
    if (chosen.length) byTag[tag] = reduce(chosen);
  }
  return { fitBox: reduce(draws), fitBoxByTag: byTag };
}

const hulls = {};
for (const key of KEYS) {
  const draws = placements.filter((placement) => placement.asset === key);
  const masses = M1_EFFIGY_RUN.masses.filter((mass) => mass.asset === key);
  const decks = M1_EFFIGY_RUN.decks.filter((deck) => deck.asset === key);

  // The box every draw agrees on, if they do. Where they do not, the aspect the
  // mesh is authored to can only satisfy some of them, and saying which is the
  // point of reporting this rather than averaging it.
  const boxes = draws.map((draw) => draw.size.map((v) => Number(v.toFixed(4))).join("x"));
  const distinct = [...new Set(boxes)];

  hulls[key] = {
    buildInputs: fitBoxes(draws, masses),
    key,
    declaredSizeM: declared.get(key)?.sizeM ?? null,
    declaredPath: declared.get(key)?.path ?? null,
    draws: draws.map((draw) => ({
      id: draw.id,
      kind: draw.kind,
      fit: draw.fit,
      /** Bottom-centre of the box FittedGlb fits the mesh into. */
      pos: draw.pos.map((v) => Number(v.toFixed(4))),
      size: draw.size.map((v) => Number(v.toFixed(4))),
      parts: draw.parts,
    })),
    distinctBoxes: distinct,
    masses: masses.map((mass) => ({
      id: mass.id,
      rect: mass.rect,
      baseY: mass.baseY,
      topY: mass.topY,
      landable: mass.landable !== false,
      tags: mass.tags ?? [],
    })),
    decks: decks.map((deck) => ({
      id: deck.id,
      rect: deck.rect,
      y: deck.y,
      tags: deck.tags ?? [],
    })),
  };
}

const out = resolve(repoRoot, "assets", "source", "collision", "m1-roofline-kit.hull.json");

// ---------------------------------------------------------------------------
// drift
// ---------------------------------------------------------------------------

/** Every leaf path where two JSON trees disagree, as `path`, `was`, `now`. */
function drift(was, now, path = "") {
  const show = (v) => (v === undefined ? "(absent)" : JSON.stringify(v));
  if (Array.isArray(was) && Array.isArray(now)) {
    const rows = [];
    for (let i = 0; i < Math.max(was.length, now.length); i++) {
      rows.push(...drift(was[i], now[i], `${path}[${i}]`));
    }
    return rows;
  }
  const object = (v) => v !== null && typeof v === "object";
  if (object(was) && object(now)) {
    const rows = [];
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
      rows.push(...drift(was[key], now[key], path ? `${path}.${key}` : key));
    }
    return rows;
  }
  return was === now ? [] : [{ path, was: show(was), now: show(now) }];
}

const onDisk = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
const rows = onDisk ? drift(onDisk, hulls) : [];
const checkOnly = process.argv.includes("--check");

/**
 * The fit boxes the file ON DISK implies, computed with the same reduction.
 *
 * Derived rather than read, because a file written before `buildInputs` existed
 * has none, and "the field is absent" is not an answer to "would a rebuild build
 * something different". `fitBoxes` only reads `size`, `parts`, `id` and `tags`,
 * all of which any version of this file carries.
 */
const impliedInputs = (source) =>
  Object.fromEntries(
    KEYS.map((key) => [
      key,
      source?.[key] ? fitBoxes(source[key].draws ?? [], source[key].masses ?? []) : null,
    ]),
  );
const inputDrift = onDisk
  ? drift(impliedInputs(onDisk), impliedInputs(hulls))
  : [];

if (!onDisk) {
  console.log("no hull on disk yet: writing the first one");
} else if (!rows.length) {
  console.log(`hull is current: ${KEYS.length} keys, no field differs from the authored geometry`);
} else {
  console.log(
    `\n!! the hull on disk is ${rows.length} field${rows.length === 1 ? "" : "s"} behind the ` +
      `authored geometry:`,
  );
  for (const row of rows) console.log(`   ${row.path.padEnd(52)} ${row.was}  ->  ${row.now}`);
  console.log(
    `\n   of those, ${inputDrift.length} move a box the Blender build fits to:` +
      (inputDrift.length
        ? `\n${inputDrift.map((r) => `     ${r.path.padEnd(46)} ${r.was}  ->  ${r.now}`).join("\n")}` +
          `\n   A rebuild targets the NEW value of each of these. Check which axes and which\n` +
          `   tag the build actually reads — see \`draw_box\` in build_roofline_kit.py, and its\n` +
          `   \`prefer_tag\` argument — before regenerating, because that is the only difference\n` +
          `   between bringing a stale file up to date and quietly re-aiming a build.`
        : `\n   none. Every box the build fits to is unchanged, so a rebuild is unaffected.`),
  );
}

if (checkOnly) {
  if (rows.length) {
    console.error(
      `\nHULL STALE: assets/source/collision/m1-roofline-kit.hull.json disagrees with GEOMETRY. ` +
        `Run this script without --check to bring it up to date, and read the buildInputs verdict ` +
        `above before you do.`,
    );
    process.exit(1);
  }
  console.log("\nHULL OK");
  process.exit(0);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(hulls, null, 2)}\n`);

for (const key of KEYS) {
  const hull = hulls[key];
  console.log(`\n=== ${key}   declared ${JSON.stringify(hull.declaredSizeM)}`);
  for (const draw of hull.draws) {
    console.log(
      `  ${draw.id.padEnd(20)} ${draw.kind.padEnd(4)} ${draw.fit.padEnd(6)} ` +
        `box ${draw.size.map((v) => v.toFixed(2)).join(" x ").padEnd(24)} ` +
        `base at (${draw.pos.map((v) => v.toFixed(2)).join(", ")})  <- ${draw.parts.join(", ")}`,
    );
  }
  if (hull.distinctBoxes.length > 1) {
    console.log(`  !! ${hull.distinctBoxes.length} different boxes for one mesh: ${hull.distinctBoxes.join("  ")}`);
  }
  for (const deck of hull.decks) {
    console.log(
      `  deck ${deck.id.padEnd(20)} y=${deck.y.toFixed(2)} ` +
        `x ${deck.rect.minX.toFixed(2)}..${deck.rect.maxX.toFixed(2)} ` +
        `z ${deck.rect.minZ.toFixed(2)}..${deck.rect.maxZ.toFixed(2)}`,
    );
  }
  for (const mass of hull.masses) {
    console.log(
      `  mass ${mass.id.padEnd(20)} y ${mass.baseY.toFixed(2)}..${mass.topY.toFixed(2)} ` +
        `x ${mass.rect.minX.toFixed(2)}..${mass.rect.maxX.toFixed(2)} ` +
        `z ${mass.rect.minZ.toFixed(2)}..${mass.rect.maxZ.toFixed(2)}  ` +
        `${mass.landable ? "landable" : "not landable"}`,
    );
  }
}
console.log("\nWROTE", out);
