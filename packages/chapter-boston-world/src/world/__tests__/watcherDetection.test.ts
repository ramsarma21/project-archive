import test from "node:test";
import assert from "node:assert/strict";
import {
  wallFromCapsule,
  wallFromOrientedRect,
  wallFromRect,
  type CollisionWorld,
} from "../collision.js";
import { bindGameplayWorld, EXTERIOR_GAMEPLAY_SPACE } from "../gameplayWorld.js";
import {
  CHECKPOINT_VOLUMES,
  COVER_VOLUMES,
  WATCHERS,
  pointInCover,
} from "../stealthManifest.js";
import {
  checkpointChallenges,
  initialCheckpointState,
  initialSuspicionState,
  MIN_ACCRUAL_VISIBILITY,
  SUSPICION_ACCRUAL_PER_SECOND,
  SUSPICION_DECAY_PER_SECOND,
  rangeAtDayProgress,
  stepCheckpoint,
  stepHeatDecay,
  stepSuspicion,
  visibilityFactors,
  watcherAttentionPolicy,
  watcherHeatMigrationReady,
  watcherPoseAt,
} from "../watcherDetection.js";
import {
  advanceFieldClock,
  createFieldClock,
  FIELD_DT,
} from "../fieldSimulation.js";

test("scripted interrupts drain attention without allowing new accrual", () => {
  assert.deepEqual(
    watcherAttentionPolicy({
      exterior: true,
      active: true,
      chaseActive: false,
      suspended: false,
      interruptActive: true,
    }),
    { simulationActive: true, canAccrue: false },
  );
  assert.deepEqual(
    watcherAttentionPolicy({
      exterior: true,
      active: true,
      chaseActive: false,
      suspended: false,
      interruptActive: false,
    }),
    { simulationActive: true, canAccrue: true },
  );
  assert.equal(
    watcherHeatMigrationReady({
      active: true,
      interruptActive: true,
      legacyAuthority: true,
      alreadyQueued: false,
    }),
    false,
    "legacy migration must wait until the reconstructed exchange resolves",
  );
  assert.equal(
    watcherHeatMigrationReady({
      active: true,
      interruptActive: false,
      legacyAuthority: true,
      alreadyQueued: false,
    }),
    true,
  );
});

function world(blockers: CollisionWorld["blockers"] = []) {
  return bindGameplayWorld(
    {
      blockers,
      platforms: [],
      bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    },
    EXTERIOR_GAMEPLAY_SPACE,
  );
}

function visibility(input: {
  player: { x: number; y: number; z: number };
  blockers?: CollisionWorld["blockers"];
  concealment?: "EXPOSED" | "WRAPPED" | "HIDDEN";
  motion?: "STILL" | "CROUCH" | "WALK" | "SPRINT" | "VAULT_CLIMB";
  covered?: boolean;
  range?: number;
}) {
  const service = world(input.blockers);
  return visibilityFactors({
    watcherPosition: { x: 0, y: 0, z: 0 },
    watcherForward: { x: 1, y: 0, z: 0 },
    playerPosition: input.player,
    halfAngleRad: Math.PI / 4,
    rangeM: input.range ?? 12,
    concealment: input.concealment ?? "EXPOSED",
    motion: input.motion ?? "WALK",
    covered: input.covered ?? false,
    segmentClear: service.segmentClear,
  });
}

test("visibility cone center, edge, outside, and range", () => {
  const center = visibility({ player: { x: 6, y: 0, z: 0 } });
  assert.equal(center.inCone, true);
  assert.equal(center.coneFactor, 1);
  assert.ok(center.visibility > 0);

  const edge = visibility({ player: { x: 6, y: 0, z: 6 } });
  assert.equal(edge.inCone, true);
  assert.ok(edge.coneFactor < 1e-12);
  assert.equal(edge.visibility, 0);

  const outside = visibility({ player: { x: 6, y: 0, z: 6.2 } });
  assert.equal(outside.inCone, false);
  assert.equal(outside.visibility, 0);

  const beyond = visibility({ player: { x: 12.01, y: 0, z: 0 } });
  assert.equal(beyond.inCone, false);
  assert.equal(beyond.visibility, 0);
});

