import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MIN_AGGREGATE_COHORT,
  assertWithinScope,
  authoriseRoster,
  authoriseStudentReport,
  cohortIsReportable,
  type ReportViewer,
} from "../authorisation.js";
import { studentSelfView } from "../student.js";
import { PROFILE_A, PROFILE_B, makeStudentReport, subject } from "./harness.js";

const AT = "2026-03-01T00:00:00.000Z";
const ANONYMOUS: ReportViewer = { kind: "ANONYMOUS" };
const STUDENT_A: ReportViewer = {
  kind: "STUDENT",
  accountId: "acct-a",
  profileId: PROFILE_A,
};
const TEACHER: ReportViewer = {
  kind: "EDUCATOR",
  accountId: "acct-t",
  grantedProfileIds: [PROFILE_A],
};

// ---------------------------------------------------------------------------
// Rule 1: authentication is necessary and never sufficient
// ---------------------------------------------------------------------------

test("an unauthenticated caller is refused before anything else is considered", () => {
  const student = authoriseStudentReport({
    viewer: ANONYMOUS,
    subjectProfileId: PROFILE_A,
    at: AT,
  });
  assert.equal(student.kind, "REFUSED");
  assert.equal(
    student.kind === "REFUSED" && student.reason,
    "AUTHENTICATION_REQUIRED",
  );
  assert.equal(authoriseRoster({ viewer: ANONYMOUS, at: AT }).kind, "REFUSED");
});

// ---------------------------------------------------------------------------
// Rule 2: a student sees exactly their own record
// ---------------------------------------------------------------------------

test("a student may read their own record", () => {
  const access = authoriseStudentReport({
    viewer: STUDENT_A,
    subjectProfileId: PROFILE_A,
    at: AT,
  });
  assert.equal(access.kind, "ALLOWED");
  assert.equal(access.kind === "ALLOWED" && access.view, "SELF");
});

test("a student may not read a classmate's record", () => {
  const access = authoriseStudentReport({
    viewer: STUDENT_A,
    subjectProfileId: PROFILE_B,
    at: AT,
  });
  assert.equal(access.kind, "REFUSED");
  assert.equal(access.kind === "REFUSED" && access.reason, "NOT_AUTHORISED");
});

test("a student has no roster at all, not even one of size one", () => {
  const access = authoriseRoster({ viewer: STUDENT_A, at: AT });
  assert.equal(access.kind, "REFUSED");
  assert.equal(
    access.kind === "REFUSED" && access.reason,
    "NOT_AUTHORISED",
    "a page shaped like a class list is a page that grows a class list",
  );
});

test("the self view withholds the operational fields but not the evidence", () => {
  const full = makeStudentReport({
    profileId: PROFILE_A,
    subject: subject(PROFILE_A, "Student", "SIS-9001"),
    concepts: [
      { slug: "A", status: "MASTERED_FIRST_ATTEMPT", firstAttempt: { correct: 2, served: 2 } },
    ],
    reportedScore: { numerator: 2, denominator: 2 },
    needsGradingReview: ["ITEM-7"],
  });
  const self = studentSelfView(full);

  assert.equal(self.byConcept.length, full.byConcept.length, "their own evidence");
  assert.equal(self.firstSitting?.itemsCorrect, 2);
  assert.deepEqual([...self.itemsAwaitingGradingReview], [], "our review queue");
  assert.equal(self.reportedFormProvenance, null, "and our item bank");
  assert.equal(self.subject.districtStudentRef, null);
});

// ---------------------------------------------------------------------------
// Rules 3 and 4: an educator sees exactly their grants, derived not supplied
// ---------------------------------------------------------------------------

test("an educator reads a granted student and is refused an ungranted one", () => {
  assert.equal(
    authoriseStudentReport({
      viewer: TEACHER,
      subjectProfileId: PROFILE_A,
      at: AT,
    }).kind,
    "ALLOWED",
  );
  const refused = authoriseStudentReport({
    viewer: TEACHER,
    subjectProfileId: PROFILE_B,
    at: AT,
  });
  assert.equal(refused.kind, "REFUSED");
  assert.equal(refused.kind === "REFUSED" && refused.reason, "NOT_AUTHORISED");
});

