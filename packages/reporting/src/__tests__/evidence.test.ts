import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MEASURE_CURRENT,
  MEASURE_FIRST_SITTING,
  evidenceProfileIsPartition,
  outcomeOwner,
  summariseOutcomes,
} from "../evidence.js";
import { MISSION_PERFORMANCE_IS_NOT_ACADEMIC_EVIDENCE } from "../student.js";
import {
  allKeys,
  conceptId,
  makeStudentReport,
  type ConceptSpec,
} from "./harness.js";

const MASTERED: ConceptSpec = {
  slug: "ALPHA",
  status: "MASTERED_FIRST_ATTEMPT",
  firstAttempt: { correct: 2, served: 2 },
};
const REPAIRED: ConceptSpec = {
  slug: "BETA",
  status: "MASTERED_AFTER_RETRY",
  firstAttempt: { correct: 0, served: 2 },
  masteredOnAttempt: 2,
};
const MISSED: ConceptSpec = {
  slug: "GAMMA",
  status: "NOT_MASTERED",
  firstAttempt: { correct: 1, served: 2 },
};
const SHORTAGE: ConceptSpec = { slug: "DELTA", status: "NOT_ASSESSED_CONTENT_GAP" };

// ---------------------------------------------------------------------------
// The two measures
// ---------------------------------------------------------------------------

test("the two measures are separate fields that each carry their own identity", () => {
  const report = makeStudentReport({
    concepts: [MASTERED, REPAIRED],
    reportedScore: { numerator: 2, denominator: 4 },
  });

  assert.equal(report.firstSitting?.measure, MEASURE_FIRST_SITTING);
  assert.equal(report.currentStanding.measure, MEASURE_CURRENT);
  assert.notEqual(report.firstSitting?.label, report.currentStanding.label);
  // The number cannot travel without the sentence that says what it is.
  assert.match(report.firstSitting?.basis ?? "", /Attempt 1 only/);
  assert.match(report.currentStanding.basis, /never be reported as one/);
});

test("a retry repairs mastery and does not touch the first sitting", () => {
  const report = makeStudentReport({
    concepts: [MASTERED, REPAIRED],
    reportedScore: { numerator: 2, denominator: 4 },
  });

  assert.equal(report.firstSitting?.itemsCorrect, 2, "what they knew unaided");
  assert.equal(report.firstSitting?.conceptsMasteredUnaided, 1);
  assert.equal(report.currentStanding.conceptsMastered, 2, "what they know now");
  assert.equal(report.currentStanding.percent, 100);
  assert.deepEqual(
    [...report.currentStanding.repairedConceptIds],
    [conceptId("BETA")],
  );
});

test("the gap between the measures is reported, and says who did the teaching", () => {
  const taughtByRetry = makeStudentReport({
    concepts: [REPAIRED, { ...REPAIRED, slug: "BETA2" }],
    reportedScore: { numerator: 0, denominator: 4 },
  });
  assert.equal(taughtByRetry.repair.unaidedMasteryPercent, 0);
  assert.equal(taughtByRetry.repair.currentMasteryPercent, 100);
  assert.equal(taughtByRetry.repair.pointsGained, 100);
  assert.equal(taughtByRetry.repair.interpretation, "TAUGHT_BY_THE_RETRY");

  const taughtByChapter = makeStudentReport({
    concepts: [MASTERED, { ...MASTERED, slug: "ALPHA2" }],
    reportedScore: { numerator: 4, denominator: 4 },
  });
  assert.equal(taughtByChapter.repair.pointsGained, 0);
  assert.equal(taughtByChapter.repair.interpretation, "TAUGHT_BY_THE_CHAPTER");

  const unresolved = makeStudentReport({
    concepts: [MASTERED, MISSED],
    reportedScore: { numerator: 3, denominator: 4 },
  });
  assert.equal(unresolved.repair.interpretation, "NOT_YET_RESOLVED");
});

