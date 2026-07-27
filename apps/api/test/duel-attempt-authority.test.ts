// The boss duel is bound to the player's OWN open attempt, and the first answer is
// final.
//
// Before this, the route authenticated a profile and then trusted whatever
// duelId/itemId/conceptId the body carried, and it re-graded a round on every POST.
// So a student could point the round at an easier bank item, and could resubmit a
// changed answer until the server said CORRECT. These tests drive the route with an
// injected session, attempt resolver and verdict store — no database — and assert
// the two properties that close both holes:
//
//   * the graded item is the one the ROUND asks (server-selected from the stored
//     attempt), never the one the client claims; and
//   * a {profile, duel, round} grades exactly once — a changed second answer, a
//     racer, a reload all get the first stored verdict and receipt back.
//
// Offline by design, like duel-verdict.test.ts: with no classifier a non-blank
// answer is granted (CORRECT) and a blank abstains (WRONG), which is enough to make
// "honest CORRECT and honest WRONG" deterministic without a model credential.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { FastifyBaseLogger } from "fastify";
import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  type VerdictKind,
} from "@pa/duel";
import { resetVerdictReceiptSecretCache } from "@pa/grading";
import {
  M1_DUEL_ITEMS,
  duelItemCodexCardIds,
  m1DuelId,
  m1ExpectedDuelCardIds,
  m1ExpectedDuelItem,
} from "@pa/mission-m1";

await import("../src/config.js");
delete process.env.TRUEFOUNDRY_API_KEY;
delete process.env.TRUEFOUNDRY_BASE_URL;
delete process.env.TRUEFOUNDRY_GRADING_API_KEY;
delete process.env.TRUEFOUNDRY_GRADING_BASE_URL;
process.env.GRADING_RECEIPT_SECRET = "test-secret-for-duel-attempt-authority";
process.env.CSRF_SECRET = "test-secret-for-duel-attempt-csrf";
resetVerdictReceiptSecretCache();

const { createDuelGrading } = await import("../src/duels/grading.js");
const { registerDuelRoutes } = await import("../src/routes/duels.js");
const { inMemoryDuelVerdictStore } = await import("../src/duels/verdictStore.js");
const { csrfTokenForSession } = await import("../src/auth.js");

const silent = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as FastifyBaseLogger;

const SEED_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const ALICE = "alice";
const BOB = "bob";
const NOBODY = "nobody";

// Alice's own open attempt (ordinal 1). Bob's is a different ordinal, so Bob's
// canonical duel id is not Alice's.
const attempts: Record<string, {
  attemptId: string;
  attemptOrdinal: number;
  attemptSeedHex: string;
  missionId: string;
  chapterId: string;
} | null> = {
  [ALICE]: {
    attemptId: "att-alice",
    attemptOrdinal: 1,
    attemptSeedHex: SEED_HEX,
    missionId: "PA.SEA01.CH02.BOSTON.MD01",
    chapterId: "boston-1765",
  },
  [BOB]: {
    attemptId: "att-bob",
    attemptOrdinal: 2,
    attemptSeedHex: "b".repeat(32),
    missionId: "PA.SEA01.CH02.BOSTON.MD01",
    chapterId: "boston-1765",
  },
  [NOBODY]: null,
};

const CANONICAL_ALICE = m1DuelId(1);
const EXPECTED_ROUND_1 = m1ExpectedDuelItem({
  attemptSeedHex: SEED_HEX,
  attemptOrdinal: 1,
  round: 1,
}).item.itemId;
// A real bank item that is NOT what round 1 asks — the "forged easier item".
const FORGED_ITEM =
  M1_DUEL_ITEMS.find((item) => item.itemId !== EXPECTED_ROUND_1)!.itemId;

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  return app;
}

