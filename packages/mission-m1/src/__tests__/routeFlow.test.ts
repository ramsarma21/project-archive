import { test } from "node:test";
import assert from "node:assert/strict";

import { CAPSULE_RADIUS, canStand, supportBelow } from "@pa/engine-world/collision";
import { RUN_SPEED, WALK_SPEED, createGroundedState } from "@pa/engine-world/playerMotion";
import { FIELD_DT } from "@pa/engine-world/fieldSimulation";
import { PARKOUR_TUNING, createFlowState, stepFlow } from "@pa/engine-world/parkour";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";

// ---------------------------------------------------------------------------
// ROUTE GUARDRAIL, DRIVEN BY THE REAL CONTROLLER.
//
// traversal.ts verifies links by asking `simulateBallistic` / `beginAuthored`
// whether a move COULD run — it models a plan, not a run. `ladderOffers.test.ts`
// asks `selectVerb` what the geometry OFFERS, and deliberately skips descending
// links because a drop is the edge reader's business, not the obstacle ladder's.
// Neither one steps the actual `stepFlow` controller down a descent and checks
// where the body ends up.
//
// This does. For every descending link a player crosses by holding the parkour
// key and steering — the roofline the whole mission comes down — it stands a
// body at the approach, drives real `stepFlow`, and requires the body to arrive
// standing on the AUTHORED destination surface, having taken no fall past the
// roll ceiling on the way. That is the exact property the high-lip landing fix
// exists to keep true at speed, checked against the real level rather than a
// synthetic fixture.
// ---------------------------------------------------------------------------

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const world = compiled.world;
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));

/** Descents a body takes by holding forward, not by a named jump or a dive. */
const READER_DRIVEN = new Set(["DROP", "CLIMB", "VAULT"]);

interface Descent {
  id: string;
  line: string;
  fromId: string;
  toId: string;
  toSurface: string;
  toPos: readonly [number, number, number];
  dirX: number;
  dirZ: number;
  startX: number;
  startY: number;
  startZ: number;
}

function descents(lines: ReadonlySet<string>): Descent[] {
  const out: Descent[] = [];
  for (const link of level.links) {
    if (!lines.has(link.line)) continue;
    if (!READER_DRIVEN.has(link.kind)) continue;
    const from = nodeById.get(link.from);
    const to = nodeById.get(link.to);
    if (!from || !to) continue;
    if (to.pos[1] >= from.pos[1] - 0.35) continue; // not a descent
    const dx = to.pos[0] - from.pos[0];
    const dz = to.pos[2] - from.pos[2];
    const planar = Math.hypot(dx, dz);
    // A vertical hang-down has no forward direction to steer along; the body
    // reaches it by lowering itself, which the authored/plan tests cover. Only
    // the descents a player travels across are drivable by holding forward.
    if (planar < 1) continue;
    const dirX = dx / planar;
    const dirZ = dz / planar;
    // Back off from the lip node onto standable ground the body arrives across.
    let back = 1.6;
    let startX = from.pos[0] - dirX * back;
    let startZ = from.pos[2] - dirZ * back;
    while (back > 0.4) {
      const support = supportBelow(world, startX, startZ, from.pos[1] + 0.05, 0.05);
      if (
        support &&
        Math.abs(support.y - from.pos[1]) < 0.05 &&
        canStand(world, startX, startZ, CAPSULE_RADIUS, from.pos[1])
      ) {
        break;
      }
      back -= 0.2;
      startX = from.pos[0] - dirX * back;
      startZ = from.pos[2] - dirZ * back;
    }
    out.push({
      id: link.id,
      line: link.line,
      fromId: link.from,
      toId: link.to,
      toSurface: to.surface,
      toPos: to.pos,
      dirX,
      dirZ,
      startX,
      startY: from.pos[1],
      startZ,
    });
  }
  return out;
}

interface Outcome {
  reached: boolean;
  worstFall: number;
  endSurface: string | null;
}

