// Flow: the chain controller running on the shared fixed clock.
//
// These are the tests that would catch the difference between "the verbs exist"
// and "three continuous minutes feel good": momentum across the seam, chaining
// without input, and determinism.

import assert from "node:assert/strict";
import { test } from "node:test";

import { RUN_SPEED, type MotionState } from "../playerMotion.js";
import {
  FIELD_DT,
  advanceFieldClock,
  createFieldClock,
} from "../fieldSimulation.js";
import {
  MOVEMENT_CAPABILITIES,
  PARKOUR_TUNING,
  createFlowState,
  flowPresentation,
  stepFlow,
  type FlowEvent,
  type FlowState,
  type ReceivingTarget,
} from "../parkour/index.js";
import type { CollisionWorld } from "../collision.js";
import {
  box,
  flowInput,
  overhead,
  runningNorth,
  world,
} from "./parkourHarness.js";

interface RunResult {
  motion: MotionState;
  flow: FlowState;
  events: FlowEvent[];
  noise: number;
  ticks: number;
}

/** Drive stepFlow for `ticks` fixed steps, holding sprint toward +Z. */
function run(
  collision: CollisionWorld,
  motion: MotionState,
  ticks: number,
  options: {
    targets?: readonly ReceivingTarget[];
    jumpBuffered?: boolean;
    crouchHeld?: boolean;
    stopAt?: (event: FlowEvent) => boolean;
  } = {},
): RunResult {
  let state = motion;
  let flow = createFlowState();
  const events: FlowEvent[] = [];
  let noise = 0;
  // A press, not a held key. The mission runtime clears the buffer on the tick
  // that consumes it, and now that a buffered jump actually launches one, a
  // harness holding it down would be a player mashing space sixty times a
  // second — an input nobody can produce and nothing should be tuned against.
  let jumpBuffered = options.jumpBuffered ?? false;
  for (let tick = 0; tick < ticks; tick++) {
    const result = stepFlow(
      collision,
      state,
      flow,
      flowInput({
        receivingTargets: options.targets ?? [],
        jumpBuffered,
        crouchHeld: options.crouchHeld ?? false,
      }),
    );
    jumpBuffered = false;
    state = result.motion;
    flow = result.flow;
    events.push(...result.events);
    noise += result.noise.reduce((sum, entry) => sum + entry.intensity, 0);
    if (options.stopAt && result.events.some(options.stopAt)) {
      return { motion: state, flow, events, noise, ticks: tick + 1 };
    }
  }
  return { motion: state, flow, events, noise, ticks };
}

function committed(events: FlowEvent[]): string[] {
  return events
    .filter((event) => event.type === "verbCommitted" || event.type === "leapCommitted")
    .map((event) => event.verb);
}

function completed(events: FlowEvent[]): string[] {
  return events
    .filter((event) => event.type === "verbCompleted")
    .map((event) => event.verb);
}

test("holding sprint into a crate vaults it with no verb input", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  const result = run(collision, runningNorth(1), 90);
  assert.deepEqual(committed(result.events), ["VAULT"]);
  assert.deepEqual(completed(result.events), ["VAULT"]);
  // The player ended up past the crate.
  assert.ok(result.motion.pos.z > 3.4, `ended at z=${result.motion.pos.z}`);
});

test("a completed verb restores speed instead of dumping the player to a stop", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  const result = run(collision, runningNorth(1), 90, {
    stopAt: (event) => event.type === "verbCompleted",
  });
  const speed = Math.hypot(result.motion.vel.x, result.motion.vel.z);
  assert.ok(
    speed > RUN_SPEED * 0.75,
    `exit speed was ${speed.toFixed(2)}; a verb must not be a full stop`,
  );
});

test("three obstacles in a row chain without the player naming a verb", () => {
  const collision = world([
    box("crate", 3, 0.95, 0.8),
    box("ledge", 6.5, 1.5, 1.4),
    overhead("awning", 11, 1.15, 1.6, 1),
  ]);
  const result = run(collision, runningNorth(1), 60 * 8);
  const completions = result.events.filter(
    (event) => event.type === "verbCompleted",
  );
  assert.deepEqual(
    completions.map((event) => event.verb),
    ["VAULT", "MANTLE", "SLIDE"],
    `got ${completed(result.events).join(",")}`,
  );
  // The chain must survive street-realistic 3.5m spacing. Drops between
  // obstacles count too, so the counts rise without ever resetting.
  const chains = completions.map((event) => event.chain);
  assert.deepEqual(
    chains,
    [...chains].sort((a, b) => a - b),
    `the chain went backwards: ${chains.join(",")}`,
  );
  assert.equal(chains[0], 1);
  assert.ok(
    chains[chains.length - 1]! >= 3,
    `the chain broke between obstacles: ${chains.join(",")}`,
  );
});

test("the chain window expires on open ground, so flow is not free", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  const ticks = PARKOUR_TUNING.chainWindowTicks + 90;
  const result = run(collision, runningNorth(1), ticks);
  assert.equal(result.flow.chain, 0, "the chain should have gone cold");
  assert.equal(result.flow.inFlow, false);
});

