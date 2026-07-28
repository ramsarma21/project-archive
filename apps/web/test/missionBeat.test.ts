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
// The claim this file exists to check is not "the reaction code works" — @pa/beat
// has its own tests for that. It is that the beat is wired to the STEALTH FIELD:
// that a fumbled flare reaches a watcher's ears through the same array a hard
// landing goes down, that a clean act reaches nobody, and that the field never
// stops running while the panel is being played.
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
  hitCellBuffered: null,
  reducedMotion: false,
  flowEnabled: true,
};

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

/** The constable, underneath and looking along the street. */
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
  poseCalls: { count: number };
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

/** The lit cell right now, or null. Read off the runtime's own projection. */
function liveCell(runtime: MissionRuntime): number | null {
  return runtime.beatView?.activeCell ?? null;
}

interface ReactionPlan {
  /** Flare indices to let fade (a miss). */
  readonly dropped?: readonly number[];
  /** Flare indices to click on the WRONG cell (a stray, then a miss). */
  readonly wrong?: readonly number[];
}

/**
 * Plays the whole act reactively: whenever a flare is lit, click its cell (or the
 * wrong one, or nothing, per the plan) on the next tick. Runs until the beat
 * resolves so the outcome is the real one.
 */
function playReaction(mounted: Mounted, plan: ReactionPlan = {}): BeatOutcome {
  const { runtime } = mounted;
  const dropped = new Set(plan.dropped ?? []);
  const wrong = new Set(plan.wrong ?? []);
  const clicked = new Set<number>();
  const cellCount = runtime.beat!.spec.reaction.cellCount;

  for (let guard = 0; guard < 3000 && mounted.outcomes.length === 0; guard += 1) {
    const run = runtime.beat!;
    let hit: number | null = null;
    if (run.startedTick !== null && (run.phase === "ACTIVE" || run.phase === "SETTLING")) {
      const offset = runtime.clock.tick - run.startedTick;
      const live = run.schedule.targets.find(
        (target) =>
          !run.resolved[target.index] &&
          offset >= target.spawnTick &&
          offset <= target.expireTick,
      );
      if (live && !clicked.has(live.index) && !dropped.has(live.index)) {
        hit = wrong.has(live.index) ? (live.cell + 1) % cellCount : live.cell;
        clicked.add(live.index);
      }
    }
    step(runtime, { hitCellBuffered: hit });
    mounted.peak();
  }
  const outcome = mounted.outcomes[0];
  assert.ok(outcome, "the beat never resolved");
  return outcome;
}

// ---- the coupling ----------------------------------------------------------

test("a clean act is heard by nobody, with the constable underneath", () => {
  const mounted = mount({ watched: true });
  const outcome = playReaction(mounted);

  assert.equal(outcome.grade, "SILENT");
  assert.equal(outcome.posted, true);
  assert.ok(
    outcome.loudestIntensity < STEALTH_TUNING.minAudibleNoise,
    `the loudest strike was ${outcome.loudestIntensity}, and the field hears from ${STEALTH_TUNING.minAudibleNoise}`,
  );
  assert.equal(mounted.peak(), 0, "a clean act cost the player nothing at any point");
  assert.equal(mounted.runtime.stealth.watchers[0]?.attention, null);
  assert.equal(mounted.runtime.stealth.watchers[0]?.state, "UNAWARE");
});

test("a botched act is heard, and it points him at the work", () => {
  const mounted = mount({ watched: true });
  const many = Array.from({ length: SPEC.reaction.targetCount }, (_, index) => index);
  const outcome = playReaction(mounted, { dropped: many });

  assert.ok(outcome.loudestIntensity >= STEALTH_TUNING.minAudibleNoise);
  assert.ok(
    mounted.peak() >= STEALTH_TUNING.thresholds.curious,
    `the fumbles went into the same array a hard landing goes into and he barely noticed: peak ${mounted.peak().toFixed(2)}`,
  );
  const officer = mounted.runtime.stealth.watchers[0];
  assert.ok(officer?.attention, "he never looked up");
  assert.ok(
    Math.hypot(
      officer.attention.x - SPEC.target.x,
      officer.attention.z - SPEC.target.z,
    ) < 0.01,
    "his attention is on the work, not somewhere else",
  );
  assert.notEqual(officer.state, "UNAWARE", "and he is on his way over");
});

test("noise alone can never complete a detection", () => {
  const mounted = mount({ watched: true });
  const many = Array.from({ length: SPEC.reaction.targetCount }, (_, index) => index);
  playReaction(mounted, { dropped: many, wrong: [] });
  assert.ok(
    mounted.peak() <= STEALTH_TUNING.noiseSuspicionCeiling + 1e-9,
    `noise built ${mounted.peak().toFixed(2)} against a ${STEALTH_TUNING.noiseSuspicionCeiling} ceiling`,
  );
  assert.equal(mounted.runtime.detections, 0);
});

test("the stealth field keeps stepping while the act runs", () => {
  const mounted = mount({ watched: true });
  const posesBefore = mounted.poseCalls.count;
  const ticksBefore = mounted.runtime.ticks;
  playReaction(mounted);
  const elapsed = mounted.runtime.ticks - ticksBefore;
  assert.ok(elapsed > FIELD_TICK_HZ, "the act should take more than a second");
  assert.equal(
    mounted.poseCalls.count - posesBefore,
    elapsed,
    "the field stepped once per fixed step of the beat, with none skipped",
  );
});

// ---- the input -------------------------------------------------------------

