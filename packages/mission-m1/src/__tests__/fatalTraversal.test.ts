import { test } from "node:test";
import assert from "node:assert/strict";

import { CAPSULE_RADIUS, canStand, supportBelow } from "@pa/engine-world/collision";
import { RUN_SPEED, WALK_SPEED, createGroundedState } from "@pa/engine-world/playerMotion";
import { FIELD_DT } from "@pa/engine-world/fieldSimulation";
import { PARKOUR_TUNING, createFlowState, stepFlow } from "@pa/engine-world/parkour";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";

// ---------------------------------------------------------------------------
// NO AUTOMATIC TRAVERSAL ENDS IN A FATAL FALL — EXHAUSTIVELY, AND ACCOUNTABLY.
//
// A body is driven off EVERY edge station of EVERY authored surface that stands
// high enough to kill — every platform and every landable blocker top above the
// roll ceiling. For each station the scan does not assume a fixed run-up: it
// SEARCHES for the longest run-up that stays on the deck and can reach the lip,
// shortening it until it fits a small deck. A station is called unreachable only
// after a bounded search proves no supported run-up exists, and the exact reason
// is recorded. Every reachable station is then driven at a walk, a run, and a
// REAL dash fired at three phases of the approach.
//
// The scan is accountable for every candidate: reachable + unreachable equals the
// total, every reachable station/timing has an executed result, and nothing is
// silently skipped. A verb the reader offers automatically is the world taking
// hold of the player; it may never take a leave-to-touch fall past the roll
// ceiling, in any mode, off any reachable edge — and the test fails on the first
// one that does.
// ---------------------------------------------------------------------------

const world = compileLevel(M1_EFFIGY_RUN).world;
const FATAL_M = PARKOUR_TUNING.rollMaxDropM;

const RUNUP_MAX_M = 2.4;
const RUNUP_MIN_M = 0.3;
const RUNUP_STEP_M = 0.1;
const SUPPORT_TOL = 0.02;

