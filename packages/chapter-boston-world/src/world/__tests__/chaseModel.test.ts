import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chaseTarget,
  createChaseState,
  stepChase,
  type ChasePoint,
  type ChaseState,
  type ChaseWorldQuery,
} from "../chaseModel.js";
import {
  advanceFieldClock,
  createFieldClock,
  FIELD_DT,
} from "../fieldSimulation.js";
import { CHASE_TUNING, type ChaseRouteGraph } from "../stealthManifest.js";

const OPEN_WORLD: ChaseWorldQuery = {
  segmentClear: () => true,
  sweepXZ: (_from, to) => ({
    x: to.x,
    z: to.z,
    blockedX: false,
    blockedZ: false,
  }),
};

const GRAPH: ChaseRouteGraph = {
  spaceId: "TEST",
  waypoints: [
    { id: "A", position: [0, 0, 0], links: ["B"] },
    { id: "B", position: [5, 0, 0], links: ["A", "C"] },
    { id: "C", position: [10, 0, 0], links: ["B"] },
  ],
};

function input(
  tick: number,
  player: ChasePoint,
  over: Partial<Parameters<typeof stepChase>[1]> = {},
): Parameters<typeof stepChase>[1] {
  return {
    tick,
    dt: FIELD_DT,
    player,
    playerStamina: 1,
    movementIntent: true,
    movementBlocked: false,
    actionSerial: 0,
    refuge: null,
    graph: GRAPH,
    world: OPEN_WORLD,
    pursuerSpeed: 4.3,
    assist: "STANDARD",
    ...over,
  };
}

function activeState(
  pursuer: ChasePoint = { x: 0, y: 0, z: 0 },
  player: ChasePoint = { x: 6, y: 0, z: 0 },
): ChaseState {
  const created = createChaseState({ tick: 0, pursuer, player });
  return { ...created, phase: "ACTIVE", phaseSeconds: 0 };
}

test("fixed-step chase state is identical at 30/60/120 render FPS", () => {
  function run(fps: number): ChaseState {
    let clock = createFieldClock(7);
    let state = activeState();
    for (let frame = 0; frame < fps * 2; frame++) {
      const advanced = advanceFieldClock(clock, 1 / fps);
      clock = advanced.clock;
      for (
        let tick = advanced.firstTick;
        tick <= advanced.lastTick;
        tick++
      ) {
        const player = { x: 8 + tick * 0.01, y: 0, z: 0 };
        state = stepChase(state, input(tick, player)).state;
      }
    }
    return state;
  }
  const at30 = run(30);
  assert.deepEqual(at30, run(60));
  assert.deepEqual(at30, run(120));
});

test("blocked direct line selects an authored corner route", () => {
  const wallWorld: ChaseWorldQuery = {
    segmentClear(a, b) {
      // A wall across x=[4,6], z=[-1,1]; z=3 corner route remains clear.
      if ((a.x < 4 && b.x > 6) || (b.x < 4 && a.x > 6)) {
        const midZ = (a.z + b.z) / 2;
        return Math.abs(midZ) > 1;
      }
      return true;
    },
    sweepXZ: OPEN_WORLD.sweepXZ,
  };
  const graph: ChaseRouteGraph = {
    spaceId: "TEST",
    waypoints: [
      { id: "LEFT", position: [2, 0, 3], links: ["RIGHT"], corner: true },
      { id: "RIGHT", position: [8, 0, 3], links: ["LEFT"], corner: true },
    ],
  };
  const state = activeState(
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  );
  const target = chaseTarget(
    state,
    input(1, { x: 10, y: 0, z: 0 }, { graph, world: wallWorld }),
  );
  assert.equal(target.direct, false);
  assert.equal(target.waypointId, "LEFT");
  assert.deepEqual(target.point, { x: 2, y: 0, z: 3 });
});

test("shake timer requires simultaneous broken LOS and >8m gap, and resets", () => {
  const hiddenWorld = { ...OPEN_WORLD, segmentClear: () => false };
  let state = activeState(
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  );
  state = stepChase(
    state,
    input(1, { x: 10, y: 0, z: 0 }, { dt: 2, world: hiddenWorld }),
  ).state;
  assert.equal(state.shakeSeconds, 2);
  state = stepChase(
    state,
    input(2, { x: 7, y: 0, z: 0 }, { dt: 1, world: hiddenWorld }),
  ).state;
  assert.equal(state.shakeSeconds, 0, "gap dropping to 8m or less resets");
  state = stepChase(
    state,
    input(3, { x: 10, y: 0, z: 0 }, { dt: 4.5, world: hiddenWorld }),
  ).state;
  assert.equal(state.phase, "SHAKEN");
  assert.equal(state.outcome, "ESCAPED");
});

