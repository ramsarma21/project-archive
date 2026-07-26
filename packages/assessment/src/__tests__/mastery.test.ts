import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chapterUnlockDecision,
  conceptIsPvpLegal,
  planCardPromotions,
  applyCardPromotions,
  pvpLegalCardIds,
} from "../index.js";
import type { CodexCardState } from "../protocol.js";
import {
  CHAPTER,
  answerAll,
  answerNone,
  cardIdFor,
  conceptId,
  makeFixture,
  masterOnly,
  newSession,
  sit,
} from "./harness.js";

// ---------------------------------------------------------------------------
// The 100% rule
// ---------------------------------------------------------------------------

test("a concept is mastered only at 100% of the items served for it", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const result = await sit(session, ({ indexInConcept }) =>
    // One of two right. The strict rule's whole point.
    indexInConcept === 0 ? "CORRECT" : "WRONG",
  );

  const entry = result.record.mastery.get(conceptId("ALPHA"));
  assert.equal(entry?.firstAttempt?.served, 2);
  assert.equal(entry?.firstAttempt?.correct, 1);
  assert.equal(entry?.mastered, false, "1 of 2 is not mastery");
});

test("both items right masters the concept", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const result = await sit(session, answerAll);

  const entry = result.record.mastery.get(conceptId("ALPHA"));
  assert.equal(entry?.mastered, true);
  assert.equal(entry?.masteredOnAttempt, 1);
  assert.equal(entry?.masteredWithRecycledItems, false);
});

test("an unanswered item counts against the concept, so skipping is never cheaper", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const result = await sit(session, ({ indexInConcept }) =>
    indexInConcept === 0 ? "CORRECT" : "SKIP",
  );

  const entry = result.record.mastery.get(conceptId("ALPHA"));
  assert.equal(entry?.firstAttempt?.served, 2);
  assert.equal(entry?.firstAttempt?.correct, 1);
  assert.equal(entry?.mastered, false);
});

test("a skipped item still gets a committed UNANSWERED verdict", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  await sit(session, () => "SKIP");

  const verdicts = session.events.filter(
    (event) => event.type === "VERDICT_COMMITTED",
  );
  assert.equal(verdicts.length, 2, "both blanks are written down, not inferred");
  for (const event of verdicts) {
    assert.equal(
      event.type === "VERDICT_COMMITTED" && event.verdict.source,
      "UNANSWERED",
    );
    assert.equal(event.type === "VERDICT_COMMITTED" && event.verdict.kind, "INCORRECT");
  }
});

// ---------------------------------------------------------------------------
// The awkward path: some concepts mastered, others not
// ---------------------------------------------------------------------------

test("a student masters some concepts and not others, and each is tracked separately", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA", "GAMMA", "DELTA"],
    reserve: 6,
  });
  const session = newSession(fixture);
  const result = await sit(session, masterOnly("ALPHA", "GAMMA"));

  assert.equal(result.record.mastery.get(conceptId("ALPHA"))?.mastered, true);
  assert.equal(result.record.mastery.get(conceptId("BETA"))?.mastered, false);
  assert.equal(result.record.mastery.get(conceptId("GAMMA"))?.mastered, true);
  assert.equal(result.record.mastery.get(conceptId("DELTA"))?.mastered, false);

  // Every concept still gets a row, so a partial result is fully described.
  assert.equal(result.record.mastery.size, 4);
  // Half the items right on half the concepts: 4 of 8.
  assert.equal(result.record.reportedScore?.numerator, 4);
  assert.equal(result.record.reportedScore?.denominator, 8);
});

test("partial mastery blocks the chapter and names exactly what is owed", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA", "GAMMA", "DELTA"],
    reserve: 6,
  });
  const session = newSession(fixture);
  const result = await sit(session, masterOnly("ALPHA", "GAMMA"));

  const decision = chapterUnlockDecision(result.record, fixture.blueprint);
  assert.equal(decision.kind, "BLOCKED");
  assert.equal(decision.kind === "BLOCKED" && decision.reason, "CONCEPTS_UNMASTERED");
  assert.deepEqual(
    decision.kind === "BLOCKED" ? [...decision.unmasteredConceptIds] : [],
    [conceptId("BETA"), conceptId("DELTA")],
  );
});

test("mastering everything unlocks the next chapter", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  const result = await sit(session, answerAll);

  assert.equal(result.record.passed, true);
  assert.ok(result.record.passedAt);
  assert.equal(
    chapterUnlockDecision(result.record, fixture.blueprint).kind,
    "UNLOCKED",
  );
});

