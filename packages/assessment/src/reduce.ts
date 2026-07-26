// The reducer: an event log in, the assessment record out.
//
// Pure, synchronous, total, and deterministic. No clock — every timestamp comes
// from an event. No randomness — the only variation was the stored seed, and it
// was already spent at selection. Fold the same log twice and the two records are
// identical, which is what `determinism.test.ts` asserts against real gameplay.
//
// NOTHING IN THE RECORD IS TRUSTED FROM THE LOG. Score, per-concept mastery, the
// 100% rule, which cards become PvP-legal, and whether the chapter unlocks are
// all computed here from three kinds of committed fact: what was served, what was
// answered, and how the authority graded it. There is deliberately no event that
// asserts any of them (see events.ts), so this is not a matter of the reducer
// choosing to recompute — there is nothing to copy.
//
// HOW THE FIRST-ATTEMPT SCORE STAYS SEPARATE FROM REPAIRED MASTERY.
//
// The reported measure is not a field that gets written once and defended against
// later writes. It is a projection over attempt ordinal 1 only:
// `firstAttempt` for a concept reads exclusively the events of the attempt whose
// ordinal is 1, and `reportedScore` reads exclusively that attempt's summary. A
// retry carries ordinal 2 or higher, so a retry cannot contribute to the reported
// measure — not because it is forbidden to, but because the projection never
// looks at it. Meanwhile `mastered` is sticky across attempts, because that is
// what gates the chapter and mints the card.
//
// Both numbers therefore exist at once and mean different things: a student can
// finish with 18/40 reported and every concept mastered, and the report shows
// both. See report.ts.

import type { ChapterAssessmentBlueprint } from "./blueprint.js";
import type { ConceptSource, CurriculumConceptId } from "./curriculum.js";
import {
  itemFormatFromForm,
  type AssessmentEvent,
  type FormConceptRecord,
} from "./events.js";
import { verdictIsCorrect, type AssessmentVerdict } from "./grading.js";
import type { ConceptFreshness, ServedLedger } from "./select.js";
import {
  summarizeAssessmentForm,
  type AssessmentFormSummary,
  type GradedAssessmentResponse,
  type ProgressionLedgerEntry,
} from "./protocol.js";

/** The ordinal whose score is reported to a teacher. There is only one. */
export const REPORTED_ATTEMPT_ORDINAL = 1;

export type AttemptStatus = "IN_PROGRESS" | "SUBMITTED" | "ABANDONED";

export interface ResponseState {
  readonly itemId: string;
  readonly conceptId: CurriculumConceptId;
  /** Read off the committed form, so a projection never needs the bank. */
  readonly itemFormat: "SELECTED_RESPONSE" | "OPEN_RESPONSE";
  readonly selectedOptionId: string | null;
  readonly responseRef: string | null;
  /** The verdict in force. An override shadows the original. */
  readonly verdict: AssessmentVerdict | null;
  readonly overridden: boolean;
  readonly answeredAt: string | null;
}

export interface AttemptState {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly scopedConceptIds: readonly CurriculumConceptId[];
  readonly form: readonly FormConceptRecord[];
  readonly seedHex: string;
  readonly unassessableConceptIds: readonly CurriculumConceptId[];
  readonly moduleCompletionId: string;
  readonly status: AttemptStatus;
  readonly responses: readonly ResponseState[];
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** Null until submitted. Reflects every verdict, including later overrides. */
  readonly summary: AssessmentFormSummary | null;
  /**
   * The summary as it stood the moment the form was handed in. Diverges from
   * `summary` only when a human review changed a verdict afterwards, which is
   * exactly the case a report must not hide.
   */
  readonly summaryAsSubmitted: AssessmentFormSummary | null;
  /** True when the form repeated any item the student had already been served. */
  readonly hadRecycledItems: boolean;
}

export interface ConceptAttemptScore {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly served: number;
  readonly correct: number;
  readonly freshness: ConceptFreshness;
}

