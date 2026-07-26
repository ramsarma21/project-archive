// The judge: which beat a stroke belongs to, what it was worth, and how the run
// reads when it is over.

import assert from "node:assert/strict";
import test from "node:test";
import { deriveChart } from "../chart.js";
import {
  claimBeat,
  expiredBeats,
  gradeFor,
  judgeOffset,
  qualityOf,
  scoreStrikes,
  type StrikeRecord,
} from "../judge.js";
import {
  FLUSH_WINDOW_TICKS,
  GLANCING_WINDOW_TICKS,
  HIT_WINDOW_TICKS,
  MIN_STRIKE_QUALITY,
  TRUE_WINDOW_TICKS,
  assertWindowsNest,
} from "../tuning.js";
import { M1_HANDBILL_CHART, m1NailStanceBeat } from "../m1NailStance.js";

const THRESHOLDS = m1NailStanceBeat().thresholds;

test("the window ladder nests, so every grade is reachable", () => {
  assertWindowsNest();
  assert.equal(judgeOffset(0), "FLUSH");
  assert.equal(judgeOffset(FLUSH_WINDOW_TICKS), "FLUSH");
  assert.equal(judgeOffset(-FLUSH_WINDOW_TICKS), "FLUSH");
  assert.equal(judgeOffset(FLUSH_WINDOW_TICKS + 1), "TRUE");
  assert.equal(judgeOffset(TRUE_WINDOW_TICKS), "TRUE");
  assert.equal(judgeOffset(TRUE_WINDOW_TICKS + 1), "GLANCING");
  assert.equal(judgeOffset(GLANCING_WINDOW_TICKS), "GLANCING");
  assert.equal(judgeOffset(GLANCING_WINDOW_TICKS + 1), null);
});

test("early and late are judged identically", () => {
  for (let offset = 0; offset <= GLANCING_WINDOW_TICKS; offset++) {
    assert.equal(
      judgeOffset(offset),
      judgeOffset(-offset),
      `a stroke ${offset} ticks late is not graded like one ${offset} ticks early`,
    );
  }
});

test("a press claims the earliest unresolved beat in range", () => {
  // The overlap rule. A DOUBLE puts two beats twelve ticks apart while the outer
  // window is nine either side, so a press in the six-tick overlap is genuinely
  // ambiguous — and it must go to the first note, or a slightly-late opening
  // press steals the second and the game invents a slip.
  const chart = {
    specId: "test",
    seed: 0,
    offsets: [0, 24, 36],
    cells: ["PULSE", "DOUBLE"] as const,
    spanTicks: 36,
    judgedBeats: 2,
  };
  const resolved = [true, false, false];
  // Tick 30 is +6 from beat 1 and -6 from beat 2: inside both.
  assert.equal(claimBeat(chart, 0, resolved, 30), 1);
  // With beat 1 already taken, the same tick goes to beat 2.
  assert.equal(claimBeat(chart, 0, [true, true, false], 30), 2);
  // Outside both.
  assert.equal(claimBeat(chart, 0, resolved, 60), null);
});

test("a beat is still hittable on the last legal tick of its window", () => {
  const chart = deriveChart(M1_HANDBILL_CHART, 11);
  const due = chart.offsets[1]!;
  const resolved = chart.offsets.map((_, index) => index === 0);
  assert.equal(claimBeat(chart, 0, resolved, due + HIT_WINDOW_TICKS), 1);
  assert.deepEqual(expiredBeats(chart, 0, resolved, due + HIT_WINDOW_TICKS), []);
  // And it expires on the very next tick, not before.
  assert.deepEqual(expiredBeats(chart, 0, resolved, due + HIT_WINDOW_TICKS + 1), [1]);
});

function record(
  judgement: StrikeRecord["judgement"],
  beatIndex = 1,
): StrikeRecord {
  return {
    beatIndex: judgement === "STRAY" ? -1 : beatIndex,
    dueTick: 0,
    struckTick: judgement === "SLIP" ? null : 0,
    offsetTicks: judgement === "SLIP" ? null : 0,
    judgement,
    quality: qualityOf(judgement),
  };
}

test("unplayed beats count as nothing, so a part-played run is not flattered", () => {
  const score = scoreStrikes([record("FLUSH"), record("FLUSH", 2)], 5);
  assert.equal(score.judged, 2);
  assert.equal(score.strokeQuality, 2 / 5);
});

test("strays are charged as a penalty and never averaged in", () => {
  const clean = scoreStrikes(
    [record("FLUSH", 1), record("FLUSH", 2), record("FLUSH", 3), record("FLUSH", 4), record("FLUSH", 5)],
    5,
  );
  assert.equal(clean.quality, 1);
  const mashed = scoreStrikes(
    [
      record("FLUSH", 1),
      record("FLUSH", 2),
      record("FLUSH", 3),
      record("FLUSH", 4),
      record("FLUSH", 5),
      record("STRAY"),
      record("STRAY"),
    ],
    5,
  );
  assert.equal(mashed.strays, 2);
  assert.equal(mashed.judged, 5, "a stray must not inflate the judged count");
  assert.ok(mashed.quality < clean.quality, "mashing cost nothing");
});

