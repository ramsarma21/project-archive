// The SHIPPING PvP card gate — `M1_PVP_CARD_ACCESS = "ASSESSMENT_PASSED"` — driven
// while the live constant is still `PLAYTEST_ALL`.
//
// WHY THIS FILE EXISTS SEPARATELY FROM `pvp-card-gate.test.ts`. That file proves the
// resolver's two branches against a STUB card set (`pvpLegalCardIds: async () =>
// minted`). That is worth having and it is not the same claim: it cannot see whether
// the derivation the server actually wires is reachable, whether real progression ever
// mints anything, or what the routes do when the two sides' card sets differ. Every
// test here drives the real progression service over the REAL shipped content pack,
// or the real routes, and asserts on what a player can actually reach.
//
// NOTHING HERE FLIPS THE CONSTANT. The policy is passed explicitly as
// `policy: "ASSESSMENT_PASSED"`, which is the seam `pvpCardResolver` already exposes,
// so these keep testing the shipping branch on the day the constant flips too.
//
// WHAT THESE TESTS FOUND, recorded here because a reader arrives at the test before
// the report: over the shipped content pack the capstone CANNOT BE SAT
// (`chapterConceptIds("boston-1765")` is `[]`, `assessmentId` is `null`), so no card
// can be minted and `ASSESSMENT_PASSED` grants nobody anything.
// `openChapterAssessment` refusing PACKAGE_MISSING is asserted below so that the day
// the capstone is authored, that assertion fails and points here.
//
// THE TWO RULES THIS FILE NOW PINS, both of which it was written to measure and which
// the owner then decided:
//
//   1. ACCESS FOLLOWS THE CARD. Eligibility reads each Codex row's own `pvpLegalAt`,
//      never `activeChapter.assessmentPassedAt`, so advancing a chapter does not
//      revoke what a capstone minted. A test below advances and asserts the nine
//      survive; it fails the moment eligibility goes back to reading the chapter.
//   2. MINTING DID NOT GET EASIER. `markCodexCardsPvpLegal` stays reachable only from
//      `submitChapterAssessment` — asserted structurally AND by driving every other
//      progression mutation a player can reach and finding nothing minted. Widening
//      who may mint would make thin question intersections normal, and a thin pool is
//      measured here rather than assumed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  pvpLegalCardIdsFromSnapshot,
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
 * `pvpLegalCardIdsFromSnapshot` is the production derivation, imported rather than
 * re-typed — a re-typed rule is a second implementation that agrees until it
 * doesn't, and this gate's whole correctness lives in that one line.
 */
