// The teacher-facing report.
//
// TWO NUMBERS, NEVER ONE. A capstone produces two facts about a student and they
// answer different questions:
//
//   reportedScore — how much of the chapter the student held WHEN THEY FIRST SAT
//                   IT. Attempt 1 only. This is the measure of learning, and it is
//                   the one that goes to a teacher or a district.
//   masteryNow    — which concepts the student can now demonstrate, after however
//                   many retries it took. This is the measure of readiness, and it
//                   is what gates the chapter and mints cards.
//
// A student who scores 18/40 on the first sitting and then repairs every concept
// finishes with `reportedScore` 18/40 and `masteryNow` complete. Both are true.
// Collapsing them into one number would either erase the retries (and overstate
// what was known first time) or erase the repair (and understate what the student
// can now do), and a teacher needs the gap between them more than either number
// alone — it is the size of the gap that says whether the missions taught the
// chapter.
//
// The two are separate fields with names that cannot be mistaken for each other,
// and `ConceptReportRow.status` distinguishes MASTERED_FIRST_ATTEMPT from
// MASTERED_AFTER_RETRY so the distinction survives into the per-concept view.
//
// THE REPORT IS KEYED BY CHAPTER, AND THAT IS NOT A DETAIL. The mastery reporting
// this replaces was keyed by profile alone, so a second chapter's assessment
// overwrote the first chapter's record and a year's evidence became whatever
// happened most recently. `ChapterAssessmentReport` carries `chapterId`,
// `reportKey` composes profile AND chapter, and `teacherReportSet` indexes by that
// composite — so the collapse is not available even to a careless caller.

import type { ChapterAssessmentBlueprint } from "./blueprint.js";
import type { ConceptSource, CurriculumConceptId } from "./curriculum.js";
import { chapterUnlockDecision, type UnlockDecision } from "./gate.js";
import { formProvenanceRollup, type ItemBank, type ProvenanceRollup } from "./items.js";
import type {
  ChapterAssessmentRecord,
  ConceptMasteryState,
  ReportedScore,
} from "./reduce.js";
import { REPORTED_ATTEMPT_ORDINAL } from "./reduce.js";

/**
 * MASTERED_FIRST_ATTEMPT  — 100% on the first sitting. The student had it.
 * MASTERED_AFTER_RETRY    — repaired. Counts for the gate and the card; does not
 *                           change the reported score.
 * NOT_MASTERED            — asked, and still owed.
 * NOT_ASSESSED_CONTENT_GAP— the bank could not build a form for this concept, so
 *                           the student was never asked. Our gap, not theirs.
 * NOT_ATTEMPTED           — no submitted attempt has scoped it yet.
 */
export type ConceptReportStatus =
  | "MASTERED_FIRST_ATTEMPT"
  | "MASTERED_AFTER_RETRY"
  | "NOT_MASTERED"
  | "NOT_ASSESSED_CONTENT_GAP"
  | "NOT_ATTEMPTED";

export interface ConceptScore {
  readonly served: number;
  readonly correct: number;
  /** Rounded to the nearest integer. The exact fraction is alongside it. */
  readonly percent: number;
}

export interface ConceptReportRow {
  readonly conceptId: CurriculumConceptId;
  /** The registry's human label. A report keyed by identifier is unreadable. */
  readonly label: string;
  readonly status: ConceptReportStatus;
  /** Attempt 1 only. Null when attempt 1 never scoped this concept. */
  readonly firstAttempt: ConceptScore | null;
  readonly attemptsScoped: number;
  readonly masteredOnAttempt: number | null;
  /**
   * Mastery was reached on a form that repeated an item the student had already
   * seen. Weaker evidence, and never hidden.
   */
  readonly masteredWithRecycledItems: boolean;
  /** Whether this concept's cards may be taken into PvP. */
  readonly pvpLegal: boolean;
}

