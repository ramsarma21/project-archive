import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blueprintReadiness,
  chapterUnlockDecision,
  conceptIsPvpLegal,
} from "../index.js";
import {
  answerAll,
  answerNone,
  cardIdFor,
  conceptId,
  decide,
  makeFixture,
  masterOnly,
  newSession,
  servedFor,
  sit,
} from "./harness.js";

// ---------------------------------------------------------------------------
// Recycling: the reserve runs out but the retry does not
// ---------------------------------------------------------------------------

test("a fourth attempt on a six-item reserve recycles rather than being refused", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 6 });
  const session = newSession(fixture);
  for (let i = 0; i < 3; i += 1) await sit(session, answerNone);

  const fourth = await sit(session, answerNone);
  assert.equal(fourth.attemptOrdinal, 4, "the student is never told to stop trying");

  const form = fourth.record.attempts[3]?.form[0];
  assert.equal(form?.itemIds.length, 2, "still a full form");
  assert.equal(form?.freshness, "FULL_RECYCLE");
  assert.equal(fourth.record.attempts[3]?.hadRecycledItems, true);
});

test("a partially exhausted reserve is labelled PARTIAL_RECYCLE, not silently reused", async () => {
  // Five items: attempts 1 and 2 spend four, leaving one fresh for attempt 3.
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 5 });
  const session = newSession(fixture);
  await sit(session, answerNone);
  await sit(session, answerNone);
  const third = await sit(session, answerNone);

  const form = third.record.attempts[2]?.form[0];
  assert.equal(form?.itemIds.length, 2);
  assert.equal(form?.freshness, "PARTIAL_RECYCLE");

  const selection = third.record.attempts[2];
  assert.equal(selection?.hadRecycledItems, true);
});

test("recycling reaches for the oldest exposure first", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 4 });
  const session = newSession(fixture);
  const first = await sit(session, answerNone);
  await sit(session, answerNone);

  const third = await sit(session, answerNone);
  const recycled = third.record.attempts[2]?.form[0]?.itemIds ?? [];
  assert.equal(recycled.length, 2);
  assert.deepEqual(
    [...recycled].sort(),
    [...first.servedItemIds].sort(),
    "attempt 1's items come back before attempt 2's — the widest gap available",
  );
});

test("mastery achieved on a recycled form is flagged as weaker evidence", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 2 });
  const session = newSession(fixture);
  await sit(session, answerNone);
  const second = await sit(session, answerAll);

  const entry = second.record.mastery.get(conceptId("ALPHA"));
  assert.equal(entry?.mastered, true, "the student did demonstrate it");
  assert.equal(
    entry?.masteredWithRecycledItems,
    true,
    "on items they had already seen, and the record says so",
  );
  assert.equal(
    conceptIsPvpLegal(second.record, conceptId("ALPHA")),
    true,
    "recycled evidence still counts; it is disclosed, not discounted",
  );
});

test("recording an item as served is idempotent, so a recycled item is not re-dated", async () => {
  const fixture = makeFixture({ slugs: ["ALPHA"], reserve: 2 });
  const session = newSession(fixture);
  await sit(session, answerNone);
  const second = await sit(session, answerNone);

  const served = servedFor(second.record, "ALPHA");
  assert.equal(served.length, 2, "two items served twice is still two items");
  assert.equal(new Set(served).size, 2);
});

// ---------------------------------------------------------------------------
// The hard floor: a concept the bank cannot ask at all
// ---------------------------------------------------------------------------

test("a concept with fewer items than one form is unassessable and is not served", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "THIN"],
    reserve: { ALPHA: 6, THIN: 1 },
  });
  const session = newSession(fixture);
  const result = await sit(session, answerAll);

  assert.deepEqual(
    [...result.record.unassessableConceptIds],
    [conceptId("THIN")],
  );
  const form = result.record.attempts[0]?.form ?? [];
  assert.equal(form.length, 1, "only the assessable concept is on the form");
  assert.equal(form[0]?.conceptId, conceptId("ALPHA"));
});