test("a mantle onto a ledge exits facing forward, not back off the ledge", () => {
  const collision = world([box("ledge", 3, 1.5, 2)]);
  const result = run(collision, runningNorth(1), 120, {
    stopAt: (event) => event.type === "verbCompleted",
  });
  assert.ok(result.motion.pos.y > 1.4, `expected to be on top, y=${result.motion.pos.y}`);
  // Facing +Z means yaw near 0; facing back down would be near PI.
  assert.ok(
    Math.abs(result.motion.yaw) < 0.4,
    `exit yaw ${result.motion.yaw} points the wrong way`,
  );
  assert.ok(result.motion.vel.z > 0, "exit velocity must carry the player forward");
});

test("a slide ends standing when there is room to stand", () => {
  const collision = world([overhead("awning", 3, 1.15, 1.6, 1)]);
  const result = run(collision, runningNorth(1), 180);
  assert.ok(completed(result.events).includes("SLIDE"));
  assert.ok(result.motion.pos.z > 3.5, `ended at z=${result.motion.pos.z}`);
  assert.equal(result.motion.capsuleHeight, MOVEMENT_CAPABILITIES.standHeightM);
});

test("a published-budget gap is jumped and landed while sprinting through", () => {
  const gap = MOVEMENT_CAPABILITIES.levelDesignMaxFlatGapM;
  const collision = world([
    box("near", 0, 3, 8, { width: 12 }),
    box("far", 4 + gap + 4, 3, 8, { width: 12 }),
  ]);
  const result = run(collision, runningNorth(1, RUN_SPEED, 3), 60 * 4, {
    stopAt: (event) => event.type === "landed",
  });
  assert.ok(committed(result.events).includes("JUMP_GAP"), "the gap should auto-jump");
  const landing = result.events.find((event) => event.type === "landed");
  assert.ok(landing, "the jump must land");
  assert.equal(landing!.landing, "RUN", "a same-height gap is a running landing");
  assert.ok(
    result.motion.pos.z > 4 + gap,
    `landed short at z=${result.motion.pos.z}`,
  );
  assert.ok(Math.abs(result.motion.pos.y - 3) < 0.05, "landed on the far roof");
});

test("a jump landing keeps the chain alive", () => {
  const gap = 2.5;
  const collision = world([
    box("near", 0, 3, 8, { width: 12 }),
    box("far", 4 + gap + 4, 3, 8, { width: 12 }),
  ]);
  const result = run(collision, runningNorth(1, RUN_SPEED, 3), 60 * 4);
  const landing = result.events.find((event) => event.type === "landed");
  assert.ok(landing);
  assert.ok(landing!.chain >= 1, "a clean gap landing counts toward the chain");
});

test("a killing drop brakes the player instead of running them off", () => {
  const collision = world([box("roof", 0, 9, 8, { width: 12 })]);
  const result = run(collision, runningNorth(1, RUN_SPEED, 9), 60 * 3);
  assert.ok(
    result.events.some((event) => event.type === "edgeBraked"),
    "expected the edge brake to engage",
  );
  assert.ok(Math.abs(result.motion.pos.y - 9) < 0.05, "still on the roof");
  assert.ok(result.motion.pos.z < 4, `walked off to z=${result.motion.pos.z}`);
});

// ---- landings and noise ----------------------------------------------------

test("landing flavor follows the drop, and louder drops make more noise", () => {
  const shallow = world([box("ledge", 0, 1.5, 8, { width: 12 })]);
  const deep = world([box("ledge", 0, 4.5, 8, { width: 12 })]);
  const shallowRun = run(shallow, runningNorth(1, RUN_SPEED, 1.5), 180);
  const deepRun = run(deep, runningNorth(1, RUN_SPEED, 4.5), 180);
  const shallowLanding = shallowRun.events.find((event) => event.type === "landed");
  const deepLanding = deepRun.events.find((event) => event.type === "landed");
  assert.equal(shallowLanding?.landing, "RUN");
  assert.equal(deepLanding?.landing, "ROLL");
  assert.ok(
    deepRun.noise > shallowRun.noise,
    "a roll landing must be louder than a running landing",
  );
});

test("a fall costs noise and seconds, never the run", () => {
  const collision = world([box("roof", 0, 7, 8, { width: 12 })]);
  // A deliberate jump off a 7m roof: above the roll ceiling, so it is a hard
  // landing. The player must still be alive, grounded and able to move.
  const result = run(collision, runningNorth(1, RUN_SPEED, 7), 60 * 4, {
    jumpBuffered: true,
  });
  const landing = result.events.find((event) => event.type === "landed");
  assert.ok(landing, "the fall must resolve into a landing");
  assert.equal(landing!.landing, "HARD");
  assert.equal(result.motion.grounded, true);
  assert.ok(Math.abs(result.motion.pos.y) < 0.05, "landed on the ground");
  assert.ok(result.noise > 0.9, "a hard landing is loud");
});

// ---- leap of faith --------------------------------------------------------

