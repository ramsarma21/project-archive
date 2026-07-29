// The evidence gate: the second half of a duel answer.
//
// A duel answer is now prose AND the Codex cards placed to support it. These tests
// cover the three pieces that decide the second half and how it combines with the
// first:
//
//   * `parseSelectedCardIds` — lenient: a malformed body is "no cards placed", never a
//     rejection, because a 4xx on the duel wire pays the client the full magazine;
//   * `evaluateEvidence` — the full matrix: offered/unoffered, duplicate, unauthorized,
//     insufficient, an incompatible decoy, multiple valid groups, missing, too many;
//   * `combineWithEvidence` — prose AND evidence, and the rule that a GENEROUS GRANT
//     (an outage) is never downgraded no matter what was placed.
//
// Then the boss-duel route is driven end to end with a fake CLASSIFIER grader (the
// offline grader only ever grants, so it cannot exercise a downgrade): prose+evidence
// both pass, prose passes but evidence fails, evidence passes but prose fails, and —
// the persistence property — a first answer's cards are final, so a changed second
// submission cannot alter the verdict or the recorded selection.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { FastifyBaseLogger } from "fastify";
import {
  m1EvidencePolicy,
  M1_CODEX_CARD_IDS,
  type EvidencePolicy,
} from "@pa/mission-m1";
import {
  mintVerdictReceipt,
  resetVerdictReceiptSecretCache,
  verdictReceiptSecret,
  type VerdictEnvelope,
} from "@pa/grading";

await import("../src/config.js");
delete process.env.TRUEFOUNDRY_API_KEY;
delete process.env.TRUEFOUNDRY_BASE_URL;
delete process.env.TRUEFOUNDRY_GRADING_API_KEY;
delete process.env.TRUEFOUNDRY_GRADING_BASE_URL;
process.env.GRADING_RECEIPT_SECRET = "test-secret-for-duel-evidence";
process.env.CSRF_SECRET = "test-secret-for-duel-evidence-csrf";
resetVerdictReceiptSecretCache();

const { evaluateEvidence, parseSelectedCardIds } = await import("../src/duels/evidence.js");
const { combineWithEvidence, createDuelGrading } = await import("../src/duels/grading.js");
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

// A two-relevant, min-2 item: enough room to be right, wrong, and right two ways.
const ITEM = "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1";
const POLICY = m1EvidencePolicy(ITEM);
const RELEVANT = [...POLICY.relevantCardIds];
const DECOY = POLICY.offeredCardIds.find((id) => !RELEVANT.includes(id))!;
const NOT_OFFERED = M1_CODEX_CARD_IDS.find((id) => !POLICY.offeredCardIds.includes(id))!;

// ---------------------------------------------------------------------------
// parseSelectedCardIds — lenient, bounded.
// ---------------------------------------------------------------------------

test("parseSelectedCardIds coerces anything unshaped to an empty selection", () => {
  assert.deepEqual(parseSelectedCardIds(undefined), []);
  assert.deepEqual(parseSelectedCardIds(null), []);
  assert.deepEqual(parseSelectedCardIds("a-card"), []);
  assert.deepEqual(parseSelectedCardIds({ 0: "a" }), []);
  // Non-string and over-long entries are dropped, not rejected.
  assert.deepEqual(parseSelectedCardIds(["a", 2, "", "b"]), ["a", "b"]);
  assert.deepEqual(parseSelectedCardIds(["x".repeat(400), "ok"]), ["ok"]);
  // Bounded so a hostile body cannot make the grader chew on a huge array.
  assert.equal(parseSelectedCardIds(Array.from({ length: 200 }, (_, i) => `c${i}`)).length, 32);
});

// ---------------------------------------------------------------------------
// evaluateEvidence — the full matrix.
// ---------------------------------------------------------------------------

const AUTH = M1_CODEX_CARD_IDS; // the boss player holds all nine.

