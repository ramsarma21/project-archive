import { z } from "zod";

export const OPEN_RESPONSE_PURPOSE = "FORMATIVE" as const;
export const OPEN_RESPONSE_OPERATIONS = [
  "COMPARE_SOURCES",
  "APPLY_CONCEPT",
  "HISTORICAL_PERSPECTIVE",
  "STRATEGY_JUSTIFICATION",
  "CAUSAL_SYNTHESIS",
] as const;
export const LEGACY_OPEN_RESPONSE_LABELS = [
  "EVIDENCE_CONNECTED",
  "PARTIAL_CONNECTION",
  "NEEDS_SOURCE_REVISIT",
  "UNCLASSIFIED",
] as const;
export const OPEN_RESPONSE_LABELS = LEGACY_OPEN_RESPONSE_LABELS;
export const OPEN_RESPONSE_OUTCOMES = [
  "STRONG_RESPONSE",
  "PARTIAL_RESPONSE",
  "NEEDS_SOURCE_REVISIT",
  "OFF_TOPIC",
  "ABSTAINED",
  "UNCLASSIFIED",
] as const;
export const CLASSIFIER_TOPICALITY = [
  "ON_TOPIC",
  "OFF_TOPIC",
  "ABSTAINED",
] as const;
export const CLASSIFIER_CRITERION_LEVELS = [
  "STRONG",
  "PARTIAL",
  "MISSING",
] as const;

export type OpenResponseOperation = (typeof OPEN_RESPONSE_OPERATIONS)[number];
export type OpenResponseLabel = (typeof OPEN_RESPONSE_LABELS)[number];
export type OpenResponseOutcome = (typeof OPEN_RESPONSE_OUTCOMES)[number];
export type ClassifierTopicality = (typeof CLASSIFIER_TOPICALITY)[number];
export type ClassifierCriterionLevel =
  (typeof CLASSIFIER_CRITERION_LEVELS)[number];

const StableId = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const IsoDate = z.string().datetime({ offset: true });

export const SourcePacketRefSchema = z
  .object({
    sourcePacketId: StableId,
    version: StableId,
    hash: Hash,
    sourceIds: z.array(StableId).min(1).max(8),
  })
  .strict();
export type SourcePacketRef = z.infer<typeof SourcePacketRefSchema>;

export const OpenResponsePromptSchema = z
  .object({
    promptId: StableId,
    version: StableId,
    hash: Hash,
    purpose: z.literal(OPEN_RESPONSE_PURPOSE),
    operation: z.enum(OPEN_RESPONSE_OPERATIONS),
    title: z.string().min(1).max(120),
    prompt: z.string().min(1).max(900),
    expectedWords: z
      .object({ min: z.number().int().min(1), max: z.number().int().max(250) })
      .strict(),
    responseChars: z
      .object({ min: z.number().int().min(1), max: z.number().int().max(4000) })
      .strict(),
    sourcePacket: SourcePacketRefSchema,
    rubricId: StableId,
    rubricVersion: StableId,
    rubricHash: Hash,
    authoredFallbackFeedbackId: StableId,
    approvalStatus: z.enum(["FIXTURE_NOT_SME_APPROVED", "SME_APPROVED"]),
    itemId: StableId.optional(),
    accessiblePrompt: z.string().min(1).max(900).optional(),
    reviewStatus: z
      .enum(["AUTHOR_DRAFT", "HISTORICAL_REVIEW_PENDING", "SME_APPROVED"])
      .optional(),
    prerequisites: z
      .object({
        sourcePacketIds: z.array(StableId),
        microConceptIds: z.array(StableId),
      })
      .strict()
      .optional(),
    placement: z
      .object({
        kinds: z.array(
          z.enum(["NPC", "ARCHIVE_CONNECTION", "SOURCE_REFLECTION"]),
        ),
        npcIds: z.array(StableId),
        archiveCardId: StableId.optional(),
      })
      .strict()
      .optional(),
    minSpacingInteractions: z.number().int().min(2).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.expectedWords.min > value.expectedWords.max) {
      ctx.addIssue({ code: "custom", message: "expectedWords min exceeds max" });
    }
    if (value.responseChars.min > value.responseChars.max) {
      ctx.addIssue({ code: "custom", message: "responseChars min exceeds max" });
    }
  });
export type OpenResponsePrompt = z.infer<typeof OpenResponsePromptSchema>;

export const RubricCriterionSchema = z
  .object({
    criterionId: StableId,
    label: z.string().min(1).max(120).optional(),
    descriptor: z.string().min(1).max(900).optional(),
    labels: z.array(z.enum(OPEN_RESPONSE_LABELS)).min(1).optional(),
    evidenceIds: z.array(StableId).min(1).optional(),
    feedbackByLabel: z
      .record(z.enum(OPEN_RESPONSE_LABELS), StableId)
      .refine((value) => Object.keys(value).length > 0)
      .optional(),
  })
  .strict();

export const OpenResponseRubricSchema = z
  .object({
    rubricId: StableId,
    version: StableId,
    hash: Hash,
    purpose: z.literal(OPEN_RESPONSE_PURPOSE),
    minimumConfidence: z.number().min(0).max(1),
    criteria: z.array(RubricCriterionSchema).min(1).max(8),
    authoredFallbackFeedbackId: StableId,
    operation: z.enum(OPEN_RESPONSE_OPERATIONS).optional(),
    levelFeedback: z
      .object({
        STRONG: StableId,
        PARTIAL: StableId,
        MISSING: StableId,
      })
      .strict()
      .optional(),
    observationFeedback: z
      .object({
        OFF_TOPIC: StableId,
        UNCLASSIFIED: StableId,
      })
      .strict()
      .optional(),
  })
  .strict();