test("no first sitting means no academic measure, and the claim says so", () => {
  const report = makeStudentReport({
    concepts: [{ slug: "ALPHA", status: "NOT_ATTEMPTED" }],
    reportedScore: null,
  });

  assert.equal(report.firstSitting, null);
  assert.equal(report.repair.interpretation, "NO_FIRST_SITTING");
  assert.equal(report.claim.strength, "NONE");
  assert.ok(report.claim.qualifiers.includes("NO_FIRST_SITTING"));
});

test("a human review moves the first sitting and shows both numbers", () => {
  const report = makeStudentReport({
    concepts: [MASTERED],
    reportedScore: { numerator: 2, denominator: 2, asSubmittedNumerator: 1 },
  });

  assert.equal(report.firstSitting?.itemsCorrect, 2, "the corrected number");
  assert.equal(
    report.firstSitting?.asSubmitted?.itemsCorrect,
    1,
    "and what was originally reported is still visible",
  );
  assert.equal(report.firstSitting?.revisedByReview, true);
  assert.ok(report.claim.qualifiers.includes("SCORE_REVISED_BY_REVIEW"));
});

test("no field in a report is a bare score, grade, or unlabelled percent", () => {
  const report = makeStudentReport({
    concepts: [MASTERED, MISSED],
    reportedScore: { numerator: 3, denominator: 4 },
  });
  const roots = Object.keys(report);
  for (const forbidden of ["score", "grade", "percent", "mark", "result"]) {
    assert.ok(
      !roots.includes(forbidden),
      `a root field called "${forbidden}" is a number with no measure attached`,
    );
  }
});

// ---------------------------------------------------------------------------
// Student gap versus item shortage
// ---------------------------------------------------------------------------

test("a concept we could not ask is never counted as a concept the student missed", () => {
  const report = makeStudentReport({
    concepts: [MASTERED, MISSED, SHORTAGE],
    reportedScore: { numerator: 3, denominator: 4 },
  });

  assert.equal(report.evidence.studentGaps, 1, "GAMMA, and only GAMMA");
  assert.equal(report.evidence.coverageDebt, 1, "DELTA, in its own field");
  assert.deepEqual(
    [...report.coverageDebtConceptIds],
    [conceptId("DELTA")],
    "and named, so it becomes a content work item",
  );

  const gamma = report.byConcept.find(
    (row) => row.conceptId === conceptId("GAMMA"),
  );
  const delta = report.byConcept.find(
    (row) => row.conceptId === conceptId("DELTA"),
  );
  assert.equal(gamma?.owner, "STUDENT");
  assert.equal(delta?.owner, "PRODUCT");
  assert.equal(delta?.measured, false);
  assert.equal(delta?.firstSitting, null, "not zero — nobody asked");
  assert.equal(delta?.pvpLegal, false);
});

test("adding an unaskable concept never moves the student's own gap count", () => {
  const withoutShortage = makeStudentReport({
    concepts: [MASTERED, MISSED],
    reportedScore: { numerator: 3, denominator: 4 },
  });
  const withShortage = makeStudentReport({
    concepts: [MASTERED, MISSED, SHORTAGE],
    reportedScore: { numerator: 3, denominator: 4 },
  });

  assert.equal(withoutShortage.evidence.studentGaps, 1);
  assert.equal(
    withShortage.evidence.studentGaps,
    1,
    "our content debt cannot inflate a statement about what this child owes",
  );
  assert.equal(withShortage.evidence.coverageDebt, 1);
  assert.equal(
    withShortage.currentStanding.conceptsRequired,
    2,
    "and it is out of the denominator too, rather than counting as a failure",
  );
});

test("no field on the evidence profile is a combined outstanding total", () => {
  const report = makeStudentReport({
    concepts: [MISSED, SHORTAGE],
    reportedScore: { numerator: 1, denominator: 2 },
  });
  const named = new Set(Object.keys(report.evidence));
  for (const forbidden of [
    "outstanding",
    "conceptsOutstanding",
    "notMastered",
    "remaining",
    "incomplete",
  ]) {
    assert.ok(
      !named.has(forbidden),
      `"${forbidden}" is the field name under which the two gaps merge`,
    );
  }
  assert.ok(named.has("studentGaps") && named.has("coverageDebt"));
});

