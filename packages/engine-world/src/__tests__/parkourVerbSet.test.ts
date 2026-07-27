// The verb set, and whether a player can actually reach it.
//
// The flow reader is the half of traversal the world drives. This file covers
// the other half: the two verbs the player names, the momentum that has to
// survive between them, and the steering that makes a one-second arc feel like
// something they are flying rather than watching.
//
// Two of these tests measure PROFILES rather than totals, on purpose. A burst
// that covers the right distance by the wrong curve is a different move, and a
// jump that keeps its range while changing its shape is a different jump; both
// would pass a test that only looked at where the body stopped.

import assert from "node:assert/strict";
import { test } from "node:test";

import { FIELD_DT } from "../fieldSimulation.js";
import {
  DASH_DURATION_MS,
  RUN_SPEED,
  beginDash,
  dashSpeed,
  stepMotion,
  type MotionState,
} from "../playerMotion.js";
import {
  AUTHORABLE_VERBS,
  DASH_ENVELOPE,
  FAILURE_VERBS,
  MOVEMENT_CAPABILITIES,
  PARKOUR_TUNING,
  PLAYER_NAMED_VERBS,
  VERB_CLIP,
  createFlowState,
  flowPresentation,
  stepFlow,
  type FlowEvent,
  type FlowState,
  type TraversalVerb,
} from "../parkour/index.js";
import type { CollisionWorld } from "../collision.js";
import { box, flowInput, runningNorth, world } from "./parkourHarness.js";

interface Sample {
  tick: number;
  pos: { x: number; y: number; z: number };
  speedMps: number;
  phase: string;
  verb: TraversalVerb;
}

interface Drive {
  motion: MotionState;
  flow: FlowState;
  events: FlowEvent[];
  samples: Sample[];
}

/**
 * Drive the flow controller, latching each buffered press for exactly one tick
 * the way the mission runtime does, and record a sample per tick.
 */
function drive(
  collision: CollisionWorld,
  start: MotionState,
  ticks: number,
  options: {
    targetVelX?: number;
    targetVelZ?: number;
    jumpOnTick?: number;
    dashOnTick?: number;
    sprintHeld?: boolean;
  } = {},
): Drive {
  let motion = start;
  let flow = createFlowState();
  const events: FlowEvent[] = [];
  const samples: Sample[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const result = stepFlow(
      collision,
      motion,
      flow,
      flowInput({
        targetVelX: options.targetVelX ?? 0,
        targetVelZ: options.targetVelZ ?? RUN_SPEED,
        sprintHeld: options.sprintHeld ?? true,
        jumpBuffered: tick === options.jumpOnTick,
        dashBuffered: tick === options.dashOnTick,
      }),
    );
    motion = result.motion;
    flow = result.flow;
    events.push(...result.events);
    samples.push({
      tick,
      pos: { ...motion.pos },
      speedMps: Math.hypot(motion.vel.x, motion.vel.z),
      phase: motion.phase,
      verb: flow.verb,
    });
  }
  return { motion, flow, events, samples };
}

const typesOf = (events: FlowEvent[]) => events.map((event) => event.type);

// ---- the named jump --------------------------------------------------------

test("pressing jump on open ground leaves the ground", () => {
  // The whole of the defect this covers: before the named jump existed, a
  // buffered jump only told the edge brake to stand aside. On open ground the
  // most-pressed key in any third-person game did nothing at all.
  const collision = world();
  const pressed = drive(collision, runningNorth(0), 120, { jumpOnTick: 2 });
  const silent = drive(collision, runningNorth(0), 120);

  assert.ok(
    pressed.events.some(
      (event) => event.type === "verbCommitted" && event.verb === "JUMP",
    ),
    "a press on open ground must commit a jump",
  );
  assert.ok(
    pressed.samples.some((sample) => sample.phase === "RUNNING_JUMP"),
    "and the body must actually leave the ground",
  );
  assert.ok(
    silent.samples.every((sample) => sample.phase === "GROUNDED"),
    "while not pressing it changes nothing",
  );
});

