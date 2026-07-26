// The capstone event log.
//
// EVERY EVENT IS COMMITTED. There is no transient tier here and no
// `assessmentCommitLog` filter, which is the deliberate opposite of
// packages/duel/src/events.ts. A mission commits its outcome and a duel commits
// its six verdicts, because replaying either tick by tick buys nothing. The
// capstone is the assessment of record: a district may have to answer what a
// student was asked, in what order, what they answered, who graded it and when,
// and the only way to answer that later is to have written it down at the time.
//
// THE LOG CONTAINS NO SCORE, NO MASTERY FLAG, AND NO PASS FLAG.
//
// This is the integrity property the whole package rests on, and it is
// structural. Look at what the six event types can actually say:
//
//   what was served    ATTEMPT_OPENED   — with the seed, so the selection is
//                                         independently recomputable
//   what was answered  RESPONSE_RECORDED
//   how it graded      VERDICT_COMMITTED / VERDICT_OVERRIDDEN — minted only by
//                                         the grading authority (grading.ts)
//   when it ended      ATTEMPT_SUBMITTED / ATTEMPT_ABANDONED
//
// Score, per-concept mastery, the 100% rule, card minting and the chapter unlock
// are all DERIVED by reduce.ts from those facts. None of them appears in any
// event, so there is no field in this file a forged or replayed log could use to
// assert mastery — a tampered log would have to forge verdicts, and a verdict has
// an authority behind it and no client constructor.
//
// A CORRECTION IS AN APPEND, NEVER AN EDIT. VERDICT_OVERRIDDEN exists because the
// grading eval set is explicitly stocked with correct-but-unusually-worded
// answers, so some verdicts will be wrong and a human will fix them. The fix is a
// new event that shadows the old one; both stay in the log, and
// `verdictHistory` can show a reviewer what changed.

import { verdictEnvelope, type AssessmentVerdict } from "./grading.js";
import type { CurriculumConceptId } from "./curriculum.js";
import type { ConceptFreshness } from "./select.js";

/**
 * One concept's slice of a served form.
 *
 * `openResponseItemIds` is a subset of `itemIds`, and it is committed rather than
 * looked up because an item's format is part of what the student was asked. Two
 * consequences: a projection of the record never needs the bank to know whether a
 * question had options, and "was this form passable by guessing" — a question a
 * district can reasonably ask — is answerable from the log alone.
 */
export interface FormConceptRecord {
  readonly conceptId: CurriculumConceptId;
  readonly itemIds: readonly string[];
  readonly openResponseItemIds: readonly string[];
  readonly freshness: ConceptFreshness;
}

/** Whether a served item was an open-response one, read off the form record. */
export function itemFormatFromForm(
  form: readonly FormConceptRecord[],
  itemId: string,
): "SELECTED_RESPONSE" | "OPEN_RESPONSE" {
  for (const entry of form) {
    if (entry.openResponseItemIds.includes(itemId)) return "OPEN_RESPONSE";
  }
  return "SELECTED_RESPONSE";
}

