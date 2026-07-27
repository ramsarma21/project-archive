// Does anybody actually come after you?
//
// Before pursuit.ts existed the answer was no, and it was no in a way no test in
// this suite could see. Every stealth test asserted about ALERT STATE — that a
// watcher escalated, shouted, searched and stood down — and every one of them
// passed against a squad of men who could not take a single step, because
// nothing in the field owns a watcher's position and nothing outside it was
// asked to move one. The measurement that would have caught it is the one this
// file opens with: run the same seed twice, catch the player in one and not the
// other, and compare where the watchers ended up.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  STAND_HEIGHT,
  type CollisionWorld,
  type Vec3,
} from "../collision.js";
import { FIELD_DT, FIELD_TICK_HZ } from "../fieldSimulation.js";
import {
  PURSUIT_TUNING,
  STEALTH_TUNING,
  createPursuitState,
  createStealthFieldState,
  createWatcherAlert,
  stepStealthField,
  stepWatcherPursuit,
  type PlayerStealthRead,
  type WatcherAlert,
  type WatcherPose,
  type WatcherPursuit,
} from "../stealth/index.js";
import { wall, world } from "./parkourHarness.js";

const seconds = (s: number) => Math.round(s * FIELD_TICK_HZ);

/** Posted at (0,10) looking back down -Z at a player standing at the origin. */
const SENTRY: WatcherPose = {
  id: "sentry",
  position: { x: 0, y: 0, z: 10 },
  baseYaw: Math.PI,
  capsuleHeight: STAND_HEIGHT,
};

function player(position: Vec3): PlayerStealthRead {
  return {
    position,
    capsuleHeight: STAND_HEIGHT,
    speedMps: 4.6,
    sprinting: true,
    traversing: false,
    exposure: "EXPOSED",
    covered: false,
    lightLevel: 1,
  };
}

interface Run {
  pursuit: WatcherPursuit[];
  /** Where the sentry ended up. */
  at: Vec3;
  /** Furthest he ever got from his post. */
  furthestM: number;
  detected: boolean;
  events: string[];
}

/**
 * Drive the two systems in the order a mission must: legs first, against last
 * tick's alerts, then the field against the poses the legs produced.
 *
 * That order is the wiring under test as much as anything in pursuit.ts. Handing
 * `stepStealthField` the authored anchors instead is exactly the bug, and it
 * would leave every assertion below green if this helper did it.
 */
function drive(
  collision: CollisionWorld,
  ticks: number,
  at: (tick: number) => Vec3,
  anchors: readonly WatcherPose[] = [SENTRY],
): Run {
  let field = createStealthFieldState(anchors.map((pose) => pose.id));
  let pursuit = createPursuitState(anchors.map((pose) => pose.id));
  let detected = false;
  let furthestM = 0;
  const events: string[] = [];
  let poses: readonly WatcherPose[] = anchors;

  for (let tick = 0; tick < ticks; tick++) {
    const stepped = stepWatcherPursuit(collision, pursuit, {
      dt: FIELD_DT,
      anchors,
      alerts: field.watchers,
    });
    pursuit = stepped.states;
    poses = stepped.poses;
    for (const event of stepped.events) events.push(event.type);

    const result = stepStealthField(collision, field, {
      dt: FIELD_DT,
      tick,
      seed: 0x5ea7,
      watchers: poses,
      player: player(at(tick)),
      clusters: [],
      noise: [],
      reflexDisabled: true,
      suspendAccrual: false,
    });
    field = result.state;
    if (result.detected) detected = true;

    const here = pursuit[0]!.position!;
    furthestM = Math.max(
      furthestM,
      Math.hypot(here.x - SENTRY.position.x, here.z - SENTRY.position.z),
    );
  }
  return { pursuit, at: pursuit[0]!.position!, furthestM, detected, events };
}

// ---------------------------------------------------------------------------
// the measurement that was failing silently
// ---------------------------------------------------------------------------

test("being seen moves a watcher; not being seen does not", () => {
  const collision = world();

  // Stand in front of him and stay there.
  const caught = drive(collision, seconds(12), () => ({ x: 0, y: 0, z: 0 }));
  assert.equal(caught.detected, true, "the player should be seen at all");

  // The same twelve seconds with nobody there.
  const empty = drive(collision, seconds(12), () => ({ x: -400, y: 0, z: -400 }));
  assert.equal(empty.detected, false);

  // This is the assertion the whole file exists for. The shipped game measured
  // 0.000000 m here with two men ALERTED, which is what "there is no real stuff
  // of officers chasing you" was a correct report of.
  assert.equal(
    empty.furthestM,
    0,
    "an undisturbed sentry must walk his authored post exactly",
  );
  assert.ok(
    caught.furthestM > 4,
    `a sentry who saw somebody must close on them; got ${caught.furthestM.toFixed(2)} m`,
  );
  assert.ok(caught.events.includes("leftPost"));
});