test("enough relevant cards is satisfied; too few is TOO_FEW whatever decoys ride along", () => {
  assert.equal(evaluateEvidence(POLICY, RELEVANT, AUTH).satisfied, true);
  assert.equal(evaluateEvidence(POLICY, RELEVANT, AUTH).feedback, "OK");

  const tooFew = evaluateEvidence(POLICY, [RELEVANT[0]!, DECOY], AUTH);
  assert.equal(tooFew.satisfied, false);
  assert.equal(tooFew.feedback, "TOO_FEW");
});

test("no cards placed is MISSING, not a crash", () => {
  const none = evaluateEvidence(POLICY, [], AUTH);
  assert.equal(none.satisfied, false);
  assert.equal(none.feedback, "MISSING");
});

test("an unoffered card, a duplicate, or an unauthorized card each fails legally", () => {
  const unoffered = evaluateEvidence(POLICY, [NOT_OFFERED], AUTH);
  assert.equal(unoffered.satisfied, false);
  assert.equal(unoffered.feedback, "NOT_OFFERED");

  const dup = evaluateEvidence(POLICY, [RELEVANT[0]!, RELEVANT[0]!], AUTH);
  assert.equal(dup.feedback, "DUPLICATE");

  // Authorised set excludes a relevant card the player tries to place.
  const restricted = AUTH.filter((id) => id !== RELEVANT[0]);
  const unauth = evaluateEvidence(POLICY, RELEVANT, restricted);
  assert.equal(unauth.satisfied, false);
  assert.equal(unauth.feedback, "UNAUTHORIZED");
});

test("more cards than the hand holds is TOO_MANY", () => {
  const tiny: EvidencePolicy = { ...POLICY, maxSelectable: 1 };
  const many = evaluateEvidence(tiny, RELEVANT, AUTH);
  assert.equal(many.satisfied, false);
  assert.equal(many.feedback, "TOO_MANY");
});

test("multiple valid groups: any minSupport relevant subset satisfies", () => {
  const three = m1EvidencePolicy("BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1"); // 3 relevant, min 2
  const [a, b, c] = three.relevantCardIds;
  for (const pair of [[a!, b!], [a!, c!], [b!, c!]]) {
    assert.equal(evaluateEvidence(three, pair, AUTH).satisfied, true, `${pair} should count`);
  }
});

test("an incompatible card fails even with enough support", () => {
  const withDecoy: EvidencePolicy = {
    ...POLICY,
    incompatibleCardIds: [DECOY],
  };
  const graded = evaluateEvidence(withDecoy, [...RELEVANT, DECOY], AUTH);
  assert.equal(graded.satisfied, false);
  assert.equal(graded.feedback, "INCOMPATIBLE");
});

// ---------------------------------------------------------------------------
// combineWithEvidence — prose AND evidence, and the outage exception.
// ---------------------------------------------------------------------------

function env(kind: "CORRECT" | "WRONG", source: VerdictEnvelope["source"]): VerdictEnvelope {
  return { kind, itemId: ITEM, itemVersion: "v1", source, responseRef: null };
}

test("a CLASSIFIER CORRECT with failed evidence becomes WRONG; with passed evidence stays CORRECT", () => {
  assert.equal(combineWithEvidence(env("CORRECT", "CLASSIFIER"), false).kind, "WRONG");
  assert.equal(combineWithEvidence(env("CORRECT", "CLASSIFIER"), true).kind, "CORRECT");
  // No gate run (undefined) leaves the verdict untouched.
  assert.equal(combineWithEvidence(env("CORRECT", "CLASSIFIER"), undefined).kind, "CORRECT");
});

test("the card half is enforced for EVERY source — an outage grant with wrong cards is WRONG", () => {
  // The card half is deterministic and needs no model, so an infrastructure outage
  // is no reason to excuse it: a CORRECT with FAILED evidence folds to WRONG whatever
  // minted the prose, not only a CLASSIFIER one. This is the behaviour the owner
  // asked for — a wrong answer marked wrong even with no classifier credential.
  assert.equal(combineWithEvidence(env("CORRECT", "GRADING_TIMEOUT"), false).kind, "WRONG");
  assert.equal(combineWithEvidence(env("CORRECT", "ABSTAINED"), false).kind, "WRONG");
});

