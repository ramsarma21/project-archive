// The recording path: the three operations that append to the log.
//
// This is the only asynchronous code in the package, and the reason is the whole
// integrity story. Correctness comes from the grading authority over a boundary,
// so recording an answer has to wait for it; everything downstream — score,
// mastery, cards, the chapter gate — is synchronous arithmetic over what came
// back (reduce.ts).
//
// NOTHING HERE ACCEPTS A VERDICT. `recordResponse` takes a `GradingAuthority` and
// a submission. There is no parameter, optional or otherwise, through which a
// caller could supply correctness, so the "a client may never submit a verdict"
// rule is a property of the signature rather than a check somebody has to
// remember to write. The same goes for the score: `submitAttempt` takes an
// attempt and a timestamp, and emits an event with no score field, because the
// score is derived.
//
// WHAT HAPPENS WHEN GRADING IS DOWN. The response is still recorded — the student
// answered, and that is a fact whatever the grader is doing — and no verdict
// event is emitted. `submitAttempt` then refuses with UNGRADED_RESPONSES until
// every answered item has one. The capstone would rather stay open than hand out
// a guess: unlike a 20-second duel round, which grants the maximum on a timeout
// because a player must not be punished for infrastructure, a capstone timeout
// that granted CORRECT would hand out mastery, a chapter unlock, and a PvP-legal
// card for a response nobody graded.

import type { ChapterAssessmentBlueprint } from "./blueprint.js";
import type { CurriculumConceptId } from "./curriculum.js";
import { deriveFormSeedHex } from "./determinism.js";
import type { AssessmentEvent } from "./events.js";
import type { AssessmentGateDecision } from "./gate.js";
import {
  mintUnansweredVerdict,
  type GradingAuthority,
  type GradingFailureCode,
  type ItemSubmission,
} from "./grading.js";
import type { AssessmentItemDescriptor, ItemBank } from "./items.js";
import type { AttemptState, ChapterAssessmentRecord } from "./reduce.js";
import { formItems, selectForm, type FormSelection } from "./select.js";

// ---------------------------------------------------------------------------
// Opening an attempt
// ---------------------------------------------------------------------------

export interface OpenAttemptInput {
  /**
   * The gate's clearance. Typed as the OPEN_ATTEMPT variant specifically, so an
   * attempt cannot be opened from a RUN_MODULE or BLOCKED decision — the module
   * gate is enforced by the type of this parameter.
   */
  readonly clearance: Extract<AssessmentGateDecision, { kind: "OPEN_ATTEMPT" }>;
  readonly blueprint: ChapterAssessmentBlueprint;
  readonly bank: ItemBank;
  readonly record: ChapterAssessmentRecord;
  readonly profileId: string;
  readonly attemptId: string;
  readonly at: string;
}

export interface OpenedAttempt {
  readonly events: readonly AssessmentEvent[];
  readonly selection: FormSelection;
}

/**
 * Open an attempt and choose its form.
 *
 * The seed is derived from the assessment, the profile and the ORDINAL, and it is
 * committed on the opening event. Both halves matter: including the ordinal is
 * what stops a retry from re-deriving attempt 1's permutation, and committing it
 * is what makes the selection independently recomputable years later from the log
 * alone.
 */
export function openAttempt(input: OpenAttemptInput): OpenedAttempt {
  const { clearance, blueprint, bank, record, profileId, attemptId, at } = input;
  const seedHex = deriveFormSeedHex([
    blueprint.assessmentId,
    profileId,
    clearance.attemptOrdinal,
  ]);
  const selection = selectForm({
    blueprint,
    bank,
    scopedConceptIds: clearance.scopedConceptIds,
    // Reconstructed from the log rather than passed in, so there is no way for a
    // caller to hand over a stale or trimmed served-item list and be given items
    // the student has already seen.
    ledger: record.servedLedger,
    seedHex,
  });

  return {
    events: [
      {
        type: "ATTEMPT_OPENED",
        attemptId,
        assessmentId: blueprint.assessmentId,
        chapterId: blueprint.chapterId,
        profileId,
        attemptOrdinal: clearance.attemptOrdinal,
        scopedConceptIds: clearance.scopedConceptIds,
        form: selection.concepts.map((concept) => ({
          conceptId: concept.conceptId,
          itemIds: concept.itemIds,
          openResponseItemIds: concept.openResponseItemIds,
          freshness: concept.freshness,
        })),
        seedHex,
        // Two sources: what the gate excluded up front, and anything selection
        // found short once it looked at the reserve. Unioned so the log names
        // every concept the chapter failed to ask, whoever noticed it.
        unassessableConceptIds: [
          ...new Set([
            ...clearance.excludedConceptIds,
            ...selection.unassessableConceptIds,
          ]),
        ],
        moduleCompletionId: moduleCompletionId(clearance),
        at,
      },
    ],
    selection,
  };
}

/**
 * A stable identity for the module run that armed this attempt.
 *
 * `LearningModuleCompletion` has no id of its own — it is keyed by profile,
 * module and the ordinal it gates — so the receipt is composed from that key
 * rather than invented, and it stays checkable against the module ledger.
 */
function moduleCompletionId(
  clearance: Extract<AssessmentGateDecision, { kind: "OPEN_ATTEMPT" }>,
): string {
  const completion = clearance.moduleCompletion;
  return `${completion.moduleId}:ASSESSMENT_ATTEMPT:${completion.gatesId}:${completion.gatesOrdinal}`;
}

/** The item descriptors to present, in served order. Never carries a key. */
export function attemptItems(
  selection: FormSelection,
  bank: ItemBank,
): readonly AssessmentItemDescriptor[] {
  return formItems(selection, bank);
}

