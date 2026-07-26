// The skill ceiling, as a measurement rather than an intention.
//
// The owner's standard is that only genuinely gifted players clear things first
// try, and that getting better is possible and worth doing. Those are two
// separate claims and they are tested separately: that the top of the ladder is
// hard to reach, and that every rung below it is strictly better than the rung
// under it — in the sheet AND in how much attention it costs.

import assert from "node:assert/strict";
import test from "node:test";
import { STEALTH_TUNING } from "../engine.js";
import { CELL_TICKS, deriveChart } from "../chart.js";
import {
  FLUSH_WINDOW_TICKS,
  GLANCING_WINDOW_TICKS,
  TRUE_WINDOW_TICKS,
} from "../tuning.js";
import { m1NailStanceBeat } from "../m1NailStance.js";
import { playBeat, uniformPlan } from "./harness.js";
import type { BeatGrade } from "../judge.js";

const SPEC = m1NailStanceBeat();
const SEEDS = [3, 17, 88, 404, 2025];
const GRADE_ORDER: Record<BeatGrade, number> = {
  TORN: 0,
  RAGGED: 1,
  CLEAN: 2,
  SILENT: 3,
};

/** Total audibility a run would deliver to a listener standing at the tree. */
function attentionCost(seed: number, offsetTicks: number): number {
  const played = playBeat(SPEC, seed, uniformPlan(SPEC, seed, offsetTicks));
  let total = 0;
  for (const event of played.noise) {
    if (event.intensity < STEALTH_TUNING.minAudibleNoise) continue;
    total += STEALTH_TUNING.noiseSuspicionImpulse[event.kind] * event.intensity;
  }
  return total;
}

test("getting better is strictly worth it, on the sheet and in attention", () => {
  for (const seed of SEEDS) {
    let previousGrade = -1;
    let previousCost = Number.POSITIVE_INFINITY;
    // Worst to best, so both curves should be monotonic in the same direction.
    for (const offset of [GLANCING_WINDOW_TICKS, TRUE_WINDOW_TICKS, FLUSH_WINDOW_TICKS, 0]) {
      const played = playBeat(SPEC, seed, uniformPlan(SPEC, seed, offset));
      const grade = GRADE_ORDER[played.outcome.grade];
      assert.ok(
        grade >= previousGrade,
        `seed ${seed}: tightening to ${offset} ticks made the grade worse`,
      );
      const cost = attentionCost(seed, offset);
      assert.ok(
        cost <= previousCost,
        `seed ${seed}: tightening to ${offset} ticks cost MORE attention (${cost} vs ${previousCost})`,
      );
      previousGrade = grade;
      previousCost = cost;
    }
    assert.equal(previousCost, 0, `seed ${seed}: a perfect run still made a sound`);
  }
});

test("the top of the ladder is only reachable inside two ticks", () => {
  // Thirty-three milliseconds either side. One tick outside it and the run is
  // CLEAN rather than SILENT, on every seed.
  for (const seed of SEEDS) {
    assert.equal(playBeat(SPEC, seed, uniformPlan(SPEC, seed, 0)).outcome.grade, "SILENT");
    assert.equal(
      playBeat(SPEC, seed, uniformPlan(SPEC, seed, FLUSH_WINDOW_TICKS)).outcome.grade,
      "SILENT",
    );
    assert.equal(
      playBeat(SPEC, seed, uniformPlan(SPEC, seed, FLUSH_WINDOW_TICKS + 1)).outcome.grade,
      "CLEAN",
    );
  }
});

/** Every judged beat centred, except the ones named, which are never swung at. */
function droppingPlan(seed: number, dropped: readonly number[]) {
  const judged = deriveChart(SPEC.chart, seed).judgedBeats;
  return {
    offsets: Array.from({ length: judged }, (_, index) =>
      dropped.includes(index) ? null : 0,
    ),
  };
}

test("one lapse in thirteen strokes does not cost the mission", () => {
  // The severity rule. A three-minute traversal must not be discarded by one
  // dropped stroke: the sheet goes up crooked, the player is heard, and the run
  // continues.
  //
  // The longer chart makes this rule MORE important rather than less. Thirteen
  // chances to drop one is more chances than five, so a terminal failure that
  // could be reached by a single lapse would now be reached routinely — and it
  // is not: TORN needs most of the chart missed, which is a player who did not
  // play rather than a player who slipped.
  for (const seed of SEEDS) {
    const oneDropped = playBeat(SPEC, seed, droppingPlan(seed, [6]));
    assert.equal(oneDropped.outcome.score.slips, 1, `seed ${seed}`);
    assert.equal(oneDropped.outcome.grade, "RAGGED", `seed ${seed}`);
    assert.equal(oneDropped.outcome.posted, true, `seed ${seed}: one lapse tore the sheet`);

    const judged = deriveChart(SPEC.chart, seed).judgedBeats;
    const played = [0, 3, 7, 11];
    const mostlyDropped = playBeat(
      SPEC,
      seed,
      droppingPlan(
        seed,
        Array.from({ length: judged }, (_, index) => index).filter(
          (index) => !played.includes(index),
        ),
      ),
    );
    assert.equal(mostlyDropped.outcome.grade, "TORN", `seed ${seed}`);
    assert.equal(mostlyDropped.outcome.posted, false);
  }
});

