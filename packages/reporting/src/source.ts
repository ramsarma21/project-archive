// Where the evidence comes from, and how honest it is about what it lost.
//
// Reporting reads one normalised shape, `CapstoneEvidence`, and there are two
// adapters onto it.
//
// THE EXACT PATH. `evidenceFromCapstoneReport` takes @pa/assessment's own
// `ChapterAssessmentReport`, which is a projection of the full event log. Every
// disclosure survives: which attempt achieved mastery, whether that form recycled
// items, whether a human review moved the first-sitting number, and the
// per-item provenance of the reported form. This is the path a report should be
// on, and the path it is on wherever the log is in hand.
//
// THE DEGRADED PATH. `evidenceFromDurableRows` rebuilds from the projected
// Postgres rows — `chapter_assessment_attempts` and `concept_mastery` — because
// the capstone event log is NOT durably stored today. `apps/api/src/migrations`
// has no events table, and the attempt row's `form` column is written without
// `freshness` or `openResponseItemIds`, so three facts genuinely cannot be
// recovered by any amount of cleverness:
//
//   - whether a mastering form repeated an item the student had already seen,
//   - whether a verdict was flagged for human review,
//   - the per-item provenance of the reported form.
//
// EVERY ONE OF THOSE COMES BACK AS null, NEVER AS false. That is the whole point
// of this file. `masteredWithRecycledItems: false` is a claim — it says the
// student demonstrated the concept on questions they had never seen — and making
// it on the strength of a column we never wrote would be fabricating a
// strengthening of exactly the disclosure the engine went to trouble to produce.
// `null` renders as "not recorded", and it puts
// `RECYCLED_ITEM_DISCLOSURE_UNAVAILABLE` on the report's claim block.
//
// What the projections CAN answer exactly is the distinction that matters most.
// Mastery is 100% of the items served for a concept in one attempt, so
// `first_attempt_correct === first_attempt_served > 0` is unaided mastery with no
// inference at all. And attempt 1 scopes every concept the bank could ask, so a
// chapter concept missing from attempt 1's scope was missing because we could not
// ask it — which is how item shortage stays separable from a student gap even on
// the degraded path.

import type { ChapterAssessmentReport, ProvenanceRollup } from "./assessment.js";
import { REPORTED_ATTEMPT_ORDINAL } from "./assessment.js";
import {
  outcomeFromEngineStatus,
  outcomeIsMastered,
  type ConceptOutcome,
} from "./evidence.js";

/** How close this report is to the log it should have been built from. */
export type EvidenceFidelity =
  /** Built from the capstone event log, through @pa/assessment. Nothing lost. */
  | "EXACT_FROM_LOG"
  /** Rebuilt from durable projections. See `disclosureGaps` for what is missing. */
  | "REBUILT_FROM_PROJECTIONS";

/** A disclosure the engine produces that this report could not recover. */
export type DisclosureGap =
  /** Whether mastery was demonstrated on a repeated item is not recorded. */
  | "RECYCLED_ITEM_DISCLOSURE_UNAVAILABLE"
  /** Which attempt achieved mastery could not be matched to an attempt. */
  | "MASTERING_ATTEMPT_UNKNOWN"
  /** The reported form's released-vs-authored item mix is not recorded. */
  | "FORM_PROVENANCE_UNAVAILABLE"
  /** Verdicts flagged for human review are not recorded. */
  | "GRADING_REVIEW_FLAGS_UNAVAILABLE"
  /** Whether a review revised the first-sitting number is not recorded. */
  | "FIRST_SITTING_REVISION_UNAVAILABLE";

export interface ConceptEvidenceFact {
  readonly conceptId: string;
  readonly outcome: ConceptOutcome;
  /** Attempt 1 only. Null when attempt 1 never asked about this concept. */
  readonly firstSitting: { readonly correct: number; readonly served: number } | null;
  readonly attemptsTried: number;
  readonly masteredOnAttempt: number | null;
  /** Null means not recorded. Never coerce it to false. */
  readonly masteredWithRecycledItems: boolean | null;
  readonly pvpLegal: boolean;
}