test("a dropped stroke keeps the work out of CLEAN however good the average", () => {
  // Four perfect strokes and one dropped averages 0.8, comfortably over the pass
  // mark — but a corner is loose and the sheet is not properly up. That is what
  // the mission slate's minimum-phase-quality was asking for, and SLIP is the
  // only judgement below it.
  const score = scoreStrikes(
    [record("FLUSH", 1), record("FLUSH", 2), record("FLUSH", 3), record("FLUSH", 4), record("SLIP", 5)],
    5,
  );
  assert.ok(score.quality >= THRESHOLDS.passQuality);
  assert.ok(score.worstStrikeQuality < MIN_STRIKE_QUALITY);
  assert.equal(gradeFor(score, THRESHOLDS), "RAGGED");
});

test("SILENT needs every judged stroke centred and no swings at nothing", () => {
  const flawless = scoreStrikes(
    [record("FLUSH", 1), record("FLUSH", 2), record("FLUSH", 3), record("FLUSH", 4), record("FLUSH", 5)],
    5,
  );
  assert.equal(gradeFor(flawless, THRESHOLDS), "SILENT");

  const oneOff = scoreStrikes(
    [record("FLUSH", 1), record("TRUE", 2), record("FLUSH", 3), record("FLUSH", 4), record("FLUSH", 5)],
    5,
  );
  assert.equal(gradeFor(oneOff, THRESHOLDS), "CLEAN");

  const flawlessButMashing = scoreStrikes(
    [
      record("FLUSH", 1),
      record("FLUSH", 2),
      record("FLUSH", 3),
      record("FLUSH", 4),
      record("FLUSH", 5),
      record("STRAY"),
    ],
    5,
  );
  assert.notEqual(gradeFor(flawlessButMashing, THRESHOLDS), "SILENT");
});

test("the grade ladder is monotonic in quality", () => {
  const order = { TORN: 0, RAGGED: 1, CLEAN: 2, SILENT: 3 } as const;
  const ladders: StrikeRecord["judgement"][][] = [
    ["SLIP", "SLIP", "SLIP", "SLIP", "SLIP"],
    ["GLANCING", "SLIP", "SLIP", "GLANCING", "SLIP"],
    ["GLANCING", "GLANCING", "GLANCING", "GLANCING", "GLANCING"],
    ["TRUE", "TRUE", "GLANCING", "TRUE", "GLANCING"],
    ["FLUSH", "TRUE", "TRUE", "FLUSH", "TRUE"],
    ["FLUSH", "FLUSH", "FLUSH", "FLUSH", "FLUSH"],
  ];
  let previous = -1;
  for (const rung of ladders) {
    const score = scoreStrikes(
      rung.map((judgement, index) => record(judgement, index + 1)),
      5,
    );
    const grade = gradeFor(score, THRESHOLDS);
    assert.ok(
      order[grade] >= previous,
      `playing better produced a worse grade: ${rung.join(",")} -> ${grade}`,
    );
    previous = order[grade];
  }
});

test("a competent first-time run clears the authored pass mark", () => {
  // A fifth centred, two fifths good, two fifths skidded — measured over the
  // chart M1 actually ships rather than over a convenient five. This is the
  // target: a thirteen-year-old paying attention on their first encounter should
  // get the sheet up properly.
  const judged = M1_HANDBILL_CHART.judgedBeats;
  const mix: StrikeRecord["judgement"][] = Array.from({ length: judged }, (_, index) => {
    const share = index / judged;
    if (share < 0.2) return "FLUSH";
    return share < 0.6 ? "TRUE" : "GLANCING";
  });
  const score = scoreStrikes(
    mix.map((judgement, index) => record(judgement, index + 1)),
    judged,
  );
  assert.ok(
    score.quality >= THRESHOLDS.passQuality,
    `a competent run scored ${score.quality} against a ${THRESHOLDS.passQuality} pass mark`,
  );
  assert.equal(gradeFor(score, THRESHOLDS), "CLEAN");
});

test("a longer chart makes the pass mark a measure of the player, not the seed", () => {
  // The reason thirteen strokes is worth its seconds, stated as arithmetic. On
  // five strokes one lucky centred hit moved the average a tenth, so clearing
  // 0.70 was partly a report on the draw; on thirteen it moves it by four
  // hundredths, and what clears the bar is the player.
  const swing = (judged: number): number => {
    const glancing: StrikeRecord["judgement"][] = new Array(judged).fill("GLANCING");
    const base = scoreStrikes(
      glancing.map((judgement, index) => record(judgement, index + 1)),
      judged,
    );
    const lucky = [...glancing];
    lucky[0] = "FLUSH";
    return (
      scoreStrikes(
        lucky.map((judgement, index) => record(judgement, index + 1)),
        judged,
      ).quality - base.quality
    );
  };
  assert.ok(swing(5) > 0.09);
  assert.ok(swing(M1_HANDBILL_CHART.judgedBeats) < 0.05);
});

test("connecting with everything but centring nothing does not clear", () => {
  const score = scoreStrikes(
    [
      record("GLANCING", 1),
      record("GLANCING", 2),
      record("GLANCING", 3),
      record("GLANCING", 4),
      record("GLANCING", 5),
    ],
    5,
  );
  assert.equal(gradeFor(score, THRESHOLDS), "RAGGED");
  assert.ok(score.quality > THRESHOLDS.tornQuality, "and it does not tear either");
});
