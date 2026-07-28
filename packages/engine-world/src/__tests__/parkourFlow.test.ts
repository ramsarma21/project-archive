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
  wall,
  world,
} from "./parkourHarness.js";
import type { FlowInput } from "../parkour/flow.js";

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
    ["VAULT", "CLIMB_UP", "SLIDE"],
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

// ---- inferred ascent consent ----------------------------------------------
//
// The route-independent reader used to climb any standable face the body ran
// into off a HELD SPRINT alone. On a same-height run past an incidental face
// that is a wrong turn taken without a keypress. The mission runtime derives an
// `inferredAscentAllowed` flag from the committed guidance; when false, a
// CLIMB_UP still previews (the affordance must teach the key) but does not
// commit unless the player buffers a jump. Default true, so nothing else moves.

function driveClimb(
  collision: CollisionWorld,
  options: { inferredAscentAllowed?: boolean; jumpBuffered?: boolean },
): { commits: string[]; preview: string } {
  let motion = runningNorth(1, RUN_SPEED, 0);
  let flow = createFlowState();
  const commits: string[] = [];
  let preview = "NONE";
  for (let tick = 0; tick < 120; tick++) {
    // A player presses Space when the climb affordance is showing — at the face,
    // not blindly on the first tick. Buffered consent must then commit the climb.
    const jumpBuffered =
      (options.jumpBuffered ?? false) && flow.previewVerb === "CLIMB_UP";
    const result = stepFlow(
      collision,
      motion,
      flow,
      flowInput({ jumpBuffered, inferredAscentAllowed: options.inferredAscentAllowed }),
    );
    motion = result.motion;
    flow = result.flow;
    if (flow.previewVerb !== "NONE") preview = flow.previewVerb;
    for (const event of result.events) {
      if (event.type === "verbCommitted") commits.push(event.verb);
    }
  }
  return { commits, preview };
}

test("a 2.2m face previews CLIMB_UP but does not commit when inferred ascent is refused", () => {
  const collision = world([box("face", 3, 2.2, 1.4, { width: 12 })]);
  const refused = driveClimb(collision, { inferredAscentAllowed: false });
  assert.ok(
    !refused.commits.includes("CLIMB_UP"),
    `a held sprint climbed the face without consent: ${refused.commits.join(",") || "nothing"}`,
  );
  assert.equal(
    refused.preview,
    "CLIMB_UP",
    "the affordance must still preview the climb so the key can be taught",
  );
});

test("a buffered jump commits a climb inferred ascent had refused", () => {
  const collision = world([box("face", 3, 2.2, 1.4, { width: 12 })]);
  const consented = driveClimb(collision, {
    inferredAscentAllowed: false,
    jumpBuffered: true,
  });
  assert.ok(
    consented.commits.includes("CLIMB_UP"),
    "a buffered Space must explicitly authorise the climb",
  );
});

test("a mantle-height obstacle previews CLIMB_UP but does not commit when inferred ascent is refused", () => {
  // The consent gate covers the inferred upward climb (the old mantle band folded
  // into CLIMB_UP): a held sprint must not climb onto an incidental obstacle the route runs past
  // any more than it climbs a face. The gaol-barrels VAULT (now shifted so it
  // commits) is what freed this to be gated — the SAFE street line vaults its
  // obstacle, it no longer relies on an inferred mantle onto it.
  const collision = world([box("ledge", 3, 1.5, 1.4, { width: 12 })]);
  const refused = driveClimb(collision, { inferredAscentAllowed: false });
  assert.ok(
    !refused.commits.includes("CLIMB_UP"),
    `a held sprint climbed the obstacle without consent: ${refused.commits.join(",") || "nothing"}`,
  );
  assert.equal(
    refused.preview,
    "CLIMB_UP",
    "the affordance must still preview the climb so the key can be taught",
  );
  const consented = driveClimb(collision, {
    inferredAscentAllowed: false,
    jumpBuffered: true,
  });
  assert.ok(
    consented.commits.includes("CLIMB_UP"),
    "a buffered Space must commit the climb inferred ascent had refused",
  );
});

test("inferred ascent is unchanged by default and when true", () => {
  const collision = world([box("face", 3, 2.2, 1.4, { width: 12 })]);
  assert.ok(
    driveClimb(collision, {}).commits.includes("CLIMB_UP"),
    "an unwired caller (flag unset) climbs off the sprint exactly as before",
  );
  assert.ok(
    driveClimb(collision, { inferredAscentAllowed: true }).commits.includes("CLIMB_UP"),
    "flag true climbs off the sprint exactly as before",
  );
});

