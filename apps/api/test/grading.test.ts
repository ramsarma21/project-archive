import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { PresenterEventSchema } from "@pa/contracts";
import { openResponsePackage } from "@pa/runtime";
import {
  decryptResponseText,
  encryptResponseText,
  responseEncryptionAad,
} from "../src/grading/envelopeEncryption.js";
import {
  gradeFormativeResponse,
  resetGradingGuardsForTests,
} from "../src/grading/service.js";
import {
  RetryableProviderError,
  type GradingProvider,
} from "../src/grading/types.js";

process.env.GRADING_ENCRYPTION_KEY_BASE64 = crypto
  .randomBytes(32)
  .toString("base64");
process.env.GRADING_ENCRYPTION_KEY_VERSION = "test-v1";

test("envelope encryption binds ciphertext to profile and attempt", () => {
  const aad = responseEncryptionAad({
    profileId: "profile-a",
    attemptId: "attempt-a",
    promptId: "prompt-a",
  });
  const encrypted = encryptResponseText("private learner response", aad);
  assert.notEqual(
    encrypted.ciphertext.toString("utf8"),
    "private learner response",
  );
  assert.equal(
    decryptResponseText(encrypted, aad),
    "private learner response",
  );
  assert.throws(() =>
    decryptResponseText(
      encrypted,
      responseEncryptionAad({
        profileId: "profile-b",
        attemptId: "attempt-a",
        promptId: "prompt-a",
      }),
    ),
  );
});

test("grading retries once and strictly parses the observation", async () => {
  process.env.GRADING_ENABLED = "true";
  resetGradingGuardsForTests();
  const content = openResponsePackage(
    "BOS.ACT01.PROMPT.REVENUE_VS_MARKET",
  )!;
  let calls = 0;
  const provider: GradingProvider = {
    async classify() {
      calls += 1;
      if (calls === 1) throw new RetryableProviderError(429);
      return {
        schemaVersion: "0.1.0-draft",
        itemId: content.item.itemId,
        itemVersion: content.item.itemVersion,
        topicality: "ON_TOPIC",
        criteria: content.rubric.criteria.map((criterion) => ({
          criterionId: criterion.criterionId,
          level: "STRONG",
        })),
        citedEvidenceIds: [
          "BOS.ACT01.SRC.REVENUE_PROCLAMATION.v1.EV.1",
        ],
        technical: { confidence: "HIGH" },
      };
    },
  };
  const result = await gradeFormativeResponse(
    "profile-a",
    {
      responseText: "A sufficiently long private response for the provider.",
      prompt: content.prompt,
      rubric: content.rubric,
      sourceTexts: content.sourceTexts,
      itemId: content.item.itemId,
      itemVersion: content.item.itemVersion,
      allowedEvidenceIds: content.sourcePackets.flatMap((packet) =>
        packet.evidence.map((entry) => entry.evidenceId),
      ),
      requestHash: "same-idempotency-hash",
    },
    provider,
  );
  assert.equal(calls, 2);
  assert.equal(
    "topicality" in result.observation
      ? result.observation.topicality
      : null,
    "ON_TOPIC",
  );
});

test("save event schema rejects unknown and raw response fields", () => {
  assert.equal(
    PresenterEventSchema.safeParse({
      type: "FIELD_OPEN_RESPONSE_SUBMITTED",
      eventId: "e",
      interruptId: "i",
      promptId: "p",
      responseText: "must never enter a save",
      response: {},
      resolution: {},
    }).success,
    false,
  );
  assert.equal(
    PresenterEventSchema.safeParse({
      type: "CONTINUE",
      unexpected: true,
    }).success,
    false,
  );
});

