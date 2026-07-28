// Does the body's REAL swept path pass through the triangles we actually DRAW?
//
// WHY THIS EXISTS. This is the instrument for M1-DONE line 20 — "No transition
// drives the body through *drawn* geometry" — the deepest unmet condition in the
// project, and the one nothing could see.
//
// Every collision invariant in this repo reads AUTHORED HULLS. `collision.ts`,
// `playerMotion.ts` and `traversalResolver.ts` are THREE-free and work on
// analytic rects; the mover depenetrates against those same rects. So the swept
// climb invariant (`climbSurfaceInvariant.test.ts`) can prove the capsule is
// provably OUTSIDE every hull at every substep — and the player still watches
// their body climb through a church, because the drawn mesh and the hull are two
// different worlds. "0 of 44 transitions phase" was true against the hulls and
// useless against the picture, which is why the owner has had to find these by
// screenshot.
//
// The three `assets:verify:*` gates are the only checks that load a GLB, but they
// verify STATIC geometry (a solid is filled; a route surface has its asset's
// shape; an affordance has triangles under it). None watch a MOVING body. Nobody
// had ever asked whether the capsule's swept path intersects the triangles we
// draw. This does.
//
// WHAT IT DOES. For every authored CLIMB / MANTLE / VAULT — the same anchor-driven
// transitions the hull invariant covers — it:
//   1. drives the REAL flow controller (`stepFlow`) from a run-up into the
//      transition, exactly as `climbSurfaceInvariant.test.ts` does, and captures
//      the capsule at EVERY fixed substep. Because the solver depenetrates against
//      the hulls, this captured path is HULL-CLEAN by construction — the "provably
//      outside every hull" path — so anything found is the picture diverging from
//      the hull, never the hull itself.
//   2. loads the ACTUAL published GLBs and places their real triangles with the
//      SAME fit + transform the runtime uses. The static decode
//      (`glbDocument`/`staticTriangles`) and the fit (`placementMapper`) are
//      IMPORTED from `check-world-affordances.mjs`, never re-copied — a second
//      copy of the placement maths is the confident-false-report risk those files
//      warn about.
//   3. asks, per substep: is the body's central AXIS actually INSIDE a drawn
//      solid, and how deep (shortest distance to the mesh surface — the exit)?
//
// THE TRAP, AND HOW IT SEPARATES THE THREE CASES. A mesh is contain-fitted into
// its box (smallest of three ratios), so it is often SMALLER than its solid. A
// naive "capsule surface touches a triangle" test would scream about geometry
// that is fine. So the headline metric is how deep the body's vertical AXIS is
// INSIDE a closed drawn solid, sampled strictly ABOVE the feet:
//   * REAL PENETRATION — the axis is inside a drawn solid it should be outside of.
//     The body is buried in the wall/roof/trunk. Ranked by depth and buried extent.
//   * CONTAIN-FIT GAP — the body stands on/against the HULL but the mesh is
//     smaller, so it sits in the empty band; the axis is OUTSIDE the mesh. Not
//     flagged (and already covered by the collision-fill gate). Shown as clearance.
//   * SURFACE CONTACT — feet on a floor, hands on a ledge. The feet sit AT the
//     surface, so every axis point (a radius above the feet) is above/beside the
//     mesh, never inside. Not penetration. Shown as clearance.
// Axis-only is CONSERVATIVE on purpose: a shoulder grazing a proud face by at most
// a radius is exactly the gap/contact regime we refuse to scream about. It biases
// to false negatives over false positives, because a gate that cries wolf on
// cosmetic gap gets disabled, and a disabled gate is worse than none.
//
// ROBUSTNESS. "Inside a closed mesh" is a ray-parity majority vote over a fixed
// fan, so one non-watertight seam in a Meshy asset cannot flip a verdict; a
// per-solid uniform grid prunes triangles so a 38k-triangle building costs a
// handful of triangles per query, not all of them. The known limit is stated, not
// hidden (a genuinely open shell can read ambiguous), which is why depth is
// reported and this ships as a RANKED REPORT, not a hair-trigger gate — see the
// footer.
//
// Usage:
//   node --import tsx scripts/check-drawn-penetration.mjs            # ranked report
//   node --import tsx scripts/check-drawn-penetration.mjs --selftest # prove the instrument
//   node --import tsx scripts/check-drawn-penetration.mjs --prove    # inject a known-bad case
//   node --import tsx scripts/check-drawn-penetration.mjs --json     # machine-readable
//   node --import tsx scripts/check-drawn-penetration.mjs --gate     # exit 1 on a deep (>=radius) hit
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// PA_ROOT lets the checker run from anywhere (e.g. a throwaway location) against
// a chosen checkout; unset, it resolves the repo root relative to this file.
const ROOT = process.env.PA_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISHED = join(ROOT, "apps", "web", "public", "world");
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

// Reuse the ONE published-GLB decode + runtime-fit transform the other verifiers
// share; never a second copy of the placement maths.
const afford = await imp("scripts/check-world-affordances.mjs");
const worldScale = await imp("scripts/check-world-scale.mjs");
const { staticTriangles, triBounds, placementMapper } = afford;
const { glbDocument } = worldScale;

