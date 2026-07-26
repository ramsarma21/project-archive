import { z } from "zod";

// ============================================================================
// Progression protocol (new game). Two layers, deliberately separate:
//
//   CAMPAIGN state is durable and spans chapters: Rank, cumulative Levels,
//   the Codex, permanent PvP ability unlocks, and per-concept mastery.
//   CHAPTER state resets when a chapter begins: Level, XP, PvE abilities.
//   RUN state is exactly one mission attempt.
//
// Every value a client could profit from asserting — XP, Level, Rank, an
// attempt ordinal, a graded verdict — is absent from every request schema in
// this file. The server derives all of it from committed outcomes.
// ============================================================================

const StableId = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const IsoDate = z.string().datetime({ offset: true });
const Uuid = z.string().uuid();
const SeedHex = z.string().regex(/^[0-9a-f]{32}$/);

/** Bumped when a stored progression row's shape changes incompatibly. */
export const PROGRESSION_MODEL_VERSION = 1;

/** A new runner: Level 0, 0 XP, Rank 1. */
export const STARTING_LEVEL = 0;
export const STARTING_XP = 0;
export const STARTING_RANK = 1;

/** Cumulative Levels — across every chapter — that buy one Rank. */
export const LEVELS_PER_RANK = 10;

/** Three attempts per mission, then it is spent forever. */
export const MAX_MISSION_ATTEMPTS = 3;

/** A learning module is always exactly 3 minutes. Never 90 seconds. */
export const LEARNING_MODULE_SECONDS = 180;

/** Chapter assessment: two items per concept per form. */
export const ASSESSMENT_ITEMS_PER_CONCEPT = 2;

/**
 * XP paid per attempt as an exact fraction of the mission's base award: full,
 * two-thirds, one-third. Kept as integer pairs so the award is computed with
 * integer arithmetic and never accumulates float error.
 */
export const MISSION_ATTEMPT_XP_FRACTIONS = [
  { numerator: 3, denominator: 3 },
  { numerator: 2, denominator: 3 },
  { numerator: 1, denominator: 3 },
] as const;

/** Nothing but a mission clear pays XP. Modules and assessments pay this. */
export const ZERO_XP = 0;

export type XpFraction = { readonly numerator: number; readonly denominator: number };

// ---------------------------------------------------------------------------
// Authored progression content (numbers live in content, not in code)
// ---------------------------------------------------------------------------

/**
 * The XP -> Level curve. `levelThresholds[i]` is the chapter XP required to
 * reach Level i+1, strictly increasing. No curve is authored in the repository
 * yet; this contract fixes the shape so the authoring task supplies only data.
 */
export const XpCurveSchema = z
  .object({
    curveId: StableId,
    version: StableId,
    levelThresholds: z.array(z.number().int().positive()).min(1).max(400),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (let i = 1; i < value.levelThresholds.length; i += 1) {
      if (value.levelThresholds[i]! <= value.levelThresholds[i - 1]!) {
        ctx.addIssue({
          code: "custom",
          path: ["levelThresholds", i],
          message: "levelThresholds must be strictly increasing",
        });
        return;
      }
    }
  });
export type XpCurve = z.infer<typeof XpCurveSchema>;

/**
 * An ability unlock milestone. Chapter-scoped: the same ability may be minted
 * by different chapters, and a chapter's set is re-earned from Level 0 in PvE.
 */
export const AbilityMilestoneSchema = z
  .object({
    abilityId: StableId,
    chapterId: StableId,
    level: z.number().int().min(1),
  })
  .strict();
export type AbilityMilestone = z.infer<typeof AbilityMilestoneSchema>;

/** A mission's authored base XP award, paid in full only on attempt 1. */
export const MissionRewardSchema = z
  .object({
    missionId: StableId,
    chapterId: StableId,
    baseXp: z.number().int().nonnegative(),
    moduleId: StableId,
    conceptIds: z.array(StableId).min(1).max(8),
  })
  .strict();
export type MissionReward = z.infer<typeof MissionRewardSchema>;

