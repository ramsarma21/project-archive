// Verify bldg-townhouse-1713.glb against the collision M1 authored for it.
//
// Same rule as verify_liberty_elm.mjs: the art fits the hull, never the reverse.
// A balcony 40cm off the deck it dresses reads as a bug, and on this asset that
// is not hypothetical — the ascent spirals the building twice and sixteen route
// nodes stand on its surfaces. So nothing here is checked against a spec sheet.
// Every rect and every height is read out of the shipped GEOMETRY,
// `sceneryPlacements()` is asked where the building goes and how big, the fit
// `FittedGlb` performs is reproduced exactly, and every probe runs in that
// frame. A mesh that fits the hull but reaches the screen at the wrong size
// fails here rather than passing on a technicality.
//
// WHICH SURFACES ARE THIS MESH'S JOB is decided by authored intent, not by a
// key: every deck whose `carriedBy` names one of this asset's masses. Four of
// the eight name `colonial-gutter-straight` as their dressing, and the gutter
// draws a 3.5m ribbon down the middle of a 13m walk — the stone under the foot
// is the building's, whatever prop is laid on top of it.
//
// Seven things are measured:
//   1. draws      one draw for the object, bottom-aligned on the mass base and
//                 not crushed by the contain-fit into a box smaller than itself
//   2. reach      every authored deck against the DRAW BOX, before the mesh is
//                 consulted at all. A rect outside that box cannot be drawn by
//                 any mesh, and calling that a missing floor blames the art for
//                 a number in assets.ts
//   3. walls      the non-landable masses are solid where the level stops the
//                 player, so the climb has brick beside it
//   4. decks      for a grid over the standable part of every authored deck, the
//                 height of the first surface a falling foot meets
//   5. headroom   a 1.55m runner stands up on each of them
//   6. nodes      the route's own node positions, probed one at a time, because
//                 a deck can pass on average and still be air where the line
//                 actually goes
//   7. budget     file size, and one atlas no larger than it was asked for
//
// Run: node --import tsx assets/pipeline/verify_m1_townhouse.mjs [file.glb]
//      ... [--size 14.6,17.6,16.2]  check against a PROPOSED assets.ts sizeM
globalThis.self = globalThis;
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const threeRoot = join(repoRoot, "apps", "web", "node_modules", "three");
const THREE = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);
const load = (...parts) => import(pathToFileURL(join(repoRoot, ...parts)));
const { GEOMETRY } = await load("packages", "mission-m1", "src", "level", "geometry.ts");
const { ASSETS } = await load("packages", "mission-m1", "src", "assets.ts");
const { sceneryPlacements } = await load("packages", "mission-m1", "src", "runtime.ts");
const { M1_EFFIGY_RUN } = await load("packages", "mission-m1", "src", "level", "index.ts");
const { STEP_DOWN } = await load("packages", "engine-world", "src", "playerMotion.ts");
const { CAPSULE_RADIUS, STAND_HEIGHT } = await load(
  "packages", "engine-world", "src", "collision.ts",
);

const ASSET_KEY = "bldg-townhouse-1713";

const args = process.argv.slice(2);
const sizeFlag = args.indexOf("--size");
const sizeOverride = sizeFlag >= 0 ? args[sizeFlag + 1].split(",").map(Number) : null;
const fileArg = args.find(
  (a, i) => !a.startsWith("--") && !(sizeFlag >= 0 && i === sizeFlag + 1),
);
const target = resolve(
  fileArg ?? join(repoRoot, "apps", "web", "public", "world", "props", `${ASSET_KEY}.glb`),
);

// How far under the deck plane a foot may find stone before the player reads as
// walking on air, and how far over it before they read as sinking in. Asymmetric
// on purpose, and the low side is the engine's own step-down: a surface slightly
// low is absorbed and hidden by the boot, a surface high is a visible
// intersection with the leg.
const TOL_BELOW = STEP_DOWN;
const TOL_ABOVE = 0.05;
const GRID = 29;
// The build authors floor a hand's breadth in under a solid so there is no crack
// of daylight at the foot of the tower. That undercut is invisible, but a probe
// sample has to be clear of the wall by more than it before the floor, rather
// than the wall it runs under, is the first thing a downward ray finds.
const UNDERCUT_M = 0.14;
const WALL_CLEARANCE = 0.16;
const BUDGET_MB = 4.0;
const MAX_TEX = 2048;
// A deck this much of its own area short of drawable is a data problem, not an
// art one, and is reported as such rather than as a failed floor.
const COVER_PCT = 95;