// Engine + level from source, so a change to the mover, the fit, or the authoring
// moves this measurement with it. Specific files, not the barrel (which pulls in
// React/R3F).
const motionMod = await imp("packages/engine-world/src/playerMotion.ts");
const flowMod = await imp("packages/engine-world/src/parkour/flow.ts");
const colMod = await imp("packages/engine-world/src/collision.ts");
const fieldMod = await imp("packages/engine-world/src/fieldSimulation.ts");
const levelMod = await imp("packages/mission-m1/src/level/index.ts");
const compileMod = await imp("packages/mission-m1/src/compile.ts");
const runtimeMod = await imp("packages/mission-m1/src/runtime.ts");

const { RUN_SPEED, createGroundedState } = motionMod;
const { createFlowState, stepFlow } = flowMod;
const { CAPSULE_RADIUS } = colMod;
const { FIELD_DT } = fieldMod;
const { M1_EFFIGY_RUN } = levelMod;
const { compileLevel } = compileMod;
const { sceneryPlacements } = runtimeMod;

// ---------------------------------------------------------------- thresholds
// Fixed up front and JUSTIFIED. Never tuned until a number looks better — tuning
// a penetration tolerance to pass is the exact false-green this exists to remove.

// The same anchor-driven transitions the hull invariant asserts on. DROP / JUMP /
// LEAP_OF_FAITH travel a real BALLISTIC collided path, not a scripted anchor path,
// so "the mover writes the body through a wall" is not the failure mode there
// (that is the ground-support / edge-brake work, gated elsewhere); out of scope
// here for the same reason clip-fidelity labels them N/A.
const AUTHORED_TRANSITION = new Set(["CLIMB", "MANTLE", "VAULT"]);

// Below this, an overlap is the solver's own contact skin or asset re-decimation
// jitter, not a body clipping a wall. `climbSurfaceInvariant` uses exactly this as
// its hull PHASE_LIMIT and clip-fidelity as CLIP_THROUGH; sweepXZ keeps a 1e-5
// skin, so 0.05 m is four thousand times that and a visible poke.
const SKIN_M = 0.05;

// A drawn thing you can be "inside" is a real VOLUME, not a plane. A deck/floor is
// authored as a zero-height plane and a two-sided plank gives ray-parity a false
// "inside" just under it; both are excluded by requiring the placed mesh to be at
// least this tall. Floors are guarded by the ground-support work, not here.
const MIN_SOLID_HEIGHT_M = 0.6;

// Depth bands, in metres of body buried past the skin. CAPSULE_RADIUS is 0.35 m:
// a depth past a radius means more than the body's half-width is inside the drawn
// solid — unmistakable on screen; a hand-span (0.15 m, clip-fidelity's GRIP_BAND)
// is a clear poke; below that is a shallow clip, usually a mesh drawn proud of its
// hull face.
const BAND_CRITICAL_M = 0.8; // deeper than a body diameter: phased into the mass
const BAND_SEVERE_M = CAPSULE_RADIUS; // past the body's own radius
const BAND_OFF_M = 0.15; // a clear poke-through
// (SKIN_M .. BAND_OFF_M) is MARGINAL.

// The capsule is a vertical segment from feet (motion.pos.y) to feet + height.
// Contact lives at the feet, so the axis is sampled strictly ABOVE the feet — from
// feet + a radius (clear of any floor the feet rest on) to the head. That offset
// is what makes feet-on-floor read as clearance, not penetration.
const AXIS_STEP_M = 0.2;
const AXIS_FOOT_CLEARANCE_M = CAPSULE_RADIUS;

// Fixed ray fan for the inside test — a majority must report odd parity for a
// point to count as inside a closed mesh, so one non-watertight seam cannot flip a
// verdict. Deliberately NOT axis-aligned, to avoid grazing a box's faces edge-on.
const INSIDE_RAY_DIRS = normalizedDirs([
  [0.53, 0.21, 0.82], [-0.61, 0.33, 0.72], [0.44, -0.77, 0.46],
  [-0.29, -0.66, -0.69], [0.81, 0.5, -0.31], [-0.74, 0.12, -0.66],
  [0.17, 0.94, 0.29], [0.66, -0.35, -0.66], [-0.39, 0.55, 0.74],
]);
const INSIDE_MAJORITY = 0.5; // > half the rays odd -> inside

// ---------------------------------------------------------------- vec helpers
function normalizedDirs(list) {
  return list.map(([x, y, z]) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; });
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ---------------------------------------------------------------- geometry
/** Möller–Trumbore, two-sided: returns the ray parameter t (or null on a miss). */
function rayTriT(orig, dir, a, b, c) {
  const e1 = sub(b, a), e2 = sub(c, a);
  const p = cross(dir, e2);
  const det = dot(e1, p);
  if (det > -1e-12 && det < 1e-12) return null; // ray parallel to the triangle
  const inv = 1 / det;
  const t0 = sub(orig, a);
  const u = dot(t0, p) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(t0, e1);
  const v = dot(dir, q) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  return dot(e2, q) * inv;
}

const GRID_CELL_M = 1.0;
const clampi = (f, n) => Math.max(0, Math.min(n - 1, Math.floor(f)));