test("exact finite-height AABB, OBB, and capsule LOS", () => {
  const player = { x: 8, y: 0, z: 0 };
  const fullWall = wallFromRect("wall", 4, 0, 0.2, 2);
  assert.equal(visibility({ player, blockers: [fullWall] }).hasLos, false);

  const lowCover = wallFromRect("low", 4, 0, 0.4, 2, { topY: 0.6 });
  assert.equal(visibility({ player, blockers: [lowCover] }).hasLos, true);

  const obb = wallFromOrientedRect("obb", 4, 0, 0.3, 2, Math.PI / 5);
  assert.equal(visibility({ player, blockers: [obb] }).hasLos, false);

  const capsule = wallFromCapsule(
    "capsule",
    { x: 4, y: 0, z: -1 },
    { x: 4, y: 0, z: 1 },
    0.25,
    { topY: 2 },
  );
  assert.equal(visibility({ player, blockers: [capsule] }).hasLos, false);
});

test("exposure, motion, and cover factors are exact", () => {
  const player = { x: 6, y: 0, z: 0 };
  assert.equal(visibility({ player, concealment: "EXPOSED" }).exposureFactor, 1);
  assert.equal(visibility({ player, concealment: "WRAPPED" }).exposureFactor, 0.5);
  assert.equal(visibility({ player, concealment: "HIDDEN" }).exposureFactor, 0.15);
  assert.equal(visibility({ player, motion: "STILL" }).motionFactor, 0.5);
  assert.equal(visibility({ player, motion: "CROUCH" }).motionFactor, 0.4);
  assert.equal(visibility({ player, motion: "WALK" }).motionFactor, 0.8);
  assert.equal(visibility({ player, motion: "SPRINT" }).motionFactor, 1.3);
  assert.equal(visibility({ player, motion: "VAULT_CLIMB" }).motionFactor, 1.5);
  assert.equal(visibility({ player, covered: true }).coverFactor, 0.3);
});

test("all heat and Standing multipliers drive exact suspicion deltas", () => {
  const heat = { CALM: 0.8, NOTICED: 1, WATCHED: 1.25, HUNTED: 1.6 } as const;
  const standing = { TRUSTED: 0.7, FAMILIAR: 0.7, NEUTRAL: 1, MARKED: 1.4 } as const;
  for (const [heatBand, heatMult] of Object.entries(heat)) {
    for (const [standingBand, standingMult] of Object.entries(standing)) {
      const result = stepSuspicion(initialSuspicionState(), {
        dt: 1,
        visibility: 0.5,
        heat: heatBand as keyof typeof heat,
        standing: standingBand as keyof typeof standing,
      });
      const legible =
        (0.5 - MIN_ACCRUAL_VISIBILITY) /
        (1 - MIN_ACCRUAL_VISIBILITY);
      assert.ok(
        Math.abs(
          result.state.value -
            SUSPICION_ACCRUAL_PER_SECOND *
              legible *
              heatMult *
              standingMult,
        ) <
          1e-12,
      );
    }
  }
  const decay = stepSuspicion(
    { ...initialSuspicionState(), value: 0.8 },
    { dt: 1, visibility: 0, heat: "HUNTED", standing: "MARKED" },
  );
  assert.ok(
    Math.abs(decay.state.value - (0.8 - SUSPICION_DECAY_PER_SECOND)) <
      1e-12,
  );
});

