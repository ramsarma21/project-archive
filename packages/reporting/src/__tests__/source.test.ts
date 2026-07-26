import assert from "node:assert/strict";
import { test } from "node:test";

import { evidenceFromDurableRows } from "../source.js";
import { buildStudentChapterReport } from "../student.js";
import {
  attemptUuid,
  conceptId,
  fixtureStandards,
  makeDurableRows,
  subject,
  PROFILE_A,
} from "./harness.js";

// The rows a student who mastered ALPHA first time, repaired BETA on a retry,
// still owes GAMMA, and was never asked DELTA because its pool is too small.
function typicalRows() {
  return makeDurableRows({
    conceptSlugs: ["ALPHA", "BETA", "GAMMA", "DELTA"],
    attempts: [
      {
        attemptId: attemptUuid(1),
        attemptOrdinal: 1,
        scopedSlugs: ["ALPHA", "BETA", "GAMMA"],
        status: "SUBMITTED",
        scoreNumerator: 2,
        scoreDenominator: 6,
        startedAt: "2026-02-01T09:40:00.000Z",
        submittedAt: "2026-02-01T10:00:00.000Z",
      },
      {
        attemptId: attemptUuid(2),
        attemptOrdinal: 2,
        scopedSlugs: ["BETA", "GAMMA"],
        status: "SUBMITTED",
        scoreNumerator: 2,
        scoreDenominator: 4,
        startedAt: "2026-02-08T09:40:00.000Z",
        submittedAt: "2026-02-08T10:00:00.000Z",
      },
    ],
    mastery: [
      {
        slug: "ALPHA",
        itemsServed: 2,
        itemsCorrect: 2,
        firstAttemptServed: 2,
        firstAttemptCorrect: 2,
        masteredAt: "2026-02-01T10:00:00.000Z",
      },
      {
        slug: "BETA",
        itemsServed: 4,
        itemsCorrect: 2,
        firstAttemptServed: 2,
        firstAttemptCorrect: 0,
        masteredAt: "2026-02-08T10:00:00.000Z",
      },
      {
        slug: "GAMMA",
        itemsServed: 4,
        itemsCorrect: 1,
        firstAttemptServed: 2,
        firstAttemptCorrect: 0,
        masteredAt: null,
      },
    ],
  });
}

test("the rebuild recovers unaided mastery exactly, with no inference", () => {
  const evidence = evidenceFromDurableRows(typicalRows());
  const byId = new Map(evidence.concepts.map((row) => [row.conceptId, row]));

  assert.equal(byId.get(conceptId("ALPHA"))?.outcome, "MASTERED_UNAIDED");
  assert.equal(byId.get(conceptId("ALPHA"))?.masteredOnAttempt, 1);
  assert.equal(byId.get(conceptId("BETA"))?.outcome, "MASTERED_AFTER_SUPPORT");
  assert.equal(
    byId.get(conceptId("BETA"))?.masteredOnAttempt,
    2,
    "matched by the mastering attempt's submission time",
  );
});

test("the rebuild separates a student gap from an item shortage", () => {
  const evidence = evidenceFromDurableRows(typicalRows());
  const byId = new Map(evidence.concepts.map((row) => [row.conceptId, row]));

  assert.equal(
    byId.get(conceptId("GAMMA"))?.outcome,
    "NOT_YET_MASTERED",
    "asked twice, still owed",
  );
  assert.equal(
    byId.get(conceptId("DELTA"))?.outcome,
    "NOT_MEASURED_ITEM_SHORTAGE",
    "absent from attempt 1's scope means the bank could not ask it",
  );
  assert.equal(byId.get(conceptId("DELTA"))?.firstSitting, null);
  assert.equal(byId.get(conceptId("DELTA"))?.pvpLegal, false);
});

test("a lost disclosure comes back as null, never as false", () => {
  const evidence = evidenceFromDurableRows(typicalRows());
  for (const concept of evidence.concepts) {
    assert.equal(
      concept.masteredWithRecycledItems,
      null,
      "false would claim the evidence was fresh on a column we never wrote",
    );
  }
  for (const attempt of evidence.attempts) {
    assert.equal(attempt.hadRecycledItems, null);
  }
  assert.equal(evidence.reportedFormProvenance, null);
  assert.deepEqual([...evidence.itemsAwaitingGradingReview], []);
});

