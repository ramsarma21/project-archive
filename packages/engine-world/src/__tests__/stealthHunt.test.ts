// Does being seen cost anything?
//
// Before the hunt existed the honest answer was no. A watcher shouted, the squad
// escalated, the search timed out nine seconds later, suspicion decayed to zero,
// and the player continued down the line they were caught on having lost
// nothing at all. These tests are the ones that would catch that returning.
//
// The two properties they exist to hold apart are easy to confuse and are the
// whole design: being seen must COST something, and it must never FAIL anything.

import assert from "node:assert/strict";
import { test } from "node:test";

import { STAND_HEIGHT, type CollisionWorld, type Vec3 } from "../collision.js";
import { FIELD_DT, FIELD_TICK_HZ } from "../fieldSimulation.js";
import {
  STEALTH_TUNING,
  createStealthFieldState,
  solveThrow,
  stepStealthField,
  throwFieldDiversion,
  type AlertState,
  type DiversionActor,
  type PlayerStealthRead,
  type StealthFieldState,
  type WatcherPose,
} from "../stealth/index.js";
import { wall, world } from "./parkourHarness.js";

const SENTRY: WatcherPose = {
  id: "sentry",
  position: { x: 0, y: 0, z: 10 },
  // Looking back down -Z, straight at a player standing at the origin.
  baseYaw: Math.PI,
};

/**
 * A screen wall the player can step behind, and the reason these tests need one.
 *
 * Contact cannot be broken by turning the watcher away: an ALERTED or SEARCHING
 * watcher faces its last-known position, so it looks straight back at a player
 * who has not moved however its patrol facing is authored. Breaking sight is a
 * fact about geometry, which is the correct thing for a test of a search to be
 * built on anyway.
 */
const SCREEN_X = 3;
function screened(): CollisionWorld {
  return world([wall("screen", 5, 8, 0.6, SCREEN_X)]);
}
/** Behind the screen from the sentry, and still well inside the hunt. */
const HIDDEN: Vec3 = { x: 6, y: 0, z: 0 };

const seconds = (s: number) => Math.round(s * FIELD_TICK_HZ);

interface Run {
  state: StealthFieldState;
  ticks: number;
  detected: boolean;
  /** Longest unbroken stretch of squad-wide ALERTED, in ticks. */
  longestAlertedTicks: number;
  states: Set<AlertState>;
  events: string[];
}

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

/**
 * Step the field for a while. `at` places the player per tick and `watchers`
 * may change, so a test can catch the player and then have them run.
 */