export interface ConceptMasteryState {
  readonly conceptId: CurriculumConceptId;
  /**
   * Attempt 1 only, and null for a concept attempt 1 never scoped. This is the
   * reported measure's per-concept detail.
   */
  readonly firstAttempt: ConceptAttemptScore | null;
  /** The most recent attempt that scoped this concept. */
  readonly latest: ConceptAttemptScore | null;
  readonly attemptsScoped: number;
  readonly cumulativeServed: number;
  readonly cumulativeCorrect: number;
  /** 100% on every item served for this concept in one attempt. Sticky. */
  readonly mastered: boolean;
  readonly masteredOnAttempt: number | null;
  readonly masteredAt: string | null;
  /**
   * The attempt that achieved mastery repeated at least one item this student
   * had already seen. Weaker evidence, so it is never dropped.
   */
  readonly masteredWithRecycledItems: boolean;
  /** The bank cannot build a form for this concept. Never asked, never mastered. */
  readonly unassessable: boolean;
}

export interface ReportedScore {
  readonly attemptId: string;
  readonly submittedAt: string;
  readonly numerator: number;
  readonly denominator: number;
  /** The number as handed in, before any human review. */
  readonly asSubmittedNumerator: number;
  readonly asSubmittedDenominator: number;
  readonly revisedByReview: boolean;
}

export interface MintedPvpCard {
  readonly cardId: string;
  readonly conceptId: CurriculumConceptId;
  readonly mintedAt: string;
}

export interface ChapterAssessmentRecord {
  readonly assessmentId: string;
  readonly chapterId: string;
  readonly profileId: string;
  readonly attempts: readonly AttemptState[];
  readonly openAttempt: AttemptState | null;
  readonly mastery: ReadonlyMap<CurriculumConceptId, ConceptMasteryState>;
  /** Attempt 1's score, and nothing else, ever. Null until attempt 1 is in. */
  readonly reportedScore: ReportedScore | null;
  readonly passed: boolean;
  readonly passedAt: string | null;
  readonly pvpLegalCards: readonly MintedPvpCard[];
  /** Concepts the bank could not ask. Excluded from the gate; no card minted. */
  readonly unassessableConceptIds: readonly CurriculumConceptId[];
  /**
   * The served-item ledger, reconstructed from the log rather than stored
   * alongside it. Two copies of "what has this student seen" would eventually
   * disagree, and the log is the one that has to be right.
   */
  readonly servedLedger: ServedLedger;
  /** Rows for the progression ledger in @pa/contracts. */
  readonly ledger: readonly ProgressionLedgerEntry[];
}

export interface ReduceContext {
  readonly blueprint: ChapterAssessmentBlueprint;
  readonly concepts: ConceptSource;
}

// ---------------------------------------------------------------------------
// Mutable working state. Confined to this file; nothing mutable escapes.
// ---------------------------------------------------------------------------

interface WorkingAttempt {
  attemptId: string;
  attemptOrdinal: number;
  scopedConceptIds: CurriculumConceptId[];
  form: FormConceptRecord[];
  seedHex: string;
  unassessableConceptIds: CurriculumConceptId[];
  moduleCompletionId: string;
  status: AttemptStatus;
  responses: Map<string, ResponseState>;
  startedAt: string;
  endedAt: string | null;
  summaryAsSubmitted: AssessmentFormSummary | null;
}

function gradedResponses(attempt: WorkingAttempt): GradedAssessmentResponse[] {
  const graded: GradedAssessmentResponse[] = [];
  for (const response of attempt.responses.values()) {
    if (!response.verdict) continue;
    graded.push({
      itemId: response.itemId,
      conceptId: response.conceptId,
      correct: verdictIsCorrect(response.verdict),
    });
  }
  return graded;
}