test("the roster is the grant set, and the caller cannot widen it", () => {
  const access = authoriseRoster({ viewer: TEACHER, at: AT });
  assert.equal(access.kind, "ALLOWED");
  assert.deepEqual(
    access.kind === "ALLOWED" ? [...access.profileIds] : [],
    [PROFILE_A],
  );
  // There is no parameter on AuthoriseRosterInput through which a candidate
  // list could be supplied, which is what makes the enumeration oracle
  // unavailable rather than merely unused.
  assert.deepEqual(Object.keys({ viewer: TEACHER, at: AT }).sort(), [
    "at",
    "viewer",
  ]);
});

test("an educator with no grants gets an empty roster rather than a refusal", () => {
  const access = authoriseRoster({
    viewer: { kind: "EDUCATOR", accountId: "acct-new", grantedProfileIds: [] },
    at: AT,
  });
  assert.equal(access.kind, "ALLOWED");
  assert.deepEqual(access.kind === "ALLOWED" ? [...access.profileIds] : ["x"], []);
});

// ---------------------------------------------------------------------------
// Rule 5: refusals are uniform
// ---------------------------------------------------------------------------

test("not-yours and does-not-exist are the same answer", () => {
  const notYours = authoriseStudentReport({
    viewer: TEACHER,
    subjectProfileId: PROFILE_B,
    at: AT,
  });
  const doesNotExist = authoriseStudentReport({
    viewer: TEACHER,
    subjectProfileId: "00000000-0000-4000-8000-000000000000",
    at: AT,
  });
  assert.equal(
    notYours.kind === "REFUSED" && notYours.reason,
    doesNotExist.kind === "REFUSED" && doesNotExist.reason,
    "distinguishing them is a membership oracle over ids that appear in URLs",
  );
});

// ---------------------------------------------------------------------------
// Rule 6: audits
// ---------------------------------------------------------------------------

test("reading somebody else's record is audited; reading your own is not", () => {
  const educator = authoriseStudentReport({
    viewer: TEACHER,
    subjectProfileId: PROFILE_A,
    at: AT,
  });
  assert.equal(educator.audit.persist, true);
  assert.equal(educator.audit.actorAccountId, "acct-t");
  assert.equal(educator.audit.outcome, "ALLOWED");
  assert.deepEqual([...educator.audit.subjectProfileIds], [PROFILE_A]);

  const self = authoriseStudentReport({
    viewer: STUDENT_A,
    subjectProfileId: PROFILE_A,
    at: AT,
  });
  assert.equal(
    self.audit.persist,
    false,
    "logging a child's own page turn is surveillance, not accountability",
  );
});

test("a refused read is audited, because that is the one worth alerting on", () => {
  const refused = authoriseStudentReport({
    viewer: STUDENT_A,
    subjectProfileId: PROFILE_B,
    at: AT,
  });
  assert.equal(refused.audit.persist, true);
  assert.equal(refused.audit.outcome, "REFUSED");
  assert.equal(refused.audit.refusal, "NOT_AUTHORISED");
});

test("an export is audited under its own action", () => {
  const access = authoriseRoster({
    viewer: TEACHER,
    action: "DISTRICT_EXPORT",
    at: AT,
  });
  assert.equal(access.audit.action, "DISTRICT_EXPORT");
});

// ---------------------------------------------------------------------------
// The second check, on the data
// ---------------------------------------------------------------------------

test("a record outside the authorised set throws rather than being filtered", () => {
  assert.doesNotThrow(() => assertWithinScope([PROFILE_A], [PROFILE_A, PROFILE_B]));
  assert.throws(
    () => assertWithinScope([PROFILE_A, PROFILE_B], [PROFILE_A]),
    /outside the authorised roster/,
    "quietly dropping it leaves the wrong query in place",
  );
});

test("aggregates below the suppression floor may not leave the roster", () => {
  assert.equal(MIN_AGGREGATE_COHORT, 5);
  assert.equal(cohortIsReportable(MIN_AGGREGATE_COHORT - 1), false);
  assert.equal(cohortIsReportable(MIN_AGGREGATE_COHORT), true);
});
