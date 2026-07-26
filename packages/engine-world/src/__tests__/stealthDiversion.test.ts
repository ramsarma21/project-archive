// Thrown diversion: a real trajectory, and a cone that actually turns.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CROUCH_HEIGHT, STAND_HEIGHT } from "../collision.js";
import { FIELD_DT } from "../fieldSimulation.js";
import { GRAVITY } from "../playerMotion.js";
import {
  STEALTH_TUNING,
  createDiversion,
  createDiversionInventory,
  createStealthFieldState,
  solveThrow,
  stepDiversion,
  stepDiversions,
  stepStealthField,
  throwDiversion,
  throwFieldDiversion,
  type PlayerStealthRead,
  type WatcherPose,
} from "../stealth/index.js";
import { box, wall, world } from "./parkourHarness.js";

const FEET = { x: 0, y: 0, z: 0 };

test("a throw solves to a launch velocity, and it is a real arc", () => {
  const solution = solveThrow(FEET, { x: 0, y: 0, z: 10 });
  assert.ok(solution, "10m is inside throwing range");
  assert.equal(Math.hypot(solution!.vel.x, solution!.vel.y, solution!.vel.z).toFixed(6), STEALTH_TUNING.throwSpeedMps.toFixed(6));
  assert.ok(solution!.vel.y > 0, "the object leaves the hand rising");
  assert.ok(solution!.vel.z > 0, "and travelling toward the aim point");
});

test("a throw beyond range is refused rather than fudged", () => {
  assert.equal(
    solveThrow(FEET, { x: 0, y: 0, z: STEALTH_TUNING.throwMaxRangeM + 5 }),
    null,
  );
});

test("the declared throw range is physically reachable at the tuned speed", () => {
  // The solver refuses anything the launch speed cannot reach, so a declared
  // range longer than the physics is a range the player is never offered.
  assert.ok(
    solveThrow(FEET, { x: 0, y: 0, z: STEALTH_TUNING.throwMaxRangeM - 0.1 }),
    "the furthest offered throw must actually solve",
  );
  // And it reaches past a watcher's sight range, which is what makes it tactical:
  // you can put a noise behind a guard who cannot see you throw it.
  assert.ok(STEALTH_TUNING.throwMaxRangeM > STEALTH_TUNING.coneRangeM);
});

test("the object lands near where it was aimed", () => {
  const aim = { x: 0, y: 0, z: 9 };
  const solution = solveThrow(FEET, aim)!;
  let object = createDiversion("stone", solution);
  for (let tick = 0; tick < 300 && !object.atRest; tick++) {
    object = stepDiversion(world(), object, FIELD_DT).object;
  }
  assert.ok(object.atRest, "it comes to rest");
  const error = Math.hypot(object.pos.x - aim.x, object.pos.z - aim.z);
  // Bounces carry it a little past the aim point, which is honest behaviour for a
  // thrown stone; it must not be wild.
  assert.ok(error < 2.5, `landed ${error.toFixed(2)}m from the aim point`);
});

test("it uses the shared gravity, not its own", () => {
  const solution = solveThrow(FEET, { x: 0, y: 0, z: 8 })!;
  let object = createDiversion("stone", solution);
  const startY = object.pos.y;
  const startVy = object.vel.y;
  const steps = 10;
  for (let tick = 0; tick < steps; tick++) {
    object = stepDiversion(world(), object, FIELD_DT).object;
  }
  const elapsed = steps * FIELD_DT;
  const expectedY = startY + startVy * elapsed - 0.5 * GRAVITY * elapsed * elapsed;
  assert.ok(
    Math.abs(object.pos.y - expectedY) < 0.02,
    `y was ${object.pos.y.toFixed(3)}, ballistic prediction ${expectedY.toFixed(3)}`,
  );
});

test("a wall in the way stops the throw short: aiming can be got wrong", () => {
  const collision = world([wall("wall", 4, 0.5, 12)]);
  const solution = solveThrow(FEET, { x: 0, y: 0, z: 12 })!;
  let object = createDiversion("stone", solution);
  for (let tick = 0; tick < 400 && !object.atRest; tick++) {
    object = stepDiversion(collision, object, FIELD_DT).object;
  }
  assert.ok(
    object.pos.z < 6,
    `the wall should have stopped it short; it reached z=${object.pos.z.toFixed(2)}`,
  );
});

