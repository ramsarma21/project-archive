// Non-lethal contact, and the four properties that keep it from growing into the
// takedown that was refused.
//
// The refusal's argument was that once a guard can be deleted, the diversion, the
// crowd blend and the reflex window all become slower answers to a solved problem.
// The tests under "SCARCITY" are written so that the first thing to break, if
// somebody starts turning this into that, is one of them.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CROUCH_HEIGHT, STAND_HEIGHT } from "../collision.js";
import { FIELD_DT } from "../fieldSimulation.js";
import {
  CONTACT_NOISE_INTENSITY,
  assertContactCannotAffectTheOtherBody,
  contactRecoveryMs,
  contactWouldStagger,
  resolveContact,
} from "../contact.js";
import {
  CONTACT_PUSH_MPS,
  CONTACT_STAGGER_MS,
  MAX_STAGGER_RECOVERY_SCALE,
  MIN_STAGGER_RECOVERY_SCALE,
  RUN_SPEED,
  beginDash,
  beginRunningJump,
  beginStagger,
  canDash,
  canStagger,
  dashSpeed,
  isStaggered,
  staggerProgress,
  staggerRecoveryScale,
  staggerRemainingMs,
  stepMotion,
  type MotionState,
} from "../playerMotion.js";
import { noiseAudibility } from "../stealth/index.js";
import { box, runningNorth, world } from "./parkourHarness.js";

const GUARD_AHEAD = { x: 0, y: 0, z: 2 };

function grabbed(
  state: MotionState = runningNorth(0, RUN_SPEED),
  recoveryScale?: number,
) {
  return resolveContact(
    state,
    { kind: "GRAB", from: GUARD_AHEAD, sourceId: "guard" },
    recoveryScale,
  );
}

/** Run motion forward until the stagger closes, returning ticks and distance. */
function recoverFrom(state: MotionState): { ticks: number; travelled: number } {
  const collision = world();
  const start = { ...state.pos };
  let motion = state;
  let ticks = 0;
  while (isStaggered(motion) && ticks < 600) {
    motion = stepMotion(collision, motion, {
      dt: FIELD_DT,
      // Input is held hard forward the whole time and is discarded: that IS the
      // recovery. If this ever starts steering, the window has stopped costing
      // anything.
      targetVelX: 0,
      targetVelZ: RUN_SPEED,
      reducedMotion: false,
    }).state;
    ticks += 1;
  }
  return {
    ticks,
    travelled: Math.hypot(motion.pos.x - start.x, motion.pos.z - start.z),
  };
}

// ---------------------------------------------------------------------------
// it is a real window on the real integrator
// ---------------------------------------------------------------------------

test("contact opens a recovery window and pushes away from the body", () => {
  const result = grabbed();
  assert.equal(result.staggered, true);
  assert.equal(isStaggered(result.state), true);
  assert.equal(result.state.phase, "STAGGER");
  assert.equal(result.state.stagger?.kind, "GRAB");
  assert.equal(result.state.stagger?.sourceId, "guard");
  // The guard is at +z, the player at the origin, so the push is toward -z.
  assert.equal(result.state.stagger?.dirZ, -1);
  assert.ok(result.state.vel.z < 0, "an impulse to velocity, away from the contact");
  assert.equal(result.recoveryMs, CONTACT_STAGGER_MS.GRAB);
});

test("the push direction is derived from the geometry, not chosen by the caller", () => {
  // A caller-chosen direction would turn being grabbed into free repositioning,
  // which is a movement ability nobody authored.
  const fromLeft = resolveContact(runningNorth(0, 0), {
    kind: "SHOULDER",
    from: { x: -2, y: 0, z: 0 },
  });
  assert.equal(fromLeft.state.stagger?.dirX, 1);
  assert.equal(fromLeft.state.stagger?.dirZ, 0);
});