test("cone feather, concealment, cover, and lost LOS drain suspicion", () => {
  const lowSignals = [
    visibility({
      player: { x: 6, y: 0, z: 5.5 },
      motion: "STILL",
    }),
    visibility({
      player: { x: 6, y: 0, z: 0 },
      concealment: "HIDDEN",
    }),
    visibility({
      player: { x: 6, y: 0, z: 0 },
      concealment: "WRAPPED",
      motion: "CROUCH",
      covered: true,
    }),
    visibility({
      player: { x: 8, y: 0, z: 0 },
      blockers: [wallFromRect("wall", 4, 0, 0.2, 2)],
    }),
  ];
  for (const signal of lowSignals) {
    assert.ok(
      signal.visibility <= MIN_ACCRUAL_VISIBILITY,
      `unexpectedly legible signal ${signal.visibility}`,
    );
    const result = stepSuspicion(
      { ...initialSuspicionState(), value: 0.65, toldWary: true },
      {
        dt: 0.5,
        visibility: signal.visibility,
        heat: "HUNTED",
        standing: "MARKED",
      },
    );
    assert.ok(result.state.value < 0.65, "weak signal persisted suspicion");
    assert.deepEqual(result.crossed, []);
  }
});

test("scripted concealment drains queued attention and rearms tells", () => {
  let state = initialSuspicionState();
  for (let tick = 0; tick < 240; tick++) {
    state = stepSuspicion(state, {
      dt: FIELD_DT,
      visibility: 0.65,
      heat: "NOTICED",
      standing: "NEUTRAL",
    }).state;
    if (state.toldAlerted) break;
  }
  assert.ok(state.toldAlerted);
  assert.ok(state.value >= 0.7);

  // An exchange/notice read supplies visibility=0 while detection is
  // suspended. Four seconds clears both ALERTED and WARY hysteresis.
  for (let tick = 0; tick < 4 / FIELD_DT; tick++) {
    state = stepSuspicion(state, {
      dt: FIELD_DT,
      visibility: 0,
      heat: "NOTICED",
      standing: "NEUTRAL",
    }).state;
  }
  assert.ok(state.value < 0.2, `attention persisted at ${state.value}`);
  assert.equal(state.toldWary, false);
  assert.equal(state.toldAlerted, false);
  assert.equal(state.confronted, false);

  const recrossed: string[] = [];
  for (let tick = 0; tick < 360; tick++) {
    const result = stepSuspicion(state, {
      dt: FIELD_DT,
      visibility: 0.65,
      heat: "NOTICED",
      standing: "NEUTRAL",
    });
    state = result.state;
    recrossed.push(...result.crossed);
    if (state.confronted) break;
  }
  assert.deepEqual(recrossed, ["WARY", "ALERTED", "CONFRONTATION"]);
});

test("threshold tells and confrontation fire once", () => {
  let state = initialSuspicionState();
  const seen: string[] = [];
  for (let i = 0; i < 10; i++) {
    const result = stepSuspicion(state, {
      dt: 0.5,
      visibility: 1,
      heat: "HUNTED",
      standing: "MARKED",
    });
    state = result.state;
    seen.push(...result.crossed);
  }
  assert.deepEqual(seen, ["WARY", "ALERTED", "CONFRONTATION"]);
});

test("fixed-step exposure/concealment sequence is identical at 30, 60, and 120 fps", () => {
  const simulate = (fps: number) => {
    let clock = createFieldClock(7);
    let suspicion = initialSuspicionState();
    let simulationTick = 0;
    for (let frame = 0; frame < fps * 6; frame++) {
      const advanced = advanceFieldClock(clock, 1 / fps, {
        maxCatchUpSteps: 10,
      });
      clock = advanced.clock;
      for (let step = 0; step < advanced.steps; step++) {
        simulationTick += 1;
        const seconds = simulationTick / 60;
        suspicion = stepSuspicion(suspicion, {
          dt: FIELD_DT,
          visibility:
            seconds < 2
              ? 0.42
              : seconds < 4
                ? 0
                : 0.68,
          heat: "NOTICED",
          standing: "NEUTRAL",
        }).state;
      }
    }
    return suspicion.value;
  };
  assert.equal(simulate(30), simulate(60));
  assert.equal(simulate(60), simulate(120));
});