// ---------------------------------------------------------------------------
// Campaign state — durable, spans chapters
// ---------------------------------------------------------------------------

/**
 * Rank and cumulative Levels. Rank is an integer, starts at 1, carries across
 * chapters, and is monotonic: it is stored rather than derived on read so a
 * later change to the curve or to a chapter's Levels can never demote a
 * player. `cumulativeLevels` counts every Level ever earned, including the
 * active chapter's, so partial progress carries across a chapter boundary.
 */
export const CampaignProgressionSchema = z
  .object({
    profileId: Uuid,
    modelVersion: z.number().int().positive(),
    rank: z.number().int().min(STARTING_RANK),
    cumulativeLevels: z.number().int().nonnegative(),
    activeChapterId: StableId,
    revision: z.number().int().nonnegative(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
  })
  .strict();
export type CampaignProgression = z.infer<typeof CampaignProgressionSchema>;

/**
 * Chapter-scoped Level and XP. Both reset to zero when a chapter begins;
 * `levelsAtChapterStart` records the carry-in so the reset is auditable and
 * cumulative Levels stay reconstructable from the per-chapter rows.
 */
export const ChapterProgressionSchema = z
  .object({
    profileId: Uuid,
    chapterId: StableId,
    level: z.number().int().nonnegative(),
    xp: z.number().int().nonnegative(),
    levelsAtChapterStart: z.number().int().nonnegative(),
    status: z.enum(["ACTIVE", "COMPLETE"]),
    assessmentPassedAt: IsoDate.nullable(),
    startedAt: IsoDate,
    completedAt: IsoDate.nullable(),
    updatedAt: IsoDate,
  })
  .strict();
export type ChapterProgression = z.infer<typeof ChapterProgressionSchema>;

// ---------------------------------------------------------------------------
// Missions and attempts
// ---------------------------------------------------------------------------

/**
 * UNSTARTED -> IN_PROGRESS -> CLEARED | FAILED_PERMANENT. FAILED_PERMANENT is
 * reached only by exhausting all three attempts; the player advances to the
 * next mission either way and the mission pays zero forever.
 */
export const MISSION_OUTCOMES = [
  "UNSTARTED",
  "IN_PROGRESS",
  "CLEARED",
  "FAILED_PERMANENT",
] as const;
export type MissionOutcome = (typeof MISSION_OUTCOMES)[number];

/** The durable per-mission record: how many attempts are spent, and how it ended. */
export const MissionProgressSchema = z
  .object({
    profileId: Uuid,
    chapterId: StableId,
    missionId: StableId,
    attemptsUsed: z.number().int().min(0).max(MAX_MISSION_ATTEMPTS),
    outcome: z.enum(MISSION_OUTCOMES),
    awardedXp: z.number().int().nonnegative(),
    clearedOnAttempt: z.number().int().min(1).max(MAX_MISSION_ATTEMPTS).nullable(),
    clearedAt: IsoDate.nullable(),
    failedAt: IsoDate.nullable(),
    updatedAt: IsoDate,
  })
  .strict();
export type MissionProgress = z.infer<typeof MissionProgressSchema>;

export const MISSION_ATTEMPT_STATUSES = [
  "IN_PROGRESS",
  "CLEARED",
  "FAILED",
  "ABANDONED",
] as const;
export type MissionAttemptStatus = (typeof MISSION_ATTEMPT_STATUSES)[number];

/**
 * Run state: exactly one mission attempt.
 *
 * `attemptOrdinal` is persisted. The retired seed helper accepted an
 * `attemptStartSequence` it never stored, so every retry re-derived the
 * attempt-zero seed and replayed the first attempt's variation. The ordinal is
 * stored here, uniquely per (profile, mission), and the seed is stored beside
 * it so a resumed retry cannot silently become attempt zero again.
 */
export const MissionAttemptSchema = z
  .object({
    attemptId: Uuid,
    profileId: Uuid,
    chapterId: StableId,
    missionId: StableId,
    attemptOrdinal: z.number().int().min(1).max(MAX_MISSION_ATTEMPTS),
    attemptSeedHex: SeedHex,
    moduleId: StableId,
    /** The gating module for THIS attempt. An attempt cannot exist without it. */
    moduleCompletedAt: IsoDate,
    status: z.enum(MISSION_ATTEMPT_STATUSES),
    xpFraction: z
      .object({
        numerator: z.number().int().nonnegative(),
        denominator: z.number().int().positive(),
      })
      .strict(),
    awardedXp: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    startedAt: IsoDate,
    completedAt: IsoDate.nullable(),
    updatedAt: IsoDate,
  })
  .strict();
export type MissionAttempt = z.infer<typeof MissionAttemptSchema>;

/**
 * The mandatory 3-minute module, recorded per gated attempt. `gatesOrdinal` is
 * the attempt it unlocks, so a retry needs its own completion row and cannot
 * reuse the first attempt's. `requiredSeconds` is the authored target and
 * `observedSeconds` is what actually happened; neither is a gate condition (see
 * CompleteLearningModuleRequestSchema).
 */
export const LearningModuleCompletionSchema = z
  .object({
    profileId: Uuid,
    chapterId: StableId,
    moduleId: StableId,
    gatesKind: z.enum(["MISSION_ATTEMPT", "ASSESSMENT_ATTEMPT"]),
    gatesId: StableId,
    gatesOrdinal: z.number().int().min(1),
    requiredSeconds: z.number().int().positive(),
    observedSeconds: z.number().int().nonnegative(),
    /** Concepts the module covered. Narrowed to unmastered ones on a retry. */
    conceptIds: z.array(StableId).max(64),
    completedAt: IsoDate,
  })
  .strict();
export type LearningModuleCompletion = z.infer<
  typeof LearningModuleCompletionSchema
>;

// ---------------------------------------------------------------------------
// Codex and abilities
// ---------------------------------------------------------------------------

/**
 * A Codex card holds two independent states, never one boolean:
 *
 *   learnedAt  — held in single-player and usable there.
 *   pvpLegalAt — minted only at 100% mastery of the card's concept on the
 *                chapter assessment. Null means learned but not PvP-legal.
 *
 * Keyed by profile and card only: the Codex carries across chapters forever.
 */
export const CodexCardStateSchema = z
  .object({
    profileId: Uuid,
    cardId: StableId,
    conceptId: StableId,
    learnedChapterId: StableId,
    learnedAt: IsoDate,
    pvpLegalAt: IsoDate.nullable(),
    updatedAt: IsoDate,
  })
  .strict();
export type CodexCardState = z.infer<typeof CodexCardStateSchema>;

/** PvE ability availability, chapter-scoped: re-earned from Level 0 each chapter. */
export const ChapterAbilityUnlockSchema = z
  .object({
    profileId: Uuid,
    chapterId: StableId,
    abilityId: StableId,
    unlockedAtLevel: z.number().int().nonnegative(),
    unlockedAt: IsoDate,
  })
  .strict();
export type ChapterAbilityUnlock = z.infer<typeof ChapterAbilityUnlockSchema>;

/** The permanent PvP loadout: every ability ever unlocked, once, forever. */
export const PvpAbilityUnlockSchema = z
  .object({
    profileId: Uuid,
    abilityId: StableId,
    firstUnlockedChapterId: StableId,
    firstUnlockedAtLevel: z.number().int().nonnegative(),
    firstUnlockedAt: IsoDate,
  })
  .strict();
export type PvpAbilityUnlock = z.infer<typeof PvpAbilityUnlockSchema>;

// ---------------------------------------------------------------------------
// Chapter assessment
// ---------------------------------------------------------------------------

/**
 * Per-concept assessment record. Mastery is all-or-nothing at 100% on a form,
 * and `firstAttempt*` preserves the reported measure even after retries drive
 * the concept to mastery. Keyed by concept, not by chapter: mastery is durable.
 */
export const ConceptMasterySchema = z
  .object({
    profileId: Uuid,
    chapterId: StableId,
    conceptId: StableId,
    itemsServed: z.number().int().nonnegative(),
    itemsCorrect: z.number().int().nonnegative(),
    firstAttemptServed: z.number().int().nonnegative(),
    firstAttemptCorrect: z.number().int().nonnegative(),
    masteredAt: IsoDate.nullable(),
    updatedAt: IsoDate,
  })
  .strict();
export type ConceptMastery = z.infer<typeof ConceptMasterySchema>;

/** The items served for one concept on one form. */
export const AssessmentFormConceptSchema = z
  .object({
    conceptId: StableId,
    itemIds: z.array(StableId).min(1).max(16),
  })
  .strict();
export type AssessmentFormConcept = z.infer<typeof AssessmentFormConceptSchema>;

/**
 * How an attempt ended.
 *
 * ABANDONED is distinct from SUBMITTED-with-no-score on purpose. A student who
 * walks out of a bad first attempt must not thereby promote the second attempt
 * into the reported measure, and that rule needs an explicit status to rest on
 * rather than being inferred from a null score. See
 * `reportedFirstAttemptMeasure`.
 */
export const CHAPTER_ASSESSMENT_ATTEMPT_STATUSES = [
  "IN_PROGRESS",
  "SUBMITTED",
  "ABANDONED",
] as const;
export type ChapterAssessmentAttemptStatus =
  (typeof CHAPTER_ASSESSMENT_ATTEMPT_STATUSES)[number];

export const ChapterAssessmentAttemptSchema = z
  .object({
    attemptId: Uuid,
    profileId: Uuid,
    chapterId: StableId,
    assessmentId: StableId,
    attemptOrdinal: z.number().int().min(1),
    /** All chapter concepts on attempt 1; only unmastered ones on a retry. */
    scopedConceptIds: z.array(StableId).min(1).max(64),
    form: z.array(AssessmentFormConceptSchema).min(1).max(64),
    status: z.enum(CHAPTER_ASSESSMENT_ATTEMPT_STATUSES),
    passed: z.boolean().nullable(),
    /** This attempt's own raw result. Never a copy of the reported measure. */
    scoreNumerator: z.number().int().nonnegative().nullable(),
    scoreDenominator: z.number().int().positive().nullable(),
    /**
     * True only for attempt 1, which owns the reported measure whatever became
     * of it. It is a restatement of `attemptOrdinal === 1`, not a second
     * judgement, and it is never a score: the measure itself is projected by
     * `reportedFirstAttemptMeasure`, which returns no score for a first attempt
     * that was abandoned or is still open.
     */
    isReportedMeasure: z.boolean(),
    startedAt: IsoDate,
    submittedAt: IsoDate.nullable(),
    updatedAt: IsoDate,
  })
  .strict();
export type ChapterAssessmentAttempt = z.infer<
  typeof ChapterAssessmentAttemptSchema
>;

/**
 * The per-concept ledger of item ids this profile has already been served.
 * A shrinking retry must draw FRESH items, so selection subtracts this set
 * from the concept's authored reserve.
 */
export const AssessmentConceptLedgerSchema = z
  .object({
    conceptId: StableId,
    servedItemIds: z.array(StableId).max(512),
  })
  .strict();
export type AssessmentConceptLedger = z.infer<
  typeof AssessmentConceptLedgerSchema
>;

/**
 * An item's answer format. The capstone deliberately mixes released TEA items,
 * authored items, and open-ended ones, so the response row has to say which
 * kind of question was asked rather than assuming options existed.
 */
export const ASSESSMENT_ITEM_FORMATS = ["SELECTED_RESPONSE", "OPEN_RESPONSE"] as const;
export type AssessmentItemFormat = (typeof ASSESSMENT_ITEM_FORMATS)[number];

/**
 * One graded answer, and the durable record of what the student was asked.
 *
 * `itemFormat` is carried on the row rather than looked up, because the row
 * outlives any given version of the item bank.
 *
 * Both answer columns are nullable, and a null is a genuine blank — never a
 * sentinel option id. `selectedOptionId` null on a selected-response item means
 * the student left it empty; `responseRef` null on an open item means nothing
 * was submitted. Exactly one column is applicable per format, enforced below.
 *
 * `responseRef` is an opaque handle on the encrypted server-side response
 * record. It is never prose and never a transform of prose, so this row cannot
 * become a channel for student writing.
 *
 * `correct` is the binary verdict and is server-minted: for a selected response
 * from the answer key, for an open response from the grading service. There is
 * no partial credit anywhere in this model.
 */
export const ChapterAssessmentResponseSchema = z
  .object({
    attemptId: Uuid,
    itemId: StableId,
    conceptId: StableId,
    itemFormat: z.enum(ASSESSMENT_ITEM_FORMATS),
    selectedOptionId: StableId.nullable(),
    responseRef: StableId.nullable(),
    correct: z.boolean(),
    answeredAt: IsoDate,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.itemFormat === "SELECTED_RESPONSE" && value.responseRef !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["responseRef"],
        message: "a selected-response item has no open response handle",
      });
    }
    if (value.itemFormat === "OPEN_RESPONSE" && value.selectedOptionId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["selectedOptionId"],
        message: "an open-response item has no options to select",
      });
    }
    if (value.selectedOptionId === null && value.responseRef === null && value.correct) {
      ctx.addIssue({
        code: "custom",
        path: ["correct"],
        message: "a blank answer cannot be correct",
      });
    }
  });