test("the displacement is the shared integrator's, not a position write", () => {
  // Same guarantee the burst carries: a staggering player still collides. A wall
  // half a metre behind them stops the push dead.
  const open = beginStagger(runningNorth(0, 0), {
    kind: "SHOULDER",
    dirX: 0,
    dirZ: -1,
  });
  const free = recoverFrom(open);
  const blocked = (() => {
    const collision = world([box("wall", -1, 2, 0.5)]);
    let motion = open;
    const start = { ...motion.pos };
    while (isStaggered(motion)) {
      motion = stepMotion(collision, motion, {
        dt: FIELD_DT,
        targetVelX: 0,
        targetVelZ: 0,
        reducedMotion: false,
      }).state;
    }
    return Math.hypot(motion.pos.x - start.x, motion.pos.z - start.z);
  })();
  assert.ok(free.travelled > 0.2, `an unobstructed shove travelled ${free.travelled.toFixed(2)}m`);
  assert.ok(blocked < free.travelled, "and a wall in the way shortens it");
});

test("shoved off a ledge is a fall, exactly as running off one is", () => {
  const collision = world();
  const ledge: MotionState = {
    ...runningNorth(0, 0, 3),
    pos: { x: 0, y: 3, z: 0 },
  };
  let motion = beginStagger(ledge, { kind: "SHOULDER", dirX: 0, dirZ: -1 });
  assert.equal(isStaggered(motion), true);
  for (let tick = 0; tick < 60 && isStaggered(motion); tick += 1) {
    motion = stepMotion(collision, motion, {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: 0,
      reducedMotion: false,
    }).state;
  }
  assert.equal(motion.stagger, null, "the window closes with the ground");
  assert.equal(motion.phase, "FALLING");
});

test("the window emits its own start and end events", () => {
  const open = beginStagger(runningNorth(0, 0), {
    kind: "CROWD",
    dirX: 1,
    dirZ: 0,
  });
  let motion = open;
  const events: string[] = [];
  for (let tick = 0; tick < 120 && (isStaggered(motion) || events.length === 0); tick += 1) {
    const stepped = stepMotion(world(), motion, {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: 0,
      reducedMotion: false,
    });
    motion = stepped.state;
    events.push(...stepped.events);
  }
  assert.ok(events.includes("staggerEnded"));
});

test("progress and remaining time are readable while the window is open", () => {
  let motion = beginStagger(runningNorth(0, 0), { kind: "GRAB", dirX: 0, dirZ: -1 });
  assert.equal(staggerProgress(motion), 0);
  assert.equal(staggerRemainingMs(motion), CONTACT_STAGGER_MS.GRAB);
  for (let tick = 0; tick < 20; tick += 1) {
    motion = stepMotion(world(), motion, {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: 0,
      reducedMotion: false,
    }).state;
  }
  assert.ok(staggerProgress(motion) > 0 && staggerProgress(motion) < 1);
  assert.ok(staggerRemainingMs(motion) < CONTACT_STAGGER_MS.GRAB);
});

test("a stagger restores the stance it interrupted", () => {
  const crouched: MotionState = {
    ...runningNorth(0, 0),
    phase: "CROUCH",
    capsuleHeight: CROUCH_HEIGHT,
  };
  let motion = beginStagger(crouched, { kind: "CROWD", dirX: 1, dirZ: 0 });
  assert.equal(motion.stagger?.fromPhase, "CROUCH");
  while (isStaggered(motion)) {
    motion = stepMotion(world(), motion, {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: 0,
      reducedMotion: false,
    }).state;
  }
  assert.equal(motion.phase, "CROUCH");
  assert.equal(motion.capsuleHeight, CROUCH_HEIGHT);
});

// ---------------------------------------------------------------------------
// it interacts correctly with the burst
// ---------------------------------------------------------------------------