test("the evidence buckets partition the chapter", () => {
  const profile = summariseOutcomes([
    "MASTERED_UNAIDED",
    "MASTERED_AFTER_SUPPORT",
    "NOT_YET_MASTERED",
    "NOT_MEASURED_ITEM_SHORTAGE",
    "NOT_MEASURED_NOT_SAT",
  ]);
  assert.ok(evidenceProfileIsPartition(profile));
  assert.equal(profile.conceptsInChapter, 5);
  assert.equal(profile.measuredConcepts, 3, "the shortage and the unsat are not");
});

test("every outcome has exactly one owner, and only a shortage is ours", () => {
  assert.equal(outcomeOwner("MASTERED_UNAIDED"), "NOBODY");
  assert.equal(outcomeOwner("MASTERED_AFTER_SUPPORT"), "NOBODY");
  assert.equal(outcomeOwner("NOT_YET_MASTERED"), "STUDENT");
  assert.equal(outcomeOwner("NOT_MEASURED_NOT_SAT"), "STUDENT");
  assert.equal(outcomeOwner("NOT_MEASURED_ITEM_SHORTAGE"), "PRODUCT");
});

test("a partially covered chapter says its score is over a subset", () => {
  const report = makeStudentReport({
    concepts: [MASTERED, SHORTAGE],
    reportedScore: { numerator: 2, denominator: 2 },
  });
  assert.equal(report.firstSitting?.percent, 100);
  assert.equal(
    report.firstSitting?.coversWholeChapter,
    false,
    "100% of half a chapter is not 100% of a chapter",
  );
  assert.ok(report.claim.qualifiers.includes("PARTIAL_CHAPTER_COVERAGE"));
});

// ---------------------------------------------------------------------------
// Recycled evidence
// ---------------------------------------------------------------------------

test("mastery shown on a repeated item is disclosed rather than hidden", () => {
  const report = makeStudentReport({
    concepts: [{ ...REPAIRED, recycled: true }],
    reportedScore: { numerator: 0, denominator: 2 },
  });
  const row = report.byConcept[0];
  assert.equal(row?.evidenceStrength, "RECYCLED_ITEMS");
  assert.ok(report.claim.qualifiers.includes("MASTERY_ON_RECYCLED_ITEMS"));
});

test("an unmastered concept has no evidence strength to report", () => {
  const report = makeStudentReport({
    concepts: [MISSED],
    reportedScore: { numerator: 1, denominator: 2 },
  });
  assert.equal(report.byConcept[0]?.evidenceStrength, "NOT_APPLICABLE");
});

// ---------------------------------------------------------------------------
// Mission performance
// ---------------------------------------------------------------------------

test("reporting excludes mission performance entirely", () => {
  assert.equal(MISSION_PERFORMANCE_IS_NOT_ACADEMIC_EVIDENCE, true);
  const report = makeStudentReport({
    concepts: [MASTERED, MISSED, SHORTAGE],
    reportedScore: { numerator: 3, denominator: 4 },
  });
  const forbidden = /^(xp|awardedXp|level|rank|mission|missionId|duel|pvp)/i;
  const offenders = allKeys(JSON.parse(JSON.stringify(report))).filter(
    (key) => forbidden.test(key) && key !== "awardedXp" && key !== "pvpLegal",
  );
  assert.deepEqual(
    offenders,
    [],
    "a dexterity number beside a TEKS standard reads as achievement",
  );
});

test("the report states that the capstone pays nothing", () => {
  const report = makeStudentReport({
    concepts: [MASTERED],
    reportedScore: { numerator: 2, denominator: 2 },
  });
  assert.equal(report.awardedXp, 0);
});
