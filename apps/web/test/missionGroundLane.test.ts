import { test } from "node:test";
import assert from "node:assert/strict";

import { FIELD_DT, createGroundedState, groundedSupport } from "@pa/engine-world";
import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  positionClear,
  type CollisionWorld,
} from "@pa/engine-world/collision";
import { M1_EFFIGY_RUN } from "@pa/mission-m1";
import { M1_MISSION_ID, m1Instance } from "../src/chapter/m1Mission.js";
import {
  createMissionRuntime,
  stepMissionRuntime,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import { resolveEncountersForTraversal } from "./traversalEncounters.js";

// ---------------------------------------------------------------------------
// THE SHAMBLES GROUND LANE IS PASSABLE ON A NORMAL FORWARD RUN — NO CLIMBING,
// NO PHASING.
//
// The owner's report was that the street after the constable had "LITERALLY no
// way to pass without climbing through objects." Root cause, proven with the
// shipped reader (see .affordwork): the guaranteed street line crosses the gaol
// barrels with a VAULT, and that vault only committed on the exact z=-0.6 axis.
// The street's own through-nodes sit at z=-0.4, so a player running the natural
// lane arrived 0.2m north of the vault axis, where the lifted (standing) capsule
// would clip the flanking stall-canopy overhang (z=-0.20) — `beginAuthored`
// refused the vault, the body wedged against the barrels with a VAULT that never
// fired and NO feedback, and the only progress left was to climb the canopies:
// "climbing through objects", exactly.
//
// This drives the REAL runtime with the most naive possible input a player gives
// — hold forward, hold sprint, never crouch, never jump, steer at nothing but a
// point straight down the street — from the constable stop to the Shambles exit.
// A body that has to be steered onto a hair-fine axis, or told to crouch, or
// told to jump, to get past a mandatory obstacle is not a passable lane. This is
// the guard against the trap coming back: the naive run must clear the barrels
// and the hoist and reach the exit, WITHOUT ever standing on a prop (no climb)
// and WITHOUT ever overlapping a hull (no phasing).
//
// Before the fix (flanking canopies pulled out of the vault corridor) this test
// FAILS: the body stalls at x~=21.25 against the barrels and never reaches the
// exit. After it, the naive run walks the whole lane.
// ---------------------------------------------------------------------------

const STALL_EPSILON_M = 0.002;
const MAX_STALL_TICKS = 90; // 1.5s at 60Hz — longer than any authored vault/slide.

function firstAttemptRuntime(): MissionRuntime {
  const instance = m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1,
    seed: 0xb057,
    Scenery: null,
  });
  const runtime = createMissionRuntime({ instance, seed: 0xb057 });
  resolveEncountersForTraversal(runtime);
  return runtime;
}

function kerbIds(world: CollisionWorld): Set<string> {
  const ids = new Set<string>();
  for (const b of world.blockers) {
    if (b.landable && Number.isFinite(b.topY) && b.topY - b.baseY <= 0.5) {
      ids.add(b.id);
    }
  }
  return ids;
}

const node = (id: string) => {
  const n = M1_EFFIGY_RUN.nodes.find((candidate) => candidate.id === id);
  if (!n) throw new Error(`no node ${id}`);
  return { x: n.pos[0], y: n.pos[1], z: n.pos[2] };
};

test("a naive forward run clears the Shambles ground lane — no climb, no phasing", () => {
  const runtime = firstAttemptRuntime();
  const world = runtime.instance.world;
  const kerbs = kerbIds(world);

  // Spawn on the ground at the constable stop, facing straight east down the
  // street — the body a player arrives with off the alley descent.
  const start = node("B_STREET_W");
  const exit = node("B_EXIT");
  runtime.motion = createGroundedState(
    { x: start.x, y: 0, z: start.z },
    Math.PI / 2, // +x
  );

  let stall = 0;
  let maxStall = 0;
  let reachedExit = false;
  let penetratedAt: { x: number; y: number; z: number } | null = null;
  let climbedOn: string | null = null;
  let prev = { x: runtime.motion.pos.x, z: runtime.motion.pos.z };

  for (let tick = 0; tick < 30 * 60; tick += 1) {
    const p = runtime.motion.pos;
    // The naive input: steer at a point straight down the street, sprint held,
    // and nothing else. No crouch key, no jump, no per-obstacle consent.
    const dx = exit.x - p.x;
    const dz = exit.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const step = stepMissionRuntime(runtime, {
      dtS: FIELD_DT,
      moveX: dx / len,
      moveZ: dz / len,
      sprintHeld: true,
      crouchHeld: false,
      jumpBuffered: false,
      reducedMotion: false,
      flowEnabled: true,
    });

    const np = runtime.motion.pos;
    assert.notEqual(
      runtime.outcome?.kind,
      "FAILED",
      `the naive ground run failed: ${runtime.outcome?.kind}`,
    );

    // No phasing: a grounded body between authored actions must never overlap a
    // solid hull.
    if (runtime.motion.grounded && runtime.motion.action === null && step.steps > 0) {
      if (!positionClear(world, np, CAPSULE_RADIUS, STAND_HEIGHT, kerbs) && !penetratedAt) {
        penetratedAt = { x: +np.x.toFixed(2), y: +np.y.toFixed(2), z: +np.z.toFixed(2) };
      }
    }

    // No climbing: a body walking the STREET line must only ever stand on the
    // ground (a brief vault/slide is airborne and stands on nothing). Standing on
    // a stall, cart or crate top here is the "climb through objects" the report
    // named. The low pump kerb is a free step and does not count.
    if (runtime.motion.grounded) {
      const support = groundedSupport(world, np)?.id ?? "GROUND";
      if (support !== "GROUND" && support !== "PUMP_KERB" && !climbedOn) {
        climbedOn = support;
      }
    }

    const moved = Math.hypot(np.x - prev.x, np.z - prev.z);
    if (step.steps > 0) stall = moved < STALL_EPSILON_M ? stall + step.steps : 0;
    if (stall > maxStall) maxStall = stall;
    prev = { x: np.x, z: np.z };

    // Reached the Shambles exit, staying grounded on the street.
    if (runtime.motion.grounded && np.x >= exit.x - 0.9 && np.y < 0.5) {
      reachedExit = true;
      break;
    }
  }

  assert.equal(
    penetratedAt,
    null,
    `the body overlapped a hull at ${JSON.stringify(penetratedAt)} — it phased through geometry`,
  );
  assert.equal(
    climbedOn,
    null,
    `the naive ground run climbed onto ${climbedOn} — the lane forced climbing over a prop`,
  );
  assert.ok(
    reachedExit,
    "the naive forward run never reached the Shambles exit — it wedged in the lane (the gaol-barrel vault trap)",
  );
  assert.ok(
    maxStall <= MAX_STALL_TICKS,
    `the naive run stalled ${(maxStall / 60).toFixed(1)}s in the lane — the street is not cleanly passable`,
  );
});
