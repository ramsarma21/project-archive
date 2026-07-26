import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_DT,
  FIELD_TICK_HZ,
  STAND_HEIGHT,
  STEALTH_TUNING,
  clusterContaining,
  visibility,
  type WatcherPose,
} from "@pa/engine-world";
import {
  DAWN,
  crowdKept,
  crowdLabel,
  dawnDispersal01,
  dawnLift01,
  dawnLightLevel,
  dawnRead,
  dawnSky,
  disperseAtDawn,
  shadowLabel,
} from "../src/mission/dawn.js";
import {
  createMissionRuntime,
  missionCrowdParity,
  missionPresentation,
  stepMissionRuntime,
  type MissionInputFrame,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import type { MissionCivilian, MissionInstance } from "../src/mission/levelPort.js";
import {
  testCivilian,
  testInstance,
  testWorld,
  tickObjective,
} from "./missionHarness.js";

// The mission clock, and the two things it takes away.
//
// The design it is asserting: dawn is the clock, running out of it does not end
// the attempt, and what it costs instead is the dark (continuously, from the
// first second) and the crowd (at the budget, over the following seconds). The
// tests that matter most here are the negative one — that a run past its budget
// is still a live run — and the frame-rate one, because a clock that drifted with
// frame rate would make the whole replay story a fiction.

const IDLE: MissionInputFrame = {
  dtS: 1 / 60,
  moveX: 0,
  moveZ: 0,
  sprintHeld: false,
  crouchHeld: false,
  jumpBuffered: false,
  reducedMotion: false,
  flowEnabled: true,
};

const BUDGET = 180;

function runFor(runtime: MissionRuntime, seconds: number, dtS = 1 / 60): void {
  const frames = Math.round(seconds / dtS);
  for (let frame = 0; frame < frames; frame += 1) {
    stepMissionRuntime(runtime, { ...IDLE, dtS });
  }
}

/**
 * A run aged to a point on the clock without simulating the seconds up to it.
 *
 * Poking `ticks` is exactly as legitimate as the clock being a pure function of
 * it — which is the property under test everywhere else in this file. It keeps
 * these tests to milliseconds instead of stepping 10,800 times per case.
 */
function agedTo(runtime: MissionRuntime, elapsedS: number): MissionRuntime {
  runtime.ticks = Math.round(elapsedS * FIELD_TICK_HZ);
  return runtime;
}

function neverEnding(overrides: Partial<MissionInstance> = {}): MissionInstance {
  return {
    ...testInstance({
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
      traversalBudgetS: BUDGET,
    }),
    ...overrides,
  };
}

// ---- the curve ------------------------------------------------------------

test("the lift is nothing at the start, first light at the budget, full at the span", () => {
  assert.equal(dawnLift01(0, BUDGET), 0);
  assert.equal(dawnLift01(BUDGET, BUDGET), DAWN.liftAtDawn);
  assert.equal(dawnLift01(BUDGET + DAWN.overrunSpanS, BUDGET), 1);
  // And it stays there. An hour past dawn is not brighter than daylight.
  assert.equal(dawnLift01(BUDGET * 20, BUDGET), 1);
});

test("the light only ever goes one way", () => {
  let previous = -1;
  for (let elapsedS = 0; elapsedS <= BUDGET * 2; elapsedS += 0.5) {
    const lift = dawnLift01(elapsedS, BUDGET);
    assert.ok(
      lift >= previous,
      `the sky went back to being darker at ${elapsedS}s: ${lift} after ${previous}`,
    );
    previous = lift;
  }
});

test("the night is back-loaded, so the last stretch is the one that costs", () => {
  // A third of the way through the night the sky has barely moved; two thirds
  // through, most of the night's share is spent. That shape is the whole feel of
  // the clock: nothing, then hurry.
  const third = dawnLift01(BUDGET / 3, BUDGET);
  const twoThirds = dawnLift01((BUDGET * 2) / 3, BUDGET);
  assert.ok(third < 0.1, `a third in should still be dark, got ${third}`);
  assert.ok(twoThirds > third * 3, "and the second third costs far more than the first");
  assert.ok(twoThirds < DAWN.liftAtDawn);
});

test("the clock is the level's declared budget, never a hard-coded 180", () => {
  // The level is 28.5s short of its budget today and another agent is adding
  // route to close that, so this file must not know the number either.
  for (const budgetS of [90, 145, 180, 208.5]) {
    assert.equal(dawnLift01(budgetS, budgetS), DAWN.liftAtDawn, `${budgetS}s`);
    assert.equal(dawnRead(budgetS / 2, budgetS).remainingS, budgetS / 2);
  }
  // A level that declared no budget gets no clock rather than a NaN on screen.
  const inert = dawnRead(40, 0);
  assert.equal(inert.hasClock, false);
  assert.equal(inert.lift01, 0);
  assert.equal(inert.dispersal01, 0);
});

test("the read counts down to dawn and then counts up past it", () => {
  const before = dawnRead(BUDGET - 41, BUDGET);
  assert.equal(before.remainingS, 41);
  assert.equal(before.pastS, 0);
  assert.equal(before.stage, "GREY");

  const after = dawnRead(BUDGET + 23, BUDGET);
  assert.equal(after.remainingS, 0, "the countdown floors rather than going negative");
  assert.equal(after.pastS, 23);
  assert.equal(after.stage, "DAWN");

  assert.equal(dawnRead(0, BUDGET).stage, "LAST_DARK");
  assert.equal(dawnRead(BUDGET + DAWN.overrunSpanS, BUDGET).stage, "SUN_UP");
});

// ---- the dark -------------------------------------------------------------

test("dawn lifts the authored dark toward daylight without flattening it", () => {
  const alley = 0.05;
  const lamplit = 0.55;
  const lift = DAWN.liftAtDawn;

  assert.equal(dawnLightLevel(alley, 0), alley, "at midnight the level is untouched");
  assert.ok(dawnLightLevel(alley, lift) > alley);
  assert.ok(
    dawnLightLevel(alley, lift) < dawnLightLevel(lamplit, lift),
    "the alley is still darker than the doorway, so the same places keep working",
  );
  assert.equal(dawnLightLevel(alley, 1), 1, "and at sun-up nothing is dark at all");
});

test("the lift costs real visibility through the shipped vision model", () => {
  // Not a claim about the number: this runs @pa/engine-world's own `visibility`
  // and asserts the light term moves detectability, which is what makes the
  // clock a mechanic rather than a mood.
  const world = testWorld();
  const watcher = {
    position: { x: 0, y: 0, z: 8 },
    forwardX: 0,
    forwardZ: -1,
    capsuleHeight: STAND_HEIGHT,
  };
  const player = {
    position: { x: 0, y: 0, z: 0 },
    capsuleHeight: STAND_HEIGHT,
    exposure: "EXPOSED" as const,
    motion: "WALK" as const,
    covered: false,
    crowdBlend: 0,
  };

  const midnight = visibility(world, watcher, {
    ...player,
    lightLevel: dawnLightLevel(0.05, 0),
  });
  const dawn = visibility(world, watcher, {
    ...player,
    lightLevel: dawnLightLevel(0.05, DAWN.liftAtDawn),
  });
  const sunUp = visibility(world, watcher, {
    ...player,
    lightLevel: dawnLightLevel(0.05, 1),
  });

  assert.ok(midnight.visibility > 0, "the watcher can see the player at all");
  assert.ok(
    dawn.visibility > midnight.visibility * 1.3,
    `standing still in the same corner should read far worse at dawn: ${midnight.visibility.toFixed(3)} -> ${dawn.visibility.toFixed(3)}`,
  );
  assert.ok(sunUp.visibility > dawn.visibility);
  assert.ok(
    Math.abs(sunUp.lightFactor - 1) < 1e-9,
    "and at sun-up the darkness bonus is gone entirely",
  );
});

test("the runtime feeds the lifted light to the field, not just to the HUD", () => {
  // The end-to-end version of the test above, through the container: the same
  // watcher staring at the same player in the same authored dark accrues more
  // suspicion after dawn than before it. If the lift were only a presentation
  // value these two numbers would be identical.
  const watchers: readonly WatcherPose[] = [
    { id: "w", position: { x: 0, y: 0, z: 7 }, baseYaw: Math.PI },
  ];
  function stared(atS: number): number {
    const runtime = createMissionRuntime({
      instance: neverEnding({
        watcherIds: ["w"],
        watcherPosesAtTick: () => watchers,
        lightLevelAt: () => 0.05,
      }),
      seed: 0xda3,
    });
    agedTo(runtime, atS);
    runFor(runtime, 1);
    return runtime.stealthView.suspicion;
  }

  const midnight = stared(0);
  const dawn = stared(BUDGET);
  assert.ok(midnight > 0, `the watcher noticed something at all, got ${midnight}`);
  assert.ok(
    dawn > midnight,
    `a second of standing in the open should cost more at dawn: ${midnight.toFixed(4)} vs ${dawn.toFixed(4)}`,
  );
});

// ---- the crowd ------------------------------------------------------------

test("nobody goes home before dawn", () => {
  assert.equal(dawnDispersal01(0, BUDGET), 0);
  assert.equal(dawnDispersal01(BUDGET - 1, BUDGET), 0);
  assert.equal(dawnDispersal01(BUDGET, BUDGET), 0);
  assert.ok(dawnDispersal01(BUDGET + 1, BUDGET) > 0);
  assert.equal(dawnDispersal01(BUDGET + DAWN.crowdDepartureS, BUDGET), 1);
});

test("a fully dispersed crowd cannot hide anybody, whatever the level authored", () => {
  // The floor is derived from the engine's blend threshold rather than picked, so
  // the promise "blending stops working" holds for a crowd of six or of sixty.
  for (const count of [4, 6, 12, 40]) {
    const kept = crowdKept(count, 1);
    assert.ok(
      kept < STEALTH_TUNING.crowdBlendMinDensity,
      `${count} bodies thinned to ${kept}, which still hides somebody`,
    );
    assert.equal(crowdKept(count, 0), count, "and none of them leave before dawn");
  }
});

test("bodies leave one at a time and never come back", () => {
  let previous = 12;
  for (let step = 0; step <= 1.0001; step += 0.02) {
    const kept = crowdKept(12, step);
    assert.ok(kept <= previous, `${kept} after ${previous} at dispersal ${step}`);
    previous = kept;
  }
  assert.ok(crowdKept(12, 0.5) < 12, "the square is visibly emptier halfway through");
  assert.ok(crowdKept(12, 0.5) >= STEALTH_TUNING.crowdBlendMinDensity);
});

test("the crowd that leaves is the same crowd every time, for one attempt", () => {
  const crowd = Array.from({ length: 12 }, (_, index) =>
    testCivilian(`c${index}`, index * 0.2, 10, { clusterId: "square" }),
  );
  const half = disperseAtDawn(crowd, 0.5, 99);
  assert.deepEqual(
    disperseAtDawn(crowd, 0.5, 99).map((civilian) => civilian.id),
    half.map((civilian) => civilian.id),
    "a replayed attempt empties the square the same way",
  );
  // Whoever has already gone stays gone as dawn goes on.
  const later = new Set(disperseAtDawn(crowd, 0.8, 99).map((c) => c.id));
  for (const civilian of later) {
    assert.ok(
      half.some((stayed) => stayed.id === civilian),
      `${civilian} left and then came back`,
    );
  }
  // And a different attempt sends a different set home first.
  const other = disperseAtDawn(crowd, 0.5, 1234).map((c) => c.id).join();
  assert.notEqual(other, half.map((c) => c.id).join());
});

test("an untouched crowd is the very same array, so nothing downstream rebuilds", () => {
  const crowd = [testCivilian("a", 0, 10, { clusterId: "square" })];
  assert.equal(disperseAtDawn(crowd, 0, 7), crowd);
});

test("every crowd thins, rather than one square being stripped bare", () => {
  const crowd: MissionCivilian[] = [];
  for (const cluster of ["north", "south"]) {
    for (let index = 0; index < 10; index += 1) {
      crowd.push(testCivilian(`${cluster}-${index}`, index, 0, { clusterId: cluster }));
    }
  }
  const left = disperseAtDawn(crowd, 0.5, 42);
  const north = left.filter((civilian) => civilian.clusterId === "north").length;
  const south = left.filter((civilian) => civilian.clusterId === "south").length;
  assert.ok(north < 10 && south < 10, "both crowds lost bodies");
  assert.equal(north, south, "and they lost the same share of them");
});

test("past dawn the counted density falls until blending is gone", () => {
  const crowd = Array.from({ length: 12 }, (_, index) =>
    testCivilian(`c${index}`, Math.cos(index) * 2, 10 + Math.sin(index) * 2, {
      clusterId: "square",
    }),
  );
  const instance = neverEnding({
    crowdClusters: [{ id: "square", x: 0, z: 10, radiusM: 4 }],
    civiliansAtTick: () => crowd,
  });

  function densityAt(elapsedS: number): number {
    const runtime = createMissionRuntime({ instance, seed: 0x5ee });
    agedTo(runtime, elapsedS);
    runFor(runtime, 0.1);
    // The invariant that makes any of this honest: the field's density is counted
    // from the bodies the stage draws, so a thinned crowd is thinner on screen.
    assert.deepEqual(missionCrowdParity(runtime), []);
    const view = missionPresentation(runtime);
    return view.crowdClusters[0]?.density ?? 0;
  }

  const midnight = densityAt(0);
  const atDawn = densityAt(BUDGET);
  const halfway = densityAt(BUDGET + DAWN.crowdDepartureS / 2);
  const gone = densityAt(BUDGET + DAWN.crowdDepartureS);

  assert.equal(midnight, 12);
  assert.equal(atDawn, 12, "the crowd holds right up to the budget");
  assert.ok(halfway < atDawn && halfway >= STEALTH_TUNING.crowdBlendMinDensity);
  assert.ok(gone < STEALTH_TUNING.crowdBlendMinDensity);
  assert.equal(
    clusterContaining(
      [{ id: "square", x: 0, z: 10, radiusM: 4, density: gone }],
      0,
      10,
    ),
    null,
    "and the engine's own blend rule refuses what is left",
  );
});

// ---- what the clock must not do -------------------------------------------

test("running out of clock does not end the attempt", () => {
  // The standing rule: the only authored fail point on this floor is being held
  // in the final court. A hard fail at 2:58 after a good run is the thing a
  // thirteen-year-old quits over, so the clock may take tools and never the run.
  const runtime = createMissionRuntime({ instance: neverEnding(), seed: 0xc10 });
  agedTo(runtime, BUDGET * 2);
  runFor(runtime, 2);

  assert.equal(runtime.outcome, null, "still playable long past dawn");
  assert.equal(runtime.dawn.pastS > BUDGET, true);
  assert.equal(runtime.dawn.lift01, 1, "the tools are gone, which is the cost");
});

test("the clock is the simulation's, so frame rate cannot change it", () => {
  // 30, 60 and 144 Hz over the same twelve seconds. The tolerance is one fixed
  // step, because a frame delta that is not exactly representable can leave a
  // step's worth of remainder in the accumulator — the claim being tested is that
  // the sky is counted in ticks, not that floating point is exact. A clock reading
  // wall time would drift without bound here instead of by 16 ms.
  const reads = [1 / 30, 1 / 60, 1 / 144].map((dtS) => {
    const runtime = createMissionRuntime({ instance: neverEnding(), seed: 0xf0 });
    runFor(runtime, 12, dtS);
    return runtime.dawn;
  });
  const [first] = reads;
  assert.ok(first);
  for (const read of reads) {
    assert.ok(
      Math.abs(read.elapsedS - first.elapsedS) <= FIELD_DT + 1e-9,
      `${read.elapsedS}s against ${first.elapsedS}s`,
    );
    assert.ok(Math.abs(read.lift01 - first.lift01) < 1e-4);
    assert.equal(read.dispersal01, first.dispersal01);
  }
  assert.ok(first.lift01 > 0, "and twelve seconds of night did move the sky");
  assert.ok(
    Math.abs(first.elapsedS - 12) <= FIELD_DT + 1e-9,
    "twelve seconds of frames is twelve seconds of simulation",
  );
});

test("the read the HUD draws is the read the step computed", () => {
  const runtime = createMissionRuntime({ instance: neverEnding(), seed: 0xab });
  runFor(runtime, 3);
  const view = missionPresentation(runtime);
  assert.equal(view.dawn, runtime.dawn, "one value, not a second derivation");
  assert.equal(
    view.dawn.elapsedS,
    view.elapsedS,
    "and it describes the same instant the rest of the projection does",
  );
  assert.equal(view.dawn.elapsedS, runtime.ticks * FIELD_DT);
});

// ---- what the player is told ----------------------------------------------

test("the words on the HUD track the mechanic underneath them", () => {
  assert.match(shadowLabel(dawnRead(0, BUDGET)), /holds/i);
  assert.match(shadowLabel(dawnRead(BUDGET + DAWN.overrunSpanS, BUDGET)), /no dark/i);
  // Mid-run it must say something in between, or the readout is a two-state light
  // dressed up as a gauge.
  const midway = shadowLabel(dawnRead(BUDGET, BUDGET));
  assert.notEqual(midway, shadowLabel(dawnRead(0, BUDGET)));
  assert.notEqual(midway, shadowLabel(dawnRead(BUDGET * 3, BUDGET)));

  assert.match(crowdLabel(12), /thick/i);
  assert.match(crowdLabel(STEALTH_TUNING.crowdBlendMinDensity - 1), /gone/i);
});

test("the sky the HUD band paints is the sky the stage paints", () => {
  const early = dawnSky(0);
  const late = dawnSky(1);
  assert.match(early.sky, /^#[0-9a-f]{6}$/);
  assert.ok(early.fogDensity > late.fogDensity, "fog burns off as the light comes");
  assert.ok(early.ambient < late.ambient);
  assert.ok(early.sunIntensity < late.sunIntensity);
  // Interpolated rather than stepped, so nothing on screen snaps between stops.
  const mid = dawnSky(0.42);
  assert.notEqual(mid.sky, early.sky);
  assert.notEqual(mid.sky, late.sky);
  assert.ok(mid.ambient > early.ambient && mid.ambient < late.ambient);
});
