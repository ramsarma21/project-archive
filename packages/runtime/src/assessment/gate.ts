import {
  CP1_REQUIRED_MACROS,
  type AssessmentItem,
  type CheckpointGateState,
  type CheckpointHintKind,
  type LearnerState,
  type ConceptId,
  type FieldDurableState,
  CONCEPTS,
} from "@pa/contracts";

// ============================================================================
// The CP mastery-gate ladder (Boston-Archive-Spec R6/R7, locked 2026-07-21).
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

// CP1 assessment concept ids (RCC.*) -> Day-1 learner ConceptIds, so the
// memory cue can read the student's own provenance log.
const ASSESSMENT_TO_LEARNER: Record<string, ConceptId> = {
  [CP1_REQUIRED_MACROS[0]]: CONCEPTS.POSTWAR_REVENUE,
  [CP1_REQUIRED_MACROS[1]]: CONCEPTS.STAMP_SCOPE,
  [CP1_REQUIRED_MACROS[2]]: CONCEPTS.REPRESENTATION,
};

// Recall-cue labels for the tracked world sources that flip micros engaged.
// Keys are the stable sourceIds used by the web content manifests
// (m4ContentManifest / reactiveManifest) — the same ids logged into
// MicroEngagementRecord.sourceId. Authored copy; final pass = text slice.
const MICRO_SOURCE_LABELS: Record<string, string> = {
  "KN-noticeboard-revenue": "the revenue proclamation on the notice board",
  "KN-noticeboard-stamp": "the stamp schedule on the notice board",
  "KN-liberty-bill": "the Liberty Tree bill nailed by the elm",
  "KN-nonimport": "the merchants' non-importation agreement on the west street",
  "KN-townmeeting": "the town-meeting call posted by the tavern",
  "KN-wharfage": "the wharfage schedule at the docks",
  "KN-sign-printer": "the printer's press-and-ball sign",
  "KN-sign-tavern": "the Bunch of Grapes tavern sign",
  "KN-sign-baker": "the baker's sheaf sign",
  "KN-sign-chandler": "the chandler's anchor sign",
  "KN-watchhouse": "the Watch House sign across from the Custom House",
  "KN-coinpaper": "the box of thin coin and paper promises at Mercer's",
  "KN-typecase": "the type cases in Mercer's shop",
  "KN-effigy": "the placard on the figure hung in the elm",
  "KN-fishflakes": "the half-empty fish flakes on the wharf",
  "KN-cargomark": "the collector's chalk marks on the London crates",
  "KN-ropewalk-front": "the long ropewalk hall off the west street",
  "KN-elm": "the great elm at the crossroads",
  "SJ-ropewalk": "the strand you walked down the ropewalk",
  "SJ-ropewalk-close": "the lay you closed at the ropewalk rig",
  "NPC-abigail": "what Abigail told you at the press",
  "NPC-thomas": "what Thomas said at his counting house",
  "NPC-pike": "what Pike said over his desk",
  "NPC-clarke": "what Clarke warned you at his door",
  "NPC-rider": "what the rider told you at the post",
  "SJ-tavern-note": "the note you carried to the Bunch of Grapes",
  "SJ-dock-haul": "the barrel you hauled on the wharf",
  "THR-ned": "the type you fetched for Ned",
  "THR-sarah": "Goodwife Sarah's stall in the market",
};

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
export function memoryCueFor(
  learner: LearnerState,
  item: AssessmentItem,
  field?: FieldDurableState,
): string | null {
  const learnerConcept = ASSESSMENT_TO_LEARNER[item.conceptId];
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
      .find((record) => MICRO_SOURCE_LABELS[record.sourceId]);
    if (engagement) {
      return `Remember ${MICRO_SOURCE_LABELS[engagement.sourceId]!}? Think back to what it showed you.`;
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
      memoryCueFor(learner, item, field) ??
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
