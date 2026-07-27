import { test } from "node:test";
import assert from "node:assert/strict";

import type { Blocker, CollisionWorld, Vec3 } from "../collision.js";
import { RUN_SPEED } from "../playerMotion.js";
import {
  HOLD_VERBS,
  PARKOUR_TUNING,
  distanceToEdge,
  probeAhead,
  rankVerbs,
  reachSummary,
  surveyHolds,
  surveyStats,
  type ParkourTuning,
  type TraversalVerb,
} from "../parkour/index.js";

// The affordance survey exists to answer one question — "can this body get onto
// that" — without owning an opinion about the answer. Every test below is
// therefore a PARITY test rather than a numeric one: nothing here asserts that a
// 1.1m crate is a vault, because the day somebody retunes `vaultMaxHeightM` that
// assertion becomes a lie the test suite defends. What they assert is that the
// survey and the shipped verb ladder never disagree, which stays true through
// any retune and is the only property the cue actually needs.

function blocker(
  id: string,
  at: { x: number; z: number },
  topY: number,
  half = 0.6,
): Blocker {
  return {
    id,
    minX: at.x - half,
    maxX: at.x + half,
    minZ: at.z - half,
    maxZ: at.z + half,
    baseY: 0,
    topY,
    landable: true,
    tags: new Set<string>(),
  };
}

function worldOf(blockers: Blocker[]): CollisionWorld {
  return {
    blockers,
    platforms: [],
    bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 },
  };
}

/** What the shipped ladder offers a sprinting body at `pos` heading `dir`. */
function ladderVerbs(
  world: CollisionWorld,
  pos: Vec3,
  dirX: number,
  dirZ: number,
  tuning: ParkourTuning = PARKOUR_TUNING,
): TraversalVerb[] {
  const probe = probeAhead(
    world,
    {
      pos,
      velX: dirX * RUN_SPEED,
      velZ: dirZ * RUN_SPEED,
      yaw: Math.atan2(dirX, dirZ),
    },
    tuning,
  );
  return rankVerbs(
    probe,
    {
      grounded: true,
      sprintHeld: true,
      jumpBuffered: false,
      crouchHeld: false,
      chaining: false,
      receivingTargets: [],
      reducedMotion: false,
    },
    tuning,
  );
}

test("every hold is a verb the ladder actually offers at that face", () => {
  // One of each height band the ladder distinguishes, spread far enough apart
  // that no probe can see two of them.
  const world = worldOf([
    blocker("KERB", { x: 0, z: 0 }, PARKOUR_TUNING.stepUpMaxHeightM - 0.05),
    blocker("BARREL", { x: 12, z: 0 }, PARKOUR_TUNING.vaultMaxHeightM - 0.1),
    blocker("CRATES", { x: 24, z: 0 }, PARKOUR_TUNING.mantleMaxHeightM - 0.1),
    blocker("WAIN", { x: 36, z: 0 }, PARKOUR_TUNING.climbMaxHeightM - 0.4),
  ]);

  const holds = surveyHolds(world, { x: 18, y: 0, z: 0 }, 60);
  assert.ok(holds.length > 0, "a street of climbable things surveys to holds");

  for (const hold of holds) {
    assert.ok(
      HOLD_VERBS.has(hold.verb),
      `${hold.id} was published with ${hold.verb}, which is not a hold verb`,
    );
    // Stand where the survey said a body would stand and ask the ladder
    // directly. This is the whole contract: the cue promises the geometry will
    // catch you, and the thing that decides that is `rankVerbs`.
    const midX = (hold.a.x + hold.b.x) / 2;
    const midZ = (hold.a.z + hold.b.z) / 2;
    const from: Vec3 = {
      x: midX + hold.outX * 0.9,
      y: hold.a.y - hold.riseM,
      z: midZ + hold.outZ * 0.9,
    };
    const offered = ladderVerbs(world, from, -hold.outX, -hold.outZ);
    assert.ok(
      offered.includes(hold.verb),
      `${hold.id}: the cue promises ${hold.verb} and the ladder offers [${offered.join(",")}]`,
    );
  }
});

test("a wall past the climb ceiling is never published as a hold", () => {
  const world = worldOf([
    blocker("WALL", { x: 0, z: 0 }, PARKOUR_TUNING.climbMaxHeightM + 1.5, 2),
  ]);
  const holds = surveyHolds(world, { x: 0, y: 0, z: -4 }, 20);
  assert.deepEqual(
    holds.map((hold) => hold.id),
    [],
    "the ladder refuses this wall, so the cue must not draw a catch on it",
  );
});