function drive(descent: Descent, speed: number): Outcome {
  let motion = createGroundedState(
    { x: descent.startX, y: descent.startY, z: descent.startZ },
    Math.atan2(descent.dirX, descent.dirZ),
  );
  let flow = createFlowState();
  let worstFall = 0;
  let leftFrom: number | null = null;
  let reached = false;
  let endSurface: string | null = null;
  for (let tick = 0; tick < Math.round(6 / FIELD_DT); tick++) {
    // Steer toward the destination the way a player following the route does,
    // rather than holding one fixed heading off the start — a fixed heading
    // sails a fast body past a small target that a steering one settles onto.
    let aimX = descent.toPos[0] - motion.pos.x;
    let aimZ = descent.toPos[2] - motion.pos.z;
    const aimLen = Math.hypot(aimX, aimZ);
    if (aimLen > 1e-6) {
      aimX /= aimLen;
      aimZ /= aimLen;
    } else {
      aimX = descent.dirX;
      aimZ = descent.dirZ;
    }
    const wasGrounded = motion.grounded;
    const wasY = motion.pos.y;
    const result = stepFlow(world, motion, flow, {
      dt: FIELD_DT,
      targetVelX: aimX * speed,
      targetVelZ: aimZ * speed,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: false,
      flowEnabled: true,
      reducedMotion: false,
      receivingTargets: [],
    });
    motion = result.motion;
    flow = result.flow;
    if (wasGrounded && !motion.grounded) leftFrom = wasY;
    if (!wasGrounded && motion.grounded && leftFrom !== null) {
      worstFall = Math.max(worstFall, leftFrom - motion.pos.y);
      leftFrom = null;
    }
    if (motion.grounded) {
      const support = supportBelow(world, motion.pos.x, motion.pos.z, motion.pos.y + 0.05, 0.05);
      endSurface = support?.id ?? null;
      if (
        support?.id === descent.toSurface &&
        Math.abs(motion.pos.y - descent.toPos[1]) < 0.6
      ) {
        reached = true;
        break;
      }
    }
  }
  return { reached, worstFall, endSurface };
}

/** Reached the authored surface at either a cautious walk or a committed sprint. */
function reachesAuthoredSurface(descent: Descent): Outcome {
  const walk = drive(descent, WALK_SPEED);
  if (walk.reached) return walk;
  return drive(descent, RUN_SPEED);
}

test("the level authors reader-driven descents to check", () => {
  const safe = descents(new Set(["SAFE"]));
  assert.ok(
    safe.length >= 6,
    `expected several SAFE descents; found ${safe.length}`,
  );
});

test("driving real stepFlow down every SAFE descent lands the body on the authored surface", () => {
  // No allowlist. Every SAFE descent must be one the reader can actually drive a
  // body down — including the objective's, off the Liberty Elm crown. F_POST's
  // descent is authored through F_POST_STEP, the exposed rim of the low bough,
  // because F_LOW itself sits back under the crown's overhang with no lip to
  // leave from; standing still on the crown is a failure, not a pass.
  const failures: string[] = [];
  for (const descent of descents(new Set(["SAFE"]))) {
    const outcome = reachesAuthoredSurface(descent);
    const key = `${descent.fromId}->${descent.toId}`;
    if (!outcome.reached) {
      failures.push(
        `${descent.id} (${key}): ended on ${outcome.endSurface ?? "nothing"}, ` +
          `wanted ${descent.toSurface}`,
      );
    }
  }
  assert.deepEqual(
    failures,
    [],
    `SAFE descents that real stepFlow does not land on their authored surface:\n  ${failures.join("\n  ")}`,
  );
});

test("no SAFE or FAST descent driven at sprint takes a fall past the roll ceiling", () => {
  // The whole point of the landing-prediction fix: a body coming down the route
  // at speed is braked or caught before any single fall is unsurvivable.
  const overThreshold: string[] = [];
  for (const descent of descents(new Set(["SAFE", "FAST"]))) {
    const outcome = drive(descent, RUN_SPEED);
    if (outcome.worstFall > PARKOUR_TUNING.rollMaxDropM + 1e-6) {
      overThreshold.push(
        `${descent.id} (${descent.fromId}->${descent.toId}) fell ${outcome.worstFall.toFixed(2)}m`,
      );
    }
  }
  assert.deepEqual(
    overThreshold,
    [],
    `descents that drop a sprinting body past the ${PARKOUR_TUNING.rollMaxDropM}m roll ceiling:\n  ${overThreshold.join("\n  ")}`,
  );
});