test("a player who connects with everything is heard but not caught", () => {
  // The GLANCING floor is the mechanic's promise to a thirteen-year-old on a
  // trackpad: swing at roughly the right moment on every stroke and the sheet
  // goes up. It costs attention — five audible strokes is most of a suspicion
  // bar — and it costs the grade, and it does not cost the attempt.
  for (const seed of SEEDS) {
    const played = playBeat(SPEC, seed, uniformPlan(SPEC, seed, GLANCING_WINDOW_TICKS));
    assert.equal(played.outcome.posted, true);
    assert.equal(played.outcome.grade, "RAGGED");
    assert.ok(
      attentionCost(seed, GLANCING_WINDOW_TICKS) > STEALTH_TUNING.thresholds.curious,
      `seed ${seed}: sloppy play went completely unnoticed`,
    );
  }
});

test("the chart's spike is what separates the ladder", () => {
  // Every chart's closing bar carries two DOUBLEs — pairs of strokes two hundred
  // milliseconds apart — so no seed lets a player reach the top without playing
  // them. That is the difference between a ceiling and a formality.
  for (const seed of SEEDS) {
    const played = playBeat(SPEC, seed, uniformPlan(SPEC, seed, 0));
    const doubles = played.chart.cells.filter((cell) => cell === "DOUBLE").length;
    assert.ok(doubles >= 2, `seed ${seed} drew a chart with ${doubles} spikes in it`);
  }
  assert.equal(CELL_TICKS.DOUBLE, 12, "the spike is no longer a 200ms pair");
});

test("a longer chart costs more attention when it is played badly and none when it is not", () => {
  // THE COUPLING, RE-MEASURED AT THE NEW LENGTH, because tripling the strokes
  // triples the number of noises a sloppy run makes and that is the one thing
  // this rework could have broken without a single existing test noticing.
  //
  // Both ends of the promise survive exactly, and they survive for structural
  // reasons rather than by luck. A centred stroke is authored below the field's
  // audibility floor, so a flawless run is silent at ANY length. And noise-built
  // suspicion is capped below certainty by the field itself, so a run that is
  // mashed from end to end brings a watcher over and still cannot complete a
  // detection — at five strokes or at thirteen.
  //
  // What genuinely changed is the middle: a run played entirely TRUE now makes
  // thirteen small noises instead of five, so somebody standing under the tree
  // for the whole chart would hear enough to come and look. The price of one
  // mistake is untouched; there are simply more chances to make one, which is
  // what a longer commitment means and is the reason it is worth choosing a
  // patrol gap for.
  const worstCase = STEALTH_TUNING.noiseSuspicionCeiling;
  for (const seed of SEEDS) {
    assert.equal(attentionCost(seed, 0), 0, `seed ${seed}: a flawless run was heard`);
    const mashed = playBeat(SPEC, seed, {
      offsets: new Array(deriveChart(SPEC.chart, seed).judgedBeats).fill(null),
    });
    assert.equal(mashed.outcome.loudestIntensity < 1, true);
    assert.ok(
      mashed.outcome.loudestIntensity >= STEALTH_TUNING.minAudibleNoise,
      `seed ${seed}: dropping every stroke was silent`,
    );
    assert.ok(
      worstCase < STEALTH_TUNING.thresholds.alerted,
      "the field would let a botched chart complete a detection by itself",
    );
  }
});

test("mashing is never a strategy", () => {
  // A player who cannot read the chart might try hitting the key constantly.
  // Nothing stops them connecting with beats that way, and the noise is what
  // makes it a terrible idea: every swing that misses is the loudest thing the
  // verb can produce.
  const seed = 17;
  const perfect = playBeat(SPEC, seed, uniformPlan(SPEC, seed, 0));
  const chart = perfect.chart;
  const extra: number[] = [];
  for (let tick = 4; tick < chart.spanTicks; tick += 4) {
    if (chart.offsets.includes(tick)) continue;
    extra.push(tick);
  }
  const mashed = playBeat(SPEC, seed, {
    armAt: 0,
    offsets: chart.offsets.slice(1).map(() => 0),
    extraPresses: extra,
  });
  assert.ok(mashed.outcome.score.strays > 0);
  assert.ok(
    mashed.outcome.score.quality < perfect.outcome.score.quality,
    "mashing scored as well as playing",
  );
});
