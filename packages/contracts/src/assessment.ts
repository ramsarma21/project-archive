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
export type AssessmentConceptId =
  | Cp1MacroConceptId
  | MicroConceptId
  // Lineage/era-scoped concept ids for items banked toward future checkpoints
  // (e.g. the post-1765 "RCL.*" lineage concepts). Widened to string so those
  // banked items can carry a stable, non-CP1 concept id without being mistaken
  // for a CP1 macro/micro. `(string & {})` keeps literal-union autocomplete for
  // the known ids while remaining additive/non-breaking.
  | (string & {});
export type AssessmentTier = "MACRO" | "MICRO";
// DRAFT: engineering fixture. SME_APPROVED: subject-matter reviewer sign-off.
// OWNER_PROVIDED: real product-owner-supplied content, approved for use and
// eligible for production selection, but NOT an SME/TEKS sign-off claim.
// Additive union widening; existing consumers keep working.
export type AssessmentApprovalStatus = "DRAFT" | "SME_APPROVED" | "OWNER_PROVIDED";
export type AssessmentDifficulty = "FOUNDATIONAL" | "ON_LEVEL" | "STRETCH";

/**
 * Content that may be selected in production: SME-approved or owner-provided.
 * Owner-provided content is approved-for-use but does not assert SME/TEKS
 * sign-off (see AssessmentApprovalStatus).
 */
export function isProductionApprovedStatus(
  status: AssessmentApprovalStatus,
): boolean {
  return status === "SME_APPROVED" || status === "OWNER_PROVIDED";
}

export interface AssessmentOption {
  optionId: string;
  text: string;
  /**
   * Author/owner rationale for this option: why it is correct, or why it is a
   * distractor. Powers richer hint/feedback copy. The correct option's
   * rationale doubles as the post-answer explanation. Optional/additive so
   * historical banks replay unchanged.
   */
  rationale?: string;
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
  /** Historical era the item is set in (e.g. "1765", "1774", "1789-1791"). */
  era?: string;
  /**
   * Checkpoint/act scopes in which this item may be selected. When present, a
   * checkpoint selects the item only if its checkpoint id is listed (see
   * isCp1ScopedItem). Absent = unrestricted (legacy fixtures stay selectable).
   * Post-1765 items scope to future checkpoints so CP1 excludes them.
   */
  actScope?: readonly string[];
  /**
   * Related concept lineage tags — e.g. a CP1 macro concept this later item
   * descends from — recorded for future-checkpoint reuse and reporting. This
   * does NOT make the item CP1-selectable (era/actScope governs selection).
   */
  conceptLineage?: readonly string[];
  /** Content provenance, e.g. "user-supplied 2026-07-23". */
  provenance?: string;
}

/**
 * True when an item is eligible for CP1 (Boston Day 1, 1765) selection: either
 * unrestricted (no actScope — legacy fixtures) or explicitly scoped to the CP1
 * checkpoint. Post-1765 items scoped to future checkpoints return false and are
 * excluded from CP1 selection and CP1 validator requirements.
 */
export function isCp1ScopedItem(item: AssessmentItem): boolean {
  return (
    item.actScope === undefined || item.actScope.includes(CP1_CHECKPOINT_ID)
  );
}

/**
 * The correct option's rationale, which doubles as the explanation shown after
 * a checkpoint item is answered. Returns undefined when no rationale is stored.
 */
export function correctOptionExplanation(
  item: AssessmentItem,
): string | undefined {
  return item.options.find((o) => o.optionId === item.correctOptionId)
    ?.rationale;
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