test("impact and settling both make noise, and the impact is louder", () => {
  const solution = solveThrow(FEET, { x: 0, y: 0, z: 9 })!;
  let object = createDiversion("stone", solution);
  const noises = [];
  for (let tick = 0; tick < 300 && !object.atRest; tick++) {
    const result = stepDiversion(world(), object, FIELD_DT);
    object = result.object;
    noises.push(...result.noise);
  }
  assert.ok(noises.length >= 2, "at least an impact and a settle");
  assert.equal(noises[0]!.kind, "DIVERSION_IMPACT");
  assert.equal(noises[noises.length - 1]!.kind, "DIVERSION_REST");
  assert.ok(noises[0]!.intensity > noises[noises.length - 1]!.intensity);
  assert.ok(noises[0]!.radiusM > 0);
});

test("the inventory is finite and refuses a throw without a charge", () => {
  let inventory = createDiversionInventory();
  assert.equal(inventory.charges, STEALTH_TUNING.diversionChargesPerMission);
  for (let use = 0; use < STEALTH_TUNING.diversionChargesPerMission; use++) {
    const result = throwDiversion(world(), inventory, FEET, { x: 0, y: 0, z: 8 });
    assert.ok(result.object, `throw ${use} should be accepted`);
    inventory = result.inventory;
  }
  const denied = throwDiversion(world(), inventory, FEET, { x: 0, y: 0, z: 8 });
  assert.equal(denied.object, null);
  assert.equal(denied.inventory, inventory, "a refused throw is a no-op");
});

// ---- objects vs bodies -----------------------------------------------------

test("a thrown object can strike a body, not only the world", () => {
  // Actors are absent from the CollisionWorld by design, so before the shared
  // segment-vs-capsule query existed a bottle could only ever hit geometry and
  // would sail straight through a guard.
  const guard = {
    id: "guard",
    pos: { x: 0, y: 0, z: 6 },
    capsuleHeight: STAND_HEIGHT,
  };
  // Aimed past the guard, so the arc is still at chest-to-shoulder height when it
  // reaches them. A flatter throw would pass over their head, and does below.
  const solution = solveThrow(FEET, { x: 0, y: 0, z: 10 })!;
  let object = createDiversion("stone", solution);
  let hitId: string | null = null;
  const noises = [];
  for (let tick = 0; tick < 200 && !object.atRest; tick++) {
    const result = stepDiversion(world(), object, FIELD_DT, STEALTH_TUNING, [
      guard,
    ]);
    object = result.object;
    noises.push(...result.noise);
    if (result.hitActorId) hitId = result.hitActorId;
  }
  assert.equal(hitId, "guard", "the throw should have struck the guard");
  assert.ok(
    Math.abs(object.pos.z - guard.pos.z) < 1,
    `it should stop at the body, not past it (z=${object.pos.z.toFixed(2)})`,
  );
  assert.ok(
    noises.some((entry) => entry.kind === "DIVERSION_IMPACT"),
    "and make its noise where the body is",
  );
});

test("the same throw passes over a crouching body", () => {
  // One body model: the object's pass-over is decided by the same capsule height
  // a patrol's cone resolves and an aimed shot tests against.
  const crouching = {
    id: "guard",
    pos: { x: 0, y: 0, z: 6 },
    capsuleHeight: CROUCH_HEIGHT,
  };
  const standing = { ...crouching, capsuleHeight: STAND_HEIGHT };
  const run = (actor: typeof crouching) => {
    const solution = solveThrow(FEET, { x: 0, y: 0, z: 10 })!;
    let object = createDiversion("stone", solution);
    for (let tick = 0; tick < 200 && !object.atRest; tick++) {
      const result = stepDiversion(world(), object, FIELD_DT, STEALTH_TUNING, [
        actor,
      ]);
      object = result.object;
      if (result.hitActorId) return result.hitActorId;
    }
    return null;
  };
  assert.equal(run(standing), "guard", "a standing guard is in the way");
  assert.equal(run(crouching), null, "a crouched one is under the arc");
});