interface Surface {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

interface Lip {
  surfaceId: string;
  x: number;
  z: number;
  y: number;
  dirX: number;
  dirZ: number;
}

interface Config {
  name: string;
  speed: number;
  sprint: boolean;
  /** Fraction of the run-up remaining to the lip when the real dash fires, or null for no dash. */
  dashFrac: number | null;
}

const CONFIGS: Config[] = [
  { name: "walk", speed: WALK_SPEED, sprint: false, dashFrac: null },
  { name: "run", speed: RUN_SPEED, sprint: true, dashFrac: null },
  { name: "dash-start", speed: RUN_SPEED, sprint: true, dashFrac: 1.0 },
  { name: "dash-mid", speed: RUN_SPEED, sprint: true, dashFrac: 0.5 },
  { name: "dash-end", speed: RUN_SPEED, sprint: true, dashFrac: 0.15 },
];

// Every surface a body can be thrown off fatally: a platform, or a landable
// blocker's top face, whose deck stands more than one roll-height above the
// lowest thing it could land on (the street at 0). Anything lower cannot produce
// a leave-to-touch fall past the ceiling on its own.
function highSurfaces(): Surface[] {
  const out: Surface[] = [];
  for (const p of world.platforms) {
    if (p.y > FATAL_M) {
      out.push({ id: p.id, minX: p.minX, maxX: p.maxX, minZ: p.minZ, maxZ: p.maxZ, y: p.y });
    }
  }
  for (const b of world.blockers) {
    if (b.landable && Number.isFinite(b.topY) && b.topY > FATAL_M) {
      out.push({ id: b.id, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, y: b.topY });
    }
  }
  return out;
}

// Lip stations along all four edges of a surface's footprint, sampled at 1m. The
// bounding-box sides are a superset for a polygon deck; the run-up search below
// discards any station with no supported approach.
function lipsOf(s: Surface): Lip[] {
  const out: Lip[] = [];
  const sides: Array<[number, number, number, number, number, number]> = [
    [s.minX, s.minZ, s.maxX, s.minZ, 0, -1],
    [s.minX, s.maxZ, s.maxX, s.maxZ, 0, 1],
    [s.minX, s.minZ, s.minX, s.maxZ, -1, 0],
    [s.maxX, s.minZ, s.maxX, s.maxZ, 1, 0],
  ];
  for (const [x0, z0, x1, z1, dirX, dirZ] of sides) {
    const length = Math.hypot(x1 - x0, z1 - z0);
    if (length < 1e-6) continue;
    const ux = (x1 - x0) / length;
    const uz = (z1 - z0) / length;
    for (let along = 0.5; along < length; along += 1.0) {
      out.push({ surfaceId: s.id, x: x0 + ux * along, z: z0 + uz * along, y: s.y, dirX, dirZ });
    }
  }
  return out;
}

function supportedAtLipHeight(x: number, z: number, y: number): boolean {
  const sup = supportBelow(world, x, z, y + SUPPORT_TOL, SUPPORT_TOL);
  return sup !== null && Math.abs(sup.y - y) <= SUPPORT_TOL;
}

// Does the straight approach from a run-up start to the lip stay on the deck the
// whole way (support at the lip's height at the spawn and along the path), with
// room to stand at the spawn? Sampled to 90% of the way in, so the lip's own edge
// marginality does not disqualify an otherwise clear run-up.
function runupPathClear(lip: Lip, sx: number, sz: number): boolean {
  if (!canStand(world, sx, sz, CAPSULE_RADIUS, lip.y)) return false;
  const N = 4;
  for (let k = 0; k <= N; k++) {
    const t = (k / N) * 0.9;
    const px = sx + (lip.x - sx) * t;
    const pz = sz + (lip.z - sz) * t;
    if (!supportedAtLipHeight(px, pz, lip.y)) return false;
  }
  return true;
}

type Runup =
  | { ok: true; sx: number; sz: number; dist: number }
  | { ok: false; reason: string };

// Bounded search for the longest valid run-up. Longer is preferred (more speed,
// the more dangerous approach); it shortens by 0.1m until the start and its whole
// approach sit on the deck, down to 0.3m. Only when nothing in that range works
// is the station unreachable — and the reason is exact.
function findRunup(lip: Lip): Runup {
  let sawStandHeightFloorBlocked = false;
  let sawStandHeightFloorNotClear = false;
  let sawFloorWrongHeight = false;
  let sawAnyFloor = false;
  for (let d = RUNUP_MAX_M; d >= RUNUP_MIN_M - 1e-9; d -= RUNUP_STEP_M) {
    const sx = lip.x - lip.dirX * d;
    const sz = lip.z - lip.dirZ * d;
    const sup = supportBelow(world, sx, sz, lip.y + SUPPORT_TOL, SUPPORT_TOL);
    if (sup) sawAnyFloor = true;
    if (sup && Math.abs(sup.y - lip.y) <= SUPPORT_TOL) {
      if (!canStand(world, sx, sz, CAPSULE_RADIUS, lip.y)) {
        sawStandHeightFloorBlocked = true;
        continue;
      }
      if (runupPathClear(lip, sx, sz)) return { ok: true, sx, sz, dist: d };
      sawStandHeightFloorNotClear = true;
    } else if (sup) {
      sawFloorWrongHeight = true;
    }
  }
  const reason = sawStandHeightFloorBlocked
    ? "run-up obstructed (cannot stand behind the lip)"
    : sawStandHeightFloorNotClear
      ? "no run-up stays on the deck the whole approach"
      : sawFloorWrongHeight
        ? "ground behind the lip is at a different height"
        : sawAnyFloor
          ? "nothing supported at the lip's height behind it"
          : "no ground behind the lip at all";
  return { ok: false, reason };
}

/**
 * Worst single leave-to-touch fall for a body driven off `lip` from a validated
 * run-up start, under `config`. Always returns a number — the run-up was proven
 * valid before this ran. The dash is a REAL burst opened through production flow
 * (not a target velocity standing in for one), fired at the approach phase the
 * config names, as a fraction of THIS station's run-up.
 */
function worstFallOff(lip: Lip, run: { sx: number; sz: number; dist: number }, config: Config): number {
  const dashAtRemaining = config.dashFrac === null ? -1 : config.dashFrac * run.dist;
  let dashFired = false;

  let motion = createGroundedState(
    { x: run.sx, y: lip.y, z: run.sz },
    Math.atan2(lip.dirX, lip.dirZ),
  );
  let flow = createFlowState();
  let worst = 0;
  let leftFrom: number | null = null;
  let settledTicks = 0;
  for (let tick = 0; tick < Math.round(4 / FIELD_DT); tick++) {
    const alongToLip = (lip.x - motion.pos.x) * lip.dirX + (lip.z - motion.pos.z) * lip.dirZ;
    const wantDash = config.dashFrac !== null && !dashFired && alongToLip <= dashAtRemaining;
    if (wantDash) dashFired = true;
    const wasGrounded = motion.grounded;
    const wasY = motion.pos.y;
    const result = stepFlow(world, motion, flow, {
      dt: FIELD_DT,
      targetVelX: lip.dirX * config.speed,
      targetVelZ: lip.dirZ * config.speed,
      sprintHeld: config.sprint,
      crouchHeld: false,
      jumpBuffered: false,
      dashBuffered: wantDash,
      flowEnabled: true,
      reducedMotion: false,
      receivingTargets: [],
    });
    // Each leave-to-touch fall is measured on its own (a landing or an authored
    // completion ends one), so a chain of survivable descents is never summed
    // into a phantom fatal one.
    const touchedDown =
      (!wasGrounded && motion.grounded) ||
      result.events.some((ev) => ev.type === "landed" || ev.type === "verbCompleted");
    motion = result.motion;
    flow = result.flow;
    if (wasGrounded && !motion.grounded) leftFrom = wasY;
    if (touchedDown && leftFrom !== null) {
      worst = Math.max(worst, leftFrom - motion.pos.y);
      leftFrom = null;
    }
    // Bounded, not approximate: once the dash (if any) has been spent and the body
    // is grounded, stationary and not mid-fall, constant input can only hold it
    // there — the trajectory is over. Ending here is exact and spares the hundreds
    // of idle braked ticks that made the scan crawl.
    const speed = Math.hypot(motion.vel.x, motion.vel.z);
    const spent = config.dashFrac === null || dashFired;
    const settled = spent && motion.grounded && leftFrom === null && speed < 0.05;
    settledTicks = settled ? settledTicks + 1 : 0;
    if (settledTicks >= 15) break;
  }
  if (leftFrom !== null) worst = Math.max(worst, leftFrom - motion.pos.y);
  return worst;
}

test("every reachable high edge in M1 survives walk/run/dash; unreachable ones are accounted for", () => {
  const t0 = performance.now();
  const surfaces = highSurfaces();
  const stations: Lip[] = surfaces.flatMap(lipsOf);
  const total = stations.length;

  const failures: string[] = [];
  const unreachable: string[] = [];
  const unreachableReasons = new Map<string, number>();
  let reachable = 0;
  let executed = 0;
  let untested = 0;

  for (const lip of stations) {
    const run = findRunup(lip);
    if (!run.ok) {
      unreachable.push(
        `${lip.surfaceId} (${lip.x.toFixed(1)},${lip.y.toFixed(1)},${lip.z.toFixed(1)}) ` +
          `dir(${lip.dirX},${lip.dirZ}): ${run.reason}`,
      );
      unreachableReasons.set(run.reason, (unreachableReasons.get(run.reason) ?? 0) + 1);
      continue;
    }
    reachable += 1;
    for (const config of CONFIGS) {
      const fell = worstFallOff(lip, run, config);
      // A number is always produced for a reachable station/timing — no silent skip.
      if (!Number.isFinite(fell)) {
        untested += 1;
        continue;
      }
      executed += 1;
      if (fell > FATAL_M + 1e-6) {
        failures.push(
          `${lip.surfaceId} (${lip.x.toFixed(1)},${lip.y.toFixed(1)},${lip.z.toFixed(1)}) ` +
            `dir(${lip.dirX},${lip.dirZ}) runup=${run.dist.toFixed(1)}m ${config.name} fell ${fell.toFixed(2)}m`,
        );
      }
    }
  }

  const elapsedS = (performance.now() - t0) / 1000;
  const reasonSummary = [...unreachableReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `${n}× ${r}`)
    .join("; ");
  console.log(
    `[fatal-traversal scan] surfaces=${surfaces.length} ` +
      `(platforms=${world.platforms.filter((p) => p.y > FATAL_M).length}, ` +
      `landable-blockers=${world.blockers.filter((b) => b.landable && Number.isFinite(b.topY) && b.topY > FATAL_M).length}) ` +
      `candidates=${total} reachable=${reachable} unreachable=${unreachable.length} ` +
      `configs=${CONFIGS.length} (walk/run/dash start,mid,end) ` +
      `executed=${executed} untested=${untested} fatal=${failures.length} runtime=${elapsedS.toFixed(1)}s`,
  );
  if (unreachableReasons.size > 0) {
    console.log(`[fatal-traversal scan] unreachable reasons: ${reasonSummary}`);
  }

  // Coverage: every candidate is accounted for, every reachable station/timing
  // ran, and nothing was silently skipped.
  assert.equal(
    reachable + unreachable.length,
    total,
    "every candidate station must be classified reachable or unreachable",
  );
  assert.equal(untested, 0, "every reachable station/timing must have an executed result");
  assert.equal(
    executed,
    reachable * CONFIGS.length,
    "executed results must equal reachable stations times timings",
  );

  // No automatic traversal, in any mode, off any reachable edge, is fatal.
  assert.deepEqual(
    failures,
    [],
    `automatic traversal throws a body past the ${FATAL_M}m roll ceiling:\n  ${failures.join("\n  ")}`,
  );
});
