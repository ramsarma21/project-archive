import assert from "node:assert/strict";
import { test } from "node:test";

import { rollUpToStandards } from "../standards.js";
import {
  SE_CAUSES,
  SE_GOVERNMENT,
  conceptId,
  fixtureStandards,
  makeStudentReport,
  type ConceptSpec,
} from "./harness.js";

function rollUp(specs: readonly ConceptSpec[]) {
  const outcomeFor = (status: ConceptSpec["status"]) =>
    status === "MASTERED_FIRST_ATTEMPT"
      ? ("MASTERED_UNAIDED" as const)
      : status === "MASTERED_AFTER_RETRY"
        ? ("MASTERED_AFTER_SUPPORT" as const)
        : status === "NOT_MASTERED"
          ? ("NOT_YET_MASTERED" as const)
          : status === "NOT_ASSESSED_CONTENT_GAP"
            ? ("NOT_MEASURED_ITEM_SHORTAGE" as const)
            : ("NOT_MEASURED_NOT_SAT" as const);
  return rollUpToStandards(
    specs.map((spec) => ({
      conceptId: conceptId(spec.slug),
      outcome: outcomeFor(spec.status),
    })),
    fixtureStandards(specs),
  );
}

test("MET requires full coverage, not just full mastery", () => {
  const covered = rollUp([
    { slug: "A", status: "MASTERED_FIRST_ATTEMPT" },
    { slug: "B", status: "MASTERED_AFTER_RETRY" },
  ]);
  assert.equal(covered.rows[0]?.mastery, "MET");
  assert.equal(covered.rows[0]?.coverage, "FULLY_MEASURED");
  assert.equal(covered.standardsMet, 1);
});

test("everything we asked was mastered, but we did not ask all of it", () => {
  const partial = rollUp([
    { slug: "A", status: "MASTERED_FIRST_ATTEMPT" },
    { slug: "B", status: "MASTERED_FIRST_ATTEMPT" },
    { slug: "C", status: "NOT_ASSESSED_CONTENT_GAP" },
  ]);
  const row = partial.rows[0];
  assert.equal(row?.coverage, "PARTIALLY_MEASURED");
  assert.equal(
    row?.mastery,
    "INSUFFICIENT_EVIDENCE",
    "reporting MET here would tell a district a standard was covered when a " +
      "third of it was never asked",
  );
  assert.equal(row?.coverageDebt, 1);
  assert.deepEqual([...(row?.coverageDebtConceptIds ?? [])], [conceptId("C")]);
  assert.equal(partial.standardsMet, 0);
  assert.equal(partial.standardsWithCoverageDebt, 1);
});

test("partial coverage is never NOT_MET either", () => {
  const nothingAsked = rollUp([
    { slug: "A", status: "NOT_ASSESSED_CONTENT_GAP" },
    { slug: "B", status: "NOT_ASSESSED_CONTENT_GAP" },
  ]);
  assert.equal(nothingAsked.rows[0]?.coverage, "NOT_MEASURED");
  assert.equal(
    nothingAsked.rows[0]?.mastery,
    "INSUFFICIENT_EVIDENCE",
    "a concept nobody asked is not a concept the student failed",
  );
});

test("a real student gap reports as a real student gap", () => {
  const some = rollUp([
    { slug: "A", status: "MASTERED_FIRST_ATTEMPT" },
    { slug: "B", status: "NOT_MASTERED" },
  ]);
  assert.equal(some.rows[0]?.mastery, "PARTIALLY_MET");
  assert.deepEqual([...(some.rows[0]?.outstandingConceptIds ?? [])], [
    conceptId("B"),
  ]);

  const none = rollUp([
    { slug: "A", status: "NOT_MASTERED" },
    { slug: "B", status: "NOT_MASTERED" },
  ]);
  assert.equal(none.rows[0]?.mastery, "NOT_MET");
});

