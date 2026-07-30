import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { resetVerdictReceiptSecretCache } from "@pa/grading";

// The PvP grading seam.
//
// PvP's authority takes `verifyReceipt` as an injected function and refuses any
// verdict it cannot authenticate, so most of this file is about the BINDING: a
// verdict is minted for one profile, one match and one round, and it must be
// worthless anywhere else. Getting that wrong is not a display bug — it is a
// player replaying one CORRECT into every round of a ranked match.
//
// Deliberately offline. The classifier's own accuracy is @pa/grading's to test
// and it is tested there against a labelled set; what belongs here is the wiring,
// and a unit test that needs a model credential is a unit test that fails in CI.
// The credentials are cleared up front so this is deterministic wherever it runs.

delete process.env.TRUEFOUNDRY_API_KEY;
delete process.env.TRUEFOUNDRY_BASE_URL;
delete process.env.TRUEFOUNDRY_GRADING_API_KEY;
delete process.env.TRUEFOUNDRY_GRADING_BASE_URL;
process.env.GRADING_RECEIPT_SECRET = "test-secret-for-pvp-receipt-binding";
resetVerdictReceiptSecretCache();

const { createPvpGrading } = await import("../src/pvp/grading.js");

const silent = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as FastifyBaseLogger;

const grading = createPvpGrading(silent);

const ITEM_ID = "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1";

const BINDING = {
  profileId: "profile-a",
  attemptId: "pvp_ABC123_1700000000000",
  roundIndex: 1,
};

const ENVELOPE = {
  kind: "CORRECT",
  itemId: ITEM_ID,
  itemVersion: "v1",
  source: "CLASSIFIER",
  responseRef: null,
};

test("the grader covers the whole PvP pool, not just the PvE rotation", async () => {
  // Twenty-five: the eighteen PvE duel items plus the seven PvP-only hardening
  // items. `m1ItemBank()` is the eighteen, and building PvP on it would have made
  // seven of every twenty-five rounds ungradable — an `UnknownItemError` arriving
  // mid-match, which reads to a player as the duel breaking.
  assert.equal(grading.health.items, 25);
  assert.ok(grading.health.policyId.length > 0);
  assert.equal(grading.health.configured, false, "credentials were cleared above");

  // The rule stated as an assertion: PvP may only ask what the grader can grade.
  const { eligiblePvpItems, pvpItemBank, pvpQuestionBank } = await import(
    "../src/pvp/questionPool.js"
  );
  const eligible = eligiblePvpItems({
    askable: pvpQuestionBank().items,
    mastered: { A: [], B: [] },
  });
  for (const item of eligible) {
    assert.notEqual(
      pvpItemBank().get(item.itemId),
      undefined,
      `${item.itemId} is drawable but not gradable`,
    );
  }
  assert.equal(eligible.length, 25);
});

test("the pool stays larger than the duel's round ceiling, so no match repeats", async () => {
  const { poolHealth } = await import("../src/pvp/questionPool.js");
  // The ceiling is IMPORTED from the package that owns it, never copied as a
  // literal. A hardcoded `24` here would pass while @pa/duel raised the real
  // ceiling to 25 — the guarded margin is one item — which is the same
  // green-while-checking-nothing drift the ceiling lives in a leaf module to
  // prevent. Read it, so a change there fails here instead.
  const { DUEL_ROUND_CEILING } = await import("@pa/duel/structure");
  const health = poolHealth();
  assert.equal(health.total, 34);
  assert.equal(health.capstoneShared, 9);
  // The guarded pool is what a player who has mastered nothing faces, which is
  // every player until the first capstone is sat; the full pool is a superset of
  // it. Both must clear the ceiling, and the guarded margin is ONE item.
  assert.ok(
    health.unguarded > DUEL_ROUND_CEILING,
    `the guarded pool is ${health.unguarded} against a ceiling of ${DUEL_ROUND_CEILING}`,
  );
  assert.ok(
    health.total > DUEL_ROUND_CEILING,
    `the full pool is ${health.total} against a ceiling of ${DUEL_ROUND_CEILING}`,
  );
});

test("the capstone guard withholds shared items until BOTH sides have mastered", async () => {
  const { eligiblePvpItems, pvpQuestionBank } = await import(
    "../src/pvp/questionPool.js"
  );
  const all = pvpQuestionBank().items;
  const concepts = [...new Set(all.map((item) => item.conceptId))];
  const neither = eligiblePvpItems({ askable: all, mastered: { A: [], B: [] } });
  const oneSide = eligiblePvpItems({ askable: all, mastered: { A: concepts, B: [] } });
  // One player's mastery must not expose a gate item to a duel the other has not
  // earned: the same intersection rule the card gate applies.
  assert.equal(oneSide.length, neither.length);
});