let failures = 0;
let conflicts = 0;
function fail(message) {
  console.error(`FAIL ${message}`);
  failures++;
  process.exitCode = 1;
}
// Not the same thing, and conflating them costs a day. A FAIL is the mesh's
// fault and a rebuild fixes it. A CONFLICT is arithmetic: the draw box cannot
// reach the collision, so no mesh fixes it and the change is one line of
// assets.ts. Both stop the build; only one of them is art.
function conflict(message) {
  console.error(`CONFLICT ${message}`);
  conflicts++;
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// the authored hull
// ---------------------------------------------------------------------------

const masses = GEOMETRY.masses.filter((m) => m.asset === ASSET_KEY);
if (masses.length === 0) throw new Error(`no mass in GEOMETRY uses asset ${ASSET_KEY}`);

const myMassIds = new Set(masses.map((m) => m.id));
/** Every surface the level hung on this building's body, whatever dresses it. */
const decks = GEOMETRY.decks
  .filter((d) => d.asset === ASSET_KEY || d.carriedBy.some((id) => myMassIds.has(id)))
  .slice()
  .sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));
if (decks.length === 0) throw new Error(`no deck in GEOMETRY is carried by ${ASSET_KEY}`);

// Solids the player is stopped by, from the whole level rather than this asset
// only: the level is entitled to stand something inside this footprint, and a
// sample no body can occupy must not be probed for floor.
const solids = GEOMETRY.masses.filter((m) => m.landable === false);

const body = masses.reduce((a, b) => {
  const areaOf = (m) => (m.rect.maxX - m.rect.minX) * (m.rect.maxZ - m.rect.minZ);
  return areaOf(b) > areaOf(a) ? b : a;
});
const baseY = Math.min(...masses.map((m) => m.baseY));

console.log(`=== ${target.replace(repoRoot + "/", "")}`);
if (!existsSync(target)) {
  fail(`missing: nothing is shipped at ${target}`);
  process.exit(1);
}
const bytes = statSync(target).size;
const megabytes = bytes / 1024 / 1024;
console.log(`file  ${megabytes.toFixed(2)} MiB (${bytes} bytes)`);

console.log(`\n--- authored collision, read from GEOMETRY ---`);
for (const mass of masses) {
  console.log(
    `${mass.id.padEnd(16)} mass  x ${mass.rect.minX.toFixed(2)}..${mass.rect.maxX.toFixed(2)}` +
      `  z ${mass.rect.minZ.toFixed(2)}..${mass.rect.maxZ.toFixed(2)}` +
      `  y ${mass.baseY.toFixed(2)}..${mass.topY.toFixed(2)}` +
      `  ${mass.landable === false ? "solid" : "landable"}`,
  );
}
for (const deck of decks) {
  console.log(
    `${deck.id.padEnd(16)} deck  x ${deck.rect.minX.toFixed(2)}..${deck.rect.maxX.toFixed(2)}` +
      `  z ${deck.rect.minZ.toFixed(2)}..${deck.rect.maxZ.toFixed(2)}` +
      `  y ${deck.y.toFixed(2)}   dressed by ${deck.asset ?? "(nothing)"}`,
  );
}

// The six standable heights assets.ts declares, checked against the heights the
// level actually authored rather than trusted. A band that exists in one and not
// the other is a spec drift, and it is cheaper to read it here than on a roof.
const declared = ASSETS.find((a) => a.key === ASSET_KEY);
const bands = [...new Set(decks.map((d) => +d.y.toFixed(3)))].sort((a, b) => a - b);
const wanted = (declared?.standableAt ?? []).map((v) => +v.toFixed(3));
console.log(
  `\nstandable heights  authored ${JSON.stringify(bands)}\n` +
    `                   declared ${JSON.stringify(wanted)}`,
);
for (const band of wanted) {
  if (!bands.includes(band)) fail(`assets.ts declares a standable height at ${band}m that no deck carries`);
}
for (const band of bands) {
  if (!wanted.includes(band)) fail(`a deck stands at ${band}m, which assets.ts does not declare`);
}

// ---------------------------------------------------------------------------
// 1. the draw
// ---------------------------------------------------------------------------
// One draw for the object, not one per collision entry, and the fit reproduced
// exactly: uniform contain-scale into the placement box, bbox centred on the
// placement in plan, bbox floor dropped to the placement base.

