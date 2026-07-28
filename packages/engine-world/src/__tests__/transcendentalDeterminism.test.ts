// The fixed-step blends in playerMotion are BAKED decimal literals rather than
// `1 - Math.exp(...)` computed at load, because a numeric literal parses to the
// same double on every conforming engine while `Math.exp` does not. That trade is
// only sound if the literal actually equals the expression it stands in for — so
// this re-derives it in the authoring engine (Node, where every golden runs) and
// fails the moment ACCEL, DECEL, FIELD_DT or a literal drifts out of agreement.
//
// It also pins the fixed-step invariant those literals depend on: stepMotion and
// stepFlow must be called with FIELD_DT, and `assertFieldDt` is the one guard that
// makes a wrong dt loud instead of silently integrating the wrong blend.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCEL,
  DECEL,
  GROUNDED_ACCEL_BLEND,
  GROUNDED_DECEL_BLEND,
  assertFieldDt,
  createGroundedState,
  stepMotion,
} from "../playerMotion.js";
import { FIELD_DT } from "../fieldSimulation.js";
import type { CollisionWorld } from "../collision.js";

const OPEN: CollisionWorld = {
  blockers: [],
  platforms: [],
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
};

test("the baked grounded blends equal 1 - exp(-rate * FIELD_DT * 0.6), bit for bit", () => {
  assert.equal(FIELD_DT, 1 / 60);
  const accel = 1 - Math.exp(-ACCEL * FIELD_DT * 0.6);
  const decel = 1 - Math.exp(-DECEL * FIELD_DT * 0.6);
  // Object.is so a drift into -0/NaN cannot slip past ===.
  assert.ok(
    Object.is(GROUNDED_ACCEL_BLEND, accel),
    `GROUNDED_ACCEL_BLEND ${GROUNDED_ACCEL_BLEND} !== ${accel}; re-bake it`,
  );
  assert.ok(
    Object.is(GROUNDED_DECEL_BLEND, decel),
    `GROUNDED_DECEL_BLEND ${GROUNDED_DECEL_BLEND} !== ${decel}; re-bake it`,
  );
  // And they round-trip through their own decimal spelling, which is what makes
  // them engine-independent — the property that would be lost by a hand-typo.
  assert.equal(Number(GROUNDED_ACCEL_BLEND.toString()), GROUNDED_ACCEL_BLEND);
  assert.equal(Number(GROUNDED_DECEL_BLEND.toString()), GROUNDED_DECEL_BLEND);
});

test("assertFieldDt accepts FIELD_DT and rejects anything else", () => {
  assert.doesNotThrow(() => assertFieldDt(FIELD_DT));
  assert.doesNotThrow(() => assertFieldDt(1 / 60));
  for (const bad of [1 / 30, 1 / 120, 0.016, 0, 0.05, Number.NaN]) {
    assert.throws(() => assertFieldDt(bad), /FIELD_DT/);
  }
});

test("stepMotion refuses a non-fixed step so a wrong blend can never be integrated", () => {
  const state = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
  const input = { targetVelX: 1, targetVelZ: 0, reducedMotion: false };
  assert.doesNotThrow(() =>
    stepMotion(OPEN, state, { ...input, dt: FIELD_DT }),
  );
  assert.throws(
    () => stepMotion(OPEN, state, { ...input, dt: 1 / 30 }),
    /FIELD_DT/,
  );
});