test("authored watcher roster, scan, patrol, dusk range, and cover are stable", () => {
  assert.equal(WATCHERS.length, 4);
  assert.deepEqual(
    WATCHERS.map(({ id, position }) => [id, position]),
    [
      ["WATCH-customs", [-56, 0, -2]],
      ["WATCH-patrol", [-32, 0, 2]],
      ["WATCH-house-1", [52, 0, 8]],
      ["WATCH-house-2", [58, 0, 8]],
    ],
  );
  const posted = WATCHERS[0]!;
  const scanStart = watcherPoseAt(posted, 0);
  const scanOneSecond = watcherPoseAt(posted, 60);
  assert.ok(Math.abs(scanOneSecond.yaw - scanStart.yaw - 0.3) < 1e-12);

  const patrol = WATCHERS[1]!;
  const a = watcherPoseAt(patrol, 0);
  const b = watcherPoseAt(patrol, 60);
  assert.ok(b.position.x > a.position.x);
  assert.ok(b.velocity.x > 0);
  assert.equal(rangeAtDayProgress(posted, 0), 12);
  assert.ok(Math.abs(rangeAtDayProgress(posted, 1) - 13.8) < 1e-12);
  assert.ok(COVER_VOLUMES.some((volume) => volume.kind === "CROWD"));
  assert.ok(COVER_VOLUMES.some((volume) => volume.kind === "STATIC"));
  assert.equal(pointInCover({ x: -50, z: -5 })?.id, "COVER-crowd-market");
});

test("checkpoint entry-edge ordinal, cooldown/rearm, and spot checks", () => {
  const checkpoint = CHECKPOINT_VOLUMES[0]!;
  let state = initialCheckpointState();
  let result = stepCheckpoint(state, checkpoint, { x: -70, z: 0 }, 0);
  state = result.state;
  assert.equal(result.crossed, false);
  result = stepCheckpoint(state, checkpoint, { x: -56, z: 0 }, 1);
  state = result.state;
  assert.equal(result.crossed, true);
  assert.equal(result.ordinal, 1);
  result = stepCheckpoint(state, checkpoint, { x: -56, z: 0 }, 2);
  assert.equal(result.crossed, false);
  state = stepCheckpoint(state, checkpoint, { x: -70, z: 0 }, 700).state;
  result = stepCheckpoint(state, checkpoint, { x: -56, z: 0 }, 701);
  assert.equal(result.ordinal, 2);

  assert.equal(
    checkpointChallenges({
      heat: "NOTICED",
      standing: "TRUSTED",
      concealment: "WRAPPED",
    }),
    false,
  );
  assert.equal(
    checkpointChallenges({
      heat: "WATCHED",
      standing: "NEUTRAL",
      concealment: "WRAPPED",
    }),
    true,
  );
  // Exposed goods draw the authored customs stop even at CALM heat — the
  // writs search is the teaching encounter; concealment is the earned pass.
  assert.equal(
    checkpointChallenges({
      heat: "CALM",
      standing: "MARKED",
      concealment: "EXPOSED",
    }),
    true,
  );
  assert.equal(
    checkpointChallenges({
      heat: "CALM",
      standing: "NEUTRAL",
      concealment: "WRAPPED",
    }),
    false,
  );
});

test("durable heat decay pauses in cones and preserves elapsed progress", () => {
  let progress = {
    band: "HUNTED" as const,
    elapsedSeconds: 20,
    requiredSeconds: 45,
    paused: false,
  };
  progress = stepHeatDecay(progress, 10, true).progress;
  assert.equal(progress.elapsedSeconds, 20);
  const advanced = stepHeatDecay(progress, 25, false);
  assert.deepEqual(advanced.transition, { from: "HUNTED", to: "WATCHED" });

  const watched = stepHeatDecay(
    {
      band: "WATCHED",
      elapsedSeconds: 59,
      requiredSeconds: 60,
      paused: false,
    },
    1,
    false,
  );
  assert.deepEqual(watched.transition, { from: "WATCHED", to: "NOTICED" });
});
