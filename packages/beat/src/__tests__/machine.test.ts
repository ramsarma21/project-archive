// The run, driven tick by tick exactly as a mission would drive it.

import assert from "node:assert/strict";
import test from "node:test";
import { createBeatRun, stepBeat } from "../machine.js";
import { strikeIntensity } from "../noise.js";
import { deriveSchedule } from "../schedule.js";
import { m1NailStanceBeat } from "../m1NailStance.js";
import { perfectPlan, playBeat } from "./harness.js";

const SPEC = m1NailStanceBeat();

test("nothing arms until the player is in the stance", () => {
  // A player passing through the stance radius on the way down has not started
  // the act; being in position and facing the work is what arms it.
  let run = createBeatRun(SPEC, 7);
  for (let tick = 0; tick < 120; tick++) {
    const step = stepBeat(run, { tick, hitCell: null, inStance: false });
    run = step.run;
    assert.equal(step.noise.length, 0);
    assert.equal(step.outcome, null);
  }
  assert.equal(run.phase, "STANCE");
  assert.equal(run.startedTick, null);
});

test("reaching the stance arms the run and it makes no sound doing so", () => {
  const step = stepBeat(createBeatRun(SPEC, 7), { tick: 40, hitCell: null, inStance: true });
  assert.equal(step.run.phase, "ACTIVE");
  assert.equal(step.run.startedTick, 40);
  assert.deepEqual(step.events.map((event) => event.type), ["armed"]);
  assert.equal(step.noise.length, 0);
});

test("the whole commitment is known the moment the run arms", () => {
  const schedule = deriveSchedule(SPEC.reaction, 7);
  const step = stepBeat(createBeatRun(SPEC, 7), { tick: 40, hitCell: null, inStance: true });
  assert.equal(step.run.resolveAtTick, 40 + schedule.spanTicks + SPEC.verb.settleTicks);
});

test("striking every lit flare resolves SILENT and makes no audible sound", () => {
  for (const seed of [3, 19, 77, 501]) {
    const played = playBeat(SPEC, seed, perfectPlan());
    assert.equal(played.outcome.grade, "SILENT", `seed ${seed}`);
    assert.equal(played.outcome.posted, true);
    assert.equal(played.outcome.score.flush, SPEC.reaction.targetCount);
    assert.equal(played.outcome.score.strays, 0);
    for (const event of played.noise) {
      assert.equal(
        event.intensity,
        strikeIntensity("FLUSH", SPEC.verb),
        `seed ${seed} produced a noise louder than a clean strike`,
      );
    }
  }
});

test("a flare left to fade slips, and only after its window closes", () => {
  const seed = 31;
  const played = playBeat(SPEC, seed, { dropped: [2] });
  const slip = played.events.find((event) => event.type === "slipped");
  assert.ok(slip, "the unstruck flare never faded");
  assert.equal(slip!.beatIndex, 2);
  assert.equal(played.outcome.score.slips, 1);
  assert.equal(played.outcome.grade, "RAGGED");
  assert.equal(played.outcome.posted, true, "one lapse does not tear the sheet");
});

test("clicking the wrong cell is a stray and does not consume the live flare", () => {
  // Punishing one fumble twice would make a panicked misclick catastrophic. A
  // wrong-cell click costs noise and a dent in the average; the flare it missed
  // then fades on its own.
  const seed = 55;
  const played = playBeat(SPEC, seed, { wrongCell: [1] });
  assert.equal(played.outcome.score.strays, 1);
  assert.equal(played.outcome.score.slips, 1, "the flare struck-at-wrongly still faded");
  assert.ok(played.outcome.grade !== "SILENT", "a stray was free");
});

test("clicking in the dark gap between flares does nothing", () => {
  // A reaction test is about the flares. A twitchy finger between prompts must
  // not accrue strays, or a nervous player fails for being nervous.
  let run = createBeatRun(SPEC, 4);
  run = stepBeat(run, { tick: 0, hitCell: null, inStance: true }).run;
  // Tick 1 is inside the lead, before any flare has spawned.
  const step = stepBeat(run, { tick: 1, hitCell: 0, inStance: true });
  assert.equal(step.noise.length, 0);
  assert.equal(step.run.records.length, 0);
});

test("every strike, slip and stray makes exactly one noise", () => {
  // The field's suspicion model treats a noise as an impulse, so a caller that
  // repeated an event across ticks would multiply its effect by the frame count.
  const played = playBeat(SPEC, 23, { dropped: [1], wrongCell: [3] });
  const sounded = played.events.filter(
    (event) =>
      event.type === "struck" ||
      event.type === "slipped" ||
      event.type === "strayed",
  );
  assert.equal(played.noise.length, sounded.length);
});

test("leaving the stance abandons the run rather than tearing the sheet", () => {
  const schedule = deriveSchedule(SPEC.reaction, 12);
  const played = playBeat(SPEC, 12, { leaveAt: schedule.targets[1]!.spawnTick + 1 });
  assert.equal(played.outcome.abandoned, true);
  assert.equal(played.outcome.posted, false);
  assert.equal(played.run.phase, "ABANDONED");
  assert.ok(played.events.some((event) => event.type === "abandoned"));
});

test("turning to leave during the follow-through keeps the result earned", () => {
  const schedule = deriveSchedule(SPEC.reaction, 12);
  const played = playBeat(SPEC, 12, { leaveAt: schedule.spanTicks + 1 });
  assert.equal(played.outcome.abandoned, false);
  assert.equal(played.outcome.grade, "SILENT");
});

test("the container can tear the run down at any tick", () => {
  const played = playBeat(SPEC, 12, { abandonAt: 5 });
  assert.equal(played.outcome.abandoned, true);
});

test("stepping a resolved run is a no-op that keeps reporting its outcome", () => {
  const played = playBeat(SPEC, 9, perfectPlan());
  const again = stepBeat(played.run, { tick: 10_000, hitCell: 0, inStance: true });
  assert.equal(again.run, played.run);
  assert.equal(again.noise.length, 0);
  assert.deepEqual(again.outcome, played.outcome);
});

test("the run always terminates, however the player behaves", () => {
  // The mission runtime drives this in a fixed-step loop; a phase with no exit
  // would be a hang rather than a bug you can see.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const schedule = deriveSchedule(SPEC.reaction, seed);
    const idle = playBeat(SPEC, seed, {
      dropped: schedule.targets.map((target) => target.index),
    });
    assert.equal(idle.outcome.score.slips, SPEC.reaction.targetCount);
    assert.equal(idle.outcome.grade, "TORN");
    assert.ok(
      idle.elapsedTicks <= schedule.spanTicks + SPEC.verb.settleTicks,
      `seed ${seed} ran past its own backstop`,
    );
  }
});

test("a flare struck on the last legal tick of its window still connects", () => {
  const seed = 61;
  const played = playBeat(SPEC, seed, { hitOffset: SPEC.reaction.windowTicks });
  assert.equal(played.outcome.score.slips, 0);
  assert.equal(played.outcome.score.flush, SPEC.reaction.targetCount);
});

test("a click one tick past the window misses and the flare has already faded", () => {
  const seed = 61;
  const played = playBeat(SPEC, seed, { hitOffset: SPEC.reaction.windowTicks + 1 });
  // Every click lands in the dark gap after its flare faded, so nothing connects
  // and nothing strays: the flares simply went by.
  assert.equal(played.outcome.score.flush, 0);
  assert.equal(played.outcome.score.slips, SPEC.reaction.targetCount);
  assert.equal(played.outcome.score.strays, 0);
});