export type ChapterAssessmentResponse = z.infer<
  typeof ChapterAssessmentResponseSchema
>;

// ---------------------------------------------------------------------------
// The server-minted ledger
// ---------------------------------------------------------------------------

export const PROGRESSION_LEDGER_KINDS = [
  "CHAPTER_STARTED",
  "CHAPTER_COMPLETED",
  "MODULE_COMPLETED",
  "MISSION_ATTEMPT_OPENED",
  "MISSION_XP_AWARDED",
  "MISSION_FAILED_PERMANENT",
  "LEVEL_GAINED",
  "RANK_GAINED",
  "ABILITY_UNLOCKED",
  "CODEX_CARD_LEARNED",
  "CODEX_CARD_PVP_LEGAL",
  "CONCEPT_MASTERED",
  "ASSESSMENT_ATTEMPT_OPENED",
  "ASSESSMENT_SUBMITTED",
  "ASSESSMENT_ATTEMPT_ABANDONED",
] as const;
export type ProgressionLedgerKind = (typeof PROGRESSION_LEDGER_KINDS)[number];

/**
 * Append-only, server-written record of every progression change and its
 * cause. Nothing mutates Rank, Level, or XP without a row here, which is what
 * makes an integrity audit possible after the fact.
 */
export const ProgressionLedgerEntrySchema = z
  .object({
    kind: z.enum(PROGRESSION_LEDGER_KINDS),
    chapterId: StableId,
    missionId: StableId.nullable(),
    attemptId: Uuid.nullable(),
    detail: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  })
  .strict();