test("tagged refuge resolves after authored door/cover hold timing", () => {
  let state = activeState();
  state = stepChase(
    state,
    input(1, { x: 6, y: 0, z: 0 }, {
      dt: 0.5,
      refuge: { id: "REFUGE_DOOR", holdSeconds: 0.8 },
    }),
  ).state;
  assert.equal(state.phase, "ACTIVE");
  assert.equal(state.pursuer.x, 0, "committed refuge timing protects the locked doorway beat");
  state = stepChase(
    state,
    input(2, { x: 6, y: 0, z: 0 }, {
      dt: 0.3,
      refuge: { id: "REFUGE_DOOR", holdSeconds: 0.8 },
    }),
  ).state;
  assert.equal(state.phase, "SHAKEN");
  assert.equal(state.outcome, "REFUGE");
});

test("catch requires empty stamina at close range or a full cornered hold", () => {
  let state = activeState(
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );
  state = stepChase(
    state,
    input(1, { x: 1, y: 0, z: 0 }, { playerStamina: 0 }),
  ).state;
  assert.equal(state.phase, "CAUGHT");

  state = activeState(
    { x: 0, y: 0, z: 0 },
    { x: 6, y: 0, z: 0 },
  );
  state = stepChase(
    state,
    input(1, { x: 6, y: 0, z: 0 }, {
      dt: CHASE_TUNING.corneredHoldSeconds - 0.01,
      movementIntent: true,
      movementBlocked: true,
    }),
  ).state;
  assert.equal(state.phase, "ACTIVE");
  state = stepChase(
    state,
    input(2, { x: 6, y: 0, z: 0 }, {
      dt: 0.01,
      movementIntent: true,
      movementBlocked: true,
    }),
  ).state;
  assert.equal(state.phase, "CAUGHT");
});

test("action serial adds one deterministic pursuer delay", () => {
  const state = activeState();
  const delayed = stepChase(
    state,
    input(1, { x: 6, y: 0, z: 0 }, { actionSerial: 1 }),
  ).state;
  assert.equal(delayed.lastActionSerial, 1);
  assert.ok(delayed.obstacleDelaySeconds > 0);
  assert.equal(delayed.pursuer.x, state.pursuer.x);
});

test("SLOW_PURSUER assist changes speed only, not chase outcomes", () => {
  const standard = stepChase(
    activeState(),
    input(1, { x: 20, y: 0, z: 0 }, { pursuerSpeed: 4.3 }),
  ).state;
  const assisted = stepChase(
    activeState(),
    input(1, { x: 20, y: 0, z: 0 }, {
      pursuerSpeed: 3.75,
      assist: "SLOW_PURSUER",
    }),
  ).state;
  assert.ok(assisted.pursuer.x < standard.pursuer.x);
  assert.equal(assisted.phase, standard.phase);
  assert.equal(assisted.outcome, standard.outcome);
});

test("CONFIRM_RESOLVE pauses the same bounded outcome until confirmed", () => {
  let state = activeState(
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  );
  state = stepChase(
    state,
    input(1, { x: 1, y: 0, z: 0 }, {
      playerStamina: 0,
      assist: "CONFIRM_RESOLVE",
    }),
  ).state;
  assert.equal(state.phase, "ACTIVE");
  assert.equal(state.pendingOutcome, "CAUGHT");
  state = stepChase(
    state,
    input(2, { x: 1, y: 0, z: 0 }, {
      playerStamina: 0,
      assist: "CONFIRM_RESOLVE",
      confirmResolve: true,
    }),
  ).state;
  assert.equal(state.phase, "CAUGHT");
  state = stepChase(
    state,
    input(3, { x: 1, y: 0, z: 0 }, {
      assist: "CONFIRM_RESOLVE",
    }),
  ).state;
  assert.equal(state.phase, "RESOLVING");
  state = stepChase(
    state,
    input(4, { x: 1, y: 0, z: 0 }, {
      assist: "CONFIRM_RESOLVE",
      resolutionCommitted: true,
    }),
  ).state;
  assert.equal(state.phase, "ENDED");
});

