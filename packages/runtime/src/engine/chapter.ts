import type {
  AssessmentQuestionBank,
  AuthoredNpcFollowupView,
  CitedConfrontationOption,
  ConceptId,
  ConceptRegistry,
  ExposureProvenance,
  ExposureType,
  FieldDurableState,
  FieldRepositionAnchor,
  MicroConceptId,
  OpenResponsePrompt,
  OpenResponseRubric,
  OptionalActivityId,
  OptionalActivityState,
  PresenterEvent,
  ReactiveCompletionEffects,
  TeksClause,
  ThreadId,
  ThreadStableFlag,
  ThreadState,
  WorldState,
} from "@pa/contracts";
import type { Flow, AssessmentRuntimeConfig } from "./ctx.js";
// Value import is safe: ctx.ts only type-imports from this module, so there
// is no runtime import cycle.
import { Ctx } from "./ctx.js";
import { Session } from "./driver.js";
import { deriveAttemptSeed } from "../seed.js";

// ============================================================================
// ChapterDefinition: the ONE injection seam between the generic learning
// engine (this package) and a content chapter package. The engine never
// imports chapter content; a chapter package assembles one of these and hands
// it to createChapterSession / the worker registry. "Make Philadelphia" means
// building a new ChapterDefinition, not touching the engine.
//
// Every field here is derived from what the engine actually consumes today
// (ctx.ts, dsl.ts, fieldState.ts, gate.ts, selectDebrief.ts,
// validateQuestionBank.ts, rubricResolver.ts, world.ts, learner.ts,
// report.ts, worker.ts). No speculative fields.
// ============================================================================

// A tracked exposure the engine may commit on the chapter's behalf (the
// Found-History Tier-A bridge in Ctx.applyFieldEvent).
export interface TrackedExposureDef {
  exposureId: string;
  concept: ConceptId;
  type: ExposureType;
  provenance?: ExposureProvenance;
}

// Default presentation-cue derivations for DSL requests whose call sites do
// not pass an explicit cueId. Values are chapter-authored stable ids.
export interface FlowCueDefaults {
  continueCue(label: string | undefined): string;
  ackCue(): string;
  dayEndCue(): string;
  readCue(objectId: string): string;
  roamCue(targetIds: readonly string[]): string;
}

// The archive-connection card as authored by the chapter's content package.
// The engine passes cards through to the RuntimeView verbatim (plus derived
// artifactRefs), so chapter-specific extra fields survive the projection.
export interface ArchiveConnectionCard {
  cardId: string;
  title: string;
  body: string;
  citations: readonly string[];
  linkedPromptId: string;
  [extra: string]: unknown;
}

// The open-response content surface Ctx consumes. Implemented by the chapter
// package over its authored/generated content artifact.
export interface ChapterOpenResponseContent {
  eligible(input: {
    sourceInteractions: Readonly<Record<string, number>>;
    engagedMicroConceptIds?: ReadonlySet<string>;
    currentInteractionOrdinal: number;
    completedPromptIds: ReadonlySet<string>;
    actCompletionCount: number;
    allowAuthorDraft?: boolean;
  }): OpenResponsePrompt[];
  package(
    identifier: string,
    access?: { allowAuthorDraft?: boolean },
  ): { prompt: OpenResponsePrompt; rubric: OpenResponseRubric } | undefined;
  npcFollowups(access: {
    allowAuthorDraft?: boolean;
  }): readonly AuthoredNpcFollowupView[];
  eligibleNpcFollowupsForField(
    field: FieldDurableState,
  ): readonly AuthoredNpcFollowupView[];
  archiveConnections(input: {
    engagedSourcePacketIds: ReadonlySet<string>;
    allowAuthorDraft?: boolean;
  }): readonly ArchiveConnectionCard[];
  /** Backing refs of one source packet (poster artifact derivation). */
  sourcePacketBackingRefs(sourcePacketId: string): readonly string[];
}

// Chapter vocabulary the field reducer/assertions are parameterized by.
// Compiled once per Ctx (see compileFieldVocabulary in fieldState.ts).
export interface FieldVocabulary {
  microConceptIds: readonly MicroConceptId[];
  threadIds: readonly ThreadId[];
  threadFlags: readonly ThreadStableFlag[];
  activityIds: readonly OptionalActivityId[];
  /** Chapter-seeded initial thread records (insertion order is durable). */
  initialThreads(): Record<ThreadId, ThreadState>;
  /** Chapter-seeded initial activity records (insertion order is durable). */
  initialActivities(): Record<OptionalActivityId, OptionalActivityState>;
  repositionAnchors: Readonly<Record<string, FieldRepositionAnchor>>;
  /** Authored cited-defense table (knowledge as ammunition). */
  citedDefenses: readonly CitedConfrontationOption[];
  /**
   * The micro-concept a resolved confrontation/chase teaches (null if the
   * chapter has none). Record prefixes preserve the durable recordId format.
   */
  confrontationMicro: {
    microConceptId: MicroConceptId;
    confrontationRecordPrefix: string;
    chaseRecordPrefix: string;
  } | null;
  sourceEngagement: {
    canonicalSourceIds(sourceId: string): readonly string[];
    contentPackageHash: string;
  };
}