test("a burst neither prevents contact nor escapes it", () => {
  // Both directions matter. If a dash prevented contact, "dash through the crowd"
  // would switch the whole model off; if you could dash out of a stagger, the
  // window would cost nothing to anybody holding a burst.
  const bursting = beginDash(runningNorth(0, RUN_SPEED), 0, 1, dashSpeed(RUN_SPEED));
  assert.equal(bursting.phase, "DASH");
  assert.equal(canStagger(bursting), true, "contact lands on a bursting player");

  const shoved = beginStagger(bursting, { kind: "SHOULDER", dirX: 0, dirZ: -1 });
  assert.equal(shoved.phase, "STAGGER");
  assert.equal(shoved.dash, null, "the burst is over");
  assert.equal(canDash(shoved), false, "and you cannot open another one out of it");
});

test("contact is not modelled airborne or mid-verb", () => {
  const airborne = beginRunningJump(runningNorth(0, RUN_SPEED));
  assert.equal(canStagger(airborne), false);
  assert.equal(contactWouldStagger(airborne), false);
  const refused = resolveContact(airborne, { kind: "SHOULDER", from: GUARD_AHEAD });
  assert.equal(refused.staggered, false);
  assert.equal(refused.recoveryMs, 0);
  assert.equal(refused.state, airborne, "the state is untouched");
});

test("a second contact during a recovery does not restart it", () => {
  const first = grabbed().state;
  const second = resolveContact(first, { kind: "GRAB", from: GUARD_AHEAD });
  assert.equal(second.staggered, false);
  assert.equal(second.state.stagger?.elapsedMs, first.stagger?.elapsedMs);
});

// ---------------------------------------------------------------------------
// SCARCITY — the four properties that keep this from becoming a takedown
// ---------------------------------------------------------------------------

test("SCARCITY 1: the noise is identical with and without the ability", () => {
  // The single most load-bearing assertion in the file. An ability buys back
  // seconds; it never buys back the detection consequence, so being grabbed is a
  // risk at every Level with every loadout.
  const plain = grabbed(runningNorth(0, RUN_SPEED), MAX_STAGGER_RECOVERY_SCALE);
  const helped = grabbed(runningNorth(0, RUN_SPEED), MIN_STAGGER_RECOVERY_SCALE);
  assert.deepEqual(helped.noise, plain.noise);
  assert.equal(helped.noise.intensity, CONTACT_NOISE_INTENSITY.GRAB);
  assert.equal(helped.noise.kind, "PLAYER_MOVE", "and it implicates the player");
  assert.ok(
    noiseAudibility(helped.noise, 0, 6) > 0,
    "audible from six metres away, ability or no ability",
  );
});

test("SCARCITY 2: the recovery floor is above zero, so contact is never free", () => {
  assert.ok(MIN_STAGGER_RECOVERY_SCALE > 0);
  assert.equal(staggerRecoveryScale(0), MIN_STAGGER_RECOVERY_SCALE);
  assert.equal(staggerRecoveryScale(-1), MIN_STAGGER_RECOVERY_SCALE);
  assert.equal(staggerRecoveryScale(Number.NaN), MAX_STAGGER_RECOVERY_SCALE);
  // A recovery may be shortened, never lengthened: nothing can make contact worse
  // for one player than another either.
  assert.equal(staggerRecoveryScale(5), MAX_STAGGER_RECOVERY_SCALE);

  // Even asking for zero leaves a real window on the real clock.
  const best = grabbed(runningNorth(0, RUN_SPEED), 0);
  assert.equal(best.staggered, true);
  assert.ok(best.recoveryMs >= CONTACT_STAGGER_MS.GRAB * MIN_STAGGER_RECOVERY_SCALE);
  assert.ok(recoverFrom(best.state).ticks >= 10, "and it costs real ticks");
});