test("toppled-stack obstacle stumbles the pursuer for the authored ~2s, once", () => {
  // Obstacle directly on the pursuer's line, committed at tick 1.
  const obstacle = {
    id: "TOPPLE_TEST",
    x: 0.5,
    z: 0,
    tick: 1,
    delaySeconds: CHASE_TUNING.stumbleDelaySeconds,
    radiusM: CHASE_TUNING.stumbleRadiusM,
  };
  let state = activeState({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
  state = stepChase(
    state,
    input(1, { x: 10, y: 0, z: 0 }, { obstacles: [obstacle] }),
  ).state;
  assert.deepEqual(state.stumbledObstacleIds, ["TOPPLE_TEST"]);
  assert.equal(state.stumbleSeconds, CHASE_TUNING.stumbleDelaySeconds);
  assert.deepEqual(state.velocity, { x: 0, y: 0, z: 0 });
  const heldX = state.pursuer.x;

  // The stumble holds the pursuer in place for its full authored duration.
  const stumbleTicks = Math.round(
    CHASE_TUNING.stumbleDelaySeconds / FIELD_DT,
  );
  for (let tick = 2; tick < 1 + stumbleTicks; tick++) {
    state = stepChase(
      state,
      input(tick, { x: 10, y: 0, z: 0 }, { obstacles: [obstacle] }),
    ).state;
    assert.equal(state.pursuer.x, heldX, `pursuer held at tick ${tick}`);
  }
  // After the stumble drains, he moves again — and the SAME obstacle can
  // never trip him twice.
  for (let tick = 1 + stumbleTicks; tick <= 3 + stumbleTicks; tick++) {
    state = stepChase(
      state,
      input(tick, { x: 10, y: 0, z: 0 }, { obstacles: [obstacle] }),
    ).state;
  }
  assert.ok(state.pursuer.x > heldX, "pursuer recovers and closes again");
  assert.deepEqual(state.stumbledObstacleIds, ["TOPPLE_TEST"]);
});

test("stumble timing is deterministic across replays of the same inputs", () => {
  const obstacle = {
    id: "TOPPLE_REPLAY",
    x: 1,
    z: 0,
    tick: 3,
    delaySeconds: CHASE_TUNING.stumbleDelaySeconds,
    radiusM: CHASE_TUNING.stumbleRadiusM,
  };
  function run(): ChaseState {
    let state = activeState({ x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 });
    for (let tick = 1; tick <= 200; tick++) {
      state = stepChase(
        state,
        input(tick, { x: 12, y: 0, z: 0 }, { obstacles: [obstacle] }),
      ).state;
    }
    return state;
  }
  assert.deepEqual(run(), run());
});

test("an obstacle committed in the future or out of reach never trips", () => {
  const future = {
    id: "TOPPLE_FUTURE",
    x: 0.5,
    z: 0,
    tick: 50,
    delaySeconds: 2,
    radiusM: 1.7,
  };
  const far = {
    id: "TOPPLE_FAR",
    x: 0.5,
    z: 30,
    tick: 1,
    delaySeconds: 2,
    radiusM: 1.7,
  };
  const state = stepChase(
    activeState({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }),
    input(1, { x: 10, y: 0, z: 0 }, { obstacles: [future, far] }),
  ).state;
  assert.deepEqual(state.stumbledObstacleIds, []);
  assert.equal(state.stumbleSeconds, 0);
  assert.ok(state.pursuer.x > 0, "pursuer keeps running");
});

test("tavern-cut door pause holds the pursuer at the doorway then releases", () => {
  // Pursuer chases toward the door; the cut committed the door obstacle with
  // the unseen (longer) pause. LOS through the row is broken after the cut.
  const doorway = {
    id: "CHASE_TAVERN_CUT_DOOR",
    x: 4,
    z: 0,
    tick: 1,
    delaySeconds: CHASE_TUNING.tavernCutUnseenPauseSeconds,
    radiusM: 1.6,
  };
  const blockedWorld = { ...OPEN_WORLD, segmentClear: () => false };
  let state = activeState({ x: 3, y: 0, z: 0 }, { x: 30, y: 0, z: 0 });
  state = stepChase(
    state,
    input(1, { x: 30, y: 0, z: 0 }, {
      obstacles: [doorway],
      world: blockedWorld,
    }),
  ).state;
  assert.deepEqual(state.stumbledObstacleIds, ["CHASE_TAVERN_CUT_DOOR"]);
  assert.equal(
    state.stumbleSeconds,
    CHASE_TUNING.tavernCutUnseenPauseSeconds,
  );
  // While he checks the doorway with sight broken and the gap open, the
  // escape (shake) clock accumulates — the cut is a real escape tool.
  state = stepChase(
    state,
    input(2, { x: 30, y: 0, z: 0 }, {
      dt: CHASE_TUNING.shakeHoldSeconds,
      obstacles: [doorway],
      world: blockedWorld,
    }),
  ).state;
  assert.equal(state.phase, "SHAKEN");
  assert.equal(state.outcome, "ESCAPED");
});

test("high-latency field catch-up remains bounded without pursuer tunneling", () => {
  const advanced = advanceFieldClock(createFieldClock(1), 1);
  assert.equal(advanced.steps, 5);
  let state = activeState();
  const startX = state.pursuer.x;
  for (
    let tick = advanced.firstTick;
    tick <= advanced.lastTick;
    tick++
  ) {
    state = stepChase(
      state,
      input(tick, { x: 20, y: 0, z: 0 }),
    ).state;
  }
  assert.ok(
    state.pursuer.x - startX <= 4.3 * FIELD_DT * advanced.steps + 1e-9,
  );
});
