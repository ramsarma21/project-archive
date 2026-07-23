import type { PresenterEvent } from "@pa/contracts";
import { Ctx } from "./engine/ctx.js";
import { Session } from "./engine/driver.js";
import { day1Flow } from "./content/day1/flow.js";
import { deriveAttemptSeed } from "./seed.js";
import { CHAPTER_ID } from "@pa/contracts";
import {
  CP1_BANK_REGISTRY,
  CP1_DEVELOPMENT_FIXTURE_BANK,
  CP1_PRODUCTION_BANK,
} from "./assessment/questionBank.js";
import type { AssessmentRuntimeConfig } from "./engine/ctx.js";

export { Ctx } from "./engine/ctx.js";
export { Session } from "./engine/driver.js";
export { day1Flow } from "./content/day1/flow.js";
export { deriveAttemptSeed, deriveFieldSeedHex, draw, bytesToHex } from "./seed.js";
export {
  applyFieldEvent,
  assertFieldEventPayload,
  initialFieldState,
  projectFieldRuntimeView,
  syncLegacyFieldCompatibility,
} from "./fieldState.js";
export { resolveOutcome } from "./outcome.js";
export { buildMasteryReport } from "./report.js";
export type { ReportMeta } from "./report.js";
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
} from "./assessment/questionBank.js";
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

// Create a Boston Day 1 session for a profile. attemptStartSequence defaults to
// 0 for the first attempt. Determinism comes from the variation root seed.
export function createDay1Session(opts: {
  variationRootSeedHex: string;
  attemptStartSequence?: number;
  priorEvents?: PresenterEvent[];
  assessmentMode?: "PRODUCTION" | "QA_DRAFT";
  openResponseContentMode?: "PRODUCTION" | "AUTHOR_DRAFT_QA";
  assessmentConfig?: AssessmentRuntimeConfig;
}): Session {
  const seed = deriveAttemptSeed(opts.variationRootSeedHex, CHAPTER_ID, opts.attemptStartSequence ?? 0);
  const assessmentMode = opts.assessmentMode ?? "PRODUCTION";
  const ctx = new Ctx(
    seed,
    opts.assessmentConfig ?? {
      mode: assessmentMode,
      openResponseContentMode:
        opts.openResponseContentMode ?? "PRODUCTION",
      activeBankVersion:
        assessmentMode === "QA_DRAFT"
          ? CP1_DEVELOPMENT_FIXTURE_BANK.bankVersion
          : CP1_PRODUCTION_BANK.bankVersion,
      banks: CP1_BANK_REGISTRY,
    },
  );
  return new Session(ctx, day1Flow, opts.priorEvents ?? []);
}
