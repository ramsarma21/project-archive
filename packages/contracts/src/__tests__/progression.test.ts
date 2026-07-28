import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnswerAssessmentItemRequestSchema,
  ChapterAssessmentAttemptSchema,
  ChapterAssessmentResponseSchema,
  CommitMissionOutcomeRequestSchema,
  CompleteLearningModuleRequestSchema,
  LEVELS_PER_RANK,
  MAX_MISSION_ATTEMPTS,
  OpenMissionAttemptRequestSchema,
  STARTING_RANK,
  XpCurveSchema,
  type CampaignProgression,
  type ChapterProgression,
  type MissionProgress,
  type XpCurve,
} from "../progression.js";
import {
  applyMissionOutcome,
  attemptXpFraction,
  attemptXpMultiplier,
  canAdvancePastMission,
  cumulativeLevelsForChapter,
  isMissionPermanentlySpent,
  isModuleGateSatisfied,
  levelForXp,
  levelsToNextRank,
  missionXpAward,
  moduleDeckCovered,
  monotonicRank,
  newlyUnlockedAbilityMilestones,
  nextAttemptOrdinal,
  rankFromCumulativeLevels,
  remainingMissionAttempts,
  reportedFirstAttemptMeasure,
  selectFreshItems,
  startChapter,
  summarizeAssessmentForm,
  unmasteredConceptIds,
  xpToNextLevel,
} from "../progressionRules.js";

const AT = "2026-07-25T00:00:00.000Z";
const PROFILE = "11111111-1111-4111-8111-111111111111";

// Test-only curve: 100 XP per Level, flat. No curve is authored in the repo.
const CURVE: XpCurve = {
  curveId: "TEST.CURVE",
  version: "1",
  levelThresholds: Array.from({ length: 40 }, (_, i) => (i + 1) * 100),
};

