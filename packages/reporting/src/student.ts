// One student, one chapter. The audit artifact.
//
// This is NOT the primary teacher surface — the roster is (see roster.ts). This
// is what a teacher opens after the roster tells them which student to open, and
// what a district receives per student in an export. It is allowed to be long;
// the roster is not.
//
// KEYED BY PROFILE AND CHAPTER, using @pa/assessment's own `chapterReportKey`
// rather than a second key format. The reporting this replaces was keyed by
// profile alone, so a second chapter silently overwrote the first and a year of
// evidence became whatever happened most recently. Reusing the engine's key
// function means there is one composite key in the system rather than two that
// have to be kept in agreement.

import { chapterReportKey } from "./assessment.js";
import type { ProvenanceRollup } from "./assessment.js";
import { buildReportClaim, type ReportClaim } from "./claim.js";
import type { StandardsSource } from "./curriculum.js";
import {
  CURRENT_STANDING_BASIS,
  CURRENT_STANDING_LABEL,
  FIRST_SITTING_BASIS,
  FIRST_SITTING_LABEL,
  MEASURE_CURRENT,
  MEASURE_FIRST_SITTING,
  evidenceStrength,
  outcomeIsMastered,
  outcomeOwner,
  outcomeWasMeasured,
  percentOf,
  repairGap,
  summariseOutcomes,
  type ConceptOutcome,
  type CurrentStandingMeasure,
  type EvidenceProfile,
  type EvidenceStrength,
  type FirstSittingMeasure,
  type OutcomeOwner,
  type RepairGap,
} from "./evidence.js";
import { rollUpToStandards, type StandardsRollup } from "./standards.js";
import type { CapstoneEvidence, DisclosureGap, EvidenceFidelity } from "./source.js";

/**
 * MISSION PERFORMANCE IS DELIBERATELY ABSENT FROM EVERY TYPE IN THIS PACKAGE.
 *
 * There is no field here for XP, Level, Rank, mission clears, mission attempts,
 * duel wins, or PvP standing, and that is a design decision rather than a gap to
 * fill later. A mission is three minutes of parkour and a gunfight; how well a
 * student does at it measures reaction time, controller familiarity, and how much
 * of the game they have played. A teacher shown "Level 7, Rank 2" next to a TEKS
 * standard will read it as achievement, because that is what a number in a report
 * means — and they would then be reteaching on the basis of hand-eye coordination.
 *
 * The capstone is the assessment of record precisely because a mission can be
 * failed three times and the student advances anyway. Reporting the optional
 * half as though it were the mandatory half would invert the whole design.
 *
 * `reportingExcludesMissionPerformance` in the test suite asserts this against
 * the serialised payload rather than against this comment.
 */
export const MISSION_PERFORMANCE_IS_NOT_ACADEMIC_EVIDENCE = true;

/**
 * Who the report is about.
 *
 * `displayName` is the student's real name and is present only for a reader who
 * is already authorised to know it — a teacher reading their own roster. It is
 * null in every pseudonymous export. `districtStudentRef` is the district's own
 * identifier, supplied by whoever provisioned the roster; this package never
 * invents one, because an identifier we minted is one their SIS cannot join on.
 */
export interface ReportSubject {
  readonly profileId: string;
  readonly displayName: string | null;
  readonly districtStudentRef: string | null;
}

/** The standard a concept's mastery counts toward. */
export interface ConceptStandardRef {
  readonly seCode: string;
  readonly seCodeBare: string;
  readonly reportingCategory: number;
  readonly standardType: "READINESS" | "SUPPORTING";
  readonly clauseId: string | null;
}

export interface ConceptEvidenceRow {
  readonly conceptId: string;
  readonly label: string;
  readonly outcome: ConceptOutcome;
  /** STUDENT, PRODUCT, or NOBODY. The field that stops the two gaps merging. */
  readonly owner: OutcomeOwner;
  readonly measured: boolean;
  readonly evidenceStrength: EvidenceStrength;
  readonly standard: ConceptStandardRef | null;
  /** Attempt 1 only. Null — not zero — when attempt 1 never asked this. */
  readonly firstSitting: {
    readonly correct: number;
    readonly served: number;
    readonly percent: number;
  } | null;
  readonly attemptsTried: number;
  readonly masteredOnAttempt: number | null;
  readonly pvpLegal: boolean;
}

