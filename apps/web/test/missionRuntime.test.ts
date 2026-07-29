import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_DT, FIELD_TICK_HZ, MAX_CATCHUP_STEPS } from "@pa/engine-world";
import {
  createMissionRuntime,
  disposeMissionRuntime,
  missionPresentation,
  stepMissionRuntime,
  type MissionInputFrame,
  type MissionRuntime,
} from "../src/mission/traversal.js";
import { missionInstanceDefects } from "../src/mission/levelPort.js";
import { missionDefinitionDefects } from "../src/mission/missionFormat.js";
import { smokeMissionDefinition } from "../src/mission/smokeMission.js";
import { testInstance, tickObjective } from "./missionHarness.js";

// The runtime's contract: one clock, one seed, identical simulation at any frame
// rate, and a terminal state it cannot be stepped past.

const SPRINT_FORWARD: MissionInputFrame = {
  dtS: 1 / 60,
  moveX: 0,
  moveZ: 1,
  sprintHeld: true,
  crouchHeld: false,
  jumpBuffered: false,
  reducedMotion: false,
  flowEnabled: true,
};

function frame(overrides: Partial<MissionInputFrame> = {}): MissionInputFrame {
  return { ...SPRINT_FORWARD, ...overrides };
}

function runFor(runtime: MissionRuntime, seconds: number, fps: number): void {
  const dtS = 1 / fps;
  for (let step = 0; step < Math.round(seconds * fps); step += 1) {
    stepMissionRuntime(runtime, frame({ dtS }));
  }
}

test("the same run is the same run at 30, 60 and 120 frames a second", () => {
  const seconds = 2;
  const runs = [30, 60, 120].map((fps) => {
    const runtime = createMissionRuntime({
      instance: testInstance(),
      seed: 0xc0ffee,
    });
    runFor(runtime, seconds, fps);
    return runtime;
  });

  const [at30, at60, at120] = runs;
  assert.ok(at30 && at60 && at120);
  assert.equal(at30.ticks, seconds * FIELD_TICK_HZ);
  assert.equal(at60.ticks, at30.ticks);
  assert.equal(at120.ticks, at30.ticks);
  assert.deepEqual(at60.motion.pos, at30.motion.pos);
  assert.deepEqual(at120.motion.pos, at30.motion.pos);
  assert.equal(at30.droppedSteps, 0, "no frame rate in that range drops a step");
});

test("a long frame is bounded rather than queued", () => {
  const runtime = createMissionRuntime({ instance: testInstance(), seed: 7 });
  // A backgrounded tab resuming. The frame-delta clamp discards the multi-second
  // gap BEFORE the accumulator, so it injects at most the clamp's worth of steps
  // (MAX_CATCHUP_STEPS) and no burst. The catch-up bound now covers that clamp, so
  // no step is DISCARDED here: the clamp bounds the time, not the step cap. (A
  // discard now requires a frame heavier than the 0.25s clamp itself admits, which
  // a single wake cannot produce — the very thing that stopped the mission running
  // in slow motion under heavy frames.)
  stepMissionRuntime(runtime, frame({ dtS: 30 }));
  assert.equal(runtime.ticks, MAX_CATCHUP_STEPS);
  assert.equal(runtime.droppedSteps, 0, "the clamp bounds the gap; no sim time is discarded");
});

test("reaching every required objective ends the floor and arms the duel", () => {
  const runtime = createMissionRuntime({
    instance: testInstance({
      objectives: [
        tickObjective("reach-shambles", 30),
        tickObjective("reach-post", 90),
        tickObjective("stay-unseen", 1_000_000, false),
      ],
    }),
    seed: 11,
  });

  runFor(runtime, 1, 60);
  assert.equal(runtime.outcome, null, "one required objective is not the route");

  runFor(runtime, 1, 60);
  const outcome = runtime.outcome;
  assert.ok(outcome);
  assert.equal(outcome.kind, "REACHED_DUEL");
  assert.deepEqual(outcome.objectiveIds, ["reach-shambles", "reach-post"]);
  assert.ok(
    Math.abs(outcome.simulatedS - 90 * FIELD_DT) < FIELD_DT * 2,
    "and it ends on the tick the last one was met",
  );
  assert.equal(outcome.droppedSteps, 0, "and reports whether the clock kept up");
});

test("an objective once met stays met", () => {
  let met = false;
  const runtime = createMissionRuntime({
    instance: testInstance({
      objectives: [
        {
          id: "cross-the-volume",
          label: "Cross the volume",
          required: true,
          // True for exactly one tick, the way a terminal volume behaves when the
          // player runs straight through it.
          satisfiedBy: (read) => {
            const now = read.tick === 20;
            met = met || now;
            return now;
          },
        },
        tickObjective("later", 60),
      ],
    }),
    seed: 3,
  });

  runFor(runtime, 1.5, 60);
  assert.ok(met);
  const outcome = runtime.outcome;
  assert.ok(outcome);
  assert.equal(outcome.kind, "REACHED_DUEL");
  assert.deepEqual(outcome.objectiveIds, ["cross-the-volume", "later"]);
});

