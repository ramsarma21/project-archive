// The two gates: what unlocks the next chapter, and what it takes to sit the
// capstone in the first place.
//
// THE CHAPTER GATE IS THE REASON MISSIONS ARE ALLOWED TO BE FAILABLE. A mission
// gives three attempts and then advances the player regardless, which is only
// defensible because this gate exists: the student cannot reach the next chapter
// without demonstrating every concept in this one. Missions are optional-outcome
// fun; this is the mandatory learning spine. If this gate is ever softened, the
// mission design becomes indefensible along with it.
//
// THE GATE IS LENIENT ABOUT OUR FAILURES AND STRICT ABOUT THE STUDENT'S. Those
// are two different questions and they get two different answers:
//
//   - A concept the student got wrong blocks the chapter, and no number of
//     retries changes the bar. That is the point.
//   - A concept the ITEM BANK cannot ask — fewer eligible items than one form
//     needs — does not block the chapter. Failing a student over a content
//     shortage of ours would be indefensible, and it would also be undetectable
//     from the student's side, since they would simply never be shown the
//     question they are being held to.
//   - But an unassessable concept mints no PvP-legal card (cards.ts). The student
//     advances; they do not acquire competitive standing on evidence nobody
//     collected. `UnlockDecision.contentGaps` carries the list so a report says
//     so rather than implying the chapter was fully covered.
//
// THERE IS NO ATTEMPT LIMIT, unlike a mission. See ASSESSMENT_ATTEMPTS_ARE_UNLIMITED.

import {
  unassessableConceptIds,
  type ChapterAssessmentBlueprint,
} from "./blueprint.js";
import type { CurriculumConceptId } from "./curriculum.js";
import type { ItemBank } from "./items.js";
import type { AttemptState, ChapterAssessmentRecord } from "./reduce.js";
import { REPORTED_ATTEMPT_ORDINAL } from "./reduce.js";
import {
  isModuleGateSatisfied,
  type LearningModuleCompletion,
} from "./protocol.js";

/**
 * Settled: the capstone has no attempt cap.
 *
 * A mission is capped at three because it is optional-outcome content and the
 * cap is what makes the XP decay mean something. The capstone is the opposite
 * kind of thing. A cap here would produce a student who has run out of chances to
 * demonstrate learning and can therefore never reach the next chapter, which is a
 * product that has given up on them. Item exhaustion is handled by recycling with
 * disclosure (select.ts), not by refusing the attempt.
 */
export const ASSESSMENT_ATTEMPTS_ARE_UNLIMITED = true;

// ---------------------------------------------------------------------------
// Gate 1: does the next chapter unlock
// ---------------------------------------------------------------------------

export type UnlockBlock =
  /** At least one gating concept is not yet mastered. The ordinary case. */
  | "CONCEPTS_UNMASTERED"
  /** Attempt 1 has never been submitted. */
  | "NOT_ATTEMPTED"
  /** Every scoped concept is unassessable, so the capstone measured nothing. */
  | "NO_ASSESSABLE_CONTENT";

export interface ContentGap {
  readonly conceptId: CurriculumConceptId;
  readonly reason: "UNASSESSABLE";
}

export type UnlockDecision =
  | {
      readonly kind: "UNLOCKED";
      readonly passedAt: string;
      /** Concepts the bank could not ask. The student advanced without them. */
      readonly contentGaps: readonly ContentGap[];
    }
  | {
      readonly kind: "BLOCKED";
      readonly reason: UnlockBlock;
      readonly unmasteredConceptIds: readonly CurriculumConceptId[];
      readonly contentGaps: readonly ContentGap[];
    };

/**
 * Whether the next chapter opens.
 *
 * Reads the record only. There is no override parameter and no force flag: one
 * answer to "has this student earned the next chapter", derived from the log.
 */