/** A per-solid uniform grid over the triangles, so a query touches only the few
 *  triangles near it instead of a whole 38k-triangle building. */
function buildGrid(tris, min, max) {
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / GRID_CELL_M));
  const ny = Math.max(1, Math.ceil((max[1] - min[1]) / GRID_CELL_M));
  const nz = Math.max(1, Math.ceil((max[2] - min[2]) / GRID_CELL_M));
  const cells = new Map();
  const key = (ix, iy, iz) => ix + nx * (iy + ny * iz);
  for (let ti = 0; ti < tris.length; ti++) {
    const t = tris[ti];
    const lo = [Math.min(t[0][0], t[1][0], t[2][0]), Math.min(t[0][1], t[1][1], t[2][1]), Math.min(t[0][2], t[1][2], t[2][2])];
    const hi = [Math.max(t[0][0], t[1][0], t[2][0]), Math.max(t[0][1], t[1][1], t[2][1]), Math.max(t[0][2], t[1][2], t[2][2])];
    const ix0 = clampi((lo[0] - min[0]) / GRID_CELL_M, nx), ix1 = clampi((hi[0] - min[0]) / GRID_CELL_M, nx);
    const iy0 = clampi((lo[1] - min[1]) / GRID_CELL_M, ny), iy1 = clampi((hi[1] - min[1]) / GRID_CELL_M, ny);
    const iz0 = clampi((lo[2] - min[2]) / GRID_CELL_M, nz), iz1 = clampi((hi[2] - min[2]) / GRID_CELL_M, nz);
    for (let iz = iz0; iz <= iz1; iz++) for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const k = key(ix, iy, iz); const arr = cells.get(k); if (arr) arr.push(ti); else cells.set(k, [ti]);
    }
  }
  return { nx, ny, nz, min, cells, key, visited: new Int32Array(tris.length), epoch: 0 };
}

/** Ray crossings against a solid, using its grid: DDA the voxels the ray passes
 *  through and test each triangle once (epoch-marked). */
function rayCrossings(p, dir, solid) {
  const g = solid.grid; const tris = solid.tris;
  g.epoch++;
  let ix = clampi((p[0] - g.min[0]) / GRID_CELL_M, g.nx);
  let iy = clampi((p[1] - g.min[1]) / GRID_CELL_M, g.ny);
  let iz = clampi((p[2] - g.min[2]) / GRID_CELL_M, g.nz);
  const stepX = dir[0] > 0 ? 1 : -1, stepY = dir[1] > 0 ? 1 : -1, stepZ = dir[2] > 0 ? 1 : -1;
  const nextBound = (i, o, s) => g.min[o] + (s > 0 ? (i + 1) : i) * GRID_CELL_M;
  let tMaxX = Math.abs(dir[0]) < 1e-12 ? Infinity : (nextBound(ix, 0, stepX) - p[0]) / dir[0];
  let tMaxY = Math.abs(dir[1]) < 1e-12 ? Infinity : (nextBound(iy, 1, stepY) - p[1]) / dir[1];
  let tMaxZ = Math.abs(dir[2]) < 1e-12 ? Infinity : (nextBound(iz, 2, stepZ) - p[2]) / dir[2];
  const tDeltaX = Math.abs(dir[0]) < 1e-12 ? Infinity : GRID_CELL_M / Math.abs(dir[0]);
  const tDeltaY = Math.abs(dir[1]) < 1e-12 ? Infinity : GRID_CELL_M / Math.abs(dir[1]);
  const tDeltaZ = Math.abs(dir[2]) < 1e-12 ? Infinity : GRID_CELL_M / Math.abs(dir[2]);
  let crossings = 0;
  for (let guard = 0; guard < g.nx + g.ny + g.nz + 3; guard++) {
    const arr = g.cells.get(g.key(ix, iy, iz));
    if (arr) for (const ti of arr) {
      if (g.visited[ti] === g.epoch) continue; g.visited[ti] = g.epoch;
      const t = tris[ti]; const tt = rayTriT(p, dir, t[0], t[1], t[2]); if (tt !== null && tt > 1e-6) crossings++;
    }
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { ix += stepX; if (ix < 0 || ix >= g.nx) break; tMaxX += tDeltaX; }
    else if (tMaxY <= tMaxZ) { iy += stepY; if (iy < 0 || iy >= g.ny) break; tMaxY += tDeltaY; }
    else { iz += stepZ; if (iz < 0 || iz >= g.nz) break; tMaxZ += tDeltaZ; }
  }
  return crossings;
}

function insideFraction(p, solid) {
  let odd = 0;
  for (const dir of INSIDE_RAY_DIRS) if (rayCrossings(p, dir, solid) % 2 === 1) odd++;
  return odd / INSIDE_RAY_DIRS.length;
}

/** Squared distance from point p to triangle (a,b,c). Ericson, Real-Time CD. */
function distSqPointTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
  const bp = sub(p, b); const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); const q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; const qp = sub(p, q); return dot(qp, qp); }
  const cp = sub(p, c); const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); const q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; const qp = sub(p, q); return dot(qp, qp); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); const q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; const qp = sub(p, q); return dot(qp, qp); }
  const denom = 1 / (va + vb + vc); const v = vb * denom, w = vc * denom;
  const q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  const qp = sub(p, q); return dot(qp, qp);
}

