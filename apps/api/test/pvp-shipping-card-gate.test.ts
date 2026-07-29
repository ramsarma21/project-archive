// The SHIPPING PvP card gate — `M1_PVP_CARD_ACCESS = "ASSESSMENT_PASSED"` — driven
// while the live constant is still `PLAYTEST_ALL`.
//
// WHY THIS FILE EXISTS SEPARATELY FROM `pvp-card-gate.test.ts`. That file proves the
// resolver's two branches against a STUB predicate (`assessmentPassed: async () =>
// passed`). That is worth having and it is not the same claim: it cannot see whether
// the predicate the server actually wires is reachable, whether real progression ever
// makes it true, or what the routes do when the two sides' card sets differ. Every
// test here drives the real progression service over the REAL shipped content pack,
// or the real routes, and asserts on what a player can actually reach.
//
// NOTHING HERE FLIPS THE CONSTANT. The policy is passed explicitly as
// `policy: "ASSESSMENT_PASSED"`, which is the seam `pvpCardResolver` already exposes,
// so these keep testing the shipping branch on the day the constant flips too.
//
// WHAT THESE TESTS FOUND, recorded here because a reader arrives at the test before
// the report: over the shipped content pack the capstone CANNOT BE SAT
// (`chapterConceptIds("boston-1765")` is `[]`, `assessmentId` is `null`), so
// `assessmentPassedAt` is unreachable and `ASSESSMENT_PASSED` grants nobody anything.
// `openChapterAssessment` refusing PACKAGE_MISSING is asserted below so that the day
// the capstone is authored, that assertion fails and points here.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { LEARNING_MODULE_SECONDS } from "@pa/contracts";
import { askableItems, allAskableCardIds, newStandingRecord } from "@pa/pvp";
import { ProgressionService } from "../src/progression/service.js";
import type { ProgressionContent } from "../src/progression/content.js";
import {
  BOSTON_RUNTIME_CHAPTER_ID,
  M1_MISSION_ID,
  M1_MODULE_ID,
  bostonProgressionContent,
} from "../src/progression/content.js";
import {
  assessmentPassedFromSnapshot,
  pvpCardResolver,
} from "../src/pvp/cardAccess.js";
import {
  eligiblePvpItems,
  poolHealth,
  pvpItemBank,
  pvpQuestionBank,
  CAPSTONE_ORIGIN_POOL,
} from "../src/pvp/questionPool.js";
import { m1EvidencePolicyFor } from "../src/duels/evidence.js";
import { MemoryStore } from "./support/memoryProgressionStore.js";

process.env.CSRF_SECRET = "test-secret-for-pvp-shipping-card-gate";

const { csrfTokenForSession } = await import("../src/auth.js");
const { registerPvpRoutes } = await import("../src/routes/pvp.js");

const SHIPPED = bostonProgressionContent();
const M1_CARDS = SHIPPED.codexCardsForModule(M1_MODULE_ID);
const M1_DECK = SHIPPED.moduleDeckCueIds(M1_MODULE_ID) ?? [];
const M1_CHECKS = SHIPPED.moduleRequiredCheckIds(M1_MODULE_ID);
const SEED = "c".repeat(64);