test("a jump from a standstill is a standing jump, not a shove forward", () => {
  const collision = world();
  const standing = { ...runningNorth(0), vel: { x: 0, y: 0, z: 0 } };
  const result = drive(collision, standing, 90, {
    targetVelZ: 0,
    jumpOnTick: 1,
  });
  assert.ok(result.samples.some((sample) => sample.phase === "STANDING_JUMP"));
  const drift = Math.max(...result.samples.map((sample) => Math.abs(sample.pos.z)));
  assert.ok(drift < 0.05, `a standing jump drifted ${drift.toFixed(3)}m`);
});

test("geometry still outranks the button: jumping at a crate vaults it", () => {
  // The reader is the point. A player who presses jump at a vaultable crate
  // wanted to get over the crate, and answering with a hop would be the game
  // taking them literally instead of understanding them.
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  const result = drive(collision, runningNorth(1), 120, { jumpOnTick: 10 });
  const committed = result.events
    .filter((event) => event.type === "verbCommitted")
    .map((event) => event.verb);
  assert.ok(committed.includes("VAULT"));
  assert.ok(!committed.includes("JUMP"));
});

test("a jump inside the coyote window still launches", () => {
  // Running off a 1m lip: motion holds `grounded` for 100ms of grace, and the
  // named jump has to be reachable inside it or the most forgiving moment in the
  // whole model is the one moment the button stops working.
  const collision = world([box("ledge", 0, 1, 8, { width: 12 })]);
  let motion = runningNorth(3.2, RUN_SPEED, 1);
  let flow = createFlowState();
  let launched = false;
  let leftSurface = -1;
  for (let tick = 0; tick < 60; tick++) {
    const airborneNext = !motion.grounded;
    const result = stepFlow(
      collision,
      motion,
      flow,
      flowInput({
        // Press only once the feet are past the lip but the grace still holds.
        jumpBuffered: leftSurface >= 0 && tick === leftSurface + 1,
      }),
    );
    motion = result.motion;
    flow = result.flow;
    if (
      leftSurface < 0 &&
      !airborneNext &&
      motion.grounded &&
      motion.airtimeMs > 0
    ) {
      leftSurface = tick;
    }
    if (
      result.events.some(
        (event) => event.type === "verbCommitted" && event.verb === "JUMP",
      )
    ) {
      launched = true;
      break;
    }
  }
  assert.ok(leftSurface >= 0, "the player never entered the coyote window");
  assert.ok(launched, "a jump pressed inside the coyote grace must still fire");
});

// ---- the burst -------------------------------------------------------------

test("pressing dash opens a burst, and the burst has a cooldown", () => {
  const collision = world();
  const result = drive(collision, runningNorth(0), 120, {
    targetVelZ: 0,
    dashOnTick: 1,
  });
  assert.ok(typesOf(result.events).includes("dashStarted"));
  assert.ok(typesOf(result.events).includes("dashEnded"));
  assert.ok(
    result.samples.some((sample) => sample.phase === "DASH"),
    "the shared burst phase is what a dash enters",
  );

  const spent = flowPresentation(result.motion, {
    ...result.flow,
    dashCooldownTicks: PARKOUR_TUNING.dashCooldownTicks,
  });
  assert.equal(spent.dashReady, false);
  assert.equal(spent.dashCharge01, 0);
});

test("a second dash inside the cooldown is refused, and says why", () => {
  const collision = world();
  let motion = runningNorth(0);
  let flow = createFlowState();
  const refusals: string[] = [];
  for (let tick = 0; tick < 40; tick++) {
    const result = stepFlow(
      collision,
      motion,
      flow,
      flowInput({ targetVelZ: 0, dashBuffered: tick === 0 || tick === 30 }),
    );
    motion = result.motion;
    flow = result.flow;
    for (const event of result.events) {
      if (event.type === "dashRefused") refusals.push(event.reason ?? "");
    }
  }
  assert.deepEqual(refusals, ["cooling down"]);
});

