// The run, driven tick by tick exactly as a mission would drive it.

import assert from "node:assert/strict";
import test from "node:test";
import { createBeatRun, stepBeat } from "../machine.js";
import { defineChart, deriveChart, evenly, figure } from "../chart.js";
import { strikeIntensity } from "../noise.js";
import { BAR_TICKS, GLANCING_WINDOW_TICKS, HIT_WINDOW_TICKS } from "../tuning.js";
import { m1NailStanceBeat } from "../m1NailStance.js";
import type { BeatSpec } from "../spec.js";
import { perfectPlan, playBeat, uniformPlan } from "./harness.js";

const SPEC = m1NailStanceBeat();

test("nothing happens until the player decides to start", () => {
  // The beat sits at a fixed spot inside a live stealth field. Arming it is the
  // player's decision, and it is the decision that makes this a stealth beat
  // rather than a cutscene with buttons.
  let run = createBeatRun(SPEC, 7);
  for (let tick = 0; tick < 600; tick++) {
    const step = stepBeat(run, { tick, strike: false, inStance: true });
    run = step.run;
    assert.equal(step.noise.length, 0);
    assert.equal(step.outcome, null);
  }
  assert.equal(run.phase, "STANCE");
  assert.equal(run.startedTick, null);
});

test("a stroke outside the stance does not arm the beat", () => {
  let run = createBeatRun(SPEC, 7);
  const step = stepBeat(run, { tick: 4, strike: true, inStance: false });
  run = step.run;
  assert.equal(run.phase, "STANCE");
  assert.equal(step.events.length, 0);
});

test("the opening stroke starts the chart and cannot be mistimed", () => {
  const run = createBeatRun(SPEC, 7);
  const step = stepBeat(run, { tick: 40, strike: true, inStance: true });
  assert.equal(step.run.phase, "STRIKING");
  assert.equal(step.run.startedTick, 40);
  assert.deepEqual(
    step.events.map((event) => event.type),
    ["armed"],
  );
  // It makes a noise the player hears and the field does not: there was nothing
  // to mistime, so there is nothing to charge for.
  assert.equal(step.noise.length, 1);
  assert.equal(step.noise[0]!.intensity, strikeIntensity("FLUSH", SPEC.verb));
});

test("the whole commitment is known the moment the player starts", () => {
  // This is what lets the HUD show the player how long a chart will take before
  // they spend a patrol gap on it.
  const chart = deriveChart(SPEC.chart, 7);
  const step = stepBeat(createBeatRun(SPEC, 7), {
    tick: 40,
    strike: true,
    inStance: true,
  });
  assert.equal(
    step.run.resolveAtTick,
    40 + chart.spanTicks + HIT_WINDOW_TICKS + SPEC.verb.settleTicks,
  );
});

test("a flawless run resolves SILENT and never emits an audible noise", () => {
  for (const seed of [3, 19, 77, 501]) {
    const played = playBeat(SPEC, seed, perfectPlan(SPEC, seed));
    assert.equal(played.outcome.grade, "SILENT", `seed ${seed}`);
    assert.equal(played.outcome.posted, true);
    assert.equal(played.outcome.score.flush, played.chart.judgedBeats);
    assert.equal(played.outcome.score.strays, 0);
    for (const event of played.noise) {
      assert.equal(
        event.intensity,
        strikeIntensity("FLUSH", SPEC.verb),
        `seed ${seed} produced a noise louder than a centred stroke`,
      );
    }
  }
});

test("every stroke and every slip makes exactly one noise", () => {
  // The field's suspicion model treats a noise as an impulse rather than a rate,
  // so a caller that repeated an event across ticks would multiply its effect by
  // the frame count. This is that contract, checked.
  const seed = 23;
  const chart = deriveChart(SPEC.chart, seed);
  const plan = { offsets: [0, 4, null, 8, 0] as (number | null)[] };
  const played = playBeat(SPEC, seed, plan);
  const strokes = played.events.filter(
    (event) =>
      event.type === "armed" ||
      event.type === "struck" ||
      event.type === "slipped" ||
      event.type === "strayed",
  );
  assert.equal(played.noise.length, strokes.length);
  assert.equal(played.outcome.score.judged, chart.judgedBeats);
});

test("a beat that is never struck slips, and only after its window closes", () => {
  const seed = 31;
  const chart = deriveChart(SPEC.chart, seed);
  const played = playBeat(SPEC, seed, {
    armAt: 0,
    offsets: chart.offsets.slice(1).map((_, index) => (index === 2 ? null : 0)),
  });
  const slip = played.events.find((event) => event.type === "slipped");
  assert.ok(slip, "the unstruck beat never slipped");
  assert.equal(slip!.beatIndex, 3);
  assert.equal(played.outcome.score.slips, 1);
  assert.equal(played.outcome.grade, "RAGGED");
});