export interface AttemptFact {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly status: "IN_PROGRESS" | "SUBMITTED" | "ABANDONED";
  readonly isFirstSitting: boolean;
  readonly conceptsScoped: number;
  readonly conceptsMastered: number;
  readonly itemsCorrect: number | null;
  readonly itemsServed: number | null;
  readonly hadRecycledItems: boolean | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface FirstSittingFact {
  readonly itemsCorrect: number;
  readonly itemsServed: number;
  readonly submittedAt: string;
  readonly revisedByReview: boolean;
  readonly asSubmitted: { readonly correct: number; readonly served: number } | null;
}

export interface CapstoneEvidence {
  readonly profileId: string;
  readonly chapterId: string;
  readonly assessmentId: string;
  readonly fidelity: EvidenceFidelity;
  readonly disclosureGaps: readonly DisclosureGap[];
  /** One entry per chapter concept, in the chapter's own order. */
  readonly concepts: readonly ConceptEvidenceFact[];
  readonly firstSitting: FirstSittingFact | null;
  readonly attempts: readonly AttemptFact[];
  readonly chapterUnlocked: boolean;
  readonly itemsAwaitingGradingReview: readonly string[];
  readonly reportedFormProvenance: ProvenanceRollup | null;
}

// ---------------------------------------------------------------------------
// The exact path
// ---------------------------------------------------------------------------

export function evidenceFromCapstoneReport(
  report: ChapterAssessmentReport,
): CapstoneEvidence {
  const concepts: ConceptEvidenceFact[] = report.byConcept.map((row) => {
    const outcome = outcomeFromEngineStatus(row.status);
    return {
      conceptId: row.conceptId,
      outcome,
      firstSitting: row.firstAttempt
        ? { correct: row.firstAttempt.correct, served: row.firstAttempt.served }
        : null,
      attemptsTried: row.attemptsScoped,
      masteredOnAttempt: row.masteredOnAttempt,
      masteredWithRecycledItems: outcomeIsMastered(outcome)
        ? row.masteredWithRecycledItems
        : null,
      pvpLegal: row.pvpLegal,
    };
  });

  return {
    profileId: report.profileId,
    chapterId: report.chapterId,
    assessmentId: report.assessmentId,
    fidelity: "EXACT_FROM_LOG",
    disclosureGaps: [],
    concepts,
    firstSitting: report.reportedScore
      ? {
          itemsCorrect: report.reportedScore.numerator,
          itemsServed: report.reportedScore.denominator,
          submittedAt: report.reportedScore.submittedAt,
          revisedByReview: report.reportedScore.revisedByReview,
          asSubmitted: report.reportedScore.revisedByReview
            ? {
                correct: report.reportedScore.asSubmittedNumerator,
                served: report.reportedScore.asSubmittedDenominator,
              }
            : null,
        }
      : null,
    attempts: report.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      attemptOrdinal: attempt.attemptOrdinal,
      status: attempt.status,
      isFirstSitting: attempt.isReportedMeasure,
      conceptsScoped: attempt.conceptsScoped,
      conceptsMastered: attempt.conceptsMastered,
      itemsCorrect: attempt.scoreNumerator,
      itemsServed: attempt.scoreDenominator,
      hadRecycledItems: attempt.hadRecycledItems,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
    })),
    chapterUnlocked: report.unlock.kind === "UNLOCKED",
    itemsAwaitingGradingReview: [...report.needsGradingReview],
    reportedFormProvenance: report.reportedFormProvenance,
  };
}

// ---------------------------------------------------------------------------
// The degraded path
// ---------------------------------------------------------------------------

/** One row of `chapter_assessment_attempts`, as the API route reads it. */
export interface DurableAttemptRow {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly scopedConceptIds: readonly string[];
  readonly status: "IN_PROGRESS" | "SUBMITTED" | "ABANDONED";
  readonly scoreNumerator: number | null;
  readonly scoreDenominator: number | null;
  readonly startedAt: string;
  readonly submittedAt: string | null;
}

/** One row of `concept_mastery`, as the API route reads it. */
export interface DurableMasteryRow {
  readonly conceptId: string;
  readonly itemsServed: number;
  readonly itemsCorrect: number;
  readonly firstAttemptServed: number;
  readonly firstAttemptCorrect: number;
  readonly masteredAt: string | null;
}

export interface DurableCapstoneRows {
  readonly profileId: string;
  readonly chapterId: string;
  readonly assessmentId: string;
  /**
   * Every concept the chapter's capstone scopes, in the registry's order.
   *
   * Read from @pa/curriculum rather than from the rows, because a concept that
   * was never asked has no row — and a concept missing from a report is
   * indistinguishable from a concept nobody noticed was missing.
   */
  readonly chapterConceptIds: readonly string[];
  readonly attempts: readonly DurableAttemptRow[];
  readonly mastery: readonly DurableMasteryRow[];
}

/** Everything the projections structurally cannot answer. */
const PROJECTION_DISCLOSURE_GAPS: readonly DisclosureGap[] = [
  "RECYCLED_ITEM_DISCLOSURE_UNAVAILABLE",
  "FORM_PROVENANCE_UNAVAILABLE",
  "GRADING_REVIEW_FLAGS_UNAVAILABLE",
  "FIRST_SITTING_REVISION_UNAVAILABLE",
];

