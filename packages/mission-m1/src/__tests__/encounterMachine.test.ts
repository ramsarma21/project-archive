import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPSULE_RADIUS,
  platformFromRect,
  supportBelow,
  wallFromRect,
  type CollisionWorld,
  type Vec3,
} from "@pa/engine-world/collision";
import { FIELD_TICK_HZ } from "@pa/engine-world/fieldSimulation";
import { encounterById } from "../encounters/bank.js";
import { selectEncounterVariant } from "../encounters/select.js";
import {
  createEncounterInstance,
  stepEncounter,
  type EncounterInstance,
  type EncounterStepInput,
  type EncounterStepResult,
  type EncounterVerdictKind,
} from "../encounters/machine.js";

const DT = 1 / FIELD_TICK_HZ;
const APPROACH_SPEED_MPS = 2.0; // must mirror the machine's constant

/** A flat floor over the whole Shambles region, so actors always have support. */
function flatWorld(): CollisionWorld {
  return {
    blockers: [],
    platforms: [platformFromRect("FLOOR", -10, 100, -12, 40, 0)],
    bounds: { minX: -10, maxX: 100, minZ: -12, maxZ: 40 },
  };
}

const SEED = "0123456789abcdef0123456789abcdef";

function shamblesInstance(): EncounterInstance {
  const enc = encounterById("SHAMBLES_STOP");
  return createEncounterInstance(enc, selectEncounterVariant(enc, SEED, 1));
}

/** The controlled watchers' live sim poses at their authored patrol posts. */
const ACTOR_POSES = [
  { id: "WATCH_SHAMBLES", pos: { x: 17.5, y: 0, z: -1.2 }, yaw: 0 },
  { id: "SENTRY_GAOL", pos: { x: 24.2, y: 0, z: -2.9 }, yaw: 0 },
];

interface DriveOptions {
  readonly grounded?: boolean;
  readonly playerPos?: Vec3;
  readonly submit?: boolean;
  readonly verdict?: EncounterVerdictKind | null;
  readonly dismiss?: boolean;
}

function drive(
  instance: EncounterInstance,
  world: CollisionWorld,
  tick: number,
  opts: DriveOptions = {},
): { result: EncounterStepResult; tick: number } {
  const input: EncounterStepInput = {
    world,
    tick,
    player: {
      pos: opts.playerPos ?? { x: 16.6, y: 0, z: 0.4 },
      grounded: opts.grounded ?? true,
    },
    actorPoses: ACTOR_POSES,
    dt: DT,
    submit: opts.submit ?? false,
    verdict: opts.verdict ?? null,
    dismiss: opts.dismiss ?? false,
  };
  return { result: stepEncounter(instance, input), tick };
}

/** Steps until `predicate` holds or a bounded budget runs out. */
function driveUntil(
  instance: EncounterInstance,
  world: CollisionWorld,
  startTick: number,
  predicate: (r: EncounterStepResult) => boolean,
  opts: DriveOptions = {},
  budget = 2000,
): { result: EncounterStepResult; tick: number } {
  let tick = startTick;
  let last = drive(instance, world, tick, opts);
  while (!predicate(last.result) && tick - startTick < budget) {
    tick += 1;
    last = drive(instance, world, tick, opts);
  }
  return { result: last.result, tick };
}

test("the opening stop does not arm without a grounded drop", () => {
  const world = flatWorld();
  const instance = shamblesInstance();
  // In the trigger radius but airborne: falling past, or hovering above it.
  const airborne = drive(instance, world, 0, {
    grounded: false,
    playerPos: { x: 16.6, y: 4, z: 0.4 },
  });
  assert.equal(airborne.result.phase, "DORMANT");
  assert.equal(airborne.result.locksLocomotion, false);
  // Grounded inside the trigger arms it.
  const grounded = drive(instance, world, 1, { grounded: true });
  assert.equal(grounded.result.phase, "APPROACH");
});

test("approach locks locomotion, walks actors without teleport, and keeps support", () => {
  const world = flatWorld();
  const instance = shamblesInstance();
  drive(instance, world, 0); // arm -> APPROACH

  let previous = new Map(instance.actors.map((a) => [a.id, { ...a.pos }]));
  let tick = 1;
  let opened = false;
  for (; tick < 2000 && !opened; tick++) {
    const { result } = drive(instance, world, tick);
    for (const pose of result.actorPoses) {
      const prev = previous.get(pose.id)!;
      const step = Math.hypot(pose.pos.x - prev.x, pose.pos.z - prev.z);
      assert.ok(
        step <= APPROACH_SPEED_MPS * DT + 1e-6,
        `actor ${pose.id} stepped ${step}m in one tick — a teleport`,
      );
      const support = supportBelow(world, pose.pos.x, pose.pos.z, pose.pos.y + 0.1);
      assert.ok(support, `actor ${pose.id} stepped off supported ground`);
      previous.set(pose.id, { ...pose.pos });
    }
    if (result.phase === "APPROACH") {
      assert.equal(result.locksLocomotion, true);
      assert.equal(result.ownsInput, false); // world still runs during approach
      assert.equal(result.freezeTime, false);
    }
    if (result.phase === "QUESTION") opened = true;
  }
  assert.ok(opened, "the question never opened");

  // No body overlap: the actors and the standoff keep personal space.
  const poses = instance.actors.map((a) => a.pos);
  for (let i = 0; i < poses.length; i++) {
    for (let j = i + 1; j < poses.length; j++) {
      const gap = Math.hypot(poses[i]!.x - poses[j]!.x, poses[i]!.z - poses[j]!.z);
      assert.ok(gap >= 2 * CAPSULE_RADIUS, `actors overlap: gap ${gap}m`);
    }
  }
});