export type ProgressionLedgerEntry = z.infer<typeof ProgressionLedgerEntrySchema>;

// ---------------------------------------------------------------------------
// Read projection
// ---------------------------------------------------------------------------

/** Values the server derives and the client only ever displays. */
export const ProgressionDerivedSchema = z
  .object({
    rank: z.number().int().min(STARTING_RANK),
    cumulativeLevels: z.number().int().nonnegative(),
    levelsToNextRank: z.number().int().positive(),
    level: z.number().int().nonnegative(),
    xp: z.number().int().nonnegative(),
    xpToNextLevel: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ProgressionDerived = z.infer<typeof ProgressionDerivedSchema>;

export const ProgressionSnapshotSchema = z
  .object({
    campaign: CampaignProgressionSchema,
    activeChapter: ChapterProgressionSchema,
    derived: ProgressionDerivedSchema,
    missions: z.array(MissionProgressSchema),
    openAttempt: MissionAttemptSchema.nullable(),
    codex: z.array(CodexCardStateSchema),
    chapterAbilities: z.array(ChapterAbilityUnlockSchema),
    pvpAbilities: z.array(PvpAbilityUnlockSchema),
    conceptMastery: z.array(ConceptMasterySchema),
  })
  .strict();
export type ProgressionSnapshot = z.infer<typeof ProgressionSnapshotSchema>;

// ---------------------------------------------------------------------------
// Requests — the client's entire writable surface
// ---------------------------------------------------------------------------

/**
 * Keys a client must never send, checked recursively. `.strict()` already
 * rejects unknown keys; this guard exists so a future author cannot quietly
 * add one of these to a progression request and reopen the cheat vector. It
 * mirrors `rejectRawResponseFields` in api.ts.
 */
const SERVER_AUTHORITATIVE_KEY =
  /^(xp|xpTotal|xpAwarded|awardedXp|xpFraction|xpMultiplier|multiplier|level|levels|levelsEarned|cumulativeLevels|rank|attemptOrdinal|attemptsUsed|verdict|grade|graded|score|passed|correct|mastered|masteredAt|pvpLegal|pvpLegalAt|bullets|bulletCount|unlockedAbilities|abilityUnlocks)$/i;

/**
 * Top-level fields whose CONTENTS the guard does not walk.
 *
 * Exactly one, and it is not a loophole. `committedEvents` is the duel's own
 * serialised commit log, carried through opaquely: the server stores it as
 * telemetry and derives nothing whatsoever from it — not the outcome, not the
 * award, not a bullet count. Its `VERDICT_COMMITTED` entries name a `verdict`
 * because the SERVER minted that verdict and the log is the record of having
 * done so, and the guard was refusing the server its own receipt. The cost was
 * real: rather than lose a student's clear, the client dropped the log.
 *
 * The exemption is the contents only. A `verdict` key sitting beside
 * `committedEvents` is still refused, because that one would be the client
 * asserting a verdict, which is the thing this guard exists for.
 */
const OPAQUE_TELEMETRY_FIELDS = new Set(["committedEvents"]);

function rejectServerAuthoritativeFields(
  value: unknown,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      rejectServerAuthoritativeFields(entry, [...path, index], ctx),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (SERVER_AUTHORITATIVE_KEY.test(key)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, key],
        message: "progression values are server-derived and may not be submitted",
      });
    }
    // Depth 0 only: the exemption belongs to the request body's own field, so
    // a nested object cannot buy itself out by naming a key `committedEvents`.
    if (path.length === 0 && OPAQUE_TELEMETRY_FIELDS.has(key)) continue;
    rejectServerAuthoritativeFields(entry, [...path, key], ctx);
  }
}