test("a swing at nothing costs noise and does not eat the next beat", () => {
  // Stealing the next beat would punish one mistake twice, and it would make a
  // panicked recovery swing catastrophic rather than merely loud.
  const seed = 55;
  const chart = deriveChart(SPEC.chart, seed);
  // Half a pulse after the opening stroke: too late to be it, far too early to
  // be the first beat, and clear of every window whatever the seed drew.
  const strayTick = 10;
  assert.ok(
    Math.abs(strayTick - chart.offsets[1]!) > GLANCING_WINDOW_TICKS,
    "the fixture's stray lands inside the first beat's window",
  );
  const played = playBeat(SPEC, seed, {
    armAt: 0,
    offsets: chart.offsets.slice(1).map(() => 0),
    extraPresses: [strayTick],
  });
  assert.equal(played.outcome.score.strays, 1);
  assert.equal(
    played.outcome.score.flush,
    chart.judgedBeats,
    "the stray consumed a beat that the player then struck perfectly",
  );
  assert.ok(played.outcome.grade !== "SILENT", "mashing was free");
});

test("leaving the stance abandons the run rather than tearing the sheet", () => {
  const seed = 12;
  const chart = deriveChart(SPEC.chart, seed);
  const played = playBeat(SPEC, seed, {
    armAt: 0,
    offsets: chart.offsets.slice(1).map(() => 0),
    leaveAt: chart.offsets[2]! + 1,
  });
  assert.equal(played.outcome.abandoned, true);
  assert.equal(played.outcome.posted, false);
  assert.equal(played.run.phase, "ABANDONED");
  assert.ok(played.events.some((event) => event.type === "abandoned"));
});

test("turning to leave during the follow-through keeps the result earned", () => {
  // The tacks are already in by then. A player who starts moving on the last
  // stroke has done the work, and taking it back would be a rule nobody could
  // guess at.
  const seed = 12;
  const chart = deriveChart(SPEC.chart, seed);
  const played = playBeat(SPEC, seed, {
    armAt: 0,
    offsets: chart.offsets.slice(1).map(() => 0),
    leaveAt: chart.spanTicks + 1,
  });
  assert.equal(played.outcome.abandoned, false);
  assert.equal(played.outcome.grade, "SILENT");
});

test("the container can tear the run down at any tick", () => {
  const played = playBeat(SPEC, 12, {
    armAt: 0,
    offsets: [0, 0, 0, 0, 0],
    abandonAt: 5,
  });
  assert.equal(played.outcome.abandoned, true);
});

test("stepping a resolved run is a no-op that keeps reporting its outcome", () => {
  const seed = 9;
  const played = playBeat(SPEC, seed, perfectPlan(SPEC, seed));
  const again = stepBeat(played.run, { tick: 10_000, strike: true, inStance: true });
  assert.equal(again.run, played.run);
  assert.equal(again.noise.length, 0);
  assert.deepEqual(again.outcome, played.outcome);
});

test("the run always terminates, however the player behaves", () => {
  // The mission runtime drives this inside its own fixed-step loop; a phase with
  // no exit would be a hang rather than a bug you can see.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const chart = deriveChart(SPEC.chart, seed);
    const idle = playBeat(SPEC, seed, {
      armAt: 0,
      offsets: chart.offsets.slice(1).map(() => null),
    });
    assert.equal(idle.outcome.score.slips, chart.judgedBeats);
    assert.equal(idle.outcome.grade, "TORN");
    assert.ok(
      idle.elapsedTicks <= chart.spanTicks + HIT_WINDOW_TICKS + SPEC.verb.settleTicks,
      `seed ${seed} ran past its own backstop`,
    );
  }
});

test("precision is paid back in tempo as well as in silence", () => {
  const seed = 44;
  const early = playBeat(SPEC, seed, uniformPlan(SPEC, seed, 0));
  const late = playBeat(SPEC, seed, uniformPlan(SPEC, seed, GLANCING_WINDOW_TICKS));
  assert.ok(
    early.elapsedTicks < late.elapsedTicks,
    "finishing ahead of the chart took as long as finishing behind it",
  );
});

test("a stroke on the last legal tick of a window still connects", () => {
  const seed = 61;
  const played = playBeat(SPEC, seed, uniformPlan(SPEC, seed, GLANCING_WINDOW_TICKS));
  assert.equal(played.outcome.score.slips, 0);
  assert.equal(played.outcome.score.glancing, played.chart.judgedBeats);
});

test("a stroke one tick past the window is a stray and the beat slips", () => {
  // Played against a chart of nothing but wide gaps, so the late stroke has no
  // neighbouring beat to be generously absorbed by and the two consequences are
  // separable.
  const wide: BeatSpec = {
    ...SPEC,
    id: "test.wide",
    chart: defineChart({
      id: "test.wide.chart",
      barTicks: BAR_TICKS,
      openingCell: "LONG",
      spikeCell: "DOUBLE",
      phases: [{ id: "WIDE", bars: 2, figures: evenly([figure("LONG", "LONG")]) }],
    }),
  };
  const played = playBeat(wide, 3, {
    armAt: 0,
    offsets: [GLANCING_WINDOW_TICKS + 1, 0, 0, 0, 0],
  });
  assert.equal(played.outcome.score.slips, 1);
  assert.equal(played.outcome.score.strays, 1);
});
