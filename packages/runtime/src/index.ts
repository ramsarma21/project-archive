// ============================================================================
// @pa/runtime: the chapter-agnostic learning engine. This barrel exports
// ENGINE surface only — no chapter content. Chapters (e.g. @pa/chapter-boston)
// depend on this package and inject their content via ChapterDefinition;
// this package never imports from a chapter.
// ============================================================================

// Run context + session driver
export { Ctx } from "./engine/ctx.js";
export type { Flow, Sub, Yielded, AssessmentRuntimeConfig } from "./engine/ctx.js";
export { Session } from "./engine/driver.js";
export type { AdvanceResult } from "./engine/driver.js";

// Chapter injection seam + registry + session factory
export {
  createChapterRegistry,
  createChapterSession,
} from "./engine/chapter.js";
export type {
  ArchiveConnectionCard,
  ChapterDefinition,
  ChapterOpenResponseContent,
  ChapterRegistry,
  ChapterReportSpec,
  CheckpointSpec,
  CreateChapterSessionOptions,
  FieldVocabulary,
  FlowCueDefaults,
  GateContentMaps,
  TrackedExposureDef,
} from "./engine/chapter.js";

// Flow DSL (chapter flows are written against these)
export {
  breathe,
  choose,
  focusRead,
  freeRoam,
  mechanic,
  waitAck,
  waitContinue,
  waitDayEnd,
} from "./engine/dsl.js";

// Deterministic seed/outcome machinery
export { deriveAttemptSeed, deriveFieldSeedHex, draw, bytesToHex } from "./seed.js";
export { resolveOutcome } from "./outcome.js";
export type { WeightedOutcome } from "./outcome.js";

// World clock machinery
export {
  advanceClock,
  bumpInteractionOrdinal,
  phaseForUnits,
  warningStageForUnits,
} from "./world.js";
export type { ClockAdvanceResult } from "./world.js";

// Learner state machinery
export {
  applyInitialSync,
  applyRetrySync,
  canPresentInitialSync,
  canPresentRetrySync,
  commitExposure,
  conceptsNeedingExposure,
  dayCompletionSatisfied,
  initialLearnerState,
  markDemonstrated,
  unlockDemonstration,
} from "./learner.js";

// Relationship scales
export { adjustRelationship, setRelationship } from "./relationships.js";

// Field state reducer/assertions (vocabulary-parameterized)
export {
  applyFieldEvent,
  assertFieldEventPayload,
  citedConfrontationOptionFor,
  compileFieldVocabulary,
  initialFieldState,
  microId,
  projectFieldRuntimeView,
  syncLegacyFieldCompatibility,
  threadId,
} from "./fieldState.js";
export type { CompiledFieldVocabulary } from "./fieldState.js";

// Mastery report projection
export { buildMasteryReport, engagedConcepts } from "./report.js";
export type { ReportMeta } from "./report.js";

// Assessment engine (checkpoint selection, bank validation, gate ladder,
// open-response rubric resolution)
export {
  resolveSelectedItems,
  selectDebrief,
} from "./assessment/selectDebrief.js";
export type { SelectDebriefOptions } from "./assessment/selectDebrief.js";
export {
  assertSelectableBank,
  validateQuestionBank,
} from "./assessment/validateQuestionBank.js";
export type {
  BankValidationOptions,
  BankValidationResult,
} from "./assessment/validateQuestionBank.js";
export {
  computeGateState,
  explicitHintFor,
  gateDwellMs,
  gatePauseMs,
  hintKindForAttempt,
  memoryCueFor,
} from "./assessment/gate.js";
export {
  resolutionMatchesPackage,
  resolveClassifierResult,
  resolveRubricObservation,
  unclassifiedResolution,
} from "./assessment/rubricResolver.js";
export type { RubricResolutionContext } from "./assessment/rubricResolver.js";
