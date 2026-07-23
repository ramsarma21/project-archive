import {
  OpenResponsePromptSchema,
  OpenResponseRubricSchema,
  type DeterministicResolution,
  type FormativeEvidenceRecord,
  type OpenResponseOperation,
  type OpenResponsePrompt,
  type OpenResponseRubric,
} from "@pa/contracts";
import {
  ACT1_OPEN_RESPONSE_CONTENT,
  ACT1_OPEN_RESPONSE_CONTENT_HASHES,
  ACT1_OPEN_RESPONSE_RECORD_HASHES,
} from "../content/generated/act1OpenResponseContent.generated.js";
import { unclassifiedResolution } from "./rubricResolver.js";

const content = ACT1_OPEN_RESPONSE_CONTENT;

export const ACT1_OPEN_RESPONSE_PACKAGE_ID = content.manifest.packageId;
export const ACT1_OPEN_RESPONSE_PACKAGE_VERSION =
  content.manifest.packageVersion;
export const ACT1_OPEN_RESPONSE_PACKAGE_HASH =
  ACT1_OPEN_RESPONSE_CONTENT_HASHES.package;
export const ACT1_OPEN_RESPONSE_EXPOSURE_CAP =
  content.manifest.act1ExposureCap;
export const ACT1_OPEN_RESPONSE_STATUS = content.manifest.status;
export const ACT1_CLASSIFIER_SCHEMA_ID =
  content.classifier.classifierSchemaId;
export const ACT1_CLASSIFIER_SCHEMA_VERSION =
  content.classifier.classifierSchemaVersion;
export const ACT1_CLASSIFIER_SCHEMA_HASH =
  ACT1_OPEN_RESPONSE_RECORD_HASHES.classifier[
    content.classifier
      .classifierSchemaId as keyof typeof ACT1_OPEN_RESPONSE_RECORD_HASHES.classifier
  ];

export type Act1SourcePacket = (typeof content.sources.packets)[number];
export type Act1OpenResponseItem = (typeof content.items.items)[number];
export type Act1ArchiveConnection =
  (typeof content.archiveConnections.cards)[number];
export type Act1NpcFollowup = (typeof content.npcFollowups.followups)[number];

export interface OpenResponsePackage {
  prompt: OpenResponsePrompt;
  rubric: OpenResponseRubric;
  item: Act1OpenResponseItem;
  sourcePackets: readonly Act1SourcePacket[];
  sourceTexts: Readonly<Record<string, string>>;
  requiredSourcePacketIds: readonly string[];
  requiredMicroConceptIds: readonly string[];
  minimumSpacingInteractions: number;
  actId: "BOS.ACT01";
  authorDraft: true;
}

export interface OpenResponseContentAccess {
  allowAuthorDraft?: boolean;
}

const OPERATION_MAP: Readonly<
  Record<Act1OpenResponseItem["reasoningOperation"], OpenResponseOperation>
> = {
  COMPARE: "COMPARE_SOURCES",
  TRANSFER: "APPLY_CONCEPT",
  PERSPECTIVE: "HISTORICAL_PERSPECTIVE",
  STRATEGY: "STRATEGY_JUSTIFICATION",
  CAUSAL_SYNTHESIS: "CAUSAL_SYNTHESIS",
};

const sourceById = new Map<string, Act1SourcePacket>(
  content.sources.packets.map((packet) => [packet.packetId, packet]),
);
const rawRubricById = new Map<string, (typeof content.rubrics.rubrics)[number]>(
  content.rubrics.rubrics.map((rubric) => [rubric.rubricId, rubric]),
);
const feedbackById = new Map(
  content.feedback.entries.map((entry) => [entry.feedbackId, entry]),
);

function aggregateSourceHash(item: Act1OpenResponseItem): `sha256:${string}` {
  // The generated item hash covers the exact source-packet ID list and all
  // cited claim/evidence IDs, so it is the immutable aggregate packet hash.
  return ACT1_OPEN_RESPONSE_RECORD_HASHES.items[
    item.itemId as keyof typeof ACT1_OPEN_RESPONSE_RECORD_HASHES.items
  ];
}

function buildRubric(item: Act1OpenResponseItem): OpenResponseRubric {
  const raw = rawRubricById.get(item.rubricId);
  if (!raw) throw new Error(`OPEN_RESPONSE_CONTENT_INVALID: ${item.rubricId}`);
  return OpenResponseRubricSchema.parse({
    rubricId: raw.rubricId,
    version: content.rubrics.rubricSetVersion,
    hash:
      ACT1_OPEN_RESPONSE_RECORD_HASHES.rubrics[
        raw.rubricId as keyof typeof ACT1_OPEN_RESPONSE_RECORD_HASHES.rubrics
      ],
    purpose: "FORMATIVE",
    minimumConfidence: 0.72,
    operation: OPERATION_MAP[raw.reasoningOperation],
    criteria: raw.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      label: criterion.label,
      descriptor: criterion.descriptor,
    })),
    levelFeedback: raw.levelFeedback,
    observationFeedback: raw.observationFeedback,
    authoredFallbackFeedbackId: raw.observationFeedback.UNCLASSIFIED,
  });
}

