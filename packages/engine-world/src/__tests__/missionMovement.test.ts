// Movement and stealth in one loop, the way a mission runs them.
//
// The two systems meet at exactly one place: the noise the movement layer emits
// is the noise the stealth field hears. These tests cover that seam, because it
// is what makes traversal choices carry stealth consequences instead of the two
// halves being independent minigames.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIELD_DT,
  advanceFieldClock,
  createFieldClock,
  projectFieldSeed,
} from "../fieldSimulation.js";
import { RUN_SPEED, type MotionState } from "../playerMotion.js";
import {
  MOVEMENT_CAPABILITIES,
  PARKOUR_CLIP_CONTRACT,
  PARKOUR_CLIP_FALLBACKS,
  PARKOUR_CLIP_REQUESTS,
  createFlowState,
  flowPresentation,
  planEndpointValid,
  probeAhead,
  selectVerb,
  stepFlow,
  type FlowState,
} from "../parkour/index.js";
import {
  createStealthFieldState,
  motionReadFor,
  scaledFrameDt,
  stealthPresentation,
  stepStealthField,
  type StealthFieldState,
  type WatcherPose,
} from "../stealth/index.js";
import { STAND_HEIGHT, type CollisionWorld } from "../collision.js";
import {
  box,
  flowInput,
  runningNorth,
  selectContext,
  wall,
  world,
} from "./parkourHarness.js";

const guard: WatcherPose = {
  id: "guard",
  position: { x: 12, y: 0, z: 6 },
  baseYaw: 0,
};

interface MissionRun {
  motion: MotionState;
  flow: FlowState;
  stealth: StealthFieldState;
  peakSuspicion: number;
  /** Every alert transition observed, so a test can assert on what happened. */
  transitions: { to: string; cause: string }[];
  tick: number;
}

/**
 * One mission loop: a single fixed clock driving movement and then stealth, with
 * the movement layer's noise handed straight to the field.
 */
function runMission(
  collision: CollisionWorld,
  motionIn: MotionState,
  frames: number,
  fps = 60,
  options: { jumpBuffered?: boolean; watcher?: WatcherPose } = {},
): MissionRun {
  const watcher = options.watcher ?? guard;
  let clock = createFieldClock(projectFieldSeed(["m1", "attempt-1"]));
  let motion = motionIn;
  let flow = createFlowState();
  let stealth = createStealthFieldState([watcher.id]);
  let peakSuspicion = 0;
  let timeScale = 1;
  const transitions: { to: string; cause: string }[] = [];
  // A press, not a held key: the mission runtime clears the buffer on the tick
  // that consumes it, so a harness that holds it forever would be testing an
  // input no player can produce.
  let jumpBuffered = options.jumpBuffered ?? false;

  for (let frame = 0; frame < frames; frame++) {
    const advance = advanceFieldClock(clock, scaledFrameDt(1 / fps, timeScale));
    clock = advance.clock;
    for (let step = 0; step < advance.steps; step++) {
      const tick = advance.firstTick + step;
      const movement = stepFlow(collision, motion, flow, flowInput({ jumpBuffered }));
      jumpBuffered = false;
      motion = movement.motion;
      flow = movement.flow;

      const field = stepStealthField(collision, stealth, {
        dt: FIELD_DT,
        tick,
        seed: clock.seed,
        watchers: [watcher],
        player: {
          position: motion.pos,
          // Straight off MotionState: one body model, no translation layer.
          capsuleHeight: motion.capsuleHeight,
          speedMps: Math.hypot(motion.vel.x, motion.vel.z),
          sprinting: true,
          traversing: flow.verb !== "NONE",
          exposure: "EXPOSED",
          covered: false,
          lightLevel: 1,
        },
        clusters: [],
        // The seam: movement noise is stealth input.
        noise: movement.noise,
        reflexDisabled: false,
        suspendAccrual: false,
      });
      stealth = field.state;
      timeScale = field.timeScale;
      peakSuspicion = Math.max(peakSuspicion, field.suspicion);
      for (const entry of field.transitions) {
        transitions.push({ to: entry.to, cause: entry.cause });
      }
    }
  }
  return { motion, flow, stealth, peakSuspicion, transitions, tick: clock.tick };
}

