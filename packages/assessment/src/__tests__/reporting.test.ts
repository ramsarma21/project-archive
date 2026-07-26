import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attemptRows,
  buildChapterAssessmentReport,
  chapterReportKey,
  conceptLedgerRows,
  conceptMasteryRows,
  mintAssessmentVerdict,
  reduceAssessment,
  responseRows,
  teacherReportSet,
  type ChapterAssessmentReport,
} from "../index.js";
import {
  CHAPTER,
  PROFILE_ID,
  answerAll,
  answerNone,
  conceptId,
  makeFixture,
  masterOnly,
  newSession,
  sit,
  type Fixture,
  type Session,
} from "./harness.js";

function report(session: Session, fixture: Fixture): ChapterAssessmentReport {
  return buildChapterAssessmentReport({
    record: reduceAssessment(session.events, {
      blueprint: fixture.blueprint,
      concepts: fixture.concepts,
    }),
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
    bank: fixture.bank,
  });
}

// ---------------------------------------------------------------------------
// The two numbers
// ---------------------------------------------------------------------------

test("the reported score is the first attempt's, and retries do not repair it", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA", "GAMMA", "DELTA"],
    reserve: 6,
  });
  const session = newSession(fixture);

  await sit(session, masterOnly("ALPHA"));
  const afterFirst = report(session, fixture);
  assert.equal(afterFirst.reportedScore?.numerator, 2);
  assert.equal(afterFirst.reportedScore?.denominator, 8);
  assert.equal(afterFirst.masteryNow.masteredConcepts, 1);

  // Repair everything else across two more attempts.
  await sit(session, masterOnly("BETA", "GAMMA"));
  await sit(session, answerAll);

  const final = report(session, fixture);
  assert.equal(
    final.reportedScore?.numerator,
    2,
    "the measure of what the student knew first time does not move",
  );
  assert.equal(final.reportedScore?.denominator, 8);
  assert.equal(final.masteryNow.masteredConcepts, 4, "but readiness is complete");
  assert.equal(final.masteryNow.gatingConcepts, 4);
  assert.equal(final.unlock.kind, "UNLOCKED");
});

test("a per-concept row distinguishes first-attempt mastery from a repair", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));
  await sit(session, answerAll);

  const rows = new Map(
    report(session, fixture).byConcept.map((row) => [row.conceptId, row]),
  );
  assert.equal(rows.get(conceptId("ALPHA"))?.status, "MASTERED_FIRST_ATTEMPT");
  assert.equal(rows.get(conceptId("BETA"))?.status, "MASTERED_AFTER_RETRY");
  assert.equal(rows.get(conceptId("BETA"))?.masteredOnAttempt, 2);

  // The first-attempt detail survives on the repaired concept too.
  assert.equal(rows.get(conceptId("BETA"))?.firstAttempt?.correct, 0);
  assert.equal(rows.get(conceptId("BETA"))?.firstAttempt?.served, 2);
  assert.equal(rows.get(conceptId("BETA"))?.firstAttempt?.percent, 0);

  assert.deepEqual(
    [...report(session, fixture).masteryNow.repairedConceptIds],
    [conceptId("BETA")],
  );
});

test("a concept never asked on attempt 1 has no first-attempt score at all", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "GAP"],
    reserve: { ALPHA: 6, GAP: 1 },
  });
  const session = newSession(fixture);
  await sit(session, answerAll);

  const rows = new Map(
    report(session, fixture).byConcept.map((row) => [row.conceptId, row]),
  );
  assert.equal(rows.get(conceptId("GAP"))?.status, "NOT_ASSESSED_CONTENT_GAP");
  assert.equal(
    rows.get(conceptId("GAP"))?.firstAttempt,
    null,
    "not zero — a concept nobody asked did not score zero",
  );
  assert.equal(rows.get(conceptId("GAP"))?.pvpLegal, false);
  assert.deepEqual([...report(session, fixture).contentGaps], [conceptId("GAP")]);
});

test("the report states that the capstone pays nothing", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll);
  assert.equal(report(session, fixture).awardedXp, 0);
});

test("no attempt yet means no reported score, and the gate says so", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const empty = report(session, fixture);

  assert.equal(empty.reportedScore, null);
  assert.equal(empty.unlock.kind, "BLOCKED");
  assert.equal(empty.unlock.kind === "BLOCKED" && empty.unlock.reason, "NOT_ATTEMPTED");
  assert.equal(empty.byConcept[0]?.status, "NOT_ATTEMPTED");
});

// ---------------------------------------------------------------------------
// Keyed by chapter
// ---------------------------------------------------------------------------

test("a report is keyed by profile AND chapter", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll);

  const built = report(session, fixture);
  assert.equal(built.reportKey, chapterReportKey(PROFILE_ID, CHAPTER));
  assert.equal(built.chapterId, CHAPTER);
  assert.notEqual(built.reportKey, PROFILE_ID);
});

