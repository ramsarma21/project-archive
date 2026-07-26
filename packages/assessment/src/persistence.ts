// Projections onto the durable row shapes in @pa/contracts.
//
// This package is the engine; the API route owns the database. These functions
// are the seam: they turn a reduced record into exactly the rows
// `apps/api/src/progression` has to write, so the route does no derivation of its
// own and cannot arrive at a different answer than a replay would.
//
// The projections are typed against contracts' own row types rather than
// structurally similar copies, so a change to a stored shape breaks the build here
// rather than being discovered as a runtime mismatch after a migration.
//
// ONE FIELD IS WORTH POINTING AT. `ConceptMastery` is keyed by profile, CHAPTER,
// and concept. The mastery reporting this replaces was keyed by profile alone,
// which meant a second chapter's assessment overwrote the first chapter's record
// and a year of evidence became whatever happened most recently. Every projection
// below carries `chapterId`, and `conceptMasteryRows` reads it from the record
// rather than taking it as a parameter, so a caller cannot hand over the wrong
// chapter and quietly clobber another one's row.

import type { ChapterAssessmentRecord } from "./reduce.js";
import { REPORTED_ATTEMPT_ORDINAL } from "./reduce.js";
import type {
  AssessmentConceptLedger,
  ChapterAssessmentAttempt,
  ChapterAssessmentResponse,
  ConceptMastery,
} from "./protocol.js";

/**
 * Per-concept mastery rows.
 *
 * `firstAttempt*` and the cumulative counters are both persisted and are both
 * needed: the first pair is the reported measure and the second is what the gate
 * and the card minting read. A row with only one of them cannot answer both
 * questions, and a report that has to guess which one it is holding is a report
 * that will eventually guess wrong.
 */
export function conceptMasteryRows(
  record: ChapterAssessmentRecord,
  updatedAt: string,
): readonly ConceptMastery[] {
  return [...record.mastery.values()].map((entry) => ({
    profileId: record.profileId,
    chapterId: record.chapterId,
    conceptId: entry.conceptId,
    itemsServed: entry.cumulativeServed,
    itemsCorrect: entry.cumulativeCorrect,
    firstAttemptServed: entry.firstAttempt?.served ?? 0,
    firstAttemptCorrect: entry.firstAttempt?.correct ?? 0,
    masteredAt: entry.masteredAt,
    updatedAt,
  }));
}

/**
 * Attempt rows.
 *
 * `isReportedMeasure` is derived from the ordinal rather than stored as an
 * independent judgement, so it cannot end up true on two rows.
 */
export function attemptRows(
  record: ChapterAssessmentRecord,
  updatedAt: string,
): readonly ChapterAssessmentAttempt[] {
  return record.attempts.map((attempt) => ({
    attemptId: attempt.attemptId,
    profileId: record.profileId,
    chapterId: record.chapterId,
    assessmentId: record.assessmentId,
    attemptOrdinal: attempt.attemptOrdinal,
    scopedConceptIds: [...attempt.scopedConceptIds],
    form: attempt.form.map((entry) => ({
      conceptId: entry.conceptId,
      itemIds: [...entry.itemIds],
    })),
    // RECONCILED. This used to collapse ABANDONED onto SUBMITTED with a null
    // score, because the contract had no third state. It has one now, so the
    // status passes through and a student's history keeps the distinction between
    // a form handed in and a form walked away from.
    status: attempt.status,
    passed: attempt.summary ? attempt.summary.passed : null,
    scoreNumerator: attempt.summary?.scoreNumerator ?? null,
    scoreDenominator: attempt.summary?.scoreDenominator ?? null,
    isReportedMeasure: attempt.attemptOrdinal === REPORTED_ATTEMPT_ORDINAL,
    startedAt: attempt.startedAt,
    submittedAt: attempt.status === "SUBMITTED" ? attempt.endedAt : null,
    updatedAt,
  }));
}

/**
 * Graded response rows.
 *
 * RECONCILED. This projection previously stored blanks and open responses under
 * namespaced sentinel option ids, because the contract's row modelled a
 * selected-response item only — `selectedOptionId` was a required non-empty
 * string and there was no column for an open response's handle. Both gaps are now
 * fixed upstream: the row carries `itemFormat`, a nullable `selectedOptionId` and
 * a nullable `responseRef`, and it cross-validates them. The sentinels are gone
 * rather than kept for compatibility, since nothing had persisted them yet.
 *
 * `correct` is read off the authority's verdict rather than computed here.
 * Unanswered items are still included, with both handles null, so a query over
 * this table sees every item that was asked rather than only the ones a student
 * engaged with.
 */
export function responseRows(
  record: ChapterAssessmentRecord,
): readonly ChapterAssessmentResponse[] {
  const rows: ChapterAssessmentResponse[] = [];
  for (const attempt of record.attempts) {
    for (const response of attempt.responses) {
      const open = response.itemFormat === "OPEN_RESPONSE";
      rows.push({
        attemptId: attempt.attemptId,
        itemId: response.itemId,
        conceptId: response.conceptId,
        itemFormat: response.itemFormat,
        // The contract refuses an option id on an open-response row and a
        // response handle on a selected-response one, so each is nulled by format
        // rather than by whichever happened to be absent.
        selectedOptionId: open ? null : response.selectedOptionId,
        responseRef: open ? response.responseRef : null,
        correct: response.verdict?.kind === "CORRECT",
        answeredAt: response.answeredAt ?? attempt.endedAt ?? attempt.startedAt,
      });
    }
  }
  return rows;
}

/** The served-item ledger, already reconstructed from the log by the reducer. */
export function conceptLedgerRows(
  record: ChapterAssessmentRecord,
): readonly AssessmentConceptLedger[] {
  return record.servedLedger;
}