test("failing every concept blocks the chapter and mints nothing", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  const result = await sit(session, answerNone);

  assert.equal(result.record.passed, false);
  assert.equal(result.record.pvpLegalCards.length, 0);
  assert.equal(result.record.reportedScore?.numerator, 0);
  assert.equal(result.record.reportedScore?.denominator, 4);
});

// ---------------------------------------------------------------------------
// The boundary: 100% on a concept mints its PvP-legal card
// ---------------------------------------------------------------------------

test("the card-minting boundary is exactly 100%: one wrong item mints nothing", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });

  const nearMiss = newSession(fixture);
  const missed = await sit(nearMiss, ({ conceptId: id, indexInConcept }) =>
    // ALPHA: both right. BETA: one right, one wrong — the boundary case.
    id === conceptId("ALPHA") || indexInConcept === 0 ? "CORRECT" : "WRONG",
  );

  assert.deepEqual(
    missed.record.pvpLegalCards.map((card) => card.cardId),
    [cardIdFor("ALPHA")],
    "only the fully mastered concept mints a card",
  );
  assert.equal(conceptIsPvpLegal(missed.record, conceptId("ALPHA")), true);
  assert.equal(
    conceptIsPvpLegal(missed.record, conceptId("BETA")),
    false,
    "one item short of 100% is not PvP-legal",
  );
});

test("a mastered concept with no authored card mints nothing and is still legal", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BETA"],
    reserve: 6,
    cardlessSlugs: ["BETA"],
  });
  const session = newSession(fixture);
  const result = await sit(session, answerAll);

  assert.equal(result.record.passed, true);
  assert.deepEqual(
    result.record.pvpLegalCards.map((card) => card.cardId),
    [cardIdFor("ALPHA")],
  );
  assert.equal(conceptIsPvpLegal(result.record, conceptId("BETA")), true);
});

// ---------------------------------------------------------------------------
// Promotion onto a real Codex
// ---------------------------------------------------------------------------

function learnedCard(slug: string): CodexCardState {
  return {
    profileId: "11111111-2222-4333-8444-555555555555",
    cardId: cardIdFor(slug),
    conceptId: conceptId(slug),
    learnedChapterId: CHAPTER,
    learnedAt: "2026-01-01T00:00:00.000Z",
    pvpLegalAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("mastery promotes a learned card to PvP-legal without touching learnedAt", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA", "BETA"], reserve: 6 });
  const session = newSession(fixture);
  const result = await sit(session, masterOnly("ALPHA"));

  const codex = [learnedCard("ALPHA"), learnedCard("BETA")];
  const plan = planCardPromotions(result.record.pvpLegalCards, codex);
  assert.deepEqual(
    plan.promotions.map((promotion) => promotion.cardId),
    [cardIdFor("ALPHA")],
  );

  const updated = applyCardPromotions(codex, plan);
  assert.deepEqual([...pvpLegalCardIds(updated)], [cardIdFor("ALPHA")]);

  const alpha = updated.find((card) => card.cardId === cardIdFor("ALPHA"));
  assert.equal(alpha?.learnedAt, "2026-01-01T00:00:00.000Z", "learnedAt is history");
  assert.equal(alpha?.learnedChapterId, CHAPTER);
  assert.ok(alpha?.pvpLegalAt);
});

test("a card the student never learned is refused rather than invented", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const result = await sit(session, answerAll);

  const plan = planCardPromotions(result.record.pvpLegalCards, []);
  assert.equal(plan.promotions.length, 0);
  assert.deepEqual(
    plan.refusals.map((refusal) => refusal.reason),
    ["CARD_NOT_LEARNED"],
  );
});

test("promotion is idempotent: an already-legal card is a no-op, not a rewrite", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  const result = await sit(session, answerAll);

  const already: CodexCardState = {
    ...learnedCard("ALPHA"),
    pvpLegalAt: "2026-05-05T00:00:00.000Z",
  };
  const plan = planCardPromotions(result.record.pvpLegalCards, [already]);
  assert.equal(plan.promotions.length, 0);
  assert.deepEqual(
    plan.refusals.map((refusal) => refusal.reason),
    ["ALREADY_PVP_LEGAL"],
  );

  const updated = applyCardPromotions([already], plan);
  assert.equal(updated[0]?.pvpLegalAt, "2026-05-05T00:00:00.000Z");
});