function buildPrompt(item: Act1OpenResponseItem): OpenResponsePrompt {
  const rubric = buildRubric(item);
  return OpenResponsePromptSchema.parse({
    promptId: item.promptId,
    itemId: item.itemId,
    version: item.itemVersion,
    hash:
      ACT1_OPEN_RESPONSE_RECORD_HASHES.items[
        item.itemId as keyof typeof ACT1_OPEN_RESPONSE_RECORD_HASHES.items
      ],
    purpose: "FORMATIVE",
    operation: OPERATION_MAP[item.reasoningOperation],
    title: item.studentPrompt.split(/[.?!:]/, 1)[0]!.slice(0, 120),
    prompt: item.studentPrompt,
    accessiblePrompt: item.accessiblePrompt,
    expectedWords: item.expectedResponseWords,
    responseChars: { min: 8, max: 1_200 },
    sourcePacket: {
      sourcePacketId: `${item.itemId}.SOURCES`,
      version: content.sources.registryVersion,
      hash: aggregateSourceHash(item),
      sourceIds: [...item.sourcePacketIds],
    },
    rubricId: rubric.rubricId,
    rubricVersion: rubric.version,
    rubricHash: rubric.hash,
    authoredFallbackFeedbackId: item.offlineFallback.feedbackId,
    approvalStatus: "FIXTURE_NOT_SME_APPROVED",
    reviewStatus: "AUTHOR_DRAFT",
    prerequisites: {
      sourcePacketIds: [...item.prerequisites.sourcePacketIds],
      microConceptIds: [...item.prerequisites.microConceptIds],
    },
    placement: {
      kinds: [...item.placement.kinds],
      npcIds: [...item.placement.npcIds],
      archiveCardId:
        "archiveCardId" in item.placement
          ? item.placement.archiveCardId
          : undefined,
    },
    minSpacingInteractions: item.minSpacingInteractions,
  });
}

const PACKAGES: readonly OpenResponsePackage[] = content.items.items.map(
  (item) => {
    const sourcePackets = item.sourcePacketIds.map((packetId) => {
      const packet = sourceById.get(packetId);
      if (!packet) {
        throw new Error(
          `OPEN_RESPONSE_CONTENT_INVALID: unknown source ${packetId}`,
        );
      }
      return packet;
    });
    return {
      prompt: buildPrompt(item),
      rubric: buildRubric(item),
      item,
      sourcePackets,
      sourceTexts: Object.fromEntries(
        sourcePackets.map((packet) => [
          packet.packetId,
          packet.reviewedParaphrase,
        ]),
      ),
      requiredSourcePacketIds: [...item.prerequisites.sourcePacketIds],
      requiredMicroConceptIds: [...item.prerequisites.microConceptIds],
      minimumSpacingInteractions: item.minSpacingInteractions,
      actId: "BOS.ACT01",
      authorDraft: true,
    };
  },
);

const packageByIdentifier = new Map<string, OpenResponsePackage>();
for (const entry of PACKAGES) {
  packageByIdentifier.set(entry.prompt.promptId, entry);
  packageByIdentifier.set(entry.item.itemId, entry);
}
for (const [legacyId, promptId] of Object.entries({
  "BOS.ACT01.OPEN.COMPARE_REVENUE_EFFECTS.v1":
    "BOS.ACT01.PROMPT.REVENUE_VS_MARKET",
  "BOS.ACT01.OPEN.RIDER_ROUTE_STRATEGY.v1":
    "BOS.ACT01.PROMPT.RIDER_ROUTE_STRATEGY",
})) {
  const target = packageByIdentifier.get(promptId);
  if (target) packageByIdentifier.set(legacyId, target);
}

const backingRefToPacketIds = new Map<string, string[]>();
for (const packet of content.sources.packets) {
  for (const backingRef of packet.backingRefs) {
    const ids = backingRefToPacketIds.get(backingRef) ?? [];
    if (!ids.includes(packet.packetId)) ids.push(packet.packetId);
    backingRefToPacketIds.set(backingRef, ids);
  }
}

export const OPEN_RESPONSE_FEEDBACK: Readonly<Record<string, string>> =
  Object.fromEntries(
    content.feedback.entries.map((entry) => [entry.feedbackId, entry.text]),
  );

export function openResponsePackages(
  access: OpenResponseContentAccess = {},
): readonly OpenResponsePackage[] {
  return access.allowAuthorDraft ? PACKAGES : [];
}

export function openResponsePackage(
  identifier: string,
  access: OpenResponseContentAccess = { allowAuthorDraft: true },
): OpenResponsePackage | undefined {
  if (!access.allowAuthorDraft) return undefined;
  return packageByIdentifier.get(identifier);
}

export function authoredFeedback(feedbackId: string): string | undefined {
  return feedbackById.get(
    feedbackId as (typeof content.feedback.entries)[number]["feedbackId"],
  )?.text;
}