test("the speaker closes to conversational distance from the player, not a fixed standoff", () => {
  const world = flatWorld();
  const instance = shamblesInstance();
  // Arm well OFF the trigger centre — at the west edge of the radius — the way a
  // player running in actually trips it. A fixed world standoff would leave the
  // officer talking from metres away here; a player-relative approach must not.
  const player: Vec3 = { x: 13.2, y: 0, z: 0.4 };
  drive(instance, world, 0, { playerPos: player });
  const opened = driveUntil(
    instance,
    world,
    1,
    (r) => r.phase === "QUESTION",
    { playerPos: player },
  );
  assert.equal(opened.result.phase, "QUESTION");
  const speaker = instance.actors.find((a) => a.kind === "SPEAKER")!;
  const gap = Math.hypot(speaker.pos.x - player.x, speaker.pos.z - player.z);
  assert.ok(
    gap <= 2.5,
    `the speaker opened the question ${gap.toFixed(2)}m from the player — a standoff`,
  );
  assert.ok(gap >= 2 * CAPSULE_RADIUS, `the speaker kept personal space (${gap.toFixed(2)}m)`);
});

test("a watcher stranded far by his kinematic patrol still comes up close, within a bounded time", () => {
  const world = flatWorld();
  const enc = encounterById("SHAMBLES_STOP");
  const instance = createEncounterInstance(enc, selectEncounterVariant(enc, SEED, 1));
  const player: Vec3 = { x: 16.6, y: 0, z: 0.4 };
  // The market-watch is 24m east, where his roaming patrol can leave him — far
  // enough that a fixed 1.5 m/s straight walk could never close it in the budget.
  const farPoses = [
    { id: "WATCH_SHAMBLES", pos: { x: 40.6, y: 0, z: 0.4 }, yaw: 0 },
    { id: "SENTRY_GAOL", pos: { x: 38.0, y: 0, z: -1.0 }, yaw: 0 },
  ];
  const drive = (tick: number) =>
    stepEncounter(instance, {
      world,
      tick,
      player: { pos: player, grounded: true },
      actorPoses: farPoses,
      dt: DT,
      submit: false,
      verdict: null,
      dismiss: false,
    });
  drive(0); // arm -> APPROACH (origin clamped near the player)
  let tick = 1;
  let opened = drive(tick);
  while (opened.phase !== "QUESTION" && tick < 2000) {
    tick += 1;
    opened = drive(tick);
  }
  assert.equal(opened.phase, "QUESTION", "the far watcher's stop still opened");
  const speaker = instance.actors.find((a) => a.kind === "SPEAKER")!;
  const gap = Math.hypot(speaker.pos.x - player.x, speaker.pos.z - player.z);
  assert.ok(gap <= 2.5, `the far watcher came up to ${gap.toFixed(2)}m — not a standoff`);
  // Bounded: the clamp keeps the visible approach short enough to open well
  // inside the hard timeout rather than freezing on it.
  assert.ok(tick < 9 * FIELD_TICK_HZ, `opened at tick ${tick}, before the hard timeout`);
});