test("two chapters for one student coexist rather than overwriting each other", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll);
  const boston = report(session, fixture);
  const philadelphia: ChapterAssessmentReport = {
    ...boston,
    chapterId: "CHAPTER.PHILADELPHIA",
    reportKey: chapterReportKey(PROFILE_ID, "CHAPTER.PHILADELPHIA"),
  };

  const set = teacherReportSet([boston, philadelphia]);
  assert.equal(set.size, 2, "the bug this replaces collapsed these into one row");
  assert.ok(set.get(boston.reportKey));
  assert.ok(set.get(philadelphia.reportKey));
});

test("two reports for the same chapter are a hard error, not a last-write-wins", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll);
  const built = report(session, fixture);

  assert.throws(
    () => teacherReportSet([built, built]),
    /same profile and chapter/,
    "silently keeping one is how evidence disappears",
  );
});

test("persisted mastery rows carry the chapter id and both counter pairs", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, masterOnly("ALPHA"));
  await sit(session, answerAll);

  const record = reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const rows = new Map(
    conceptMasteryRows(record, "2026-02-02T00:00:00.000Z").map((row) => [
      row.conceptId,
      row,
    ]),
  );

  const beta = rows.get(conceptId("BETA"));
  assert.equal(beta?.chapterId, CHAPTER, "keyed by chapter, not profile alone");
  assert.equal(beta?.profileId, PROFILE_ID);
  assert.equal(beta?.firstAttemptCorrect, 0, "the reported measure");
  assert.equal(beta?.firstAttemptServed, 2);
  assert.equal(beta?.itemsCorrect, 2, "and the repaired cumulative state");
  assert.equal(beta?.itemsServed, 4);
  assert.ok(beta?.masteredAt);
});

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

test("the reported form's provenance is counted per item, not claimed", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA"],
    reserve: 2,
    releasedTeaSlugs: ["ALPHA", "BETA"],
    openResponseSlugs: ["BETA"],
  });
  const session = newSession(fixture);
  await sit(session, answerAll);

  const provenance = report(session, fixture).reportedFormProvenance;
  assert.equal(provenance?.total, 4);
  assert.equal(provenance?.releasedTea, 2, "one released item per concept");
  assert.equal(provenance?.authored, 2);
  assert.equal(provenance?.openResponse, 1);
  assert.equal(provenance?.samplerNotConfirmed, 0);
  assert.equal(provenance?.releasedTeaItemIds.length, 2);
});

test("a retry's provenance is not averaged into the reported form's", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    releasedTeaSlugs: ["ALPHA"],
  });
  const session = newSession(fixture);
  await sit(session, answerNone);
  await sit(session, answerAll);

  const provenance = report(session, fixture).reportedFormProvenance;
  assert.equal(provenance?.total, 2, "the reported form has two items, not four");
  assert.equal(report(session, fixture).attempts.length, 2);
});

// ---------------------------------------------------------------------------
// Human review
// ---------------------------------------------------------------------------

test("a review that corrects attempt 1 moves the reported score and says it did", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    openResponseSlugs: ["ALPHA"],
  });
  const session = newSession(fixture);
  await sit(session, ({ indexInConcept }) =>
    indexInConcept === 0 ? "WRONG" : "CORRECT",
  );

  const before = report(session, fixture);
  assert.equal(before.reportedScore?.numerator, 1);
  assert.equal(before.reportedScore?.revisedByReview, false);
  assert.equal(before.masteryNow.masteredConcepts, 0);

  // A correct-but-unusually-worded answer the classifier called wrong.
  const attempt = before.attempts[0];
  const record = reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const itemId = record.attempts[0]?.form[0]?.itemIds[0];
  assert.ok(attempt && itemId);

  session.events = [
    ...session.events,
    {
      type: "VERDICT_OVERRIDDEN",
      attemptId: attempt.attemptId,
      itemId,
      conceptId: conceptId("ALPHA"),
      verdict: mintAssessmentVerdict({
        kind: "CORRECT",
        itemId,
        itemVersion: "v1",
        source: "HUMAN_REVIEW",
      }),
      reviewerId: "teacher-1",
      reason: "correct but unusually worded; classifier missed it",
      at: "2026-03-03T00:00:00.000Z",
    },
  ];

  const after = report(session, fixture);
  assert.equal(after.reportedScore?.numerator, 2, "the mis-grade is corrected");
  assert.equal(
    after.reportedScore?.asSubmittedNumerator,
    1,
    "and what was originally reported is still visible",
  );
  assert.equal(after.reportedScore?.revisedByReview, true);
  assert.equal(
    after.masteryNow.masteredConcepts,
    1,
    "a corrected verdict can complete a concept",
  );
  assert.equal(after.byConcept[0]?.status, "MASTERED_FIRST_ATTEMPT");
});