export function authoredFallbackForPrompt(
  promptId: string,
): DeterministicResolution {
  const entry = openResponsePackage(promptId);
  if (!entry) throw new Error(`OPEN_RESPONSE_INVALID: unknown prompt ${promptId}`);
  return unclassifiedResolution(entry.rubric);
}

export function sourcePacketIdsForFieldSource(
  sourceId: string,
): readonly string[] {
  if (sourceById.has(sourceId)) return [sourceId];
  return backingRefToPacketIds.get(sourceId) ?? [];
}

export function sourcePacket(packetId: string): Act1SourcePacket | undefined {
  return sourceById.get(
    packetId as (typeof content.sources.packets)[number]["packetId"],
  );
}

export function archiveConnections(
  access: OpenResponseContentAccess = {},
): readonly Act1ArchiveConnection[] {
  return access.allowAuthorDraft ? content.archiveConnections.cards : [];
}

export function npcFollowups(
  access: OpenResponseContentAccess = {},
): readonly Act1NpcFollowup[] {
  return access.allowAuthorDraft ? content.npcFollowups.followups : [];
}

export interface OpenResponseEligibilityInput {
  sourceInteractions: Readonly<Record<string, number>>;
  engagedMicroConceptIds?: ReadonlySet<string>;
  currentInteractionOrdinal: number;
  completedPromptIds: ReadonlySet<string>;
  actCompletionCount: number;
  maxActResponses?: number;
  allowAuthorDraft?: boolean;
}

export function eligibleOpenResponses(
  input: OpenResponseEligibilityInput,
): OpenResponsePrompt[] {
  if (!input.allowAuthorDraft) return [];
  const cap = input.maxActResponses ?? ACT1_OPEN_RESPONSE_EXPOSURE_CAP;
  if (input.actCompletionCount >= cap) return [];
  return PACKAGES.filter((entry) => {
    if (
      input.completedPromptIds.has(entry.prompt.promptId) ||
      input.completedPromptIds.has(entry.item.itemId)
    ) {
      return false;
    }
    const sourceOrdinals = entry.requiredSourcePacketIds.map(
      (sourceId) => input.sourceInteractions[sourceId],
    );
    if (sourceOrdinals.some((ordinal) => !Number.isInteger(ordinal))) {
      return false;
    }
    if (
      input.engagedMicroConceptIds &&
      entry.requiredMicroConceptIds.some(
        (microId) => !input.engagedMicroConceptIds!.has(microId),
      )
    ) {
      return false;
    }
    const latestEvidence = Math.max(...(sourceOrdinals as number[]));
    return (
      input.currentInteractionOrdinal - latestEvidence >=
      entry.minimumSpacingInteractions
    );
  }).map((entry) => entry.prompt);
}

export function eligibleArchiveConnections(input: {
  engagedSourcePacketIds: ReadonlySet<string>;
  allowAuthorDraft?: boolean;
}): readonly Act1ArchiveConnection[] {
  if (!input.allowAuthorDraft) return [];
  return content.archiveConnections.cards.filter((card) => {
    const all = card.unlock.sourcePacketIds.every((sourceId) =>
      input.engagedSourcePacketIds.has(sourceId),
    );
    const any =
      !("anyOf" in card.unlock) ||
      card.unlock.anyOf.some((sourceId) =>
        input.engagedSourcePacketIds.has(sourceId),
      );
    return all && any;
  });
}

export function formativeEvidence(
  records: readonly FormativeEvidenceRecord[],
): readonly FormativeEvidenceRecord[] {
  return records.map((record) => structuredClone(record));
}

export function validateAct1OpenResponseArtifact(): {
  packageHash: string;
  counts: {
    items: number;
    sources: number;
    rubrics: number;
    feedback: number;
    connections: number;
    followups: number;
  };
} {
  if (
    content.manifest.status !== "AUTHOR_DRAFT" ||
    content.sources.status !== "HISTORICAL_REVIEW_PENDING"
  ) {
    throw new Error("OPEN_RESPONSE_CONTENT_INVALID: unsafe approval state");
  }
  if (
    content.items.act1ExposureCap !== content.manifest.act1ExposureCap ||
    content.manifest.act1ExposureCap !== 4
  ) {
    throw new Error("OPEN_RESPONSE_CONTENT_INVALID: exposure cap mismatch");
  }
  for (const entry of PACKAGES) {
    OpenResponsePromptSchema.parse(entry.prompt);
    OpenResponseRubricSchema.parse(entry.rubric);
    for (const feedbackId of Object.values(entry.item.feedbackIds)) {
      if (!feedbackById.has(feedbackId)) {
        throw new Error(
          `OPEN_RESPONSE_CONTENT_INVALID: unknown feedback ${feedbackId}`,
        );
      }
    }
  }
  return {
    packageHash: ACT1_OPEN_RESPONSE_PACKAGE_HASH,
    counts: {
      items: PACKAGES.length,
      sources: content.sources.packets.length,
      rubrics: content.rubrics.rubrics.length,
      feedback: content.feedback.entries.length,
      connections: content.archiveConnections.cards.length,
      followups: content.npcFollowups.followups.length,
    },
  };
}

