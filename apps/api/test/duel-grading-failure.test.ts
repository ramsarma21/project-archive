// A grading OUTAGE grants the maximum — and says so. It must never look like a
// classifier that read the answer and agreed with it.
//
// This is the other half of the "always 14 7" investigation. The design grants
// CORRECT on a grading timeout on purpose (Mission-Slate §1.7: a student is never
// punished for infrastructure), so a wrong answer and a right one both pay 14
// balls while the classifier is unreachable. That is safe ONLY because the grant
// is MARKED: the verdict's `source` is GRADING_TIMEOUT rather than CLASSIFIER, the
// provenance names a fallback reason, and the health signal counts the round as
// ungraded and turns the endpoint UNGRADED. If a failure could produce an
// unmarked CLASSIFIER CORRECT, an outage would be indistinguishable from a class
// of geniuses and nobody would know grading had stopped — which is exactly the
// silent-success this asserts against.
//
// Offline by construction: the classifier credentials are removed so every
// gradeable round takes the fallback, which is the outage this is about.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { resetVerdictReceiptSecretCache } from "@pa/grading";

await import("../src/config.js");
delete process.env.TRUEFOUNDRY_API_KEY;
delete process.env.TRUEFOUNDRY_BASE_URL;
delete process.env.TRUEFOUNDRY_GRADING_API_KEY;
delete process.env.TRUEFOUNDRY_GRADING_BASE_URL;
process.env.GRADING_RECEIPT_SECRET = "test-secret-for-duel-grading-failure";
resetVerdictReceiptSecretCache();

const { createDuelGrading } = await import("../src/duels/grading.js");

const silent = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as FastifyBaseLogger;

const ITEM = "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1";

test("with no classifier, a graded round grants CORRECT but is MARKED as a fallback, never CLASSIFIER", async () => {
  const grading = createDuelGrading(silent);
  assert.equal(grading.health.configured, false, "the credential really is absent");

  const result = await grading.grade({
    profileId: "p",
    duelId: "D#duel@1",
    roundIndex: 1,
    itemId: ITEM,
    // A non-blank answer, so this is not the deterministic empty-box pre-check: it
    // is a round that WANTED the classifier and could not reach one.
    answer: "britain was in debt from the war and made us pay",
  });

  // The generous grant, as designed.
  assert.equal(result.envelope.kind, "CORRECT", "a grading outage grants the maximum");
  // …and MARKED. This is the whole point: a fallback is never source CLASSIFIER, so
  // "signed" (a valid receipt) and "graded" (a classifier read it) stay distinct.
  assert.notEqual(result.envelope.source, "CLASSIFIER");
  assert.equal(result.envelope.source, "GRADING_TIMEOUT");
  assert.equal(result.provenance.path, "FALLBACK");
  assert.notEqual(result.provenance.fallbackReason, null, "the round names why it was not graded");
});

test("the evidence gate DOES downgrade a fallback CORRECT with wrong cards — the card half is deterministic", async () => {
  const grading = createDuelGrading(silent);
  // Evidence explicitly unsatisfied during an outage. The card half is checked
  // deterministically and needs no model, so an outage is no reason to excuse it:
  // this folds to WRONG even though the prose was the generous grant. The source is
  // left as GRADING_TIMEOUT — only the kind changes — so the round is still not
  // counted as graded evidence of retrieval.
  const wrongCards = await grading.grade({
    profileId: "p",
    duelId: "D#duel@2",
    roundIndex: 1,
    itemId: ITEM,
    answer: "a real attempt at the answer",
    evidenceSatisfied: false,
  });
  assert.equal(wrongCards.envelope.kind, "WRONG", "wrong cards fail even in an outage");
  assert.equal(wrongCards.envelope.source, "GRADING_TIMEOUT", "still the marked grant, not a classifier read");

  // Right cards during the same outage: the PROSE half is still granted, so a student
  // who placed the deterministically-correct cards is not punished for infrastructure.
  const rightCards = await grading.grade({
    profileId: "p",
    duelId: "D#duel@2b",
    roundIndex: 1,
    itemId: ITEM,
    answer: "a real attempt at the answer",
    evidenceSatisfied: true,
  });
  assert.equal(rightCards.envelope.kind, "CORRECT", "right cards keep the prose grant");
  assert.equal(rightCards.envelope.source, "GRADING_TIMEOUT");
});

test("the health signal reports the outage rather than hiding it as OK", async () => {
  const grading = createDuelGrading(silent);
  for (let round = 1; round <= 6; round += 1) {
    await grading.grade({
      profileId: "p",
      duelId: "D#duel@3",
      roundIndex: round,
      itemId: ITEM,
      answer: "an answer the gateway never saw",
    });
  }
  const snapshot = grading.signal.snapshot();
  // No credential pins the status to UNGRADED, and nothing was classified — the
  // opposite of the green-and-silent outage this whole apparatus exists to expose.
  assert.equal(snapshot.configured, false);
  assert.equal(snapshot.status, "UNGRADED");
  assert.equal(snapshot.classifiedSinceBoot, 0, "not one round was decided by a classifier");
  assert.ok(snapshot.ungradedSinceBoot >= 6, "every gradeable round is counted as ungraded");
});

test("an empty answer is still an honest WRONG, decided without a classifier", async () => {
  const grading = createDuelGrading(silent);
  const result = await grading.grade({
    profileId: "p",
    duelId: "D#duel@4",
    roundIndex: 1,
    itemId: ITEM,
    answer: "",
  });
  // The deterministic pre-check: a blank box abstains and abstention is WRONG. This
  // is NOT a fallback — it is a real decision, so it must not be marked as a grant.
  assert.equal(result.envelope.kind, "WRONG");
  assert.equal(result.provenance.path, "PRE_CHECK");
});