function drive(
  collision: CollisionWorld,
  state: StealthFieldState,
  ticks: number,
  options: {
    at: (tick: number) => Vec3;
    watchers?: readonly WatcherPose[];
    startTick?: number;
    stopOnDetect?: boolean;
  },
): Run {
  const start = options.startTick ?? 0;
  let current = state;
  let detected = false;
  let alerted = 0;
  let longestAlertedTicks = 0;
  const states = new Set<AlertState>();
  const events: string[] = [];
  let tick = 0;
  for (; tick < ticks; tick++) {
    const result = stepStealthField(collision, current, {
      dt: FIELD_DT,
      tick: start + tick,
      seed: 11,
      watchers: options.watchers ?? [SENTRY],
      player: player(options.at(tick)),
      clusters: [],
      noise: [],
      reflexDisabled: true,
      suspendAccrual: false,
    });
    current = result.state;
    states.add(result.squadState);
    for (const event of result.events) events.push(event.type);
    alerted = result.squadState === "ALERTED" ? alerted + 1 : 0;
    longestAlertedTicks = Math.max(longestAlertedTicks, alerted);
    if (result.detected) detected = true;
    if (options.stopOnDetect && detected) {
      tick += 1;
      break;
    }
  }
  return { state: current, ticks: tick, detected, longestAlertedTicks, states, events };
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** Stand in front of the sentry until confirmed. Reflex time is off throughout. */
function getCaught(collision: CollisionWorld) {
  const run = drive(collision, createStealthFieldState([SENTRY.id]), 600, {
    at: () => ORIGIN,
    stopOnDetect: true,
  });
  assert.equal(run.detected, true, "the sentry never confirmed a sighting");
  assert.equal(run.state.hunt.active, true, "a sighting must open a hunt");
  return run;
}

// ---- the cost --------------------------------------------------------------

test("a sighting opens a hunt anchored where the player was standing", () => {
  const caught = getCaught(screened());
  const hunt = caught.state.hunt;
  assert.equal(hunt.detections, 1);
  assert.ok(Math.hypot(hunt.origin.x, hunt.origin.z) < 0.01);
  assert.equal(hunt.radiusM, STEALTH_TUNING.huntBaseRadiusM);
  assert.equal(hunt.escapeDistanceM, STEALTH_TUNING.huntEscapeDistanceM);
  assert.ok(caught.events.includes("huntOpened"));
});

test("the search no longer winds down on its own while a hunt is open", () => {
  // This is the defect, stated as a test. The search timeout is nine seconds;
  // before the hunt, waiting it out was the entire cost of being seen.
  const collision = screened();
  const caught = getCaught(collision);
  const waited = seconds(12);
  assert.ok(
    waited > STEALTH_TUNING.searchTicks,
    "the wait has to outlast the timeout for this to prove anything",
  );

  const after = drive(collision, caught.state, waited, {
    // Out of sight behind the screen; only the hunt keeps the squad awake.
    at: () => HIDDEN,
    startTick: caught.ticks,
  });
  assert.equal(after.state.hunt.active, true, "the hunt should still be running");
  assert.equal(
    after.state.watchers[0]!.state,
    "SEARCHING",
    "the sentry went back to sleep on top of an open hunt",
  );
  assert.ok(
    after.state.watchers[0]!.suspicion >= STEALTH_TUNING.huntSuspicionFloor - 1e-9,
    "a hunting watcher must not decay below the hunt floor",
  );
});

test("hiding where you were caught does not end a hunt; leaving does", () => {
  // The rule that makes this a consequence rather than a countdown. Crouching
  // behind the same barrel is precisely the behaviour a search exists to defeat.
  const collision = screened();
  const caught = getCaught(collision);

  const hid = drive(collision, caught.state, seconds(10), {
    at: () => HIDDEN,
    startTick: caught.ticks,
  });
  assert.equal(hid.state.hunt.active, true, "waiting it out must not work");
  assert.ok(
    hid.state.hunt.clearTicks >= STEALTH_TUNING.huntBreakTicks,
    "and it is not because they could still be seen",
  );

  // Same ten seconds, spent running instead: out from behind the screen and
  // away, past the escape distance.
  const escape = STEALTH_TUNING.huntEscapeDistanceM;
  const ran = drive(collision, caught.state, seconds(10), {
    at: (tick) => ({
      x: HIDDEN.x,
      y: 0,
      z: -Math.min(escape + 6, tick * 4.6 * FIELD_DT),
    }),
    startTick: caught.ticks,
  });
  assert.equal(ran.state.hunt.active, false, "getting clear must end it");
  assert.ok(ran.events.includes("huntBroken"));
});

test("a hunt gives up on its own eventually, because nothing here may trap a player", () => {
  const collision = screened();
  const caught = getCaught(collision);
  const stuck = drive(collision, caught.state, seconds(30), {
    at: () => HIDDEN,
    startTick: caught.ticks,
  });
  assert.equal(stuck.state.hunt.active, false, "the safety valve must open");
  assert.ok(
    STEALTH_TUNING.huntBaseTicks > seconds(15),
    "and it must be long enough that running is the normal way out",
  );
});

test("each sighting makes the next hunt wider, longer and further to escape", () => {
  const collision = screened();
  const first = getCaught(collision);

  // A second sighting needs contact to break first — an already-ALERTED watcher
  // has nothing left to confirm — so the player ducks behind the screen and then
  // steps back out, which is also exactly how a second sighting happens in play.
  const recaught = (from: { state: StealthFieldState; ticks: number }) => {
    const hidden = drive(collision, from.state, seconds(2), {
      at: () => HIDDEN,
      startTick: from.ticks,
    });
    const seen = drive(collision, hidden.state, 900, {
      at: () => ORIGIN,
      startTick: from.ticks + hidden.ticks,
      stopOnDetect: true,
    });
    return { state: seen.state, ticks: from.ticks + hidden.ticks + seen.ticks, detected: seen.detected };
  };

  const again = recaught(first);
  assert.equal(again.detected, true);
  const before = first.state.hunt;
  const after = again.state.hunt;
  assert.equal(after.detections, 2);
  assert.ok(after.radiusM > before.radiusM);
  assert.ok(after.escapeDistanceM > before.escapeDistanceM);
  assert.ok(after.ticksRemaining > before.ticksRemaining);

  // And it stops getting worse, so a bad run does not become an unplayable one.
  let run = again;
  for (let round = 0; round < 4; round++) {
    run = recaught(run);
    assert.equal(run.detected, true, `round ${round} never re-detected`);
  }
  assert.equal(run.state.hunt.detections, STEALTH_TUNING.huntEscalationSteps + 1);
  assert.equal(
    run.state.hunt.radiusM,
    STEALTH_TUNING.huntBaseRadiusM +
      STEALTH_TUNING.huntEscalationSteps * STEALTH_TUNING.huntRadiusPerDetectionM,
  );
});

test("a watcher on the far side of the level is not drawn into the search", () => {
  // A hunt is a search of a PLACE. A guard two streets away has not been told
  // anything and has no reason to stop patrolling.
  const collision = screened();
  const distant: WatcherPose = {
    id: "distant",
    position: { x: 0, y: 0, z: -40 },
    baseYaw: Math.PI,
  };
  const caught = drive(
    collision,
    createStealthFieldState([SENTRY.id, distant.id]),
    600,
    { at: () => ORIGIN, watchers: [SENTRY, distant], stopOnDetect: true },
  );
  assert.equal(caught.detected, true);
  const after = drive(collision, caught.state, seconds(14), {
    at: () => HIDDEN,
    watchers: [SENTRY, distant],
    startTick: caught.ticks,
  });
  const far = after.state.watchers.find((entry) => entry.id === "distant")!;
  assert.ok(
    Math.hypot(distant.position.z - after.state.hunt.origin.z) >
      after.state.hunt.radiusM,
    "the distant watcher has to actually be outside the hunt for this to mean anything",
  );
  assert.equal(far.state, "UNAWARE");
  assert.equal(far.suspicion, 0);
});

// ---- and the line it must not cross ----------------------------------------

test("a hunt costs position and time, and cannot fail a run", () => {
  // The fail clock a mission runs is consecutive ticks of squad-wide ALERTED.
  // A hunt holds watchers at the investigating threshold and never above it, so
  // it can make a route miserable and can never end an attempt.
  const collision = screened();
  const caught = getCaught(collision);
  const after = drive(collision, caught.state, seconds(20), {
    at: () => HIDDEN,
    startTick: caught.ticks,
  });
  assert.ok(
    after.longestAlertedTicks < seconds(3),
    `the squad held ALERTED for ${(after.longestAlertedTicks / FIELD_TICK_HZ).toFixed(2)}s; a mission fails on three`,
  );
  // Once contact is genuinely broken the squad settles into a search and stays
  // there. An open hunt must never re-raise it on its own.
  const settled = drive(collision, after.state, seconds(20), {
    at: () => HIDDEN,
    startTick: caught.ticks + after.ticks,
  });
  assert.equal(settled.states.has("ALERTED"), false);
  assert.equal(after.state.hunt.detections, 1, "no extra sightings were invented");
});

test("nothing about a hunt touches the collision world", () => {
  // The consequence the level author stopped short of was closing a route, which
  // means mutating geometry mid-run and invalidating the broad phase. This is the
  // guard that says the hunt did not quietly do it anyway.
  const collision = screened();
  const blockers = collision.blockers;
  const platforms = collision.platforms;
  const before = JSON.stringify(collision);
  const caught = getCaught(collision);
  drive(collision, caught.state, seconds(12), {
    at: () => HIDDEN,
    startTick: caught.ticks,
  });
  assert.equal(collision.blockers, blockers, "the blocker array was replaced");
  assert.equal(collision.platforms, platforms, "the platform array was replaced");
  assert.equal(JSON.stringify(collision), before, "the world was mutated");
});

test("the hunt tells the player what to do about it, in metres", () => {
  const collision = screened();
  const caught = getCaught(collision);
  const away = drive(collision, caught.state, seconds(4), {
    at: () => HIDDEN,
    startTick: caught.ticks,
  });
  const result = stepStealthField(collision, away.state, {
    dt: FIELD_DT,
    tick: caught.ticks + away.ticks,
    seed: 11,
    watchers: [SENTRY],
    player: player(HIDDEN),
    clusters: [],
    noise: [],
    reflexDisabled: true,
    suspendAccrual: false,
  });
  const hunt = result.readout.hunt;
  assert.equal(hunt.active, true);
  assert.equal(hunt.hold, "TOO_CLOSE");
  assert.ok(Math.abs(hunt.distanceM - HIDDEN.x) < 0.01);
  assert.ok(
    Math.abs(hunt.metresToClear - (hunt.escapeDistanceM - HIDDEN.x)) < 0.01,
    "the instruction is a distance, not a notification",
  );
  // The bearing points back at where they were caught: the way not to go.
  assert.ok(Math.abs(hunt.originBearingRad! + Math.PI / 2) < 1e-6);
  assert.ok(hunt.secondsRemaining > 0);
});

test("the hunt replays exactly", () => {
  const first = getCaught(screened());
  const second = getCaught(screened());
  assert.deepEqual(first.state.hunt, second.state.hunt);
  assert.deepEqual(first.events, second.events);
});

// ---- bodies a throw can hit ------------------------------------------------

test("a civilian in the way stops a short throw, and the field says who", () => {
  // Before `bodies` existed the field built its actor list from watchers alone,
  // so no mission could make a civilian solid however much it wanted to: a
  // bottle went through a market crowd as though nobody was there.
  const collision = world();
  const bystander: DiversionActor = {
    id: "goodwife",
    pos: { x: 0, y: 0, z: 3 },
    capsuleHeight: STAND_HEIGHT,
  };
  const aim: Vec3 = { x: 0, y: 0, z: 6 };

  const run = (bodies: readonly DiversionActor[]) => {
    let state = throwFieldDiversion(
      collision,
      createStealthFieldState([SENTRY.id]),
      ORIGIN,
      aim,
    ).state;
    let struck: string | null = null;
    for (let tick = 0; tick < 300; tick++) {
      const result = stepStealthField(collision, state, {
        dt: FIELD_DT,
        tick,
        seed: 5,
        watchers: [SENTRY],
        player: player(ORIGIN),
        clusters: [],
        bodies,
        noise: [],
        reflexDisabled: true,
        suspendAccrual: false,
      });
      state = result.state;
      for (const event of result.events) {
        if (event.type === "throwStruckBody") struck = event.actorId ?? "";
      }
      if (state.diversions.live[0]?.atRest) break;
    }
    return { struck, restsAt: state.diversions.live[0]?.pos ?? null };
  };

  const blocked = run([bystander]);
  assert.equal(blocked.struck, "goodwife", "the body must stop the object");
  assert.ok(
    blocked.restsAt!.z < aim.z,
    `the bottle reached z=${blocked.restsAt!.z.toFixed(2)} through a person at z=3`,
  );

  const clear = run([]);
  assert.equal(clear.struck, null);
  assert.ok(
    clear.restsAt!.z > blocked.restsAt!.z,
    "and with nobody there it should get further",
  );
});

test("a lofted throw clears the heads it passes over", () => {
  // The measured consequence of the tuned 14 m/s launch, kept as a test because
  // it decides what "bodies block throws" actually means. The flat solution to a
  // long throw is still well above head height early in its arc, so a screen of
  // people only blocks a genuinely short one. A good loft sails over the crowd;
  // a panicked toss at the feet of the person in front of you hits them.
  const solution = solveThrow(ORIGIN, {
    x: 0,
    y: 0,
    z: STEALTH_TUNING.throwMaxRangeM,
  });
  assert.ok(solution, "the maximum range must be reachable at the tuned speed");
  const gravity = 10.8;
  const heightAt = (distanceM: number) => {
    const t = distanceM / solution!.vel.z;
    return solution!.from.y + solution!.vel.y * t - 0.5 * gravity * t * t;
  };
  assert.ok(
    heightAt(4) > STAND_HEIGHT + 1,
    `an 18m throw is only ${heightAt(4).toFixed(2)}m up at 4m; it should clear a standing body easily`,
  );
  assert.ok(
    heightAt(15) > STAND_HEIGHT,
    "and it should still be above head height most of the way out",
  );
  assert.ok(heightAt(STEALTH_TUNING.throwMaxRangeM) < STAND_HEIGHT);
});