/** Nearest surface distance via the grid: expand cubic shells of cells around p
 *  until the best distance found is closer than the next shell boundary. */
function surfaceDist(p, solid) {
  const g = solid.grid; const tris = solid.tris;
  g.epoch++;
  const cx = clampi((p[0] - g.min[0]) / GRID_CELL_M, g.nx);
  const cy = clampi((p[1] - g.min[1]) / GRID_CELL_M, g.ny);
  const cz = clampi((p[2] - g.min[2]) / GRID_CELL_M, g.nz);
  let bestSq = Infinity;
  const maxR = g.nx + g.ny + g.nz;
  for (let r = 0; r <= maxR; r++) {
    for (let iz = cz - r; iz <= cz + r; iz++) {
      if (iz < 0 || iz >= g.nz) continue;
      for (let iy = cy - r; iy <= cy + r; iy++) {
        if (iy < 0 || iy >= g.ny) continue;
        for (let ix = cx - r; ix <= cx + r; ix++) {
          if (ix < 0 || ix >= g.nx) continue;
          if (r > 0 && Math.abs(ix - cx) !== r && Math.abs(iy - cy) !== r && Math.abs(iz - cz) !== r) continue;
          const arr = g.cells.get(g.key(ix, iy, iz)); if (!arr) continue;
          for (const ti of arr) {
            if (g.visited[ti] === g.epoch) continue; g.visited[ti] = g.epoch;
            const t = tris[ti]; const d = distSqPointTri(p, t[0], t[1], t[2]); if (d < bestSq) bestSq = d;
          }
        }
      }
    }
    if (bestSq < Infinity && Math.sqrt(bestSq) <= r * GRID_CELL_M) break;
  }
  return Math.sqrt(bestSq);
}

const inAabb = (p, min, max, eps = 1e-6) =>
  p[0] >= min[0] - eps && p[0] <= max[0] + eps &&
  p[1] >= min[1] - eps && p[1] <= max[1] + eps &&
  p[2] >= min[2] - eps && p[2] <= max[2] + eps;