export interface AttemptTrailRow {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly status: "IN_PROGRESS" | "SUBMITTED" | "ABANDONED";
  readonly isFirstSitting: boolean;
  readonly conceptsScoped: number;
  readonly conceptsMastered: number;
  readonly itemsCorrect: number | null;
  readonly itemsServed: number | null;
  /** Null means the disclosure was not recorded. Never read it as false. */
  readonly hadRecycledItems: boolean | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface StudentChapterReport {
  /** Profile AND chapter. Two chapters cannot collapse onto one row. */
  readonly reportKey: string;
  readonly profileId: string;
  readonly chapterId: string;
  readonly assessmentId: string;
  readonly generatedAt: string;
  readonly subject: ReportSubject;

  /** The reported academic measure. Null until attempt 1 is submitted. */
  readonly firstSitting: FirstSittingMeasure | null;
  /** What the student can demonstrate now. Gates the chapter; is not the score. */
  readonly currentStanding: CurrentStandingMeasure;
  /** The distance between the two, which is the most informative number here. */
  readonly repair: RepairGap;

  readonly evidence: EvidenceProfile;
  readonly byConcept: readonly ConceptEvidenceRow[];
  readonly standards: StandardsRollup;
  readonly attempts: readonly AttemptTrailRow[];

  /** Concepts the item bank could not ask. Our backlog, never their failure. */
  readonly coverageDebtConceptIds: readonly string[];
  readonly itemsAwaitingGradingReview: readonly string[];
  readonly reportedFormProvenance: ProvenanceRollup | null;

  readonly fidelity: EvidenceFidelity;
  readonly disclosureGaps: readonly DisclosureGap[];
  readonly claim: ReportClaim;
  /** The capstone pays nothing. Stated so a report cannot imply otherwise. */
  readonly awardedXp: 0;
}

export interface BuildStudentReportInput {
  readonly subject: ReportSubject;
  readonly evidence: CapstoneEvidence;
  readonly standards: StandardsSource;
  /** No clock inside pure code. The caller stamps it. */
  readonly generatedAt: string;
}

export function buildStudentChapterReport(
  input: BuildStudentReportInput,
): StudentChapterReport {
  const { subject, evidence, standards, generatedAt } = input;

  let standardsTextUnverified = false;
  let conceptMappingUnreviewed = false;

  const byConcept: ConceptEvidenceRow[] = evidence.concepts.map((fact) => {
    const descriptor = standards.concept(fact.conceptId);
    const standard = descriptor
      ? standards.standard(descriptor.parentSe)
      : undefined;
    if (standard?.descriptionSource === "WORKING_PARAPHRASE") {
      standardsTextUnverified = true;
    }
    if (descriptor && descriptor.reviewStatus !== "SME_APPROVED") {
      conceptMappingUnreviewed = true;
    }
    return {
      conceptId: fact.conceptId,
      // The registry's label, falling back to the id only when the registry does
      // not hold the concept — which is itself worth seeing in the report.
      label: descriptor?.label ?? fact.conceptId,
      outcome: fact.outcome,
      owner: outcomeOwner(fact.outcome),
      measured: outcomeWasMeasured(fact.outcome),
      evidenceStrength: evidenceStrength(
        fact.outcome,
        fact.masteredWithRecycledItems,
      ),
      standard: standard
        ? {
            seCode: standard.seCode,
            seCodeBare: standard.seCodeBare,
            reportingCategory: standard.reportingCategory,
            standardType: standard.standardType,
            clauseId: descriptor?.parentClauseId ?? null,
          }
        : null,
      firstSitting: fact.firstSitting
        ? {
            correct: fact.firstSitting.correct,
            served: fact.firstSitting.served,
            percent: percentOf(
              fact.firstSitting.correct,
              fact.firstSitting.served,
            ),
          }
        : null,
      attemptsTried: fact.attemptsTried,
      masteredOnAttempt: fact.masteredOnAttempt,
      pvpLegal: fact.pvpLegal,
    };
  });

  const profile = summariseOutcomes(byConcept.map((row) => row.outcome));
  const gating = byConcept.filter(
    (row) => row.outcome !== "NOT_MEASURED_ITEM_SHORTAGE",
  );
  const mastered = gating.filter((row) => outcomeIsMastered(row.outcome));

  const currentStanding: CurrentStandingMeasure = {
    measure: MEASURE_CURRENT,
    label: CURRENT_STANDING_LABEL,
    basis: CURRENT_STANDING_BASIS,
    conceptsMastered: mastered.length,
    conceptsRequired: gating.length,
    percent: percentOf(mastered.length, gating.length),
    repairedConceptIds: gating
      .filter((row) => row.outcome === "MASTERED_AFTER_SUPPORT")
      .map((row) => row.conceptId),
    outstandingConceptIds: gating
      .filter((row) => !outcomeIsMastered(row.outcome))
      .map((row) => row.conceptId),
    attemptsUsed: evidence.attempts.length,
    chapterUnlocked: evidence.chapterUnlocked,
  };

  const firstSitting: FirstSittingMeasure | null = evidence.firstSitting
    ? {
        measure: MEASURE_FIRST_SITTING,
        label: FIRST_SITTING_LABEL,
        basis: FIRST_SITTING_BASIS,
        itemsCorrect: evidence.firstSitting.itemsCorrect,
        itemsServed: evidence.firstSitting.itemsServed,
        percent: percentOf(
          evidence.firstSitting.itemsCorrect,
          evidence.firstSitting.itemsServed,
        ),
        conceptsMasteredUnaided: profile.masteredUnaided,
        conceptsAsked: byConcept.filter(
          (row) => row.firstSitting !== null,
        ).length,
        submittedAt: evidence.firstSitting.submittedAt,
        revisedByReview: evidence.firstSitting.revisedByReview,
        asSubmitted: evidence.firstSitting.asSubmitted
          ? {
              itemsCorrect: evidence.firstSitting.asSubmitted.correct,
              itemsServed: evidence.firstSitting.asSubmitted.served,
            }
          : null,
        coversWholeChapter: profile.coverageDebt === 0,
      }
    : null;

  return {
    reportKey: chapterReportKey(evidence.profileId, evidence.chapterId),
    profileId: evidence.profileId,
    chapterId: evidence.chapterId,
    assessmentId: evidence.assessmentId,
    generatedAt,
    subject,
    firstSitting,
    currentStanding,
    repair: repairGap({ firstSitting, current: currentStanding }),
    evidence: profile,
    byConcept,
    standards: rollUpToStandards(
      byConcept.map((row) => ({
        conceptId: row.conceptId,
        outcome: row.outcome,
      })),
      standards,
    ),
    attempts: evidence.attempts.map((attempt) => ({ ...attempt })),
    coverageDebtConceptIds: byConcept
      .filter((row) => row.outcome === "NOT_MEASURED_ITEM_SHORTAGE")
      .map((row) => row.conceptId),
    itemsAwaitingGradingReview: [...evidence.itemsAwaitingGradingReview],
    reportedFormProvenance: evidence.reportedFormProvenance,
    fidelity: evidence.fidelity,
    disclosureGaps: [...evidence.disclosureGaps],
    claim: buildReportClaim({
      hasFirstSitting: firstSitting !== null,
      coverageDebt: profile.coverageDebt,
      masteryOnRecycledItems: byConcept.some(
        (row) => row.evidenceStrength === "RECYCLED_ITEMS",
      ),
      itemsAwaitingGradingReview: evidence.itemsAwaitingGradingReview.length,
      scoreRevisedByReview: firstSitting?.revisedByReview ?? false,
      reportedFormProvenance: evidence.reportedFormProvenance,
      fidelity: evidence.fidelity,
      disclosureGaps: evidence.disclosureGaps,
      standardsTextUnverified,
      conceptMappingUnreviewed,
    }),
    awardedXp: 0,
  };
}

/**
 * Strip a report down to what its own subject may see.
 *
 * A student reading their own record gets the concept detail and both measures —
 * withholding a student's own evidence from them is not a privacy control, it is
 * an obstruction — but not the operational fields that exist for an adult
 * auditor: the reported form's item provenance, the ids of items queued for human
 * review, and the rebuild-fidelity block. Those describe our machinery rather
 * than their learning, and the first two are a map of the item bank.
 */
export function studentSelfView(
  report: StudentChapterReport,
): StudentChapterReport {
  return {
    ...report,
    subject: {
      profileId: report.subject.profileId,
      displayName: report.subject.displayName,
      districtStudentRef: null,
    },
    itemsAwaitingGradingReview: [],
    reportedFormProvenance: null,
  };
}
