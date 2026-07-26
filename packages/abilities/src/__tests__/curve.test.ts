import assert from "node:assert/strict";
import test from "node:test";

import {
  XpCurveSchema,
  levelForXp,
  missionXpAward,
  xpToNextLevel,
} from "../contractsSurface.js";
import {
  BOSTON_CHAPTER_XP_CEILING,
  BOSTON_LEVEL_CAP,
  BOSTON_MAX_ATTAINABLE_LEVEL,
  BOSTON_MISSION_BASE_XP,
  BOSTON_MISSION_COUNT,
  BOSTON_XP_CURVE,
  FIRST_MISSION_BASE_XP,
  LEVEL_1_XP,
  LEVEL_COST_STEP,
  levelCost,
  levelFor,
  levelThreshold,
  missionAward,
  missionBaseXp,
  worstPayingClear,
  xpOwedForNextLevel,
} from "../curve.js";

test("the authored curve satisfies the contracts schema", () => {
  assert.doesNotThrow(() => XpCurveSchema.parse(BOSTON_XP_CURVE));
  assert.equal(BOSTON_XP_CURVE.levelThresholds.length, BOSTON_LEVEL_CAP);
  for (let index = 1; index < BOSTON_XP_CURVE.levelThresholds.length; index += 1) {
    assert.ok(
      BOSTON_XP_CURVE.levelThresholds[index]! >
        BOSTON_XP_CURVE.levelThresholds[index - 1]!,
      "thresholds must be strictly increasing",
    );
  }
});

test("Level 1 is anchored to the worst possible clear of the first mission", () => {
  // Not a tuned number: it is the same number, so every player who clears
  // anything at all is Level 1.
  assert.equal(LEVEL_1_XP, worstPayingClear(1));
  assert.equal(LEVEL_1_XP, Math.floor(FIRST_MISSION_BASE_XP / 3));
  assert.equal(levelThreshold(1), LEVEL_1_XP);
  assert.equal(levelFor(worstPayingClear(1)), 1);
  assert.equal(levelFor(worstPayingClear(1) - 1), 0);
});

test("every award and every decayed share is exact", () => {
  for (let ordinal = 1; ordinal <= BOSTON_MISSION_COUNT; ordinal += 1) {
    const base = missionBaseXp(ordinal);
    assert.equal(base % 3, 0, `M${ordinal} base must divide by 3`);
    assert.equal(missionAward(ordinal, 1), base);
    assert.equal(missionAward(ordinal, 2), (base * 2) / 3);
    assert.equal(missionAward(ordinal, 3), base / 3);
    assert.equal(missionAward(ordinal, 4), 0, "there is no fourth attempt");
  }
});

test("awards rise across the chapter and the ceiling is the sum of them", () => {
  for (let ordinal = 2; ordinal <= BOSTON_MISSION_COUNT; ordinal += 1) {
    assert.equal(
      missionBaseXp(ordinal) - missionBaseXp(ordinal - 1),
      15,
      "the ramp is linear",
    );
  }
  assert.equal(BOSTON_MISSION_BASE_XP.length, BOSTON_MISSION_COUNT);
  assert.equal(BOSTON_CHAPTER_XP_CEILING, 3045);
  assert.equal(
    BOSTON_CHAPTER_XP_CEILING,
    BOSTON_MISSION_BASE_XP.reduce((sum, base) => sum + base, 0),
  );
});

test("an ordinal outside the slate pays nothing", () => {
  assert.equal(missionBaseXp(0), 0);
  assert.equal(missionBaseXp(15), 0);
  assert.equal(missionBaseXp(1.5), 0);
});

test("Level cost rises linearly and the threshold is its running sum", () => {
  assert.equal(levelCost(1), LEVEL_1_XP);
  let running = 0;
  for (let level = 1; level <= BOSTON_LEVEL_CAP; level += 1) {
    assert.equal(levelCost(level), LEVEL_1_XP + LEVEL_COST_STEP * (level - 1));
    running += levelCost(level);
    assert.equal(levelThreshold(level), running);
  }
  assert.equal(levelCost(0), 0);
  assert.equal(levelThreshold(0), 0);
});

test("the chapter cannot outrun the authored curve", () => {
  assert.equal(BOSTON_MAX_ATTAINABLE_LEVEL, 34);
  assert.ok(
    BOSTON_LEVEL_CAP > BOSTON_MAX_ATTAINABLE_LEVEL,
    "headroom, so xpToNextLevel is never null inside the chapter",
  );
  assert.equal(typeof xpOwedForNextLevel(BOSTON_CHAPTER_XP_CEILING), "number");
  assert.equal(xpOwedForNextLevel(levelThreshold(BOSTON_LEVEL_CAP)), null);
});

test("derivation is delegated to @pa/contracts, not reimplemented", () => {
  // The point of these three is that this package adds no arithmetic of its own:
  // the same inputs through the contracts functions give the same answers.
  for (const xp of [0, 39, 40, 41, 1234, 3045, 9999]) {
    assert.equal(levelFor(xp), levelForXp(BOSTON_XP_CURVE, xp));
    assert.equal(xpOwedForNextLevel(xp), xpToNextLevel(BOSTON_XP_CURVE, xp));
  }
  for (let ordinal = 1; ordinal <= BOSTON_MISSION_COUNT; ordinal += 1) {
    for (const attempt of [1, 2, 3]) {
      assert.equal(
        missionAward(ordinal, attempt),
        missionXpAward({
          baseXp: missionBaseXp(ordinal),
          attemptOrdinal: attempt,
          outcome: "CLEARED",
        }),
      );
    }
  }
});

test("a failed attempt pays nothing at any ordinal", () => {
  for (const attempt of [1, 2, 3]) {
    assert.equal(
      missionXpAward({ baseXp: missionBaseXp(1), attemptOrdinal: attempt, outcome: "FAILED" }),
      0,
    );
  }
});