test("a hard landing is heard by a guard who never saw the player", () => {
  // A 7m tower to jump off, and a guard on the far side of a full-height screen
  // wall that runs the length of the fall. He cannot see the player at any point
  // of it; the only thing that can reach him is the sound of somebody hitting the
  // cobbles.
  const collision = world([
    box("tower", 0, 7, 8, { width: 6 }),
    wall("screen", 7, 10, 0.4, 2.5),
  ]);
  const control = world([
    box("tower", 0, 7, 8, { width: 6 }),
    wall("screen", 7, 10, 0.4, 2.5),
  ]);
  const beside: WatcherPose = {
    id: "guard",
    position: { x: 5, y: 0, z: 9 },
    baseYaw: -Math.PI / 2,
  };
  const loud = runMission(collision, runningNorth(1, RUN_SPEED, 7), 60 * 4, 60, {
    jumpBuffered: true,
    watcher: beside,
  });
  assert.ok(
    loud.peakSuspicion > 0.3,
    `a body landing off a seven-metre roof must be audible (peak ${loud.peakSuspicion.toFixed(2)})`,
  );
  assert.deepEqual(
    loud.transitions.filter((entry) => entry.cause === "NOISE"),
    [{ to: "CURIOUS", cause: "NOISE" }],
    "the sound alone must make him look, without ever seeing anybody",
  );

  // The control: the same guard, the same four seconds, but the player stays on
  // the ground and never lands hard. Silence means he never notices.
  const quiet = runMission(control, runningNorth(-9, RUN_SPEED, 0), 60 * 4, 60, {
    watcher: beside,
  });
  assert.equal(quiet.peakSuspicion, 0);
  assert.equal(quiet.stealth.watchers[0]!.state, "UNAWARE");
});

test("a quiet mantle is stealthier than a loud slide", () => {
  const mantleCourse = world([box("ledge", 3, 1.5, 1.4, { width: 4 })]);
  const mantleNoise = (() => {
    let motion = runningNorth(1);
    let flow = createFlowState();
    let total = 0;
    for (let tick = 0; tick < 120; tick++) {
      const result = stepFlow(mantleCourse, motion, flow, flowInput());
      motion = result.motion;
      flow = result.flow;
      total += result.noise.reduce((sum, entry) => sum + entry.intensity, 0);
    }
    return total;
  })();
  assert.ok(mantleNoise > 0, "traversal is never silent");
  assert.ok(
    mantleNoise < 1,
    "but a mantle is quiet enough to be the stealthy option",
  );
});

test("the whole mission loop is deterministic across frame rates", () => {
  const build = () =>
    world([box("crate", 3, 0.95, 0.8), box("ledge", 7, 1.5, 1.4)]);
  const at30 = runMission(build(), runningNorth(1), 30 * 4, 30);
  const at60 = runMission(build(), runningNorth(1), 60 * 4, 60);
  const at120 = runMission(build(), runningNorth(1), 120 * 4, 120);
  assert.deepEqual(at30.motion, at60.motion);
  assert.deepEqual(at60.motion, at120.motion);
  assert.deepEqual(at30.stealth.watchers, at60.stealth.watchers);
  assert.deepEqual(at60.stealth.watchers, at120.stealth.watchers);
});

test("the same attempt seed replays identically", () => {
  const build = () => world([box("crate", 3, 0.95, 0.8)]);
  const first = runMission(build(), runningNorth(1), 240);
  const second = runMission(build(), runningNorth(1), 240);
  assert.deepEqual(first, second);
});

// ---- the surfaces other agents consume -------------------------------------

test("presentation exposes what a renderer and a HUD need, and nothing more", () => {
  const collision = world([box("ledge", 3, 1.5, 1.4)]);
  const run = runMission(collision, runningNorth(1), 120);
  const movement = flowPresentation(run.motion, run.flow);
  assert.deepEqual(Object.keys(movement).sort(), [
    "airborne",
    "capsuleHeight",
    "chain",
    "chainWindow01",
    "clip",
    "clipOnce",
    "crouched",
    "dashCharge01",
    "dashReady",
    "dashing",
    "inFlow",
    "landing",
    "pos",
    "speedMps",
    "verb",
    "yaw",
  ]);
  assert.equal(typeof movement.clip, "string");
  assert.ok(PARKOUR_CLIP_CONTRACT.includes(movement.clip));
});

