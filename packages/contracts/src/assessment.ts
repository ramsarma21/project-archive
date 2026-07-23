import type {
  MicroConceptId,
  MicroEngagementRecord,
  SourceEngagementRecord,
} from "./field.js";
import type { FormativeEvidenceRecord } from "./openResponse.js";

// Assessment concept ids are chapter vocabulary (macro RCC.*, micro, and
// lineage/era-scoped ids banked toward future checkpoints). The protocol
// keeps them as plain strings; chapter packages own the concrete unions.
export type AssessmentConceptId = string;
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
   * isCheckpointScopedItem). Absent = unrestricted (legacy fixtures stay
   * selectable). Later-era items scope to future checkpoints so earlier
   * checkpoints exclude them.
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
 * True when an item is eligible for the given checkpoint's selection: either
 * unrestricted (no actScope — legacy fixtures) or explicitly scoped to that
 * checkpoint. Items scoped to other/future checkpoints return false and are
 * excluded from selection and validator requirements.
 */
export function isCheckpointScopedItem(
  item: AssessmentItem,
  checkpointId: string,
): boolean {
  return (
    item.actScope === undefined || item.actScope.includes(checkpointId)
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
  checkpointId: string;
  /** Route-independent required checkpoint identity (macro items only). */
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
  conceptId: AssessmentConceptId;
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
  checkpointId: string;
  checkpointVersion: string;
}

export interface Cp1CheckpointState {
  checkpointId: string;
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
  checkpointId: string;
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
      checkpointId: string;
      selection: DebriefFormSelection;
    }
  | {
      type: "DEBRIEF_ANSWERED";
      checkpointId: string;
      formId: string;
      itemId: string;
      optionId: string;
    }
  | {
      type: "DEBRIEF_CONTINUED";
      checkpointId: string;
      formId: string;
    }
  | {
      type: "DEBRIEF_COMMITTED";
      eventId: string;
      checkpointId: string;
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
      checkpointId: string;
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
