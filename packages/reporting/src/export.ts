// The export a district can actually ingest.
//
// THREE FORMS, BECAUSE A DISTRICT INGESTS TWO SHAPES AND AUDITS A THIRD.
//
//   student-summary CSV  one row per student. The gradebook / dashboard import.
//   standard-evidence CSV one row per student × concept, carrying the TEKS
//                        columns. The assessment-warehouse import, and the only
//                        shape that can answer "how did our eighth graders do on
//                        8.4(A)".
//   JSON envelope        everything, versioned, including the claim block. The
//                        form a human reads when the CSV raises a question.
//
// WHY THE COLUMN NAMES ARE UGLY. `first_sitting_percent_unaided` and
// `current_mastery_percent_after_retries` are long on purpose. A CSV column
// header is the last place a number's meaning survives: once it is in a
// warehouse, nobody reads the documentation, and a column called `score` next to
// a column called `se_code` will be treated as an assessment result within a
// week. The header IS the disclosure, so it says the whole thing.
//
// The same reasoning gives `concepts_student_has_not_mastered` and
// `concepts_we_could_not_ask` as two separate columns whose names say whose
// problem each is. There is no column that adds them.
//
// IDENTITY IS PSEUDONYMOUS BY DEFAULT. The default export carries the district's
// own student reference when the roster provisioned one and an opaque profile id
// otherwise — never a name, never an email. NAMED is available because a district
// that has not provisioned references has to join on something, but it is an
// explicit argument, it is audited, and it is a claim qualifier on the payload.
//
// TWO THINGS THE EXPORT CANNOT CONTAIN, STRUCTURALLY. Student prose: nothing in
// this package's types can hold it, because the capstone engine keeps open
// responses behind an opaque handle. And an answer key: the concept rows carry
// counts and outcomes, never which option was correct.

import {
  MIN_AGGREGATE_COHORT,
  cohortIsReportable,
} from "./authorisation.js";
import { mergeClaims, type ClaimQualifier, type ReportClaim } from "./claim.js";
import type { RosterView } from "./roster.js";
import type { StudentChapterReport } from "./student.js";

export const DISTRICT_EXPORT_SCHEMA = "pa.reporting.district-export.v1";

export type ExportIdentityMode = "PSEUDONYMOUS" | "NAMED";
export type ExportFormat = "JSON" | "STUDENT_SUMMARY_CSV" | "STANDARD_EVIDENCE_CSV";