let profileCounter = 0;
const newProfileId = (): string =>
  `44444444-4444-4444-8444-${String((profileCounter += 1)).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Driving real progression over the real content pack.
// ---------------------------------------------------------------------------

/**
 * The progression service the SERVER builds, on an in-memory store.
 *
 * The content pack is the shipped `bostonProgressionContent()` unless a test
 * supplies overrides. That is deliberate and is the whole point of this file:
 * `progression.test.ts` drives a SYNTHETIC pack that authors a capstone, which is
 * exactly why nothing noticed that the shipped one does not.
 */
function progression(overrides: Partial<ProgressionContent> = {}) {
  const store = new MemoryStore();
  let ids = 0;
  let clock = Date.parse("2026-07-29T00:00:00.000Z");
  const service = new ProgressionService(
    store,
    { ...SHIPPED, ...overrides },
    () => new Date((clock += 1000)),
    () => {
      ids += 1;
      return `55555555-5555-4555-8555-${String(ids).padStart(12, "0")}`;
    },
    { verdict: async () => ({ correct: true, needsReview: false }) },
  );
  return { store, service };
}

/**
 * The card resolver EXACTLY as `app.ts` wires it, with only the policy forced.
 *
 * `assessmentPassedFromSnapshot` is the production predicate, imported rather than
 * re-typed — a re-typed predicate is a second implementation that agrees until it
 * doesn't, and this gate's whole correctness lives in that one line.
 */
function shippingResolver(service: ProgressionService) {
  return pvpCardResolver({
    m1CardIds: M1_CARDS,
    policy: "ASSESSMENT_PASSED",
    log: { warn: () => {} },
    assessmentPassed: async (profileId) =>
      assessmentPassedFromSnapshot(await service.snapshot(profileId)),
  });
}

/** Learn M1's nine cards the way a player does: complete the module. */
async function completeM1Module(
  service: ProgressionService,
  profileId: string,
): Promise<void> {
  const done = await service.completeLearningModule(profileId, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    moduleId: M1_MODULE_ID,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: M1_MISSION_ID,
    acknowledgedCueIds: [...M1_DECK],
    acknowledgedCheckIds: [...M1_CHECKS],
    observedSeconds: LEARNING_MODULE_SECONDS,
  });
  assert.equal(done.ok, true, `the M1 module gate must pass: ${JSON.stringify(done)}`);
}

/** Clear M1 on the first attempt. */
async function clearM1(service: ProgressionService, profileId: string): Promise<void> {
  const opened = await service.openMissionAttempt(
    profileId,
    { chapterId: BOSTON_RUNTIME_CHAPTER_ID, missionId: M1_MISSION_ID },
    SEED,
  );
  assert.equal(opened.ok, true, `M1 must open: ${JSON.stringify(opened)}`);
  if (!opened.ok) return;
  const committed = await service.commitMissionOutcome(profileId, {
    attemptId: opened.value.attemptId,
    outcome: "CLEARED",
    committedEvents: [],
    baseRevision: 0,
  });
  assert.equal(committed.ok, true, `M1 must clear: ${JSON.stringify(committed)}`);
}

// ===========================================================================
// 1. The shipping branch against real progression.
// ===========================================================================

test("nine cards learned and M1 cleared first try still leaves NOTHING PvP-legal, and the shipping policy grants nothing", async () => {
  const { store, service } = progression();
  const profileId = newProfileId();

  await completeM1Module(service, profileId);
  await clearM1(service, profileId);

  const snapshot = await service.snapshot(profileId);

  // All nine held in single-player.
  const learned = snapshot.codex.filter((card) => card.learnedAt !== null);
  assert.equal(learned.length, 9, "the module teaches all nine cards");
  assert.deepEqual(
    learned.map((card) => card.cardId).sort(),
    [...M1_CARDS].sort(),
    "and they are the authored nine",
  );

  // None of them PvP-legal: that is minted by the capstone, not by the module.
  const pvpLegal = snapshot.codex.filter((card) => card.pvpLegalAt !== null);
  assert.deepEqual(pvpLegal, [], "a module completion mints no PvP legality");

  // The mission is genuinely cleared — this is not a player who did nothing.
  const m1 = snapshot.missions.find((row) => row.missionId === M1_MISSION_ID);
  assert.equal(m1?.outcome, "CLEARED");
  assert.equal(m1?.clearedOnAttempt, 1, "cleared on the first attempt");

  // The production predicate reads false, so the shipping resolver hands out nothing.
  assert.equal(snapshot.activeChapter.assessmentPassedAt, null);
  assert.equal(assessmentPassedFromSnapshot(snapshot), false);
  assert.deepEqual(
    [...(await shippingResolver(service)(profileId))],
    [],
    "ASSESSMENT_PASSED grants no card to a player who has cleared the mission but not the capstone",
  );

  // And the store agrees with the snapshot, so this is not a projection artefact.
  for (const card of store.codex.values()) {
    assert.ok(card.learnedAt, `${card.cardId} is learned`);
    assert.equal(card.pvpLegalAt, null, `${card.cardId} is not PvP-legal`);
  }
});

test("over the SHIPPED content pack the capstone cannot be opened at all, so no PvP-legal card is reachable", async () => {
  // This is the load-bearing fact behind the test above, and it is a different
  // claim: not "the player has not passed yet" but "there is no way to pass".
  // `chapterConceptIds` is `[]` and `assessmentId` is `null` in the shipped pack,
  // and `openChapterAssessment` refuses on both.
  assert.deepEqual(
    [...SHIPPED.chapterConceptIds(BOSTON_RUNTIME_CHAPTER_ID)],
    [],
    "the shipped pack authors no chapter concept set",
  );
  assert.equal(SHIPPED.assessmentId(BOSTON_RUNTIME_CHAPTER_ID), null);

  const { service } = progression();
  const profileId = newProfileId();
  await completeM1Module(service, profileId);
  await clearM1(service, profileId);

  const opened = await service.openChapterAssessment(profileId, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    // The id the client would have to send; there is no authored one to send.
    assessmentId: "BOS.CAP.ASSESSMENT.v1",
  });
  assert.deepEqual(
    opened,
    { ok: false, error: "PACKAGE_MISSING" },
    "the capstone cannot be sat over the shipped pack",
  );

  // WHEN THIS ASSERTION FAILS the capstone has been authored, and the shipping
  // gate becomes reachable for the first time. That is the moment to re-read this
  // file: the tests below prove the grant side works, but only over a pack this
  // test supplies, and the real one will have its own item bank and thresholds.
});

test("once a capstone IS authored and passed, all nine mint PvP-legal and the shipping policy grants all nine", async () => {
  // The capstone half of the shipped pack is unauthored, so the reachable grant
  // path is demonstrated over a pack that authors ONLY the capstone and keeps M1's
  // real cards, concepts and card→concept mapping. Everything about cards and
  // mastery is therefore the real thing; only the missing authoring is supplied.
  const concepts = [
    "BOS.CONCEPT.POSTWAR_REVENUE.v1",
    "BOS.CONCEPT.STAMP_SCOPE.v1",
    "BOS.CONCEPT.REPRESENTATION.v1",
  ] as const;
  const ASSESSMENT = "BOS.CAP.ASSESSMENT.v1";
  const reserve: Record<string, string[]> = {
    [concepts[0]]: ["CAP.PR.1", "CAP.PR.2", "CAP.PR.3", "CAP.PR.4"],
    [concepts[1]]: ["CAP.SS.1", "CAP.SS.2", "CAP.SS.3", "CAP.SS.4"],
    [concepts[2]]: ["CAP.RE.1", "CAP.RE.2", "CAP.RE.3", "CAP.RE.4"],
  };
  const conceptOf = (itemId: string): string | null => {
    if (itemId.startsWith("CAP.PR.")) return concepts[0];
    if (itemId.startsWith("CAP.SS.")) return concepts[1];
    if (itemId.startsWith("CAP.RE.")) return concepts[2];
    return null;
  };
  const { store, service } = progression({
    chapterConceptIds: () => [...concepts],
    assessmentId: () => ASSESSMENT,
    assessmentModuleId: () => "BOS.CAP.MODULE.v1",
    itemReserve: (_assessmentId, conceptId) => reserve[conceptId] ?? [],
    itemConcept: conceptOf,
    itemFormat: () => "SELECTED_RESPONSE",
    isCorrectOption: (_itemId, optionId) => optionId === "OPT.RIGHT",
  });
  const profileId = newProfileId();

  await completeM1Module(service, profileId);
  await clearM1(service, profileId);

  const attempt = await service.openChapterAssessment(profileId, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    assessmentId: ASSESSMENT,
  });
  assert.equal(attempt.ok, true, `the authored capstone opens: ${JSON.stringify(attempt)}`);
  if (!attempt.ok) return;
  assert.equal(attempt.value.attemptOrdinal, 1);
  assert.deepEqual([...attempt.value.scopedConceptIds], [...concepts]);

  // 100% on every concept — the only thing that mints PvP legality.
  for (const entry of attempt.value.form) {
    for (const itemId of entry.itemIds) {
      const answered = await service.answerAssessmentItem(profileId, {
        attemptId: attempt.value.attemptId,
        itemId,
        itemFormat: "SELECTED_RESPONSE",
        selectedOptionId: "OPT.RIGHT",
      });
      assert.equal(answered.ok, true, `${itemId} answered`);
    }
  }
  const submitted = await service.submitChapterAssessment(
    profileId,
    attempt.value.attemptId,
  );
  assert.equal(submitted.ok, true, `submitted: ${JSON.stringify(submitted)}`);
  if (!submitted.ok) return;
  assert.equal(submitted.value.passed, true);
  assert.deepEqual(
    [...submitted.value.newlyPvpLegalCardIds].sort(),
    [...M1_CARDS].sort(),
    "100% on all three concepts mints exactly the nine M1 cards",
  );

  // The durable rows, the predicate, and the resolver all agree.
  for (const card of store.codex.values()) {
    assert.ok(card.pvpLegalAt, `${card.cardId} is PvP-legal`);
  }
  const snapshot = await service.snapshot(profileId);
  assert.ok(snapshot.activeChapter.assessmentPassedAt);
  assert.equal(assessmentPassedFromSnapshot(snapshot), true);
  assert.deepEqual(
    [...(await shippingResolver(service)(profileId))].sort(),
    [...M1_CARDS].sort(),
    "ASSESSMENT_PASSED grants the nine once the capstone has passed",
  );
});

test("the shipping policy reads the ACTIVE chapter, so advancing revokes PvP access the capstone earned", async () => {
  // Not a redesign proposal — a measurement. `assessmentPassedFromSnapshot` reads
  // `activeChapter`, and `advanceChapter` makes the NEXT chapter active with its own
  // null `assessmentPassedAt`, while the Codex rows keep their `pvpLegalAt` forever.
  // So under ASSESSMENT_PASSED a player who passes Boston and moves on loses the
  // nine cards they earned, and their durable Codex says they still hold them.
  const ASSESSMENT = "BOS.CAP.ASSESSMENT.v1";
  const concepts = ["BOS.CONCEPT.POSTWAR_REVENUE.v1"] as const;
  const { store, service } = progression({
    chapterConceptIds: () => [...concepts],
    assessmentId: () => ASSESSMENT,
    assessmentModuleId: () => "BOS.CAP.MODULE.v1",
    itemReserve: () => ["CAP.PR.1", "CAP.PR.2", "CAP.PR.3", "CAP.PR.4"],
    itemConcept: () => concepts[0],
    itemFormat: () => "SELECTED_RESPONSE",
    isCorrectOption: (_itemId, optionId) => optionId === "OPT.RIGHT",
  });
  const profileId = newProfileId();
  await completeM1Module(service, profileId);

  const attempt = await service.openChapterAssessment(profileId, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    assessmentId: ASSESSMENT,
  });
  assert.equal(attempt.ok, true);
  if (!attempt.ok) return;
  for (const entry of attempt.value.form) {
    for (const itemId of entry.itemIds) {
      await service.answerAssessmentItem(profileId, {
        attemptId: attempt.value.attemptId,
        itemId,
        itemFormat: "SELECTED_RESPONSE",
        selectedOptionId: "OPT.RIGHT",
      });
    }
  }
  const submitted = await service.submitChapterAssessment(
    profileId,
    attempt.value.attemptId,
  );
  assert.equal(submitted.ok, true);
  const resolve = shippingResolver(service);
  assert.equal((await resolve(profileId)).length, 9, "access is open after the capstone");

  const advanced = await service.advanceChapter(profileId, "boston-1766");
  assert.equal(advanced.ok, true, `advance: ${JSON.stringify(advanced)}`);

  // The durable Codex still says PvP-legal…
  const stillLegal = [...store.codex.values()]
    .filter((card) => card.pvpLegalAt !== null)
    .map((card) => card.cardId);
  assert.deepEqual(
    stillLegal.sort(),
    [...SHIPPED.codexCardsForConcept(concepts[0])].sort(),
    "the cards the mastered concept minted keep their pvpLegalAt across chapters",
  );
  // …and the shipping resolver now says the player holds nothing.
  const after = await service.snapshot(profileId);
  assert.equal(after.activeChapter.chapterId, "boston-1766");
  assert.equal(after.activeChapter.assessmentPassedAt, null);
  assert.deepEqual(
    [...(await resolve(profileId))],
    [],
    "REGRESSION RISK: advancing a chapter revokes the PvP access the capstone earned",
  );
});

// ===========================================================================
// 2. The intersection rule.
// ===========================================================================

test("an item is offered only when BOTH sides hold every card it draws on", async () => {
  const bank = pvpQuestionBank();
  const all = allAskableCardIds(bank);
  const onlyStamp = [
    "BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1",
    "BOS.MD01.CARD.STAMP_DATE.v1",
  ];

  const both = eligiblePvpItems({
    askable: askableItems(bank, { A: all, B: all }),
    mastered: { A: [], B: [] },
  });
  const asymmetric = eligiblePvpItems({
    askable: askableItems(bank, { A: all, B: onlyStamp }),
    mastered: { A: [], B: [] },
  });

  // The measured figures. Stated so a change to the bank shows up as a number.
  assert.equal(both.length, 25, "both sides holding all nine can be asked the whole pool");
  assert.equal(asymmetric.length, 6, "a two-card holding on one side cuts the pool to six");

  // THE RULE: never a card the thin side lacks. A union bug fails right here,
  // because A holds every card and would make all 25 askable.
  const heldByB = new Set(onlyStamp);
  for (const item of asymmetric) {
    assert.ok(item.codexCardIds.length > 0, `${item.itemId} names at least one card`);
    for (const card of item.codexCardIds) {
      assert.ok(heldByB.has(card), `${item.itemId} asks for ${card}, which B does not hold`);
    }
  }
  assert.ok(
    asymmetric.length < both.length,
    "the thin side must shrink the pool, not leave it whole",
  );

  // And the question A alone could answer is genuinely withheld, not merely absent:
  // pick an item needing a card only A holds and prove it is in `both` but not here.
  const aOnly = both.find((item) =>
    item.codexCardIds.some((card) => !heldByB.has(card)),
  );
  assert.ok(aOnly, "the pool contains an item B cannot be asked");
  assert.equal(
    asymmetric.some((item) => item.itemId === aOnly!.itemId),
    false,
    `${aOnly!.itemId} needs a card only A holds and must not be offered`,
  );
});

test("no intersection, however thin, can offer a round whose evidence cannot be satisfied", async () => {
  // The gate makes the evidence deck the INTERSECTION, and `evidencePolicyFrom`
  // intersects an item's relevant cards with that deck. If an item's relevant cards
  // were not a subset of the cards the bank says it draws on, a thin deck could
  // offer a round with `relevant` empty and `minSupport` 1 — unsatisfiable, so every
  // answer grades WRONG on evidence and the round is unwinnable regardless of prose.
  //
  // Two separate sources feed that: `content/m1/duel-items.json`'s `codexCardIds`
  // (via the PvP bank) and @pa/mission-m1's `m1EvidenceRelevantCardIds`. They agree
  // today. This asserts they keep agreeing, over every intersection a real policy
  // could produce, because nothing else does.
  const bank = pvpQuestionBank();
  const all = allAskableCardIds(bank);

  const decks: readonly string[][] = [
    [...all],
    // Every single-card intersection, and every pair. 9 + 36 = 45 decks.
    ...all.map((card) => [card]),
    ...all.flatMap((left, index) => all.slice(index + 1).map((right) => [left, right])),
  ];

  let checked = 0;
  for (const deck of decks) {
    const offered = eligiblePvpItems({
      askable: askableItems(bank, { A: all, B: deck }),
      mastered: { A: [], B: [] },
    });
    for (const item of offered) {
      const policy = m1EvidencePolicyFor(item.itemId, deck);
      checked += 1;
      assert.ok(
        policy.relevantCardIds.length >= policy.minSupport,
        `${item.itemId} offered on a ${deck.length}-card deck needs ${policy.minSupport} supporting cards but only ${policy.relevantCardIds.length} of its relevant cards are in the deck — the round would be unwinnable`,
      );
      for (const card of policy.offeredCardIds) {
        assert.ok(
          deck.includes(card),
          `${item.itemId} offers ${card}, which is not in the intersection both players hold`,
        );
      }
    }
  }
  assert.ok(checked > 0, "the sweep actually offered rounds to check");
});

test("the capstone-mastery half of the guard is unreachable today, and this says so out loud", async () => {
  // `eligiblePvpItems` checks `masteredByBoth` for capstone-shared items. That branch
  // cannot fire: the nine capstone items are excluded twice over, before mastery is
  // ever consulted — they carry no cards (so `askableItems` drops them) and their
  // rubric was never ported into the grading bank (so the coverage filter drops them).
  //
  // This is asserted rather than left implicit because the mastery INTERSECTION is a
  // fairness rule nobody can currently test end to end. When the capstone rubric is
  // ported, `gradable` rises and this test fails — which is the signal to write the
  // asymmetric-mastery test that cannot be written today.
  //
  // MEASURED BLIND SPOT, so nobody has to rediscover it: replacing `masteredByBoth`
  // with the UNION of both sides' mastery leaves this whole file green. That branch
  // cannot execute, so no test can guard it. The one-sided-mastery bug — a capstone
  // question served because only ONE player has spent their retry reserve — is
  // therefore unguarded, and stays unguarded until a capstone item is gradable.
  const health = poolHealth();
  assert.equal(health.capstoneShared, 9, "nine items are shared in from the capstone");
  assert.equal(
    health.unguarded,
    health.gradable,
    "no gradable item is under the mastery guard, so the guard changes nothing",
  );
  assert.equal(health.total, health.unguarded + health.capstoneShared);

  const bank = pvpQuestionBank();
  const grading = pvpItemBank();
  const capstone = bank.items.filter((item) => item.poolId === CAPSTONE_ORIGIN_POOL);
  assert.equal(capstone.length, 9);
  for (const item of capstone) {
    assert.equal(item.codexCardIds.length, 0, `${item.itemId} carries no card`);
    assert.equal(
      grading.get(item.itemId),
      undefined,
      `${item.itemId} is not gradable, so PvP must never serve it`,
    );
  }

  // Mastery on both sides still cannot surface one, which is the actual claim.
  const all = allAskableCardIds(bank);
  const everyConcept = [...new Set(capstone.map((item) => item.conceptId))];
  const withMastery = eligiblePvpItems({
    askable: askableItems(bank, { A: all, B: all }),
    mastered: { A: everyConcept, B: everyConcept },
  });
  assert.equal(
    withMastery.filter((item) => item.poolId === CAPSTONE_ORIGIN_POOL).length,
    0,
    "even with both sides mastering every concept, no capstone item is served",
  );
  assert.equal(withMastery.length, health.unguarded);

  // The two filters are INDEPENDENT, and the test above only proves the pair. Feed a
  // capstone item straight into `eligiblePvpItems`, past `askableItems`, so the
  // coverage filter is the only thing left standing — otherwise deleting it looks
  // harmless, because the cardless guard happens to catch the same nine items.
  assert.deepEqual(
    eligiblePvpItems({
      askable: [capstone[0]!],
      mastered: { A: everyConcept, B: everyConcept },
    }),
    [],
    "the grader-coverage filter alone withholds an ungradable capstone item",
  );
});

// ===========================================================================
// 3. The degenerate cases, through the real routes.
// ===========================================================================

interface Harness {
  readonly app: FastifyInstance;
  readonly clock: { t: number };
}

/** The PvP routes with a per-profile card resolver, so the two sides can differ. */
async function routes(cardsFor: (profileId: string) => readonly string[]): Promise<Harness> {
  const clock = { t: 3_000_000 };
  const records = new Map<string, ReturnType<typeof newStandingRecord>>();
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerPvpRoutes(app, {
    now: () => clock.t,
    startScheduler: false,
    authenticate: async (sessionId) => (sessionId ? { profileId: sessionId } : null),
    masteredConcepts: async () => [],
    verifyReceipt: () => true,
    gradeAnswer: async ({ itemId }) => ({
      envelope: {
        kind: "CORRECT",
        itemId,
        itemVersion: "v1",
        source: "CLASSIFIER",
        responseRef: null,
      },
      receipt: "receipt",
    }),
    resolvePvpCardIds: async (profileId) => cardsFor(profileId),
    standings: {
      async ensure(profileId) {
        const existing = records.get(profileId);
        if (existing) return existing;
        const fresh = newStandingRecord(profileId, `Quiet-${profileId}`, 1);
        records.set(profileId, fresh);
        return fresh;
      },
      async board() {
        return [];
      },
      async bank() {
        return true;
      },
    },
  });
  await app.ready();
  return { app, clock };
}

let sessionCounter = 0;
const sid = (role: string): string => `${role}-shipgate-${(sessionCounter += 1)}`;

function post(app: FastifyInstance, url: string, session: string, payload: unknown = {}) {
  return app.inject({
    method: "POST",
    url,
    headers: {
      "x-pa-csrf-token": csrfTokenForSession(session),
      "content-type": "application/json",
    },
    cookies: { pa_session: session },
    payload: payload as object,
  });
}

const get = (app: FastifyInstance, url: string, session: string) =>
  app.inject({ method: "GET", url, cookies: { pa_session: session } });

test("EMPTY INTERSECTION: an unentitled guest cannot start a match, and nothing is left half-built", async () => {
  // The case PLAYTEST_ALL can never produce, and therefore the case nothing has
  // ever executed. The host is entitled; the guest holds nothing.
  const all = allAskableCardIds(pvpQuestionBank());
  const host = sid("host");
  const guest = sid("guest");
  const { app } = await routes((profileId) => (profileId === host ? all : []));

  const created = await post(app, "/api/pvp/lobby", host);
  assert.equal(created.statusCode, 200, created.body);
  const code = created.json().code as string;

  const joined = await post(app, `/api/pvp/lobby/${code}/join`, guest);
  assert.equal(joined.statusCode, 409, joined.body);
  assert.equal(
    joined.json().error,
    "NO_QUESTIONS",
    "an empty intersection refuses the match rather than starting an unplayable one",
  );

  // Nothing half-built: no match id came back, the lobby is still the host's to
  // cancel, and the host is not stranded reading STARTED against a match that does
  // not exist. Under PLAYTEST_ALL none of this could be reached.
  assert.equal(joined.json().matchId, undefined);
  const hostView = await get(app, `/api/pvp/lobby/${code}`, host);
  assert.equal(hostView.statusCode, 200, hostView.body);
  assert.equal(hostView.json().status, "OPEN", "the failed join did not start the lobby");
  assert.equal(hostView.json().matchId, null);

  // The host can still cancel and open a fresh lobby, so a mismatched guest does
  // not cost the host their one commitment slot.
  const cancelled = await app.inject({
    method: "DELETE",
    url: `/api/pvp/lobby/${code}`,
    headers: { "x-pa-csrf-token": csrfTokenForSession(host) },
    cookies: { pa_session: host },
  });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  const again = await post(app, "/api/pvp/lobby", host);
  assert.equal(again.statusCode, 200, again.body);
  await app.close();
});

test("EMPTY INTERSECTION: an unentitled host is refused at the lobby, with the entitlement reason", async () => {
  const { app } = await routes(() => []);
  const res = await post(app, "/api/pvp/lobby", sid("host"));
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, "NO_PVP_LEGAL_CARDS");
  await app.close();
});

test("PARTIAL INTERSECTION: the match starts, and every question and hand stays inside what both hold", async () => {
  // The graduated case. It is unreachable under today's ALL-OR-NOTHING resolver —
  // ASSESSMENT_PASSED grants nine cards or none — but `askableItems` and the evidence
  // deck are per-card, so this is what they would do, and it is the behaviour the
  // owner's open question about a lesson minting a card would rely on.
  const onlyStamp = [
    "BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1",
    "BOS.MD01.CARD.STAMP_DATE.v1",
  ];
  const all = allAskableCardIds(pvpQuestionBank());
  const host = sid("host");
  const guest = sid("guest");
  const { app, clock } = await routes((profileId) =>
    profileId === host ? all : onlyStamp,
  );

  const created = await post(app, "/api/pvp/lobby", host);
  assert.equal(created.statusCode, 200, created.body);
  const code = created.json().code as string;
  const joined = await post(app, `/api/pvp/lobby/${code}/join`, guest);
  assert.equal(joined.statusCode, 200, joined.body);
  const matchId = joined.json().matchId as string;

  // Walk several rounds, not one: a thin pool recycles, and "round one was fine" is
  // not evidence about a match that runs to a health pool emptying.
  const intersection = new Set(onlyStamp);
  const seenItems = new Set<string>();
  let rounds = 0;
  let lastRound = -1;
  for (let poll = 0; poll < 4000 && rounds < 3; poll += 1) {
    // BOTH sides must be polled. A read is what stamps a side present, so polling
    // only one forfeits the other as DISCONNECTED and the match ends at round one —
    // which is exactly how the first draft of this test lied about the walk.
    const res = await get(app, `/api/pvp/match/${matchId}`, guest);
    await get(app, `/api/pvp/match/${matchId}`, host);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as {
      snapshot: { round: number };
      question:
        | {
            itemId: string;
            codexCardIds: string[];
            offeredCardIds: string[];
            minSupport: number;
          }
        | null;
      result: unknown;
    };
    if (body.question && body.snapshot.round !== lastRound) {
      lastRound = body.snapshot.round;
      rounds += 1;
      seenItems.add(body.question.itemId);
      for (const card of body.question.codexCardIds) {
        assert.ok(
          intersection.has(card),
          `round ${lastRound} asked ${body.question.itemId}, which needs ${card} — outside the intersection`,
        );
      }
      // The dealt hand — decoys included — is drawn only from the shared deck, so
      // the thin side is never offered a card it would be UNAUTHORIZED to place.
      for (const card of body.question.offeredCardIds) {
        assert.ok(
          intersection.has(card),
          `round ${lastRound} dealt ${card}, which the guest may not place`,
        );
      }
      assert.ok(
        body.question.minSupport >= 1 &&
          body.question.minSupport <= body.question.offeredCardIds.length,
        "the round is answerable: the minimum is within the hand it dealt",
      );
      // Answer for both sides so the round turns over and the next one is drawn.
      await post(app, `/api/pvp/match/${matchId}/answer`, host, {
        answerText: "an answer",
        selectedCardIds: body.question.offeredCardIds,
      });
      await post(app, `/api/pvp/match/${matchId}/answer`, guest, {
        answerText: "an answer",
        selectedCardIds: body.question.offeredCardIds,
      });
    }
    if (body.result) break;
    clock.t += 84;
  }
  assert.ok(rounds >= 3, `the match served at least three rounds, served ${rounds}`);
  await app.close();
});