test("the traversal dash and the duel dodge are the same move, tick for tick", () => {
  // A PROFILE comparison, not a distance one. Two bursts can cover the same
  // ground on different curves, and if traversal ever accelerated into its burst
  // while the duel set velocity outright, the dodge windows the fight was
  // balanced against would shift without a single headline number moving.
  const collision = world();
  const start = { ...runningNorth(0), vel: { x: 0, y: 0, z: 0 } };

  const traversal = drive(collision, start, 30, {
    targetVelZ: 0,
    dashOnTick: 0,
  });

  // Exactly what packages/duel/src/combat.ts does for a dodge at neutral scale.
  let duelMotion = beginDash(start, 0, 1, dashSpeed(RUN_SPEED), DASH_DURATION_MS);
  const duelSamples: number[] = [];
  for (let tick = 0; tick < 30; tick++) {
    duelMotion = stepMotion(collision, duelMotion, {
      dt: FIELD_DT,
      targetVelX: 0,
      targetVelZ: 0,
      reducedMotion: false,
    }).state;
    duelSamples.push(duelMotion.pos.z);
  }

  const traversalSamples = traversal.samples.map((sample) => sample.pos.z);
  assert.deepEqual(
    traversalSamples,
    duelSamples,
    "the two contexts must share one burst, not two that agree on the total",
  );

  // And the tuned quantity the duel's balance sweep measured is still what a
  // burst covers. Measured at the close of the window rather than at the far end
  // of the coast-out, because the window is what was balanced.
  const reach = duelSamples[DASH_ENVELOPE.durationTicks - 1]!;
  assert.ok(
    Math.abs(reach - 2.22) < 0.01,
    `a burst covered ${reach.toFixed(3)}m; the duel is balanced on 2.22m`,
  );
  assert.ok(Math.abs(reach - DASH_ENVELOPE.reachM) < 1e-9);
});

test("a dash cannot be used to beat the edge brake", () => {
  // A burst substitutes its own target velocity, so the damping that holds a
  // walking player at a lip never runs. Without the brake closing the window,
  // "dash off the roof by accident" would be the fastest way off every roof.
  const collision = world([box("roof", 0, 9, 8, { width: 12 })]);
  let motion = runningNorth(1, RUN_SPEED, 9);
  let flow = createFlowState();
  let braked = false;
  let refusedFor: string | null = null;
  for (let tick = 0; tick < 180; tick++) {
    const result = stepFlow(
      collision,
      motion,
      flow,
      // Press it constantly: the player is leaning on the key at the worst
      // possible moment, which is exactly when this has to hold.
      flowInput({ dashBuffered: true }),
    );
    motion = result.motion;
    flow = result.flow;
    for (const event of result.events) {
      if (event.type === "edgeBraked") braked = true;
      if (event.type === "dashRefused" && event.reason?.includes("land")) {
        refusedFor = event.reason;
      }
    }
  }
  assert.ok(braked, "the brake must still engage");
  assert.ok(
    Math.abs(motion.pos.y - 9) < 0.05,
    `the player left the roof at y=${motion.pos.y.toFixed(2)}`,
  );
  assert.ok(refusedFor, "and a refused dash must tell the player why");
});

// ---- air control -----------------------------------------------------------