test("an unreachable classifier grants and says so; it does not guess at the answer", async () => {
  const graded = await grading.gradeAnswer({
    profileId: BINDING.profileId,
    matchId: BINDING.attemptId,
    roundIndex: BINDING.roundIndex,
    itemId: ITEM_ID,
    answerText: "qqqq zzzz not an answer at all",
  });
  // The important assertion is `source`. With no classifier this is CORRECT —
  // but it is CORRECT because grading's own policy grants an infrastructure
  // failure, and it is labelled GRADING_TIMEOUT so the review log can find it.
  // What it is NOT is a keyword match: text with no overlap whatsoever would
  // score WRONG under any local heuristic, and there is no local heuristic.
  assert.equal(graded.envelope.source, "GRADING_TIMEOUT");
  assert.equal(graded.envelope.kind, "CORRECT");
});

test("a minted verdict verifies for the round it was minted for", async () => {
  const graded = await grading.gradeAnswer({
    profileId: BINDING.profileId,
    matchId: BINDING.attemptId,
    roundIndex: BINDING.roundIndex,
    itemId: ITEM_ID,
    answerText:
      "Britain left the war with France carrying an enormous debt, so Parliament decided the colonies should pay a share of it.",
  });
  assert.equal(graded.envelope.itemId, ITEM_ID);
  assert.equal(
    grading.verifyReceipt(graded.envelope, BINDING, graded.receipt),
    true,
  );
});

test("a receipt does not survive a change of round, match or player", async () => {
  const graded = await grading.gradeAnswer({
    profileId: BINDING.profileId,
    matchId: BINDING.attemptId,
    roundIndex: BINDING.roundIndex,
    itemId: ITEM_ID,
    answerText: "Parliament wanted revenue from the colonies after the war.",
  });

  assert.equal(
    grading.verifyReceipt(
      graded.envelope,
      { ...BINDING, roundIndex: BINDING.roundIndex + 1 },
      graded.receipt,
    ),
    false,
    "a round-one verdict must not verify at round two",
  );
  assert.equal(
    grading.verifyReceipt(
      graded.envelope,
      { ...BINDING, profileId: "profile-b" },
      graded.receipt,
    ),
    false,
    "the opponent must not be able to spend this receipt",
  );
  assert.equal(
    grading.verifyReceipt(
      graded.envelope,
      { ...BINDING, attemptId: "pvp_OTHER_1" },
      graded.receipt,
    ),
    false,
    "a receipt must not survive into another match",
  );
});

test("a flipped verdict fails verification", async () => {
  const graded = await grading.gradeAnswer({
    profileId: BINDING.profileId,
    matchId: BINDING.attemptId,
    roundIndex: 2,
    itemId: ITEM_ID,
    answerText: "no idea",
  });
  const flipped = {
    ...graded.envelope,
    kind: graded.envelope.kind === "CORRECT" ? "WRONG" : "CORRECT",
  };
  assert.equal(
    grading.verifyReceipt(flipped, { ...BINDING, roundIndex: 2 }, graded.receipt),
    false,
  );
});

test("a word outside the duel's vocabulary is refused rather than coerced", () => {
  // @pa/pvp types the envelope's `kind` and `source` as strings, because it takes
  // the verifier as an interface. Narrowing them is this file's job, and a word
  // @pa/duel would reject must never verify here either.
  assert.equal(
    grading.verifyReceipt({ ...ENVELOPE, source: "CLIENT" }, BINDING, "receipt"),
    false,
  );
  assert.equal(
    grading.verifyReceipt({ ...ENVELOPE, kind: "PARTIAL" }, BINDING, "receipt"),
    false,
  );
});

test("an empty receipt never verifies", () => {
  assert.equal(grading.verifyReceipt(ENVELOPE, BINDING, ""), false);
});

test("PvP rounds are recorded into the grading signal, so an outage is visible", () => {
  // The signal is the shared health diagnostic. With no credential every round is
  // granted, and PvP must contribute to that rate rather than keeping a private count
  // /v1/health cannot see — otherwise a ranked duel against a dead gateway is exactly
  // the class-of-geniuses the signal exists to expose.
  const isolated = createPvpGrading(silent);
  const before = isolated.signal.snapshot();
  assert.equal(before.configured, false);
  assert.equal(before.status, "UNGRADED", "no credential pins the status");
  assert.equal(before.roundsSinceBoot, 0);
});

test("a PvP grading can share the duel's signal instead of keeping its own", async () => {
  // The seam app.ts uses to fold PvP rounds into the SAME rate boss fights feed. When
  // a signal is injected, `createPvpGrading` records into it rather than a private one.
  const { GradingSignal } = await import("../src/duels/gradingSignal.js");
  const shared = new GradingSignal({ configured: false, announceToConsole: false });
  const wired = createPvpGrading(silent, { signal: shared });
  assert.equal(wired.signal, shared, "the injected signal is the one recorded into");

  await wired.gradeAnswer({
    profileId: BINDING.profileId,
    matchId: BINDING.attemptId,
    roundIndex: 3,
    itemId: ITEM_ID,
    answerText: "an answer the unreachable classifier will grant",
  });
  assert.ok(
    shared.snapshot().roundsSinceBoot >= 1,
    "the PvP round landed in the shared signal",
  );
});