// ---------------------------------------------------------------- drawn world
const naturalCache = new Map();
function loadNatural(assetPath) {
  if (naturalCache.has(assetPath)) return naturalCache.get(assetPath);
  const file = join(PUBLISHED, assetPath.replace(/^world\//, ""));
  let record = { tris: [], min: null, max: null, missing: !existsSync(file) };
  if (existsSync(file)) {
    const doc = glbDocument(readFileSync(file));
    if (doc) { const { tris } = staticTriangles(doc); const b = tris.length ? triBounds(tris) : { min: null, max: null }; record = { tris, min: b.min, max: b.max, missing: false }; }
    else record = { tris: [], min: null, max: null, missing: false, unreadable: true };
  }
  naturalCache.set(assetPath, record);
  return record;
}

/**
 * Every scenery placement the game draws, as world triangles placed by the runtime
 * fit, with an AABB, a grid, and a `solid` flag (a real volume a body can be
 * inside). Ladders are excluded: they carry NO collision by design (a separately
 * tracked, owner-reported defect) and are the thing a climber GRIPS, so a climb
 * path legitimately passes through their rungs — the affordance verifier excludes
 * them for the same reason.
 */
function buildDrawnWorld() {
  const placements = sceneryPlacements();
  const drawn = [];
  const status = { OK: 0, MISSING: 0, UNREADABLE: 0, EMPTY: 0, LADDER: 0 };
  for (const p of placements) {
    if (p.asset.startsWith("work-ladder")) { status.LADDER++; continue; }
    const nat = loadNatural(p.assetPath);
    if (nat.missing) { status.MISSING++; continue; }
    if (nat.unreadable) { status.UNREADABLE++; continue; }
    if (!nat.tris.length) { status.EMPTY++; continue; }
    const map = placementMapper(p, nat.min, nat.max);
    const tris = nat.tris.map((t) => [map(t[0]), map(t[1]), map(t[2])]);
    const b = triBounds(tris);
    const isSolid = (b.max[1] - b.min[1]) >= MIN_SOLID_HEIGHT_M;
    drawn.push({ id: p.id, asset: p.asset, tris, min: b.min, max: b.max, solid: isSolid, grid: isSolid ? buildGrid(tris, b.min, b.max) : null });
    status.OK++;
  }
  return { drawn, solids: drawn.filter((d) => d.solid), status, placementCount: placements.length };
}

// ---------------------------------------------------------------- path capture
/**
 * Drive the REAL flow controller into one authored transition and capture the
 * capsule at every fixed substep — `climbSurfaceInvariant.test.ts`'s drive in
 * structure (a run-up 0.8 m behind the take-off, sprint held toward the
 * destination, guided axis set), except it records the whole path. Every captured
 * sample is HULL-CLEAN, because `stepFlow` depenetrates against the hulls.
 */
function drivePath(world, nodeById, link) {
  const from = nodeById.get(link.from), to = nodeById.get(link.to);
  if (!from || !to) return null;
  const dx = to.pos[0] - from.pos[0], dz = to.pos[2] - from.pos[2];
  const planar = Math.hypot(dx, dz);
  const axX = planar > 1e-3 ? dx / planar : 1, axZ = planar > 1e-3 ? dz / planar : 0;
  const back = planar > 1e-3 ? 0.8 : 0;
  let motion = createGroundedState({ x: from.pos[0] - axX * back, y: from.pos[1], z: from.pos[2] - axZ * back }, Math.atan2(axX, axZ));
  let flow = createFlowState();
  const samples = []; let sawAction = false;
  for (let tick = 0; tick < Math.round(4 / FIELD_DT); tick++) {
    const res = stepFlow(world, motion, flow, { dt: FIELD_DT, targetVelX: axX * RUN_SPEED, targetVelZ: axZ * RUN_SPEED, sprintHeld: true, crouchHeld: false, jumpBuffered: false, dashBuffered: false, flowEnabled: true, reducedMotion: false, receivingTargets: [], inferredAscentAllowed: true, guidedAxisX: axX, guidedAxisZ: axZ });
    motion = res.motion; flow = res.flow;
    const acting = motion.action !== null; if (acting) sawAction = true;
    samples.push({ x: motion.pos.x, y: motion.pos.y, z: motion.pos.z, height: motion.capsuleHeight, acting });
    if (motion.grounded && Math.abs(motion.pos.y - to.pos[1]) < 0.4 && Math.hypot(motion.pos.x - to.pos[0], motion.pos.z - to.pos[2]) < 1.2) break;
  }
  return { samples, sawAction };
}

/** The vertical axis sample points of one capsule, strictly above the feet. */
function axisPoints(sample) {
  const lo = sample.y + AXIS_FOOT_CLEARANCE_M, hi = sample.y + sample.height - SKIN_M;
  const pts = [];
  for (let yy = lo; yy <= hi + 1e-9; yy += AXIS_STEP_M) pts.push([sample.x, yy, sample.z]);
  if (pts.length === 0 && hi > lo) pts.push([sample.x, (lo + hi) / 2, sample.z]);
  return pts;
}

// ---------------------------------------------------------------- measure
function pointNearSolid(p, solid, margin = CAPSULE_RADIUS) {
  if (p[0] < solid.min[0] - margin || p[0] > solid.max[0] + margin || p[1] < solid.min[1] - margin || p[1] > solid.max[1] + margin || p[2] < solid.min[2] - margin || p[2] > solid.max[2] + margin) return null;
  return surfaceDist(p, solid);
}

/** The solids whose AABB overlaps the whole path envelope — a broad-phase so each
 *  substep loops a handful of solids, not all ~150. */
function candidateSolids(samples, solids) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of samples) {
    if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
    if (s.z < minZ) minZ = s.z; if (s.z > maxZ) maxZ = s.z;
    if (s.y < minY) minY = s.y; if (s.y + s.height > maxY) maxY = s.y + s.height;
  }
  const m = CAPSULE_RADIUS + 0.05;
  return solids.filter((d) =>
    d.max[0] >= minX - m && d.min[0] <= maxX + m &&
    d.max[1] >= minY - m && d.min[1] <= maxY + m &&
    d.max[2] >= minZ - m && d.min[2] <= maxZ + m);
}

/**
 * The deepest the capsule's axis goes inside a drawn solid over a whole path, how
 * much of the body is buried, and where. Also records the closest the body came to
 * a solid surface WITHOUT being inside it — the clearance that proves a near-miss
 * was read as contain-fit gap or contact, not a hit.
 */
function measurePath(samples, allSolids) {
  const solids = candidateSolids(samples, allSolids);
  let worst = null, buriedAxisMax = 0, minClearance = Infinity, clearanceId = null;
  for (const s of samples) {
    const pts = axisPoints(s); let buriedThisSample = 0;
    for (const p of pts) {
      let insideDepth = 0, insideId = null, insideAsset = null, nearestSurfaceHere = Infinity, nearestId = null;
      for (const solid of solids) {
        const near = pointNearSolid(p, solid);
        if (near === null) continue; // far outside the AABB
        if (inAabb(p, solid.min, solid.max) && insideFraction(p, solid) > INSIDE_MAJORITY) {
          const depth = surfaceDist(p, solid);
          if (depth > insideDepth) { insideDepth = depth; insideId = solid.id; insideAsset = solid.asset; }
        } else if (near < nearestSurfaceHere) { nearestSurfaceHere = near; nearestId = solid.id; }
      }
      if (insideDepth > SKIN_M) {
        buriedThisSample += AXIS_STEP_M;
        if (!worst || insideDepth > worst.depthM) worst = { depthM: insideDepth, id: insideId, asset: insideAsset, point: p, phaseActing: s.acting };
      } else if (nearestSurfaceHere < minClearance) { minClearance = nearestSurfaceHere; clearanceId = nearestId; }
    }
    if (buriedThisSample > buriedAxisMax) buriedAxisMax = buriedThisSample;
  }
  return { worst, buriedAxisMax, minClearance: Number.isFinite(minClearance) ? minClearance : null, clearanceId };
}