// ---- directed action gateway (guided input) --------------------------------
//
// A committed route may hand the reader an authored axis and a verb family. It
// steers the READ onto the action's line and confines the COMMIT to that family
// — but only while the player is pushing along the axis, and never past a plan,
// a preflight, or a consent gate. See flow.ts FlowInput.guided* and wayfind.ts.

/** Drive stepFlow with guided fields, optionally consenting at a climb preview. */
function runGuided(
  collision: CollisionWorld,
  motion: MotionState,
  ticks: number,
  input: Partial<FlowInput>,
  opts: { jumpAtClimbPreview?: boolean } = {},
): RunResult {
  let state = motion;
  let flow = createFlowState();
  const events: FlowEvent[] = [];
  let noise = 0;
  let jumpBuffered = input.jumpBuffered ?? false;
  for (let tick = 0; tick < ticks; tick++) {
    if (opts.jumpAtClimbPreview && flow.previewVerb === "CLIMB_UP") {
      jumpBuffered = true;
    }
    const result = stepFlow(
      collision,
      state,
      flow,
      flowInput({ ...input, jumpBuffered }),
    );
    jumpBuffered = false;
    state = result.motion;
    flow = result.flow;
    events.push(...result.events);
    noise += result.noise.reduce((sum, entry) => sum + entry.intensity, 0);
  }
  return { motion: state, flow, events, noise, ticks };
}

test("a guided VAULT commits along the authored axis under oblique live velocity", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  // Live velocity drifts +X off the line; the player's intent and the gateway
  // axis both point straight up the +Z line at the clear crate.
  const motion: MotionState = {
    ...runningNorth(1),
    vel: { x: RUN_SPEED * 0.5, y: 0, z: RUN_SPEED * 0.6 },
  };
  const result = runGuided(collision, motion, 90, {
    targetVelX: 0,
    targetVelZ: RUN_SPEED,
    guidedAxisX: 0,
    guidedAxisZ: 1,
    guidedVerbs: ["VAULT"],
  });
  assert.ok(committed(result.events).includes("VAULT"), "the guided VAULT did not commit");
  assert.ok(result.motion.pos.z > 3.4, `did not clear the crate: z=${result.motion.pos.z}`);
});

test("a guided VAULT still refuses when a real blocker fills the landing", () => {
  // The vault runs the full preflight: a wall in the landing makes beginAuthored
  // refuse it, guided axis or not. Nothing is forced across a real obstacle.
  const collision = world([box("crate", 3, 0.95, 0.8), wall("backwall", 3.9, 1.4)]);
  const result = runGuided(collision, runningNorth(1), 90, {
    guidedAxisX: 0,
    guidedAxisZ: 1,
    guidedVerbs: ["VAULT"],
  });
  assert.ok(
    !completed(result.events).includes("VAULT"),
    "the vault completed into a blocked landing — preflight was bypassed",
  );
  assert.ok(
    result.motion.pos.z < 3.4,
    `the body cleared a crate whose landing is walled off: z=${result.motion.pos.z}`,
  );
});

test("a guided verb family filters the commit, and disengages when intent leaves the axis", () => {
  // A 1.5m ledge the reader would CLIMB_UP. A VAULT-family gateway aligned with the
  // player's intent confines the commit to VAULT — the CLIMB_UP is filtered, and
  // with nothing vaultable the body does not mount the deck.
  const collision = world([box("ledge", 3, 1.5, 1.4)]);
  const guided = runGuided(collision, runningNorth(1), 90, {
    targetVelX: 0,
    targetVelZ: RUN_SPEED,
    guidedAxisX: 0,
    guidedAxisZ: 1,
    guidedVerbs: ["VAULT"],
  });
  assert.ok(
    !committed(guided.events).includes("CLIMB_UP"),
    "the VAULT-family gateway did not filter the CLIMB_UP",
  );
  // Now the gateway axis points SIDEWAYS (+X) while the player runs +Z at the
  // ledge: intent disagrees with the axis, the guidance disengages, and the
  // honest reader mantles the ledge as it always would. No hijack either way.
  const offAxis = runGuided(collision, runningNorth(1), 90, {
    targetVelX: 0,
    targetVelZ: RUN_SPEED,
    guidedAxisX: 1,
    guidedAxisZ: 0,
    guidedVerbs: ["VAULT"],
  });
  assert.ok(
    committed(offAxis.events).includes("CLIMB_UP"),
    "intent off the gateway axis should leave the ordinary CLIMB_UP untouched",
  );
});