export type AssessmentEvent =
  /**
   * An attempt begins. Carries everything needed to reproduce the exact form:
   * the seed, the scoped concepts, and the items chosen per concept.
   *
   * `moduleCompletionId` is the receipt for the mandatory learning module. It is
   * on the opening event rather than checked elsewhere, so an attempt that
   * skipped the module cannot exist in the log at all.
   */
  | {
      readonly type: "ATTEMPT_OPENED";
      readonly attemptId: string;
      readonly assessmentId: string;
      readonly chapterId: string;
      readonly profileId: string;
      /** 1 is the first sitting and the only one whose score is reported. */
      readonly attemptOrdinal: number;
      readonly scopedConceptIds: readonly CurriculumConceptId[];
      readonly form: readonly FormConceptRecord[];
      readonly seedHex: string;
      /** Scoped concepts the bank could not build a form for. */
      readonly unassessableConceptIds: readonly CurriculumConceptId[];
      readonly moduleCompletionId: string;
      readonly at: string;
    }
  /**
   * A student answered one item.
   *
   * `selectedOptionId` is committed because which distractor a student chose is
   * the most useful diagnostic the capstone produces, and an option id is the
   * student's own answer rather than a secret. Open-response TEXT is never
   * committed: `responseRef` is an opaque handle on the encrypted server-side
   * record, and there is no field here that could hold prose.
   */
  | {
      readonly type: "RESPONSE_RECORDED";
      readonly attemptId: string;
      readonly itemId: string;
      readonly conceptId: CurriculumConceptId;
      readonly selectedOptionId: string | null;
      readonly responseRef: string | null;
      readonly at: string;
    }
  /** The grading authority's verdict. The only source of correctness. */
  | {
      readonly type: "VERDICT_COMMITTED";
      readonly attemptId: string;
      readonly itemId: string;
      readonly conceptId: CurriculumConceptId;
      readonly verdict: AssessmentVerdict;
      readonly at: string;
    }
  /**
   * A human corrected a verdict after the fact. Shadows the earlier verdict for
   * the same item without removing it.
   *
   * An override on attempt 1 does move the reported score, and that is right: the
   * first-attempt score is protected from RETRIES repairing it, not from a
   * mis-grade being fixed. `report.ts` shows both the score as submitted and the
   * score after review, so a changed number is visible rather than silent.
   */
  | {
      readonly type: "VERDICT_OVERRIDDEN";
      readonly attemptId: string;
      readonly itemId: string;
      readonly conceptId: CurriculumConceptId;
      readonly verdict: AssessmentVerdict;
      readonly reviewerId: string;
      readonly reason: string;
      readonly at: string;
    }
  /** The form was handed in. Note the absence of a score and a pass flag. */
  | {
      readonly type: "ATTEMPT_SUBMITTED";
      readonly attemptId: string;
      readonly at: string;
    }
  /**
   * The student left without submitting. The items are still spent — they were
   * seen — so this is recorded rather than the attempt being deleted, and a
   * later attempt draws fresh items.
   */
  | {
      readonly type: "ATTEMPT_ABANDONED";
      readonly attemptId: string;
      readonly reason: "WALKED_AWAY" | "SESSION_EXPIRED" | "SUPERSEDED";
      readonly at: string;
    };

export type AssessmentEventType = AssessmentEvent["type"];

/**
 * Serialisable projection of the log. Verdicts collapse to their envelope; every
 * other event is already plain data.
 *
 * There is no filtering step, unlike the duel's `serialiseCommitLog`. Everything
 * is persisted, so serialising is a total function over the log.
 */
export function serialiseLog(
  events: readonly AssessmentEvent[],
): readonly Record<string, unknown>[] {
  return events.map((event) =>
    event.type === "VERDICT_COMMITTED" || event.type === "VERDICT_OVERRIDDEN"
      ? { ...event, verdict: verdictEnvelope(event.verdict) }
      : ({ ...event } as Record<string, unknown>),
  );
}

/**
 * True when no needle appears anywhere in the serialised log. Tests feed real
 * student prose through the grading path and assert it never lands here, rather
 * than trusting the claim that it cannot.
 */
export function logContainsNoRawText(
  events: readonly AssessmentEvent[],
  needles: readonly string[],
): boolean {
  const json = JSON.stringify(serialiseLog(events));
  return needles.every((needle) => !json.includes(needle));
}

/** Every verdict ever recorded for one item, oldest first. For a reviewer. */
export function verdictHistory(
  events: readonly AssessmentEvent[],
  attemptId: string,
  itemId: string,
): readonly AssessmentVerdict[] {
  const history: AssessmentVerdict[] = [];
  for (const event of events) {
    if (
      (event.type === "VERDICT_COMMITTED" || event.type === "VERDICT_OVERRIDDEN") &&
      event.attemptId === attemptId &&
      event.itemId === itemId
    ) {
      history.push(event.verdict);
    }
  }
  return history;
}