/**
 * Score one attempt's form.
 *
 * The 100%-per-concept rule is contracts' `summarizeAssessmentForm`, consumed
 * rather than re-derived. It counts an unanswered item against the concept, which
 * is why skipping is never cheaper than guessing.
 */
function summarize(attempt: WorkingAttempt): AssessmentFormSummary {
  return summarizeAssessmentForm(
    attempt.form.map((entry) => ({
      conceptId: entry.conceptId,
      itemIds: [...entry.itemIds],
    })),
    gradedResponses(attempt),
  );
}

function freezeAttempt(attempt: WorkingAttempt): AttemptState {
  const summary = attempt.status === "SUBMITTED" ? summarize(attempt) : null;
  return {
    attemptId: attempt.attemptId,
    attemptOrdinal: attempt.attemptOrdinal,
    scopedConceptIds: [...attempt.scopedConceptIds],
    form: [...attempt.form],
    seedHex: attempt.seedHex,
    unassessableConceptIds: [...attempt.unassessableConceptIds],
    moduleCompletionId: attempt.moduleCompletionId,
    status: attempt.status,
    // Form order, not answer order: a report reads by concept.
    responses: attempt.form
      .flatMap((entry) => entry.itemIds)
      .map((itemId) => attempt.responses.get(itemId))
      .filter((response): response is ResponseState => response !== undefined),
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    summary,
    summaryAsSubmitted: attempt.summaryAsSubmitted,
    hadRecycledItems: attempt.form.some((entry) => entry.freshness !== "FRESH"),
  };
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

export function reduceAssessment(
  events: readonly AssessmentEvent[],
  context: ReduceContext,
): ChapterAssessmentRecord {
  const { blueprint, concepts } = context;
  const attempts: WorkingAttempt[] = [];
  const byId = new Map<string, WorkingAttempt>();
  let profileId = "";

  for (const event of events) {
    switch (event.type) {
      case "ATTEMPT_OPENED": {
        profileId = event.profileId;
        const attempt: WorkingAttempt = {
          attemptId: event.attemptId,
          attemptOrdinal: event.attemptOrdinal,
          scopedConceptIds: [...event.scopedConceptIds],
          form: [...event.form],
          seedHex: event.seedHex,
          unassessableConceptIds: [...event.unassessableConceptIds],
          moduleCompletionId: event.moduleCompletionId,
          status: "IN_PROGRESS",
          responses: new Map(),
          startedAt: event.at,
          endedAt: null,
          summaryAsSubmitted: null,
        };
        attempts.push(attempt);
        byId.set(attempt.attemptId, attempt);
        break;
      }
      case "RESPONSE_RECORDED": {
        const attempt = byId.get(event.attemptId);
        if (!attempt) break;
        const existing = attempt.responses.get(event.itemId);
        attempt.responses.set(event.itemId, {
          itemId: event.itemId,
          conceptId: event.conceptId,
          itemFormat: itemFormatFromForm(attempt.form, event.itemId),
          selectedOptionId: event.selectedOptionId,
          responseRef: event.responseRef,
          // Changing an answer discards the verdict on the old one. Keeping it
          // would let a student answer correctly, revise, and keep the credit.
          verdict: null,
          overridden: existing?.overridden ?? false,
          answeredAt: event.at,
        });
        break;
      }
      case "VERDICT_COMMITTED":
      case "VERDICT_OVERRIDDEN": {
        const attempt = byId.get(event.attemptId);
        if (!attempt) break;
        const existing = attempt.responses.get(event.itemId);
        attempt.responses.set(event.itemId, {
          itemId: event.itemId,
          conceptId: event.conceptId,
          itemFormat: itemFormatFromForm(attempt.form, event.itemId),
          selectedOptionId: existing?.selectedOptionId ?? null,
          responseRef: existing?.responseRef ?? event.verdict.responseRef,
          verdict: event.verdict,
          overridden:
            event.type === "VERDICT_OVERRIDDEN" || (existing?.overridden ?? false),
          answeredAt: existing?.answeredAt ?? null,
        });
        break;
      }
      case "ATTEMPT_SUBMITTED": {
        const attempt = byId.get(event.attemptId);
        if (!attempt || attempt.status !== "IN_PROGRESS") break;
        attempt.status = "SUBMITTED";
        attempt.endedAt = event.at;
        // Snapshot before any later override, so a revision is visible as a
        // difference rather than overwriting the number that was reported.
        attempt.summaryAsSubmitted = summarize(attempt);
        break;
      }
      case "ATTEMPT_ABANDONED": {
        const attempt = byId.get(event.attemptId);
        if (!attempt || attempt.status !== "IN_PROGRESS") break;
        attempt.status = "ABANDONED";
        attempt.endedAt = event.at;
        break;
      }
    }
  }

  const frozen = attempts.map(freezeAttempt);
  const mastery = deriveMastery(frozen, blueprint);
  const cards = deriveCards(mastery, concepts);
  const gateConcepts = blueprint.conceptIds.filter(
    (conceptId) => !mastery.get(conceptId)?.unassessable,
  );
  const passed =
    gateConcepts.length > 0 &&
    gateConcepts.every((conceptId) => mastery.get(conceptId)?.mastered === true);

  return {
    assessmentId: blueprint.assessmentId,
    chapterId: blueprint.chapterId,
    profileId,
    attempts: frozen,
    openAttempt: frozen.find((attempt) => attempt.status === "IN_PROGRESS") ?? null,
    mastery,
    reportedScore: deriveReportedScore(frozen),
    passed,
    passedAt: passed ? derivePassedAt(frozen, gateConcepts, mastery) : null,
    pvpLegalCards: cards,
    unassessableConceptIds: [...mastery.values()]
      .filter((entry) => entry.unassessable)
      .map((entry) => entry.conceptId),
    servedLedger: deriveServedLedger(frozen),
    ledger: deriveLedger(frozen, mastery, cards, blueprint, passed),
  };
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

function deriveMastery(
  attempts: readonly AttemptState[],
  blueprint: ChapterAssessmentBlueprint,
): ReadonlyMap<CurriculumConceptId, ConceptMasteryState> {
  interface Working {
    firstAttempt: ConceptAttemptScore | null;
    latest: ConceptAttemptScore | null;
    attemptsScoped: number;
    cumulativeServed: number;
    cumulativeCorrect: number;
    mastered: boolean;
    masteredOnAttempt: number | null;
    masteredAt: string | null;
    masteredWithRecycledItems: boolean;
    unassessable: boolean;
  }

  const working = new Map<CurriculumConceptId, Working>();
  const blank = (): Working => ({
    firstAttempt: null,
    latest: null,
    attemptsScoped: 0,
    cumulativeServed: 0,
    cumulativeCorrect: 0,
    mastered: false,
    masteredOnAttempt: null,
    masteredAt: null,
    masteredWithRecycledItems: false,
    unassessable: false,
  });

  // Every concept the blueprint scopes gets a row, whether or not it was ever
  // served. A concept missing from the report is indistinguishable from a
  // concept nobody noticed was missing.
  for (const conceptId of blueprint.conceptIds) working.set(conceptId, blank());

  for (const attempt of attempts) {
    for (const conceptId of attempt.unassessableConceptIds) {
      const entry = working.get(conceptId) ?? blank();
      entry.unassessable = true;
      working.set(conceptId, entry);
    }
    if (attempt.status !== "SUBMITTED" || !attempt.summary) continue;

    for (const result of attempt.summary.byConcept) {
      const conceptId = result.conceptId as CurriculumConceptId;
      const entry = working.get(conceptId) ?? blank();
      const freshness =
        attempt.form.find((form) => form.conceptId === conceptId)?.freshness ??
        "FRESH";
      const score: ConceptAttemptScore = {
        attemptId: attempt.attemptId,
        attemptOrdinal: attempt.attemptOrdinal,
        served: result.served,
        correct: result.correct,
        freshness,
      };

      // The reported measure reads ordinal 1 and nothing else. A retry carries a
      // higher ordinal, so it never reaches this branch.
      if (attempt.attemptOrdinal === REPORTED_ATTEMPT_ORDINAL) {
        entry.firstAttempt = score;
      }
      entry.latest = score;
      entry.attemptsScoped += 1;
      entry.cumulativeServed += result.served;
      entry.cumulativeCorrect += result.correct;

      // Sticky: a concept once demonstrated is never taken back. A shrinking
      // retry would not scope it again anyway, so this only guards a replayed or
      // out-of-order log.
      if (result.mastered && !entry.mastered) {
        entry.mastered = true;
        entry.masteredOnAttempt = attempt.attemptOrdinal;
        entry.masteredAt = attempt.endedAt;
        entry.masteredWithRecycledItems = freshness !== "FRESH";
      }
      // An unassessable concept that later became assessable is no longer a gap.
      if (entry.unassessable && result.served > 0) entry.unassessable = false;
      working.set(conceptId, entry);
    }
  }

  return new Map(
    [...working.entries()].map(([conceptId, entry]) => [
      conceptId,
      { conceptId, ...entry },
    ]),
  );
}

/**
 * Attempt 1's score, and nothing else.
 *
 * Null when attempt 1 has not been submitted — including when it was abandoned,
 * because a walked-away attempt measured nothing. An abandoned first attempt does
 * NOT promote attempt 2 into the reported slot: the ordinal is the definition, and
 * letting a second sitting become "the first attempt" would make the reported
 * measure something a student could shop for by walking out of a bad form.
 */
function deriveReportedScore(
  attempts: readonly AttemptState[],
): ReportedScore | null {
  const first = attempts.find(
    (attempt) =>
      attempt.attemptOrdinal === REPORTED_ATTEMPT_ORDINAL &&
      attempt.status === "SUBMITTED",
  );
  if (!first || !first.summary || !first.summaryAsSubmitted) return null;
  return {
    attemptId: first.attemptId,
    submittedAt: first.endedAt ?? "",
    numerator: first.summary.scoreNumerator,
    denominator: first.summary.scoreDenominator,
    asSubmittedNumerator: first.summaryAsSubmitted.scoreNumerator,
    asSubmittedDenominator: first.summaryAsSubmitted.scoreDenominator,
    revisedByReview:
      first.summary.scoreNumerator !== first.summaryAsSubmitted.scoreNumerator ||
      first.summary.scoreDenominator !== first.summaryAsSubmitted.scoreDenominator,
  };
}

/**
 * Cards a concept's 100% makes PvP-legal.
 *
 * A concept with no authored card mints nothing and that is legal. An
 * unassessable concept mints nothing either, which is the strict half of the
 * lenient gate in gate.ts: a student advances past a concept the bank could not
 * ask, but they do not get to take its card into PvP on no evidence.
 */
function deriveCards(
  mastery: ReadonlyMap<CurriculumConceptId, ConceptMasteryState>,
  concepts: ConceptSource,
): readonly MintedPvpCard[] {
  const minted: MintedPvpCard[] = [];
  for (const entry of mastery.values()) {
    if (!entry.mastered || entry.unassessable) continue;
    const concept = concepts.concept(entry.conceptId);
    if (!concept) continue;
    for (const cardId of concept.codexCardIds) {
      minted.push({
        cardId,
        conceptId: entry.conceptId,
        mintedAt: entry.masteredAt ?? "",
      });
    }
  }
  return minted;
}

/** When the last gating concept fell into place. */
function derivePassedAt(
  attempts: readonly AttemptState[],
  gateConcepts: readonly CurriculumConceptId[],
  mastery: ReadonlyMap<CurriculumConceptId, ConceptMasteryState>,
): string | null {
  let latest: string | null = null;
  for (const conceptId of gateConcepts) {
    const at = mastery.get(conceptId)?.masteredAt ?? null;
    if (at === null) return null;
    if (latest === null || at > latest) latest = at;
  }
  // Fall back to the last submission when mastery timestamps are absent.
  if (latest === null) {
    const submitted = attempts.filter((attempt) => attempt.status === "SUBMITTED");
    latest = submitted[submitted.length - 1]?.endedAt ?? null;
  }
  return latest;
}

/**
 * Rebuild the served ledger from the log.
 *
 * Reads every attempt, including abandoned ones: the student saw those items, so
 * a later attempt must treat them as spent.
 */
function deriveServedLedger(attempts: readonly AttemptState[]): ServedLedger {
  const byConcept = new Map<string, string[]>();
  for (const attempt of attempts) {
    for (const entry of attempt.form) {
      const served = byConcept.get(entry.conceptId) ?? [];
      for (const itemId of entry.itemIds) {
        if (!served.includes(itemId)) served.push(itemId);
      }
      byConcept.set(entry.conceptId, served);
    }
  }
  return [...byConcept.entries()].map(([conceptId, servedItemIds]) => ({
    conceptId,
    servedItemIds,
  }));
}

/**
 * The progression-ledger rows this assessment produces.
 *
 * Note which kind is absent: nothing that awards XP or moves Rank. The capstone
 * is a content gate and pays zero, so there is no row here a later audit could
 * mistake for a reward.
 */
function deriveLedger(
  attempts: readonly AttemptState[],
  mastery: ReadonlyMap<CurriculumConceptId, ConceptMasteryState>,
  cards: readonly MintedPvpCard[],
  blueprint: ChapterAssessmentBlueprint,
  passed: boolean,
): readonly ProgressionLedgerEntry[] {
  const rows: ProgressionLedgerEntry[] = [];
  const base = { chapterId: blueprint.chapterId, missionId: null };

  for (const attempt of attempts) {
    rows.push({
      ...base,
      kind: "ASSESSMENT_ATTEMPT_OPENED",
      attemptId: attempt.attemptId,
      detail: {
        assessmentId: blueprint.assessmentId,
        attemptOrdinal: attempt.attemptOrdinal,
        scopedConcepts: attempt.scopedConceptIds.length,
        seedHex: attempt.seedHex,
        moduleCompletionId: attempt.moduleCompletionId,
      },
    });
    if (attempt.status === "SUBMITTED" && attempt.summary) {
      rows.push({
        ...base,
        kind: "ASSESSMENT_SUBMITTED",
        attemptId: attempt.attemptId,
        detail: {
          attemptOrdinal: attempt.attemptOrdinal,
          scoreNumerator: attempt.summary.scoreNumerator,
          scoreDenominator: attempt.summary.scoreDenominator,
          isReportedMeasure: attempt.attemptOrdinal === REPORTED_ATTEMPT_ORDINAL,
          conceptsMastered: attempt.summary.masteredConceptIds.length,
          awardedXp: 0,
        },
      });
    }
  }

  for (const entry of mastery.values()) {
    if (!entry.mastered) continue;
    rows.push({
      ...base,
      kind: "CONCEPT_MASTERED",
      attemptId: null,
      detail: {
        conceptId: entry.conceptId,
        onAttempt: entry.masteredOnAttempt,
        withRecycledItems: entry.masteredWithRecycledItems,
        at: entry.masteredAt,
      },
    });
  }

  for (const card of cards) {
    rows.push({
      ...base,
      kind: "CODEX_CARD_PVP_LEGAL",
      attemptId: null,
      detail: { cardId: card.cardId, conceptId: card.conceptId, at: card.mintedAt },
    });
  }

  if (passed) {
    rows.push({
      ...base,
      kind: "CHAPTER_COMPLETED",
      attemptId: null,
      detail: { assessmentId: blueprint.assessmentId, awardedXp: 0 },
    });
  }

  return rows;
}
