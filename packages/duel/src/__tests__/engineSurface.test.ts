import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_TICK_HZ,
  FIELD_DT,
  advanceFieldClock,
  createFieldClock,
  fieldRandom,
  segmentClear,
  stepMotion,
  createGroundedState,
  wallFromRect,
  freeMoveSpeed,
  RUN_SPEED,
  type CollisionWorld,
} from "../engine.js";

// This test exists to prove the duel is running on the shared engine rather than
// a local copy: if engine-world's clock, RNG, collision or motion move, this
// fails here first.

const world: CollisionWorld = {
  blockers: [wallFromRect("WALL", 0, 0, 1, 1, { topY: 2 })],
  platforms: [],
  bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
};

test("the duel consumes engine-world's fixed-step clock at 60 Hz", () => {
  assert.equal(FIELD_TICK_HZ, 60);
  assert.equal(FIELD_DT, 1 / 60);
  const r = advanceFieldClock(createFieldClock(7), FIELD_DT);
  assert.equal(r.steps, 1);
  assert.equal(r.clock.tick, 1);
});

test("the duel consumes engine-world's seeded randomness", () => {
  assert.equal(fieldRandom(11, 3, 1), fieldRandom(11, 3, 1));
  assert.ok(fieldRandom(11, 3, 1) >= 0 && fieldRandom(11, 3, 1) < 1);
});

test("the duel consumes engine-world's occlusion query", () => {
  assert.equal(
    segmentClear(world, { x: -5, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }),
    false,
    "a 2m wall at the origin occludes a chest-height segment through it",
  );
  assert.equal(
    segmentClear(world, { x: -5, y: 3, z: 0 }, { x: 5, y: 3, z: 0 }),
    true,
    "the same segment above the wall is clear",
  );
});

test("the duel consumes engine-world's locomotion and input policy", () => {
  assert.equal(
    freeMoveSpeed({ shiftHeld: true, moving: true, crouched: false, actionActive: false }),
    RUN_SPEED,
  );
  const start = createGroundedState({ x: -6, y: 0, z: 0 }, 0);
  const moved = stepMotion(world, start, {
    dt: FIELD_DT,
    targetVelX: RUN_SPEED,
    targetVelZ: 0,
    reducedMotion: false,
  });
  assert.ok(moved.state.pos.x > start.pos.x, "grounded motion advances");
  assert.equal(moved.state.grounded, true);
});
