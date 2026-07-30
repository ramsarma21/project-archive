// The formative retrieval ledger — the store contract and the route that writes it.
//
// This is the in-memory, database-free half. The Postgres half (progression-e2e)
// proves the real SQL, the profile scoping under a real WHERE, and the dev-reset's
// cross-table clear. What is asserted here is the shape a teacher report reads and
// the wiring that records a graded round exactly once.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance, type FastifyBaseLogger } from "fastify";
import cookie from "@fastify/cookie";
import { resetVerdictReceiptSecretCache } from "@pa/grading";

await import("../src/config.js");
delete process.env.TRUEFOUNDRY_API_KEY;
delete process.env.TRUEFOUNDRY_BASE_URL;
delete process.env.TRUEFOUNDRY_GRADING_API_KEY;
delete process.env.TRUEFOUNDRY_GRADING_BASE_URL;
process.env.GRADING_RECEIPT_SECRET = "test-secret-for-retrieval-ledger";
process.env.CSRF_SECRET = "test-secret-for-retrieval-csrf";
resetVerdictReceiptSecretCache();

const { inMemoryConceptRetrievalStore } = await import(
  "../src/progression/retrievalStore.js"
);
const { createDuelGrading } = await import("../src/duels/grading.js");
const { registerDuelRoutes } = await import("../src/routes/duels.js");
const { inMemoryDuelVerdictStore } = await import("../src/duels/verdictStore.js");
const { csrfTokenForSession } = await import("../src/auth.js");
const { m1EvidencePolicy } = await import("@pa/mission-m1");

const silent = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as FastifyBaseLogger;

const CHAPTER = "boston-1765";
const MISSION = "PA.SEA01.CH02.BOSTON.MD01";
const CONCEPT = "BOS.CONCEPT.REPRESENTATION.v1";

// ---------------------------------------------------------------------------
// The store contract, in memory.
// ---------------------------------------------------------------------------

function event(overrides: Partial<Parameters<
  ReturnType<typeof inMemoryConceptRetrievalStore>["record"]
>[0]> = {}) {
  return {
    profileId: "profile-a",
    chapterId: CHAPTER,
    missionId: MISSION,
    attemptId: "attempt-1",
    conceptId: CONCEPT,
    itemId: "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1",
    source: "DUEL" as const,
    duelId: "M1.EFFIGY_RUN#duel@1",
    roundIndex: 1,
    correct: true,
    graded: true,
    recycled: false,
    appearance: 1,
    seenAt: "2026-07-28T18:00:00.000Z",
    ...overrides,
  };
}

test("a round is recorded once: the same (profile, duel, round) never double-counts", async () => {
  const store = inMemoryConceptRetrievalStore();
  await store.record(event({ correct: true }));
  // A repeat of the same key — a reload, a racer — is a no-op, and the FIRST
  // verdict stands even if the second claims otherwise.
  await store.record(event({ correct: false }));
  const rows = store.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.correct, true, "first answer is final, here as in the verdict store");
});

test("byChapter answers a teacher's questions: how often, how well, how spread, how recycled", async () => {
  const store = inMemoryConceptRetrievalStore();
  // Attempt 1 (match 1): asked twice, one right one wrong; the second is a recycle.
  await store.record(event({ duelId: "d1", roundIndex: 1, correct: true, graded: true, recycled: false, appearance: 1, itemId: "ITEM.A", seenAt: "2026-07-01T10:00:00.000Z" }));
  await store.record(event({ duelId: "d1", roundIndex: 2, correct: false, graded: true, recycled: true, appearance: 2, itemId: "ITEM.A", seenAt: "2026-07-01T10:02:00.000Z" }));
  // Attempt 2 (match 2, a different session): asked once, granted during an outage
  // (not graded) — must not count toward correctness.
  await store.record(event({ attemptId: "attempt-2", duelId: "d2", roundIndex: 1, correct: true, graded: false, recycled: false, appearance: 1, itemId: "ITEM.B", seenAt: "2026-07-03T09:00:00.000Z" }));

  const [summary] = await store.byChapter("profile-a", CHAPTER);
  assert.ok(summary);
  assert.equal(summary.conceptId, CONCEPT);
  assert.equal(summary.asked, 3, "every ask, including the recycle and the grant");
  assert.equal(summary.askedGraded, 2, "the granted outage round is not graded evidence");
  assert.equal(summary.correct, 1, "correct AND graded only — an outage cannot inflate it");
  assert.equal(summary.recycledAsks, 1, "one ask reused an item already seen this match");
  assert.equal(summary.distinctItems, 2, "ITEM.A and ITEM.B");
  assert.equal(summary.distinctAttempts, 2, "spread across two matches, not one");
  assert.equal(summary.firstSeenAt, "2026-07-01T10:00:00.000Z");
  assert.equal(summary.lastSeenAt, "2026-07-03T09:00:00.000Z");
});

test("the ledger is profile-scoped: one profile's asks never leak into another's report", async () => {
  const store = inMemoryConceptRetrievalStore();
  await store.record(event({ profileId: "profile-a", duelId: "da", correct: true }));
  await store.record(event({ profileId: "profile-b", duelId: "db", correct: false }));
  await store.record(event({ profileId: "profile-b", duelId: "db2", roundIndex: 2, correct: false }));

  const a = await store.byChapter("profile-a", CHAPTER);
  const b = await store.byChapter("profile-b", CHAPTER);
  assert.equal(a.length, 1);
  assert.equal(a[0]!.asked, 1, "A sees only A's single ask");
  assert.equal(a[0]!.correct, 1);
  assert.equal(b[0]!.asked, 2, "B sees only B's two asks");
  assert.equal(b[0]!.correct, 0);
});

