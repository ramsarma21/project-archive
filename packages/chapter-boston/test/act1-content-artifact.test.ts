import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  ACT1_OPEN_RESPONSE_CONTENT,
  ACT1_OPEN_RESPONSE_CONTENT_HASHES,
} from "../src/generated/act1OpenResponseContent.generated.js";
import {
  ACT1_OPEN_RESPONSE_EXPOSURE_CAP,
  archiveConnections,
  eligibleArchiveConnections,
  eligibleOpenResponses,
  npcFollowups,
  openResponsePackages,
  validateAct1OpenResponseArtifact,
} from "../src/openResponse.js";
import { compileFieldVocabulary, initialFieldState } from "@pa/runtime";
import { BOSTON_1765_CHAPTER } from "../src/chapter.js";
import { eligibleNpcFollowupsForField } from "../src/day1/reactive.js";
import { HISTORICAL_SOURCE_REGISTRY } from "../src/provenance.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

test("generated artifact exactly matches every package source hash", () => {
  const files = {
    manifest: "package.manifest.json",
    allowlists: "allowlists.json",
    sources: "sources/sources.json",
    items: "prompts/open-response-items.json",
    rubrics: "rubrics/rubrics.json",
    feedback: "feedback/feedback.json",
    classifier: "classifier/classifier-schema.json",
    archiveConnections: "archive/connections.json",
    npcFollowups: "dialogue/npc-followups.json",
  } as const;
  for (const [key, relativePath] of Object.entries(files)) {
    const raw = readFileSync(
      join(repositoryRoot, "content/boston/act1", relativePath),
      "utf8",
    );
    assert.equal(
      ACT1_OPEN_RESPONSE_CONTENT_HASHES[
        key as keyof typeof ACT1_OPEN_RESPONSE_CONTENT_HASHES
      ],
      `sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`,
      `${relativePath} changed without regenerating the typed artifact`,
    );
  }
});

test("all twelve prompts enforce prerequisites, spacing, draft gate and cap four", () => {
  const packages = openResponsePackages({ allowAuthorDraft: true });
  assert.equal(ACT1_OPEN_RESPONSE_EXPOSURE_CAP, 4);
  for (const entry of packages) {
    const latestEvidence = 7;
    const sourceInteractions = Object.fromEntries(
      entry.requiredSourcePacketIds.map((sourceId, index) => [
        sourceId,
        latestEvidence - index,
      ]),
    );
    const common = {
      sourceInteractions,
      engagedMicroConceptIds: new Set(entry.requiredMicroConceptIds),
      completedPromptIds: new Set<string>(),
      actCompletionCount: 0,
      allowAuthorDraft: true,
    };
    assert.equal(
      eligibleOpenResponses({
        ...common,
        currentInteractionOrdinal:
          latestEvidence + entry.minimumSpacingInteractions - 1,
      }).some((prompt) => prompt.promptId === entry.prompt.promptId),
      false,
      `${entry.item.itemId} appeared without full spacing`,
    );
    assert.equal(
      eligibleOpenResponses({
        ...common,
        currentInteractionOrdinal:
          latestEvidence + entry.minimumSpacingInteractions,
      }).some((prompt) => prompt.promptId === entry.prompt.promptId),
      true,
      `${entry.item.itemId} did not become eligible`,
    );
  }
  const fullyEngagedSources = Object.fromEntries(
    packages.flatMap((entry) =>
      entry.requiredSourcePacketIds.map((sourceId) => [sourceId, 1]),
    ),
  );
  const allMicros = new Set(
    packages.flatMap((entry) => entry.requiredMicroConceptIds),
  );
  assert.equal(
    eligibleOpenResponses({
      sourceInteractions: fullyEngagedSources,
      engagedMicroConceptIds: allMicros,
      currentInteractionOrdinal: 20,
      completedPromptIds: new Set(),
      actCompletionCount: 4,
      allowAuthorDraft: true,
    }).length,
    0,
  );
  assert.equal(
    eligibleOpenResponses({
      sourceInteractions: fullyEngagedSources,
      engagedMicroConceptIds: allMicros,
      currentInteractionOrdinal: 20,
      completedPromptIds: new Set(),
      actCompletionCount: 0,
      allowAuthorDraft: false,
    }).length,
    0,
  );
});

test("all six NPC followups and five Archive cards use source gates", () => {
  const world = BOSTON_1765_CHAPTER.content.createInitialWorldState();
  const field = initialFieldState(
    world,
    compileFieldVocabulary(BOSTON_1765_CHAPTER.fieldVocabulary),
  );
  const requiredSources = new Set(
    npcFollowups({ allowAuthorDraft: true }).flatMap((node) => [
      ...node.gate.completedSources,
      ...("anyOf" in node.gate ? node.gate.anyOf : []),
    ]),
  );
  let ordinal = 1;
  for (const sourcePacketId of requiredSources) {
    field.sourceEngagements[sourcePacketId] = {
      recordId: sourcePacketId,
      sourcePacketId,
      backingSourceId: sourcePacketId,
      interactionOrdinal: ordinal++,
      contentPackageHash: "sha256:test",
      reviewStatus: "HISTORICAL_REVIEW_PENDING",
    };
  }
  assert.equal(eligibleNpcFollowupsForField(field).length, 6);
  assert.equal(
    eligibleArchiveConnections({
      engagedSourcePacketIds: new Set(
        archiveConnections({ allowAuthorDraft: true }).flatMap((card) => [
          ...card.unlock.sourcePacketIds,
          ...("anyOf" in card.unlock ? card.unlock.anyOf : []),
        ]),
      ),
      allowAuthorDraft: true,
    }).length,
    5,
  );
});

test("artifact exposes the complete author-draft package behind explicit opt-in", () => {
  assert.deepEqual(validateAct1OpenResponseArtifact().counts, {
    items: 12,
    sources: 13,
    rubrics: 5,
    feedback: 17,
    connections: 5,
    followups: 6,
  });
  assert.equal(openResponsePackages().length, 0);
  assert.equal(
    openResponsePackages({ allowAuthorDraft: true }).length,
    12,
  );
  assert.equal(
    new Set(
      openResponsePackages({ allowAuthorDraft: true }).map(
        (entry) => entry.prompt.operation,
      ),
    ).has("CAUSAL_SYNTHESIS"),
    true,
  );
});

test("non-importation remains representative with its dating warning", () => {
  const source =
    HISTORICAL_SOURCE_REGISTRY[
      "BOS.ACT01.SRC.NONIMPORTATION_AGREEMENT.v1"
    ]!;
  assert.equal(source.claimTypes.includes("REPRESENTATIVE"), true);
  assert.equal(
    source.warnings.some(
      (warning) =>
        warning.includes("DATING FLAG") &&
        warning.includes("1765"),
    ),
    true,
  );
  assert.equal(
    ACT1_OPEN_RESPONSE_CONTENT.manifest.status,
    "AUTHOR_DRAFT",
  );
});

