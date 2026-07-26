import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRosterView } from "../roster.js";
import {
  DISTRICT_EXPORT_SCHEMA,
  csvText,
  districtExport,
  districtExportJson,
  standardEvidenceCsv,
  studentSummaryCsv,
  type DistrictExportInput,
  type ExportIdentityMode,
} from "../export.js";
import {
  CHAPTER,
  PROFILE_A,
  PROFILE_B,
  PROFILE_C,
  allStrings,
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

function exportInput(options: {
  readonly students: number;
  readonly identityMode?: ExportIdentityMode;
  readonly withRef?: boolean;
}): DistrictExportInput {
  const profiles = [PROFILE_A, PROFILE_B, PROFILE_C];
  const reports = Array.from({ length: options.students }, (_unused, index) =>
    makeStudentReport({
      profileId:
        profiles[index] ?? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      subject: subject(
        profiles[index] ??
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        `Student ${index}`,
        options.withRef === false ? null : `SIS-${1000 + index}`,
      ),
      concepts: [mastered("STAMP"), missed("TAXATION")],
      reportedScore: { numerator: 2, denominator: 4 },
    }),
  );
  return {
    chapterId: CHAPTER,
    reports,
    roster: buildRosterView({
      chapterId: CHAPTER,
      reports,
      generatedAt: "2026-03-01T00:00:00.000Z",
    }),
    identityMode: options.identityMode ?? "PSEUDONYMOUS",
    generatedAt: "2026-03-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Column naming
// ---------------------------------------------------------------------------

test("the CSV header spells out which measure each number is", () => {
  const csv = studentSummaryCsv(exportInput({ students: 5 }));
  const header = csv.split("\r\n")[0] ?? "";
  assert.ok(header.includes("first_sitting_percent_unaided"));
  assert.ok(header.includes("current_mastery_percent_after_retries"));
  assert.ok(
    !header.split(",").includes("score"),
    "a column called score next to a standard becomes an assessment result",
  );
});

test("the two gaps are two columns whose names say whose problem each is", () => {
  const header = studentSummaryCsv(exportInput({ students: 5 })).split("\r\n")[0] ?? "";
  assert.ok(header.includes("concepts_student_has_not_mastered"));
  assert.ok(header.includes("concepts_we_could_not_ask"));
  assert.ok(!header.includes("concepts_outstanding_total"));
});

test("standard evidence is long format, one row per student and concept", () => {
  const input = exportInput({ students: 5 });
  const rows = standardEvidenceCsv(input).trimEnd().split("\r\n");
  assert.equal(rows.length, 1 + 5 * 2, "header plus five students by two concepts");
  const header = rows[0] ?? "";
  for (const column of [
    "se_code",
    "se_code_bare",
    "reporting_category",
    "standard_type",
    "gap_owner",
    "was_measured",
    "evidence_strength",
  ]) {
    assert.ok(header.includes(column), `missing ${column}`);
  }
  assert.ok(rows.some((row) => row.includes("PRODUCT") || row.includes("STUDENT")));
});

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

test("a cell that would execute as a spreadsheet formula is neutralised", () => {
  assert.equal(csvText("=SUM(A1:A9)"), `"'=SUM(A1:A9)"`);
  assert.equal(csvText("+1-800-CALL"), `"'+1-800-CALL"`);
  assert.equal(csvText("@import"), `"'@import"`);
  assert.equal(csvText("-lead"), `"'-lead"`);
  assert.equal(csvText("Stamp Act"), `"Stamp Act"`);
});

test("a quote or comma in a label cannot break the row", () => {
  assert.equal(csvText('He said "no"'), `"He said ""no"""`);
  assert.equal(csvText("Taxation, representation"), `"Taxation, representation"`);
  assert.equal(csvText(null), "");
});

test("numbers are written bare so a warehouse types the column numerically", () => {
  const row = studentSummaryCsv(exportInput({ students: 5 })).split("\r\n")[1] ?? "";
  assert.ok(row.includes(",50,"), "the unaided percent is a number, not a string");
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

test("the default export is pseudonymous and carries no name", () => {
  const envelope = districtExportJson(exportInput({ students: 5 }));
  assert.equal(envelope.identityMode, "PSEUDONYMOUS");
  assert.equal(envelope.students[0]?.studentRef, "SIS-1000");
  for (const student of envelope.students) assert.equal(student.displayName, null);
  assert.ok(
    !allStrings(envelope).some((value) => value.startsWith("Student ")),
    "no display name reaches a pseudonymous export by any path",
  );
});

test("a district with no reference of its own gets an opaque profile id", () => {
  const envelope = districtExportJson(
    exportInput({ students: 5, withRef: false }),
  );
  assert.equal(envelope.students[0]?.studentRef, PROFILE_A);
  assert.equal(envelope.students[0]?.displayName, null);
});

test("naming a student is an explicit, opt-in argument", () => {
  const envelope = districtExportJson(
    exportInput({ students: 5, identityMode: "NAMED" }),
  );
  assert.equal(envelope.identityMode, "NAMED");
  assert.equal(envelope.students[0]?.displayName, "Student 0");
});

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

test("class aggregates are withheld below the cohort floor", () => {
  const small = districtExportJson(exportInput({ students: 3 }));
  assert.equal(small.cohort.aggregatesSuppressed, true);
  assert.equal(small.cohortSummary, null);
  assert.ok(small.claim.qualifiers.includes("SMALL_COHORT_SUPPRESSED"));
  assert.equal(
    small.students.length,
    3,
    "the district is responsible for these students; their own rows are not withheld",
  );
});

test("a reportable cohort keeps its aggregates", () => {
  const large = districtExportJson(exportInput({ students: 5 }));
  assert.equal(large.cohort.aggregatesSuppressed, false);
  assert.equal(large.cohortSummary?.studentsWithFirstSitting, 5);
  assert.equal(large.cohortSummary?.conceptsNeededByClass.length, 1);
  assert.ok(!large.claim.qualifiers.includes("SMALL_COHORT_SUPPRESSED"));
});

// ---------------------------------------------------------------------------
// The envelope and the claim
// ---------------------------------------------------------------------------

test("the envelope is versioned and carries the claim with the data", () => {
  const envelope = districtExportJson(exportInput({ students: 5 }));
  assert.equal(envelope.schema, DISTRICT_EXPORT_SCHEMA);
  assert.ok(envelope.claim.qualifiers.includes("NOT_A_STATE_ASSESSMENT"));
  assert.ok(envelope.claim.qualifiers.includes("UNPROCTORED_ADMINISTRATION"));
  assert.ok(envelope.claim.qualifiers.includes("UNLIMITED_RETRIES"));
  assert.ok(envelope.claim.qualifiers.includes("MISSION_PERFORMANCE_EXCLUDED"));
  assert.ok(
    envelope.claim.doesNotSupport.some((line) => line.includes("STAAR")),
    "the disclaimer a district would otherwise assume away",
  );
  assert.notEqual(envelope.claim.strength, "NONE");
});

test("a CSV download still carries its claim and identity mode", () => {
  const document = districtExport({
    ...exportInput({ students: 5 }),
    format: "STUDENT_SUMMARY_CSV",
  });
  assert.match(document.filename, /^pa-mastery-CHAPTER.TEST-2026-03-01/);
  assert.equal(document.contentType, "text/csv; charset=utf-8");
  assert.equal(document.identityMode, "PSEUDONYMOUS");
  assert.ok(document.claim.qualifiers.length > 0);
});

test("the JSON form is the same envelope, serialised", () => {
  const document = districtExport({
    ...exportInput({ students: 5 }),
    format: "JSON",
  });
  assert.equal(document.contentType, "application/json; charset=utf-8");
  assert.equal(
    (JSON.parse(document.body) as { schema: string }).schema,
    DISTRICT_EXPORT_SCHEMA,
  );
});

// ---------------------------------------------------------------------------
// What cannot be in it
// ---------------------------------------------------------------------------

test("no student prose and no answer key can appear in an export", () => {
  const envelope = districtExportJson(exportInput({ students: 5 }));
  const json = JSON.stringify(envelope);
  for (const forbidden of [
    "responseText",
    "correctOptionId",
    "selectedOptionId",
    "rubric",
    "email",
  ]) {
    assert.ok(
      !json.includes(forbidden),
      `${forbidden} has no field to travel in, and must not acquire one`,
    );
  }
});