test("a strike is delivered to exactly one tick of a long frame", () => {
  const mounted = mount();
  // Advance to the first lit flare.
  for (let guard = 0; guard < 600 && liveCell(mounted.runtime) === null; guard += 1) {
    step(mounted.runtime);
  }
  const cell = liveCell(mounted.runtime);
  assert.notEqual(cell, null, "no flare ever lit");
  const before = mounted.runtime.beat!.records.length;
  // A four-tick frame carrying one struck cell must land exactly one strike.
  const result = step(mounted.runtime, { dtS: 4 / 60, hitCellBuffered: cell });
  assert.equal(result.steps, 4);
  assert.equal(result.hitConsumed, true);
  assert.equal(
    mounted.runtime.beat!.records.length - before,
    1,
    "one click across a long frame struck once, not once per fixed step",
  );
});

test("holding a click on the lit flare does not mash, and does not fail the player", () => {
  // A key held down, or the same cell delivered every frame. It strikes the flare
  // once; every later delivery lands on a cell that is no longer lit and is
  // harmlessly ignored, because a reaction test is about the flares, not about
  // holding still between them.
  const mounted = mount();
  for (let guard = 0; guard < 600 && liveCell(mounted.runtime) === null; guard += 1) {
    step(mounted.runtime);
  }
  const cell = liveCell(mounted.runtime)!;
  for (let index = 0; index < 12; index += 1) {
    step(mounted.runtime, { hitCellBuffered: cell });
  }
  const records = mounted.runtime.beat!.records;
  assert.equal(records.filter((r) => r.judgement === "FLUSH").length, 1, "one hit");
  assert.equal(records.filter((r) => r.judgement === "STRAY").length, 0, "no strays");
});

test("a dash press reaches the flow controller", () => {
  const mounted = mount();
  const dashed = step(mounted.runtime, { dashBuffered: true, moveZ: 1 });
  assert.equal(dashed.dashConsumed, true);
  assert.equal(mounted.runtime.motion.phase, "DASH");
  assert.equal(mounted.runtime.flow.verb, "DASH");
});

// ---- leaving and coming back -----------------------------------------------

test("walking off mid-act abandons the run and is not a failure", () => {
  const mounted = mount();
  // Arm and let the act run a moment.
  for (let index = 0; index < 40; index += 1) step(mounted.runtime);
  assert.equal(mounted.runtime.beat?.phase, "ACTIVE");

  mounted.runtime.motion = {
    ...mounted.runtime.motion,
    pos: { x: 20, y: BOUGH_Y, z: 0 },
  };
  step(mounted.runtime);

  assert.equal(mounted.runtime.beat?.phase, "ABANDONED");
  const outcome = mounted.outcomes[0];
  assert.ok(outcome);
  assert.equal(outcome.abandoned, true);
  assert.equal(isTerminalPrecisionFailure(outcome), false);
  assert.equal(mounted.runtime.beatOutcome, null);
});

test("coming back re-arms the same schedule, never a fresh roll", () => {
  const mounted = mount();
  const first = mounted.runtime.beat!.schedule.targets
    .map((t) => `${t.cell}@${t.spawnTick}`)
    .join(",");
  for (let index = 0; index < 20; index += 1) step(mounted.runtime);
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
  const again = mounted.runtime.beat!.schedule.targets
    .map((t) => `${t.cell}@${t.spawnTick}`)
    .join(",");
  assert.equal(again, first);
});

test("two attempts on the same mission draw different schedules", () => {
  const scheduleFor = (seed: number) =>
    createMissionRuntime({
      instance: testInstance({
        world: boughWorld(),
        objectives: [tickObjective("never", Number.MAX_SAFE_INTEGER)],
        beat: { spec: SPEC },
      }),
      seed,
    })
      .beat!.schedule.targets.map((t) => t.cell)
      .join(",");
  const schedules = new Set([
    scheduleFor(1),
    scheduleFor(2),
    scheduleFor(3),
    scheduleFor(4),
  ]);
  assert.ok(schedules.size > 1, "a retry that is the same schedule is a memory test");
});

// ---- the objective ---------------------------------------------------------

test("arriving at the work no longer completes it", () => {
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

  state.outcome = playReaction(mounted);
  assert.equal(objective.satisfiedBy(stance), true);
  assert.equal(
    objective.satisfiedBy({ pos: { x: 40, y: 0, z: 0 }, yaw: SPEC.facingYaw }),
    false,
    "the work is done, but this objective is also a place",
  );
});

test("a torn sheet is a terminal failure the level can act on", () => {
  const mounted = mount();
  const many = Array.from({ length: SPEC.reaction.targetCount }, (_, index) => index);
  const outcome = playReaction(mounted, { dropped: many });
  assert.equal(outcome.grade, "TORN");
  assert.equal(outcome.posted, false);
  assert.equal(isTerminalPrecisionFailure(outcome), true);
});

test("the run's result reaches the presentation the HUD reads", () => {
  const mounted = mount();
  const before = missionPresentation(mounted.runtime);
  assert.ok(before.beat, "the panel is present before the player commits");
  assert.equal(before.inBeatStance, true);
  assert.equal(before.beat.total, SPEC.reaction.targetCount);
  assert.equal(before.beat.cells.length, SPEC.reaction.cellCount);

  playReaction(mounted);
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
  for (let index = 0; index < 30; index += 1) step(runtime, { hitCellBuffered: 0 });
  assert.equal(runtime.beat, null);
  assert.equal(missionPresentation(runtime).beat, null);
  assert.equal(missionPresentation(runtime).inBeatStance, false);
  assert.equal(runtime.outcome, null);
});

test("the container has done everything the mount contract asks of it", () => {
  const runtimeLines = BEAT_MOUNT_CONTRACT.filter((line) =>
    line.startsWith("the mission runtime:"),
  );
  assert.equal(runtimeLines.length, 4, "the runtime's half of the contract moved");
});
