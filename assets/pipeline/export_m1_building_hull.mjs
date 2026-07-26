// Dump the collision M1 authored for one building into a plain JSON hull the
// Blender build step can read.
//
// Generalised from export_elm_hull.mjs, and for the same reason: the build must
// not carry its own copy of the numbers. If the level moves a ledge, this
// regenerates and the mesh is rebuilt against the new hull.
//
// Two things it adds over the elm's version, because a building is not a tree.
//
// 1. THE DRAWABLE ENVELOPE. FittedGlb contain-fits a mesh into the box
//    `sceneryPlacements()` asks for and then centres it in plan and bottom-aligns
//    it. So the drawn object can never be larger than that box, whatever the mesh
//    is: the box IS the envelope, and a mesh that overflows it is not "bigger",
//    it is the same building drawn small. Every number below is emitted in the
//    mesh-local frame that box defines, and any authored collision that falls
//    outside it is recorded as a conflict rather than silently missed.
//
// 2. THE STANDABLE REGION of each deck, not just its rect. A deck rect is the
//    surface the level authored; the part of it a player can actually stand on is
//    that rect minus the plan footprint of every non-landable mass that spans the
//    deck plane. The Town House leads are a ring round a solid tower, the tower
//    plinth is a walk-around, the steeple's louvre sill is entirely inside its own
//    shaft. Authoring a floor across the whole rect would push wood through the
//    tower; leaving the tower out of the reckoning would fail a probe on samples
//    no player can ever occupy.
//
// Run: node --import tsx assets/pipeline/export_m1_building_hull.mjs <asset-key>
//      ... [--size X,Y,Z]  export against a PROPOSED sizeM instead of the
//                          declared one, to build ahead of an assets.ts edit
//
// `--size` exists because the two are not always reconcilable by the art. When a
// declared box cannot reach the collision the level authored, no mesh fixes it:
// the ring is simply not drawn where the player stands on it, and the honest
// move is to build against the box that works and report the one-line change.
// The override is recorded in the hull so the build and the probe both know they
// are running ahead of assets.ts rather than agreeing with it.
globalThis.self = globalThis;
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (...parts) => import(pathToFileURL(join(repoRoot, ...parts)));

const { ASSETS } = await load("packages", "mission-m1", "src", "assets.ts");
const { sceneryPlacements } = await load("packages", "mission-m1", "src", "runtime.ts");
const { M1_EFFIGY_RUN } = await load("packages", "mission-m1", "src", "level", "index.ts");
const { CAPSULE_RADIUS, STAND_HEIGHT } = await load(
  "packages", "engine-world", "src", "collision.ts",
);
const { GRAVITY, RUNNING_JUMP_VY, RUN_SPEED } = await load(
  "packages", "engine-world", "src", "playerMotion.ts",
);

const argv = process.argv.slice(2);
const sizeFlag = argv.indexOf("--size");
const sizeOverride =
  sizeFlag >= 0 ? argv[sizeFlag + 1].split(",").map(Number) : null;
const ASSET_KEY = argv.find(
  (a, i) => !a.startsWith("--") && !(sizeFlag >= 0 && i === sizeFlag + 1),
);
if (!ASSET_KEY) {
  console.error("usage: export_m1_building_hull.mjs <asset-key> [--size X,Y,Z]");
  process.exit(1);
}
if (sizeOverride && sizeOverride.length !== 3) {
  console.error("--size wants three metres, as X,Y,Z");
  process.exit(1);
}

const requirement = ASSETS.find((a) => a.key === ASSET_KEY);
if (!requirement) throw new Error(`${ASSET_KEY} is not declared in assets.ts`);

const level = M1_EFFIGY_RUN;
const draws = sceneryPlacements(level).filter((p) => p.asset === ASSET_KEY);
if (draws.length === 0) throw new Error(`nothing in the level draws ${ASSET_KEY}`);

// The main draw is the one carrying the object's solids. Any others are pieces
// the clusterer could not tell belonged to the same body; they are reported so
// the report can name them rather than the player finding them.
const main = draws.reduce((a, b) => (b.size[1] > a.size[1] ? b : a));
if (sizeOverride) {
  // Only the box changes. `drawBox` takes the plan centre from the union of the
  // asset's solids and the base from their lowest, and neither reads sizeM — so
  // a wider or taller box grows around a fixed axis and a fixed floor, and every
  // authored height still lands where the collision put it.
  console.log(
    `--size ${sizeOverride.join(",")}: exporting against a PROPOSED box. ` +
      `assets.ts still declares ${JSON.stringify(requirement.sizeM)}.`,
  );
  main.size = sizeOverride;
}
const [sizeX, sizeY, sizeZ] = main.size;
const axisX = main.pos[0];
const axisZ = main.pos[2];
const baseY = main.pos[1];

