import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEAT_MOUNT_CONTRACT,
  beatObjective,
  isTerminalPrecisionFailure,
  m1NailStanceBeat,
  type BeatOutcome,
  type BeatSpec,
} from "@pa/beat";
import {
  FIELD_TICK_HZ,
  STEALTH_TUNING,
  platformFromRect,
  type CollisionWorld,
  type WatcherPose,
} from "@pa/engine-world";
import {
  createMissionRuntime,
  missionPresentation,
  stepMissionRuntime,
  type MissionInputFrame,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import { testInstance, testWorld, tickObjective } from "./missionHarness.js";

// ---------------------------------------------------------------------------
// The precision beat, mounted.
//
// The claim this file exists to check is not "the rhythm code works" — @pa/beat
// has its own tests for that, and they are better ones. It is that the beat is
// wired to the STEALTH FIELD: that a mistimed stroke reaches a watcher's ears
// through the same array a hard landing goes down, that a centred one reaches
// nobody, and that the field never stops running while the chart does.
//
// Everything here is measured through the field's own state rather than by
// inspecting the noise array. An assertion that the container built the right
// list would pass just as happily if nothing was listening to it.
// ---------------------------------------------------------------------------

const IDLE: MissionInputFrame = {
  dtS: 1 / 60,
  moveX: 0,
  moveZ: 0,
  sprintHeld: false,
  crouchHeld: false,
  jumpBuffered: false,
  dashBuffered: false,
  strikeBuffered: false,
  reducedMotion: false,
  flowEnabled: true,
};

/**
 * M1's situation, reduced to the two things that matter: a bough eight metres
 * up, and a constable in the street directly underneath it.
 *
 * The heights are the level's own. `BOUGH` is the crown limb the player works
 * from and the nail face is a tier above it; the constable walks Orange Street
 * at ground level about a third of a metre away in plan, which is what makes
 * this beat happen somewhere a mistake is expensive.
 */
const BOUGH_Y = 8.3;

const SPEC: BeatSpec = m1NailStanceBeat({
  stance: { x: 0, y: BOUGH_Y, z: 0 },
  target: { x: 0, y: 9.45, z: 1 },
});

function boughWorld(): CollisionWorld {
  const ground = testWorld();
  return {
    ...ground,
    platforms: [
      ...ground.platforms,
      platformFromRect("BOUGH", -3, 3, -3, 3, BOUGH_Y, ["bough"]),
    ],
  };
}

/**
 * The constable, underneath and looking along the street.
 *
 * He cannot see the player and it is not a fudge: his eye is about 1.4m up, the
 * player's body is at 8.3m, and the horizontal separation is under half a metre
 * — so the player sits nearly ninety degrees above a cone that is 32 degrees
 * wide and pointed down the road. Every metre of that is M1's own geometry.
 * Which leaves exactly one channel between the beat and this man: his ears.
 */
function constable(calls: { count: number }) {
  return (): readonly WatcherPose[] => {
    calls.count += 1;
    return [
      {
        id: "WATCH.constable",
        position: { x: 0, y: 0, z: 0.6 },
        baseYaw: Math.PI / 2,
        halfAngleRad: (32 * Math.PI) / 180,
        rangeM: 14,
      },
    ];
  };
}

interface Mounted {
  runtime: MissionRuntime;
  outcomes: BeatOutcome[];
  /** Times the field asked the level where its watchers are. One per step. */
  poseCalls: { count: number };
  /** Highest suspicion the constable reached at any point in the run. */
  peak: () => number;
}

function mount(options: { watched?: boolean; seed?: number } = {}): Mounted {
  const outcomes: BeatOutcome[] = [];
  const poseCalls = { count: 0 };
  const runtime = createMissionRuntime({
    instance: testInstance({
      world: boughWorld(),
      spawn: { pos: { x: 0, y: BOUGH_Y, z: 0 }, yaw: SPEC.facingYaw },
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
      beat: { spec: SPEC, onResolved: (outcome) => outcomes.push(outcome) },
      ...(options.watched
        ? {
            watcherIds: ["WATCH.constable"],
            watcherPosesAtTick: constable(poseCalls),
          }
        : {}),
    }),
    seed: options.seed ?? 0xb3a7,
  });
  let peak = 0;
  return {
    runtime,
    outcomes,
    poseCalls,
    peak: () => {
      peak = Math.max(peak, runtime.stealth.watchers[0]?.suspicion ?? 0);
      return peak;
    },
  };
}

function step(runtime: MissionRuntime, frame: Partial<MissionInputFrame> = {}) {
  return stepMissionRuntime(runtime, { ...IDLE, ...frame });
}

/** Ticks the chart is due on, absolute, once the run has been armed. */
function dueTicks(runtime: MissionRuntime): number[] {
  const run = runtime.beat!;
  const started = run.startedTick!;
  return run.chart.offsets.slice(1).map((offset) => started + offset);
}

/**
 * Plays a whole chart, offsetting every judged stroke by `offsetTicks`.
 *
 * `null` presses nothing at all, which is how a chart is dropped. Runs on until
 * the beat resolves so the outcome is the real one and not a snapshot mid-chart.
 */
function playChart(
  mounted: Mounted,
  offsetTicks: number | null,
  options: { strays?: number } = {},
): BeatOutcome {
  const { runtime } = mounted;
  step(runtime, { strikeBuffered: true });
  mounted.peak();
  const due = new Set(
    offsetTicks === null ? [] : dueTicks(runtime).map((at) => at + offsetTicks),
  );
  // Swings at nothing, dropped in well before the first beat is due.
  const strayAt = new Set(
    Array.from({ length: options.strays ?? 0 }, (_, index) => 2 + index * 2).map(
      (at) => runtime.beat!.startedTick! + at,
    ),
  );

  for (let guard = 0; guard < 1200 && !mounted.outcomes.length; guard += 1) {
    const tick = runtime.clock.tick + 1;
    step(runtime, { strikeBuffered: due.has(tick) || strayAt.has(tick) });
    mounted.peak();
  }
  const outcome = mounted.outcomes[0];
  assert.ok(outcome, "the beat never resolved");
  return outcome;
}

// ---- the coupling ----------------------------------------------------------

test("a centred beat is heard by nobody, with the constable underneath", () => {
  // The reward for the hardest thing in the mission, and it is a guarantee
  // rather than a tuning: FLUSH is authored below the field's audibility floor,
  // so a dead-centre stroke is inaudible at ANY distance. Here he is standing
  // directly under the nail.
  const mounted = mount({ watched: true });
  const outcome = playChart(mounted, 0);

  assert.equal(outcome.grade, "SILENT");
  assert.equal(outcome.posted, true);
  assert.ok(
    outcome.loudestIntensity < STEALTH_TUNING.minAudibleNoise,
    `the loudest stroke was ${outcome.loudestIntensity}, and the field hears from ${STEALTH_TUNING.minAudibleNoise}`,
  );
  assert.equal(
    mounted.peak(),
    0,
    "a perfect beat cost the player nothing at all, at any point in the run",
  );
  assert.equal(mounted.runtime.stealth.watchers[0]?.attention, null);
  assert.equal(mounted.runtime.stealth.watchers[0]?.state, "UNAWARE");
});

test("a botched beat is heard, and it points him at the work", () => {
  // The whole design in one test. The noise is an ordinary PLAYER_MOVE event and
  // `noiseImplicatesPlayer` is true for that kind, so it does not merely raise
  // his suspicion — it puts his attention on the tree the player is standing in.
  // It is the exact opposite of a thrown bottle, and it should be.
  const mounted = mount({ watched: true });
  const outcome = playChart(mounted, null, { strays: 4 });

  assert.ok(outcome.loudestIntensity >= STEALTH_TUNING.minAudibleNoise);
  assert.ok(
    mounted.peak() >= STEALTH_TUNING.thresholds.curious,
    `the strokes went into the same array a hard landing goes into and he barely noticed: peak ${mounted.peak().toFixed(2)}`,
  );
  const constable = mounted.runtime.stealth.watchers[0];
  assert.ok(constable?.attention, "he never looked up");
  assert.ok(
    Math.hypot(
      constable.attention.x - SPEC.target.x,
      constable.attention.z - SPEC.target.z,
    ) < 0.01,
    "his attention is on the work, not somewhere else",
  );
  assert.notEqual(constable.state, "UNAWARE", "and he is on his way over");
});

test("noise alone can never complete a detection", () => {
  // The ceiling, and it is why a botched beat is a change of situation rather
  // than an ending: it brings a watcher over and turns his cone onto the tree.
  // His eyes do the rest, or they do not — and from the street they cannot.
  const mounted = mount({ watched: true });
  playChart(mounted, null, { strays: 6 });
  assert.ok(
    mounted.peak() <= STEALTH_TUNING.noiseSuspicionCeiling + 1e-9,
    `noise built ${mounted.peak().toFixed(2)} against a ${STEALTH_TUNING.noiseSuspicionCeiling} ceiling`,
  );
  assert.equal(mounted.runtime.detections, 0);
});

test("the stealth field keeps stepping while the chart runs", () => {
  // A beat with detection suspended is a rhythm minigame; a beat inside a live
  // field is a stealth mechanic. Counted at the seam that would actually break:
  // the field asks the level where its watchers are exactly once per fixed step,
  // so a suspended field is a step that never asked.
  const mounted = mount({ watched: true });
  const posesBefore = mounted.poseCalls.count;
  const ticksBefore = mounted.runtime.ticks;
  playChart(mounted, 0);
  const elapsed = mounted.runtime.ticks - ticksBefore;
  assert.ok(elapsed > FIELD_TICK_HZ, "the chart should take more than a second");
  assert.equal(
    mounted.poseCalls.count - posesBefore,
    elapsed,
    "the field stepped once per fixed step of the beat, with none skipped",
  );
});

// ---- the input -------------------------------------------------------------

test("a strike is delivered to exactly one tick of a long frame", () => {
  // A frame that spans four fixed steps with one press latched. Delivered to all
  // four, it would read as one stroke and three swings at nothing.
  const mounted = mount();
  const result = step(mounted.runtime, { dtS: 4 / 60, strikeBuffered: true });
  assert.equal(result.steps, 4);
  assert.equal(result.strikeConsumed, true);
  assert.equal(mounted.runtime.beat?.phase, "STRIKING");
  assert.equal(
    mounted.runtime.beat?.records.length,
    0,
    "the opening stroke armed the chart and nothing else was pressed",
  );
});

test("a held strike key cannot mash the chart", () => {
  // The same press latched on every frame, which is what a key handler without
  // an edge trigger would deliver. Every one of these lands on no beat.
  const mounted = mount();
  step(mounted.runtime, { strikeBuffered: true });
  for (let index = 0; index < 12; index += 1) {
    step(mounted.runtime, { strikeBuffered: true });
  }
  const strays = mounted.runtime.beat!.records.filter(
    (record) => record.judgement === "STRAY",
  );
  assert.equal(
    strays.length,
    12,
    "each of the twelve presses cost a stray, which is exactly why the latch is edge triggered",
  );
});

test("a dash press reaches the flow controller", () => {
  // `beginDash` had no caller on the mission side at all: the field was optional
  // on FlowInput, so passing nothing compiled and behaved, and the verb existed
  // for a player who could not use it.
  const mounted = mount();
  const dashed = step(mounted.runtime, { dashBuffered: true, moveZ: 1 });
  assert.equal(dashed.dashConsumed, true);
  assert.equal(mounted.runtime.motion.phase, "DASH");
  assert.equal(mounted.runtime.flow.verb, "DASH");
});

// ---- leaving and coming back -----------------------------------------------

test("walking off mid-chart abandons the run and is not a failure", () => {
  const mounted = mount();
  step(mounted.runtime, { strikeBuffered: true });
  for (let index = 0; index < 10; index += 1) step(mounted.runtime);

  // Out of the stance, which is the only way to leave a beat.
  mounted.runtime.motion = {
    ...mounted.runtime.motion,
    pos: { x: 20, y: BOUGH_Y, z: 0 },
  };
  step(mounted.runtime);

  assert.equal(mounted.runtime.beat?.phase, "ABANDONED");
  const outcome = mounted.outcomes[0];
  assert.ok(outcome);
  assert.equal(outcome.abandoned, true);
  assert.equal(
    isTerminalPrecisionFailure(outcome),
    false,
    "the player has not done the work yet; that is not the same as having failed it",
  );
  assert.equal(
    mounted.runtime.beatOutcome,
    null,
    "and nothing is latched that would stop them coming back to it",
  );
});

test("coming back re-arms the same chart, never a fresh roll", () => {
  // A chart re-seeded on re-entry could be fished for: leave and come back until
  // an easy one turns up, and the skill expression is gone.
  const mounted = mount();
  const first = mounted.runtime.beat!.chart.offsets.join(",");
  step(mounted.runtime, { strikeBuffered: true });
  mounted.runtime.motion = {
    ...mounted.runtime.motion,
    pos: { x: 20, y: BOUGH_Y, z: 0 },
  };
  step(mounted.runtime);
  assert.equal(mounted.runtime.beat?.phase, "ABANDONED");

  mounted.runtime.motion = {
    ...mounted.runtime.motion,
    pos: { x: 0, y: BOUGH_Y, z: 0 },
  };
  step(mounted.runtime);
  assert.equal(mounted.runtime.beat?.phase, "STANCE");
  assert.equal(mounted.runtime.beat!.chart.offsets.join(","), first);
});

test("two attempts on the same mission draw different charts", () => {
  const chartFor = (seed: number) =>
    createMissionRuntime({
      instance: testInstance({
        world: boughWorld(),
        objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
        beat: { spec: SPEC },
      }),
      seed,
    }).beat!.chart.offsets.join(",");
  const charts = new Set([chartFor(1), chartFor(2), chartFor(3), chartFor(4)]);
  assert.ok(charts.size > 1, "a retry that is the same chart is a memory test");
});

// ---- the objective ---------------------------------------------------------

test("arriving at the work no longer completes it", () => {
  // The one-line difference between the mission M1 shipped and the one it ships
  // now. `beatObjective` reads the run's outcome; the proximity test it replaced
  // was satisfied by standing here.
  const state: { outcome: BeatOutcome | null } = { outcome: null };
  const objective = beatObjective({
    id: "post-the-handbill",
    label: "Nail the handbill",
    spec: SPEC,
    posted: () => state.outcome?.posted === true,
  });

  const mounted = mount();
  const stance = { pos: SPEC.stance, yaw: SPEC.facingYaw };
  assert.equal(objective.satisfiedBy(stance), false);

  state.outcome = playChart(mounted, 0);
  assert.equal(objective.satisfiedBy(stance), true);
  assert.equal(
    objective.satisfiedBy({ pos: { x: 40, y: 0, z: 0 }, yaw: SPEC.facingYaw }),
    false,
    "the work is done, but this objective is also a place",
  );
});

test("a torn sheet is a terminal failure the level can act on", () => {
  const mounted = mount();
  const outcome = playChart(mounted, null, { strays: 3 });
  assert.equal(outcome.grade, "TORN");
  assert.equal(outcome.posted, false);
  assert.equal(isTerminalPrecisionFailure(outcome), true);
});

test("the run's result reaches the presentation the HUD reads", () => {
  const mounted = mount();
  const before = missionPresentation(mounted.runtime);
  assert.ok(before.beat, "the marks are laid out before the player commits");
  assert.equal(before.beat.phase, "STANCE");
  assert.equal(before.inBeatStance, true);
  assert.equal(before.beat.preview.length, SPEC.chart.strikes);

  playChart(mounted, 0);
  const after = missionPresentation(mounted.runtime);
  assert.equal(after.beat?.phase, "RESOLVED");
  assert.equal(after.beat?.grade, "SILENT");
  assert.equal(after.beat?.heard, false);
});

test("a level with no beat runs exactly as it did", () => {
  const runtime = createMissionRuntime({
    instance: testInstance({
      objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
    }),
    seed: 5,
  });
  for (let index = 0; index < 30; index += 1) step(runtime, { strikeBuffered: true });
  assert.equal(runtime.beat, null);
  assert.equal(missionPresentation(runtime).beat, null);
  assert.equal(missionPresentation(runtime).inBeatStance, false);
  assert.equal(runtime.outcome, null);
});

test("the container has done everything the mount contract asks of it", () => {
  // The contract ships as data so it can be diffed rather than re-read. These
  // are the lines this file is the evidence for; the level's own are checked in
  // m1Mission.test.ts.
  const runtimeLines = BEAT_MOUNT_CONTRACT.filter((line) =>
    line.startsWith("the mission runtime:"),
  );
  assert.equal(runtimeLines.length, 4, "the runtime's half of the contract moved");
});