async function harness() {
  const app = buildApp();
  await app.register(cookie);
  const grading = createDuelGrading(silent);
  await registerDuelRoutes(app, {
    grading,
    authenticate: async (sid) => (sid ? { profileId: sid } : null),
    resolveAttempt: async (profileId) => attempts[profileId] ?? null,
    questionAuthority: {
      duelId: (attempt) => m1DuelId(attempt.attemptOrdinal),
      expectedItemId: (attempt, round) =>
        m1ExpectedDuelItem({
          attemptSeedHex: attempt.attemptSeedHex,
          attemptOrdinal: attempt.attemptOrdinal,
          round,
        }).item.itemId,
    },
    verdictStore: inMemoryDuelVerdictStore(),
  });
  await app.ready();
  return { app, grading };
}

function post(
  app: FastifyInstance,
  sid: string,
  duelId: string,
  round: number,
  body: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: `/v1/duels/${encodeURIComponent(duelId)}/rounds/${round}/verdict`,
    headers: {
      "x-pa-csrf-token": csrfTokenForSession(sid),
      "content-type": "application/json",
    },
    cookies: { pa_session: sid },
    payload: body,
  });
}

function answerBody(itemId: string, answer: string): Record<string, unknown> {
  return {
    side: "A",
    itemId,
    itemVersion: "v1",
    conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
    answer,
  };
}

test("a forged easier item cannot change the item that is graded", async () => {
  const { app } = await harness();
  try {
    // Alice claims a DIFFERENT bank item than round 1 asks, and answers it.
    const res = await post(app, ALICE, CANONICAL_ALICE, 1, answerBody(FORGED_ITEM, "war debt"));
    assert.equal(res.statusCode, 200, res.body);
    // The verdict is for the item the ROUND asks, not the forged claim.
    assert.equal(res.json().itemId, EXPECTED_ROUND_1);
    assert.notEqual(res.json().itemId, FORGED_ITEM);
  } finally {
    await app.close();
  }
});

test("a request body cannot supply or alter the round's Codex cards", async () => {
  const { app } = await harness();
  try {
    // The server owns the round's cards, keyed off its own selected item — a pure
    // function of the stored attempt, identical to the authored item's cards.
    const roundInput = { attemptSeedHex: SEED_HEX, attemptOrdinal: 1, round: 1 };
    const serverCards = m1ExpectedDuelCardIds(roundInput);
    assert.ok(serverCards.length > 0, "the round draws on at least one card");
    assert.deepEqual(
      [...serverCards],
      [...duelItemCodexCardIds(EXPECTED_ROUND_1)],
      "server cards are exactly the selected item's authored cards",
    );

    // A body that tries to name its own cards is refused outright: the verdict
    // request is an allowlist, so a forged card claim is never read, let alone
    // honoured. It cannot inject, add, or replace a card.
    const forged = await post(app, ALICE, CANONICAL_ALICE, 1, {
      ...answerBody(EXPECTED_ROUND_1, "war debt"),
      codexCardIds: ["BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1"],
    });
    assert.equal(forged.statusCode, 400, forged.body);
    assert.equal(forged.json().reason, "UNKNOWN_FIELD");

    // And nothing about the forgery attempt changed what the server resolves.
    assert.deepEqual([...m1ExpectedDuelCardIds(roundInput)], [...serverCards]);
  } finally {
    await app.close();
  }
});

test("a changed second answer cannot re-grade the round", async () => {
  const { app } = await harness();
  try {
    // First answer is blank -> WRONG.
    const first = await post(app, ALICE, CANONICAL_ALICE, 1, answerBody(EXPECTED_ROUND_1, ""));
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().kind, "WRONG");
    const firstReceipt = first.headers["x-pa-verdict-receipt"];
    assert.ok(firstReceipt, "the first mint carried a receipt");

    // Second answer is a real one that would grade CORRECT — but the round is spent.
    const second = await post(
      app,
      ALICE,
      CANONICAL_ALICE,
      1,
      answerBody(EXPECTED_ROUND_1, "Britain owed war debt and made the colonies pay."),
    );
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().kind, "WRONG", "the first verdict stands");
    assert.deepEqual(second.json(), first.json(), "identical envelope");
    assert.equal(
      second.headers["x-pa-verdict-receipt"],
      firstReceipt,
      "and the identical receipt",
    );
  } finally {
    await app.close();
  }
});

