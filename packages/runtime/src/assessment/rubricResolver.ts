import {
  CanonicalClassifierObservationSchema,
  ClassifiedObservationSchema,
  type ClassifierObservation,
  type DeterministicResolution,
  type OpenResponseOutcome,
  type OpenResponseRubric,
} from "@pa/contracts";

export interface RubricResolutionContext {
  itemId: string;
  itemVersion: string;
  allowedEvidenceIds: ReadonlySet<string>;
}

function fallbackFeedback(rubric: OpenResponseRubric): string {
  return (
    rubric.observationFeedback?.UNCLASSIFIED ??
    rubric.authoredFallbackFeedbackId
  );
}

export function unclassifiedResolution(
  rubric: OpenResponseRubric,
): DeterministicResolution {
  return {
    purpose: "FORMATIVE",
    status: "AUTHORED_FALLBACK",
    label: "UNCLASSIFIED",
    outcome: "UNCLASSIFIED",
    criterionIds: [],
    criterionLevels: [],
    evidenceIds: [],
    feedbackIds: [fallbackFeedback(rubric)],
    rubricId: rubric.rubricId,
    rubricVersion: rubric.version,
  };
}

function resolved(
  rubric: OpenResponseRubric,
  outcome: OpenResponseOutcome,
  feedbackId: string,
  input: {
    topicality: "ON_TOPIC" | "OFF_TOPIC" | "ABSTAINED";
    criterionLevels: {
      criterionId: string;
      level: "STRONG" | "PARTIAL" | "MISSING";
    }[];
    evidenceIds: string[];
    technicalConfidence: "LOW" | "MEDIUM" | "HIGH";
  },
): DeterministicResolution {
  return {
    purpose: "FORMATIVE",
    status:
      outcome === "UNCLASSIFIED"
        ? "AUTHORED_FALLBACK"
        : "FORMATIVE_CLASSIFIED",
    label: outcome,
    outcome,
    topicality: input.topicality,
    criterionIds: input.criterionLevels.map((entry) => entry.criterionId),
    criterionLevels: input.criterionLevels,
    evidenceIds: input.evidenceIds,
    feedbackIds: [feedbackId],
    technicalConfidence: input.technicalConfidence,
    rubricId: rubric.rubricId,
    rubricVersion: rubric.version,
  };
}

function resolveCanonical(
  rubric: OpenResponseRubric,
  rawObservation: unknown,
  context: RubricResolutionContext | undefined,
): DeterministicResolution | null {
  const parsed = CanonicalClassifierObservationSchema.safeParse(rawObservation);
  if (!parsed.success) return null;
  const observation = parsed.data;
  if (
    context &&
    (observation.itemId !== context.itemId ||
      observation.itemVersion !== context.itemVersion)
  ) {
    return unclassifiedResolution(rubric);
  }
  const requiredCriterionIds = rubric.criteria.map(
    (criterion) => criterion.criterionId,
  );
  const observedCriterionIds = observation.criteria.map(
    (criterion) => criterion.criterionId,
  );
  if (
    new Set(observedCriterionIds).size !== observedCriterionIds.length ||
    observedCriterionIds.length !== requiredCriterionIds.length ||
    requiredCriterionIds.some((id) => !observedCriterionIds.includes(id))
  ) {
    return unclassifiedResolution(rubric);
  }
  if (
    context &&
    observation.citedEvidenceIds.some(
      (evidenceId) => !context.allowedEvidenceIds.has(evidenceId),
    )
  ) {
    return unclassifiedResolution(rubric);
  }
  if (observation.topicality === "OFF_TOPIC") {
    const feedbackId = rubric.observationFeedback?.OFF_TOPIC;
    return feedbackId
      ? resolved(rubric, "OFF_TOPIC", feedbackId, {
          topicality: observation.topicality,
          criterionLevels: observation.criteria,
          evidenceIds: observation.citedEvidenceIds,
          technicalConfidence: observation.technical.confidence,
        })
      : unclassifiedResolution(rubric);
  }
  if (observation.topicality === "ABSTAINED") {
    const feedbackId = rubric.levelFeedback?.MISSING;
    return feedbackId
      ? resolved(rubric, "ABSTAINED", feedbackId, {
          topicality: observation.topicality,
          criterionLevels: observation.criteria,
          evidenceIds: observation.citedEvidenceIds,
          technicalConfidence: observation.technical.confidence,
        })
      : unclassifiedResolution(rubric);
  }
  if (observation.technical.confidence === "LOW") {
    return unclassifiedResolution(rubric);
  }
  const levels = observation.criteria.map((criterion) => criterion.level);
  const outcome: OpenResponseOutcome = levels.includes("MISSING")
    ? "NEEDS_SOURCE_REVISIT"
    : levels.includes("PARTIAL")
      ? "PARTIAL_RESPONSE"
      : "STRONG_RESPONSE";
  const feedbackId =
    outcome === "STRONG_RESPONSE"
      ? rubric.levelFeedback?.STRONG
      : outcome === "PARTIAL_RESPONSE"
        ? rubric.levelFeedback?.PARTIAL
        : rubric.levelFeedback?.MISSING;
  return feedbackId
    ? resolved(rubric, outcome, feedbackId, {
        topicality: observation.topicality,
        criterionLevels: observation.criteria,
        evidenceIds: observation.citedEvidenceIds,
        technicalConfidence: observation.technical.confidence,
      })
    : unclassifiedResolution(rubric);
}