/** Mesh-local envelope. Local (0,0) is the draw's plan centre; local y = 0 its base. */
const envelope = {
  minX: -sizeX / 2, maxX: sizeX / 2,
  minY: 0, maxY: sizeY,
  minZ: -sizeZ / 2, maxZ: sizeZ / 2,
};

const toLocal = (rect) => ({
  minX: rect.minX - axisX, maxX: rect.maxX - axisX,
  minZ: rect.minZ - axisZ, maxZ: rect.maxZ - axisZ,
});

const clip = (r) => ({
  minX: Math.max(r.minX, envelope.minX), maxX: Math.min(r.maxX, envelope.maxX),
  minZ: Math.max(r.minZ, envelope.minZ), maxZ: Math.min(r.maxZ, envelope.maxZ),
});
const area = (r) => Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxZ - r.minZ);
const overlaps = (a, b) =>
  Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 1e-9 &&
  Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 1e-9;

// ---------------------------------------------------------------------------
// what fills space inside the envelope
// ---------------------------------------------------------------------------
// Every non-landable mass in the whole level, not only this asset's own: a
// building has to leave room for anything solid standing inside its footprint,
// and it must not be culled for "blocking headroom" over a deck when the level
// itself put a tower there.

const blockers = level.masses
  .filter((m) => m.landable === false)
  .map((m) => ({
    id: m.id,
    asset: m.asset,
    mine: m.asset === ASSET_KEY,
    // Carried because a build step has to treat some solids differently from
    // others, and the difference is not in the numbers. A spire's box is a
    // conservative bound on something that tapers to a point; a shaft's box is
    // the wall. Both are non-landable rects of the same shape.
    tags: m.tags ?? [],
    ...toLocal(m.rect),
    baseY: m.baseY - baseY,
    topY: (Number.isFinite(m.topY) ? m.topY : m.baseY + 12) - baseY,
  }))
  .filter((m) => overlaps(m, envelope) && m.topY > envelope.minY - 0.01 && m.baseY < envelope.maxY + 0.01);

/** Does this blocker occupy the space a body standing on `y` would need? */
function spansPlane(blocker, y) {
  return blocker.topY > y + 0.02 && blocker.baseY < y + 0.02;
}

/**
 * The standable part of a deck rect inside the envelope, as a grid mask.
 *
 * A mask rather than a rectangle decomposition on purpose: the shapes are rings
 * and L-plans, the build step samples them anyway, and a mask cannot disagree
 * with the probe that checks the result.
 *
 * `UNDERCUT_M` is why the mask is not simply "rect minus blockers". A cell is
 * kept whenever its centre is outside every blocker DEFLATED by that much, so
 * the authored floor runs a hand's breadth in under the tower or the spire
 * instead of stopping at a cell boundary near it. Wood under a solid the player
 * is stopped by is invisible; a cell-wide crack of daylight at the foot of the
 * tower is a probe failure and, worse, a visible one.
 */
const MASK_N = 48;
const UNDERCUT_M = 0.14;
function standableMask(rectLocal, y) {
  const box = clip(rectLocal);
  if (area(box) <= 0) return null;
  const cells = [];
  let standable = 0;
  for (let i = 0; i < MASK_N; i++) {
    const row = [];
    for (let j = 0; j < MASK_N; j++) {
      const x = box.minX + ((i + 0.5) / MASK_N) * (box.maxX - box.minX);
      const z = box.minZ + ((j + 0.5) / MASK_N) * (box.maxZ - box.minZ);
      const blocked = blockers.some(
        (b) =>
          spansPlane(b, y) &&
          x > b.minX + UNDERCUT_M && x < b.maxX - UNDERCUT_M &&
          z > b.minZ + UNDERCUT_M && z < b.maxZ - UNDERCUT_M,
      );
      row.push(blocked ? 0 : 1);
      if (!blocked) standable++;
    }
    cells.push(row.join(""));
  }
  return {
    box, n: MASK_N, rows: cells,
    undercutM: UNDERCUT_M,
    standableFraction: standable / (MASK_N * MASK_N),
  };
}