test("SCARCITY 3: avoidance strictly dominates recovery, at every scale", () => {
  // The property the takedown would have destroyed, stated as an ordering. Not
  // being touched costs zero ticks and makes zero noise; every recovery costs both.
  const scales = [1, 0.75, 0.5, MIN_STAGGER_RECOVERY_SCALE, 0];
  let previousTicks = Infinity;
  for (const scale of scales) {
    const result = grabbed(runningNorth(0, RUN_SPEED), scale);
    const cost = recoverFrom(result.state);
    assert.ok(cost.ticks > 0, `scale ${scale} cost no time at all`);
    assert.ok(result.noise.intensity > 0, `scale ${scale} made no noise`);
    assert.ok(
      cost.ticks <= previousTicks,
      "a better scale is never worse than a worse one",
    );
    previousTicks = cost.ticks;
  }
  // avoid (0 ticks, 0 noise) > best recovery (>0 ticks, full noise), always.
  assert.ok(previousTicks > 0);
});

test("SCARCITY 3b: the ability shortens the window and changes nothing else", () => {
  const plain = grabbed(runningNorth(0, RUN_SPEED), 1);
  const helped = grabbed(runningNorth(0, RUN_SPEED), 0.25);
  assert.ok(
    helped.recoveryMs < plain.recoveryMs,
    "it has to actually do something, or it is a dead channel",
  );
  assert.equal(helped.recoveryMs, CONTACT_STAGGER_MS.GRAB * 0.25);
  assert.equal(recoverFrom(helped.state).ticks < recoverFrom(plain.state).ticks, true);
  // Same push, same direction, same kind: only the duration moves.
  assert.equal(helped.state.stagger?.speed, plain.state.stagger?.speed);
  assert.equal(helped.state.stagger?.dirZ, plain.state.stagger?.dirZ);
});

test("SCARCITY 4: there is no output channel to the body that made contact", () => {
  assert.doesNotThrow(assertContactCannotAffectTheOtherBody);
  const result = grabbed();
  assert.deepEqual(Object.keys(result).sort(), [
    "noise",
    "recoveryMs",
    "staggered",
    "state",
  ]);
  // `sourceId` is on the window for noise attribution and presentation, and it is
  // an opaque string: there is nothing to mutate through it.
  assert.equal(typeof result.state.stagger?.sourceId, "string");
});

// ---------------------------------------------------------------------------
// tuning shape
// ---------------------------------------------------------------------------

test("a grab costs more than a shoulder, which costs more than a jostle", () => {
  assert.ok(CONTACT_STAGGER_MS.GRAB > CONTACT_STAGGER_MS.SHOULDER);
  assert.ok(CONTACT_STAGGER_MS.SHOULDER > CONTACT_STAGGER_MS.CROWD);
  assert.ok(CONTACT_NOISE_INTENSITY.GRAB > CONTACT_NOISE_INTENSITY.SHOULDER);
  assert.ok(CONTACT_NOISE_INTENSITY.SHOULDER > CONTACT_NOISE_INTENSITY.CROWD);
  // A shoulder check shoves hardest; a grab holds you rather than throwing you.
  assert.ok(CONTACT_PUSH_MPS.SHOULDER > CONTACT_PUSH_MPS.GRAB);
  for (const intensity of Object.values(CONTACT_NOISE_INTENSITY)) {
    assert.ok(intensity > 0 && intensity <= 1);
  }
});

test("no contact ends a run: the whole cost is seconds and noise", () => {
  // Section 18.4's requirement, and the reason this introduces no combat. There is
  // no health, no defeat and no failure state anywhere in the resolution.
  const result = grabbed();
  assert.equal("health" in result, false);
  assert.equal("failed" in result, false);
  assert.equal(result.state.capsuleHeight, STAND_HEIGHT);
  const recovered = recoverFrom(result.state);
  assert.ok(recovered.ticks < 120, "and the player is running again within two seconds");
});

test("the recovery a HUD would show matches the one motion actually opens", () => {
  for (const kind of ["GRAB", "SHOULDER", "CROWD"] as const) {
    for (const scale of [1, 0.5, 0.25]) {
      const opened = resolveContact(
        runningNorth(0, RUN_SPEED),
        { kind, from: GUARD_AHEAD },
        scale,
      );
      assert.equal(opened.recoveryMs, contactRecoveryMs(kind, scale));
    }
  }
});