test("the survey moves when the tuning moves, rather than restating it", () => {
  // The anti-drift property, and the reason the survey asks the ladder instead
  // of comparing heights. A thing that is climbable today and is not climbable
  // after a retune must stop being drawn, with nothing in this package edited.
  const height = PARKOUR_TUNING.climbMaxHeightM - 0.4;
  const world = worldOf([blocker("TALL", { x: 0, z: 0 }, height)]);

  const generous = surveyHolds(world, { x: 0, y: 0, z: -4 }, 20);
  assert.ok(
    generous.some((hold) => hold.id === "TALL"),
    "inside the shipped envelope this is a hold",
  );

  // A different world object so the cache does not answer for the old tuning:
  // the cache is keyed on the world, which is correct for a running game and
  // would hide the effect here.
  const tightened: ParkourTuning = {
    ...PARKOUR_TUNING,
    climbMaxHeightM: height - 0.5,
    mantleMaxHeightM: Math.min(PARKOUR_TUNING.mantleMaxHeightM, height - 0.6),
  };
  const same = worldOf([blocker("TALL", { x: 0, z: 0 }, height)]);
  const strict = surveyHolds(same, { x: 0, y: 0, z: -4 }, 20, tightened);
  assert.deepEqual(
    strict.map((hold) => hold.id),
    [],
    "lower the ceiling and the same geometry stops being drawn, with no edit here",
  );
});

test("holds carry the face a body would approach from", () => {
  const world = worldOf([blocker("CRATE", { x: 0, z: 0 }, 1)]);
  const holds = surveyHolds(world, { x: 0, y: 0, z: 0 }, 20);
  assert.ok(holds.length >= 2, "a free-standing crate is climbable from more than one side");
  for (const hold of holds) {
    assert.ok(
      Math.abs(Math.hypot(hold.outX, hold.outZ) - 1) < 1e-6,
      "the outward normal is a unit vector",
    );
    // The edge lies on the top of the thing, which is where the hands go.
    assert.equal(hold.a.y, hold.b.y);
    assert.ok(hold.riseM > 0, "a hold rises above the footing it is reached from");
  }
});

test("the survey is cached against the world rather than recomputed", () => {
  const world = worldOf([
    blocker("A", { x: 0, z: 0 }, 1),
    blocker("B", { x: 6, z: 0 }, 1.6),
  ]);
  const first = surveyHolds(world, { x: 3, y: 0, z: -3 }, 20);
  const cells = surveyStats(world).cells;
  const second = surveyHolds(world, { x: 3, y: 0, z: -3 }, 20);

  assert.equal(surveyStats(world).cells, cells, "asking twice surveys no new cells");
  assert.deepEqual(
    second.map((hold) => `${hold.id}:${hold.verb}`),
    first.map((hold) => `${hold.id}:${hold.verb}`),
    "and gives the identical answer",
  );
});

test("holds come back nearest first, measured to the edge", () => {
  const world = worldOf([
    blocker("NEAR", { x: 0, z: 0 }, 1),
    blocker("FAR", { x: 10, z: 0 }, 1),
  ]);
  const at: Vec3 = { x: -3, y: 0, z: 0 };
  const holds = surveyHolds(world, at, 30);
  assert.ok(holds.length >= 2);
  assert.equal(holds[0]!.id, "NEAR");

  let previous = -1;
  for (const hold of holds) {
    const range = distanceToEdge(at, hold);
    assert.ok(range >= previous - 1e-6, "the list is sorted by range");
    previous = range;
  }
});

test("nothing outside the asked radius comes back", () => {
  const world = worldOf([blocker("OUT", { x: 40, z: 0 }, 1)]);
  assert.deepEqual(surveyHolds(world, { x: 0, y: 0, z: 0 }, 10), []);
});

test("the published reach is the tuning's, not a second copy of it", () => {
  const reach = reachSummary();
  assert.equal(reach.stepUpM, PARKOUR_TUNING.stepUpMaxHeightM);
  assert.equal(reach.vaultM, PARKOUR_TUNING.vaultMaxHeightM);
  assert.equal(reach.mantleM, PARKOUR_TUNING.mantleMaxHeightM);
  assert.equal(reach.climbM, PARKOUR_TUNING.climbMaxHeightM);
});