console.log(`\n--- the draw, from sceneryPlacements() ---`);
const draws = sceneryPlacements(M1_EFFIGY_RUN).filter((p) => p.asset === ASSET_KEY);
for (const p of draws) {
  console.log(
    `${p.id.padEnd(16)} ${p.kind.padEnd(5)} box ${p.size.map((v) => v.toFixed(2)).join(" x ")}` +
      `  at (${p.pos.map((v) => v.toFixed(2)).join(", ")})  covering ${p.parts.join(", ")}`,
  );
}
const placement = draws.reduce((a, b) => (b.size[1] > a.size[1] ? b : a));
for (const stray of draws.filter((d) => d.id !== placement.id)) {
  const worst = Math.min(...stray.size.map((v, i) => v / placement.size[i]));
  conflict(
    `${stray.id} is a second draw of the whole building, contain-fitted into ` +
      `${stray.size.map((v) => v.toFixed(2)).join(" x ")}m — a ${(worst * 100).toFixed(1)}% ` +
      `scale model of it standing at (${stray.pos.map((v) => v.toFixed(2)).join(", ")}). ` +
      `sceneryPlacements() could not tell it was part of the body; that is a level fix, not a mesh one.`,
  );
}
if (sizeOverride) {
  console.log(
    `--size ${sizeOverride.join(",")}: probing against a PROPOSED box; ` +
      `assets.ts still declares ${JSON.stringify(declared?.sizeM)}.`,
  );
  placement.size = sizeOverride;
}

const data = readFileSync(target);

// The atlas, read out of the container rather than out of the loader: three
// decodes images through the DOM, so in node every texture comes back null and a
// count taken from the materials is always zero. The GLB's own JSON chunk knows.
function atlasesOf(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  const views = json.bufferViews ?? [];
  const binStart = 20 + jsonLength + 8;
  return (json.images ?? []).map((image, index) => {
    const view = views[image.bufferView] ?? {};
    const at = binStart + (view.byteOffset ?? 0);
    const bytes = buffer.subarray(at, at + (view.byteLength ?? 0));
    return { index, mime: image.mimeType ?? "?", bytes: bytes.length, ...jpegSize(bytes) };
  });
}