test("the animation contract names every clip a verb can ask for", () => {
  const collision = world([
    box("crate", 3, 0.95, 0.8),
    box("ledge", 7, 1.5, 1.4),
  ]);
  let motion = runningNorth(1);
  let flow = createFlowState();
  const asked = new Set<string>();
  for (let tick = 0; tick < 300; tick++) {
    const result = stepFlow(collision, motion, flow, flowInput());
    motion = result.motion;
    flow = result.flow;
    asked.add(flow.clip);
  }
  for (const clip of asked) {
    assert.ok(
      PARKOUR_CLIP_CONTRACT.includes(clip),
      `${clip} is asked for but not in the contract the art agent was given`,
    );
  }
  // Every new clip declares a fallback that itself exists, so an unbaked rig
  // degrades to something real rather than a T-pose.
  for (const request of PARKOUR_CLIP_REQUESTS) {
    assert.ok(
      PARKOUR_CLIP_CONTRACT.includes(request.fallback),
      `${request.name} falls back to ${request.fallback}, which is not in the contract`,
    );
    assert.equal(PARKOUR_CLIP_FALLBACKS[request.name], request.fallback);
  }
});

test("stealth presentation reports the budgets a player must be able to see", () => {
  const collision = world();
  let stealth = createStealthFieldState([guard.id]);
  const result = stepStealthField(collision, stealth, {
    dt: FIELD_DT,
    tick: 1,
    seed: 1,
    watchers: [guard],
    player: {
      position: { x: 0, y: 0, z: 0 },
      capsuleHeight: STAND_HEIGHT,
      speedMps: 0,
      sprinting: false,
      traversing: false,
      exposure: "EXPOSED",
      covered: false,
      lightLevel: 1,
    },
    clusters: [],
    noise: [],
    reflexDisabled: false,
    suspendAccrual: false,
  });
  stealth = result.state;
  const hud = stealthPresentation(stealth, result);
  assert.equal(hud.reflexCharges, 3);
  assert.equal(hud.diversionCharges, 3);
  assert.equal(hud.reflexActive, false);
  assert.equal(hud.squadState, "UNAWARE");
});

test("an authored plan's endpoint is independently checkable by level tooling", () => {
  const collision = world([box("ledge", 3, 1.5, 1.4)]);
  const motion = runningNorth(1.6);
  const probe = probeAhead(collision, {
    pos: motion.pos,
    velX: motion.vel.x,
    velZ: motion.vel.z,
    yaw: motion.yaw,
  });
  const choice = selectVerb(collision, probe, selectContext(), motion.pos);
  assert.ok(choice);
  assert.equal(planEndpointValid(collision, choice!), true);
});

test("the motion read a mission passes to detection comes from the movement layer", () => {
  const collision = world([box("crate", 3, 0.95, 0.8)]);
  let motion = runningNorth(1);
  let flow = createFlowState();
  const reads = new Set<string>();
  for (let tick = 0; tick < 120; tick++) {
    const result = stepFlow(collision, motion, flow, flowInput());
    motion = result.motion;
    flow = result.flow;
    reads.add(
      motionReadFor({
        speedMps: Math.hypot(motion.vel.x, motion.vel.z),
        capsuleHeight: motion.capsuleHeight,
        sprinting: true,
        traversing: flow.verb !== "NONE",
      }),
    );
  }
  assert.ok(reads.has("SPRINT"));
  assert.ok(reads.has("TRAVERSAL"), "a vault must register as conspicuous");
});

test("the capability numbers level design builds against are exported", () => {
  // If this test has to change, the level agent has to be told.
  assert.deepEqual(
    {
      sprint: MOVEMENT_CAPABILITIES.sprintSpeedMps,
      gap: MOVEMENT_CAPABILITIES.levelDesignMaxFlatGapM,
      mantle: MOVEMENT_CAPABILITIES.maxMantleHeightM,
      vault: MOVEMENT_CAPABILITIES.maxVaultHeightM,
      climb: MOVEMENT_CAPABILITIES.maxClimbHeightM,
      step: MOVEMENT_CAPABILITIES.maxStepUpM,
      roll: MOVEMENT_CAPABILITIES.maxRollDropM,
      dive: MOVEMENT_CAPABILITIES.leapMinDropM,
    },
    {
      sprint: 4.6,
      gap: 3.3,
      mantle: 1.9,
      vault: 1.15,
      climb: 3.2,
      step: 0.5,
      roll: 5.5,
      dive: 6,
    },
  );
});