test("both verdicts stay in the log after a review", async () => {
  const { verdictHistory } = await import("../events.js");
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerNone);

  const record = reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const attemptId = record.attempts[0]?.attemptId ?? "";
  const itemId = record.attempts[0]?.form[0]?.itemIds[0] ?? "";

  session.events = [
    ...session.events,
    {
      type: "VERDICT_OVERRIDDEN",
      attemptId,
      itemId,
      conceptId: conceptId("ALPHA"),
      verdict: mintAssessmentVerdict({
        kind: "CORRECT",
        itemId,
        itemVersion: "v1",
        source: "HUMAN_REVIEW",
      }),
      reviewerId: "teacher-1",
      reason: "scored in error",
      at: "2026-03-03T00:00:00.000Z",
    },
  ];

  const history = verdictHistory(session.events, attemptId, itemId);
  assert.equal(history.length, 2, "a correction is an append, never an edit");
  assert.equal(history[0]?.kind, "INCORRECT");
  assert.equal(history[0]?.source, "ANSWER_KEY");
  assert.equal(history[1]?.kind, "CORRECT");
  assert.equal(history[1]?.source, "HUMAN_REVIEW");
});

test("a verdict flagged for review is surfaced without withholding the grade", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerAll, { openOnly: true });

  const record = reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const itemId = record.openAttempt?.form[0]?.itemIds[0] ?? "";
  session.events = [
    ...session.events,
    {
      type: "VERDICT_COMMITTED",
      attemptId: record.openAttempt?.attemptId ?? "",
      itemId,
      conceptId: conceptId("ALPHA"),
      verdict: mintAssessmentVerdict({
        kind: "CORRECT",
        itemId,
        itemVersion: "v1",
        source: "CLASSIFIER",
        needsReview: true,
      }),
      at: "2026-01-01T01:00:00.000Z",
    },
  ];

  assert.deepEqual([...report(session, fixture).needsGradingReview], [itemId]);
});

// ---------------------------------------------------------------------------
// Persistence projections
// ---------------------------------------------------------------------------

test("attempt rows mark exactly one attempt as the reported measure", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerNone);
  await sit(session, answerNone);
  await sit(session, answerAll);

  const record = reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const rows = attemptRows(record, "2026-02-02T00:00:00.000Z");
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.isReportedMeasure),
    [true, false, false],
  );
  assert.deepEqual(
    rows.map((row) => row.attemptOrdinal),
    [1, 2, 3],
  );
  assert.equal(rows[2]?.passed, true);
  for (const row of rows) {
    assert.equal(row.chapterId, CHAPTER);
    assert.equal(row.assessmentId, fixture.blueprint.assessmentId);
  }
});

test("response rows include unanswered items so a query sees everything asked", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, ({ indexInConcept }) =>
    indexInConcept === 0 ? "CORRECT" : "SKIP",
  );

  const record = reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const rows = responseRows(record);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((row) => row.correct).length, 1);
  const blank = rows.find((row) => !row.correct);
  assert.equal(
    blank?.selectedOptionId,
    null,
    "the contract's column is nullable now, so a blank needs no sentinel",
  );
  assert.equal(blank?.responseRef, null);
  assert.equal(blank?.itemFormat, "SELECTED_RESPONSE");
  assert.ok(blank?.answeredAt, "a row still needs a timestamp to be storable");
});

test("an open-response row carries its handle and no option id", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA"],
    reserve: 6,
    openResponseSlugs: ["ALPHA"],
  });
  const session = newSession(fixture);
  await sit(session, answerAll);

  const record = reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const rows = responseRows(record);
  const open = rows.filter((row) => row.itemFormat === "OPEN_RESPONSE");
  assert.equal(open.length, 1, "one of the two served items is open-ended");
  assert.equal(open[0]?.correct, true);
  assert.ok(open[0]?.responseRef, "the opaque handle, never the prose");
  assert.equal(
    open[0]?.selectedOptionId,
    null,
    "the contract refuses an option id on an open-response row",
  );
});

test("an abandoned attempt keeps its own status rather than looking submitted", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerNone, { abandon: true });

  const record = reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const rows = attemptRows(record, "2026-02-02T00:00:00.000Z");
  assert.equal(rows[0]?.status, "ABANDONED");
  assert.equal(rows[0]?.submittedAt, null);
  assert.equal(rows[0]?.scoreNumerator, null, "a walked-away form scored nothing");
});

test("the served ledger is reconstructed from the log, not stored beside it", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, answerNone);
  await sit(session, answerNone);

  const record = reduceAssessment(session.events, {
    blueprint: fixture.blueprint,
    concepts: fixture.concepts,
  });
  const ledger = conceptLedgerRows(record);
  assert.equal(ledger.length, 2);
  for (const entry of ledger) {
    assert.equal(entry.servedItemIds.length, 4);
    assert.equal(new Set(entry.servedItemIds).size, 4);
  }
});