test("an outage still grants the PROSE half — right cards keep the grant, no gate leaves it alone", () => {
  // Only the card half is enforced during an outage; the prose half is still granted,
  // so a student who placed the deterministically-correct cards is not punished for
  // infrastructure.
  assert.equal(combineWithEvidence(env("CORRECT", "GRADING_TIMEOUT"), true).kind, "CORRECT");
  // A gate that never ran (undefined) — an encounter, a legacy path — is untouched.
  assert.equal(combineWithEvidence(env("CORRECT", "GRADING_TIMEOUT"), undefined).kind, "CORRECT");
});

test("the gate only ever downgrades — a WRONG stays WRONG", () => {
  assert.equal(combineWithEvidence(env("WRONG", "CLASSIFIER"), true).kind, "WRONG");
});

// ---------------------------------------------------------------------------
// The route, end to end, with a fake CLASSIFIER grader.
// ---------------------------------------------------------------------------

const ALICE = "alice";
const DUEL_ID = "TEST#duel@1";

/** A grader that decides prose by non-blankness and always sources CLASSIFIER, then
 * combines with evidence exactly as the real one does — so the route's own wiring
 * (compute evidence, pass evidenceSatisfied, store the selection) is what is tested. */
function classifierGrading() {
  const real = createDuelGrading(silent);
  return {
    ...real,
    grade: async (input: {
      profileId: string;
      duelId: string;
      roundIndex: number;
      itemId: string;
      answer: string;
      evidenceSatisfied?: boolean;
    }) => {
      const prose: VerdictEnvelope = {
        kind: input.answer.trim().length > 0 ? "CORRECT" : "WRONG",
        itemId: input.itemId,
        itemVersion: "v1",
        source: "CLASSIFIER",
        responseRef: null,
      };
      const envelope = combineWithEvidence(prose, input.evidenceSatisfied);
      const receipt = mintVerdictReceipt(
        envelope,
        { profileId: input.profileId, attemptId: input.duelId, roundIndex: input.roundIndex },
        verdictReceiptSecret(),
      );
      return {
        envelope,
        receipt,
        provenance: { path: "MODEL", latencyMs: 1, fallbackDiagnosis: null },
      } as Awaited<ReturnType<typeof real.grade>>;
    },
  };
}

async function harness(options: { grading?: ReturnType<typeof classifierGrading> } = {}) {
  const app: FastifyInstance = Fastify({ logger: false });
  await app.register(cookie);
  await registerDuelRoutes(app, {
    grading: options.grading ?? classifierGrading(),
    authenticate: async (sid) => (sid ? { profileId: sid } : null),
    resolveAttempt: async (profileId) =>
      profileId === ALICE
        ? {
            attemptId: "att-alice",
            attemptOrdinal: 1,
            attemptSeedHex: "a".repeat(32),
            missionId: "PA.SEA01.CH02.BOSTON.MD01",
            chapterId: "boston-1765",
          }
        : null,
    questionAuthority: {
      duelId: () => DUEL_ID,
      expectedItemId: () => ITEM,
    },
    verdictStore: inMemoryDuelVerdictStore(),
    evidenceAuthorizedCardIds: M1_CODEX_CARD_IDS,
  });
  await app.ready();
  return app;
}

function post(
  app: FastifyInstance,
  round: number,
  answer: string,
  selectedCardIds: readonly string[],
) {
  return app.inject({
    method: "POST",
    url: `/v1/duels/${encodeURIComponent(DUEL_ID)}/rounds/${round}/verdict`,
    headers: {
      "x-pa-csrf-token": csrfTokenForSession(ALICE),
      "content-type": "application/json",
    },
    cookies: { pa_session: ALICE },
    payload: { side: "A", itemId: ITEM, itemVersion: "v1", conceptId: "x", answer, selectedCardIds },
  });
}