function resolveLegacy(
  rubric: OpenResponseRubric,
  rawObservation: unknown,
): DeterministicResolution {
  const parsed = ClassifiedObservationSchema.safeParse(rawObservation);
  if (!parsed.success) return unclassifiedResolution(rubric);
  const observation = parsed.data;
  if (observation.confidence < rubric.minimumConfidence) {
    return unclassifiedResolution(rubric);
  }
  const outcome: OpenResponseOutcome =
    observation.label === "EVIDENCE_CONNECTED"
      ? "STRONG_RESPONSE"
      : observation.label === "PARTIAL_CONNECTION"
        ? "PARTIAL_RESPONSE"
        : "NEEDS_SOURCE_REVISIT";
  const feedbackId =
    outcome === "STRONG_RESPONSE"
      ? rubric.levelFeedback?.STRONG
      : outcome === "PARTIAL_RESPONSE"
        ? rubric.levelFeedback?.PARTIAL
        : rubric.levelFeedback?.MISSING;
  if (feedbackId) {
    return resolved(rubric, outcome, feedbackId, {
      topicality: "ON_TOPIC",
      criterionLevels: rubric.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        level:
          outcome === "STRONG_RESPONSE"
            ? "STRONG"
            : outcome === "PARTIAL_RESPONSE"
              ? "PARTIAL"
              : "MISSING",
      })),
      evidenceIds: observation.evidenceIds,
      technicalConfidence:
        observation.confidence >= 0.85 ? "HIGH" : "MEDIUM",
    });
  }

  // Compatibility for the two pre-package fixture rubrics.
  const legacyCriteria = new Map(
    rubric.criteria.map((criterion) => [criterion.criterionId, criterion]),
  );
  if (
    observation.criterionIds.some(
      (criterionId) => !legacyCriteria.has(criterionId),
    )
  ) {
    return unclassifiedResolution(rubric);
  }
  const feedbackIds = observation.criterionIds
    .map(
      (criterionId) =>
        legacyCriteria.get(criterionId)?.feedbackByLabel?.[observation.label],
    )
    .filter((value): value is string => Boolean(value));
  if (feedbackIds.length === 0) return unclassifiedResolution(rubric);
  return {
    purpose: "FORMATIVE",
    status: "FORMATIVE_CLASSIFIED",
    label: observation.label,
    criterionIds: observation.criterionIds,
    evidenceIds: observation.evidenceIds,
    feedbackIds: [...new Set(feedbackIds)],
    rubricId: rubric.rubricId,
    rubricVersion: rubric.version,
  };
}

/**
 * Pure boundary between untrusted provider output and authored feedback.
 * Technical confidence can only force abstention; it never contributes to
 * mastery, progression, learner state, relationships, routes, or clock.
 */
export function resolveRubricObservation(
  rubric: OpenResponseRubric,
  rawObservation: unknown,
  context?: RubricResolutionContext,
): DeterministicResolution {
  return (
    resolveCanonical(rubric, rawObservation, context) ??
    resolveLegacy(rubric, rawObservation)
  );
}

export function resolveClassifierResult(
  rubric: OpenResponseRubric,
  observation: ClassifierObservation,
  context?: RubricResolutionContext,
): DeterministicResolution {
  if ("status" in observation && observation.status === "UNCLASSIFIED") {
    return unclassifiedResolution(rubric);
  }
  return resolveRubricObservation(rubric, observation, context);
}

export function resolutionMatchesPackage(
  rubric: OpenResponseRubric,
  resolution: DeterministicResolution,
  options?: {
    /**
     * Chapter-supplied rubric ids from BEFORE the packaged-content era whose
     * stored resolutions remain acceptable on replay
     * (ChapterDefinition.assessment.legacyRubricIds).
     */
    legacyRubricIds?: readonly string[];
  },
): boolean {
  if (resolution.purpose !== "FORMATIVE") return false;
  if (
    resolution.rubricId !== rubric.rubricId ||
    resolution.rubricVersion !== rubric.version
  ) {
    return (
      !resolution.outcome &&
      (options?.legacyRubricIds ?? []).includes(resolution.rubricId) &&
      ["EVIDENCE_CONNECTED", "PARTIAL_CONNECTION", "NEEDS_SOURCE_REVISIT", "UNCLASSIFIED"].includes(
        resolution.label,
      )
    );
  }
  if (!resolution.outcome) {
    return ["EVIDENCE_CONNECTED", "PARTIAL_CONNECTION", "NEEDS_SOURCE_REVISIT", "UNCLASSIFIED"].includes(
      resolution.label,
    );
  }
  const feedbackId = resolution.feedbackIds[0];
  if (!feedbackId || resolution.feedbackIds.length !== 1) return false;
  if (resolution.outcome === "UNCLASSIFIED") {
    return (
      resolution.status === "AUTHORED_FALLBACK" &&
      feedbackId === fallbackFeedback(rubric)
    );
  }
  const expected =
    resolution.outcome === "STRONG_RESPONSE"
      ? rubric.levelFeedback?.STRONG
      : resolution.outcome === "PARTIAL_RESPONSE"
        ? rubric.levelFeedback?.PARTIAL
        : resolution.outcome === "NEEDS_SOURCE_REVISIT" ||
            resolution.outcome === "ABSTAINED"
          ? rubric.levelFeedback?.MISSING
          : rubric.observationFeedback?.OFF_TOPIC;
  if (feedbackId !== expected) return false;
  const expectedCriteria = new Set(
    rubric.criteria.map((criterion) => criterion.criterionId),
  );
  return (
    (resolution.criterionLevels ?? []).length === expectedCriteria.size &&
    (resolution.criterionLevels ?? []).every((criterion) =>
      expectedCriteria.has(criterion.criterionId),
    )
  );
}