/** Applies the guard above to any progression request schema. */
function clientSafe<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return schema.superRefine((value, ctx) =>
    rejectServerAuthoritativeFields(value, [], ctx),
  );
}

/**
 * Completing the mandatory module.
 *
 * The gate is deck coverage, not elapsed time: the client reports which cues it
 * acknowledged and the server checks them against the authored deck. The three
 * minutes are an authoring target, so a student who reads faster is finished
 * and a student who reads slower is not being timed. `observedSeconds` is
 * recorded as educator-facing evidence and never gates anything.
 *
 * Note what is still absent: the attempt this opens. The server derives that
 * from attempts already resolved, so one module run can never arm two attempts.
 */
export const CompleteLearningModuleRequestSchema = clientSafe(
  z
    .object({
      chapterId: StableId,
      moduleId: StableId,
      gatesKind: z.enum(["MISSION_ATTEMPT", "ASSESSMENT_ATTEMPT"]),
      gatesId: StableId,
      acknowledgedCueIds: z.array(StableId).min(1).max(64),
      observedSeconds: z.number().int().nonnegative().max(86_400),
    })
    .strict(),
);
export type CompleteLearningModuleRequest = z.infer<
  typeof CompleteLearningModuleRequestSchema
>;

/**
 * Opening a mission attempt. Note what is absent: the attempt ordinal. The
 * server reads attempts already spent and assigns the next one, which is what
 * makes the XP fraction unforgeable.
 */