test("an unassessable concept does not block the chapter — that failure is ours", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "THIN"],
    reserve: { ALPHA: 6, THIN: 1 },
  });
  const session = newSession(fixture);
  const result = await sit(session, answerAll);

  const decision = chapterUnlockDecision(result.record, fixture.blueprint);
  assert.equal(decision.kind, "UNLOCKED");
  assert.deepEqual(
    decision.kind === "UNLOCKED"
      ? decision.contentGaps.map((gap) => gap.conceptId)
      : [],
    [conceptId("THIN")],
    "the student advances, and the gap is reported rather than implied away",
  );
});

test("but an unassessable concept mints no PvP-legal card", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "THIN"],
    reserve: { ALPHA: 6, THIN: 1 },
  });
  const session = newSession(fixture);
  const result = await sit(session, answerAll);

  assert.deepEqual(
    result.record.pvpLegalCards.map((card) => card.cardId),
    [cardIdFor("ALPHA")],
    "no evidence, no competitive standing",
  );
  assert.equal(conceptIsPvpLegal(result.record, conceptId("THIN")), false);
  assert.equal(result.record.mastery.get(conceptId("THIN"))?.mastered, false);
});

test("a chapter with nothing assessable is blocked rather than silently passed", async () => {
  const fixture = makeFixture({ slugs: ["THIN"], reserve: 1 });
  const session = newSession(fixture);

  // Blocked before an attempt can even open, because there is nothing to ask.
  const decision = decide(session);
  assert.equal(decision.kind, "BLOCKED");
  assert.equal(
    decision.kind === "BLOCKED" && decision.reason,
    "NO_ASSESSABLE_CONTENT",
  );
});

test("items refused as unusable are excluded from the reserve, not counted in it", async () => {
  const fixture = makeFixture({
    slugs: ["ALPHA", "BROKEN"],
    reserve: 6,
    unusableSlugs: ["BROKEN"],
  });

  assert.equal(fixture.bank.refused.length, 6);
  assert.equal(
    fixture.bank.refused.every((entry) =>
      entry.refusals.includes("NOT_USABLE_AS_IS"),
    ),
    true,
  );
  assert.equal(fixture.bank.eligibleForConcept(conceptId("BROKEN")).length, 0);

  const session = newSession(fixture);
  const result = await sit(session, answerAll);
  assert.deepEqual(
    [...result.record.unassessableConceptIds],
    [conceptId("BROKEN")],
  );
});

// ---------------------------------------------------------------------------
// Readiness: the content work list
// ---------------------------------------------------------------------------

test("readiness separates a ready concept from a thin one and an unassessable one", () => {
  const fixture = makeFixture({
    slugs: ["READY", "THIN", "GAP"],
    reserve: { READY: 6, THIN: 3, GAP: 1 },
    releasedTeaSlugs: ["READY"],
    openResponseSlugs: ["READY"],
  });
  const readiness = blueprintReadiness(fixture.blueprint, fixture.bank);

  const byId = new Map(
    readiness.byConcept.map((entry) => [entry.conceptId, entry]),
  );
  assert.equal(byId.get(conceptId("READY"))?.status, "READY");
  assert.equal(byId.get(conceptId("THIN"))?.status, "THIN");
  assert.equal(byId.get(conceptId("GAP"))?.status, "UNASSESSABLE");

  assert.equal(byId.get(conceptId("READY"))?.freshFormsAvailable, 3);
  assert.equal(byId.get(conceptId("THIN"))?.freshFormsAvailable, 1);
  assert.equal(byId.get(conceptId("GAP"))?.freshFormsAvailable, 0);

  assert.deepEqual([...readiness.unassessableConceptIds], [conceptId("GAP")]);
  assert.equal(readiness.formBuildable, false);
});