test("route: prose passes AND evidence passes → CORRECT, feedback OK", async () => {
  const app = await harness();
  try {
    const res = await post(app, 1, "the war left a debt", RELEVANT);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().kind, "CORRECT");
    assert.equal(res.headers["x-pa-evidence"], "OK");
  } finally {
    await app.close();
  }
});

test("route: prose passes but evidence is too few → WRONG, feedback TOO_FEW", async () => {
  const app = await harness();
  try {
    const res = await post(app, 2, "the war left a debt", [RELEVANT[0]!, DECOY]);
    assert.equal(res.json().kind, "WRONG", res.body);
    assert.equal(res.headers["x-pa-evidence"], "TOO_FEW");
  } finally {
    await app.close();
  }
});

test("route: evidence passes but prose is blank → WRONG (prose gate), feedback OK", async () => {
  const app = await harness();
  try {
    const res = await post(app, 3, "", RELEVANT);
    assert.equal(res.json().kind, "WRONG", res.body);
    // The evidence itself was fine; the prose failed. The two gates are independent.
    assert.equal(res.headers["x-pa-evidence"], "OK");
  } finally {
    await app.close();
  }
});

test("route: no cards placed → WRONG, feedback MISSING", async () => {
  const app = await harness();
  try {
    const res = await post(app, 4, "the war left a debt", []);
    assert.equal(res.json().kind, "WRONG", res.body);
    assert.equal(res.headers["x-pa-evidence"], "MISSING");
  } finally {
    await app.close();
  }
});

test("route: the first answer's cards are final — a changed resubmission cannot re-grade", async () => {
  const app = await harness();
  try {
    // First: a right answer with satisfying evidence → CORRECT.
    const first = await post(app, 5, "the war left a debt", RELEVANT);
    assert.equal(first.json().kind, "CORRECT");
    assert.equal(first.headers["x-pa-evidence"], "OK");
    const receipt = first.headers["x-pa-verdict-receipt"];

    // Second: the SAME round, now with no cards (would be MISSING/WRONG if re-graded).
    const second = await post(app, 5, "the war left a debt", []);
    assert.equal(second.json().kind, "CORRECT", "the first verdict stands");
    assert.deepEqual(second.json(), first.json(), "identical envelope");
    assert.equal(second.headers["x-pa-verdict-receipt"], receipt, "identical receipt");
    // The stored (first) selection is what the feedback is derived from — so a second
    // submission cannot change the recorded cards either.
    assert.equal(second.headers["x-pa-evidence"], "OK", "the stored selection is preserved");
  } finally {
    await app.close();
  }
});

test("route: a grading OUTAGE still enforces the cards — wrong cards WRONG, right cards keep the prose grant", async () => {
  // The REAL offline grader: no classifier credential, so a non-blank answer is the
  // generous PROSE grant (source GRADING_TIMEOUT). The CARD half is still enforced —
  // this is the acceptance criterion: with no TRUEFOUNDRY_GRADING_API_KEY present, a
  // wrong (here: missing) card selection is marked WRONG, while a right one passes.
  const app = await harness({ grading: createDuelGrading(silent) as never });
  try {
    // No cards placed → the card half fails → WRONG, even during the outage. The
    // owner can see a wrong answer marked wrong today, without a credential.
    const missing = await post(app, 6, "any answer at all", []);
    assert.equal(missing.statusCode, 200, missing.body);
    assert.equal(missing.json().kind, "WRONG", "wrong cards are wrong even in an outage");
    assert.equal(missing.headers["x-pa-evidence"], "MISSING");

    // Right cards → the prose half is still granted → CORRECT. A student who placed
    // the deterministically-correct cards is not failed closed by the outage...
    const satisfied = await post(app, 7, "any answer at all", RELEVANT);
    assert.equal(satisfied.statusCode, 200, satisfied.body);
    assert.equal(satisfied.json().kind, "CORRECT", "right cards keep the prose grant");
    // ...and the round is still MARKED as the generous grant, not a classifier read,
    // so the ledger's `graded` flag stays false and mastery is never inflated by it.
    assert.equal(satisfied.json().source, "GRADING_TIMEOUT");
  } finally {
    await app.close();
  }
});