// ---------------------------------------------------------------------------
// the decks this mesh is responsible for
// ---------------------------------------------------------------------------
// Every deck overlapping the envelope, not only the ones naming this asset. A
// surface the player stands on inside this building's footprint is this
// building's job whatever key the level hung on it: the tower plinth is declared
// as a gutter prop and draws as a 3.5m ribbon in the middle of a 7.4m ring, and
// the ring is the building's stonework.

const deckEntries = level.decks
  .map((d) => ({ entry: d, local: toLocal(d.rect), y: d.y - baseY }))
  .filter(({ local, y }) => overlaps(local, envelope) && y >= envelope.minY - 0.01 && y <= envelope.maxY + 0.01)
  .map(({ entry, local, y }) => {
    const mask = standableMask(local, y);
    return {
      id: entry.id,
      asset: entry.asset,
      mine: entry.asset === ASSET_KEY,
      y,
      ...local,
      tags: entry.tags,
      clipped: mask ? mask.box : null,
      standableFraction: mask ? mask.standableFraction : 0,
      mask: mask && mask.standableFraction > 0 ? { n: mask.n, rows: mask.rows } : null,
    };
  })
  .sort((a, b) => a.y - b.y);

// ---------------------------------------------------------------------------
// take-offs: where the route leaves this building through the air
// ---------------------------------------------------------------------------
// A leap has to be emitted, not inferred, because it is the one thing about a
// deck that the deck's own rectangle cannot say. A balustrade round a lookout
// platform is correct architecture and correct safety everywhere except across
// the edge the route dives over, where it is a wall through the mission's
// signature move — and nothing in the geometry distinguishes the two.

const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
const takeoffs = [];
for (const link of level.links) {
  if (!link.verb?.includes("LEAP") && !link.kind?.includes("LEAP")) continue;
  const from = nodeById.get(link.from);
  const to = nodeById.get(link.to);
  if (!from || !to) continue;
  const dx = to.pos[0] - from.pos[0];
  const dz = to.pos[2] - from.pos[2];
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) continue;
  takeoffs.push({
    link: link.id,
    node: from.id,
    deck: from.surface,
    verb: link.verb,
    line: link.line,
    // Local to the draw, so the build step never has to know where in Boston
    // this is. Unit bearing plus the point it leaves from.
    at: [from.pos[0] - axisX, from.pos[1] - baseY, from.pos[2] - axisZ],
    bearing: [dx / length, dz / length],
    gapM: +length.toFixed(2),
    dropM: +(from.pos[1] - to.pos[1]).toFixed(2),
  });
}

// ---------------------------------------------------------------------------
// conflicts: authored collision this asset owns that the envelope cannot reach
// ---------------------------------------------------------------------------

const owned = [
  ...level.masses.filter((m) => m.asset === ASSET_KEY).map((m) => ({
    id: m.id, kind: "MASS", rect: m.rect, top: m.topY, landable: m.landable !== false,
  })),
  ...level.decks.filter((d) => d.asset === ASSET_KEY).map((d) => ({
    id: d.id, kind: "DECK", rect: d.rect, top: d.y, landable: true,
  })),
];

const conflicts = [];
for (const part of owned) {
  const local = toLocal(part.rect);
  const outX = Math.max(envelope.minX - local.minX, local.maxX - envelope.maxX, 0);
  const outZ = Math.max(envelope.minZ - local.minZ, local.maxZ - envelope.maxZ, 0);
  const outY = Math.max(part.top - baseY - envelope.maxY, 0);
  if (outX > 1e-6 || outZ > 1e-6 || outY > 1e-6) {
    const inside = area(clip(local));
    conflicts.push({
      id: part.id, kind: part.kind, landable: part.landable,
      outX: +outX.toFixed(3), outZ: +outZ.toFixed(3), outY: +outY.toFixed(3),
      fractionInside: +(inside / Math.max(area(local), 1e-9)).toFixed(3),
    });
  }
}

// The sizeM that would let the envelope cover every part this asset owns, given
// that the draw's plan centre is fixed on the union of its solids.
const halfX = Math.max(...owned.map((p) => Math.max(axisX - p.rect.minX, p.rect.maxX - axisX)));
const halfZ = Math.max(...owned.map((p) => Math.max(axisZ - p.rect.minZ, p.rect.maxZ - axisZ)));
const topY = Math.max(...owned.map((p) => p.top));