export const OpenMissionAttemptRequestSchema = clientSafe(
  z
    .object({
      chapterId: StableId,
      missionId: StableId,
    })
    .strict(),
);
export type OpenMissionAttemptRequest = z.infer<
  typeof OpenMissionAttemptRequestSchema
>;

/**
 * Committing a mission attempt's terminal outcome. The client asserts only
 * that the run ended and how; the server derives the ordinal's XP fraction,
 * the award, the new Level, the new Rank, and any ability unlock.
 */
export const CommitMissionOutcomeRequestSchema = clientSafe(
  z
    .object({
      attemptId: Uuid,
      outcome: z.enum(["CLEARED", "FAILED"]),
      committedEvents: z.array(z.unknown()).max(4096),
      baseRevision: z.number().int().nonnegative(),
    })
    .strict(),
);
export type CommitMissionOutcomeRequest = z.infer<
  typeof CommitMissionOutcomeRequestSchema
>;

/** Opening an assessment attempt. The server picks the form and the items. */
export const OpenChapterAssessmentRequestSchema = clientSafe(
  z
    .object({
      chapterId: StableId,
      assessmentId: StableId,
    })
    .strict(),
);
export type OpenChapterAssessmentRequest = z.infer<
  typeof OpenChapterAssessmentRequestSchema