// Checkpoint identity + selection rules consumed by selectDebrief and
// validateQuestionBank.
export interface CheckpointSpec {
  checkpointId: string;
  /** Required macro concept ids, in authored order. */
  requiredMacroConceptIds: readonly string[];
  /** Valid MICRO-tier concept ids for this checkpoint. */
  microConceptIds: readonly string[];
  /** Stable form-id prefix, e.g. "BOS.ACT01.CP1.FORM." */
  formIdPrefix: string;
}

// Maps the mastery-gate hint ladder reads (assessment concept -> learner
// concept for provenance cues; tracked world source -> recall label).
export interface GateContentMaps {
  assessmentToLearner: Readonly<Record<string, ConceptId>>;
  microSourceLabels: Readonly<Record<string, string>>;
}

// Everything buildMasteryReport needs to label a chapter's concepts.
export interface ChapterReportSpec {
  conceptNames: Readonly<Record<string, string>>;
  conceptTeks: Readonly<Record<string, TeksClause>>;
  conceptMeta: ConceptRegistry;
  microLabels: Readonly<Record<string, string>>;
}

export interface ChapterDefinition {
  chapterId: string;
  packageId: string;
  flowVersion: number;
  createFlow: (ctx: Ctx) => Flow;
  content: {
    /** Chapter-seeded initial world (objectives, job objects, clock tuning). */
    createInitialWorldState(): WorldState;
    /** Learner concepts, in durable insertion order. */
    learnerConceptIds: readonly ConceptId[];
    /** Short names for the RuntimeView learner panel. */
    conceptShortNames: Readonly<Record<string, string>>;
    /** Sync spacing tuning consumed by the learner scheduling helpers. */
    minimumInteractionsBetweenSyncs: number;
    /** Headline shown before the flow sets one. */
    defaultHeadline: string;
    clockWarningLines: Readonly<Record<"FIRST" | "SECOND" | "FINAL", string>>;
    /** Found-History Tier-A bridge: field sourceId -> tracked exposures. */
    loreMacroSupport: Readonly<
      Record<string, readonly TrackedExposureDef[]>
    >;
    /** Resolve a registered stable reactive outcome into committed effects. */
    reactiveOutcomeResolver(input: {
      field: FieldDurableState;
      interactionId: string;
      sourceId: string;
      outcomeId: string;
    }): ReactiveCompletionEffects;
    /** Source-id prefix marking author-draft-only interactions. */
    authorDraftSourcePrefix: string;
    cues: FlowCueDefaults;
    openResponse: ChapterOpenResponseContent;
    canonicalSourceIds(sourceId: string): readonly string[];
  };
  assessment: {
    checkpoint: CheckpointSpec;
    banks: ReadonlyMap<string, AssessmentQuestionBank>;
    productionBankVersion: string;
    qaDraftBankVersion: string;
    gateMaps: GateContentMaps;
    /** Pre-package rubric ids grandfathered by resolutionMatchesPackage. */
    legacyRubricIds: readonly string[];
  };
  fieldVocabulary: FieldVocabulary;
  report: ChapterReportSpec;
}

// ============================================================================
// Registry + session factory. The worker and the API replay path look
// chapters up by save.chapterId; unknown ids are a clean caller error.
// ============================================================================

export interface ChapterRegistry {
  get(chapterId: string): ChapterDefinition | undefined;
  require(chapterId: string): ChapterDefinition;
  chapterIds: readonly string[];
}

export function createChapterRegistry(
  chapters: readonly ChapterDefinition[],
): ChapterRegistry {
  const byId = new Map<string, ChapterDefinition>();
  for (const chapter of chapters) {
    if (byId.has(chapter.chapterId)) {
      throw new Error(`CHAPTER_REGISTRY_INVALID: duplicate ${chapter.chapterId}`);
    }
    byId.set(chapter.chapterId, chapter);
  }
  return {
    get: (chapterId) => byId.get(chapterId),
    require: (chapterId) => {
      const chapter = byId.get(chapterId);
      if (!chapter) {
        throw new Error(`CHAPTER_UNKNOWN: ${chapterId}`);
      }
      return chapter;
    },
    chapterIds: [...byId.keys()],
  };
}

export interface CreateChapterSessionOptions {
  variationRootSeedHex: string;
  attemptStartSequence?: number;
  priorEvents?: PresenterEvent[];
  assessmentMode?: "PRODUCTION" | "QA_DRAFT";
  openResponseContentMode?: "PRODUCTION" | "AUTHOR_DRAFT_QA";
  assessmentConfig?: AssessmentRuntimeConfig;
}

// Create a session for one chapter. Determinism comes from the variation
// root seed; the chapter id is bound into the attempt-seed derivation.
export function createChapterSession(
  chapter: ChapterDefinition,
  opts: CreateChapterSessionOptions,
): Session {
  const seed = deriveAttemptSeed(
    opts.variationRootSeedHex,
    chapter.chapterId,
    opts.attemptStartSequence ?? 0,
  );
  const assessmentMode = opts.assessmentMode ?? "PRODUCTION";
  const ctx = new Ctx(
    seed,
    chapter,
    opts.assessmentConfig ?? {
      mode: assessmentMode,
      openResponseContentMode: opts.openResponseContentMode ?? "PRODUCTION",
      activeBankVersion:
        assessmentMode === "QA_DRAFT"
          ? chapter.assessment.qaDraftBankVersion
          : chapter.assessment.productionBankVersion,
      banks: chapter.assessment.banks,
    },
  );
  return new Session(ctx, chapter.createFlow, opts.priorEvents ?? []);
}