function campaign(overrides: Partial<CampaignProgression> = {}): CampaignProgression {
  return {
    profileId: PROFILE,
    modelVersion: 1,
    rank: STARTING_RANK,
    cumulativeLevels: 0,
    activeChapterId: "CH.ONE",
    revision: 0,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function chapter(overrides: Partial<ChapterProgression> = {}): ChapterProgression {
  return {
    profileId: PROFILE,
    chapterId: "CH.ONE",
    level: 0,
    xp: 0,
    levelsAtChapterStart: 0,
    status: "ACTIVE",
    assessmentPassedAt: null,
    startedAt: AT,
    completedAt: null,
    updatedAt: AT,
    ...overrides,
  };
}

function mission(overrides: Partial<MissionProgress> = {}): MissionProgress {
  return {
    profileId: PROFILE,
    chapterId: "CH.ONE",
    missionId: "M1",
    attemptsUsed: 0,
    outcome: "UNSTARTED",
    awardedXp: 0,
    clearedOnAttempt: null,
    clearedAt: null,
    failedAt: null,
    updatedAt: AT,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------

test("a new runner is Rank 1 at zero cumulative Levels", () => {
  assert.equal(rankFromCumulativeLevels(0), 1);
});

test("Rank steps exactly on the ten-Level boundary", () => {
  assert.equal(rankFromCumulativeLevels(9), 1);
  assert.equal(rankFromCumulativeLevels(10), 2);
  assert.equal(rankFromCumulativeLevels(11), 2);
  assert.equal(rankFromCumulativeLevels(19), 2);
  assert.equal(rankFromCumulativeLevels(20), 3);
  assert.equal(rankFromCumulativeLevels(100), 11);
});

test("Rank ignores nonsense input rather than going below 1", () => {
  assert.equal(rankFromCumulativeLevels(-5), 1);
  assert.equal(rankFromCumulativeLevels(Number.NaN), 1);
  assert.equal(rankFromCumulativeLevels(10.9), 2);
});

test("Rank never decreases even when the formula would demote", () => {
  assert.equal(monotonicRank(4, 0), 4);
  assert.equal(monotonicRank(4, 39), 4);
  assert.equal(monotonicRank(4, 40), 5);
  assert.equal(monotonicRank(0, 0), STARTING_RANK);
});

test("levelsToNextRank always reads as a positive count", () => {
  assert.equal(levelsToNextRank(0), LEVELS_PER_RANK);
  assert.equal(levelsToNextRank(1), 9);
  assert.equal(levelsToNextRank(9), 1);
  assert.equal(levelsToNextRank(10), LEVELS_PER_RANK);
});

// ---------------------------------------------------------------------------
// XP decay
// ---------------------------------------------------------------------------

test("the XP fraction decays full, two-thirds, one-third, then zero", () => {
  assert.deepEqual(attemptXpFraction(1), { numerator: 3, denominator: 3 });
  assert.deepEqual(attemptXpFraction(2), { numerator: 2, denominator: 3 });
  assert.deepEqual(attemptXpFraction(3), { numerator: 1, denominator: 3 });
  assert.deepEqual(attemptXpFraction(4), { numerator: 0, denominator: 1 });
  assert.deepEqual(attemptXpFraction(0), { numerator: 0, denominator: 1 });
  assert.deepEqual(attemptXpFraction(1.5), { numerator: 0, denominator: 1 });
});

test("the multiplier matches the fraction and is exactly 1 on attempt 1", () => {
  assert.equal(attemptXpMultiplier(1), 1);
  assert.ok(Math.abs(attemptXpMultiplier(2) - 2 / 3) < 1e-12);
  assert.ok(Math.abs(attemptXpMultiplier(3) - 1 / 3) < 1e-12);
  assert.equal(attemptXpMultiplier(4), 0);
});

test("a clear pays the exact decayed award and a failure pays nothing", () => {
  for (const [ordinal, expected] of [[1, 900], [2, 600], [3, 300]] as const) {
    assert.equal(
      missionXpAward({ baseXp: 900, attemptOrdinal: ordinal, outcome: "CLEARED" }),
      expected,
    );
    assert.equal(
      missionXpAward({ baseXp: 900, attemptOrdinal: ordinal, outcome: "FAILED" }),
      0,
    );
  }
  assert.equal(
    missionXpAward({ baseXp: 900, attemptOrdinal: 4, outcome: "CLEARED" }),
    0,
  );
});

test("a non-divisible base floors, so a later attempt never out-pays an earlier one", () => {
  // 100 XP: 100, then 66 (not 66.67), then 33. Strictly decreasing.
  const awards = [1, 2, 3].map((attemptOrdinal) =>
    missionXpAward({ baseXp: 100, attemptOrdinal, outcome: "CLEARED" }),
  );
  assert.deepEqual(awards, [100, 66, 33]);
  for (const baseXp of [1, 2, 3, 7, 10, 99, 101, 1000, 12_345]) {
    const [first, second, third] = [1, 2, 3].map((attemptOrdinal) =>
      missionXpAward({ baseXp, attemptOrdinal, outcome: "CLEARED" }),
    );
    assert.ok(first! >= second! && second! >= third!, `base ${baseXp} decayed wrong`);
    assert.ok(Number.isInteger(first) && Number.isInteger(second) && Number.isInteger(third));
  }
});

test("zero base pays zero at every ordinal", () => {
  for (const attemptOrdinal of [1, 2, 3]) {
    assert.equal(missionXpAward({ baseXp: 0, attemptOrdinal, outcome: "CLEARED" }), 0);
  }
});

// ---------------------------------------------------------------------------
// Attempt accounting
// ---------------------------------------------------------------------------

test("three attempts, then the mission is permanently spent", () => {
  assert.equal(nextAttemptOrdinal(mission()), 1);
  assert.equal(nextAttemptOrdinal(mission({ attemptsUsed: 1, outcome: "IN_PROGRESS" })), 2);
  assert.equal(nextAttemptOrdinal(mission({ attemptsUsed: 2, outcome: "IN_PROGRESS" })), 3);
  assert.equal(
    nextAttemptOrdinal(mission({ attemptsUsed: 3, outcome: "FAILED_PERMANENT" })),
    null,
  );
  assert.equal(remainingMissionAttempts(mission()), MAX_MISSION_ATTEMPTS);
  assert.equal(remainingMissionAttempts(mission({ attemptsUsed: 2, outcome: "IN_PROGRESS" })), 1);
});

test("a cleared mission is spent and cannot be replayed", () => {
  const cleared = mission({ attemptsUsed: 1, outcome: "CLEARED", clearedOnAttempt: 1 });
  assert.equal(isMissionPermanentlySpent(cleared), true);
  assert.equal(nextAttemptOrdinal(cleared), null);
  assert.equal(remainingMissionAttempts(cleared), 0);
});

test("a permanently failed mission still lets the player advance", () => {
  const failed = mission({ attemptsUsed: 3, outcome: "FAILED_PERMANENT", failedAt: AT });
  assert.equal(isMissionPermanentlySpent(failed), true);
  assert.equal(canAdvancePastMission(failed), true);
  assert.equal(canAdvancePastMission(mission({ attemptsUsed: 1, outcome: "IN_PROGRESS" })), false);
});

test("the module gates every attempt, and a stale completion does not carry", () => {
  assert.equal(isModuleGateSatisfied({ attemptOrdinal: 2, completion: null }), false);
  // Attempt 1's completion does not open attempt 2: a retry redoes the module.
  assert.equal(
    isModuleGateSatisfied({ attemptOrdinal: 2, completion: { gatesOrdinal: 1 } }),
    false,
  );
  assert.equal(
    isModuleGateSatisfied({ attemptOrdinal: 2, completion: { gatesOrdinal: 2 } }),
    true,
  );
});

test("a module run must cover its deck, in any order", () => {
  const deck = ["CUE.1", "CUE.2", "CUE.3"];
  assert.equal(moduleDeckCovered(deck, ["CUE.3", "CUE.1", "CUE.2"]), true);
  assert.equal(moduleDeckCovered(deck, ["CUE.1", "CUE.2"]), false);
  assert.equal(moduleDeckCovered(deck, []), false);
  // Re-reading a card is allowed and costs nothing.
  assert.equal(moduleDeckCovered(deck, ["CUE.1", "CUE.1", "CUE.2", "CUE.3"]), true);
});

// ---------------------------------------------------------------------------
// XP curve
// ---------------------------------------------------------------------------

test("Level follows the authored thresholds and starts at 0", () => {
  assert.equal(levelForXp(CURVE, 0), 0);
  assert.equal(levelForXp(CURVE, 99), 0);
  assert.equal(levelForXp(CURVE, 100), 1);
  assert.equal(levelForXp(CURVE, 250), 2);
  assert.equal(xpToNextLevel(CURVE, 0), 100);
  assert.equal(xpToNextLevel(CURVE, 150), 50);
  assert.equal(xpToNextLevel(CURVE, 4000), null);
});

test("a curve whose thresholds are not strictly increasing is rejected", () => {
  assert.equal(
    XpCurveSchema.safeParse({ curveId: "C", version: "1", levelThresholds: [100, 100] }).success,
    false,
  );
  assert.equal(
    XpCurveSchema.safeParse({ curveId: "C", version: "1", levelThresholds: [100, 250] }).success,
    true,
  );
});

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

test("ability milestones unlock only for the crossed Levels of the active chapter", () => {
  const milestones = [
    { abilityId: "A.ONE", chapterId: "CH.ONE", level: 2 },
    { abilityId: "A.TWO", chapterId: "CH.ONE", level: 3 },
    { abilityId: "A.OTHER", chapterId: "CH.TWO", level: 2 },
  ];
  assert.deepEqual(
    newlyUnlockedAbilityMilestones(milestones, "CH.ONE", 1, 3).map((m) => m.abilityId),
    ["A.ONE", "A.TWO"],
  );
  assert.deepEqual(newlyUnlockedAbilityMilestones(milestones, "CH.ONE", 3, 3), []);
  assert.deepEqual(
    newlyUnlockedAbilityMilestones(milestones, "CH.TWO", 0, 2).map((m) => m.abilityId),
    ["A.OTHER"],
  );
});

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

test("a concept is mastered only at 100%, and an unanswered item counts against it", () => {
  const form = [
    { conceptId: "C.A", itemIds: ["I1", "I2"] },
    { conceptId: "C.B", itemIds: ["I3", "I4"] },
  ];
  const summary = summarizeAssessmentForm(form, [
    { itemId: "I1", conceptId: "C.A", correct: true },
    { itemId: "I2", conceptId: "C.A", correct: true },
    { itemId: "I3", conceptId: "C.B", correct: true },
  ]);
  assert.deepEqual(summary.masteredConceptIds, ["C.A"]);
  assert.deepEqual(summary.unmasteredConceptIds, ["C.B"]);
  assert.equal(summary.passed, false);
  assert.equal(summary.scoreNumerator, 3);
  assert.equal(summary.scoreDenominator, 4);

  const perfect = summarizeAssessmentForm(form, [
    { itemId: "I1", conceptId: "C.A", correct: true },
    { itemId: "I2", conceptId: "C.A", correct: true },
    { itemId: "I3", conceptId: "C.B", correct: true },
    { itemId: "I4", conceptId: "C.B", correct: true },
  ]);
  assert.equal(perfect.passed, true);
});

test("an empty form is never a pass, and a zero-item concept is never mastered", () => {
  // The two `length > 0` guards inside summarizeAssessmentForm, pinned. Both are
  // vacuous-`every`/`===` traps: `[].every(mastered)` is true, and `correct === 0`
  // holds when a concept was served zero items. Either would let a form with
  // nothing in it report `passed: true` and mint a PvP-legal card off no evidence,
  // and neither is caught by any form that actually carries items.
  const emptyForm = summarizeAssessmentForm([], []);
  assert.equal(emptyForm.passed, false, "a form with no concepts cannot pass");
  assert.deepEqual(emptyForm.masteredConceptIds, []);
  assert.equal(emptyForm.scoreDenominator, 0);

  const emptyConcept = summarizeAssessmentForm(
    [{ conceptId: "C.EMPTY", itemIds: [] }],
    [],
  );
  const row = emptyConcept.byConcept[0];
  assert.equal(row?.served, 0);
  assert.equal(
    row?.mastered,
    false,
    "a concept nobody was asked about is not mastered by vacuous 100%",
  );
  assert.deepEqual(emptyConcept.masteredConceptIds, []);
  assert.equal(
    emptyConcept.passed,
    false,
    "a form of only empty concepts is not a pass, however the `every` reads",
  );
});

test("a retry narrows to unmastered concepts and draws only fresh items", () => {
  const mastery = new Map([
    ["C.A", { masteredAt: AT }],
    ["C.B", { masteredAt: null }],
    ["C.C", { masteredAt: null }],
  ]);
  assert.deepEqual(unmasteredConceptIds(["C.A", "C.B", "C.C"], mastery), ["C.B", "C.C"]);
  assert.deepEqual(unmasteredConceptIds(["C.A", "C.D"], mastery), ["C.D"]);

  const first = selectFreshItems({
    reserveItemIds: ["I1", "I2", "I3", "I4", "I5", "I6"],
    servedItemIds: [],
    count: 2,
  });
  assert.deepEqual(first, { itemIds: ["I1", "I2"], exhausted: false });
  const retry = selectFreshItems({
    reserveItemIds: ["I1", "I2", "I3", "I4", "I5", "I6"],
    servedItemIds: first.itemIds,
    count: 2,
  });
  assert.deepEqual(retry, { itemIds: ["I3", "I4"], exhausted: false });
  assert.deepEqual(
    selectFreshItems({
      reserveItemIds: ["I1", "I2"],
      servedItemIds: ["I1"],
      count: 2,
    }),
    { itemIds: ["I2"], exhausted: true },
  );
});

test("a response row carries the item's format and refuses a mismatched answer", () => {
  const base = {
    attemptId: "44444444-4444-4444-8444-444444444444",
    itemId: "ITEM.1",
    conceptId: "C.A",
    correct: false,
    answeredAt: AT,
  };
  const valid = [
    { ...base, itemFormat: "SELECTED_RESPONSE", selectedOptionId: "A", responseRef: null, correct: true },
    { ...base, itemFormat: "OPEN_RESPONSE", selectedOptionId: null, responseRef: "resp-1", correct: true },
    // Genuine blanks, on either format. No sentinel option id anywhere.
    { ...base, itemFormat: "SELECTED_RESPONSE", selectedOptionId: null, responseRef: null },
    { ...base, itemFormat: "OPEN_RESPONSE", selectedOptionId: null, responseRef: null },
  ];
  for (const row of valid) {
    assert.equal(
      ChapterAssessmentResponseSchema.safeParse(row).success,
      true,
      `${JSON.stringify(row)} must be accepted`,
    );
  }

  const invalid = [
    // A selected-response item has no open handle, and vice versa.
    { ...base, itemFormat: "SELECTED_RESPONSE", selectedOptionId: "A", responseRef: "resp-1" },
    { ...base, itemFormat: "OPEN_RESPONSE", selectedOptionId: "A", responseRef: "resp-1" },
    // A blank cannot be correct.
    { ...base, itemFormat: "SELECTED_RESPONSE", selectedOptionId: null, responseRef: null, correct: true },
    // The format is not optional: a row must say what was asked.
    { ...base, selectedOptionId: "A", responseRef: null },
  ];
  for (const row of invalid) {
    assert.equal(
      ChapterAssessmentResponseSchema.safeParse(row).success,
      false,
      `${JSON.stringify(row)} must be rejected`,
    );
  }
});

test("a client submits an answer or a handle, never a verdict", () => {
  const attemptId = "44444444-4444-4444-8444-444444444444";
  for (const request of [
    { attemptId, itemId: "ITEM.1", itemFormat: "SELECTED_RESPONSE", selectedOptionId: "A" },
    { attemptId, itemId: "ITEM.1", itemFormat: "SELECTED_RESPONSE", selectedOptionId: null },
    { attemptId, itemId: "ITEM.2", itemFormat: "OPEN_RESPONSE", responseRef: "resp-1" },
    { attemptId, itemId: "ITEM.2", itemFormat: "OPEN_RESPONSE", responseRef: null },
  ]) {
    assert.equal(AnswerAssessmentItemRequestSchema.safeParse(request).success, true);
  }
  for (const forged of [
    { attemptId, itemId: "ITEM.1", itemFormat: "SELECTED_RESPONSE", selectedOptionId: "A", correct: true },
    { attemptId, itemId: "ITEM.2", itemFormat: "OPEN_RESPONSE", responseRef: "resp-1", verdict: "CORRECT" },
    { attemptId, itemId: "ITEM.2", itemFormat: "OPEN_RESPONSE", responseRef: "resp-1", score: 1 },
    // Prose has no field to arrive in.
    { attemptId, itemId: "ITEM.2", itemFormat: "OPEN_RESPONSE", responseRef: "resp-1", responseText: "..." },
  ]) {
    assert.equal(
      AnswerAssessmentItemRequestSchema.safeParse(forged).success,
      false,
      `${JSON.stringify(forged)} must be rejected`,
    );
  }
});

test("an abandoned first attempt keeps the reported measure and reports no score", () => {
  const attempt = (
    ordinal: number,
    status: "IN_PROGRESS" | "SUBMITTED" | "ABANDONED",
    score: number | null,
  ) => ({
    attemptOrdinal: ordinal,
    status,
    scoreNumerator: score,
    scoreDenominator: score === null ? null : 4,
  });

  assert.equal(reportedFirstAttemptMeasure([]), null);

  const submitted = reportedFirstAttemptMeasure([
    attempt(1, "SUBMITTED", 3),
    attempt(2, "SUBMITTED", 4),
  ]);
  assert.deepEqual(submitted?.score, { numerator: 3, denominator: 4 });

  // The whole point: a walked-out first attempt does not hand the measure to
  // the retry, however well the retry went.
  const walkedOut = reportedFirstAttemptMeasure([
    attempt(1, "ABANDONED", null),
    attempt(2, "SUBMITTED", 4),
  ]);
  assert.equal(walkedOut?.attempt.attemptOrdinal, 1);
  assert.equal(walkedOut?.score, null);

  const stillOpen = reportedFirstAttemptMeasure([attempt(1, "IN_PROGRESS", null)]);
  assert.equal(stillOpen?.score, null);

  // A retry alone never becomes the measure.
  assert.equal(reportedFirstAttemptMeasure([attempt(2, "SUBMITTED", 4)]), null);
});

test("an attempt row accepts the abandoned status", () => {
  const attempt = {
    attemptId: "44444444-4444-4444-8444-444444444444",
    profileId: PROFILE,
    chapterId: "CH.ONE",
    assessmentId: "ASSESS.ONE",
    attemptOrdinal: 1,
    scopedConceptIds: ["C.A"],
    form: [{ conceptId: "C.A", itemIds: ["I1", "I2"] }],
    status: "ABANDONED",
    passed: false,
    scoreNumerator: null,
    scoreDenominator: null,
    isReportedMeasure: true,
    startedAt: AT,
    submittedAt: null,
    updatedAt: AT,
  };
  assert.equal(ChapterAssessmentAttemptSchema.safeParse(attempt).success, true);
  assert.equal(
    ChapterAssessmentAttemptSchema.safeParse({ ...attempt, status: "WALKED_OUT" }).success,
    false,
  );
});

// ---------------------------------------------------------------------------
// The mission-outcome reducer
// ---------------------------------------------------------------------------

function commit(overrides: Partial<Parameters<typeof applyMissionOutcome>[0]["commit"]> = {}) {
  return {
    missionId: "M1",
    chapterId: "CH.ONE",
    attemptOrdinal: 1,
    outcome: "CLEARED" as const,
    baseXp: 900,
    at: AT,
    ...overrides,
  };
}

test("a first-attempt clear pays full XP and raises Level, cumulative Levels and Rank", () => {
  const result = applyMissionOutcome({
    campaign: campaign({ rank: 1, cumulativeLevels: 9 }),
    chapter: chapter({ level: 5, xp: 500, levelsAtChapterStart: 4 }),
    mission: mission(),
    commit: commit(),
    curve: CURVE,
    abilityMilestones: [{ abilityId: "A.SIX", chapterId: "CH.ONE", level: 6 }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const delta = result.value;
  assert.equal(delta.awardedXp, 900);
  assert.equal(delta.chapter.xp, 1400);
  assert.equal(delta.chapter.level, 14);
  assert.equal(delta.levelsGained, 9);
  assert.equal(delta.campaign.cumulativeLevels, 18);
  assert.equal(delta.campaign.rank, 2);
  assert.equal(delta.ranksGained, 1);
  assert.equal(delta.mission.outcome, "CLEARED");
  assert.equal(delta.mission.attemptsUsed, 1);
  assert.equal(delta.mission.clearedOnAttempt, 1);
  assert.deepEqual(delta.unlockedAbilities.map((a) => a.abilityId), ["A.SIX"]);
  assert.deepEqual(
    delta.ledger.map((entry) => entry.kind),
    ["MISSION_XP_AWARDED", "LEVEL_GAINED", "RANK_GAINED", "ABILITY_UNLOCKED"],
  );
  assert.equal(cumulativeLevelsForChapter(delta.chapter), delta.campaign.cumulativeLevels);
});

test("a failed attempt pays zero, banks the attempt, and leaves Rank alone", () => {
  const result = applyMissionOutcome({
    campaign: campaign({ cumulativeLevels: 9 }),
    chapter: chapter({ level: 9, xp: 900, levelsAtChapterStart: 0 }),
    mission: mission(),
    commit: commit({ outcome: "FAILED" }),
    curve: CURVE,
    abilityMilestones: [],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.awardedXp, 0);
  assert.equal(result.value.campaign.rank, 1);
  assert.equal(result.value.campaign.cumulativeLevels, 9);
  assert.equal(result.value.mission.outcome, "IN_PROGRESS");
  assert.equal(result.value.mission.attemptsUsed, 1);
  assert.deepEqual(result.value.ledger, []);
});

test("the third failure permanently fails the mission", () => {
  const result = applyMissionOutcome({
    campaign: campaign(),
    chapter: chapter(),
    mission: mission({ attemptsUsed: 2, outcome: "IN_PROGRESS" }),
    commit: commit({ attemptOrdinal: 3, outcome: "FAILED" }),
    curve: CURVE,
    abilityMilestones: [],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.mission.outcome, "FAILED_PERMANENT");
  assert.equal(result.value.mission.failedAt, AT);
  assert.equal(isMissionPermanentlySpent(result.value.mission), true);
  assert.equal(canAdvancePastMission(result.value.mission), true);
  assert.deepEqual(
    result.value.ledger.map((entry) => entry.kind),
    ["MISSION_FAILED_PERMANENT"],
  );
});

test("a spent mission is refused, and so is a forged ordinal", () => {
  const spent = applyMissionOutcome({
    campaign: campaign(),
    chapter: chapter(),
    mission: mission({ attemptsUsed: 3, outcome: "FAILED_PERMANENT" }),
    commit: commit({ attemptOrdinal: 4 }),
    curve: CURVE,
    abilityMilestones: [],
  });
  assert.deepEqual(spent, { ok: false, reason: "MISSION_SPENT" });

  const clearedAgain = applyMissionOutcome({
    campaign: campaign(),
    chapter: chapter(),
    mission: mission({ attemptsUsed: 1, outcome: "CLEARED", clearedOnAttempt: 1 }),
    commit: commit({ attemptOrdinal: 2 }),
    curve: CURVE,
    abilityMilestones: [],
  });
  assert.deepEqual(clearedAgain, { ok: false, reason: "MISSION_SPENT" });

  // Claiming attempt 1's full payout on what is really attempt 2.
  const forged = applyMissionOutcome({
    campaign: campaign(),
    chapter: chapter(),
    mission: mission({ attemptsUsed: 1, outcome: "IN_PROGRESS" }),
    commit: commit({ attemptOrdinal: 1 }),
    curve: CURVE,
    abilityMilestones: [],
  });
  assert.deepEqual(forged, { ok: false, reason: "PROGRESSION_CONFLICT" });
});

test("an inactive or mismatched chapter is refused", () => {
  const complete = applyMissionOutcome({
    campaign: campaign(),
    chapter: chapter({ status: "COMPLETE" }),
    mission: mission(),
    commit: commit(),
    curve: CURVE,
    abilityMilestones: [],
  });
  assert.deepEqual(complete, { ok: false, reason: "CHAPTER_NOT_ACTIVE" });

  const otherChapter = applyMissionOutcome({
    campaign: campaign(),
    chapter: chapter(),
    mission: mission(),
    commit: commit({ chapterId: "CH.TWO" }),
    curve: CURVE,
    abilityMilestones: [],
  });
  assert.deepEqual(otherChapter, { ok: false, reason: "CHAPTER_NOT_ACTIVE" });
});

// ---------------------------------------------------------------------------
// The chapter boundary
// ---------------------------------------------------------------------------

test("a new chapter resets Level and XP while Rank and partial progress carry", () => {
  const before = campaign({ rank: 1, cumulativeLevels: 7, activeChapterId: "CH.ONE" });
  const { campaign: after, chapter: fresh, ledger } = startChapter({
    campaign: before,
    chapterId: "CH.TWO",
    at: AT,
  });
  assert.equal(after.activeChapterId, "CH.TWO");
  assert.equal(after.rank, 1);
  assert.equal(after.cumulativeLevels, 7);
  assert.equal(fresh.level, 0);
  assert.equal(fresh.xp, 0);
  assert.equal(fresh.levelsAtChapterStart, 7);
  assert.deepEqual(ledger.map((entry) => entry.kind), ["CHAPTER_STARTED"]);

  // Three Levels into the new chapter crosses the boundary the old one left at.
  const promoted = applyMissionOutcome({
    campaign: after,
    chapter: fresh,
    mission: mission({ chapterId: "CH.TWO", missionId: "M9" }),
    commit: commit({ chapterId: "CH.TWO", missionId: "M9", baseXp: 300 }),
    curve: CURVE,
    abilityMilestones: [],
  });
  assert.equal(promoted.ok, true);
  if (!promoted.ok) return;
  assert.equal(promoted.value.chapter.level, 3);
  assert.equal(promoted.value.campaign.cumulativeLevels, 10);
  assert.equal(promoted.value.campaign.rank, 2);
  assert.equal(cumulativeLevelsForChapter(promoted.value.chapter), 10);
});

// ---------------------------------------------------------------------------
// Client write surface
// ---------------------------------------------------------------------------

test("a client cannot assert its own XP, Level, Rank, ordinal or verdict", () => {
  assert.equal(
    OpenMissionAttemptRequestSchema.safeParse({ chapterId: "CH.ONE", missionId: "M1" }).success,
    true,
  );
  for (const forged of [
    { chapterId: "CH.ONE", missionId: "M1", attemptOrdinal: 1 },
    { chapterId: "CH.ONE", missionId: "M1", xp: 9999 },
    { chapterId: "CH.ONE", missionId: "M1", rank: 12 },
  ]) {
    assert.equal(
      OpenMissionAttemptRequestSchema.safeParse(forged).success,
      false,
      `${JSON.stringify(forged)} must be rejected`,
    );
  }

  const attemptId = "22222222-2222-4222-8222-222222222222";
  assert.equal(
    CommitMissionOutcomeRequestSchema.safeParse({
      attemptId,
      outcome: "CLEARED",
      committedEvents: [],
      baseRevision: 0,
    }).success,
    true,
  );
  for (const forged of [
    { attemptId, outcome: "CLEARED", committedEvents: [], baseRevision: 0, awardedXp: 900 },
    { attemptId, outcome: "CLEARED", committedEvents: [], baseRevision: 0, level: 20 },
    // Beside the log, not inside it: this is a client asserting a verdict.
    {
      attemptId,
      outcome: "CLEARED",
      committedEvents: [],
      baseRevision: 0,
      verdict: "CORRECT",
    },
  ]) {
    assert.equal(
      CommitMissionOutcomeRequestSchema.safeParse(forged).success,
      false,
      `${JSON.stringify(forged)} must be rejected`,
    );
  }
});

test("the duel's commit log is opaque, and only the log", () => {
  const attemptId = "22222222-2222-4222-8222-222222222222";
  // @pa/duel's log names a verdict on every round because the SERVER minted it.
  // The guard used to reject the body for it and the client dropped the log to
  // save the clear, which lost the server its own telemetry to protect against
  // a claim the server does not read. The subtree is exempt; nothing else is.
  assert.equal(
    CommitMissionOutcomeRequestSchema.safeParse({
      attemptId,
      outcome: "CLEARED",
      committedEvents: [
        { type: "DUEL_ROUND", verdict: "CORRECT", bullets: 3 },
        { type: "DUEL_RESOLVED", winner: "A", score: { a: 6, b: 0 } },
      ],
      baseRevision: 0,
    }).success,
    true,
  );

  // The exemption is by field name at depth zero, so it cannot be borrowed by
  // a request that merely contains something called `committedEvents`.
  assert.equal(
    CompleteLearningModuleRequestSchema.safeParse({
      chapterId: "CH.ONE",
      moduleId: "MOD.M1",
      gatesKind: "MISSION_ATTEMPT",
      gatesId: "M1",
      acknowledgedCueIds: ["CUE.1"],
      observedSeconds: 174,
      committedEvents: [{ awardedXp: 900 }],
    }).success,
    false,
    "and .strict() still refuses a field the schema does not declare",
  );
});