export function evidenceFromDurableRows(
  rows: DurableCapstoneRows,
): CapstoneEvidence {
  const masteryByConcept = new Map(
    rows.mastery.map((row) => [row.conceptId, row]),
  );
  const submitted = rows.attempts.filter(
    (attempt) => attempt.status === "SUBMITTED",
  );
  const firstAttempt = rows.attempts.find(
    (attempt) => attempt.attemptOrdinal === REPORTED_ATTEMPT_ORDINAL,
  );
  const firstSubmitted =
    firstAttempt && firstAttempt.status === "SUBMITTED" ? firstAttempt : undefined;

  // Attempt 1 scopes every concept the bank could build a form for, so its scope
  // IS the measurable set. Before attempt 1 exists there is no shortage signal at
  // all, and the honest answer for every concept is "not sat" rather than a guess.
  const firstScope = new Set(firstAttempt?.scopedConceptIds ?? []);
  const everScoped = new Set(
    submitted.flatMap((attempt) => [...attempt.scopedConceptIds]),
  );

  let masteringAttemptUnknown = false;

  const concepts: ConceptEvidenceFact[] = rows.chapterConceptIds.map(
    (conceptId) => {
      const row = masteryByConcept.get(conceptId);
      const mastered = row?.masteredAt != null;
      // 100% of what was served on attempt 1, with no partial credit, IS unaided
      // mastery. No inference: it is the engine's own rule read off the counters.
      const unaided =
        row !== undefined &&
        row.firstAttemptServed > 0 &&
        row.firstAttemptCorrect === row.firstAttemptServed;

      let outcome: ConceptOutcome;
      if (mastered) {
        outcome = unaided ? "MASTERED_UNAIDED" : "MASTERED_AFTER_SUPPORT";
      } else if (everScoped.has(conceptId) && (row?.itemsServed ?? 0) > 0) {
        outcome = "NOT_YET_MASTERED";
      } else if (firstAttempt === undefined) {
        outcome = "NOT_MEASURED_NOT_SAT";
      } else if (firstScope.has(conceptId) || everScoped.has(conceptId)) {
        // Scoped but never served: the attempt is still open on it.
        outcome = "NOT_MEASURED_NOT_SAT";
      } else {
        outcome = "NOT_MEASURED_ITEM_SHORTAGE";
      }

      let masteredOnAttempt: number | null = null;
      if (outcome === "MASTERED_UNAIDED") {
        masteredOnAttempt = REPORTED_ATTEMPT_ORDINAL;
      } else if (outcome === "MASTERED_AFTER_SUPPORT") {
        // `mastered_at` is written as the mastering attempt's submission time, so
        // the two match exactly when both are present.
        const match = submitted.find(
          (attempt) => attempt.submittedAt === row?.masteredAt,
        );
        masteredOnAttempt = match?.attemptOrdinal ?? null;
        if (masteredOnAttempt === null) masteringAttemptUnknown = true;
      }

      return {
        conceptId,
        outcome,
        firstSitting:
          row && row.firstAttemptServed > 0
            ? { correct: row.firstAttemptCorrect, served: row.firstAttemptServed }
            : null,
        attemptsTried: submitted.filter((attempt) =>
          attempt.scopedConceptIds.includes(conceptId),
        ).length,
        masteredOnAttempt,
        masteredWithRecycledItems: null,
        pvpLegal: mastered && outcome !== "NOT_MEASURED_ITEM_SHORTAGE",
      };
    },
  );

  const gating = concepts.filter(
    (concept) => concept.outcome !== "NOT_MEASURED_ITEM_SHORTAGE",
  );

  return {
    profileId: rows.profileId,
    chapterId: rows.chapterId,
    assessmentId: rows.assessmentId,
    fidelity: "REBUILT_FROM_PROJECTIONS",
    disclosureGaps: masteringAttemptUnknown
      ? [...PROJECTION_DISCLOSURE_GAPS, "MASTERING_ATTEMPT_UNKNOWN"]
      : PROJECTION_DISCLOSURE_GAPS,
    concepts,
    firstSitting: firstSubmitted
      ? {
          itemsCorrect: firstSubmitted.scoreNumerator ?? 0,
          itemsServed: firstSubmitted.scoreDenominator ?? 0,
          submittedAt: firstSubmitted.submittedAt ?? firstSubmitted.startedAt,
          revisedByReview: false,
          asSubmitted: null,
        }
      : null,
    attempts: rows.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      attemptOrdinal: attempt.attemptOrdinal,
      status: attempt.status,
      isFirstSitting: attempt.attemptOrdinal === REPORTED_ATTEMPT_ORDINAL,
      conceptsScoped: attempt.scopedConceptIds.length,
      conceptsMastered: concepts.filter(
        (concept) => concept.masteredOnAttempt === attempt.attemptOrdinal,
      ).length,
      itemsCorrect: attempt.scoreNumerator,
      itemsServed: attempt.scoreDenominator,
      hadRecycledItems: null,
      startedAt: attempt.startedAt,
      endedAt: attempt.submittedAt,
    })),
    chapterUnlocked:
      gating.length > 0 &&
      firstSubmitted !== undefined &&
      gating.every((concept) => outcomeIsMastered(concept.outcome)),
    itemsAwaitingGradingReview: [],
    reportedFormProvenance: null,
  };
}