test("a dive into a receiving target is offered, committed and received", () => {
  const collision = world([box("tower", 0, 12, 8, { width: 12 })]);
  const cart: ReceivingTarget = { id: "hay-cart", x: 0, y: 0, z: 8, kind: "hayCart" };
  const result = run(collision, runningNorth(1, RUN_SPEED, 12), 60 * 6, {
    targets: [cart],
    stopAt: (event) => event.type === "leapReceived",
  });
  assert.ok(
    committed(result.events).includes("LEAP_OF_FAITH"),
    `expected a dive; got ${committed(result.events).join(",") || "nothing"}`,
  );
  assert.ok(
    result.events.some((event) => event.type === "leapReceived"),
    "the dive must be received by the target",
  );
  assert.equal(result.flow.landing, "RECEIVED");
  assert.ok(Math.abs(result.motion.pos.z - cart.z) < 0.1, "came to rest in the cart");
});

test("no receiving target means no dive: the player is braked at the lip", () => {
  const collision = world([box("tower", 0, 12, 8, { width: 12 })]);
  const result = run(collision, runningNorth(1, RUN_SPEED, 12), 60 * 3);
  assert.ok(!committed(result.events).includes("LEAP_OF_FAITH"));
  assert.ok(result.events.some((event) => event.type === "edgeBraked"));
});

test("a target under the dive floor is not a dive", () => {
  const collision = world([box("ledge", 0, 4, 8, { width: 12 })]);
  const cart: ReceivingTarget = { id: "cart", x: 0, y: 0, z: 6 };
  const result = run(collision, runningNorth(1, RUN_SPEED, 4), 120, {
    targets: [cart],
  });
  assert.ok(
    !committed(result.events).includes("LEAP_OF_FAITH"),
    "a 4m drop is a roll, not a leap of faith",
  );
});

// ---- determinism ----------------------------------------------------------

test("the same course produces byte-identical runs", () => {
  const build = () =>
    world([
      box("crate", 3, 0.95, 0.8),
      box("ledge", 6.5, 1.5, 1.4),
      overhead("awning", 11, 1.15, 1.6, 1),
    ]);
  const first = run(build(), runningNorth(1), 60 * 8);
  const second = run(build(), runningNorth(1), 60 * 8);
  assert.deepEqual(first.motion, second.motion);
  assert.deepEqual(first.flow, second.flow);
  assert.deepEqual(first.events, second.events);
});

test("flow runs on the shared clock: 30, 60 and 120 fps agree exactly", () => {
  const build = () =>
    world([box("crate", 3, 0.95, 0.8), box("ledge", 6.5, 1.5, 1.4)]);

  // The same four seconds of wall time, delivered as 30, 60 and 120 frames per
  // second. The accumulator must visit the same ticks and the sim must agree.
  const simulate = (fps: number) => {
    const collision = build();
    let clock = createFieldClock(1234);
    let motion = runningNorth(1);
    let flow = createFlowState();
    for (let frame = 0; frame < fps * 4; frame++) {
      const advance = advanceFieldClock(clock, 1 / fps);
      clock = advance.clock;
      for (let step = 0; step < advance.steps; step++) {
        const result = stepFlow(collision, motion, flow, flowInput());
        motion = result.motion;
        flow = result.flow;
      }
    }
    return { motion, flow, tick: clock.tick };
  };

  const at30 = simulate(30);
  const at60 = simulate(60);
  const at120 = simulate(120);
  assert.equal(at30.tick, at60.tick);
  assert.equal(at60.tick, at120.tick);
  assert.deepEqual(at30.motion, at60.motion);
  assert.deepEqual(at60.motion, at120.motion);
});

test("the fixed step the controller expects is the shared one", () => {
  assert.equal(FIELD_DT, 1 / 60);
  assert.equal(flowInput().dt, FIELD_DT);
});

// ---- presentation ---------------------------------------------------------

test("presentation reports the clip the animation layer should play", () => {
  const collision = world([box("ledge", 3, 1.5, 1.4)]);
  let motion = runningNorth(1);
  let flow = createFlowState();
  const clips = new Set<string>();
  for (let tick = 0; tick < 120; tick++) {
    const result = stepFlow(collision, motion, flow, flowInput());
    motion = result.motion;
    flow = result.flow;
    clips.add(flowPresentation(motion, flow).clip);
  }
  assert.ok(clips.has("run"), "sprinting should ask for the run clip");
  assert.ok(clips.has("mantle"), "the mantle should ask for the mantle clip");
});

test("reduced motion resolves verbs instantly and refuses to offer a dive", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  let motion = runningNorth(1);
  let flow = createFlowState();
  const events: FlowEvent[] = [];
  for (let tick = 0; tick < 90; tick++) {
    const result = stepFlow(
      collision,
      motion,
      flow,
      flowInput({ reducedMotion: true }),
    );
    motion = result.motion;
    flow = result.flow;
    events.push(...result.events);
  }
  const commitTick = events.findIndex((event) => event.type === "verbCommitted");
  const completeTick = events.findIndex((event) => event.type === "verbCompleted");
  assert.ok(commitTick >= 0 && completeTick >= 0);
  assert.ok(
    completeTick - commitTick <= 1,
    "reduced motion should finish a verb immediately",
  );
});
