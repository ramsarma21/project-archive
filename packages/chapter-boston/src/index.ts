import type { PresenterEvent } from "@pa/contracts";
import {
  createChapterSession,
  type AssessmentRuntimeConfig,
  type CreateChapterSessionOptions,
  type Session,
} from "@pa/runtime";
import { BOSTON_1765_CHAPTER } from "./chapter.js";

// ============================================================================
// @pa/chapter-boston public surface: the Boston 1765 chapter package.
// Depends on the engine (@pa/runtime); the engine NEVER depends on this.
// ============================================================================

export { BOSTON_1765_CHAPTER, BOSTON_DAY1_FLOW_VERSION } from "./chapter.js";

// Chapter/package ids + concept vocabulary
export * from "./ids.js";
export * from "./tuning.js";
export * from "./fieldIds.js";
export * from "./teks.js";

// Day-1 authored content
export { day1Flow } from "./day1/flow.js";
export * from "./day1/tables.js";
export { TEXT } from "./day1/text.js";
export {
  eligibleNpcFollowupsForField,
  resolveRegisteredReactiveOutcome,
} from "./day1/reactive.js";
export { DAY1_CUES } from "./day1/choreography.js";
export { scorePrintJob } from "./day1/mechanics.js";
export { resolveNedWager } from "./day1/flow.js";
export { createBostonWorldState } from "./world.js";

// CP1 assessment content
export {
  CP1_BANK_REGISTRY,
  CP1_DEVELOPMENT_FIXTURE_BANK,
  CP1_PRODUCTION_BANK,
} from "./checkpoints/cp1Bank.js";
export {
  CP1_ASSESSMENT_TO_LEARNER,
  CP1_CHECKPOINT_ID,
  CP1_FORM_ID_PREFIX,
  CP1_MICRO_SOURCE_LABELS,
  CP1_REQUIRED_MACROS,
} from "./checkpoints/cp1Ids.js";

// Open-response content package + provenance registry
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
} from "./openResponse.js";
export type { OpenResponsePackage } from "./openResponse.js";
export {
  HISTORICAL_SOURCE_REGISTRY,
  FIELD_SOURCE_ALIASES,
  canonicalSourceId,
  canonicalSourceIds,
} from "./provenance.js";

// Create a Boston Day 1 session for a profile. attemptStartSequence defaults
// to 0 for the first attempt. Determinism comes from the variation root seed.
// One-liner over the engine's generic chapter session factory.
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