test("concurrent submissions converge on one stored envelope and receipt", async () => {
  const { app } = await harness();
  try {
    const [a, b] = await Promise.all([
      post(app, ALICE, CANONICAL_ALICE, 3, answerBody(EXPECTED_ROUND_1, "an answer")),
      post(app, ALICE, CANONICAL_ALICE, 3, answerBody(EXPECTED_ROUND_1, "")),
    ]);
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    assert.deepEqual(a.json(), b.json(), "both racers see the same envelope");
    assert.equal(
      a.headers["x-pa-verdict-receipt"],
      b.headers["x-pa-verdict-receipt"],
      "and the same receipt",
    );
  } finally {
    await app.close();
  }
});

test("a non-open, wrong-profile or noncanonical duel cannot obtain an attempt-bound verdict", async () => {
  const { app } = await harness();
  try {
    // No open attempt: refused, and no receipt to carry to a commit.
    const none = await post(app, NOBODY, CANONICAL_ALICE, 1, answerBody(EXPECTED_ROUND_1, "x"));
    assert.equal(none.statusCode, 409);
    assert.equal(none.json().error, "NO_OPEN_ATTEMPT");
    assert.equal(none.headers["x-pa-verdict-receipt"], undefined);

    // Bob (a different attempt/ordinal) cannot grade Alice's duel: her duel id is
    // not his attempt's canonical one.
    const bob = await post(app, BOB, CANONICAL_ALICE, 1, answerBody(EXPECTED_ROUND_1, "x"));
    assert.equal(bob.statusCode, 409);
    assert.equal(bob.json().error, "DUEL_NOT_CANONICAL");
    assert.equal(bob.headers["x-pa-verdict-receipt"], undefined);

    // A made-up duel id is refused for the same reason.
    const forgedDuel = await post(app, ALICE, "NOT.A.REAL#duel@1", 1, answerBody(EXPECTED_ROUND_1, "x"));
    assert.equal(forgedDuel.statusCode, 409);
    assert.equal(forgedDuel.json().error, "DUEL_NOT_CANONICAL");
    assert.equal(forgedDuel.headers["x-pa-verdict-receipt"], undefined);
  } finally {
    await app.close();
  }
});

test("honest CORRECT and WRONG still drive the 14/7 economy, and the receipt verifies at commit", async () => {
  const { app, grading } = await harness();
  try {
    // The bullet economy is keyed off `kind` by the duel reducer: 14 for CORRECT,
    // 7 for WRONG. This route decides the kind, so proving it yields both honest
    // kinds proves it still drives that economy.
    const economy: Record<VerdictKind, number> = {
      CORRECT: BULLETS_FOR_CORRECT,
      WRONG: BULLETS_FOR_WRONG,
    };
    assert.equal(economy.CORRECT, 14);
    assert.equal(economy.WRONG, 7);

    const correct = await post(app, ALICE, CANONICAL_ALICE, 5, answerBody(EXPECTED_ROUND_1, "a real answer"));
    assert.equal(correct.json().kind, "CORRECT");
    const wrong = await post(app, ALICE, CANONICAL_ALICE, 6, answerBody(EXPECTED_ROUND_1, ""));
    assert.equal(wrong.json().kind, "WRONG");

    // The stored receipt verifies against the same binding the commit path uses:
    // {profileId, attemptId: canonicalDuelId, roundIndex}.
    const receipt = correct.headers["x-pa-verdict-receipt"] as string;
    const envelope = {
      kind: correct.json().kind,
      itemId: correct.json().itemId,
      itemVersion: correct.json().itemVersion,
      source: correct.json().source,
      responseRef: correct.json().responseRef,
    };
    assert.equal(
      grading.verifyReceipt(
        envelope,
        { profileId: ALICE, attemptId: CANONICAL_ALICE, roundIndex: 5 },
        receipt,
      ),
      true,
    );
  } finally {
    await app.close();
  }
});
