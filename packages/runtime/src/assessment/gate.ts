import {
  type AssessmentItem,
  type CheckpointGateState,
  type CheckpointHintKind,
  type LearnerState,
  type FieldDurableState,
} from "@pa/contracts";
import type { GateContentMaps } from "../engine/chapter.js";

// ============================================================================
// The CP mastery-gate ladder (Archive-Spec R6/R7, locked 2026-07-21).
//
//   attempt 1 wrong -> MEMORY_CUE hint (from THIS student's provenance),
//                      3s dwell + 2s pause
//   attempt 2 wrong -> EXPLICIT hint (authored restatement),
//                      4s dwell + 4s pause
//   attempt 3+ wrong -> ELIMINATION (disable one distractor per wrong answer,
//                      keeping >= 1 distractor until none remain),
//                      5s dwell + growing pause (+2s each, cap 8s)
//
// Passage is guaranteed; a hint-heavy pass is scored lower by the caller
// (penalty curve lives in cp1.ts, not here). Deterministic: same wrong-answer
// sequence -> same ladder.
// ============================================================================

const MEMORY_DWELL_MS = 3000;
const EXPLICIT_DWELL_MS = 4000;
const ELIMINATION_DWELL_MS = 5000;
const PAUSE_BASE_MS = 2000;
const PAUSE_STEP_MS = 2000;
const PAUSE_CAP_MS = 8000;

export function hintKindForAttempt(attempt: number): CheckpointHintKind {
  if (attempt <= 1) return "MEMORY_CUE";
  if (attempt === 2) return "EXPLICIT";
  return "ELIMINATION";
}

export function gatePauseMs(attempt: number): number {
  return Math.min(PAUSE_BASE_MS + (attempt - 1) * PAUSE_STEP_MS, PAUSE_CAP_MS);
}

export function gateDwellMs(kind: CheckpointHintKind): number {
  switch (kind) {
    case "MEMORY_CUE":
      return MEMORY_DWELL_MS;
    case "EXPLICIT":
      return EXPLICIT_DWELL_MS;
    case "ELIMINATION":
      return ELIMINATION_DWELL_MS;
  }
}

// The first provenance label this student actually holds for the item's
// concept — the personal recall cue. Deterministic: exposures are an ordered,
// event-sourced log, and we take the earliest labeled one.
// - MACRO items read the learner exposure log (ExposureRecord.provenance).
// - MICRO items read the field micro-engagement log (sourceId -> label map).
// Both maps are chapter content (ChapterDefinition.assessment.gateMaps) —
// the single source; no local copies.
export function memoryCueFor(
  learner: LearnerState,
  item: AssessmentItem,
  maps: GateContentMaps,
  field?: FieldDurableState,
): string | null {
  const learnerConcept = maps.assessmentToLearner[item.conceptId];
  if (learnerConcept) {
    const state = learner[learnerConcept];
    if (!state) return null;
    const labeled = state.exposures.find((e) => e.provenance?.label);
    if (!labeled?.provenance) return null;
    return `Remember ${labeled.provenance.label}? Think back to what it told you.`;
  }
  if (item.tier === "MICRO" && field) {
    // Earliest engagement for this micro (records are insertion-ordered and
    // replayed identically, so "first with a known label" is deterministic).
    const engagement = Object.values(field.microEngagements)
      .filter((record) => record.microConceptId === item.conceptId)
      .sort((a, b) => a.interactionOrdinal - b.interactionOrdinal)
      .find((record) => maps.microSourceLabels[record.sourceId]);
    if (engagement) {
      return `Remember ${maps.microSourceLabels[engagement.sourceId]!}? Think back to what it showed you.`;
    }
  }
  return null;
}

export function explicitHintFor(item: AssessmentItem): string {
  return (
    item.explicitHint ??
    "Set aside the words of each answer. Which one matches what the world actually showed you happening, and why?"
  );
}

// Compute the ladder state after a wrong answer. `wrongOptionIds` is the
// ordered list of wrong options chosen so far (attempt = its length).
export function computeGateState(
  learner: LearnerState,
  item: AssessmentItem,
  wrongOptionIds: readonly string[],
  maps: GateContentMaps,
  field?: FieldDurableState,
): CheckpointGateState {
  const attempt = wrongOptionIds.length;
  const kind = hintKindForAttempt(attempt);
  const distractors = item.options
    .map((o) => o.optionId)
    .filter((id) => id !== item.correctOptionId);

  // Elimination: from attempt 3 on, one distractor disappears per wrong
  // answer (attempt 3 -> 1 eliminated, attempt 4 -> 2, ...). Distractors the
  // student already picked are eliminated first (they're proven wrong), then
  // remaining ones in authored order.
  let disabled: string[] = [];
  if (kind === "ELIMINATION") {
    const eliminateCount = Math.min(attempt - 2, distractors.length);
    const picked = wrongOptionIds.filter((id) => distractors.includes(id));
    const rest = distractors.filter((id) => !picked.includes(id));
    disabled = [...picked, ...rest].slice(0, eliminateCount);
  }

  let hint: string;
  if (kind === "MEMORY_CUE") {
    hint =
      memoryCueFor(learner, item, maps, field) ??
      explicitHintFor(item);
  } else if (kind === "EXPLICIT") {
    hint = explicitHintFor(item);
  } else {
    hint =
      disabled.length >= distractors.length
        ? "Only one answer remains. Read it once more, then take it with you."
        : "One of these is now struck through. Weigh what remains against what you saw.";
  }

  return {
    attempt,
    hintKind: kind,
    hint,
    disabledOptionIds: disabled,
    dwellMs: gateDwellMs(kind),
    pauseMs: gatePauseMs(attempt),
  };
}