function shippingResolver(service: ProgressionService) {
  return pvpCardResolver({
    m1CardIds: M1_CARDS,
    policy: "ASSESSMENT_PASSED",
    log: { warn: () => {} },
    pvpLegalCardIds: async (profileId) =>
      pvpLegalCardIdsFromSnapshot(await service.snapshot(profileId)),
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

// ---------------------------------------------------------------------------
// The capstone the shipped pack does not author.
// ---------------------------------------------------------------------------

const CAPSTONE_ASSESSMENT = "BOS.CAP.ASSESSMENT.v1";

/** M1's real chapter concepts, in the authored order. */
const CAPSTONE_CONCEPTS = [
  "BOS.CONCEPT.POSTWAR_REVENUE.v1",
  "BOS.CONCEPT.STAMP_SCOPE.v1",
  "BOS.CONCEPT.REPRESENTATION.v1",
] as const;

/**
 * A pack that authors ONLY the capstone, over M1's real concepts.
 *
 * Everything about cards and mastery stays the real thing — the authored cards, the
 * card→concept mapping, the 100%-or-nothing rule — and only the missing authoring is
 * supplied, because the shipped pack's capstone half does not exist. A reserve of four
 * items per concept comfortably covers the two a form draws plus a retry.
 */
function capstonePack(conceptIds: readonly string[]): Partial<ProgressionContent> {
  const reserve = new Map(
    conceptIds.map((conceptId, index) => [
      conceptId,
      [1, 2, 3, 4].map((n) => `CAP.${index}.${n}`),
    ]),
  );
  return {
    chapterConceptIds: () => [...conceptIds],
    assessmentId: () => CAPSTONE_ASSESSMENT,
    assessmentModuleId: () => "BOS.CAP.MODULE.v1",
    itemReserve: (_assessmentId, conceptId) => reserve.get(conceptId) ?? [],
    itemConcept: (itemId) => {
      for (const [conceptId, itemIds] of reserve) {
        if (itemIds.includes(itemId)) return conceptId;
      }
      return null;
    },
    itemFormat: () => "SELECTED_RESPONSE",
    isCorrectOption: (_itemId, optionId) => optionId === "OPT.RIGHT",
  };
}

interface CapstoneRun {
  readonly attemptOrdinal: number;
  readonly scopedConceptIds: readonly string[];
  readonly passed: boolean;
  readonly newlyPvpLegalCardIds: readonly string[];
}

/**
 * Sit the whole capstone and submit it, answering CORRECTLY only on
 * `masterConceptIds` and wrongly on the rest.
 *
 * Answering wrongly rather than skipping is what a student who tried and missed
 * actually produces, and a partial mint is the case per-card eligibility has to get
 * right — so it is driven here rather than simulated by writing rows.
 */
async function sitCapstone(
  service: ProgressionService,
  profileId: string,
  masterConceptIds: readonly string[],
): Promise<CapstoneRun> {
  const attempt = await service.openChapterAssessment(profileId, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    assessmentId: CAPSTONE_ASSESSMENT,
  });
  assert.equal(attempt.ok, true, `the authored capstone opens: ${JSON.stringify(attempt)}`);
  if (!attempt.ok) throw new Error("unreachable");
  for (const entry of attempt.value.form) {
    const mastering = masterConceptIds.includes(entry.conceptId);
    for (const itemId of entry.itemIds) {
      const answered = await service.answerAssessmentItem(profileId, {
        attemptId: attempt.value.attemptId,
        itemId,
        itemFormat: "SELECTED_RESPONSE",
        selectedOptionId: mastering ? "OPT.RIGHT" : "OPT.WRONG",
      });
      assert.equal(answered.ok, true, `${itemId} answered: ${JSON.stringify(answered)}`);
    }
  }
  const submitted = await service.submitChapterAssessment(
    profileId,
    attempt.value.attemptId,
  );
  assert.equal(submitted.ok, true, `submitted: ${JSON.stringify(submitted)}`);
  if (!submitted.ok) throw new Error("unreachable");
  return {
    attemptOrdinal: attempt.value.attemptOrdinal,
    scopedConceptIds: attempt.value.scopedConceptIds,
    passed: submitted.value.passed,
    newlyPvpLegalCardIds: submitted.value.newlyPvpLegalCardIds,
  };
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

  // The production derivation finds nothing minted, so the shipping resolver hands
  // out nothing. THIS IS THE "minting did not get easier" GUARD: the whole module and
  // a first-try mission clear is the most a player can do short of the capstone, and
  // it must still grant zero.
  assert.equal(snapshot.activeChapter.assessmentPassedAt, null);
  assert.deepEqual([...pvpLegalCardIdsFromSnapshot(snapshot)], []);
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
  // path is demonstrated over a pack that authors ONLY the capstone — see
  // `capstonePack`, which keeps M1's real cards, concepts and card→concept mapping.
  const concepts = [...CAPSTONE_CONCEPTS];
  const { store, service } = progression(capstonePack(concepts));
  const profileId = newProfileId();

  await completeM1Module(service, profileId);
  await clearM1(service, profileId);

  // 100% on every concept — the only thing that mints PvP legality.
  const run = await sitCapstone(service, profileId, concepts);
  assert.equal(run.attemptOrdinal, 1);
  assert.deepEqual([...run.scopedConceptIds], [...concepts]);
  assert.equal(run.passed, true);
  assert.deepEqual(
    [...run.newlyPvpLegalCardIds].sort(),
    [...M1_CARDS].sort(),
    "100% on all three concepts mints exactly the nine M1 cards",
  );

  // The durable rows, the predicate, and the resolver all agree.
  for (const card of store.codex.values()) {
    assert.ok(card.pvpLegalAt, `${card.cardId} is PvP-legal`);
  }
  const snapshot = await service.snapshot(profileId);
  assert.ok(snapshot.activeChapter.assessmentPassedAt);
  assert.deepEqual(
    [...pvpLegalCardIdsFromSnapshot(snapshot)].sort(),
    [...M1_CARDS].sort(),
  );
  assert.deepEqual(
    [...(await shippingResolver(service)(profileId))].sort(),
    [...M1_CARDS].sort(),
    "ASSESSMENT_PASSED grants the nine once the capstone has passed",
  );
});

test("ADVANCING A CHAPTER KEEPS the PvP access the capstone minted", async () => {
  // The defect this replaces, for the record: eligibility used to read
  // `activeChapter.assessmentPassedAt`, and `advanceChapter` makes the NEXT chapter
  // active with its own null value while the Codex rows keep `pvpLegalAt` forever. So
  // a player who passed Boston and moved on lost the cards they earned, while their
  // Codex screen went on showing them as PvP-legal — the server refusing what the UI
  // promised. Access now follows the CARD.
  //
  // THIS TEST IS THE GUARD on that. Point the derivation back at the active chapter
  // and the final assertion fails, because the advanced chapter has passed nothing.
  const concepts = [CAPSTONE_CONCEPTS[0]];
  const { store, service } = progression(capstonePack(concepts));
  const profileId = newProfileId();
  await completeM1Module(service, profileId);
  const run = await sitCapstone(service, profileId, concepts);
  assert.equal(run.passed, true, "every scoped concept was mastered");
  const minted = run.newlyPvpLegalCardIds;
  assert.deepEqual(
    [...minted].sort(),
    [...SHIPPED.codexCardsForConcept(concepts[0]!)].sort(),
    "mastering the one scoped concept mints its cards",
  );

  const resolve = shippingResolver(service);
  const before = await resolve(profileId);
  assert.deepEqual(
    [...before].sort(),
    [...minted].sort(),
    "access is open on exactly the minted cards after the capstone",
  );

  const advanced = await service.advanceChapter(profileId, "boston-1766");
  assert.equal(advanced.ok, true, `advance: ${JSON.stringify(advanced)}`);

  // The active chapter genuinely has passed nothing — so this is not a test that
  // would still pass if eligibility went back to reading the chapter.
  const after = await service.snapshot(profileId);
  assert.equal(after.activeChapter.chapterId, "boston-1766");
  assert.equal(after.activeChapter.assessmentPassedAt, null);

  // The durable Codex says PvP-legal…
  const stillLegal = [...store.codex.values()]
    .filter((card) => card.pvpLegalAt !== null)
    .map((card) => card.cardId);
  assert.deepEqual(
    stillLegal.sort(),
    [...minted].sort(),
    "the cards the mastered concept minted keep their pvpLegalAt across chapters",
  );
  // …and the server now agrees with it, which is what makes the Codex screen truthful
  // rather than a promise the server refuses.
  assert.deepEqual(
    [...(await resolve(profileId))].sort(),
    [...minted].sort(),
    "advancing a chapter must NOT revoke the PvP access the capstone earned",
  );
});

test("a PARTIAL capstone grants exactly the mastered concept's cards and withholds the rest", async () => {
  // The case the old all-or-nothing reading could not express: `assessmentPassedAt` is
  // written only when EVERY scoped concept is mastered, so a student who masters one
  // of three got nothing while their Codex showed three cards as PvP-legal. Per-card
  // eligibility grants the three they earned and none of the six they did not.
  const concepts = [...CAPSTONE_CONCEPTS];
  const { service } = progression(capstonePack(concepts));
  const profileId = newProfileId();
  await completeM1Module(service, profileId);

  const mastered = [concepts[0]!];
  const run = await sitCapstone(service, profileId, mastered);
  assert.equal(run.passed, false, "two of three concepts were missed, so it did not pass");
  const expected = [...SHIPPED.codexCardsForConcept(concepts[0]!)];
  assert.ok(expected.length > 0, "the concept authors cards to mint");
  assert.deepEqual([...run.newlyPvpLegalCardIds].sort(), [...expected].sort());

  const snapshot = await service.snapshot(profileId);
  assert.equal(
    snapshot.activeChapter.assessmentPassedAt,
    null,
    "a partial capstone passes no chapter, which is why the old reading granted nothing",
  );
  const granted = await shippingResolver(service)(profileId);
  assert.deepEqual([...granted].sort(), [...expected].sort(), "exactly the earned three");
  assert.ok(granted.length < M1_CARDS.length, "and strictly fewer than the whole deck");

  // Not merely "fewer": the specific cards of the UNMASTERED concepts are withheld.
  const withheld = concepts
    .slice(1)
    .flatMap((conceptId) => [...SHIPPED.codexCardsForConcept(conceptId)]);
  assert.ok(withheld.length > 0);
  for (const cardId of withheld) {
    assert.equal(
      granted.includes(cardId),
      false,
      `${cardId} belongs to a concept that was not mastered and must not be granted`,
    );
  }

  // What a thin grant costs, MEASURED rather than assumed, because "thin pools" is the
  // exact reason widening who may mint is a separate decision. The measured figures
  // across the three concepts are 9 / 7 / 9 items, against 25 for the whole deck.
  //
  // WHY THAT IS FINE HERE and would not be for a lesson: mastery is per CONCEPT, so the
  // smallest grant this path can produce is a concept's three cards, not an arbitrary
  // single one. The degenerate 0–4 item pools that make thin intersections a problem
  // come from granting arbitrary subsets, which nothing here does.
  const pool = eligiblePvpItems({
    askable: askableItems(pvpQuestionBank(), { A: granted, B: granted }),
    mastered: { A: [], B: [] },
  });
  assert.equal(
    pool.length,
    9,
    `one mastered concept yields a playable pool; got ${pool.length} items`,
  );
});

test("minting stays reachable ONLY from submitChapterAssessment — one call site, in one method", async () => {
  // THE LOAD-BEARING INVARIANT behind per-card eligibility. Access now follows
  // `pvpLegalAt`, so whatever can write it decides who may be asked what. A prior
  // measurement is why this is guarded rather than trusted: a lesson granting subsets
  // would make thin question intersections normal, yielding as few as 0–4 askable
  // items against @pa/duel's 24-round ceiling.
  //
  // Structural, because behaviour cannot prove the ABSENCE of a call site on a path no
  // test drives. A second caller anywhere fails the count; moving the one caller out of
  // `submitChapterAssessment` fails the boundary.
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/progression/service.ts"),
    "utf8",
  );
  const callSites = [...source.matchAll(/markCodexCardsPvpLegal\s*\(/g)];
  assert.equal(callSites.length, 1, "exactly one place mints a PvP-legal card");

  const submit = source.indexOf("async submitChapterAssessment(");
  assert.ok(submit > 0, "submitChapterAssessment is still where minting belongs");
  const nextMethod = source.indexOf("\n  async ", submit + 1);
  assert.ok(nextMethod > submit, "found the end of submitChapterAssessment");
  const at = callSites[0]!.index!;
  assert.ok(
    at > submit && at < nextMethod,
    "the one call site sits inside submitChapterAssessment and nowhere else",
  );
});

test("no progression mutation OTHER than submitting mints a card, over a pack where minting is possible", async () => {
  // The behavioural half. The capstone is authored here, so minting is genuinely
  // reachable — this is not a vacuous pass over a pack that can never mint.
  const concepts = [...CAPSTONE_CONCEPTS];
  const { store, service } = progression(capstonePack(concepts));
  const profileId = newProfileId();
  const nothingMinted = (after: string): void => {
    for (const card of store.codex.values()) {
      if (card.profileId !== profileId) continue;
      assert.equal(card.pvpLegalAt, null, `${card.cardId} was minted by ${after}`);
    }
  };

  await completeM1Module(service, profileId);
  nothingMinted("completing the learning module");
  await clearM1(service, profileId);
  nothingMinted("clearing the mission");
  await service.resetMissionAttempts(profileId, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    missionId: M1_MISSION_ID,
  });
  nothingMinted("resetting the mission");
  await completeM1Module(service, profileId);
  await clearM1(service, profileId);
  nothingMinted("re-running the module and mission");

  // The sharpest case: sit the capstone and answer EVERY item correctly, then walk
  // away instead of submitting. The student demonstrably knew all of it; only the
  // submission mints, so nothing is minted.
  const attempt = await service.openChapterAssessment(profileId, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    assessmentId: CAPSTONE_ASSESSMENT,
  });
  assert.equal(attempt.ok, true, `the capstone opens: ${JSON.stringify(attempt)}`);
  if (!attempt.ok) return;
  nothingMinted("opening the capstone");
  for (const entry of attempt.value.form) {
    for (const itemId of entry.itemIds) {
      const answered = await service.answerAssessmentItem(profileId, {
        attemptId: attempt.value.attemptId,
        itemId,
        itemFormat: "SELECTED_RESPONSE",
        selectedOptionId: "OPT.RIGHT",
      });
      assert.equal(answered.ok, true, `${itemId} answered`);
      nothingMinted(`answering ${itemId} correctly`);
    }
  }
  const abandoned = await service.abandonChapterAssessment(profileId, {
    attemptId: attempt.value.attemptId,
    reason: "WALKED_AWAY",
  });
  assert.equal(abandoned.ok, true, `abandon: ${JSON.stringify(abandoned)}`);
  nothingMinted("abandoning a fully-correct capstone");

  assert.deepEqual(
    [...(await shippingResolver(service)(profileId))],
    [],
    "and the shipping resolver grants nothing to any of it",
  );

  // The same pack, a fresh profile, submitting: nine minted. So the assertions above
  // were measuring a live mint path rather than an inert one. A second profile rather
  // than a retry on this one, because a retry needs its own assessment-module
  // completion (MODULE_REQUIRED) and that gate is not what this test is about.
  const other = newProfileId();
  await completeM1Module(service, other);
  const run = await sitCapstone(service, other, concepts);
  assert.equal(run.passed, true);
  assert.equal(
    run.newlyPvpLegalCardIds.length,
    M1_CARDS.length,
    "submitting a mastered capstone is the one thing that mints",
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

test("AN UNENTITLED GUEST is refused with the entitlement reason, not a content gap, and nothing is left half-built", async () => {
  // The case PLAYTEST_ALL can never produce, and therefore the case nothing had ever
  // executed. The host is entitled; the guest holds nothing.
  //
  // THE DEFECT THIS GUARDS: `/join` never called `assertPvpEligible`, so the guest
  // fell through to the empty intersection and was refused 409 NO_QUESTIONS — "no
  // question could be drawn", which reads as the bank running out. The refusal was
  // right and the reason was misleading, and it would send somebody debugging content
  // when the answer is progression. Revert the check and this test fails on the code
  // AND on the reason.
  const all = allAskableCardIds(pvpQuestionBank());
  const host = sid("host");
  const guest = sid("guest");
  const { app } = await routes((profileId) => (profileId === host ? all : []));

  const created = await post(app, "/api/pvp/lobby", host);
  assert.equal(created.statusCode, 200, created.body);
  const code = created.json().code as string;

  const joined = await post(app, `/api/pvp/lobby/${code}/join`, guest);
  assert.equal(joined.statusCode, 403, joined.body);
  assert.equal(
    joined.json().error,
    "NO_PVP_LEGAL_CARDS",
    "the guest is told what is true of THEM, not that the question bank is empty",
  );
  assert.match(
    String(joined.json().message),
    /mastered/,
    "and the detail names progression rather than content",
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

test("the guest's entitlement is decided BEFORE any lobby state is read", async () => {
  // Which is what makes the refusal cost nothing: no lobby is looked up, no profile
  // lock is taken, so a refused join cannot leave a lobby half-started or spend the
  // host's one commitment slot. Provable from outside: an unentitled caller joining a
  // code that does not exist is still refused on their own standing, not with 404.
  const { app } = await routes(() => []);
  const res = await post(app, "/api/pvp/lobby/QQQQQQ/join", sid("guest"));
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error, "NO_PVP_LEGAL_CARDS");
  await app.close();
});

test("NO_QUESTIONS still means what it says: two ENTITLED players whose cards do not overlap", async () => {
  // The reason for the fix was that one refusal was wearing the other's name, so the
  // fix is only right if BOTH remain reachable and distinguishable. Here each side
  // genuinely holds minted cards — neither is refused at the gate — and the pool is
  // empty only because their holdings are disjoint. That is a content-shaped answer
  // and NO_QUESTIONS is the honest one.
  const host = sid("host");
  const guest = sid("guest");
  const hostCards = ["BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1", "BOS.MD01.CARD.STAMP_DATE.v1"];
  const guestCards = ["BOS.MD01.CARD.WAR_DEBT.v1"];
  const { app } = await routes((profileId) =>
    profileId === host ? hostCards : guestCards,
  );

  const created = await post(app, "/api/pvp/lobby", host);
  assert.equal(created.statusCode, 200, created.body);
  const code = created.json().code as string;

  const joined = await post(app, `/api/pvp/lobby/${code}/join`, guest);
  assert.equal(joined.statusCode, 409, joined.body);
  assert.equal(joined.json().error, "NO_QUESTIONS");

  // Same "nothing half-built" contract on this path too, which is the behaviour the
  // NO_QUESTIONS refusal already had and must keep.
  const hostView = await get(app, `/api/pvp/lobby/${code}`, host);
  assert.equal(hostView.json().status, "OPEN");
  assert.equal(hostView.json().matchId, null);
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