test("the rebuild names every disclosure it could not recover", () => {
  const evidence = evidenceFromDurableRows(typicalRows());
  assert.equal(evidence.fidelity, "REBUILT_FROM_PROJECTIONS");
  assert.ok(
    evidence.disclosureGaps.includes("RECYCLED_ITEM_DISCLOSURE_UNAVAILABLE"),
  );
  assert.ok(evidence.disclosureGaps.includes("FORM_PROVENANCE_UNAVAILABLE"));
  assert.ok(evidence.disclosureGaps.includes("GRADING_REVIEW_FLAGS_UNAVAILABLE"));

  const report = buildStudentChapterReport({
    subject: subject(PROFILE_A),
    evidence,
    standards: fixtureStandards([
      { slug: "ALPHA", status: "MASTERED_FIRST_ATTEMPT" },
      { slug: "BETA", status: "MASTERED_AFTER_RETRY" },
      { slug: "GAMMA", status: "NOT_MASTERED" },
      { slug: "DELTA", status: "NOT_ASSESSED_CONTENT_GAP" },
    ]),
    generatedAt: "2026-03-01T00:00:00.000Z",
  });
  assert.ok(report.claim.qualifiers.includes("DISCLOSURES_INCOMPLETE"));
  assert.equal(
    report.claim.strength,
    "INSTRUCTIONAL_ONLY",
    "a rebuilt report can never reach the summative tier",
  );
  assert.equal(
    report.byConcept.find((row) => row.conceptId === conceptId("ALPHA"))
      ?.evidenceStrength,
    "NOT_RECORDED",
  );
});

test("before attempt 1 exists there is no shortage signal, so nothing is blamed", () => {
  const evidence = evidenceFromDurableRows(
    makeDurableRows({
      conceptSlugs: ["ALPHA", "BETA"],
      attempts: [],
      mastery: [],
    }),
  );
  for (const concept of evidence.concepts) {
    assert.equal(
      concept.outcome,
      "NOT_MEASURED_NOT_SAT",
      "an empty bank and an unsat capstone look identical, so claim neither",
    );
  }
  assert.equal(evidence.firstSitting, null);
  assert.equal(evidence.chapterUnlocked, false);
});

test("an abandoned first attempt produces no first-sitting measure", () => {
  const evidence = evidenceFromDurableRows(
    makeDurableRows({
      conceptSlugs: ["ALPHA"],
      attempts: [
        {
          attemptId: attemptUuid(1),
          attemptOrdinal: 1,
          scopedSlugs: ["ALPHA"],
          status: "ABANDONED",
          scoreNumerator: null,
          scoreDenominator: null,
          startedAt: "2026-02-01T09:40:00.000Z",
          submittedAt: null,
        },
        {
          attemptId: attemptUuid(2),
          attemptOrdinal: 2,
          scopedSlugs: ["ALPHA"],
          status: "SUBMITTED",
          scoreNumerator: 2,
          scoreDenominator: 2,
          startedAt: "2026-02-08T09:40:00.000Z",
          submittedAt: "2026-02-08T10:00:00.000Z",
        },
      ],
      mastery: [
        {
          slug: "ALPHA",
          itemsServed: 4,
          itemsCorrect: 2,
          firstAttemptServed: 0,
          firstAttemptCorrect: 0,
          masteredAt: "2026-02-08T10:00:00.000Z",
        },
      ],
    }),
  );

  assert.equal(
    evidence.firstSitting,
    null,
    "walking out of a bad form must not promote the retry into the reported slot",
  );
  assert.equal(evidence.concepts[0]?.outcome, "MASTERED_AFTER_SUPPORT");
});

test("the rebuild opens the chapter only when every gating concept is mastered", () => {
  const evidence = evidenceFromDurableRows(typicalRows());
  assert.equal(evidence.chapterUnlocked, false, "GAMMA is still owed");
});
