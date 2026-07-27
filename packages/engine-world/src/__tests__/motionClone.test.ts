// The walk-off prediction steps a copy of the live body forward through the real
// integrator. If that copy shared any structure with the live state, a
// prediction — dozens of them a second — could reach back and corrupt the body
// it was asked about. These prove the clone is a complete, independent deep copy
// and that a prediction cannot alter the live state it was handed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type CollisionWorld,
  platformFromRect,
} from "../collision.js";
import {
  DASH_DURATION_MS,
  RUN_SPEED,
  beginAuthored,
  beginDash,
  cloneMotionState,
  createGroundedState,
  dashSpeed,
  simulateWalkOff,
  type MotionState,
} from "../playerMotion.js";
import { FIELD_DT } from "../fieldSimulation.js";
import { probeAhead } from "../parkour/probe.js";

const OPEN_BOUNDS = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };

/** A rich live state: an authored action with anchors and an ignore set. */
function authoredState(): MotionState {
  const w: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("TOP", -1, 1, -1, 1, 1.5)],
    bounds: OPEN_BOUNDS,
  };
  const begun = beginAuthored(w, createGroundedState({ x: 0, y: 0, z: 2 }, 0), {
    kind: "CLIMB_UP",
    anchors: [
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 1.5, z: 0, yaw: 0.5 },
    ],
    durationMs: 800,
    ignore: ["TOP"],
  });
  assert.ok(begun, "the fixture action must begin");
  return begun!;
}

test("cloneMotionState is a complete, independent deep copy", () => {
  const original = authoredState();
  assert.ok(original.action, "fixture has an action");
  const clone = cloneMotionState(original);

  // Same values.
  assert.deepEqual(clone, original);
  // But no shared references, at any depth.
  assert.notEqual(clone.pos, original.pos);
  assert.notEqual(clone.vel, original.vel);
  assert.notEqual(clone.action, original.action);
  assert.notEqual(clone.action!.anchors, original.action!.anchors);
  assert.notEqual(clone.action!.anchors[0], original.action!.anchors[0]);
  assert.notEqual(clone.action!.ignore, original.action!.ignore);
  assert.notEqual(clone.action!.startPos, original.action!.startPos);
  assert.notEqual(clone.action!.endPos, original.action!.endPos);

  // Mutating every nested part of the clone leaves the original untouched.
  clone.pos.x = 999;
  clone.vel.z = 999;
  clone.yaw = 9;
  clone.airtimeMs = 9;
  clone.action!.elapsedMs = 999;
  clone.action!.anchors[0]!.x = 999;
  clone.action!.anchors.push({ x: 1, y: 2, z: 3 });
  clone.action!.ignore.add("INJECTED");
  clone.action!.startPos.y = 999;
  clone.action!.endPos.z = 999;

  const fresh = authoredState();
  assert.deepEqual(original, fresh, "the original was mutated through a shared reference");
});

test("a dash state clones its window independently", () => {
  const dash = beginDash(createGroundedState({ x: 0, y: 0, z: 0 }, 0), 0, 1, dashSpeed(RUN_SPEED), DASH_DURATION_MS);
  const clone = cloneMotionState(dash);
  assert.deepEqual(clone, dash);
  assert.notEqual(clone.dash, dash.dash);
  clone.dash!.elapsedMs = 999;
  assert.notEqual(dash.dash!.elapsedMs, 999);
});

test("a prediction cannot alter the live state it was handed", () => {
  // A world with a lip ahead so the read actually runs a walk-off prediction.
  const w: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("ROOF", -3, 3, -6, 0, 8)],
    bounds: OPEN_BOUNDS,
  };
  for (const live of [
    { ...createGroundedState({ x: 0, y: 8, z: -1 }, 0), vel: { x: 0, y: 0, z: RUN_SPEED } },
    beginDash(createGroundedState({ x: 0, y: 8, z: -1 }, 0), 0, 1, dashSpeed(RUN_SPEED), DASH_DURATION_MS),
  ] as MotionState[]) {
    const before = cloneMotionState(live);
    // Route the live state through the prediction seam (probeAhead -> predictWalkOff,
    // which deep-clones) and directly through the integrator.
    probeAhead(w, {
      pos: live.pos,
      velX: live.vel.x,
      velZ: live.vel.z,
      yaw: live.yaw,
      intentX: 0,
      intentZ: RUN_SPEED,
      airtimeMs: live.airtimeMs,
      capsuleHeight: live.capsuleHeight,
      motion: live,
    });
    // And directly through the integrator the prediction uses.
    simulateWalkOff(w, live, 0, RUN_SPEED, { dt: FIELD_DT });
    assert.deepEqual(live, before, "the prediction mutated the live state");
  }
});