>;

/**
 * Answering one item. `correct` is deliberately not part of this shape, in
 * either arm: a selected response is graded against the server's key, and an
 * open response is graded by the grading service, which the server reads by
 * handle. A null answer records a genuine blank.
 */
export const AnswerAssessmentItemRequestSchema = clientSafe(
  z.discriminatedUnion("itemFormat", [
    z
      .object({
        attemptId: Uuid,
        itemId: StableId,
        itemFormat: z.literal("SELECTED_RESPONSE"),
        selectedOptionId: StableId.nullable(),
      })
      .strict(),
    z
      .object({
        attemptId: Uuid,
        itemId: StableId,
        itemFormat: z.literal("OPEN_RESPONSE"),
        /** The handle the grading service issued. Never the prose itself. */
        responseRef: StableId.nullable(),
      })
      .strict(),
  ]),
);
export type AnswerAssessmentItemRequest = z.infer<
  typeof AnswerAssessmentItemRequestSchema
>;

/** Submitting the form. The server grades, decides passage, and mints cards. */
export const SubmitChapterAssessmentRequestSchema = clientSafe(
  z.object({ attemptId: Uuid }).strict(),
);
export type SubmitChapterAssessmentRequest = z.infer<
  typeof SubmitChapterAssessmentRequestSchema
>;

/**
 * Walking out of an attempt. It ends with no score, its items stay spent, and
 * if it was attempt 1 it keeps the reported measure rather than handing it to
 * the retry.
 */
export const ABANDON_ASSESSMENT_REASONS = [
  "WALKED_AWAY",
  "TIMED_OUT",
  "SUPERSEDED",
] as const;
export type AbandonAssessmentReason = (typeof ABANDON_ASSESSMENT_REASONS)[number];

export const AbandonChapterAssessmentRequestSchema = clientSafe(
  z
    .object({
      attemptId: Uuid,
      reason: z.enum(ABANDON_ASSESSMENT_REASONS),
    })
    .strict(),
);
export type AbandonChapterAssessmentRequest = z.infer<
  typeof AbandonChapterAssessmentRequestSchema
>;

export const PROGRESSION_ERRORS = [
  "MISSION_SPENT",
  "MISSION_LOCKED",
  "MODULE_REQUIRED",
  "ATTEMPT_ALREADY_OPEN",
  "ATTEMPT_NOT_FOUND",
  "ATTEMPT_CLOSED",
  "CHAPTER_NOT_ACTIVE",
  "ASSESSMENT_LOCKED",
  "ASSESSMENT_ITEMS_EXHAUSTED",
  "PROGRESSION_CONFLICT",
  /** An open response's handle has no graded verdict the server can read. */
  "VERDICT_UNAVAILABLE",
] as const;
export type ProgressionError = (typeof PROGRESSION_ERRORS)[number];