test("he walks to where you WERE, not to where you are", () => {
  const collision = world();
  // Seen at the origin for two seconds, then gone twenty metres east.
  const run = drive(collision, seconds(10), (tick) =>
    tick < seconds(2.5) ? { x: 0, y: 0, z: 0 } : { x: 20, y: 0, z: 0 },
  );
  assert.equal(run.detected, true);
  // The search is anchored on the sighting. He must end up near the origin,
  // nowhere near the twenty-metre mark, or the pursuit is aimbot rather than AI.
  assert.ok(
    Math.hypot(run.at.x - 0, run.at.z - 0) < 6,
    `expected him to search the origin, found him at (${run.at.x.toFixed(1)}, ${run.at.z.toFixed(1)})`,
  );
  assert.ok(run.at.x < 10, "he must not track a player he cannot see");
});

test("he searches the place, then goes home", () => {
  const collision = world();
  const run = drive(collision, seconds(70), (tick) =>
    tick < seconds(2.5) ? { x: 0, y: 0, z: 0 } : { x: -400, y: 0, z: -400 },
  );
  assert.equal(run.detected, true);
  assert.ok(run.events.includes("arrived"), "he must reach the last-known spot");
  assert.ok(run.events.includes("resumed"), "and eventually get back on post");
  assert.equal(run.pursuit[0]!.phase, "POST");
  assert.equal(
    Math.hypot(run.at.x - SENTRY.position.x, run.at.z - SENTRY.position.z),
    0,
    "back on his mark exactly, so the authored patrol resumes unperturbed",
  );
});

// ---------------------------------------------------------------------------
// the four bounds
// ---------------------------------------------------------------------------

test("the leash holds: he never chases past his area", () => {
  const collision = world();
  // Repeatedly seen, further and further away, so his last-known keeps moving.
  const run = drive(collision, seconds(40), (tick) => ({
    x: 0,
    y: 0,
    z: Math.max(-60, 9 - tick * 0.02),
  }));
  assert.ok(
    run.furthestM <= PURSUIT_TUNING.leashM + 1,
    `leashed to ${PURSUIT_TUNING.leashM} m, got ${run.furthestM.toFixed(2)} m`,
  );
});

test("a watcher will not walk off a height to follow you", () => {
  const collision = world();
  // The Old Brick tower case: posted eight metres up, player on the ground.
  const tower: WatcherPose = {
    ...SENTRY,
    position: { x: 0, y: 8, z: 10 },
  };
  const run = drive(collision, seconds(12), () => ({ x: 0, y: 0, z: 0 }), [
    tower,
  ]);
  assert.equal(
    run.furthestM,
    0,
    "he stays on the tower and shouts, which is what a tower watch is for",
  );
});

test("a curious watcher looks before he walks", () => {
  // Driven straight, with a hand-made CURIOUS alert, because the point under
  // test is one number and a full field run would reach INVESTIGATING within a
  // quarter of a second and skip the hold entirely — which is itself correct.
  // A man who has SEEN you does not stand there thinking about it.
  const collision = world();
  const curious: WatcherAlert = {
    ...createWatcherAlert(SENTRY.id, SENTRY.baseYaw),
    state: "CURIOUS",
    suspicion: STEALTH_TUNING.thresholds.curious,
    attention: { x: 0, y: 0, z: 0 },
    yawInitialised: true,
  };

  let pursuit = createPursuitState([SENTRY.id]);
  let firstMoveTick: number | null = null;
  for (let tick = 0; tick < seconds(5); tick++) {
    const stepped = stepWatcherPursuit(collision, pursuit, {
      dt: FIELD_DT,
      anchors: [SENTRY],
      alerts: [curious],
    });
    pursuit = stepped.states;
    const here = pursuit[0]!.position!;
    if (firstMoveTick === null && Math.hypot(here.x, here.z - 10) > 1e-6) {
      firstMoveTick = tick;
    }
  }

  assert.notEqual(firstMoveTick, null, "he must eventually go and look");
  // `curiousHoldTicks` has described this beat in the tuning table since
  // detection shipped, and until pursuit.ts nothing read it.
  assert.ok(
    firstMoveTick! >= STEALTH_TUNING.curiousHoldTicks - 1,
    `expected ~${STEALTH_TUNING.curiousHoldTicks} ticks of looking first, ` +
      `got ${firstMoveTick}`,
  );
  assert.ok(
    firstMoveTick! <= STEALTH_TUNING.curiousHoldTicks + 2,
    "and then he actually goes",
  );
});

test("a wall stops him, exactly as it stops the player", () => {
  // A solid screen between the post and the sighting. He must not walk through
  // it: the swept capsule is the engine's own, so this is really a check that
  // pursuit went through sweepXZ rather than lerping a position.
  const collision = world([wall("screen", 5, 1.2, 40)]);
  const run = drive(collision, seconds(14), () => ({ x: 0, y: 0, z: 0 }));
  assert.ok(run.at.z > 5, `he crossed the screen and ended at z=${run.at.z}`);
});

// ---------------------------------------------------------------------------
// determinism
// ---------------------------------------------------------------------------

test("two runs of the same inputs put the same man on the same mark", () => {
  const path = (tick: number): Vec3 =>
    tick < seconds(3) ? { x: 0, y: 0, z: 0 } : { x: 12, y: 0, z: -4 };
  const a = drive(world(), seconds(30), path);
  const b = drive(world(), seconds(30), path);
  assert.deepEqual(a.at, b.at);
  assert.deepEqual(a.events, b.events);
  assert.equal(a.furthestM, b.furthestM);
});