export function chapterUnlockDecision(
  record: ChapterAssessmentRecord,
  blueprint: ChapterAssessmentBlueprint,
): UnlockDecision {
  const contentGaps: ContentGap[] = record.unassessableConceptIds.map(
    (conceptId) => ({ conceptId, reason: "UNASSESSABLE" as const }),
  );
  const gateConcepts = blueprint.conceptIds.filter(
    (conceptId) => !record.mastery.get(conceptId)?.unassessable,
  );
  const unmastered = gateConcepts.filter(
    (conceptId) => record.mastery.get(conceptId)?.mastered !== true,
  );

  if (gateConcepts.length === 0) {
    return {
      kind: "BLOCKED",
      reason: "NO_ASSESSABLE_CONTENT",
      unmasteredConceptIds: [],
      contentGaps,
    };
  }
  if (record.reportedScore === null) {
    return {
      kind: "BLOCKED",
      reason: "NOT_ATTEMPTED",
      unmasteredConceptIds: unmastered,
      contentGaps,
    };
  }
  if (unmastered.length > 0) {
    return {
      kind: "BLOCKED",
      reason: "CONCEPTS_UNMASTERED",
      unmasteredConceptIds: unmastered,
      contentGaps,
    };
  }
  return { kind: "UNLOCKED", passedAt: record.passedAt ?? "", contentGaps };
}

// ---------------------------------------------------------------------------
// Gate 2: may this student sit the capstone right now
// ---------------------------------------------------------------------------

/** Module completions scoped to assessment attempts. */
export type AssessmentModuleLedger = readonly LearningModuleCompletion[];

export const EMPTY_ASSESSMENT_MODULE_LEDGER: AssessmentModuleLedger = [];

/**
 * The completion that arms one specific attempt ordinal.
 *
 * Keyed by ordinal, which is what makes "the module must be retaken on every
 * retry" fall out of the key rather than needing its own branch: attempt 2 simply
 * finds no completion for attempt 2.
 */
export function findModuleCompletion(
  ledger: AssessmentModuleLedger,
  assessmentId: string,
  attemptOrdinal: number,
): LearningModuleCompletion | undefined {
  return ledger.find(
    (completion) =>
      completion.gatesKind === "ASSESSMENT_ATTEMPT" &&
      completion.gatesId === assessmentId &&
      completion.gatesOrdinal === attemptOrdinal,
  );
}

export type AttemptBlock =
  /** The chapter's missions are not all resolved yet. */
  | "CHAPTER_INCOMPLETE"
  /** The blueprint scopes nothing the bank can ask. */
  | "NO_ASSESSABLE_CONTENT";

export type AssessmentGateDecision =
  /** Nothing left to do: every gating concept is mastered. */
  | { readonly kind: "ALREADY_PASSED"; readonly passedAt: string }
  /** An attempt is open. Finish it before opening another. */
  | { readonly kind: "RESUME_ATTEMPT"; readonly attempt: AttemptState }
  /**
   * Run the module first. On a retry, `conceptIds` is narrowed to exactly the
   * concepts still owed — the same set the retry's form will cover — so the three
   * minutes are spent on what the student missed rather than re-teaching what
   * they already demonstrated.
   */
  | {
      readonly kind: "RUN_MODULE";
      readonly moduleId: string;
      readonly attemptOrdinal: number;
      readonly conceptIds: readonly CurriculumConceptId[];
    }
  /**
   * Clear to open. This is the ONLY producer of the ordinal, scope and module
   * receipt that `openAttempt` needs, and it produces them only when the ledger
   * holds a completion for this exact ordinal. A caller that forgets to check the
   * gate cannot get an ordinal out of this module, so forgetting is not a failure
   * mode that ships.
   */
  | {
      readonly kind: "OPEN_ATTEMPT";
      readonly attemptOrdinal: number;
      readonly scopedConceptIds: readonly CurriculumConceptId[];
      /**
       * Blueprint concepts deliberately left off the form because the bank cannot
       * ask them. Carried through to the opening event so the log records what was
       * excluded and why, rather than a short form looking like the whole chapter.
       */
      readonly excludedConceptIds: readonly CurriculumConceptId[];
      readonly moduleCompletion: LearningModuleCompletion;
    }
  | { readonly kind: "BLOCKED"; readonly reason: AttemptBlock };