test("a mastered concept counts once, against its parent standard only", () => {
  // Every fixture concept lists SE_GOVERNMENT as secondary evidence.
  const rollup = rollUp([
    { slug: "A", se: SE_CAUSES, status: "MASTERED_FIRST_ATTEMPT" },
    { slug: "B", se: SE_CAUSES, status: "MASTERED_FIRST_ATTEMPT" },
  ]);
  assert.equal(rollup.rows.length, 1, "not two, and not three");
  assert.equal(rollup.rows[0]?.seCode, SE_CAUSES);
  assert.equal(rollup.rows[0]?.conceptsInStandard, 2);
});

test("standards sort in curriculum order rather than lexically", () => {
  const rollup = rollUp([
    { slug: "A", se: SE_GOVERNMENT, status: "MASTERED_FIRST_ATTEMPT" },
    { slug: "B", se: SE_CAUSES, status: "MASTERED_FIRST_ATTEMPT" },
  ]);
  assert.deepEqual(
    rollup.rows.map((row) => row.seCode),
    [SE_CAUSES, SE_GOVERNMENT],
    "8.4(A) before 8.15(A), which a string sort gets backwards",
  );
});

test("a paraphrase is never presented as the standard's own words", () => {
  const rollup = rollUp([
    { slug: "A", se: SE_CAUSES, status: "MASTERED_FIRST_ATTEMPT" },
    { slug: "B", se: SE_GOVERNMENT, status: "MASTERED_FIRST_ATTEMPT" },
  ]);
  const causes = rollup.rows.find((row) => row.seCode === SE_CAUSES);
  const government = rollup.rows.find((row) => row.seCode === SE_GOVERNMENT);
  assert.equal(causes?.descriptionSource, "OFFICIAL_TEXT");
  assert.equal(government?.descriptionSource, "WORKING_PARAPHRASE");
});

test("a concept the registry cannot place is reported, not dropped", () => {
  const rollup = rollUp([
    { slug: "A", status: "MASTERED_FIRST_ATTEMPT" },
    { slug: "ORPHAN", status: "NOT_MASTERED", unregistered: true },
  ]);
  assert.deepEqual(
    [...rollup.unmappedConceptIds],
    [conceptId("ORPHAN")],
    "a concept missing from the standards view is a standard missing from the claim",
  );
  assert.equal(rollup.rows[0]?.conceptsInStandard, 1);
});

test("both spellings of a standard reach the report, and neither is invented", () => {
  const report = makeStudentReport({
    concepts: [{ slug: "A", status: "MASTERED_FIRST_ATTEMPT" }],
    reportedScore: { numerator: 2, denominator: 2 },
  });
  assert.equal(report.byConcept[0]?.standard?.seCode, "8.4(A)");
  assert.equal(report.byConcept[0]?.standard?.seCodeBare, "8.4A");
  assert.equal(report.byConcept[0]?.standard?.reportingCategory, 1);
  assert.equal(report.byConcept[0]?.standard?.standardType, "READINESS");
});

test("an unreviewed concept mapping becomes a claim qualifier", () => {
  const draft = makeStudentReport({
    concepts: [{ slug: "A", status: "MASTERED_FIRST_ATTEMPT", reviewStatus: "DRAFT" }],
    reportedScore: { numerator: 2, denominator: 2 },
  });
  assert.ok(draft.claim.qualifiers.includes("CONCEPT_MAPPING_NOT_SME_APPROVED"));

  const signedOff = makeStudentReport({
    concepts: [
      {
        slug: "A",
        se: "8.4(A)",
        status: "MASTERED_FIRST_ATTEMPT",
        reviewStatus: "SME_APPROVED",
      },
    ],
    reportedScore: { numerator: 2, denominator: 2 },
  });
  assert.ok(
    !signedOff.claim.qualifiers.includes("CONCEPT_MAPPING_NOT_SME_APPROVED"),
  );
});
