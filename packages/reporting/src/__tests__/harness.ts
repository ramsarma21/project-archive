// Fixtures for the reporting tests.
//
// The fixture chapter uses `TST.CONCEPT.*` ids and real-shaped SE codes, so the
// tests prove the package is data-driven over any chapter while
// `bostonRegistry.test.ts` separately proves it composes with the real one.
//
// The capstone report fixtures are hand-built rather than driven through
// @pa/assessment's own harness, which is not exported. That is a real seam risk —
// a fixture can drift from the engine's output — so `contractShape.test.ts`
// asserts the fixture is assignable to the engine's exported type and
// `bostonRegistry.test.ts` runs the whole pipeline against the live registry.

import { asCurriculumConceptId } from "@pa/curriculum";
import type {
  AttemptReportRow,
  ChapterAssessmentReport,
  ConceptReportRow,
  ConceptReportStatus,
  ProvenanceRollup,
} from "../assessment.js";
import { chapterReportKey } from "../assessment.js";
import { staticStandardsSource, type StandardsSource } from "../curriculum.js";
import type {
  DurableAttemptRow,
  DurableCapstoneRows,
  DurableMasteryRow,
} from "../source.js";
import { evidenceFromCapstoneReport } from "../source.js";
import {
  buildStudentChapterReport,
  type ReportSubject,
  type StudentChapterReport,
} from "../student.js";

export const CHAPTER = "CHAPTER.TEST";
export const ASSESSMENT_ID = "TST.CAPSTONE.v1";
export const PROFILE_A = "11111111-2222-4333-8444-555555555555";
export const PROFILE_B = "22222222-2222-4333-8444-555555555555";
export const PROFILE_C = "33333333-2222-4333-8444-555555555555";

/** Readiness, Reporting Category 1, and the one standard whose text we hold. */
export const SE_CAUSES = "8.4(A)";
/** Supporting, Reporting Category 3, described by our paraphrase. */
export const SE_GOVERNMENT = "8.15(A)";

export function conceptId(slug: string): string {
  return `TST.CONCEPT.${slug}.v1`;
}