const hull = {
  key: ASSET_KEY,
  note: "generated by assets/pipeline/export_m1_building_hull.mjs; do not hand-edit",
  declaredSizeM: requirement.sizeM,
  proposedSizeM: sizeOverride,
  declaredStandableAt: requirement.standableAt ?? null,
  capsule: { radius: CAPSULE_RADIUS, standHeight: STAND_HEIGHT },
  // Carried so a build step can fly a take-off arc without a second copy of the
  // engine's numbers. Any ornament a build wants to hang near a leap has to be
  // judged against the trajectory, and the trajectory is these three constants.
  motion: { gravity: GRAVITY, runningJumpVy: RUNNING_JUMP_VY, runSpeedMps: RUN_SPEED },
  draw: {
    id: main.id,
    pos: main.pos,
    size: main.size,
    kind: main.kind,
    fit: main.fit,
    parts: main.parts,
  },
  otherDraws: draws
    .filter((d) => d.id !== main.id)
    .map((d) => ({ id: d.id, pos: d.pos, size: d.size, parts: d.parts })),
  axisWorld: [axisX, axisZ],
  baseWorld: baseY,
  envelope,
  blockers,
  decks: deckEntries,
  takeoffs: takeoffs.filter((t) => deckEntries.some((d) => d.id === t.deck)),
  conflicts,
  sizeMThatWouldCoverEveryPart: [
    +(halfX * 2).toFixed(2), +(topY - baseY).toFixed(2), +(halfZ * 2).toFixed(2),
  ],
};

const out = resolve(repoRoot, "assets", "source", "collision", `${ASSET_KEY}.hull.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(hull, null, 2)}\n`);

console.log(`WROTE ${out}`);
console.log(`draw   ${main.id} size ${main.size.map((v) => v.toFixed(2)).join(" x ")} at ${main.pos.map((v) => v.toFixed(2)).join(", ")}`);
console.log(
  `local envelope  x ${envelope.minX.toFixed(2)}..${envelope.maxX.toFixed(2)}` +
    `  y ${envelope.minY.toFixed(2)}..${envelope.maxY.toFixed(2)}` +
    `  z ${envelope.minZ.toFixed(2)}..${envelope.maxZ.toFixed(2)}`,
);
console.log(`\ndecks inside the envelope (${deckEntries.length}):`);
for (const d of deckEntries) {
  console.log(
    `  ${d.id.padEnd(18)} y=${d.y.toFixed(2)}  ${d.mine ? "mine " : `(${d.asset})`.padEnd(6)}` +
      ` clipped ${d.clipped ? `x ${d.clipped.minX.toFixed(2)}..${d.clipped.maxX.toFixed(2)} z ${d.clipped.minZ.toFixed(2)}..${d.clipped.maxZ.toFixed(2)}` : "none"}` +
      `  standable ${(d.standableFraction * 100).toFixed(0)}%`,
  );
}
console.log(`\ntake-offs through the air from this building (${hull.takeoffs.length}):`);
for (const t of hull.takeoffs) {
  console.log(
    `  ${t.node.padEnd(12)} off ${t.deck.padEnd(16)} ${t.verb} ${t.line}  ` +
      `bearing (${t.bearing.map((v) => v.toFixed(2)).join(", ")})  ` +
      `${t.gapM}m across, ${t.dropM}m down`,
  );
}
console.log(`\nblockers inside the envelope (${blockers.length}):`);
for (const b of blockers) {
  console.log(
    `  ${b.id.padEnd(18)} y ${b.baseY.toFixed(2)}..${b.topY.toFixed(2)}` +
      ` x ${b.minX.toFixed(2)}..${b.maxX.toFixed(2)} z ${b.minZ.toFixed(2)}..${b.maxZ.toFixed(2)}` +
      ` ${b.mine ? "mine" : b.asset}`,
  );
}
if (conflicts.length) {
  console.log(`\nCONFLICT: authored collision this asset owns that the draw box cannot reach:`);
  for (const c of conflicts) {
    console.log(
      `  ${c.id.padEnd(18)} ${c.kind} outside by x ${c.outX} z ${c.outZ} y ${c.outY}` +
        `  (${(c.fractionInside * 100).toFixed(0)}% of its plan is inside)`,
    );
  }
  console.log(
    `  sizeM that would cover every part: ${JSON.stringify(hull.sizeMThatWouldCoverEveryPart)}` +
      `  (declared ${JSON.stringify(requirement.sizeM)})`,
  );
}
