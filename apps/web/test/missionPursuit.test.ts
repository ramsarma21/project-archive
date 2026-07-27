import { test } from "node:test";
import assert from "node:assert/strict";
import { STAND_HEIGHT, type WatcherPose } from "@pa/engine-world";
import {
  createMissionRuntime,
  stepMissionRuntime,
  type MissionInputFrame,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import { testInstance, tickObjective } from "./missionHarness.js";

// Is the pursuit actually in the mission's tick?
//
// The engine's own suite proves that `stepWatcherPursuit` moves a man. That is
// not the thing that was broken. What was broken is a wiring question, and this
// repo has a long history of losing exactly that: a system authored, unit-tested
// against itself, and then never called from the loop that matters. The shipped
// mission called `watcherPosesAtTick(tick, seed)` and handed the result straight
// to the stealth field, so no amount of escalation could displace anybody, and
// every stealth test in the tree stayed green while the answer to "does anything
// chase me" was no.
//
// So these tests go through `stepMissionRuntime` and nothing else. They fail if
// the pursuit is stepped but its poses are not the ones the field is given, if
// it is stepped in the wrong order, or if somebody quietly puts the authored
// anchors back.

const IDLE: MissionInputFrame = {
  dtS: 1 / 60,
  moveX: 0,
  moveZ: 0,
  sprintHeld: false,
  crouchHeld: false,
  jumpBuffered: false,
  reducedMotion: true,
  flowEnabled: true,
};

/** Posted seven metres up the +Z axis, looking back at the spawn. */
const POST = { x: 0, y: 0, z: 7 };
const WATCHERS: readonly WatcherPose[] = [
  {
    id: "constable",
    position: POST,
    baseYaw: Math.PI,
    capsuleHeight: STAND_HEIGHT,
  },
];

function watched(seen: boolean): MissionRuntime {
  return createMissionRuntime({
    instance: testInstance({
      // Never satisfied, so the run does not resolve out from under the test.
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
      watcherIds: ["constable"],
      watcherPosesAtTick: () => WATCHERS,
      // Standing in front of him, or standing fifty metres away with his back
      // to a cone that cannot reach. Same level, same watcher, same clock.
      spawn: seen
        ? { pos: { x: 0, y: 0, z: 0 }, yaw: 0 }
        : { pos: { x: -50, y: 0, z: -50 }, yaw: 0 },
    }),
    seed: 0xc0115,
  });
}

function runFor(runtime: MissionRuntime, seconds: number): void {
  for (let frame = 0; frame < Math.round(seconds * 60); frame += 1) {
    stepMissionRuntime(runtime, IDLE);
  }
}

function watcherAt(runtime: MissionRuntime): { x: number; z: number } {
  const pose = runtime.watcherPoses.find((entry) => entry.id === "constable")!;
  return { x: pose.position.x, z: pose.position.z };
}

function fromPost(runtime: MissionRuntime): number {
  const at = watcherAt(runtime);
  return Math.hypot(at.x - POST.x, at.z - POST.z);
}

test("the mission tick moves a watcher who has seen you", () => {
  const caught = watched(true);
  runFor(caught, 12);
  assert.ok(caught.detections > 0, "the player should be read at all");
  assert.ok(
    fromPost(caught) > 3,
    `the constable should have walked over; he is ${fromPost(caught).toFixed(2)} m from his post`,
  );
  assert.ok(
    caught.recentEvents.some((event) => event.kind === "WATCH_MOVED"),
    "and the run should say so",
  );
});

test("and does not move one who has not", () => {
  const quiet = watched(false);
  runFor(quiet, 12);
  assert.equal(quiet.detections, 0);
  assert.equal(
    fromPost(quiet),
    0,
    "an undisturbed post is walked exactly as authored, or every existing " +
      "measurement of these cones is wrong",
  );
});

test("the field resolves sight from where the man has walked to, not his post", () => {
  // The wiring assertion. Handing `stepStealthField` the authored anchors while
  // stepping the pursuit beside it would leave the test above passing — the
  // poses would move, the cones would not — so this checks that the array the
  // field was given is the displaced one.
  const caught = watched(true);
  runFor(caught, 12);
  const pose = caught.watcherPoses.find((entry) => entry.id === "constable")!;
  assert.notDeepEqual(
    { x: pose.position.x, z: pose.position.z },
    { x: POST.x, z: POST.z },
  );
  // The facing published by the field is for the pose the field actually used.
  assert.ok(
    caught.watcherFacings.some((facing) => facing.id === "constable"),
    "the field must have resolved this watcher this tick",
  );
});

test("a paused run does not let a constable cross the square behind the menu", () => {
  const caught = watched(true);
  runFor(caught, 6);
  const before = watcherAt(caught);
  for (let frame = 0; frame < 600; frame += 1) {
    stepMissionRuntime(caught, { ...IDLE, flowEnabled: false });
  }
  assert.deepEqual(watcherAt(caught), before);
});

test("the same seed walks the same man onto the same mark", () => {
  const a = watched(true);
  const b = watched(true);
  runFor(a, 20);
  runFor(b, 20);
  assert.deepEqual(watcherAt(a), watcherAt(b));
  assert.equal(a.detections, b.detections);
});