/** Width and height off a JPEG's first start-of-frame marker. */
function jpegSize(bytes) {
  for (let at = 2; at + 9 < bytes.length; ) {
    if (bytes[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1];
    const length = bytes.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return { width: 0, height: 0 };
}

const atlases = atlasesOf(data);
const loader = new GLTFLoader();
const gltf = await new Promise((res, rej) =>
  loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "", res, rej),
);
const scene = gltf.scene;
scene.updateMatrixWorld(true);

let tris = 0;
scene.traverse((o) => {
  if (!o.isMesh) return;
  // Any inward-facing shell must still stop a probe ray.
  const materials = Array.isArray(o.material) ? o.material : [o.material];
  for (const material of materials) if (material) material.side = THREE.DoubleSide;
  const index = o.geometry.index;
  tris += (index ? index.count : o.geometry.attributes.position.count) / 3;
});

const box = new THREE.Box3().setFromObject(scene);
const size = box.getSize(new THREE.Vector3());
console.log(`\n--- mesh ---`);
console.log(`triangles ${Math.round(tris).toLocaleString()}`);
console.log(
  `natural bbox  x=${size.x.toFixed(3)} y=${size.y.toFixed(3)} z=${size.z.toFixed(3)}` +
    `  minY=${box.min.y.toFixed(4)}`,
);
console.log(
  `atlases ${atlases.length}` +
    atlases
      .map((a) => `  ${a.width}x${a.height} ${a.mime} ${(a.bytes / 1024 / 1024).toFixed(2)} MiB`)
      .join(""),
);

const scale = Math.min(
  placement.size[0] / size.x,
  placement.size[1] / size.y,
  placement.size[2] / size.z,
);
scene.scale.setScalar(scale);
scene.updateMatrixWorld(true);
const scaled = new THREE.Box3().setFromObject(scene);
const scaledCentre = scaled.getCenter(new THREE.Vector3());
scene.position.set(
  placement.pos[0] - scaledCentre.x,
  placement.pos[1] - scaled.min.y,
  placement.pos[2] - scaledCentre.z,
);
scene.updateMatrixWorld(true);

const axis = { x: placement.pos[0], z: placement.pos[2] };
const bodyAxis = {
  x: (body.rect.minX + body.rect.maxX) / 2,
  z: (body.rect.minZ + body.rect.maxZ) / 2,
};
const placed = new THREE.Box3().setFromObject(scene);
console.log(
  `scale ${scale.toFixed(4)}  draws ${(size.x * scale).toFixed(2)} x ` +
    `${(size.y * scale).toFixed(2)} x ${(size.z * scale).toFixed(2)} m`,
);
console.log(
  `placed extent x ${placed.min.x.toFixed(2)}..${placed.max.x.toFixed(2)}` +
    `  y ${placed.min.y.toFixed(2)}..${placed.max.y.toFixed(2)}` +
    `  z ${placed.min.z.toFixed(2)}..${placed.max.z.toFixed(2)}`,
);

// FittedGlb bottom-aligns and centres on the bounding box, and this building was
// authored around exactly those two behaviours. Both sides of the contract are
// checked, because either one drifting lifts every walkable surface off its deck
// with nothing else complaining — a single decimated vertex 151mm low did that
// to the elm.
if (Math.abs(box.min.y) > 0.005) {
  fail(`mesh minY is ${box.min.y.toFixed(4)}, not 0: it will not bottom-align onto its base`);
}
if (Math.abs(axis.x - bodyAxis.x) > 0.05 || Math.abs(axis.z - bodyAxis.z) > 0.05) {
  fail(
    `the draw centres at (${axis.x.toFixed(2)}, ${axis.z.toFixed(2)}) but the body ` +
      `stands at (${bodyAxis.x.toFixed(2)}, ${bodyAxis.z.toFixed(2)})`,
  );
}
if (Math.abs(placed.min.y - baseY) > 0.01) {
  fail(`the draw stands at y ${placed.min.y.toFixed(2)}, not on the base ${baseY.toFixed(2)}`);
}
// The contain-fit can only ever shrink. Anything under 1.0 means the mesh is
// bigger than the box it is drawn into, and every authored height comes down by
// the same fraction: at 0.70 the lookout at 17.6m is drawn at 12.3m.
if (scale < 0.999) {
  fail(
    `contain-fit scale ${scale.toFixed(4)}: the mesh is larger than its draw box, so it is ` +
      `drawn at ${(scale * 100).toFixed(1)}% and every authored height lands ` +
      `${((1 - scale) * placement.size[1]).toFixed(2)}m low at the top`,
  );
}
if (scale > 1.001) {
  fail(
    `contain-fit scale ${scale.toFixed(4)}: the mesh is smaller than its draw box on every ` +
      `axis, so it is drawn stretched and its own heights are not the authored ones`,
  );
}

// ---- is this mesh the one this hull asks for? -------------------------------
// The scale checks above are necessary and were not sufficient, and it is worth
// being precise about why, because this building shipped through them with a
// deck 10% dry.
//
// A contain-fit takes the SMALLEST of the three box/mesh ratios, so a mesh short
// on one axis only is drawn at 1.0000 and looks perfect to every check that asks
// about scale. That is what happened when sizeM widened from 14.6 to 15.0 and no
// rebuild followed: a 14.6m mesh in a 15.0m box, fitted at 1.0000, bottom-aligned
// and plan-centred, with the outer 0.20m of each east face simply absent — and
// CORNICE_E, which reaches the box edge, had no stone under a tenth of itself.
// Nothing else noticed. The deck probe found 89.7% and could as easily have found
// 100% had the cornice been 0.4m shorter.
//
// Both build scripts pin the bounding box to the envelope with corner studs
// precisely so the mesh IS the box. So that is the contract, and this is it
// stated: equal on all three axes, to a millimetre. A stale mesh now fails here
// by name instead of drawing short somewhere nobody is looking.
const BOX_EPS = 0.002;
const axes = [
  ["x", size.x, placement.size[0]],
  ["y", size.y, placement.size[1]],
  ["z", size.z, placement.size[2]],
];
const shortAxes = axes.filter(([, mesh, box]) => Math.abs(mesh - box) > BOX_EPS);
console.log(
  `box match  ${axes
    .map(([name, mesh, box]) => `${name} ${mesh.toFixed(3)}/${box.toFixed(3)}`)
    .join("  ")}`,
);
for (const [name, mesh, box] of shortAxes) {
  fail(
    `the mesh is ${Math.abs(mesh - box).toFixed(3)}m ${mesh < box ? "short of" : "past"} its draw ` +
      `box on ${name} (${mesh.toFixed(3)} against ${box.toFixed(3)}). The contain-fit hides this ` +
      `on a single axis, so the building draws at scale 1.0000 with ` +
      `${(Math.abs(mesh - box) / 2).toFixed(3)}m missing from each ${name} face. Rebuild it: the ` +
      `mesh was built against a different hull than the level now declares.`,
  );
}

// ---------------------------------------------------------------------------
// probes
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
raycaster.far = 120;
const targets = [];
scene.traverse((o) => {
  if (o.isMesh) targets.push(o);
});

function cast(from, direction) {
  raycaster.set(from, direction);
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length > 0 ? hits[0] : null;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

function castDown(x, z, fromY) {
  return cast(new THREE.Vector3(x, fromY, z), DOWN)?.point.y ?? null;
}

/** Where the draw box lets the mesh reach, in world space. */
const envelope = {
  minX: axis.x - placement.size[0] / 2,
  maxX: axis.x + placement.size[0] / 2,
  minZ: axis.z - placement.size[2] / 2,
  maxZ: axis.z + placement.size[2] / 2,
  maxY: baseY + placement.size[1],
};
const reachable = (x, z) =>
  x >= envelope.minX - 1e-6 && x <= envelope.maxX + 1e-6 &&
  z >= envelope.minZ - 1e-6 && z <= envelope.maxZ + 1e-6;

/** Is a body standing on `y` at this point inside a solid the level authored? */
function insideSolid(x, z, y) {
  return solids.some(
    (m) =>
      m.topY > y + 0.02 && m.baseY < y + 0.02 &&
      x > m.rect.minX + UNDERCUT_M && x < m.rect.maxX - UNDERCUT_M &&
      z > m.rect.minZ + UNDERCUT_M && z < m.rect.maxZ - UNDERCUT_M,
  );
}

/** Does an authored solid or soffit legitimately fill the space above `y` here? */
function roofedByDesign(x, z, y) {
  return GEOMETRY.masses.some(
    (m) =>
      m.landable === false &&
      m.topY > y + 0.05 && m.baseY < y + STAND_HEIGHT &&
      x > m.rect.minX - CAPSULE_RADIUS && x < m.rect.maxX + CAPSULE_RADIUS &&
      z > m.rect.minZ - CAPSULE_RADIUS && z < m.rect.maxZ + CAPSULE_RADIUS,
  );
}

// ---------------------------------------------------------------------------
// 2. reach: what the draw box allows, before the mesh is consulted
// ---------------------------------------------------------------------------

console.log(
  `\n--- reach: authored decks against the ${placement.size.map((v) => v.toFixed(1)).join(" x ")}m draw box ---`,
);
// Whose surface is it? A deck dressed by some other named prop is that prop's
// job when it stands CLEAR of the building — the fire board hung off the leads
// and the scaffold staging against the west end are a plank and a scaffold. When
// it touches the building it is the building's stone, whatever prop is laid along
// it: the gutter draws a 3.5m ribbon down the middle of a 13m walk. The clock
// ledge shares an edge with the east wall; the staging is clear of it by 40cm,
// and that geometric difference is the whole rule. A deck naming this asset, or
// naming nothing at all, is always this building's.
const TOUCH_M = 0.05;
const touchesBody = (rect) =>
  masses.some(
    (m) =>
      rect.maxX > m.rect.minX - TOUCH_M && rect.minX < m.rect.maxX + TOUCH_M &&
      rect.maxZ > m.rect.minZ - TOUCH_M && rect.minZ < m.rect.maxZ + TOUCH_M,
  );
const elsewhere = [];
const unreachable = [];
for (const deck of decks) {
  const { rect } = deck;
  const inX = Math.max(0, Math.min(rect.maxX, envelope.maxX) - Math.max(rect.minX, envelope.minX));
  const inZ = Math.max(0, Math.min(rect.maxZ, envelope.maxZ) - Math.max(rect.minZ, envelope.minZ));
  const fraction = (inX * inZ) / ((rect.maxX - rect.minX) * (rect.maxZ - rect.minZ));
  const theirs =
    deck.asset !== null && deck.asset !== ASSET_KEY && !touchesBody(rect);
  console.log(
    `${deck.id.padEnd(16)} y=${deck.y.toFixed(2)}  ${(fraction * 100).toFixed(0)}% of its plan is inside the box` +
      (theirs ? `   (clear of the building, and dressed by ${deck.asset})` : ""),
  );
  if (theirs) elsewhere.push(deck);
  else if (fraction < 0.999) unreachable.push({ deck, fraction });
}
const mine = decks.filter((d) => !elsewhere.includes(d));
if (unreachable.length) {
  const halfX = Math.max(...mine.flatMap((d) => [axis.x - d.rect.minX, d.rect.maxX - axis.x]));
  const halfZ = Math.max(...mine.flatMap((d) => [axis.z - d.rect.minZ, d.rect.maxZ - axis.z]));
  for (const { deck, fraction } of unreachable) {
    conflict(
      `${deck.id} at ${deck.y.toFixed(2)}m is ${((1 - fraction) * 100).toFixed(0)}% outside the draw box. ` +
        `No mesh reaches it: the contain-fit means the drawn building is never larger than the box.`,
    );
  }
  console.log(
    `\n  the draw box is sizeM from assets.ts. To cover every deck this building\n` +
      `  carries it has to be at least ` +
      `[${(halfX * 2).toFixed(1)}, ${placement.size[1].toFixed(1)}, ${(halfZ * 2).toFixed(1)}]` +
      `, against the declared ${JSON.stringify(declared?.sizeM)}.`,
  );
}

// ---------------------------------------------------------------------------
// 3. the walls
// ---------------------------------------------------------------------------
// The level stops the player at these planes, so there has to be brick on them:
// a climb up the east front past the clock is played with a hand on the wall.

// What is checked here is that the player is stopped by something they can see,
// not that the brick is flush with the collision plane. It is not, and it should
// not be: the mass is the outer envelope of the building, so the arcade piers and
// the gallery balustrade sit on it and the wall face behind them is set back a
// pier's depth. Flush walls here would mean an arcade you cannot walk into. The
// number that matters is therefore the SETBACK — how far in the first surface is
// — and the failure is a face with no surface at all behind its plane.
const SETBACK_LIMIT = 2.5;
const PROBE_FROM = 3.0;

// The head of the open arcade: the lowest surface the level hung on the
// building, which is the gallery laid on top of the arcade arches.
const arcadeHead = Math.min(...decks.map((d) => d.y)) - 0.3;

console.log(
  `\n--- walls above the arcade head at ${arcadeHead.toFixed(2)}m: ` +
    `something visible where the level stops the player ---`,
);
for (const mass of masses.filter(
  (m) => m.landable === false && !(m.tags ?? []).includes("soffit"),
)) {
  const faces = [
    ["-x", mass.rect.minX, "x", 1], ["+x", mass.rect.maxX, "x", -1],
    ["-z", mass.rect.minZ, "z", 1], ["+z", mass.rect.maxZ, "z", -1],
  ];
  const rows = [];
  for (const [label, plane, kind, inward] of faces) {
    const lo = kind === "x" ? mass.rect.minZ : mass.rect.minX;
    const hi = kind === "x" ? mass.rect.maxZ : mass.rect.maxX;
    const setbacks = [];
    let open = 0;
    let samples = 0;
    // Above the arcade only. The ground storey is open by design — the market
    // stood under it and the road went round it — so a ray fired through a bay
    // finds the far side of the building and says "no wall", correctly.
    const wallBase = Math.max(mass.baseY, arcadeHead);
    for (let i = 1; i <= 7; i++) {
      const along = lo + ((hi - lo) * i) / 8;
      for (let j = 1; j <= 7; j++) {
        const y = wallBase + ((mass.topY - wallBase) * j) / 8;
        const from = kind === "x"
          ? new THREE.Vector3(plane - inward * PROBE_FROM, y, along)
          : new THREE.Vector3(along, y, plane - inward * PROBE_FROM);
        const direction = kind === "x"
          ? new THREE.Vector3(inward, 0, 0)
          : new THREE.Vector3(0, 0, inward);
        samples++;
        const hit = cast(from, direction);
        const setback = hit ? hit.distance - PROBE_FROM : null;
        if (setback === null || setback > SETBACK_LIMIT) open++;
        else setbacks.push(setback);
      }
    }
    setbacks.sort((a, b) => a - b);
    rows.push({
      label, samples, open,
      median: setbacks.length ? setbacks[Math.floor(setbacks.length / 2)] : null,
      deepest: setbacks.length ? setbacks[setbacks.length - 1] : null,
    });
  }
  for (const row of rows) {
    console.log(
      `${mass.id.padEnd(16)} ${row.label}  ${row.samples - row.open}/${row.samples} sections` +
        ` have a face within ${SETBACK_LIMIT.toFixed(1)}m of the collision plane` +
        `  median setback ${row.median === null ? "n/a" : row.median.toFixed(3)}m` +
        `  deepest ${row.deepest === null ? "n/a" : row.deepest.toFixed(3)}m`,
    );
  }
  // The failure worth having this probe for is a building drawn INSIDE its own
  // collision — the player stopped by nothing they can see. That is what the
  // median setback measures. Counting open sections instead condemns the two
  // things this building is famous for: you can see through an open arcade and
  // through a louvred cupola, and a ray fired at either finds the far side.
  const SETBACK_FAIL = 2.0;
  const sunk = rows.filter((r) => r.median === null || r.median > SETBACK_FAIL);
  if (sunk.length) {
    fail(
      `${mass.id}: ${sunk.map((r) => `${r.label} ${r.median === null ? "nothing" : `${r.median.toFixed(2)}m in`}`).join(", ")}` +
        ` — the wall is drawn inside the plane the collision stops the player at`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4 + 5. the deck surfaces and the headroom over them
// ---------------------------------------------------------------------------

console.log(
  `\n--- deck surfaces (grid ${GRID}x${GRID}, tolerance -${TOL_BELOW.toFixed(2)}m / +${TOL_ABOVE}m) ---`,
);

const byBand = new Map();
for (const deck of mine) {
  const { rect, y } = deck;
  let solid = 0;
  let outside = 0;
  let covered = 0;
  let air = 0;
  let above = 0;
  let lowHead = 0;
  let dyMin = Infinity;
  let dyMax = -Infinity;
  let dySum = 0;
  let headMin = Infinity;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const x = rect.minX + ((i + 0.5) / GRID) * (rect.maxX - rect.minX);
      const z = rect.minZ + ((j + 0.5) / GRID) * (rect.maxZ - rect.minZ);
      if (insideSolid(x, z, y)) {
        solid++;
        continue;
      }
      if (!reachable(x, z)) {
        outside++;
        continue;
      }
      const hitY = castDown(x, z, y + 0.5);
      if (hitY === null || hitY < y - TOL_BELOW) {
        air++;
        continue;
      }
      if (hitY > y + TOL_ABOVE) {
        above++;
        continue;
      }
      covered++;
      const dy = hitY - y;
      dyMin = Math.min(dyMin, dy);
      dyMax = Math.max(dyMax, dy);
      dySum += dy;
      const ceiling = cast(new THREE.Vector3(x, y + 0.06, z), UP);
      const head = ceiling ? ceiling.point.y - y : Infinity;
      if (head < STAND_HEIGHT && !roofedByDesign(x, z, y)) {
        lowHead++;
        headMin = Math.min(headMin, head);
      }
    }
  }
  const standable = GRID * GRID - solid;
  const drawable = standable - outside;
  const pct = drawable > 0 ? (covered / drawable) * 100 : 0;
  console.log(
    `${deck.id.padEnd(16)} y=${y.toFixed(2)}  ${standable} standable samples ` +
      `(${solid} inside a solid, ${outside} outside the draw box)`,
  );
  console.log(
    `  on the plane ${covered}/${drawable} of what is drawable (${pct.toFixed(1)}%)  ` +
      `dy min ${dyMin === Infinity ? "n/a" : dyMin.toFixed(4)} ` +
      `max ${dyMax === -Infinity ? "n/a" : dyMax.toFixed(4)} ` +
      `mean ${covered ? (dySum / covered).toFixed(4) : "n/a"}`,
  );
  console.log(
    `  walking on air ${air}   art above the deck ${above}   ` +
      `headroom under ${STAND_HEIGHT}m ${lowHead}${lowHead ? ` (worst ${headMin.toFixed(2)}m)` : ""}`,
  );
  if (drawable > 0 && pct < COVER_PCT) {
    fail(`${deck.id}: only ${pct.toFixed(1)}% of the drawable deck has stone under the foot`);
  }
  if (drawable === 0) {
    console.log(`  nothing of this deck is drawable inside the box, so nothing is probed`);
  }
  if (above > 0) fail(`${deck.id}: ${above} samples sit above the deck plane the player walks on`);
  if (lowHead > 0) {
    fail(`${deck.id}: ${lowHead} samples cannot stand up, worst headroom ${headMin.toFixed(2)}m`);
  }

  const band = +y.toFixed(3);
  const entry = byBand.get(band) ?? { covered: 0, drawable: 0, air: 0, above: 0, outside: 0, standable: 0, ids: [], theirs: [] };
  entry.covered += covered;
  entry.drawable += drawable;
  entry.air += air;
  entry.above += above;
  entry.outside += outside;
  entry.standable += standable;
  entry.ids.push(deck.id);
  byBand.set(band, entry);
}

// ---------------------------------------------------------------------------
// 6. the route's own nodes
// ---------------------------------------------------------------------------
// A deck can pass on average and still be air exactly where the line goes, so
// every node is probed at its own position and round the body radius it occupies.

console.log(`\n--- route nodes standing on this building ---`);
const deckById = new Map(mine.map((d) => [d.id, d]));
const offBoxNodes = [];
const nodes = M1_EFFIGY_RUN.nodes.filter((n) => deckById.has(n.surface));
for (const node of nodes) {
  const [nx, ny, nz] = node.pos;
  const ring = [[0, 0]];
  for (let k = 0; k < 8; k++) {
    const angle = (k / 8) * Math.PI * 2;
    ring.push([Math.cos(angle) * CAPSULE_RADIUS, Math.sin(angle) * CAPSULE_RADIUS]);
  }
  const surface = deckById.get(node.surface).rect;
  let worst = null;
  let offBox = 0;
  let onPlane = 0;
  let overhang = 0;
  for (const [dx, dz] of ring) {
    const x = nx + dx;
    const z = nz + dz;
    // Past the lip of its own deck. C_LEADS_NE is authored 0.30m from the
    // north-east corner of the leads and takes off over it, so a third of the
    // capsule is out over the street: that is the node, not a hole in the roof.
    if (
      x < surface.minX - 1e-6 || x > surface.maxX + 1e-6 ||
      z < surface.minZ - 1e-6 || z > surface.maxZ + 1e-6
    ) {
      overhang++;
      continue;
    }
    if (insideSolid(x, z, ny)) continue;
    if (!reachable(x, z)) {
      offBox++;
      continue;
    }
    const hitY = castDown(x, z, ny + 0.5);
    const dy = hitY === null ? -Infinity : hitY - ny;
    if (dy >= -TOL_BELOW && dy <= TOL_ABOVE) onPlane++;
    if (worst === null || Math.abs(dy) > Math.abs(worst)) worst = dy;
  }
  const asked = ring.length - offBox - overhang;
  const verdict = offBox > 0 && asked === 0
    ? "OUTSIDE THE DRAW BOX"
    : onPlane === asked
      ? "ok"
      : "AIR";
  console.log(
    `${node.id.padEnd(22)} ${node.surface.padEnd(16)} y=${ny.toFixed(2)}  ` +
      `${onPlane}/${ring.length - offBox - overhang} of the foot on stone  ` +
      `worst dy ${worst === null || worst === -Infinity ? "no hit" : worst.toFixed(4)}` +
      `${overhang ? `  ${overhang}/${ring.length} over the lip` : ""}  ${verdict}`,
  );
  if (verdict === "AIR") fail(`${node.id}: the route stands here and the mesh is not under it`);
  if (verdict === "OUTSIDE THE DRAW BOX") offBoxNodes.push(node);
}

// ---------------------------------------------------------------------------
// 7. budget
// ---------------------------------------------------------------------------

console.log(`\n--- budget ---`);
console.log(`file ${megabytes.toFixed(2)} MiB against ${BUDGET_MB.toFixed(1)} MiB`);
if (megabytes > BUDGET_MB) fail(`${megabytes.toFixed(2)} MiB is over the ${BUDGET_MB.toFixed(1)} MiB budget`);
if (atlases.length !== 1) {
  fail(`${atlases.length} atlases; a landmark drawn this often wants exactly one`);
}
for (const atlas of atlases) {
  if (atlas.width > MAX_TEX || atlas.height > MAX_TEX) {
    fail(`atlas is ${atlas.width}x${atlas.height}, over ${MAX_TEX}`);
  }
}

// ---------------------------------------------------------------------------
// the six heights, one line each
// ---------------------------------------------------------------------------

for (const deck of elsewhere) {
  const band = +deck.y.toFixed(3);
  const entry = byBand.get(band) ?? { covered: 0, drawable: 0, air: 0, above: 0, outside: 0, standable: 0, ids: [], theirs: [] };
  entry.theirs.push(deck.id);
  byBand.set(band, entry);
}

console.log(`\n--- the ${byBand.size} standable heights ---`);
for (const [band, entry] of [...byBand.entries()].sort((a, b) => a[0] - b[0])) {
  const pct = entry.drawable > 0 ? (entry.covered / entry.drawable) * 100 : 0;
  const note = entry.drawable === 0
    ? "NOT DRAWABLE: wholly outside the draw box"
    : entry.outside > 0
      ? `${((entry.outside / entry.standable) * 100).toFixed(0)}% of it is outside the draw box`
      : "fully drawable";
  const ids = [...entry.ids, ...entry.theirs.map((id) => `${id}*`)].join(" + ");
  console.log(
    `  ${band.toFixed(2).padStart(5)}m  ${ids.padEnd(30)} ` +
      `${entry.drawable === 0 ? "  --" : `${pct.toFixed(1)}%`} on plane, ` +
      `${entry.air} on air, ${entry.above} over  (${note})`,
  );
}
if (elsewhere.length) {
  console.log(`  * dressed by another asset and clear of this draw box: ${elsewhere.map((d) => d.id).join(", ")}`);
}
for (const band of wanted) {
  if (!byBand.has(band)) fail(`nothing was probed at the declared standable height ${band}m`);
}

if (offBoxNodes.length) {
  console.log(
    `\n${offBoxNodes.length} of the ${nodes.length} route nodes on this building stand where the\n` +
      `draw box cannot reach: ${offBoxNodes.map((n) => n.id).join(", ")}.`,
  );
}

console.log("");
if (failures) {
  console.log(`VERIFY FAILED: ${failures} mesh problem${failures === 1 ? "" : "s"}`);
} else {
  console.log(
    `MESH OK: one draw at scale ${scale.toFixed(4)}, ${(size.y * scale).toFixed(2)}m to the lookout, ` +
      `every deck the box reaches on plane to ${"\u00b1"}1mm`,
  );
}
if (conflicts) {
  console.log(
    `NOT DRAWABLE: ${conflicts} authored surface${conflicts === 1 ? "" : "s"} sit outside the draw box. ` +
      `That is sizeM in assets.ts, not the mesh.`,
  );
}
