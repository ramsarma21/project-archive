// ============================================================================
// @pa/assessment — the chapter capstone.
//
// The mandatory learning gate. A mission can be failed three times and the
// player advances anyway; this is what makes that defensible, because the next
// chapter does not open until every concept in this one has been demonstrated at
// 100%.
//
// Read the README for the argued decisions. The short version:
//
//   - Two items per concept, one form for everyone, no difficulty scaling.
//   - 100% per concept or the concept is not mastered. No partial credit.
//   - 100% per concept is also the only thing that mints a PvP-legal Codex card.
//   - A retry narrows to the unmastered concepts and draws fresh items, with the
//     learning module as the gate on every attempt.
//   - The first attempt's score is the reported measure, derived exclusively
//     from attempt ordinal 1 so a retry cannot reach it.
//   - Fully event-sourced and deterministic: the log holds no score, no mastery
//     flag and no pass flag, because all three are derived.
//   - Zero XP, no Rank effect.
// ============================================================================

// ---- the curriculum port ---------------------------------------------------
export {
  CHAPTER_BOSTON,
  UnknownChapterError,
  asCurriculumConceptId,
  eraOverlapsWindow,
  isCurriculumChapterId,
  isCurriculumConceptId,
  parseEraRange,
  registryConceptSource,
  resolveConceptRef,
  staticConceptSource,
  type AssessableConcept,
  type ConceptRefResolution,
  type ConceptSource,
  type CurriculumChapterId,
  type CurriculumConceptId,
  type EraRange,
  type InstructionalConcept,
} from "./curriculum.js";

// ---- the grading port (assumed; packages/grading does not exist yet) -------
export {
  ASSESSMENT_VERDICT_KINDS,
  VERDICT_ENVELOPE_KEYS,
  keyOnlyGradingAuthority,
  mintAssessmentVerdict,
  mintUnansweredVerdict,
  parseVerdictEnvelope,
  verdictEnvelope,
  verdictIsCorrect,
  type AssessmentVerdict,
  type AssessmentVerdictKind,
  type AssessmentVerdictSource,
  type GradingAuthority,
  type GradingFailureCode,
  type GradingResult,
  type GradingUnavailable,
  type ItemSubmission,
  type MintAssessmentVerdictInput,
  type OpenResponseSubmission,
  type SelectedResponseSubmission,
  type VerdictParseResult,
  type VerdictRejectionCode,
} from "./grading.js";

// ---- the reconciliation with @pa/grading ----------------------------------
export {
  ASSESSMENT_CONSUMES_TIMEOUT_GRANTS,
  ASSESSMENT_GRANTS_ON_LOW_CONFIDENCE,
  adaptGradedVerdict,
  assessmentGradingAuthority,
  assessmentGradingProvenance,
  verdictWasActuallyGraded,
  type AssessmentGradingProvenance,
  type GradedVerdictSource,
  type GradingFallbackReason,
} from "./gradingAdapter.js";

// ---- items and provenance --------------------------------------------------
export {
  ITEM_PROBES,
  buildItemBank,
  formProvenanceRollup,
  fromReleasedItemCapture,
  itemEligibility,
  type AssessmentItemDescriptor,
  type AssessmentItemFormat,
  type AssessmentItemOption,
  type AuthoredProvenance,
  type ItemBank,
  type ItemEligibility,
  type ItemEligibilityOptions,
  type ItemProbe,
  type ItemProvenance,
  type ItemRefusal,
  type ItemReviewStatus,
  type ProvenanceRollup,
  type ReleasedItemCapture,
  type ReleasedItemStrength,
  type ReleasedTeaProvenance,
} from "./items.js";

// ---- the blueprint ---------------------------------------------------------
export {
  ASSESSMENT_XP_AWARD,
  FRESH_FORM_TARGET,
  OPEN_RESPONSE_PER_FORM,
  RESERVE_TARGET_PER_CONCEPT,
  blueprintReadiness,
  compileBlueprint,
  unassessableConceptIds,
  type BlueprintReadiness,
  type ChapterAssessmentBlueprint,
  type CompileBlueprintInput,
  type ConceptReadiness,
  type ConceptReadinessStatus,
  type ReadinessFinding,
} from "./blueprint.js";

// ---- determinism -----------------------------------------------------------
export {
  conceptStreamSeed,
  deriveFormSeedHex,
  isFormSeedHex,
  seedWords,
  seededShuffle,
  type FormSeedHex,
} from "./determinism.js";

// ---- selection and the shrinking retry ------------------------------------
export {
  EMPTY_SERVED_LEDGER,
  formItems,
  recordServed,
  selectForm,
  servedItemIds,
  type ConceptFreshness,
  type FormSelection,
  type SelectFormInput,
  type SelectedConceptItems,
  type ServedLedger,
} from "./select.js";

// ---- the event log --------------------------------------------------------
export {
  itemFormatFromForm,
  logContainsNoRawText,
  serialiseLog,
  verdictHistory,
  type AssessmentEvent,
  type AssessmentEventType,
  type FormConceptRecord,
} from "./events.js";

// ---- the reducer ----------------------------------------------------------
export {
  REPORTED_ATTEMPT_ORDINAL,
  reduceAssessment,
  type AttemptState,
  type AttemptStatus,
  type ChapterAssessmentRecord,
  type ConceptAttemptScore,
  type ConceptMasteryState,
  type MintedPvpCard,
  type ReduceContext,
  type ReportedScore,
  type ResponseState,
} from "./reduce.js";

// ---- the recording path ---------------------------------------------------
export {
  abandonAttempt,
  attemptItems,
  openAttempt,
  recordResponse,
  submitAttempt,
  type OpenAttemptInput,
  type OpenedAttempt,
  type RecordResponseFailure,
  type RecordResponseInput,
  type RecordResponseResult,
  type SubmitAttemptInput,
  type SubmitFailure,
  type SubmitResult,
} from "./session.js";

// ---- the gates ------------------------------------------------------------
export {
  ASSESSMENT_ATTEMPTS_ARE_UNLIMITED,
  EMPTY_ASSESSMENT_MODULE_LEDGER,
  assessmentGateDecision,
  chapterUnlockDecision,
  conceptIsPvpLegal,
  findModuleCompletion,
  nextAssessmentOrdinal,
  type AssessmentGateDecision,
  type AssessmentGateInput,
  type AssessmentModuleLedger,
  type AttemptBlock,
  type ContentGap,
  type UnlockBlock,
  type UnlockDecision,
} from "./gate.js";

// ---- Codex cards ---------------------------------------------------------
export {
  PROMOTE_UNLEARNED_CARDS,
  applyCardPromotions,
  planCardPromotions,
  pvpLegalCardIds,
  type CardPromotion,
  type CardPromotionPlan,
  type CardPromotionRefusal,
  type RefusedPromotion,
} from "./cards.js";

// ---- reporting ----------------------------------------------------------
export {
  buildChapterAssessmentReport,
  chapterReportKey,
  teacherReportSet,
  type AttemptReportRow,
  type BuildReportInput,
  type ChapterAssessmentReport,
  type ConceptReportRow,
  type ConceptReportStatus,
  type ConceptScore,
  type MasteryNow,
} from "./report.js";

// ---- persistence projections -------------------------------------------
export {
  attemptRows,
  conceptLedgerRows,
  conceptMasteryRows,
  responseRows,
} from "./persistence.js";