test("readiness reports a concept with no released TEA item and no open-ended item", () => {
  const fixture = makeFixture({
    slugs: ["AUTHORED_ONLY"],
    reserve: 6,
  });
  const readiness = blueprintReadiness(fixture.blueprint, fixture.bank);
  const entry = readiness.byConcept[0];

  assert.deepEqual(
    [...(entry?.findings ?? [])],
    ["NO_RELEASED_TEA_ITEM", "NO_OPEN_RESPONSE_ITEM", "UNTAGGED_PROBE"],
  );
  assert.equal(entry?.status, "READY", "a real gap, and not a blocking one");
  assert.equal(entry?.releasedTeaItems, 0);
  assert.equal(entry?.authoredItems, 6);
});

test("readiness distinguishes no items at all from every item refused", () => {
  const none = makeFixture({ slugs: ["EMPTY"], reserve: 0 });
  assert.deepEqual(
    [...(blueprintReadiness(none.blueprint, none.bank).byConcept[0]?.findings ?? [])],
    [
      "NO_ITEMS_AT_ALL",
      "INSUFFICIENT_FOR_ONE_FORM",
      "NO_RELEASED_TEA_ITEM",
      "NO_OPEN_RESPONSE_ITEM",
    ],
    "an empty concept reports no probe finding, because it has no items to tag",
  );

  const broken = makeFixture({
    slugs: ["BROKEN"],
    reserve: 6,
    unusableSlugs: ["BROKEN"],
  });
  assert.equal(
    blueprintReadiness(broken.blueprint, broken.bank).byConcept[0]?.findings.includes(
      "ALL_ITEMS_REFUSED",
    ),
    true,
  );
});

test("a thin reserve still reports RESERVE_BELOW_TARGET so the recycling is predicted", () => {
  const fixture = makeFixture({ slugs: ["THIN"], reserve: 3 });
  const entry = blueprintReadiness(fixture.blueprint, fixture.bank).byConcept[0];
  assert.equal(entry?.findings.includes("RESERVE_BELOW_TARGET"), true);
  assert.equal(entry?.findings.includes("INSUFFICIENT_FOR_ONE_FORM"), false);
});

// ---------------------------------------------------------------------------
// Combined: partial mastery AND an exhausted pool AND a content gap
// ---------------------------------------------------------------------------

test("a student can be repaired on a thin concept while a gap concept is never asked", async () => {
  const fixture = makeFixture({
    slugs: ["SOLID", "THIN", "GAP"],
    reserve: { SOLID: 6, THIN: 2, GAP: 0 },
  });
  const session = newSession(fixture);

  const first = await sit(session, masterOnly("SOLID"));
  assert.equal(first.record.passed, false);
  assert.equal(first.record.attempts[0]?.form.length, 2, "GAP is not on the form");

  // The retry narrows to THIN, whose two items are already spent, so it recycles.
  const retry = await sit(session, answerAll);
  assert.deepEqual(
    retry.decision.kind === "OPEN_ATTEMPT"
      ? [...retry.decision.scopedConceptIds]
      : [],
    [conceptId("THIN")],
  );
  assert.equal(retry.record.attempts[1]?.form[0]?.freshness, "FULL_RECYCLE");

  assert.equal(retry.record.passed, true);
  const unlock = chapterUnlockDecision(retry.record, fixture.blueprint);
  assert.equal(unlock.kind, "UNLOCKED");
  assert.deepEqual(
    unlock.kind === "UNLOCKED" ? unlock.contentGaps.map((gap) => gap.conceptId) : [],
    [conceptId("GAP")],
  );
  assert.deepEqual(
    retry.record.pvpLegalCards.map((card) => card.cardId).sort(),
    [cardIdFor("SOLID"), cardIdFor("THIN")].sort(),
    "GAP mints nothing; THIN mints on recycled but disclosed evidence",
  );
});