export function attemptUuid(ordinal: number): string {
  return `00000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
}

// ---------------------------------------------------------------------------
// Standards
// ---------------------------------------------------------------------------

export interface ConceptSpec {
  readonly slug: string;
  readonly se?: string;
  readonly status: ConceptReportStatus;
  readonly firstAttempt?: { readonly correct: number; readonly served: number };
  readonly attemptsScoped?: number;
  readonly masteredOnAttempt?: number;
  readonly recycled?: boolean;
  /** Omit the concept from the standards source, to exercise the unmapped path. */
  readonly unregistered?: boolean;
  readonly reviewStatus?: "DRAFT" | "OWNER_PROVIDED" | "SME_APPROVED";
}

export function fixtureStandards(specs: readonly ConceptSpec[]): StandardsSource {
  return staticStandardsSource({
    concepts: specs
      .filter((spec) => !spec.unregistered)
      .map((spec) => ({
        conceptId: conceptId(spec.slug),
        label: `Concept ${spec.slug}`,
        parentSe: spec.se ?? SE_CAUSES,
        parentClauseId: spec.slug,
        alsoEvidences: [SE_GOVERNMENT],
        reviewStatus: spec.reviewStatus ?? "DRAFT",
      })),
    standards: [
      {
        seCode: SE_CAUSES,
        seCodeBare: "8.4A",
        reportingCategory: 1,
        reportingCategoryName: "History",
        standardType: "READINESS",
        description: "analyze causes of the American Revolution, including...",
        descriptionSource: "OFFICIAL_TEXT",
      },
      {
        seCode: SE_GOVERNMENT,
        seCodeBare: "8.15A",
        reportingCategory: 3,
        reportingCategoryName: "Government and Citizenship",
        standardType: "SUPPORTING",
        description: "Our paraphrase of the government standard.",
        descriptionSource: "WORKING_PARAPHRASE",
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// A capstone report, as @pa/assessment would produce it
// ---------------------------------------------------------------------------

export interface ReportSpec {
  readonly profileId?: string;
  readonly chapterId?: string;
  readonly concepts: readonly ConceptSpec[];
  readonly reportedScore?: {
    readonly numerator: number;
    readonly denominator: number;
    readonly asSubmittedNumerator?: number;
  } | null;
  readonly attempts?: readonly AttemptReportRow[];
  readonly needsGradingReview?: readonly string[];
  readonly provenance?: Partial<ProvenanceRollup> | null;
  readonly openAttempt?: boolean;
}

function conceptRow(spec: ConceptSpec): ConceptReportRow {
  const mastered = spec.status.startsWith("MASTERED");
  return {
    conceptId: asCurriculumConceptId(conceptId(spec.slug)),
    label: `Concept ${spec.slug}`,
    status: spec.status,
    firstAttempt: spec.firstAttempt
      ? {
          served: spec.firstAttempt.served,
          correct: spec.firstAttempt.correct,
          percent:
            spec.firstAttempt.served === 0
              ? 0
              : Math.round(
                  (spec.firstAttempt.correct / spec.firstAttempt.served) * 100,
                ),
        }
      : null,
    attemptsScoped:
      spec.attemptsScoped ??
      (spec.status === "NOT_ATTEMPTED" || spec.status === "NOT_ASSESSED_CONTENT_GAP"
        ? 0
        : 1),
    masteredOnAttempt: mastered
      ? (spec.masteredOnAttempt ??
        (spec.status === "MASTERED_FIRST_ATTEMPT" ? 1 : 2))
      : null,
    masteredWithRecycledItems: spec.recycled === true,
    pvpLegal: mastered && spec.status !== "NOT_ASSESSED_CONTENT_GAP",
  };
}

export function makeCapstoneReport(spec: ReportSpec): ChapterAssessmentReport {
  const profileId = spec.profileId ?? PROFILE_A;
  const chapterId = spec.chapterId ?? CHAPTER;
  const byConcept = spec.concepts.map(conceptRow);
  const gating = byConcept.filter(
    (row) => row.status !== "NOT_ASSESSED_CONTENT_GAP",
  );
  const unmastered = gating.filter((row) => !row.status.startsWith("MASTERED"));
  const contentGaps = byConcept
    .filter((row) => row.status === "NOT_ASSESSED_CONTENT_GAP")
    .map((row) => row.conceptId);

  const reportedScore =
    spec.reportedScore === null
      ? null
      : {
          attemptId: attemptUuid(1),
          submittedAt: "2026-02-01T10:00:00.000Z",
          numerator: spec.reportedScore?.numerator ?? 0,
          denominator: spec.reportedScore?.denominator ?? gating.length * 2,
          asSubmittedNumerator:
            spec.reportedScore?.asSubmittedNumerator ??
            spec.reportedScore?.numerator ??
            0,
          asSubmittedDenominator: spec.reportedScore?.denominator ?? gating.length * 2,
          revisedByReview:
            spec.reportedScore?.asSubmittedNumerator !== undefined &&
            spec.reportedScore.asSubmittedNumerator !==
              spec.reportedScore.numerator,
        };

  const attempts: AttemptReportRow[] = spec.attempts
    ? [...spec.attempts]
    : reportedScore
      ? [
          {
            attemptId: attemptUuid(1),
            attemptOrdinal: 1,
            status: spec.openAttempt ? "IN_PROGRESS" : "SUBMITTED",
            isReportedMeasure: true,
            conceptsScoped: gating.length,
            conceptsMastered: gating.filter(
              (row) => row.status === "MASTERED_FIRST_ATTEMPT",
            ).length,
            scoreNumerator: reportedScore.numerator,
            scoreDenominator: reportedScore.denominator,
            hadRecycledItems: false,
            startedAt: "2026-02-01T09:40:00.000Z",
            endedAt: "2026-02-01T10:00:00.000Z",
          },
        ]
      : [];

  return {
    reportKey: chapterReportKey(profileId, chapterId),
    profileId,
    chapterId,
    assessmentId: ASSESSMENT_ID,
    reportedScore,
    masteryNow: {
      masteredConcepts: gating.length - unmastered.length,
      gatingConcepts: gating.length,
      unmasteredConceptIds: unmastered.map((row) => row.conceptId),
      repairedConceptIds: gating
        .filter((row) => row.status === "MASTERED_AFTER_RETRY")
        .map((row) => row.conceptId),
    },
    byConcept,
    attempts,
    reportedFormProvenance:
      spec.provenance === null
        ? null
        : {
            total: 4,
            releasedTea: 2,
            authored: 2,
            samplerNotConfirmed: 0,
            openResponse: 1,
            releasedTeaItemIds: ["TEA-1", "TEA-2"],
            authoredItemIds: ["AUTH-1", "AUTH-2"],
            ...(spec.provenance ?? {}),
          },
    contentGaps,
    needsGradingReview: [...(spec.needsGradingReview ?? [])],
    awardedXp: 0,
    unlock:
      unmastered.length === 0 && gating.length > 0 && reportedScore !== null
        ? { kind: "UNLOCKED", passedAt: "2026-02-01T10:00:00.000Z", contentGaps: [] }
        : {
            kind: "BLOCKED",
            reason:
              gating.length === 0
                ? "NO_ASSESSABLE_CONTENT"
                : reportedScore === null
                  ? "NOT_ATTEMPTED"
                  : "CONCEPTS_UNMASTERED",
            unmasteredConceptIds: unmastered.map((row) => row.conceptId),
            contentGaps: contentGaps.map((id) => ({
              conceptId: id,
              reason: "UNASSESSABLE" as const,
            })),
          },
  };
}

export function subject(
  profileId: string,
  displayName: string | null = "Student",
  districtStudentRef: string | null = null,
): ReportSubject {
  return { profileId, displayName, districtStudentRef };
}

export function makeStudentReport(
  spec: ReportSpec & { readonly subject?: ReportSubject },
): StudentChapterReport {
  const report = makeCapstoneReport(spec);
  return buildStudentChapterReport({
    subject: spec.subject ?? subject(report.profileId),
    evidence: evidenceFromCapstoneReport(report),
    standards: fixtureStandards(spec.concepts),
    generatedAt: "2026-03-01T00:00:00.000Z",
  });
}

// ---------------------------------------------------------------------------
// Durable rows, as the API route reads them today
// ---------------------------------------------------------------------------

export interface DurableSpec {
  readonly profileId?: string;
  readonly chapterId?: string;
  readonly conceptSlugs: readonly string[];
  readonly attempts: readonly (Omit<DurableAttemptRow, "scopedConceptIds"> & {
    readonly scopedSlugs: readonly string[];
  })[];
  readonly mastery: readonly (Omit<DurableMasteryRow, "conceptId"> & {
    readonly slug: string;
  })[];
}

export function makeDurableRows(spec: DurableSpec): DurableCapstoneRows {
  return {
    profileId: spec.profileId ?? PROFILE_A,
    chapterId: spec.chapterId ?? CHAPTER,
    assessmentId: ASSESSMENT_ID,
    chapterConceptIds: spec.conceptSlugs.map(conceptId),
    attempts: spec.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      attemptOrdinal: attempt.attemptOrdinal,
      scopedConceptIds: attempt.scopedSlugs.map(conceptId),
      status: attempt.status,
      scoreNumerator: attempt.scoreNumerator,
      scoreDenominator: attempt.scoreDenominator,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
    })),
    mastery: spec.mastery.map((row) => ({
      conceptId: conceptId(row.slug),
      itemsServed: row.itemsServed,
      itemsCorrect: row.itemsCorrect,
      firstAttemptServed: row.firstAttemptServed,
      firstAttemptCorrect: row.firstAttemptCorrect,
      masteredAt: row.masteredAt,
    })),
  };
}

/** Every string value anywhere in a payload, for the leak assertions. */
export function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const entry of value) allStrings(entry, out);
  else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) allStrings(entry, out);
  }
  return out;
}

/** Every key name anywhere in a payload, for the mission-performance assertion. */
export function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const entry of value) allKeys(entry, out);
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      out.push(key);
      allKeys(entry, out);
    }
  }
  return out;
}
