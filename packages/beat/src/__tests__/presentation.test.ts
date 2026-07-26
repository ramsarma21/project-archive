// The read. These tests pin the one number a renderer converts into a
// convergence, because if it is wrong the mechanic is unplayable in a way no
// simulation test would notice.

import assert from "node:assert/strict";
import test from "node:test";
import { deriveChart } from "../chart.js";
import { createBeatRun, stepBeat, type BeatRun } from "../machine.js";
import { BEAT_BANDS, beatPresentation } from "../presentation.js";
import {
  APPROACH_TICKS,
  FLUSH_WINDOW_TICKS,
  GLANCING_WINDOW_TICKS,
  TRUE_WINDOW_TICKS,
} from "../tuning.js";
import { m1NailStanceBeat } from "../m1NailStance.js";

const SPEC = m1NailStanceBeat();

function armed(seed: number, at = 0): BeatRun {
  return stepBeat(createBeatRun(SPEC, seed), { tick: at, strike: true, inStance: true })
    .run;
}

test("a mark reaches exactly 1.0 on the tick it is due", () => {
  // The whole read is "strike when these two things touch". If the convergence
  // did not land on the beat tick, every player would be systematically early or
  // late and the tight windows would be unreachable through no fault of theirs.
  const run = armed(7);
  const chart = deriveChart(SPEC.chart, 7);
  for (let index = 1; index < chart.offsets.length; index++) {
    const due = chart.offsets[index]!;
    const view = beatPresentation(run, due);
    const mark = view.marks.find((candidate) => candidate.index === index);
    assert.ok(mark, `beat ${index} was not on screen on the tick it was due`);
    assert.equal(mark!.approach01, 1);
    assert.equal(mark!.ticksAway, 0);
  }
});

test("a mark appears one approach out and travels linearly", () => {
  const run = armed(7);
  const chart = deriveChart(SPEC.chart, 7);
  const due = chart.offsets[1]!;
  const early = beatPresentation(run, due - APPROACH_TICKS).marks.find(
    (mark) => mark.index === 1,
  );
  assert.ok(early, "the first mark was not readable a full approach out");
  assert.equal(early!.approach01, 0);
  const half = beatPresentation(run, due - APPROACH_TICKS / 2).marks.find(
    (mark) => mark.index === 1,
  );
  assert.equal(half!.approach01, 0.5);
  // And not before.
  assert.equal(
    beatPresentation(run, due - APPROACH_TICKS - 1).marks.some((mark) => mark.index === 1),
    false,
  );
});

test("the bands are the windows in the same space the marks move through", () => {
  // A renderer draws the target from these. Deriving them anywhere else would be
  // a second tuning of the hit windows, and the two would drift.
  assert.equal(BEAT_BANDS.flush01, FLUSH_WINDOW_TICKS / APPROACH_TICKS);
  assert.equal(BEAT_BANDS.true01, TRUE_WINDOW_TICKS / APPROACH_TICKS);
  assert.equal(BEAT_BANDS.glancing01, GLANCING_WINDOW_TICKS / APPROACH_TICKS);
  assert.ok(BEAT_BANDS.flush01 < BEAT_BANDS.true01);
  assert.ok(BEAT_BANDS.true01 < BEAT_BANDS.glancing01);
  assert.ok(BEAT_BANDS.glancing01 < 0.25, "the outer band fills a quarter of the lane");
});

test("the whole chart is previewable before the player commits", () => {
  // This is what makes "when do I start" a decision: the rhythm, including where
  // the doubles fall, is laid out in space before a single stroke.
  const run = createBeatRun(SPEC, 7);
  const view = beatPresentation(run, 0);
  assert.equal(view.phase, "STANCE");
  assert.equal(view.marks.length, 0);
  assert.equal(view.preview.length, SPEC.chart.strikes);
  assert.equal(view.preview[0], 0);
  assert.equal(view.preview[view.preview.length - 1], 1);
  for (let index = 1; index < view.preview.length; index++) {
    assert.ok(view.preview[index]! > view.preview[index - 1]!);
  }
  assert.ok(view.spanTicks > 0);
  assert.equal(view.remainingTicks, null);
});

test("the preview is divided into bars, so a long chart reads as a rhythm", () => {
  // Thirteen marks in a row is a queue. The same thirteen in three groups of
  // visibly rising density is the thing the player is being asked to weigh a
  // patrol gap against, and it is the whole reason the chart is built from bars.
  const view = beatPresentation(createBeatRun(SPEC, 7), 0);
  assert.equal(view.downbeats.length, SPEC.chart.phases.length);
  assert.equal(view.downbeats[view.downbeats.length - 1], 1);
  for (const downbeat of view.downbeats) {
    assert.ok(
      view.preview.some((at) => Math.abs(at - downbeat) < 1e-12),
      `the bar line at ${downbeat} does not fall on a stroke`,
    );
  }
  // The marks get closer together bar by bar: the difficulty curve, visible
  // before the player commits rather than discovered while they are playing.
  // Measured as spacing rather than as a headcount, because the first group also
  // carries the opening interval and so is a bar and a half long.
  let previous = Number.POSITIVE_INFINITY;
  view.downbeats.forEach((downbeat, index) => {
    const from = index === 0 ? 0 : view.downbeats[index - 1]!;
    const marks = view.preview.filter(
      (at) => at > from + 1e-12 && at <= downbeat + 1e-12,
    ).length;
    const spacing = ((downbeat - from) * view.spanTicks) / marks;
    assert.ok(
      spacing < previous,
      `bar ${index} is no tighter than the one before it (${spacing}t a stroke against ${previous}t)`,
    );
    previous = spacing;
  });
});

test("the HUD is told which way the player missed, not just how badly", () => {
  // A player told only "glancing" cannot improve. Early and late are the only
  // feedback that makes practice pay.
  const chart = deriveChart(SPEC.chart, 7);
  let run = armed(7);
  const due = chart.offsets[1]!;
  run = stepBeat(run, { tick: due - 6, strike: true, inStance: true }).run;
  const view = beatPresentation(run, due - 6);
  assert.equal(view.lastJudgement, "GLANCING");
  assert.equal(view.lastOffsetTicks, -6);
});

test("the countdown to the resolve is available from the moment of arming", () => {
  const run = armed(7, 100);
  const view = beatPresentation(run, 100);
  assert.ok(view.remainingTicks !== null && view.remainingTicks > 0);
  assert.equal(view.remainingTicks, run.resolveAtTick! - 100);
});

test("the readout says whether anything has been heard yet", () => {
  const chart = deriveChart(SPEC.chart, 7);
  let run = armed(7);
  assert.equal(beatPresentation(run, 0).heard, false, "the opening stroke was heard");
  // A stroke well outside every window: the loudest thing the verb produces.
  run = stepBeat(run, { tick: chart.offsets[1]! - 20, strike: true, inStance: true }).run;
  assert.equal(beatPresentation(run, chart.offsets[1]! - 20).heard, true);
});

test("running quality is a floor, not an optimistic guess", () => {
  // Read mid-chart, a run that has played two of five beats perfectly has not
  // scored 1.0. A HUD showing otherwise would tell the player they were doing
  // better than they were.
  const chart = deriveChart(SPEC.chart, 7);
  let run = armed(7);
  run = stepBeat(run, { tick: chart.offsets[1]!, strike: true, inStance: true }).run;
  const view = beatPresentation(run, chart.offsets[1]!);
  assert.ok(view.quality01 < 1);
  assert.equal(view.struck, 1);
  assert.equal(view.remaining, chart.judgedBeats - 1);
});