export interface AssessmentGateInput {
  readonly record: ChapterAssessmentRecord;
  readonly blueprint: ChapterAssessmentBlueprint;
  /**
   * The item bank. Needed because whether a concept can be asked at all is a
   * property of the content, and the gate has to know it BEFORE sending a student
   * through the module — not after handing them an empty form.
   */
  readonly bank: ItemBank;
  readonly moduleLedger: AssessmentModuleLedger;
  /**
   * Whether every mission in the chapter is resolved — cleared or permanently
   * failed. Required rather than defaulted, so a caller has to decide: a gate
   * that waves the prerequisite through when nobody passed it is a gate that
   * fails open.
   */
  readonly chapterMissionsResolved: boolean;
}

/**
 * The one route into the capstone.
 *
 * The scope narrows here rather than in selection, because the module and the
 * form must cover the same concepts — the module is the teaching for exactly the
 * items about to be asked, and computing the set twice is how those two drift.
 */
export function assessmentGateDecision(
  input: AssessmentGateInput,
): AssessmentGateDecision {
  const { record, blueprint, bank, moduleLedger } = input;

  // Two sources, unioned. The bank says what can be asked now; the log says what
  // could not be asked on an attempt already sat. Neither alone is complete: the
  // bank cannot know history, and history cannot know a bank that is still empty.
  const unassessable = new Set<string>([
    ...unassessableConceptIds(blueprint, bank),
    ...record.unassessableConceptIds,
  ]);
  const gateConcepts = blueprint.conceptIds.filter(
    (conceptId) => !unassessable.has(conceptId),
  );
  if (gateConcepts.length === 0) {
    return { kind: "BLOCKED", reason: "NO_ASSESSABLE_CONTENT" };
  }
  if (record.openAttempt) {
    return { kind: "RESUME_ATTEMPT", attempt: record.openAttempt };
  }
  if (record.passed) {
    return { kind: "ALREADY_PASSED", passedAt: record.passedAt ?? "" };
  }
  if (!input.chapterMissionsResolved) {
    return { kind: "BLOCKED", reason: "CHAPTER_INCOMPLETE" };
  }

  const attemptOrdinal = nextAssessmentOrdinal(record);
  const scopedConceptIds =
    attemptOrdinal === REPORTED_ATTEMPT_ORDINAL
      ? gateConcepts
      : gateConcepts.filter(
          (conceptId) => record.mastery.get(conceptId)?.mastered !== true,
        );

  const completion = findModuleCompletion(
    moduleLedger,
    blueprint.assessmentId,
    attemptOrdinal,
  );
  if (!isModuleGateSatisfied({ completion: completion ?? null, attemptOrdinal })) {
    return {
      kind: "RUN_MODULE",
      moduleId: blueprint.moduleId,
      attemptOrdinal,
      conceptIds: scopedConceptIds,
    };
  }

  return {
    kind: "OPEN_ATTEMPT",
    attemptOrdinal,
    scopedConceptIds,
    excludedConceptIds: blueprint.conceptIds.filter((conceptId) =>
      unassessable.has(conceptId),
    ),
    // `isModuleGateSatisfied` returning true means the completion is present;
    // the narrowing is not expressible through it, so it is asserted here.
    moduleCompletion: completion as LearningModuleCompletion,
  };
}

/**
 * The ordinal the server would assign next.
 *
 * Counts every attempt ever opened, including abandoned ones. An abandoned
 * attempt still spent its items, so reusing its ordinal would let a student walk
 * out of a form and come back to a fresh attempt 1 — and attempt 1 is the one
 * whose score is reported.
 */
export function nextAssessmentOrdinal(record: ChapterAssessmentRecord): number {
  return record.attempts.length + 1;
}

/** Whether this student may take a card into PvP for a given concept. */
export function conceptIsPvpLegal(
  record: ChapterAssessmentRecord,
  conceptId: CurriculumConceptId,
): boolean {
  const entry = record.mastery.get(conceptId);
  return entry?.mastered === true && !entry.unassessable;
}