test("clearMission drops one mission's rows and leaves the rest", async () => {
  const store = inMemoryConceptRetrievalStore();
  await store.record(event({ missionId: "M1", duelId: "m1r1" }));
  await store.record(event({ missionId: "M2", duelId: "m2r1" }));
  const cleared = await store.clearMission("profile-a", CHAPTER, "M1");
  assert.equal(cleared.retrievalRowsCleared, 1);
  const rows = store.rows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.missionId, "M2", "the other mission's history survives the reset");
});

// ---------------------------------------------------------------------------
// The route wiring: a graded duel round is folded into the ledger, once.
// ---------------------------------------------------------------------------

const DUEL_ID = "M1.EFFIGY_RUN#duel@1";
const ITEM_ID = "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1";
const ALICE = "alice";

async function duelHarness() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const grading = createDuelGrading(silent);
  const retrieval = inMemoryConceptRetrievalStore();
  await registerDuelRoutes(app, {
    grading,
    authenticate: async (sid) => (sid ? { profileId: sid } : null),
    resolveAttempt: async (profileId) =>
      profileId === ALICE
        ? {
            attemptId: "att-alice",
            attemptOrdinal: 1,
            attemptSeedHex: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
            missionId: MISSION,
            chapterId: CHAPTER,
          }
        : null,
    questionAuthority: {
      duelId: () => DUEL_ID,
      expectedItemId: () => ITEM_ID,
      // Round 2 recycles a prior item; round 1 is a fresh first appearance.
      roundAppearance: (_attempt, round) =>
        round >= 2 ? { recycled: true, appearance: 2 } : { recycled: false, appearance: 1 },
    },
    verdictStore: inMemoryDuelVerdictStore(),
    retrieval,
  });
  await app.ready();
  return { app, retrieval };
}

// The relevant cards for ITEM_ID, so a test that wants a CORRECT during an outage can
// satisfy the card half — which is now enforced regardless of grading source.
const RELEVANT_CARDS = [...m1EvidencePolicy(ITEM_ID).relevantCardIds];

function postRound(
  app: FastifyInstance,
  sid: string,
  round: number,
  answer: string,
  selectedCardIds: readonly string[] = [],
) {
  return app.inject({
    method: "POST",
    url: `/v1/duels/${encodeURIComponent(DUEL_ID)}/rounds/${round}/verdict`,
    headers: {
      "content-type": "application/json",
      "x-pa-csrf-token": csrfTokenForSession(sid),
    },
    cookies: { pa_session: sid },
    payload: { side: "A", itemId: ITEM_ID, itemVersion: "v1", conceptId: CONCEPT, answer, selectedCardIds },
  });
}

test("a graded duel round is recorded server-side, with the server's concept and verdict", async () => {
  const { app, retrieval } = await duelHarness();
  try {
    // A blank answer abstains → WRONG, deterministically graded (no classifier needed).
    const res = await postRound(app, ALICE, 1, "");
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().kind, "WRONG");

    const rows = retrieval.rows();
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.profileId, ALICE);
    assert.equal(row.chapterId, CHAPTER);
    assert.equal(row.missionId, MISSION);
    assert.equal(row.conceptId, CONCEPT, "the server-selected item's concept");
    assert.equal(row.itemId, ITEM_ID);
    assert.equal(row.source, "DUEL");
    assert.equal(row.correct, false);
    assert.equal(row.graded, true, "an abstention is a real grade, not an outage grant");
    assert.equal(row.recycled, false);
    assert.equal(row.appearance, 1);
  } finally {
    await app.close();
  }
});

test("a repeat submission of the same round records nothing new", async () => {
  const { app, retrieval } = await duelHarness();
  try {
    await postRound(app, ALICE, 1, "");
    // A changed second answer for the same round: the verdict store returns the
    // first verdict (firstMinted false), so the ledger records nothing new.
    const second = await postRound(app, ALICE, 1, "Britain's war debt fell to the colonies.");
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(retrieval.rows().length, 1, "one round, one retrieval row");
  } finally {
    await app.close();
  }
});

test("the duel lane's recycle marker is consumed, and a granted round is marked ungraded", async () => {
  const { app, retrieval } = await duelHarness();
  try {
    // Round 2 recycles an item (per the authority above); a non-blank answer with
    // SATISFYING cards and no classifier is the generous PROSE grant — CORRECT but
    // NOT graded evidence. The cards must be placed because the card half is now
    // enforced during an outage; the prose half is what the outage grants.
    const res = await postRound(
      app,
      ALICE,
      2,
      "Parliament wanted the colonies to pay the war debt.",
      RELEVANT_CARDS,
    );
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().kind, "CORRECT");

    const row = retrieval.rows()[0]!;
    assert.equal(row.recycled, true, "the repeat marker rode through from the duel lane");
    assert.equal(row.appearance, 2);
    assert.equal(row.correct, true);
    assert.equal(row.graded, false, "an infrastructure grant is not retrieval evidence");
  } finally {
    await app.close();
  }
});