test("clutter on the direct line is re-pathed around, and the question never opens at range", () => {
  // The user's screenshot bug: a cart square across the officer's straight line to
  // the player let the old range timeout open the question from 8–12 m away. Here
  // a wall blocks the direct east–west lane; the officer must detour and close,
  // and the question must open ONLY once he is genuinely at conversational range.
  const world: CollisionWorld = {
    blockers: [
      // A cart across the lane between the officer (east) and the player (west).
      wallFromRect("CART", 20, 0, 0.5, 1.0, { topY: 1.2 }),
    ],
    platforms: [platformFromRect("FLOOR", -10, 100, -12, 40, 0)],
    bounds: { minX: -10, maxX: 100, minZ: -12, maxZ: 40 },
  };
  const enc = encounterById("SHAMBLES_STOP");
  const instance = createEncounterInstance(enc, selectEncounterVariant(enc, SEED, 1));
  const player: Vec3 = { x: 16.6, y: 0, z: 0.4 };
  // Both watchers sit east of the cart, so the straight line to the player is
  // blocked for each of them.
  const blockedPoses = [
    { id: "WATCH_SHAMBLES", pos: { x: 24.0, y: 0, z: 0.4 }, yaw: Math.PI },
    { id: "SENTRY_GAOL", pos: { x: 25.0, y: 0, z: 1.2 }, yaw: Math.PI },
  ];
  const step = (tick: number) =>
    stepEncounter(instance, {
      world,
      tick,
      player: { pos: player, grounded: true },
      actorPoses: blockedPoses,
      dt: DT,
      submit: false,
      verdict: null,
      dismiss: false,
    });

  step(0); // arm -> APPROACH
  const speaker = () => instance.actors.find((a) => a.kind === "SPEAKER")!;
  const sep = () => Math.hypot(speaker().pos.x - player.x, speaker().pos.z - player.z);
  const startedFar = sep() > 3;

  let tick = 1;
  let result = step(tick);
  // While the question is not open, the machine must NEVER report it open at range.
  while (result.phase !== "QUESTION" && tick < 60 * 60) {
    assert.equal(result.questionOpen, false);
    tick += 1;
    result = step(tick);
  }
  assert.equal(result.phase, "QUESTION", "the blocked officer never got the stop open");
  assert.ok(startedFar, "the test did not actually start the officer far away");
  const opened = sep();
  assert.ok(
    opened <= 2.2 + 1e-6,
    `the question opened at ${opened.toFixed(2)}m — a range popup, the bug`,
  );
  assert.ok(opened >= 2 * CAPSULE_RADIUS, `the officer kept personal space (${opened.toFixed(2)}m)`);
});

test("question freezes time and owns input; correct answer grants a scoped, bounded reprieve", () => {
  const world = flatWorld();
  const instance = shamblesInstance();
  drive(instance, world, 0);
  const opened = driveUntil(instance, world, 1, (r) => r.phase === "QUESTION");
  assert.equal(opened.result.questionOpen, true);
  assert.equal(opened.result.ownsInput, true);
  assert.equal(opened.result.freezeTime, true);
  assert.equal(opened.result.locksLocomotion, true);

  // Submit, then the verdict lands.
  const submitting = drive(instance, world, opened.tick + 1, { submit: true });
  assert.equal(submitting.result.phase, "SUBMITTING");
  const resolved = drive(instance, world, opened.tick + 2, { verdict: "CORRECT" });
  assert.equal(resolved.result.phase, "RESOLVED");

  const resolution = resolved.result.resolution;
  assert.ok(resolution, "no resolution emitted");
  assert.equal(resolution!.participate, true);
  assert.equal(resolution!.verdictKind, "CORRECT");
  assert.equal(resolution!.pursue, null);
  assert.ok(resolution!.suppress, "correct answer did not suppress");
  assert.deepEqual(
    [...resolution!.suppress!.ids].sort(),
    ["SENTRY_GAOL", "WATCH_SHAMBLES"],
  );
  assert.equal(resolution!.suppress!.durationTicks, Math.round(10 * FIELD_TICK_HZ));

  // Control returns immediately at RESOLVED, and the resolution is emitted once.
  assert.equal(resolved.result.locksLocomotion, false);
  const nextTick = drive(instance, world, opened.tick + 3, {});
  assert.equal(nextTick.result.resolution, null);
});

test("a wrong answer emits scoped pursuit toward the confrontation and never soft-locks", () => {
  const world = flatWorld();
  const instance = shamblesInstance();
  drive(instance, world, 0);
  const opened = driveUntil(instance, world, 1, (r) => r.phase === "QUESTION");
  const confrontation = { ...instance.confrontationPos! };
  drive(instance, world, opened.tick + 1, { submit: true });
  const resolved = drive(instance, world, opened.tick + 2, { verdict: "WRONG" });

  const resolution = resolved.result.resolution!;
  assert.equal(resolution.verdictKind, "WRONG");
  assert.equal(resolution.suppress, null);
  assert.ok(resolution.pursue, "wrong answer did not start a pursuit");
  assert.deepEqual(
    [...resolution.pursue!.ids].sort(),
    ["SENTRY_GAOL", "WATCH_SHAMBLES"],
  );
  assert.deepEqual(resolution.pursue!.toward, confrontation);
  // The player is free to run: locomotion is not locked after a wrong answer.
  assert.equal(resolved.result.locksLocomotion, false);
});

test("resolved releases after its hold, handing the actors back", () => {
  const world = flatWorld();
  const instance = shamblesInstance();
  drive(instance, world, 0);
  const opened = driveUntil(instance, world, 1, (r) => r.phase === "QUESTION");
  drive(instance, world, opened.tick + 1, { submit: true });
  drive(instance, world, opened.tick + 2, { verdict: "GRANTED" });
  const released = driveUntil(
    instance,
    world,
    opened.tick + 3,
    (r) => r.phase === "RELEASED",
  );
  assert.equal(released.result.phase, "RELEASED");
  assert.equal(released.result.actorPoses.length, 0, "machine still owns actors");
  // GRANTED is treated as a reprieve: a service outage must not trap the player.
  // (The suppression was emitted at RESOLVED entry, asserted by the CORRECT test.)
});
