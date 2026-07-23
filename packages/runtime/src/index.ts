import type { PresenterEvent } from "@pa/contracts";
import {
  createChapterSession,
  type CreateChapterSessionOptions,
} from "./engine/chapter.js";
import type { Session } from "./engine/driver.js";
import type { AssessmentRuntimeConfig } from "./engine/ctx.js";
import { BOSTON_1765_CHAPTER } from "./content/bostonChapter.js";

// ---- Generic engine surface ----
export { Ctx } from "./engine/ctx.js";
export type { Flow, Sub, Yielded, AssessmentRuntimeConfig } from "./engine/ctx.js";
export { Session } from "./engine/driver.js";
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
export { deriveAttemptSeed, deriveFieldSeedHex, draw, bytesToHex } from "./seed.js";
export {
  applyFieldEvent,
  assertFieldEventPayload,
  compileFieldVocabulary,
  initialFieldState,
  projectFieldRuntimeView,
  syncLegacyFieldCompatibility,
} from "./fieldState.js";
export type { CompiledFieldVocabulary } from "./fieldState.js";
export { resolveOutcome } from "./outcome.js";
export { buildMasteryReport } from "./report.js";
export type { ReportMeta } from "./report.js";
export {
  selectDebrief,
  resolveSelectedItems,
} from "./assessment/selectDebrief.js";
export {
  validateQuestionBank,
  assertSelectableBank,
} from "./assessment/validateQuestionBank.js";
export {
  resolveRubricObservation,
  resolveClassifierResult,
  unclassifiedResolution,
  resolutionMatchesPackage,
} from "./assessment/rubricResolver.js";

// ---- Boston chapter content (tracked debt: leaves this barrel when the
// chapter package lands; consumers move to @pa/chapter-boston) ----
export { BOSTON_1765_CHAPTER, BOSTON_DAY1_FLOW_VERSION } from "./content/bostonChapter.js";
export { day1Flow } from "./content/day1/flow.js";
export * from "./content/day1/tables.js";
export { TEXT } from "./content/day1/text.js";
export {
  eligibleNpcFollowupsForField,
  resolveRegisteredReactiveOutcome,
} from "./content/day1/reactive.js";
export { DAY1_CUES } from "./content/day1/choreography.js";
export {
  CP1_BANK_REGISTRY,
  CP1_DEVELOPMENT_FIXTURE_BANK,
  CP1_PRODUCTION_BANK,
} from "./content/checkpoints/cp1Bank.js";
export {
  CP1_ASSESSMENT_TO_LEARNER,
  CP1_CHECKPOINT_ID,
  CP1_FORM_ID_PREFIX,
  CP1_MICRO_SOURCE_LABELS,
  CP1_REQUIRED_MACROS,
} from "./content/checkpoints/cp1Ids.js";
export {
  openResponsePackages,
  openResponsePackage,
  authoredFeedback,
  authoredFallbackForPrompt,
  eligibleOpenResponses,
  eligibleArchiveConnections,
  archiveConnections,
  npcFollowups,
  sourcePacket,
  sourcePacketIdsForFieldSource,
  validateAct1OpenResponseArtifact,
  OPEN_RESPONSE_FEEDBACK,
  ACT1_OPEN_RESPONSE_PACKAGE_ID,
  ACT1_OPEN_RESPONSE_PACKAGE_VERSION,
  ACT1_OPEN_RESPONSE_PACKAGE_HASH,
  ACT1_OPEN_RESPONSE_EXPOSURE_CAP,
  ACT1_CLASSIFIER_SCHEMA_ID,
  ACT1_CLASSIFIER_SCHEMA_VERSION,
  ACT1_CLASSIFIER_SCHEMA_HASH,
} from "./assessment/openResponseRegistry.js";
export {
  HISTORICAL_SOURCE_REGISTRY,
  FIELD_SOURCE_ALIASES,
  canonicalSourceId,
  canonicalSourceIds,
} from "./content/provenance.js";

// Create a Boston Day 1 session for a profile. attemptStartSequence defaults
// to 0 for the first attempt. Determinism comes from the variation root seed.
// One-liner over the generic chapter session factory.
export function createDay1Session(opts: {
  variationRootSeedHex: string;
  attemptStartSequence?: number;
  priorEvents?: PresenterEvent[];
  assessmentMode?: "PRODUCTION" | "QA_DRAFT";
  openResponseContentMode?: "PRODUCTION" | "AUTHOR_DRAFT_QA";
  assessmentConfig?: AssessmentRuntimeConfig;
}): Session {
  return createChapterSession(
    BOSTON_1765_CHAPTER,
    opts as CreateChapterSessionOptions,
  );
}
