import assert from "node:assert/strict";
import { test } from "node:test";

import { ROSTER_PRIMARY_NEEDS, buildRosterView } from "../roster.js";
import {
  CHAPTER,
  PROFILE_A,
  PROFILE_B,
  PROFILE_C,
  conceptId,
  makeStudentReport,
  subject,
  type ConceptSpec,
} from "./harness.js";

const mastered = (slug: string): ConceptSpec => ({
  slug,
  status: "MASTERED_FIRST_ATTEMPT",
  firstAttempt: { correct: 2, served: 2 },
});
const missed = (slug: string): ConceptSpec => ({
  slug,
  status: "NOT_MASTERED",
  firstAttempt: { correct: 0, served: 2 },
});
const repaired = (slug: string): ConceptSpec => ({
  slug,
  status: "MASTERED_AFTER_RETRY",
  firstAttempt: { correct: 1, served: 2 },
  masteredOnAttempt: 2,
});

function roster(
  students: readonly {
    profileId: string;
    name: string;
    concepts: readonly ConceptSpec[];
    score?: { numerator: number; denominator: number } | null;
  }[],
) {
  return buildRosterView({
    chapterId: CHAPTER,
    generatedAt: "2026-03-01T00:00:00.000Z",
    reports: students.map((student) =>
      makeStudentReport({
        profileId: student.profileId,
        subject: subject(student.profileId, student.name),
        concepts: student.concepts,
        reportedScore:
          student.score === undefined
            ? { numerator: 2, denominator: student.concepts.length * 2 }
            : student.score,
      }),
    ),
  });
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

test("rows are ordered by who needs help, not alphabetically", () => {
  const view = roster([
    { profileId: PROFILE_A, name: "Aaron", concepts: [mastered("A"), mastered("B")] },
    { profileId: PROFILE_B, name: "Zoe", concepts: [missed("A"), missed("B")] },
    { profileId: PROFILE_C, name: "Mia", concepts: [mastered("A"), missed("B")] },
  ]);

  assert.deepEqual(
    view.rows.map((row) => row.displayName),
    ["Zoe", "Mia", "Aaron"],
    "two concepts owed, then one, then none — alphabetical would bury Zoe",
  );
  assert.deepEqual(
    view.rows.map((row) => row.status),
    ["NEEDS_HELP", "NEEDS_HELP", "SECURE"],
  );
});

test("the order is deterministic for identically placed students", () => {
  const build = () =>
    roster([
      { profileId: PROFILE_B, name: "Same", concepts: [missed("A")] },
      { profileId: PROFILE_A, name: "Same", concepts: [missed("A")] },
    ]);
  assert.deepEqual(
    build().rows.map((row) => row.profileId),
    build().rows.map((row) => row.profileId),
  );
  assert.equal(build().rows[0]?.profileId, PROFILE_A, "profile id breaks the tie");
});

test("every status is reachable and lands where triage expects it", () => {
  const view = buildRosterView({
    chapterId: CHAPTER,
    generatedAt: "2026-03-01T00:00:00.000Z",
    reports: [
      makeStudentReport({
        profileId: PROFILE_A,
        subject: subject(PROFILE_A, "Secure"),
        concepts: [mastered("A")],
        reportedScore: { numerator: 2, denominator: 2 },
      }),
      makeStudentReport({
        profileId: PROFILE_B,
        subject: subject(PROFILE_B, "Repaired"),
        concepts: [repaired("A")],
        reportedScore: { numerator: 1, denominator: 2 },
      }),
      makeStudentReport({
        profileId: PROFILE_C,
        subject: subject(PROFILE_C, "Never sat"),
        concepts: [{ slug: "A", status: "NOT_ATTEMPTED" }],
        reportedScore: null,
      }),
    ],
  });

  assert.deepEqual(
    view.rows.map((row) => row.status),
    ["NOT_STARTED", "REPAIRED", "SECURE"],
  );
  assert.ok(view.rows[0]?.flags.includes("NEVER_SAT"));
  assert.equal(view.summary.notStarted, 1);
  assert.equal(view.summary.repaired, 1);
  assert.equal(view.summary.secure, 1);
});

test("a chapter with nothing assessable reports as our failure, not theirs", () => {
  const view = roster([
    {
      profileId: PROFILE_A,
      name: "Blocked",
      concepts: [
        { slug: "A", status: "NOT_ASSESSED_CONTENT_GAP" },
        { slug: "B", status: "NOT_ASSESSED_CONTENT_GAP" },
      ],
      score: null,
    },
  ]);
  assert.equal(view.rows[0]?.status, "NOT_MEASURABLE");
  assert.equal(view.rows[0]?.conceptsOutstanding, 0);
  assert.equal(view.rows[0]?.coverageDebtConcepts, 2);
  assert.equal(view.coverage.scoresCoverWholeChapter, false);
});

// ---------------------------------------------------------------------------
// The whole-class action
// ---------------------------------------------------------------------------

test("the class need list turns thirty rows into a handful of reteaches", () => {
  const view = roster([
    { profileId: PROFILE_A, name: "A", concepts: [missed("TAXATION"), mastered("STAMP")] },
    { profileId: PROFILE_B, name: "B", concepts: [missed("TAXATION"), mastered("STAMP")] },
    { profileId: PROFILE_C, name: "C", concepts: [missed("TAXATION"), missed("STAMP")] },
  ]);

  assert.deepEqual(
    view.conceptsNeededByClass.map((need) => [
      need.conceptId,
      need.studentsOutstanding,
    ]),
    [
      [conceptId("TAXATION"), 3],
      [conceptId("STAMP"), 1],
    ],
  );
  assert.equal(view.conceptsNeededByClass[0]?.shareOfClassPercent, 100);
  assert.equal(view.conceptsNeededByClass[0]?.seCodeBare, "8.4A");
  assert.deepEqual([...(view.conceptsNeededByClass[1]?.profileIds ?? [])], [
    PROFILE_C,
  ]);
});

test("a row's named needs are ordered by what the class shares", () => {
  const view = roster([
    { profileId: PROFILE_A, name: "A", concepts: [missed("SHARED")] },
    { profileId: PROFILE_B, name: "B", concepts: [missed("SHARED")] },
    {
      profileId: PROFILE_C,
      name: "C",
      concepts: [missed("RARE"), missed("SHARED")],
    },
  ]);

  const rowC = view.rows.find((row) => row.profileId === PROFILE_C);
  assert.deepEqual(
    rowC?.primaryNeeds.map((need) => need.conceptId),
    [conceptId("SHARED"), conceptId("RARE")],
    "the class-wide concept sits leftmost so the columns line up down the page",
  );
});

test("a row names at most three concepts and counts the rest", () => {
  const many = ["A", "B", "C", "D", "E"].map(missed);
  const view = roster([{ profileId: PROFILE_A, name: "A", concepts: many }]);
  assert.equal(view.rows[0]?.primaryNeeds.length, ROSTER_PRIMARY_NEEDS);
  assert.equal(view.rows[0]?.additionalNeedCount, 2);
});

// ---------------------------------------------------------------------------
// The two gap columns
// ---------------------------------------------------------------------------

test("the student's work and our content debt are separate columns", () => {
  const view = roster([
    {
      profileId: PROFILE_A,
      name: "A",
      concepts: [
        mastered("OK"),
        missed("OWED"),
        { slug: "UNASKED", status: "NOT_ASSESSED_CONTENT_GAP" },
      ],
    },
  ]);

  const row = view.rows[0];
  assert.equal(row?.conceptsOutstanding, 1, "OWED only");
  assert.equal(row?.coverageDebtConcepts, 1, "UNASKED, in its own column");
  assert.deepEqual(
    row?.primaryNeeds.map((need) => need.conceptId),
    [conceptId("OWED")],
    "a concept nobody asked is never named as something to reteach",
  );
  assert.ok(row?.flags.includes("PARTIAL_CHAPTER_COVERAGE"));
  assert.deepEqual(
    [...view.coverage.coverageDebtConceptIds],
    [conceptId("UNASKED")],
  );
});

test("a concept nobody could ask never reaches the class reteach list", () => {
  const view = roster([
    {
      profileId: PROFILE_A,
      name: "A",
      concepts: [{ slug: "UNASKED", status: "NOT_ASSESSED_CONTENT_GAP" }],
      score: null,
    },
    {
      profileId: PROFILE_B,
      name: "B",
      concepts: [{ slug: "UNASKED", status: "NOT_ASSESSED_CONTENT_GAP" }],
      score: null,
    },
  ]);
  assert.deepEqual([...view.conceptsNeededByClass], []);
  assert.equal(view.coverage.conceptsWithCoverageDebt, 1);
});

// ---------------------------------------------------------------------------
// The header, the summary, and the refusals
// ---------------------------------------------------------------------------

test("the column legend names each measure so cells can hold bare numbers", () => {
  const view = roster([{ profileId: PROFILE_A, name: "A", concepts: [mastered("A")] }]);
  assert.match(view.columns.firstSittingPercent.label, /unaided/i);
  assert.match(view.columns.currentMasteryPercent.label, /after support/i);
  assert.match(view.columns.coverageDebtConcepts.basis, /never scored against them/);
});

test("the median ignores students who never sat", () => {
  const view = roster([
    {
      profileId: PROFILE_A,
      name: "A",
      concepts: [mastered("A")],
      score: { numerator: 2, denominator: 2 },
    },
    {
      profileId: PROFILE_B,
      name: "B",
      concepts: [missed("A")],
      score: { numerator: 1, denominator: 2 },
    },
    {
      profileId: PROFILE_C,
      name: "C",
      concepts: [{ slug: "A", status: "NOT_ATTEMPTED" }],
      score: null,
    },
  ]);
  assert.equal(view.summary.studentsWithFirstSitting, 2);
  assert.equal(view.summary.medianFirstSittingPercent, 75);
});

test("two reports for the same student and chapter are a hard error", () => {
  const report = makeStudentReport({
    profileId: PROFILE_A,
    concepts: [mastered("A")],
    reportedScore: { numerator: 2, denominator: 2 },
  });
  assert.throws(
    () =>
      buildRosterView({
        chapterId: CHAPTER,
        reports: [report, report],
        generatedAt: "2026-03-01T00:00:00.000Z",
      }),
    /same profile and chapter/,
  );
});

test("a report from another chapter cannot be smuggled onto the page", () => {
  assert.throws(
    () =>
      buildRosterView({
        chapterId: CHAPTER,
        reports: [
          makeStudentReport({
            profileId: PROFILE_A,
            chapterId: "CHAPTER.PHILADELPHIA",
            concepts: [mastered("A")],
            reportedScore: { numerator: 2, denominator: 2 },
          }),
        ],
        generatedAt: "2026-03-01T00:00:00.000Z",
      }),
    /but a report is for CHAPTER.PHILADELPHIA/,
  );
});

test("an empty roster is a legal page rather than an error", () => {
  const view = buildRosterView({
    chapterId: CHAPTER,
    reports: [],
    generatedAt: "2026-03-01T00:00:00.000Z",
  });
  assert.equal(view.summary.students, 0);
  assert.equal(view.summary.medianFirstSittingPercent, null);
  assert.equal(view.claim.strength, "NONE");
});