test("a guided drop family steps the body off the lip and filters an overshooting JUMP_GAP", () => {
  // Two roofs across a gap at the published budget: the honest reader auto-commits
  // a JUMP_GAP and launches UP off the lip. This is the ropewalk hatch in
  // miniature — the very read that flings a Shift-held body past a narrow tie
  // beam into the dark instead of stepping down onto it.
  const gap = MOVEMENT_CAPABILITIES.levelDesignMaxFlatGapM;
  const collision = world([
    box("near", 0, 3, 8, { width: 12 }),
    box("far", 4 + gap + 4, 3, 8, { width: 12 }),
  ]);
  // At the takeoff lip, the way the existing gap tests place the body.
  const start = () =>
    runningNorth(4 - MOVEMENT_CAPABILITIES.jumpTakeoffSetbackM, RUN_SPEED, 3);

  // Baseline: no guidance, the reader jumps the gap and gains height off the lip.
  const unguided = run(collision, start(), 60);
  assert.ok(
    committed(unguided.events).includes("JUMP_GAP"),
    `expected an unguided JUMP_GAP; got ${committed(unguided.events).join(",") || "nothing"}`,
  );
  assert.ok(
    Math.max(...jumpArc(collision, start())) > 3.05,
    "the baseline JUMP_GAP did not launch upward off the lip",
  );

  // A directed drop gateway aligned with the run confines the commit to the
  // controlled-descent family: the JUMP_GAP is filtered out and the body leaves
  // the lip by a controlled descent (a run-off / hang drop) with no upward launch.
  const guidedFields: Partial<FlowInput> = {
    targetVelX: 0,
    targetVelZ: RUN_SPEED,
    guidedAxisX: 0,
    guidedAxisZ: 1,
    guidedVerbs: ["RUN_OFF", "HANG_DROP"],
  };
  const guided = runGuided(collision, start(), 60, guidedFields);
  assert.ok(
    !committed(guided.events).includes("JUMP_GAP"),
    "the directed drop gateway did not filter the overshooting JUMP_GAP",
  );
  const descended =
    committed(guided.events).some(
      (verb) => verb === "RUN_OFF" || verb === "HANG_DROP",
    ) ||
    guided.events.some(
      (event) =>
        event.type === "landed" &&
        (event.verb === "RUN_OFF" || event.verb === "HANG_DROP"),
    );
  assert.ok(
    descended,
    `no controlled descent under the drop gateway; committed ${committed(guided.events).join(",") || "nothing"}`,
  );
  assert.ok(
    Math.max(...jumpArc(collision, start(), guidedFields)) <= 3.05,
    "the guided drop gained height off the lip — it launched rather than stepped off",
  );
});

/** The foot-height trace over a short guided/unguided run — an upward launch shows here. */
function jumpArc(
  collision: CollisionWorld,
  motion: MotionState,
  guided?: Partial<FlowInput>,
): number[] {
  let state = motion;
  let flow = createFlowState();
  const heights: number[] = [state.pos.y];
  for (let tick = 0; tick < 60; tick++) {
    const result = stepFlow(
      collision,
      state,
      flow,
      flowInput({ targetVelX: 0, targetVelZ: RUN_SPEED, ...(guided ?? {}) }),
    );
    state = result.motion;
    flow = result.flow;
    heights.push(state.pos.y);
  }
  return heights;
}

test("a guided ascent does not bypass ascent consent or the jump", () => {
  const collision = world([box("ledge", 3, 1.5, 1.4)]);
  // Guided CLIMB family, intent along the axis, but inferred ascent refused and no
  // jump: the guided path still does not commit an unconsented upward CLIMB_UP.
  const refused = runGuided(collision, runningNorth(1), 90, {
    targetVelX: 0,
    targetVelZ: RUN_SPEED,
    guidedAxisX: 0,
    guidedAxisZ: 1,
    guidedVerbs: ["CLIMB_UP"],
    inferredAscentAllowed: false,
  });
  assert.ok(
    !committed(refused.events).some((v) => v === "CLIMB_UP"),
    "the guided path committed an upward ascent the player never consented to",
  );
  // A buffered jump at the face IS consent: the same guided ascent now commits.
  const consented = runGuided(
    collision,
    runningNorth(1),
    90,
    {
      targetVelX: 0,
      targetVelZ: RUN_SPEED,
      guidedAxisX: 0,
      guidedAxisZ: 1,
      guidedVerbs: ["CLIMB_UP"],
      inferredAscentAllowed: false,
    },
    { jumpAtClimbPreview: true },
  );
  assert.ok(
    committed(consented.events).some((v) => v === "CLIMB_UP"),
    "a buffered jump did not consent to the guided ascent",
  );
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
  assert.ok(clips.has("climbUp"), "the folded mantle should ask for the climbUp clip");
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