export type OpenResponseRubric = z.infer<typeof OpenResponseRubricSchema>;

export const CanonicalClassifierObservationSchema = z
  .object({
    schemaVersion: StableId,
    itemId: StableId,
    itemVersion: StableId,
    topicality: z.enum(CLASSIFIER_TOPICALITY),
    criteria: z
      .array(
        z
          .object({
            criterionId: StableId,
            level: z.enum(CLASSIFIER_CRITERION_LEVELS),
          })
          .strict(),
      )
      .max(8),
    citedEvidenceIds: z.array(StableId).max(32),
    technical: z
      .object({
        confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
      })
      .strict(),
  })
  .strict();
export type CanonicalClassifierObservation = z.infer<
  typeof CanonicalClassifierObservationSchema
>;

export const ClassifiedObservationSchema = z
  .object({
    status: z.literal("CLASSIFIED"),
    label: z.enum(OPEN_RESPONSE_LABELS).exclude(["UNCLASSIFIED"]),
    criterionIds: z.array(StableId).min(1).max(8),
    evidenceIds: z.array(StableId).max(16),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const UnclassifiedObservationSchema = z
  .object({
    status: z.literal("UNCLASSIFIED"),
    reason: z.enum([
      "DISABLED",
      "OFFLINE",
      "POLICY",
      "PROVIDER",
      "TIMEOUT",
      "RATE_LIMIT",
      "MALFORMED",
      "UNKNOWN_VALUE",
      "LOW_CONFIDENCE",
      "LATE",
    ]),
  })
  .strict();

export const ClassifierObservationSchema = z.discriminatedUnion("status", [
  ClassifiedObservationSchema,
  UnclassifiedObservationSchema,
]).or(CanonicalClassifierObservationSchema);
export type ClassifierObservation = z.infer<typeof ClassifierObservationSchema>;

export const DeterministicResolutionSchema = z
  .object({
    purpose: z.literal(OPEN_RESPONSE_PURPOSE),
    status: z.enum(["FORMATIVE_CLASSIFIED", "AUTHORED_FALLBACK"]),
    label: z.union([
      z.enum(OPEN_RESPONSE_LABELS),
      z.enum(OPEN_RESPONSE_OUTCOMES),
    ]),
    outcome: z.enum(OPEN_RESPONSE_OUTCOMES).optional(),
    topicality: z.enum(CLASSIFIER_TOPICALITY).optional(),
    criterionLevels: z
      .array(
        z
          .object({
            criterionId: StableId,
            level: z.enum(CLASSIFIER_CRITERION_LEVELS),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    technicalConfidence: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    criterionIds: z.array(StableId).max(8),
    evidenceIds: z.array(StableId).max(16),
    feedbackIds: z.array(StableId).min(1).max(8),
    rubricId: StableId,
    rubricVersion: StableId,
  })
  .strict();
export type DeterministicResolution = z.infer<typeof DeterministicResolutionSchema>;

export const OpenResponseReferenceSchema = z
  .object({
    responseId: StableId,
    attemptId: StableId,
    promptId: StableId,
    promptVersion: StableId,
    submittedAt: IsoDate,
    storage: z.enum(["ENCRYPTED_SERVER", "LOCAL_EPHEMERAL"]),
  })
  .strict();
export type OpenResponseReference = z.infer<typeof OpenResponseReferenceSchema>;

export const OpenResponseAdministrationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("OFFERED"),
      promptId: StableId,
      eligibleAtInteraction: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("STARTED"),
      promptId: StableId,
      interruptId: StableId,
      startedAtInteraction: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("SUBMITTED"),
      promptId: StableId,
      interruptId: StableId,
      response: OpenResponseReferenceSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("RESOLVED"),
      promptId: StableId,
      response: OpenResponseReferenceSchema,
      resolution: DeterministicResolutionSchema,
    })
    .strict(),
]);
export type OpenResponseAdministration = z.infer<
  typeof OpenResponseAdministrationSchema
>;

export const SubmitOpenResponseRequestSchema = z
  .object({
    promptId: StableId,
    promptVersion: StableId,
    responseText: z.string().min(1).max(4000),
    idempotencyKey: StableId,
    consent: z
      .object({
        granted: z.literal(true),
        policyVersion: StableId,
        retainedForEducatorReview: z.literal(true),
        retentionDays: z.number().int().min(1).max(365),
      })
      .strict(),
  })
  .strict();
export type SubmitOpenResponseRequest = z.infer<
  typeof SubmitOpenResponseRequestSchema
>;

export const SubmitOpenResponseResponseSchema = z
  .object({
    response: OpenResponseReferenceSchema,
    observation: ClassifierObservationSchema,
    resolution: DeterministicResolutionSchema,
  })
  .strict();
export type SubmitOpenResponseResponse = z.infer<
  typeof SubmitOpenResponseResponseSchema
>;

export interface FormativeEvidenceRecord {
  response: OpenResponseReference;
  resolution: DeterministicResolution;
}

export interface AuthoredNpcFollowupView {
  nodeId: string;
  npcId: string;
  name: string;
  openingLines: readonly string[];
  options: readonly {
    optionId: string;
    text: string;
    reply: string;
    leadsToPromptId?: string;
  }[];
}

export interface ArchiveConnectionView {
  cardId: string;
  title: string;
  body: string;
  citations: readonly string[];
  artifactRefs: readonly string[];
  linkedPromptId: string;
}