test("the level's authored fail boundary ends the attempt on the floor", () => {
  const runtime = createMissionRuntime({
    instance: testInstance({
      objectives: [tickObjective("reach-post", 600)],
      failWhen: (read) =>
        read.tick < 45
          ? null
          : {
              code: "DETECTED",
              cueId: "BOS.MD01.CUE.FAIL_DETECTED.v1",
              headline: "The constable has closed the route to the post.",
              detail: "Confrontation filled the final court before the job began.",
            },
    }),
    seed: 5,
  });

  runFor(runtime, 1, 60);
  const outcome = runtime.outcome;
  assert.ok(outcome);
  assert.equal(outcome.kind, "FAILED");
  assert.equal(
    outcome.kind === "FAILED" && outcome.failure.cueId,
    "BOS.MD01.CUE.FAIL_DETECTED.v1",
  );
});

test("traversal is untimed unless the level asks for a timer", () => {
  const untimed = createMissionRuntime({
    instance: testInstance({ objectives: [tickObjective("never", 1_000_000)] }),
    seed: 9,
  });
  runFor(untimed, 6, 60);
  assert.equal(
    untimed.outcome,
    null,
    "running past the pacing budget costs nothing by itself",
  );

  const timed = createMissionRuntime({
    instance: testInstance({
      objectives: [tickObjective("never", 1_000_000)],
      traversalTimeoutS: 2,
    }),
    seed: 9,
  });
  runFor(timed, 3, 60);
  assert.equal(timed.outcome?.kind, "FAILED");
});

test("a resolved run cannot be stepped past its own ending", () => {
  const runtime = createMissionRuntime({
    instance: testInstance({ objectives: [tickObjective("reach-post", 10)] }),
    seed: 13,
  });
  runFor(runtime, 0.5, 60);
  assert.ok(runtime.outcome);

  const ticksAtEnd = runtime.ticks;
  const posAtEnd = { ...runtime.motion.pos };
  const step = stepMissionRuntime(runtime, frame());
  assert.equal(step.steps, 0);
  assert.equal(runtime.ticks, ticksAtEnd);
  assert.deepEqual(runtime.motion.pos, posAtEnd);
});

test("a buffered jump is consumed once, not once per fixed step", () => {
  const runtime = createMissionRuntime({ instance: testInstance(), seed: 17 });
  // Two fixed steps' worth of time in one frame, with one press latched.
  const step = stepMissionRuntime(runtime, frame({ dtS: 2 / 60, jumpBuffered: true }));
  assert.equal(step.steps, 2);
  assert.equal(step.jumpConsumed, true);
});

test("the presentation reports the clock, the objectives and the budget", () => {
  const runtime = createMissionRuntime({
    instance: testInstance({
      objectives: [tickObjective("reach-post", 30), tickObjective("optional", 5, false)],
    }),
    seed: 19,
  });
  runFor(runtime, 0.25, 60);

  const view = missionPresentation(runtime);
  assert.equal(view.budgetS, 180);
  assert.ok(Math.abs(view.elapsedS - 15 * FIELD_DT) < 1e-9);
  assert.equal(view.timeScale, 1, "reflex time is closed with no watchers");
  assert.deepEqual(
    view.objectives.map((objective) => [objective.id, objective.met]),
    [
      ["reach-post", false],
      ["optional", true],
    ],
  );
  assert.equal(view.stealth.squadState, "UNAWARE");
});

test("the event ring and the latch list are released on teardown", () => {
  const runtime = createMissionRuntime({ instance: testInstance(), seed: 23 });
  runFor(runtime, 0.5, 60);
  runtime.recentEvents.push({ tick: 1, kind: "DETECTED", detail: "x" });
  runtime.satisfied.push("something");

  disposeMissionRuntime(runtime);
  assert.equal(runtime.recentEvents.length, 0);
  assert.equal(runtime.satisfied.length, 0);
});

test("the fixture the level port documents actually satisfies it", async () => {
  const definition = smokeMissionDefinition("m1");
  assert.deepEqual(missionDefinitionDefects(definition), []);

  const instance = await definition.load({
    missionId: "m1",
    chapterId: "boston-1765",
    attemptOrdinal: 1,
    seed: 0xbeef,
    seedHex: "0".repeat(32),
    attemptId: "attempt-1",
    signal: new AbortController().signal,
  });
  assert.deepEqual(missionInstanceDefects(instance), []);

  // And it runs: three seconds of held sprint moves the player down the corridor
  // and over the first crate rather than standing still against it.
  const runtime = createMissionRuntime({ instance, seed: 0xbeef });
  runFor(runtime, 4, 60);
  assert.equal(runtime.ticks, 4 * FIELD_TICK_HZ);
  assert.ok(
    runtime.motion.pos.z > 8,
    `sprinting north for four seconds should cover ground, reached z=${runtime.motion.pos.z.toFixed(2)}`,
  );
  assert.equal(runtime.outcome, null, "and the far end is further than that");
});

test("the runtime never accumulates an unbounded event log", () => {
  const runtime = createMissionRuntime({ instance: testInstance(), seed: 29 });
  for (let index = 0; index < 500; index += 1) {
    runtime.recentEvents.push({ tick: index, kind: "DETECTED", detail: "x" });
    if (runtime.recentEvents.length > 48) runtime.recentEvents.shift();
  }
  assert.ok(
    runtime.recentEvents.length <= 48,
    "a three-minute run is 10,800 ticks and the log has to be a ring",
  );
});
