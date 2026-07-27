import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_TICK_HZ,
  STEALTH_TUNING,
  clusterContaining,
  wallFromRect,
  type CollisionWorld,
} from "@pa/engine-world";
import {
  createMissionRuntime,
  missionCrowdParity,
  missionPresentation,
  stepMissionRuntime,
  throwMissionDiversion,
  type MissionInputFrame,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import { missionInstanceDefects } from "../src/mission/levelPort.js";
import { smokeMissionDefinition } from "../src/mission/smokeMission.js";
import {
  testCivilian,
  testInstance,
  testWorld,
  tickObjective,
} from "./missionHarness.js";

// Two invariants, and both of them fail silently if they are wrong.
//
//   A thrown diversion can be blocked by a civilian. The field used to build its
//   throw-actor list from watchers alone, which made a civilian transparent to a
//   bottle no matter what a mission passed in — the throw quietly stopped being
//   missable and the verb stopped being a skill, with nothing logged and nothing
//   broken. The container now hands its one list of bodies to the field through
//   `StealthFieldInput.bodies`, and these are the tests that say so.
//
//   The crowd's density is counted from the bodies that are drawn. A field that
//   believes forty-two while twelve are rendered hides the player behind people who
//   are not there: it looks correct and plays wrong.

const IDLE: MissionInputFrame = {
  dtS: 1 / 60,
  moveX: 0,
  moveZ: 0,
  sprintHeld: false,
  crouchHeld: false,
  jumpBuffered: false,
  reducedMotion: false,
  flowEnabled: true,
};

function runFor(runtime: MissionRuntime, seconds: number): void {
  for (let step = 0; step < Math.round(seconds * FIELD_TICK_HZ); step += 1) {
    stepMissionRuntime(runtime, IDLE);
  }
}

/** A corridor with a far wall to aim past, so a clean throw has somewhere to land. */
function throwWorld(): CollisionWorld {
  const base = testWorld();
  return {
    ...base,
    blockers: [wallFromRect("far-wall", 0, 14, 6, 0.4)],
  };
}

function throwRuntime(civilians: ReturnType<typeof testCivilian>[]): MissionRuntime {
  return createMissionRuntime({
    instance: testInstance({
      world: throwWorld(),
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
      civilians,
    }),
    seed: 0x51de,
  });
}

// ---- the throw ------------------------------------------------------------

test("a throw with a clear line reaches the wall it was aimed at", () => {
  const runtime = throwRuntime([]);
  assert.equal(throwMissionDiversion(runtime, { x: 0, y: 0, z: 13 }), true);
  runFor(runtime, 3);

  assert.equal(runtime.throwsStruckBody, 0);
  const object = runtime.stealth.diversions.live[0];
  assert.ok(object, "the object is still tracked after it settles");
  assert.ok(
    object.pos.z > 9,
    `an unobstructed throw should travel down the corridor, stopped at z=${object.pos.z.toFixed(2)}`,
  );
});

test("a throw aimed through a body strikes it rather than sailing to the wall", () => {
  // The level's beat: bodies between the player and the target, so a short throw
  // hits one and the noise happens next to the player instead of far up the
  // street. This is the case that makes aiming a skill rather than a button.
  const screen = [
    testCivilian("civ-1", 0, 4),
    testCivilian("civ-2", -1.1, 4.6),
    testCivilian("civ-3", 1.2, 4.4),
  ];
  const runtime = throwRuntime(screen);
  assert.equal(throwMissionDiversion(runtime, { x: 0, y: 0, z: 6 }), true);
  runFor(runtime, 3);

  assert.equal(
    runtime.throwsStruckBody,
    1,
    "the object was stopped by a person, not by the wall",
  );
  const struck = runtime.recentEvents.filter(
    (event) => event.kind === "THROW_STRUCK_BODY",
  );
  assert.equal(struck.length, 1);
  assert.ok(
    screen.some((civilian) => civilian.id === struck[0]?.detail),
    `the event names which body was hit, got "${struck[0]?.detail}"`,
  );

  const object = runtime.stealth.diversions.live[0];
  assert.ok(object);
  assert.ok(
    object.pos.z < 5,
    `the noise happens where the body is, not at the target; stopped at z=${object.pos.z.toFixed(2)}`,
  );
  assert.ok(
    Math.hypot(object.pos.x, object.pos.z) < STEALTH_TUNING.throwMaxRangeM / 2,
    "and that is close enough to the player to pull attention onto them",
  );
});

test("a lofted long throw clears a near body, which is the skill", () => {
  // The other half of the same mechanic, and it is not a bug. `solveThrow` takes
  // the flatter of the two ballistic angles, but a 13 m aim still puts the object
  // at about 2.0 m over a body four metres out — over its head. Judging that is
  // what a player learns; the previous test is what they get wrong on the way.
  const runtime = throwRuntime([testCivilian("civ-near", 0, 4)]);
  assert.equal(throwMissionDiversion(runtime, { x: 0, y: 0, z: 13 }), true);
  runFor(runtime, 3);

  assert.equal(runtime.throwsStruckBody, 0);
  const object = runtime.stealth.diversions.live[0];
  assert.ok(object);
  assert.ok(
    object.pos.z > 9,
    `the object cleared the body and carried on, stopped at z=${object.pos.z.toFixed(2)}`,
  );
});

test("a throw arcs over a stooped body and is stopped by a standing one", () => {
  // Ten metres into a thirteen-metre throw the object is at about 1.2 m: below a
  // standing capsule's 1.55 m and above a stooped one's 0.98 m. Whether a body
  // blocks is genuinely about where it is and how it stands.
  const crouched = throwRuntime([
    testCivilian("civ-stooped", 0, 10, { capsuleHeight: 0.98 }),
  ]);
  assert.equal(throwMissionDiversion(crouched, { x: 0, y: 0, z: 13 }), true);
  runFor(crouched, 3);

  const standing = throwRuntime([testCivilian("civ-standing", 0, 10)]);
  assert.equal(throwMissionDiversion(standing, { x: 0, y: 0, z: 13 }), true);
  runFor(standing, 3);

  assert.equal(standing.throwsStruckBody, 1, "the standing body blocks it");
  assert.equal(crouched.throwsStruckBody, 0, "the stooped one is passed over");
});

test("a throw is refused once the charges are spent, and never goes negative", () => {
  const runtime = throwRuntime([]);
  const charges = STEALTH_TUNING.diversionChargesPerMission;
  for (let index = 0; index < charges; index += 1) {
    assert.equal(
      throwMissionDiversion(runtime, { x: 0, y: 0, z: 13 }),
      true,
      `throw ${index + 1} of ${charges}`,
    );
  }
  assert.equal(throwMissionDiversion(runtime, { x: 0, y: 0, z: 13 }), false);
  assert.equal(runtime.stealth.diversions.charges, 0);
});

test("the whole diversion inventory lives in the stealth field", () => {
  const runtime = throwRuntime([]);
  const before = missionPresentation(runtime).stealth.diversionCharges;
  assert.equal(before, STEALTH_TUNING.diversionChargesPerMission);

  throwMissionDiversion(runtime, { x: 0, y: 0, z: 13 });
  runFor(runtime, 0.2);
  assert.equal(missionPresentation(runtime).stealth.diversionCharges, before - 1);
  // Charges, the throw counter AND the object in flight, all in one place. It
  // used to be split — the container stepped the objects itself because the
  // field could not collide them against civilians — and a split inventory is
  // two things that have to agree about how many bottles are in the air.
  assert.equal(runtime.stealth.diversions.live.length, 1);
  assert.equal(missionPresentation(runtime).liveDiversions.length, 1);
});

test("a resolved run refuses a throw", () => {
  const runtime = createMissionRuntime({
    instance: testInstance({ objectives: [tickObjective("done", 5)] }),
    seed: 3,
  });
  runFor(runtime, 0.5);
  assert.ok(runtime.outcome);
  assert.equal(throwMissionDiversion(runtime, { x: 0, y: 0, z: 5 }), false);
});

// ---- the crowd ------------------------------------------------------------

test("crowd density is counted from the bodies, never authored", () => {
  const runtime = createMissionRuntime({
    instance: testInstance({
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
      crowdClusters: [{ id: "square", x: 0, z: 10, radiusM: 3 }],
      civilians: [
        testCivilian("a", 0, 10, { clusterId: "square" }),
        testCivilian("b", 1, 10, { clusterId: "square" }),
        testCivilian("c", 0, 11, { clusterId: "square" }),
        testCivilian("d", -1, 9, { clusterId: "square" }),
        // Tagged to the cluster and standing well outside it. It must not count:
        // a body that has walked away is not hiding anybody.
        testCivilian("absent", 0, 40, { clusterId: "square" }),
      ],
    }),
    seed: 7,
  });
  runFor(runtime, 0.2);

  const view = missionPresentation(runtime);
  const cluster = view.crowdClusters.find((entry) => entry.id === "square");
  assert.ok(cluster);
  assert.equal(cluster.density, 4, "four bodies are inside the radius, not five");
  assert.deepEqual(missionCrowdParity(runtime), []);
});

test("the array the field counted is the array the stage instances", () => {
  const civilians = [
    testCivilian("a", 0, 10, { clusterId: "square" }),
    testCivilian("b", 1, 10, { clusterId: "square" }),
  ];
  const runtime = createMissionRuntime({
    instance: testInstance({
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
      crowdClusters: [{ id: "square", x: 0, z: 10, radiusM: 3 }],
      civilians,
    }),
    seed: 11,
  });
  runFor(runtime, 0.2);

  const view = missionPresentation(runtime);
  assert.equal(
    view.civilians,
    civilians,
    "the same array reference reaches the renderer, so a subset cannot be drawn",
  );
  assert.equal(view.civilians.length, 2);
  assert.deepEqual(missionCrowdParity(runtime), []);
});

test("parity is checkable, and a fabricated density is what it catches", () => {
  const runtime = createMissionRuntime({
    instance: testInstance({
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
      crowdClusters: [{ id: "square", x: 0, z: 10, radiusM: 3 }],
      civilians: [testCivilian("a", 0, 10, { clusterId: "square" })],
    }),
    seed: 13,
  });
  runFor(runtime, 0.2);
  assert.deepEqual(missionCrowdParity(runtime), []);

  // The bug, injected by hand: the field is told forty-two and one body exists.
  runtime.crowdClusters = runtime.crowdClusters.map((cluster) => ({
    ...cluster,
    density: 42,
  }));
  const complaints = missionCrowdParity(runtime);
  assert.equal(complaints.length, 1);
  assert.match(complaints[0] ?? "", /42 bodies and has 1/);
});

test("four bodies is the minimum a cluster needs to hide anybody", () => {
  // Not a number this file chose: `crowdBlendMinDensity` is the floor the blend
  // rule reads, and `stepCrowdBlend` does not scale strength above it, so a fifth
  // body changes the look and nothing about the mechanic.
  const cluster = { id: "square", x: 0, z: 0, radiusM: 3, density: 0 };
  for (let bodies = 0; bodies < 8; bodies += 1) {
    const hides = clusterContaining([{ ...cluster, density: bodies }], 0, 0) !== null;
    assert.equal(
      hides,
      bodies >= STEALTH_TUNING.crowdBlendMinDensity,
      `${bodies} bodies`,
    );
  }
  assert.equal(STEALTH_TUNING.crowdBlendMinDensity, 4);
});

test("a level with crowd clusters and no civilians is refused", () => {
  const defects = missionInstanceDefects(
    testInstance({
      objectives: [tickObjective("reach", 10)],
      crowdClusters: [{ id: "square", x: 0, z: 10, radiusM: 3 }],
      civilians: [],
    }),
  );
  assert.equal(defects.length, 1);
  assert.match(defects[0] ?? "", /hide the player behind nobody/);
});

test("a civilian assigned to an undeclared cluster is refused", () => {
  const defects = missionInstanceDefects(
    testInstance({
      objectives: [tickObjective("reach", 10)],
      crowdClusters: [{ id: "square", x: 0, z: 10, radiusM: 3 }],
      civilians: [
        testCivilian("a", 0, 10, { clusterId: "square" }),
        testCivilian("b", 0, 11, { clusterId: "typo-square" }),
      ],
    }),
  );
  assert.match(defects.join("; "), /"typo-square" that is not declared/);
});

test("the smoke fixture demonstrates both halves of the contract", async () => {
  const instance = await smokeMissionDefinition("m1").load({
    missionId: "m1",
    chapterId: "boston-1765",
    attemptOrdinal: 1,
    seed: 0xbeef,
    seedHex: "0".repeat(32),
    attemptId: "attempt-1",
    signal: new AbortController().signal,
  });
  assert.deepEqual(missionInstanceDefects(instance), []);

  const runtime = createMissionRuntime({ instance, seed: 0xbeef });
  runFor(runtime, 0.2);
  const view = missionPresentation(runtime);
  assert.ok(view.civilians.length > 0, "the fixture has a crowd");
  assert.deepEqual(missionCrowdParity(runtime), []);
  const square = view.crowdClusters.find((entry) => entry.id === "dock-square");
  assert.ok(square);
  assert.ok(
    square.density >= STEALTH_TUNING.crowdBlendMinDensity,
    `the throng has to actually hide somebody, counted ${square.density}`,
  );
});