// ---------------------------------------------------------------- classify
function bandOf(depthM) {
  if (depthM > BAND_CRITICAL_M) return { rank: 4, label: "CRITICAL" };
  if (depthM > BAND_SEVERE_M) return { rank: 3, label: "SEVERE" };
  if (depthM > BAND_OFF_M) return { rank: 2, label: "OFF" };
  if (depthM > SKIN_M) return { rank: 1, label: "MARGINAL" };
  return { rank: 0, label: "CLEAN" };
}

function visibilityNote(depthM, buriedM) {
  const frac = depthM / CAPSULE_RADIUS;
  const width =
    frac >= 2 ? "the whole body is inside the drawn solid" :
    frac >= 1 ? "more than the body's half-width is inside" :
    frac >= 0.4 ? "the body clearly clips into the surface" :
    "a shallow clip, most likely a mesh drawn proud of its hull face";
  const extent = buriedM >= 0.4 ? ` (~${buriedM.toFixed(1)} m of the body's height buried)` : "";
  return `${width}${extent}`;
}

// ---------------------------------------------------------------- run
function run() {
  const level = M1_EFFIGY_RUN;
  const { world } = compileLevel(level);
  const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
  const { drawn, solids, status, placementCount } = buildDrawnWorld();
  const rows = [];
  for (const link of level.links) {
    if (!AUTHORED_TRANSITION.has(link.kind)) continue;
    const driven = drivePath(world, nodeById, link); if (!driven) continue;
    const m = measurePath(driven.samples, solids);
    const depthM = m.worst?.depthM ?? 0; const band = bandOf(depthM);
    rows.push({ linkId: link.id, kind: link.kind, from: link.from, to: link.to, section: nodeById.get(link.to)?.section ?? "", sawAction: driven.sawAction, ticks: driven.samples.length, depthM, buriedM: m.buriedAxisMax, worst: m.worst, minClearance: m.minClearance, clearanceId: m.clearanceId, band });
  }
  rows.sort((a, b) => b.depthM - a.depthM);
  return { rows, status, placementCount, solidCount: solids.length, drawnCount: drawn.length };
}

// ---------------------------------------------------------------- report
function report(data, { asJson } = {}) {
  if (asJson) {
    console.log(JSON.stringify(data.rows.map((r) => ({ linkId: r.linkId, kind: r.kind, from: r.from, to: r.to, section: r.section, sawAction: r.sawAction, depthM: +r.depthM.toFixed(4), buriedM: +r.buriedM.toFixed(2), band: r.band.label, mesh: r.worst?.id ?? null, asset: r.worst?.asset ?? null, at: r.worst ? r.worst.point.map((v) => +v.toFixed(2)) : null, phase: r.worst ? (r.worst.phaseActing ? "authored-action" : "approach/settle") : null, minClearanceM: r.minClearance === null ? null : +r.minClearance.toFixed(3), nearestMesh: r.clearanceId })), null, 2));
    return;
  }
  console.log("drawn-penetration: does the body's swept path pass through the DRAWN mesh?\n");
  console.log(`  ${data.placementCount} scenery placements; drawn ${data.drawnCount} (${data.solidCount} solid volumes tested for containment); load: ` + Object.entries(data.status).map(([k, v]) => `${k}=${v}`).join(", "));
  console.log(`  ${data.rows.length} authored CLIMB/MANTLE/VAULT transitions driven through the real mover.\n`);
  const hits = data.rows.filter((r) => r.band.rank >= 1);
  const clean = data.rows.filter((r) => r.band.rank === 0);
  console.log(`  RESULT: ${hits.length} transition(s) drive the body INTO drawn geometry; ${clean.length} clean.`);
  const byBand = { CRITICAL: 0, SEVERE: 0, OFF: 0, MARGINAL: 0 };
  for (const r of hits) byBand[r.band.label]++;
  console.log(`  breakdown: ${byBand.CRITICAL} CRITICAL (>${BAND_CRITICAL_M}m), ${byBand.SEVERE} SEVERE (>${BAND_SEVERE_M.toFixed(2)}m, past a body radius), ${byBand.OFF} OFF (>${BAND_OFF_M}m), ${byBand.MARGINAL} MARGINAL (>${SKIN_M}m).\n`);
  if (hits.length) {
    console.log("  ===================== RANKED PENETRATIONS =====================");
    for (const r of hits) {
      const w = r.worst;
      console.log(`  ${r.band.label.padEnd(9)} ${r.section.padEnd(11)} ${r.kind.padEnd(6)} ${r.linkId}`);
      console.log(`      ${r.depthM.toFixed(3)} m into ${w.asset} (${w.id}) at [${w.point.map((v) => v.toFixed(1)).join(", ")}], during ${w.phaseActing ? "the authored action" : "approach/settle"}`);
      console.log(`      ${visibilityNote(r.depthM, r.buriedM)}`);
    }
    console.log("");
  }
  const brushes = clean.filter((r) => r.minClearance !== null && r.minClearance < CAPSULE_RADIUS).sort((a, b) => a.minClearance - b.minClearance);
  if (brushes.length) {
    console.log(`  ----- clean, but the body brushed a solid (contain-fit gap / surface contact, NOT penetration) -----`);
    for (const r of brushes.slice(0, 10)) console.log(`    ${r.section.padEnd(11)} ${r.kind.padEnd(6)} ${r.linkId}: axis stayed ${(r.minClearance * 100).toFixed(0)} cm outside ${r.clearanceId} (feet/shoulder near the mesh, centre never inside)`);
    console.log("");
  }
  console.log("  ----- all transitions -----");
  for (const r of data.rows) {
    const tag = r.band.rank >= 1 ? r.band.label : "clean";
    const detail = r.band.rank >= 1 ? `${r.depthM.toFixed(3)}m into ${r.worst.id}` : r.minClearance !== null ? `nearest solid ${(r.minClearance).toFixed(2)}m` : "clear of all solids";
    console.log(`    ${tag.padEnd(9)} ${r.kind.padEnd(6)} ${r.linkId.padEnd(34)} ${detail}${r.sawAction ? "" : "  [no action fired]"}`);
  }
}