test("air control turns a jump without lengthening it", () => {
  // The other PROFILE test, and the one that matters most. Steering that added
  // range would quietly inflate every gap in the game past what level design
  // budgeted against, so the property under test is not "steering feels good"
  // but "the horizontal speed is, tick by tick, exactly what it was".
  //
  // Both runs take off identically and only diverge once airborne. Switching the
  // input before takeoff would change the launch velocity and compare two
  // different jumps.
  const collision = world();
  const fly = (lateral: boolean) => {
    let motion = runningNorth(0);
    let flow = createFlowState();
    const air: Sample[] = [];
    for (let tick = 0; tick < 120; tick++) {
      const airborneNow = air.length > 0;
      const result = stepFlow(
        collision,
        motion,
        flow,
        flowInput({
          jumpBuffered: tick === 1,
          targetVelX: lateral && airborneNow ? RUN_SPEED : 0,
          targetVelZ: lateral && airborneNow ? 0 : RUN_SPEED,
        }),
      );
      motion = result.motion;
      flow = result.flow;
      if (motion.phase === "RUNNING_JUMP" || motion.phase === "FALLING") {
        air.push({
          tick,
          pos: { ...motion.pos },
          speedMps: Math.hypot(motion.vel.x, motion.vel.z),
          phase: motion.phase,
          verb: flow.verb,
        });
      } else if (air.length > 0) break;
    }
    return air;
  };

  const straight = fly(false);
  const steered = fly(true);
  assert.ok(straight.length > 30, "the arc should last most of a second");
  assert.equal(
    straight.length,
    steered.length,
    "steering must not change how long the player is in the air",
  );

  for (let i = 0; i < straight.length; i++) {
    assert.ok(
      Math.abs(straight[i]!.speedMps - steered[i]!.speedMps) < 1e-9,
      `tick ${i}: steering changed the speed from ${straight[i]!.speedMps} to ${steered[i]!.speedMps}`,
    );
  }

  const forward = (samples: Sample[]) =>
    samples[samples.length - 1]!.pos.z - samples[0]!.pos.z;
  assert.ok(
    forward(steered) < forward(straight) - 0.1,
    "turning has to cost forward reach, or it is free range",
  );
  assert.ok(
    steered[steered.length - 1]!.pos.x > 0.2,
    "and it has to move the player somewhere they could not otherwise go",
  );

  // And neither arc exceeds the raw ballistic range the envelope is derived
  // from, which is the number every authored gap is ultimately budgeted against.
  const rawRangeM =
    MOVEMENT_CAPABILITIES.sprintSpeedMps * MOVEMENT_CAPABILITIES.jumpAirtimeS;
  for (const [name, arc] of [
    ["unsteered", straight],
    ["steered", steered],
  ] as const) {
    assert.ok(
      forward(arc) <= rawRangeM + 1e-9,
      `a ${name} jump covered ${forward(arc).toFixed(3)}m of a ${rawRangeM.toFixed(3)}m ballistic range`,
    );
  }
});

// ---- momentum through a landing --------------------------------------------

test("a landing keeps a fraction of the speed it arrived with, by flavour", () => {
  const retention = PARKOUR_TUNING.landingSpeedRetention;
  assert.equal(retention.RUN, 1);
  assert.ok(retention.ROLL > 0 && retention.ROLL < 1);
  assert.equal(retention.HARD, 0);

  // Speed is read on the landing tick itself, before grounded motion has had a
  // chance to re-accelerate, so the number measured belongs to the landing.
  // Above the roll ceiling the reader brakes rather than running the player off,
  // so a hard landing has to be taken deliberately — which is the only way a
  // player can reach one too.
  const measure = (height: number, jump = false) => {
    const collision = world([box("ledge", 0, height, 8, { width: 12 })]);
    let motion = runningNorth(1, RUN_SPEED, height);
    let flow = createFlowState();
    for (let tick = 0; tick < 240; tick++) {
      // A hard landing is only reachable off a fatal ledge deliberately, and the
      // jump must be committed BEFORE the stopping-distance brake slows the body
      // — a player who dawdles to the lip and only then yolo-jumps gets a weak
      // hop, which is the safety working, not a bug. So the press is made while
      // still well back from the edge.
      const result = stepFlow(
        collision,
        motion,
        flow,
        flowInput({ jumpBuffered: jump && tick === 5 }),
      );
      const landed = result.events.find((event) => event.type === "landed");
      motion = result.motion;
      flow = result.flow;
      if (landed) {
        return {
          landing: landed.landing,
          speed: Math.hypot(motion.vel.x, motion.vel.z),
        };
      }
    }
    throw new Error("never landed");
  };

  const shallow = measure(1.5);
  assert.equal(shallow.landing, "RUN");
  assert.ok(
    shallow.speed > RUN_SPEED * 0.95,
    `a 1.5m drop cost ${(RUN_SPEED - shallow.speed).toFixed(2)}m/s and should cost nothing`,
  );

  const rolled = measure(4.5);
  assert.equal(rolled.landing, "ROLL");
  assert.ok(
    rolled.speed < shallow.speed && rolled.speed > RUN_SPEED * 0.7,
    `a roll should cost a sliver, not the run: ${rolled.speed.toFixed(2)}m/s`,
  );

  const slammed = measure(7, true);
  assert.equal(slammed.landing, "HARD");
  assert.ok(
    slammed.speed < 0.01,
    `a hard landing must stop the player: ${slammed.speed.toFixed(2)}m/s`,
  );
});

