import type {
  MicroConceptId,
  MicroEngagementRecord,
  SourceEngagementRecord,
} from "./field.js";
import type { FormativeEvidenceRecord } from "./openResponse.js";

export const CP1_CHECKPOINT_ID = "BOS.ACT01.CP1.v1" as const;
export const CP1_REQUIRED_MACROS = [
  "RCC.DEBT_POLICY_INTRO",
  "RCC.STAMP_INTERNAL_INTRO",
  "RCC.REPRESENTATION_CAUSE",
] as const;

export type Cp1MacroConceptId = (typeof CP1_REQUIRED_MACROS)[number];
export type AssessmentConceptId = Cp1MacroConceptId | MicroConceptId;
export type AssessmentTier = "MACRO" | "MICRO";
export type AssessmentApprovalStatus = "DRAFT" | "SME_APPROVED";
export type AssessmentDifficulty = "FOUNDATIONAL" | "ON_LEVEL" | "STRETCH";

export interface AssessmentOption {
  optionId: string;
  text: string;
}

export interface AssessmentItem {
  itemId: string;
  itemVersion: string;
  tier: AssessmentTier;
  conceptId: AssessmentConceptId;
  teksTags?: string[];
  stem: string;
  options: AssessmentOption[];
  correctOptionId: string;
  approvalStatus: AssessmentApprovalStatus;
  difficulty: AssessmentDifficulty;
  // Authored second-tier hint (Archive-Spec R6 step 2): restates the
  // principle in different words without giving the answer away.
  explicitHint?: string;
}

export interface AssessmentQuestionBank {
  bankId: string;
  bankVersion: string;
  approvalStatus: AssessmentApprovalStatus;
  items: AssessmentItem[];
}

export interface DebriefFormSelection {
  checkpointId: typeof CP1_CHECKPOINT_ID;
  /** Route-independent required CP1 identity (macro items only). */
  coreFormId?: string;
  /** Optional enrichment identity; never changes the required core form. */
  enrichmentSupplementId?: string | null;
  formId: string;
  bankId: string;
  bankVersion: string;
  itemIds: string[];
  macroItemIds: string[];
  microItemIds: string[];
}

export interface DebriefResponseRecord {
  itemId: string;
  optionId: string;
  tier: AssessmentTier;
  conceptId: AssessmentConceptId;
  // Wrong attempts consumed before this final answer (0 = clean first try).
  hintsUsed?: number;
}

export interface MacroOutcomeRecord {
  itemId: string;
  conceptId: Cp1MacroConceptId;
  correct: boolean;
  hintsUsed?: number;
}

export interface EnrichmentOutcomeRecord {
  itemId: string;
  conceptId: MicroConceptId;
  correct: boolean;
  hintsUsed?: number;
}

// ============================================================================
// The mastery-gate ladder (Archive-Spec R6/R7, locked 2026-07-21).
// The runtime computes this after each wrong answer; the presenter enforces
// the read-dwell + pause friction and the disabled options. Passage is always
// guaranteed — brute-forcing is merely slow.
// ============================================================================

export type CheckpointHintKind = "MEMORY_CUE" | "EXPLICIT" | "ELIMINATION";

export interface CheckpointGateState {
  /** Wrong attempts so far on this item (>= 1 whenever a gate is present). */
  attempt: number;
  hintKind: CheckpointHintKind;
  /** Hint copy. MEMORY_CUE is built from THIS student's provenance log. */
  hint: string;
  /** Options no longer selectable (eliminated distractors). */
  disabledOptionIds: string[];
  /** Presenter must show the hint this long before answers re-enable. */
  dwellMs: number;
  /** Additional enforced pause after the dwell. */
  pauseMs: number;
}

export type CheckpointProgress =
  | "NOT_STARTED"
  | "FORM_SELECTED"
  | "IN_PROGRESS"
  | "COMMITTED"
  | "TRANSITIONED";

export interface ActCarryoverProjection {
  relationships: Record<string, number>;
  heatBand: string;
  recognized: boolean;
  clarkeMarked: boolean;
  standingBand: string;
  threads: Record<string, unknown>;
  routes: Record<string, string>;
  custody: Record<string, string>;
  learner: Record<string, unknown>;
  microEngagements: MicroEngagementRecord[];
  sourceProvenance: SourceEngagementRecord[];
  formativeEvidence: FormativeEvidenceRecord[];
  checkpointId: typeof CP1_CHECKPOINT_ID;
  checkpointVersion: string;
}

export interface Cp1CheckpointState {
  checkpointId: typeof CP1_CHECKPOINT_ID;
  status: CheckpointProgress;
  selection: DebriefFormSelection | null;
  responses: DebriefResponseRecord[];
  currentItemIndex: number;
  macroOutcomes: MacroOutcomeRecord[];
  enrichmentOutcomes: EnrichmentOutcomeRecord[];
  bankVersion: string | null;
  committedEventId: string | null;
  transitionEventId: string | null;
  /** Optional player-authored one-liner filed with the commit (never scored). */
  annotation: string | null;
  nextInsertion: {
    chapterId: string;
    status: "PENDING_CONTENT" | "READY";
    label: string;
  } | null;
  carryover: ActCarryoverProjection | null;
}

export type CheckpointDebriefPhase =
  | "FORM_SELECTION"
  | "QUESTION"
  | "REVIEW"
  | "TRANSITION"
  | "CONTENT_BLOCKED";

export interface CheckpointDebriefRequest {
  kind: "CHECKPOINT_DEBRIEF";
  checkpointId: typeof CP1_CHECKPOINT_ID;
  phase: CheckpointDebriefPhase;
  state: Cp1CheckpointState;
  proposedSelection?: DebriefFormSelection;
  item?: AssessmentItem;
  /** Present after a wrong answer on `item`: the escalating-friction ladder. */
  gate?: CheckpointGateState;
  contentIssues?: string[];
  readyToCommit?: boolean;
}

export type CheckpointPresenterEvent =
  | {
      type: "DEBRIEF_FORM_SELECTED";
      checkpointId: typeof CP1_CHECKPOINT_ID;
      selection: DebriefFormSelection;
    }
  | {
      type: "DEBRIEF_ANSWERED";
      checkpointId: typeof CP1_CHECKPOINT_ID;
      formId: string;
      itemId: string;
      optionId: string;
    }
  | {
      type: "DEBRIEF_CONTINUED";
      checkpointId: typeof CP1_CHECKPOINT_ID;
      formId: string;
    }
  | {
      type: "DEBRIEF_COMMITTED";
      eventId: string;
      checkpointId: typeof CP1_CHECKPOINT_ID;
      formId: string;
      bankVersion: string;
      /**
       * Optional one-line player annotation from the compressed street-level
       * debrief ("annotate the full record"). Never assessed, never scored;
       * additive so historical commit events replay unchanged.
       */
      annotation?: string;
    }
  | {
      type: "ACT_TRANSITIONED";
      eventId: string;
      checkpointId: typeof CP1_CHECKPOINT_ID;
      formId: string;
      targetChapterId: string;
    };

export function isCheckpointEvent(value: unknown): value is CheckpointPresenterEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "DEBRIEF_FORM_SELECTED" ||
    type === "DEBRIEF_ANSWERED" ||
    type === "DEBRIEF_CONTINUED" ||
    type === "DEBRIEF_COMMITTED" ||
    type === "ACT_TRANSITIONED"
  );
}