export interface DistrictExportInput {
  readonly chapterId: string;
  readonly reports: readonly StudentChapterReport[];
  readonly roster: RosterView;
  readonly identityMode: ExportIdentityMode;
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * How a student is named in the export.
 *
 * The district's own reference first, because that is what their SIS can join
 * on; the opaque profile id otherwise. An identifier we minted and they cannot
 * resolve is not an identifier, which is why this never invents one.
 */
function studentRef(report: StudentChapterReport): string {
  return report.subject.districtStudentRef ?? report.subject.profileId;
}

function displayName(
  report: StudentChapterReport,
  mode: ExportIdentityMode,
): string | null {
  return mode === "NAMED" ? report.subject.displayName : null;
}

// ---------------------------------------------------------------------------
// CSV primitives
// ---------------------------------------------------------------------------

/**
 * RFC 4180 quoting, plus spreadsheet formula neutralisation.
 *
 * A cell beginning `=`, `+`, `-`, `@`, tab or carriage return is executed as a
 * formula by Excel and Sheets on open. Concept labels and standards text are
 * authored strings, so today none of them start with those characters — but this
 * file writes whatever the registry holds into a document a district opens by
 * double-clicking, and "today's data happens to be safe" is not a control.
 */
export function csvText(value: string | null): string {
  if (value === null) return "";
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Numbers are written bare, so a warehouse types the column as numeric. */
function csvNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

function csvBool(value: boolean | null): string {
  return value === null ? "" : value ? "true" : "false";
}

/** CRLF per RFC 4180, and a trailing newline so `wc -l` agrees with row count. */
function csvDocument(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// The JSON envelope
// ---------------------------------------------------------------------------

export interface DistrictExportStudent {
  readonly studentRef: string;
  readonly displayName: string | null;
  readonly chapterId: string;
  readonly firstSittingUnaided: {
    readonly percent: number;
    readonly itemsCorrect: number;
    readonly itemsServed: number;
    readonly conceptsMastered: number;
    readonly coversWholeChapter: boolean;
    readonly submittedAt: string;
    readonly revisedByReview: boolean;
  } | null;
  readonly currentMasteryAfterRetries: {
    readonly percent: number;
    readonly conceptsMastered: number;
    readonly conceptsRequired: number;
    readonly attemptsUsed: number;
    readonly chapterUnlocked: boolean;
  };
  readonly conceptsStudentHasNotMastered: number;
  readonly conceptsWeCouldNotAsk: number;
  readonly standards: readonly {
    readonly seCode: string;
    readonly seCodeBare: string;
    readonly reportingCategory: number;
    readonly standardType: string;
    readonly coverage: string;
    readonly mastery: string;
    readonly conceptsInStandard: number;
    readonly conceptsMeasured: number;
  }[];
  readonly concepts: readonly {
    readonly conceptId: string;
    readonly label: string;
    readonly seCode: string | null;
    readonly outcome: string;
    readonly gapOwner: string;
    readonly measured: boolean;
    readonly evidenceStrength: string;
    readonly firstSittingItemsCorrect: number | null;
    readonly firstSittingItemsServed: number | null;
    readonly masteredOnAttempt: number | null;
  }[];
}

export interface DistrictExportEnvelope {
  readonly schema: typeof DISTRICT_EXPORT_SCHEMA;
  readonly generatedAt: string;
  readonly chapterId: string;
  readonly identityMode: ExportIdentityMode;
  readonly cohort: {
    readonly students: number;
    /** Class-level aggregates below the suppression floor are withheld. */
    readonly aggregatesSuppressed: boolean;
    readonly suppressionFloor: number;
  };
  /** Null when suppressed. Per-student rows are never suppressed; see below. */
  readonly cohortSummary: {
    readonly medianFirstSittingPercentUnaided: number | null;
    readonly studentsWithFirstSitting: number;
    readonly conceptsNeededByClass: readonly {
      readonly conceptId: string;
      readonly label: string;
      readonly seCodeBare: string | null;
      readonly studentsOutstanding: number;
      readonly shareOfClassPercent: number;
    }[];
  } | null;
  readonly coverage: RosterView["coverage"];
  readonly claim: ReportClaim;
  readonly students: readonly DistrictExportStudent[];
}

function exportStudent(
  report: StudentChapterReport,
  mode: ExportIdentityMode,
): DistrictExportStudent {
  return {
    studentRef: studentRef(report),
    displayName: displayName(report, mode),
    chapterId: report.chapterId,
    firstSittingUnaided: report.firstSitting
      ? {
          percent: report.firstSitting.percent,
          itemsCorrect: report.firstSitting.itemsCorrect,
          itemsServed: report.firstSitting.itemsServed,
          conceptsMastered: report.firstSitting.conceptsMasteredUnaided,
          coversWholeChapter: report.firstSitting.coversWholeChapter,
          submittedAt: report.firstSitting.submittedAt,
          revisedByReview: report.firstSitting.revisedByReview,
        }
      : null,
    currentMasteryAfterRetries: {
      percent: report.currentStanding.percent,
      conceptsMastered: report.currentStanding.conceptsMastered,
      conceptsRequired: report.currentStanding.conceptsRequired,
      attemptsUsed: report.currentStanding.attemptsUsed,
      chapterUnlocked: report.currentStanding.chapterUnlocked,
    },
    conceptsStudentHasNotMastered: report.evidence.studentGaps,
    conceptsWeCouldNotAsk: report.evidence.coverageDebt,
    standards: report.standards.rows.map((row) => ({
      seCode: row.seCode,
      seCodeBare: row.seCodeBare,
      reportingCategory: row.reportingCategory,
      standardType: row.standardType,
      coverage: row.coverage,
      mastery: row.mastery,
      conceptsInStandard: row.conceptsInStandard,
      conceptsMeasured: row.conceptsMeasured,
    })),
    concepts: report.byConcept.map((row) => ({
      conceptId: row.conceptId,
      label: row.label,
      seCode: row.standard?.seCode ?? null,
      outcome: row.outcome,
      gapOwner: row.owner,
      measured: row.measured,
      evidenceStrength: row.evidenceStrength,
      firstSittingItemsCorrect: row.firstSitting?.correct ?? null,
      firstSittingItemsServed: row.firstSitting?.served ?? null,
      masteredOnAttempt: row.masteredOnAttempt,
    })),
  };
}

/**
 * Per-student rows are never suppressed, and only class aggregates are.
 *
 * Small-cohort suppression exists so a statistic cannot re-identify an individual
 * inside it — "3 of 4 students missed this" names three children in a class of
 * four. It is not a reason to withhold a student's own record from the district
 * that is legally responsible for it. So the floor applies to `cohortSummary` and
 * nothing else.
 */
export function districtExportJson(
  input: DistrictExportInput,
): DistrictExportEnvelope {
  const { reports, roster, identityMode, generatedAt, chapterId } = input;
  const suppressed = !cohortIsReportable(reports.length);

  const extraQualifiers: ClaimQualifier[] = [];
  if (suppressed) extraQualifiers.push("SMALL_COHORT_SUPPRESSED");
  const claim = withQualifiers(
    mergeClaims(reports.map((report) => report.claim)),
    extraQualifiers,
  );

  return {
    schema: DISTRICT_EXPORT_SCHEMA,
    generatedAt,
    chapterId,
    identityMode,
    cohort: {
      students: reports.length,
      aggregatesSuppressed: suppressed,
      suppressionFloor: MIN_AGGREGATE_COHORT,
    },
    cohortSummary: suppressed
      ? null
      : {
          medianFirstSittingPercentUnaided:
            roster.summary.medianFirstSittingPercent,
          studentsWithFirstSitting: roster.summary.studentsWithFirstSitting,
          conceptsNeededByClass: roster.conceptsNeededByClass.map((need) => ({
            conceptId: need.conceptId,
            label: need.label,
            seCodeBare: need.seCodeBare,
            studentsOutstanding: need.studentsOutstanding,
            shareOfClassPercent: need.shareOfClassPercent,
          })),
        },
    coverage: roster.coverage,
    claim,
    students: reports.map((report) => exportStudent(report, identityMode)),
  };
}

function withQualifiers(
  claim: ReportClaim,
  extra: readonly ClaimQualifier[],
): ReportClaim {
  if (extra.length === 0) return claim;
  return { ...claim, qualifiers: [...new Set([...claim.qualifiers, ...extra])] };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const STUDENT_SUMMARY_HEADER: readonly string[] = [
  "student_ref",
  "display_name",
  "chapter_id",
  "first_sitting_percent_unaided",
  "first_sitting_items_correct",
  "first_sitting_items_served",
  "first_sitting_covers_whole_chapter",
  "current_mastery_percent_after_retries",
  "current_mastery_concepts_mastered",
  "current_mastery_concepts_required",
  "concepts_student_has_not_mastered",
  "concepts_we_could_not_ask",
  "attempts_used",
  "chapter_unlocked",
  "claim_strength",
];

export function studentSummaryCsv(input: DistrictExportInput): string {
  const rows: string[][] = [[...STUDENT_SUMMARY_HEADER]];
  for (const report of input.reports) {
    rows.push([
      csvText(studentRef(report)),
      csvText(displayName(report, input.identityMode)),
      csvText(report.chapterId),
      csvNumber(report.firstSitting?.percent ?? null),
      csvNumber(report.firstSitting?.itemsCorrect ?? null),
      csvNumber(report.firstSitting?.itemsServed ?? null),
      csvBool(report.firstSitting?.coversWholeChapter ?? null),
      csvNumber(report.currentStanding.percent),
      csvNumber(report.currentStanding.conceptsMastered),
      csvNumber(report.currentStanding.conceptsRequired),
      csvNumber(report.evidence.studentGaps),
      csvNumber(report.evidence.coverageDebt),
      csvNumber(report.currentStanding.attemptsUsed),
      csvBool(report.currentStanding.chapterUnlocked),
      csvText(report.claim.strength),
    ]);
  }
  return csvDocument(rows);
}

const STANDARD_EVIDENCE_HEADER: readonly string[] = [
  "student_ref",
  "chapter_id",
  "se_code",
  "se_code_bare",
  "reporting_category",
  "standard_type",
  "concept_id",
  "concept_label",
  "outcome",
  "gap_owner",
  "was_measured",
  "evidence_strength",
  "first_sitting_items_correct",
  "first_sitting_items_served",
  "mastered_on_attempt",
];

/**
 * One row per student × concept, carrying the standard on every row.
 *
 * Long format rather than a wide one-column-per-standard sheet, because the
 * concept is the assessed unit and a wide sheet would have to collapse several
 * concepts into one standard cell — which is exactly the roll-up that has to stay
 * honest. A warehouse pivots this shape; it cannot un-pivot the other one.
 */
export function standardEvidenceCsv(input: DistrictExportInput): string {
  const rows: string[][] = [[...STANDARD_EVIDENCE_HEADER]];
  for (const report of input.reports) {
    for (const concept of report.byConcept) {
      rows.push([
        csvText(studentRef(report)),
        csvText(report.chapterId),
        csvText(concept.standard?.seCode ?? null),
        csvText(concept.standard?.seCodeBare ?? null),
        csvNumber(concept.standard?.reportingCategory ?? null),
        csvText(concept.standard?.standardType ?? null),
        csvText(concept.conceptId),
        csvText(concept.label),
        csvText(concept.outcome),
        csvText(concept.owner),
        csvBool(concept.measured),
        csvText(concept.evidenceStrength),
        csvNumber(concept.firstSitting?.correct ?? null),
        csvNumber(concept.firstSitting?.served ?? null),
        csvNumber(concept.masteredOnAttempt),
      ]);
    }
  }
  return csvDocument(rows);
}

// ---------------------------------------------------------------------------
// The one call the route makes
// ---------------------------------------------------------------------------

export interface ExportedDocument {
  readonly filename: string;
  readonly contentType: string;
  readonly body: string;
  /** Repeated outside the body so a CSV download is still labelled. */
  readonly claim: ReportClaim;
  readonly identityMode: ExportIdentityMode;
}

function safeSlug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64);
}

export function districtExport(
  input: DistrictExportInput & { readonly format: ExportFormat },
): ExportedDocument {
  const envelope = districtExportJson(input);
  const stem = `pa-mastery-${safeSlug(input.chapterId)}-${safeSlug(
    input.generatedAt.slice(0, 10),
  )}`;

  if (input.format === "JSON") {
    return {
      filename: `${stem}.json`,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(envelope, null, 2),
      claim: envelope.claim,
      identityMode: input.identityMode,
    };
  }
  const csv =
    input.format === "STUDENT_SUMMARY_CSV"
      ? studentSummaryCsv(input)
      : standardEvidenceCsv(input);
  const suffix =
    input.format === "STUDENT_SUMMARY_CSV" ? "student-summary" : "standard-evidence";
  return {
    filename: `${stem}-${suffix}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: csv,
    claim: envelope.claim,
    identityMode: input.identityMode,
  };
}