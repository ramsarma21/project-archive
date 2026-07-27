import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOOK_TUNING,
  applyLookDelta,
  chaseCameraDistance,
  chaseCameraPosition,
  chaseFocus,
  createLookState,
  lookForward,
  lookMoveIntent,
  lookRight,
} from "../playerLook.js";
import {
  RUN_SPEED,
  createGroundedState,
  type MotionState,
} from "../playerMotion.js";
import { createFlowState, stepFlow, type FlowState } from "../parkour/flow.js";
import { FIELD_DT } from "../fieldSimulation.js";
import { wallFromRect, type CollisionWorld } from "../collision.js";

const OPEN_GROUND: CollisionWorld = {
  blockers: [],
  platforms: [],
  bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 },
};

test("mouse travel turns the look and nothing else does", () => {
  const rest = createLookState(0);
  assert.equal(rest.yaw, 0);
  assert.equal(rest.pitch, LOOK_TUNING.restPitchRad);

  const turned = applyLookDelta(rest, 500, 0);
  assert.ok(Math.abs(turned.yaw - -500 * LOOK_TUNING.radPerPixel) < 1e-9);
  // And it is reversible, so a gesture and its opposite leave no drift.
  const back = applyLookDelta(turned, -500, 0);
  assert.ok(Math.abs(back.yaw) < 1e-9);
});

test("pitch is clamped at both ends", () => {
  const down = applyLookDelta(createLookState(0), 0, 100000);
  assert.equal(down.pitch, LOOK_TUNING.maxPitchRad);
  const up = applyLookDelta(createLookState(0), 0, -100000);
  assert.equal(up.pitch, LOOK_TUNING.minPitchRad);
});

test("a non-finite delta is ignored rather than poisoning the look", () => {
  const look = { yaw: 0.5, pitch: 0.2 };
  assert.deepEqual(applyLookDelta(look, Number.NaN, 0), look);
  assert.deepEqual(applyLookDelta(look, 0, Number.POSITIVE_INFINITY), look);
});

test("the movement basis is right-handed and orthogonal to forward", () => {
  for (const yaw of [0, 0.7, Math.PI / 2, -2.1, Math.PI]) {
    const f = lookForward(yaw);
    const r = lookRight(yaw);
    assert.ok(Math.abs(f.x * r.x + f.z * r.z) < 1e-12, "forward . right == 0");
    assert.ok(Math.abs(Math.hypot(f.x, f.z) - 1) < 1e-12);
    assert.ok(Math.abs(Math.hypot(r.x, r.z) - 1) < 1e-12);
  }
  // Facing +Z, "right" is -X, matching three.js' right-handed Y-up convention.
  const right = lookRight(0);
  assert.ok(Math.abs(right.x - -1) < 1e-12);
  assert.ok(Math.abs(right.z) < 1e-12);
});

test("intent follows the look, so pressing W walks where you are aimed", () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 1.234]) {
    const move = lookMoveIntent(yaw, 1, 0);
    assert.ok(Math.abs(Math.atan2(move.x, move.z) - Math.atan2(Math.sin(yaw), Math.cos(yaw))) < 1e-9);
  }
});

function strafeHeading(frameDt: number, seconds: number): number {
  let motion: MotionState = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
  let flow: FlowState = createFlowState();
  // The basis is rebuilt every frame from a look nothing writes back to, which
  // is the property under test.
  const look = createLookState(0);
  let carry = 0;
  for (let t = 0; t < seconds; t += frameDt) {
    carry += frameDt;
    const move = lookMoveIntent(look.yaw, 0, 1);
    while (carry >= FIELD_DT) {
      carry -= FIELD_DT;
      const result = stepFlow(OPEN_GROUND, motion, flow, {
        dt: FIELD_DT,
        targetVelX: move.x * RUN_SPEED,
        targetVelZ: move.z * RUN_SPEED,
        sprintHeld: true,
        crouchHeld: false,
        jumpBuffered: false,
        dashBuffered: false,
        flowEnabled: true,
        reducedMotion: false,
        receivingTargets: [],
      });
      motion = result.motion;
      flow = result.flow;
    }
  }
  return motion.yaw;
}

/**
 * The regression that matters.
 *
 * The shipped camera was placed behind `motion.yaw`, and the movement basis was
 * then read back off the camera's position — so a held strafe key fed its own
 * output into its own input and the heading precessed without bound: 442
 * degrees in 3.6 seconds, measured in the browser, which the owner reported as
 * the camera moving randomly whenever they moved.
 *
 * With the basis taken from the look, a constant input has a constant heading.
 * The body turns ONCE, to face the way it is travelling, and then holds.
 */
test("a held strafe settles on one heading instead of precessing", () => {
  const yaw = strafeHeading(1 / 60, 6);
  // Strafing right from a look of 0 means travelling toward -X, which is a body
  // yaw of -90 degrees. Reached, and then kept, for the rest of the run.
  assert.ok(
    Math.abs(yaw - -Math.PI / 2) < 1e-3,
    `expected the body to settle facing -90deg, got ${((yaw * 180) / Math.PI).toFixed(2)}deg`,
  );
});

test("that heading is the same at every frame rate", () => {
  const rates = [1 / 144, 1 / 120, 1 / 60, 1 / 30, 1 / 20];
  const headings = rates.map((dt) => strafeHeading(dt, 6));
  const spread = Math.max(...headings) - Math.min(...headings);
  assert.ok(
    spread < 1e-6,
    `headings varied by ${((spread * 180) / Math.PI).toFixed(4)}deg across ${rates.length} frame rates`,
  );
});

test("the camera sits behind the look at the authored framing", () => {
  const look = createLookState(0);
  const focus = chaseFocus({ x: 0, y: 0, z: 0 });
  const camera = chaseCameraPosition(look, focus);
  // Behind the player in -Z, and above the focus.
  assert.ok(camera.z < focus.z);
  assert.ok(camera.y > focus.y);
  // The framing the previous camera shipped with: 4.8m back, 2.5m above the feet.
  assert.ok(Math.abs(Math.abs(camera.z) - 4.8) < 0.05, `z ${camera.z}`);
  assert.ok(Math.abs(camera.y - 2.5) < 0.05, `y ${camera.y}`);
});

test("the camera pulls in rather than sitting inside a wall", () => {
  const world: CollisionWorld = {
    blockers: [
      wallFromRect("WALL", 0, -2, 6, 0.25, { topY: Infinity }),
    ],
    platforms: [],
    bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
  };
  const look = createLookState(0);
  const focus = chaseFocus({ x: 0, y: 0, z: 0 });
  const pulled = chaseCameraDistance(world, look, focus);
  assert.ok(
    pulled < LOOK_TUNING.chaseDistanceM,
    "a wall between the focus and the camera must shorten the boom",
  );
  assert.ok(pulled >= LOOK_TUNING.minChaseDistanceM);
  // Open ground leaves it alone, and cheaply: the common case is one query.
  assert.equal(
    chaseCameraDistance(OPEN_GROUND, look, focus),
    LOOK_TUNING.chaseDistanceM,
  );
});
