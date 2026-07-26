import assert from "node:assert/strict";
import { test } from "node:test";

import { reportingService, type StudentEvidenceInput } from "../service.js";
import {
  CHAPTER,
  PROFILE_A,
  PROFILE_B,
  attemptUuid,
  conceptId,
  fixtureStandards,
  makeDurableRows,
  subject,
} from "./harness.js";

const standards = fixtureStandards([
  { slug: "STAMP", status: "MASTERED_FIRST_ATTEMPT" },
  { slug: "TAXATION", status: "NOT_MASTERED" },
  { slug: "MERCANTILISM", status: "NOT_ASSESSED_CONTENT_GAP" },
]);

function student(profileId: string, name: string): StudentEvidenceInput {
  return {
    subject: subject(profileId, name, `SIS-${name}`),
    rows: makeDurableRows({
      profileId,
      conceptSlugs: ["STAMP", "TAXATION", "MERCANTILISM"],
      attempts: [
        {
          attemptId: attemptUuid(1),
          attemptOrdinal: 1,
          scopedSlugs: ["STAMP", "TAXATION"],
          status: "SUBMITTED",
          scoreNumerator: 2,
          scoreDenominator: 4,
          startedAt: "2026-02-01T09:40:00.000Z",
          submittedAt: "2026-02-01T10:00:00.000Z",
        },
      ],
      mastery: [
        {
          slug: "STAMP",
          itemsServed: 2,
          itemsCorrect: 2,
          firstAttemptServed: 2,
          firstAttemptCorrect: 2,
          masteredAt: "2026-02-01T10:00:00.000Z",
        },
        {
          slug: "TAXATION",
          itemsServed: 2,
          itemsCorrect: 0,
          firstAttemptServed: 2,
          firstAttemptCorrect: 0,
          masteredAt: null,
        },
      ],
    }),
  };
}

const service = reportingService({ standards });
const AT = "2026-03-01T00:00:00.000Z";

test("the service composes a roster from durable rows", () => {
  const view = service.roster({
    chapterId: CHAPTER,
    students: [student(PROFILE_A, "Ada"), student(PROFILE_B, "Ben")],
    authorisedProfileIds: [PROFILE_A, PROFILE_B],
    generatedAt: AT,
  });

  assert.equal(view.summary.students, 2);
  assert.equal(view.summary.needsHelp, 2);
  assert.deepEqual(
    view.conceptsNeededByClass.map((need) => need.conceptId),
    [conceptId("TAXATION")],
  );
  assert.equal(view.rows[0]?.coverageDebtConcepts, 1, "MERCANTILISM");
  assert.equal(view.rows[0]?.conceptsOutstanding, 1, "TAXATION only");
});

test("the service refuses to assemble a page outside the authorised set", () => {
  assert.throws(
    () =>
      service.roster({
        chapterId: CHAPTER,
        students: [student(PROFILE_A, "Ada"), student(PROFILE_B, "Ben")],
        authorisedProfileIds: [PROFILE_A],
        generatedAt: AT,
      }),
    /outside the authorised roster/,
  );
  assert.throws(
    () =>
      service.export({
        chapterId: CHAPTER,
        students: [student(PROFILE_B, "Ben")],
        authorisedProfileIds: [PROFILE_A],
        format: "JSON",
        identityMode: "PSEUDONYMOUS",
        generatedAt: AT,
      }),
    /outside the authorised roster/,
  );
});

test("the self view is narrower than the educator view of the same record", () => {
  const asEducator = service.studentReport({
    student: student(PROFILE_A, "Ada"),
    view: "EDUCATOR",
    generatedAt: AT,
  });
  const asSelf = service.studentReport({
    student: student(PROFILE_A, "Ada"),
    view: "SELF",
    generatedAt: AT,
  });

  assert.equal(asEducator.subject.districtStudentRef, "SIS-Ada");
  assert.equal(asSelf.subject.districtStudentRef, null);
  assert.equal(asSelf.byConcept.length, asEducator.byConcept.length);
  assert.equal(asSelf.firstSitting?.percent, asEducator.firstSitting?.percent);
});

test("the export runs end to end from rows to a downloadable document", () => {
  const document = service.export({
    chapterId: CHAPTER,
    students: [student(PROFILE_A, "Ada"), student(PROFILE_B, "Ben")],
    authorisedProfileIds: [PROFILE_A, PROFILE_B],
    format: "STANDARD_EVIDENCE_CSV",
    identityMode: "PSEUDONYMOUS",
    generatedAt: AT,
  });

  const rows = document.body.trimEnd().split("\r\n");
  assert.equal(rows.length, 1 + 2 * 3, "header plus two students by three concepts");
  assert.ok(document.body.includes("SIS-Ada"));
  assert.ok(!document.body.includes('"Ada"'), "pseudonymous by default");
  assert.match(document.filename, /standard-evidence\.csv$/);
});

test("authorisation is reachable through the service, not reimplemented beside it", () => {
  const refused = service.authoriseStudentReport({
    viewer: { kind: "EDUCATOR", accountId: "acct", grantedProfileIds: [PROFILE_A] },
    subjectProfileId: PROFILE_B,
    at: AT,
  });
  assert.equal(refused.kind, "REFUSED");
  const allowed = service.authoriseRoster({
    viewer: { kind: "EDUCATOR", accountId: "acct", grantedProfileIds: [PROFILE_A] },
    at: AT,
  });
  assert.equal(allowed.kind, "ALLOWED");
});