export interface AttemptReportRow {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly status: "IN_PROGRESS" | "SUBMITTED" | "ABANDONED";
  readonly isReportedMeasure: boolean;
  readonly conceptsScoped: number;
  readonly conceptsMastered: number;
  readonly scoreNumerator: number | null;
  readonly scoreDenominator: number | null;
  readonly hadRecycledItems: boolean;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

export interface MasteryNow {
  readonly masteredConcepts: number;
  /** Concepts that count toward the gate. Excludes content gaps. */
  readonly gatingConcepts: number;
  readonly unmasteredConceptIds: readonly CurriculumConceptId[];
  /** Mastered only after one or more retries. The repair, made visible. */
  readonly repairedConceptIds: readonly CurriculumConceptId[];
}

export interface ChapterAssessmentReport {
  /** Profile AND chapter. One key, so two chapters cannot share a row. */
  readonly reportKey: string;
  readonly profileId: string;
  readonly chapterId: string;
  readonly assessmentId: string;
  /**
   * The reported measure: attempt 1's score. Null until attempt 1 is submitted —
   * deliberately not backfilled from a retry, because a retry is not a first
   * sitting however much a blank field invites one.
   */
  readonly reportedScore: ReportedScore | null;
  /** Post-retry state. Gates the chapter; does not touch `reportedScore`. */
  readonly masteryNow: MasteryNow;
  readonly byConcept: readonly ConceptReportRow[];
  readonly attempts: readonly AttemptReportRow[];
  /**
   * Provenance of the items on the REPORTED form specifically. A retry has
   * different items and therefore different provenance, and averaging them would
   * describe a test nobody sat.
   */
  readonly reportedFormProvenance: ProvenanceRollup | null;
  /** Concepts the item bank could not ask. The content work list. */
  readonly contentGaps: readonly CurriculumConceptId[];
  /** Items whose verdict the authority flagged for a human to check. */
  readonly needsGradingReview: readonly string[];
  /** The capstone pays nothing. Stated so a report cannot imply otherwise. */
  readonly awardedXp: 0;
  readonly unlock: UnlockDecision;
}

export function chapterReportKey(profileId: string, chapterId: string): string {
  return `${profileId}::${chapterId}`;
}

function percent(correct: number, served: number): number {
  return served === 0 ? 0 : Math.round((correct / served) * 100);
}

function conceptStatus(entry: ConceptMasteryState): ConceptReportStatus {
  if (entry.unassessable) return "NOT_ASSESSED_CONTENT_GAP";
  if (entry.mastered) {
    return entry.masteredOnAttempt === REPORTED_ATTEMPT_ORDINAL
      ? "MASTERED_FIRST_ATTEMPT"
      : "MASTERED_AFTER_RETRY";
  }
  return entry.attemptsScoped === 0 ? "NOT_ATTEMPTED" : "NOT_MASTERED";
}

export interface BuildReportInput {
  readonly record: ChapterAssessmentRecord;
  readonly blueprint: ChapterAssessmentBlueprint;
  readonly concepts: ConceptSource;
  /** Needed only for the reported form's provenance rollup. */
  readonly bank: ItemBank;
}

export function buildChapterAssessmentReport(
  input: BuildReportInput,
): ChapterAssessmentReport {
  const { record, blueprint, concepts, bank } = input;

  const byConcept: ConceptReportRow[] = blueprint.conceptIds.map((conceptId) => {
    const entry = record.mastery.get(conceptId);
    const label = concepts.concept(conceptId)?.label ?? conceptId;
    if (!entry) {
      return {
        conceptId,
        label,
        status: "NOT_ATTEMPTED",
        firstAttempt: null,
        attemptsScoped: 0,
        masteredOnAttempt: null,
        masteredWithRecycledItems: false,
        pvpLegal: false,
      };
    }
    return {
      conceptId,
      label,
      status: conceptStatus(entry),
      firstAttempt: entry.firstAttempt
        ? {
            served: entry.firstAttempt.served,
            correct: entry.firstAttempt.correct,
            percent: percent(entry.firstAttempt.correct, entry.firstAttempt.served),
          }
        : null,
      attemptsScoped: entry.attemptsScoped,
      masteredOnAttempt: entry.masteredOnAttempt,
      masteredWithRecycledItems: entry.masteredWithRecycledItems,
      pvpLegal: entry.mastered && !entry.unassessable,
    };
  });

  const gating = byConcept.filter(
    (row) => row.status !== "NOT_ASSESSED_CONTENT_GAP",
  );

  const reportedAttempt = record.attempts.find(
    (attempt) =>
      attempt.attemptOrdinal === REPORTED_ATTEMPT_ORDINAL &&
      attempt.status === "SUBMITTED",
  );
  const reportedFormItems = reportedAttempt
    ? reportedAttempt.form
        .flatMap((entry) => entry.itemIds)
        .map((itemId) => bank.item(itemId))
        .filter((item): item is NonNullable<typeof item> => item !== undefined)
    : [];

  const needsGradingReview: string[] = [];
  for (const attempt of record.attempts) {
    for (const response of attempt.responses) {
      if (response.verdict?.needsReview) needsGradingReview.push(response.itemId);
    }
  }

  return {
    reportKey: chapterReportKey(record.profileId, record.chapterId),
    profileId: record.profileId,
    chapterId: record.chapterId,
    assessmentId: record.assessmentId,
    reportedScore: record.reportedScore,
    masteryNow: {
      masteredConcepts: gating.filter((row) => row.status.startsWith("MASTERED"))
        .length,
      gatingConcepts: gating.length,
      unmasteredConceptIds: gating
        .filter((row) => !row.status.startsWith("MASTERED"))
        .map((row) => row.conceptId),
      repairedConceptIds: gating
        .filter((row) => row.status === "MASTERED_AFTER_RETRY")
        .map((row) => row.conceptId),
    },
    byConcept,
    attempts: record.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      attemptOrdinal: attempt.attemptOrdinal,
      status: attempt.status,
      isReportedMeasure: attempt.attemptOrdinal === REPORTED_ATTEMPT_ORDINAL,
      conceptsScoped: attempt.scopedConceptIds.length,
      conceptsMastered: attempt.summary?.masteredConceptIds.length ?? 0,
      scoreNumerator: attempt.summary?.scoreNumerator ?? null,
      scoreDenominator: attempt.summary?.scoreDenominator ?? null,
      hadRecycledItems: attempt.hadRecycledItems,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
    })),
    reportedFormProvenance: reportedAttempt
      ? formProvenanceRollup(reportedFormItems)
      : null,
    contentGaps: [...record.unassessableConceptIds],
    needsGradingReview,
    awardedXp: 0,
    unlock: chapterUnlockDecision(record, blueprint),
  };
}

/**
 * Index reports by profile AND chapter.
 *
 * Exists so that a class-wide or multi-chapter view cannot repeat the bug this
 * replaces: keyed by profile alone, a student's Philadelphia capstone silently
 * overwrote their Boston one. Throws on a duplicate key rather than taking the
 * last write, because a duplicate here means two records claim to be the same
 * chapter's assessment of record and silently keeping one of them is how evidence
 * disappears.
 */
export function teacherReportSet(
  reports: readonly ChapterAssessmentReport[],
): ReadonlyMap<string, ChapterAssessmentReport> {
  const byKey = new Map<string, ChapterAssessmentReport>();
  for (const report of reports) {
    if (byKey.has(report.reportKey)) {
      throw new Error(
        `two assessment reports for the same profile and chapter: ${report.reportKey}`,
      );
    }
    byKey.set(report.reportKey, report);
  }
  return byKey;
}