// ---------------------------------------------------------------------------
// Recording a response
// ---------------------------------------------------------------------------

export type RecordResponseFailure =
  | GradingFailureCode
  /** The attempt is submitted or abandoned. */
  | "ATTEMPT_NOT_OPEN"
  /** The item is not on this attempt's form. */
  | "ITEM_NOT_ON_FORM";

export type RecordResponseResult =
  | { readonly ok: true; readonly events: readonly AssessmentEvent[] }
  | {
      readonly ok: false;
      readonly code: RecordResponseFailure;
      readonly detail: string;
      /**
       * The response event, when the answer was recorded but grading failed.
       * Empty when the submission was refused outright. The student's answer is
       * not discarded because the grader was unavailable.
       */
      readonly events: readonly AssessmentEvent[];
    };

export interface RecordResponseInput {
  readonly attempt: AttemptState;
  readonly submission: ItemSubmission;
  readonly authority: GradingAuthority;
  readonly at: string;
}

/**
 * Record one answer and the authority's verdict on it.
 *
 * Re-answering before submission is allowed and produces a fresh pair of events;
 * the reducer drops the old verdict when it sees the new response, so a student
 * cannot answer correctly, change their mind, and keep the credit.
 */
export async function recordResponse(
  input: RecordResponseInput,
): Promise<RecordResponseResult> {
  const { attempt, submission, authority, at } = input;
  if (attempt.status !== "IN_PROGRESS") {
    return {
      ok: false,
      code: "ATTEMPT_NOT_OPEN",
      detail: attempt.status,
      events: [],
    };
  }
  const conceptId = conceptForItem(attempt, submission.itemId);
  if (conceptId === null) {
    return {
      ok: false,
      code: "ITEM_NOT_ON_FORM",
      detail: submission.itemId,
      events: [],
    };
  }

  const responseEvent: AssessmentEvent = {
    type: "RESPONSE_RECORDED",
    attemptId: attempt.attemptId,
    itemId: submission.itemId,
    conceptId,
    selectedOptionId:
      submission.kind === "SELECTED_RESPONSE" ? submission.selectedOptionId : null,
    responseRef: submission.kind === "OPEN_RESPONSE" ? submission.responseRef : null,
    at,
  };

  const graded = await authority.grade(submission);
  if (!graded.ok) {
    return {
      ok: false,
      code: graded.code,
      detail: graded.detail,
      events: [responseEvent],
    };
  }

  return {
    ok: true,
    events: [
      responseEvent,
      {
        type: "VERDICT_COMMITTED",
        attemptId: attempt.attemptId,
        itemId: submission.itemId,
        conceptId,
        verdict: graded.verdict,
        at,
      },
    ],
  };
}

function conceptForItem(
  attempt: AttemptState,
  itemId: string,
): CurriculumConceptId | null {
  for (const entry of attempt.form) {
    if (entry.itemIds.includes(itemId)) return entry.conceptId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

export type SubmitFailure =
  | "ATTEMPT_NOT_OPEN"
  /** An answered item has no verdict. Grading has to finish first. */
  | "UNGRADED_RESPONSES";

export type SubmitResult =
  | { readonly ok: true; readonly events: readonly AssessmentEvent[] }
  | {
      readonly ok: false;
      readonly code: SubmitFailure;
      readonly itemIds: readonly string[];
    };

export interface SubmitAttemptInput {
  readonly attempt: AttemptState;
  readonly bank: ItemBank;
  readonly at: string;
}

/**
 * Hand in the form.
 *
 * Emits an explicit UNANSWERED verdict for every item left blank, rather than
 * letting absence be interpreted downstream. Two reasons: an auditor reading the
 * log should see "asked, not answered" written down, and a blank must cost the
 * same as a wrong answer, so that skipping the two items on a shaky concept is
 * never cheaper than attempting them.
 *
 * The ATTEMPT_SUBMITTED event carries no score and no pass flag. Both are derived.
 */
export function submitAttempt(input: SubmitAttemptInput): SubmitResult {
  const { attempt, bank, at } = input;
  if (attempt.status !== "IN_PROGRESS") {
    return { ok: false, code: "ATTEMPT_NOT_OPEN", itemIds: [] };
  }

  const ungraded = attempt.responses
    .filter((response) => response.answeredAt !== null && response.verdict === null)
    .map((response) => response.itemId);
  if (ungraded.length > 0) {
    return { ok: false, code: "UNGRADED_RESPONSES", itemIds: ungraded };
  }

  const answered = new Set(attempt.responses.map((response) => response.itemId));
  const events: AssessmentEvent[] = [];
  for (const entry of attempt.form) {
    for (const itemId of entry.itemIds) {
      if (answered.has(itemId)) continue;
      const item = bank.item(itemId);
      events.push({
        type: "VERDICT_COMMITTED",
        attemptId: attempt.attemptId,
        itemId,
        conceptId: entry.conceptId,
        verdict: mintUnansweredVerdict(itemId, item?.itemVersion ?? "unknown"),
        at,
      });
    }
  }
  events.push({ type: "ATTEMPT_SUBMITTED", attemptId: attempt.attemptId, at });
  return { ok: true, events };
}

/** Walk away. The items stay spent; a later attempt draws fresh ones. */
export function abandonAttempt(input: {
  readonly attempt: AttemptState;
  readonly reason: "WALKED_AWAY" | "SESSION_EXPIRED" | "SUPERSEDED";
  readonly at: string;
}): readonly AssessmentEvent[] {
  if (input.attempt.status !== "IN_PROGRESS") return [];
  return [
    {
      type: "ATTEMPT_ABANDONED",
      attemptId: input.attempt.attemptId,
      reason: input.reason,
      at: input.at,
    },
  ];
}