test("a bottle that hits a guard makes its noise at the guard", () => {
  // Which means a diversion thrown badly pulls attention onto a body right next
  // to the player instead of away from them. The trajectory is real, so aiming
  // matters in both directions.
  const guard: WatcherPose = {
    id: "guard",
    position: { x: 0, y: 0, z: 5 },
    baseYaw: Math.PI,
  };
  let state = createStealthFieldState(["guard"]);
  state = throwFieldDiversion(
    world(),
    state,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 8 },
  ).state;
  let impactAt: { x: number; z: number } | null = null;
  for (let tick = 1; tick <= 120 && !impactAt; tick++) {
    const result = stepStealthField(world(), state, {
      dt: FIELD_DT,
      tick,
      seed: 4,
      watchers: [guard],
      player,
      clusters: [],
      noise: [],
      reflexDisabled: false,
      suspendAccrual: false,
    });
    state = result.state;
    const impact = result.noise.find(
      (entry) => entry.kind === "DIVERSION_IMPACT",
    );
    if (impact) impactAt = { x: impact.x, z: impact.z };
  }
  assert.ok(impactAt, "the throw should have impacted");
  assert.ok(
    Math.abs(impactAt!.z - guard.position.z) < 1,
    `impact at z=${impactAt!.z.toFixed(2)} should be at the guard, z=${guard.position.z}`,
  );
});

test("thrown objects step deterministically", () => {
  const simulate = () => {
    let inventory = createDiversionInventory();
    inventory = throwDiversion(world(), inventory, FEET, { x: 2, y: 0, z: 9 })
      .inventory;
    for (let tick = 0; tick < 200; tick++) {
      inventory = stepDiversions(world(), inventory, FIELD_DT).inventory;
    }
    return inventory.live[0]!.pos;
  };
  assert.deepEqual(simulate(), simulate());
});

// ---- the point of the whole thing ------------------------------------------

const player: PlayerStealthRead = {
  position: { x: 0, y: 0, z: 6 },
  speedMps: 0,
  capsuleHeight: CROUCH_HEIGHT,
  sprinting: false,
  traversing: false,
  exposure: "EXPOSED",
  covered: false,
  lightLevel: 1,
};

test("a thrown object pulls the cone off the player's line", () => {
  // A guard looking straight at the player's approach. A stone thrown well off to
  // one side has to physically turn the cone, and that is what buys the crossing.
  const collision = world([box("crate", 12, 0.4, 1)]);
  const guard: WatcherPose = {
    id: "guard",
    position: { x: 0, y: 0, z: 0 },
    baseYaw: 0,
  };
  let state = createStealthFieldState(["guard"]);
  const thrown = throwFieldDiversion(
    collision,
    state,
    { x: 0, y: 0, z: 6 },
    { x: 12, y: 0, z: 2 },
  );
  assert.equal(thrown.thrown, true);
  state = thrown.state;

  let facingAwayTicks = 0;
  let peakSuspicion = 0;
  for (let tick = 1; tick <= 240; tick++) {
    const result = stepStealthField(collision, state, {
      dt: FIELD_DT,
      tick,
      seed: 3,
      watchers: [guard],
      player,
      clusters: [],
      noise: [],
      reflexDisabled: false,
      suspendAccrual: false,
    });
    state = result.state;
    peakSuspicion = Math.max(peakSuspicion, result.suspicion);
    const visibility = result.visibility[0]!.result.visibility;
    if (visibility === 0) facingAwayTicks += 1;
  }
  assert.ok(
    facingAwayTicks > 60,
    `the cone only left the player for ${facingAwayTicks} ticks`,
  );
  assert.ok(
    peakSuspicion < STEALTH_TUNING.thresholds.investigating,
    `the diversion failed to protect the player (peak ${peakSuspicion.toFixed(2)})`,
  );
  assert.equal(state.watchers[0]!.state !== "ALERTED", true);
});

test("without the throw, the same crossing is detected", () => {
  const collision = world([box("crate", 12, 0.4, 1)]);
  const guard: WatcherPose = {
    id: "guard",
    position: { x: 0, y: 0, z: 0 },
    baseYaw: 0,
  };
  let state = createStealthFieldState(["guard"]);
  let peakSuspicion = 0;
  for (let tick = 1; tick <= 240; tick++) {
    const result = stepStealthField(collision, state, {
      dt: FIELD_DT,
      tick,
      seed: 3,
      watchers: [guard],
      player,
      clusters: [],
      noise: [],
      reflexDisabled: false,
      suspendAccrual: false,
    });
    state = result.state;
    peakSuspicion = Math.max(peakSuspicion, result.suspicion);
  }
  assert.ok(
    peakSuspicion >= STEALTH_TUNING.thresholds.investigating,
    `standing in the open should have been noticed (peak ${peakSuspicion.toFixed(2)})`,
  );
});
