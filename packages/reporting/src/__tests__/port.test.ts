// The seam with apps/api.
//
// `apps/api/src/routes/reporting.ts` declares the narrow port it needs and takes
// an implementation as a parameter, because `apps/api/package.json` does not yet
// depend on this package and that file belongs to whoever owns the route table.
// The type-level assignability check therefore happens at the one wiring line in
// `app.ts`, which is the right place for it — but that check does not exist until
// the wiring lands, and until then a rename here would break the route silently.
//
// So this file pins the two things a rename would move: the method names the
// route calls, and the argument shape it passes. It is a shape test rather than a
// type test on purpose; a duplicated interface declaration would drift from the
// route's copy and prove nothing about it.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHAPTER_BOSTON,
  UnknownChapterError,
  isCurriculumChapterId,
} from "../curriculum.js";
import { reportingService } from "../service.js";
import { CHAPTER, PROFILE_A, attemptUuid, fixtureStandards, subject } from "./harness.js";

/** Exactly what apps/api/src/routes/reporting.ts calls. Renaming one breaks it. */
const PORT_METHODS = [
  "chapterConceptIds",
  "authoriseStudentReport",
  "authoriseRoster",
  "studentReport",
  "roster",
  "export",
] as const;

test("the service exposes exactly the port the API route calls", () => {
  const service = reportingService() as unknown as Record<string, unknown>;
  for (const method of PORT_METHODS) {
    assert.equal(
      typeof service[method],
      "function",
      `apps/api/src/routes/reporting.ts calls ${method}()`,
    );
  }
  assert.deepEqual(
    Object.keys(service).sort(),
    [...PORT_METHODS].sort(),
    "an extra method is a widened port the route did not agree to",
  );
});

test("the port accepts the row shape the route reads out of Postgres", () => {
  const service = reportingService({
    standards: fixtureStandards([{ slug: "STAMP", status: "MASTERED_FIRST_ATTEMPT" }]),
    chapterConcepts: () => ["TST.CONCEPT.STAMP.v1"],
  });

  // Written out longhand rather than through the harness, so it mirrors the
  // literal object the route constructs in `readStudents`.
  const student = {
    subject: {
      profileId: PROFILE_A,
      displayName: "Ada",
      districtStudentRef: null,
    },
    rows: {
      profileId: PROFILE_A,
      chapterId: CHAPTER,
      assessmentId: "TST.CAPSTONE.v1",
      chapterConceptIds: ["TST.CONCEPT.STAMP.v1"],
      attempts: [
        {
          attemptId: attemptUuid(1),
          attemptOrdinal: 1,
          scopedConceptIds: ["TST.CONCEPT.STAMP.v1"],
          status: "SUBMITTED" as const,
          scoreNumerator: 2,
          scoreDenominator: 2,
          startedAt: "2026-02-01T09:40:00.000Z",
          submittedAt: "2026-02-01T10:00:00.000Z",
        },
      ],
      mastery: [
        {
          conceptId: "TST.CONCEPT.STAMP.v1",
          itemsServed: 2,
          itemsCorrect: 2,
          firstAttemptServed: 2,
          firstAttemptCorrect: 2,
          masteredAt: "2026-02-01T10:00:00.000Z",
        },
      ],
    },
  };

  const report = service.studentReport({
    student,
    view: "EDUCATOR",
    generatedAt: "2026-03-01T00:00:00.000Z",
  });
  assert.equal(report.currentStanding.percent, 100);

  const roster = service.roster({
    chapterId: CHAPTER,
    students: [student],
    authorisedProfileIds: [PROFILE_A],
    generatedAt: "2026-03-01T00:00:00.000Z",
  });
  assert.equal(roster.summary.students, 1);

  const document = service.export({
    chapterId: CHAPTER,
    students: [student],
    authorisedProfileIds: [PROFILE_A],
    format: "JSON",
    identityMode: "PSEUDONYMOUS",
    generatedAt: "2026-03-01T00:00:00.000Z",
  });
  // The three fields the route reads off the returned document.
  assert.equal(typeof document.filename, "string");
  assert.equal(typeof document.contentType, "string");
  assert.equal(typeof document.body, "string");
});

test("the chapter concept list comes from the registry, not from a student's rows", () => {
  const service = reportingService();
  const boston = service.chapterConceptIds(CHAPTER_BOSTON);
  assert.ok(boston.length > 0, "the real registry answers for the real chapter");
  // The key the route holds is the key every database row holds, so the runtime
  // id must be the one the registry answers to and not a translation of it.
  assert.equal(CHAPTER_BOSTON, "boston-1765");
});

test("an unknown chapter is refused rather than answered with nothing", () => {
  const service = reportingService();
  // An empty concept list on this surface is a roster asserting that every
  // student owes nothing, which is why it may not be how a bad key reads.
  assert.throws(
    () => service.chapterConceptIds("CHAPTER.DOES_NOT_EXIST"),
    (error: unknown) =>
      error instanceof UnknownChapterError &&
      error.known.includes(CHAPTER_BOSTON) &&
      error.input === "CHAPTER.DOES_NOT_EXIST",
  );
  // The route reads its chapter id out of a URL, so it has a way to answer 404
  // instead of catching this.
  assert.equal(isCurriculumChapterId("CHAPTER.DOES_NOT_EXIST"), false);
  assert.equal(isCurriculumChapterId(CHAPTER_BOSTON), true);
});

test("the superseded authoring key still reaches the chapter it named", () => {
  // apps/api/src/app.ts used to translate the runtime key into `BOSTON` before
  // calling in, and that translation has been deleted. The alias stays anyway:
  // a caller holding the old spelling reaches Boston's concepts rather than
  // throwing, which is the difference between a stale key and a broken report.
  // A REQUEST naming it is still refused — see `isCurriculumChapterId` above.
  const service = reportingService();
  assert.deepEqual(
    [...service.chapterConceptIds("BOSTON")],
    [...service.chapterConceptIds(CHAPTER_BOSTON)],
  );
});

test("an access decision carries the audit record the route persists", () => {
  const service = reportingService();
  const decision = service.authoriseRoster({
    viewer: { kind: "EDUCATOR", accountId: "acct", grantedProfileIds: [PROFILE_A] },
    action: "DISTRICT_EXPORT",
    at: "2026-03-01T00:00:00.000Z",
  });
  for (const field of [
    "at",
    "action",
    "actorAccountId",
    "actorKind",
    "subjectProfileIds",
    "outcome",
    "refusal",
    "persist",
  ]) {
    assert.ok(field in decision.audit, `the route writes audit.${field}`);
  }
});