test("a drop the reader never named still keeps the little speed it had", () => {
  // The bug this exists for: momentum used to be restored only for the two verbs
  // the reader had labelled. Below the flow speed floor the reader labels
  // nothing — it will not commit a RUN_OFF for somebody who is barely moving —
  // so stepping off a low kerb at a walk arrived at a literal dead stop, which is
  // the single least excusable thing a movement system can do.
  const creep = 0.7;
  assert.ok(
    creep < PARKOUR_TUNING.flowMinSpeedMps,
    "the point of the test is that the reader is not looking",
  );
  const collision = world([box("ledge", 0, 1, 8, { width: 12 })]);
  let motion = { ...runningNorth(3.6, creep, 1) };
  let flow = createFlowState();
  let landedWithVerb: TraversalVerb | null = null;
  let speedAfterLanding: number | null = null;
  for (let tick = 0; tick < 240; tick++) {
    const result = stepFlow(
      collision,
      motion,
      flow,
      flowInput({ targetVelZ: creep, sprintHeld: false }),
    );
    const landed = result.events.find((event) => event.type === "landed");
    motion = result.motion;
    flow = result.flow;
    if (landed) {
      landedWithVerb = landed.verb;
      speedAfterLanding = Math.hypot(motion.vel.x, motion.vel.z);
      break;
    }
  }
  assert.equal(landedWithVerb, "NONE", "no verb should have been committed");
  assert.ok(
    speedAfterLanding! > creep * 0.9,
    `landed at ${speedAfterLanding?.toFixed(2)}m/s off a 1m kerb; the walk was confiscated`,
  );
});

// ---- the vocabulary --------------------------------------------------------

test("every verb has a duration, a noise level and a clip", () => {
  for (const verb of Object.keys(PARKOUR_TUNING.verbNoise) as TraversalVerb[]) {
    assert.equal(typeof PARKOUR_TUNING.durationsMs[verb], "number", verb);
    assert.equal(typeof PARKOUR_TUNING.verbNoise[verb], "number", verb);
    assert.equal(typeof VERB_CLIP[verb], "string", verb);
  }
});

test("the vocabulary partitions into what the world asks for and what the player does", () => {
  // Level tooling asserts that a route exercises the whole vocabulary. That is
  // only a meaningful assertion if the vocabulary it checks excludes the verbs a
  // route cannot author, which is what this partition is for.
  const all = new Set(Object.keys(PARKOUR_TUNING.verbNoise) as TraversalVerb[]);
  all.delete("NONE");
  const covered = new Set<TraversalVerb>([
    ...AUTHORABLE_VERBS,
    ...PLAYER_NAMED_VERBS,
    ...FAILURE_VERBS,
  ]);
  assert.deepEqual(
    [...all].filter((verb) => !covered.has(verb)),
    [],
    "a verb in none of the three buckets is a verb nothing knows how to reason about",
  );
  for (const verb of AUTHORABLE_VERBS) {
    assert.ok(!PLAYER_NAMED_VERBS.has(verb));
    assert.ok(!FAILURE_VERBS.has(verb));
  }
});

test("the burst is published beside the authoring envelope, never inside it", () => {
  // A dash-jump reaches further than a level is allowed to author, which is the
  // intended shape of a shortcut and would be a disaster as an allowance. The
  // guard is structural: the envelope object has no burst key in it.
  assert.ok(DASH_ENVELOPE.jumpGapM > MOVEMENT_CAPABILITIES.levelDesignMaxFlatGapM);
  for (const key of Object.keys(MOVEMENT_CAPABILITIES)) {
    assert.ok(
      !key.toLowerCase().includes("dash"),
      `${key} puts the burst inside the contract level design budgets against`,
    );
  }
});

test("a run using every named verb is still byte-identical twice over", () => {
  const build = () =>
    world([box("crate", 3, 0.95, 0.8), box("ledge", 8, 1.5, 1.4)]);
  const once = drive(build(), runningNorth(0), 300, {
    jumpOnTick: 5,
    dashOnTick: 80,
    targetVelX: 0.4,
  });
  const twice = drive(build(), runningNorth(0), 300, {
    jumpOnTick: 5,
    dashOnTick: 80,
    targetVelX: 0.4,
  });
  assert.deepEqual(once.motion, twice.motion);
  assert.deepEqual(once.flow, twice.flow);
  assert.deepEqual(once.events, twice.events);
});