// ---------------------------------------------------------------- self-test
// A penetration gate that cannot demonstrate it tells the three cases apart is the
// exact failure this repo keeps hitting: a check that looks green while checking
// the wrong thing. So the instrument proves, on synthetic geometry with a known
// answer, that it FLAGS a body inside a solid and does NOT flag a body in the
// contain-fit gap or resting on the surface — and that the naive test it replaces
// WOULD false-positive on those two, so the discrimination is real.
function boxTris(cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2, hz = sz / 2;
  const x0 = cx - hx, x1 = cx + hx, y0 = cy, y1 = cy + sy, z0 = cz - hz, z1 = cz + hz;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]];
  return f.map(([a, b, c]) => [v[a], v[b], v[c]]);
}
function solidFrom(id, tris) { const b = triBounds(tris); return { id, asset: id, tris, min: b.min, max: b.max, solid: true, grid: buildGrid(tris, b.min, b.max) }; }
/** The naive test this instrument deliberately does NOT use: capsule surface (any
 *  axis point within a radius of any triangle) counts as a hit. Shown to prove it
 *  false-positives on the gap and on contact, which is why it was rejected. */
function naiveHits(samples, solids) {
  for (const s of samples) for (const p of axisPoints(s)) for (const solid of solids) { const near = pointNearSolid(p, solid, CAPSULE_RADIUS + 0.01); if (near !== null && near < CAPSULE_RADIUS) return true; }
  return false;
}
function selfTest() {
  let failed = 0;
  const check = (label, ok, detail) => { if (!ok) failed++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`); };
  console.log("drawn-penetration selftest: tell a body INSIDE a drawn solid apart from a\n  body in the contain-fit gap and a body resting on the surface.\n");
  const box = solidFrom("BOX", boxTris(0, 0, 0, 4, 6, 4));
  // REAL — feet inside the box, centre well inside.
  {
    const samples = [{ x: 0, y: 1.0, z: 0, height: 1.55, acting: true }];
    const m = measurePath(samples, [box]); const band = bandOf(m.worst?.depthM ?? 0);
    check("body inside a solid is flagged", band.rank >= 3 && m.worst, `depth ${m.worst?.depthM?.toFixed(2)}m -> ${band.label}`);
  }
  // PASS-THROUGH — a swept path straight through the box.
  {
    const samples = []; for (let x = -4; x <= 4; x += 0.2) samples.push({ x, y: 2.0, z: 0, height: 1.55, acting: true });
    const m = measurePath(samples, [box]);
    check("a path swept THROUGH a solid is flagged", (m.worst?.depthM ?? 0) > SKIN_M, `deepest ${m.worst?.depthM?.toFixed(2)}m, ${m.buriedAxisMax.toFixed(1)}m of body buried`);
  }
  // CONTAIN-FIT GAP — mesh 4 wide (x[-2,2]); body at x=2.2 grazes the wall with
  // its shoulder but its AXIS is 0.2 m outside. The naive test fires; ours must not.
  {
    const samples = [{ x: 2.2, y: 0.0, z: 0, height: 1.55, acting: true }];
    const m = measurePath(samples, [box]); const band = bandOf(m.worst?.depthM ?? 0);
    check("contain-fit gap (shoulder graze) is NOT flagged", band.rank === 0, `depth ${(m.worst?.depthM ?? 0).toFixed(2)}m -> ${band.label}, clearance ${m.minClearance?.toFixed(2)}m`);
    check("  ...and the naive surface test WOULD have false-positived", naiveHits(samples, [box]), `naive capsule-surface test fires on the ${(CAPSULE_RADIUS - 0.2).toFixed(2)}m overlap`);
  }
  // SURFACE CONTACT — feet resting ON the box top (y=6). Axis is above the roof.
  {
    const samples = [{ x: 0, y: 6.0, z: 0, height: 1.55, acting: true }];
    const m = measurePath(samples, [box]); const band = bandOf(m.worst?.depthM ?? 0);
    check("feet-on-surface contact is NOT flagged", band.rank === 0, `depth ${(m.worst?.depthM ?? 0).toFixed(2)}m -> ${band.label}, clearance ${m.minClearance?.toFixed(2)}m`);
    check("  ...and the naive surface test WOULD have false-positived", naiveHits(samples, [box]), "naive capsule-surface test fires on the feet touching the roof");
  }
  // DEPTH IS HONEST — a body 1 m from the nearest face reports ~1 m.
  {
    const big = solidFrom("BIG", boxTris(0, 0, 0, 10, 10, 10));
    const samples = [{ x: 4.0, y: 4.0, z: 0, height: 1.55, acting: true }];
    const m = measurePath(samples, [big]); const d = m.worst?.depthM ?? 0;
    check("reported depth is the true exit distance", Math.abs(d - 1.0) < 0.1, `measured ${d.toFixed(2)}m from the nearest face (expected ~1.0m)`);
  }
  console.log(failed === 0
    ? "\ndrawn-penetration selftest: OK (flags a body inside a drawn solid and a path swept\n  through one; refuses the contain-fit gap and surface contact the naive test screams at;\n  and the reported depth is the true exit distance)"
    : `\ndrawn-penetration selftest: FAIL (${failed} case(s))`);
  return failed;
}

// ---------------------------------------------------------------- prove (known-bad)
// The discipline: if the real run reports zero, be suspicious of the INSTRUMENT
// before believing the world. This drives every authored transition, TRANSLATES
// the captured path 1.0 m toward the nearest solid's centre (a body authored into
// the wall), and re-measures — proving the instrument lights up. If it stays dark
// with the body shoved into a wall, the instrument is broken, not the world.
function prove() {
  const level = M1_EFFIGY_RUN;
  const { world } = compileLevel(level);
  const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
  const { solids } = buildDrawnWorld();
  let bestLink = null;
  for (const link of level.links) {
    if (!AUTHORED_TRANSITION.has(link.kind)) continue;
    const driven = drivePath(world, nodeById, link); if (!driven || !driven.samples.length) continue;
    const mid = driven.samples[Math.floor(driven.samples.length / 2)];
    let near = null, nearD = Infinity;
    for (const s of solids) { const cx = (s.min[0] + s.max[0]) / 2, cz = (s.min[2] + s.max[2]) / 2; const d = Math.hypot(mid.x - cx, mid.z - cz); if (d < nearD) { nearD = d; near = s; } }
    if (!near) continue;
    const cx = (near.min[0] + near.max[0]) / 2, cz = (near.min[2] + near.max[2]) / 2;
    const dx = cx - mid.x, dz = cz - mid.z; const l = Math.hypot(dx, dz) || 1;
    const shoved = driven.samples.map((s) => ({ ...s, x: s.x + (dx / l) * 1.0, z: s.z + (dz / l) * 1.0 }));
    const m = measurePath(shoved, solids); const depth = m.worst?.depthM ?? 0;
    if (!bestLink || depth > bestLink.depth) bestLink = { linkId: link.id, depth, mesh: m.worst?.id, asset: m.worst?.asset, near: near.id };
  }
  console.log("drawn-penetration --prove: shove each authored path 1.0 m toward the nearest\n  solid's centre (a body authored into the wall) and confirm the instrument lights up.\n");
  if (bestLink && bestLink.depth > SKIN_M) {
    console.log(`  OK: with the body shoved into a wall, the deepest flag is ${bestLink.depth.toFixed(2)} m ` +
      `into ${bestLink.asset} (${bestLink.mesh}) on ${bestLink.linkId} -> ${bandOf(bestLink.depth).label}.`);
    console.log("  The instrument reacts to a body inside drawn geometry; a zero on the real run is\n" +
      "  therefore about the world, not a dead instrument.");
    return 0;
  }
  console.log("  FAIL: even a body shoved 1 m into the nearest solid produced no flag.");
  return 1;
}

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
if (argv.includes("--selftest")) process.exit(selfTest() === 0 ? 0 : 1);

// The instrument proves itself before it measures anything.
if (selfTest() !== 0) { console.error("\ndrawn-penetration: refusing to measure with a broken instrument."); process.exit(1); }
console.log("");

if (argv.includes("--prove")) process.exit(prove());

const data = run();
report(data, { asJson: argv.includes("--json") });

if (argv.includes("--gate")) {
  // Conservative: only the deepest bands (a body past its own radius inside a
  // drawn solid, beyond every contain-fit and contact excuse) break the build.
  const blocking = data.rows.filter((r) => r.band.rank >= 3);
  if (blocking.length) { console.error(`\n  GATE FAIL: ${blocking.length} transition(s) drive the body past a body radius into drawn geometry.`); process.exit(1); }
}

// ---------------------------------------------------------------- gate or report?
// WHY THIS SHIPS AS A RANKED REPORT, not a hard gate (default exit 0). The
// containment verdict rests on ray-parity through published Meshy assets that are
// not guaranteed watertight; the majority vote makes a single seam harmless but
// cannot promise a clean pass/fail on every open shell. A depth of 0.8 m into a
// filled mass is unarguable; a 0.05 m MARGINAL clip is more often a mesh drawn a
// touch proud of its hull than a phased body, and overlaps what the collision-fill
// gate already owns. Ranking by depth puts the honest signal where a human can act
// on it and keeps the arguable noise from disabling the whole check — a gate that
// cries wolf gets turned off, and a disabled gate is worse than none. `--gate`
// blocks ONLY the deepest band for CI, once the elm and Town House reworks settle;
// the report is the deliverable everywhere else.
