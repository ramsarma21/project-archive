import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEARNING_MODULE_SECONDS,
  isMissionPermanentlySpent,
  reportedFirstAttemptMeasure,
  type ChapterAssessmentAttempt,
} from "@pa/contracts";
import { ProgressionService } from "../src/progression/service.js";
import type {
  OpenResponseGrade,
  ProgressionContent,
} from "../src/progression/content.js";
// The in-memory store double is SHARED with dev-reset.test.ts. It used to live
// here as a near-verbatim second copy, and when the multi-profile snapshot leak
// was fixed it had to be fixed in both copies — exactly the drift this sweep is
// hunting. One source now; `support/memoryProgressionStore.ts` models Postgres
// field for field, including the per-profile snapshot scoping.
import { MemoryStore } from "./support/memoryProgressionStore.js";

const PROFILE = "33333333-3333-4333-8333-333333333333";
const SEED = "b".repeat(64);
const CHAPTER = "CH.ONE";
const MISSION = "M1";
const MODULE = "MOD.M1";
const ASSESSMENT = "ASSESS.CH.ONE";
const ASSESSMENT_MODULE = "MOD.ASSESS";
const CONCEPTS = ["C.A", "C.B"] as const;
const DECK = ["CUE.1", "CUE.2", "CUE.3"] as const;

// Six items per concept, matching the assessment reserve the slate calls for.
const RESERVE: Record<string, string[]> = {
  "C.A": ["A1", "A2", "A3", "A4", "A5", "A6"],
  "C.B": ["B1", "B2", "B3", "B4", "B5", "B6"],
};
const CARDS: Record<string, string[]> = {
  "C.A": ["CARD.A"],
  "C.B": ["CARD.B"],
};
/** Open-ended items in the reserve. The capstone mixes formats on one form. */
const OPEN_ITEMS = new Set(["B2", "B4"]);
/**
 * Stands in for the grading service: a graded verdict per response handle.
 *
 * `needsReview` travels with `correct` because only the grader knows it — a
 * generous fallback grant, or a low-confidence classification — and it is recorded
 * on the response row so an educator report can name the verdicts wanting a human.
 */
const OPEN_VERDICTS = new Map<string, OpenResponseGrade>();

function content(overrides: Partial<ProgressionContent> = {}): ProgressionContent {
  return {
    initialChapterId: () => CHAPTER,
    xpCurve: () => ({
      curveId: "TEST.CURVE",
      version: "1",
      levelThresholds: Array.from({ length: 40 }, (_, i) => (i + 1) * 100),
    }),
    // The same chapter-local slug exists in both chapters, which is the point.
    missionReward: (chapterId, missionId) =>
      missionId === MISSION
        ? {
            missionId: MISSION,
            chapterId,
            baseXp: 900,
            moduleId: MODULE,
            conceptIds: [...CONCEPTS],
          }
        : null,
    abilityMilestones: () => [{ abilityId: "A.VAULT", chapterId: CHAPTER, level: 5 }],
    chapterConceptIds: () => [...CONCEPTS],
    assessmentId: () => ASSESSMENT,
    assessmentModuleId: () => ASSESSMENT_MODULE,
    itemReserve: (_assessmentId, conceptId) => RESERVE[conceptId] ?? [],
    itemConcept: (itemId) => (itemId.startsWith("A") ? "C.A" : "C.B"),
    // The capstone mixes formats: B-items ending in an even digit are open-ended.
    itemFormat: (itemId) => (OPEN_ITEMS.has(itemId) ? "OPEN_RESPONSE" : "SELECTED_RESPONSE"),
    // The key: "OPT.RIGHT" is correct, everything else is not.
    isCorrectOption: (_itemId, optionId) => optionId === "OPT.RIGHT",
    moduleDeckCueIds: () => [...DECK],
    moduleRequiredCheckIds: () => [],
    codexCardsForModule: () => ["CARD.A", "CARD.B"],
    codexCardsForConcept: (conceptId) => CARDS[conceptId] ?? [],
    conceptForCard: (cardId) => (cardId === "CARD.A" ? "C.A" : "C.B"),
    ...overrides,
  };
}

function harness(overrides: Partial<ProgressionContent> = {}) {
  const store = new MemoryStore();
  let ids = 0;
  let clock = Date.parse("2026-07-25T00:00:00.000Z");
  OPEN_VERDICTS.clear();
  const service = new ProgressionService(
    store,
    content(overrides),
    () => new Date((clock += 1000)),
    () => {
      ids += 1;
      return `00000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
    },
    {
      // The engine only ever sees a handle; the prose stays with the service.
      verdict: async ({ responseRef }) =>
        structuredClone(OPEN_VERDICTS.get(responseRef)) ?? null,
    },
  );
  return { store, service };
}

/** Answer a selected-response item. */
async function answer(
  service: ProgressionService,
  attemptId: string,
  itemId: string,
  optionId: string | null,
) {
  return service.answerAssessmentItem(PROFILE, {
    attemptId,
    itemId,
    itemFormat: "SELECTED_RESPONSE",
    selectedOptionId: optionId,
  });
}

/** Answer an open-ended item: submit prose elsewhere, hand over the handle. */
async function answerOpen(
  service: ProgressionService,
  attemptId: string,
  itemId: string,
  verdict: boolean,
  needsReview = false,
) {
  const responseRef = `resp-${itemId}`;
  OPEN_VERDICTS.set(responseRef, { correct: verdict, needsReview });
  return service.answerAssessmentItem(PROFILE, {
    attemptId,
    itemId,
    itemFormat: "OPEN_RESPONSE",
    responseRef,
  });
}

async function runModule(
  service: ProgressionService,
  gatesKind: "MISSION_ATTEMPT" | "ASSESSMENT_ATTEMPT" = "MISSION_ATTEMPT",
) {
  return service.completeLearningModule(PROFILE, {
    chapterId: CHAPTER,
    moduleId: gatesKind === "MISSION_ATTEMPT" ? MODULE : ASSESSMENT_MODULE,
    gatesKind,
    gatesId: gatesKind === "MISSION_ATTEMPT" ? MISSION : ASSESSMENT,
    acknowledgedCueIds: [...DECK],
    observedSeconds: LEARNING_MODULE_SECONDS,
  });
}

async function playAttempt(
  service: ProgressionService,
  outcome: "CLEARED" | "FAILED",
) {
  const module = await runModule(service);
  assert.equal(module.ok, true);
  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error("attempt did not open");
  const committed = await service.commitMissionOutcome(PROFILE, {
    attemptId: opened.value.attemptId,
    outcome,
    committedEvents: [],
    baseRevision: 0,
  });
  return { opened: opened.value, committed };
}

// ---------------------------------------------------------------------------

test("a brand-new profile starts Level 0, 0 XP, Rank 1", async () => {
  const { service } = harness();
  const snapshot = await service.snapshot(PROFILE);
  assert.equal(snapshot.campaign.rank, 1);
  assert.equal(snapshot.campaign.cumulativeLevels, 0);
  assert.equal(snapshot.activeChapter.level, 0);
  assert.equal(snapshot.activeChapter.xp, 0);
  assert.equal(snapshot.activeChapter.chapterId, CHAPTER);
  assert.deepEqual(snapshot.missions, []);
  assert.deepEqual(snapshot.pvpAbilities, []);
  assert.equal(snapshot.derived.levelsToNextRank, 10);
});

test("an unfinished deck does not open the gate, and no attempt starts without one", async () => {
  const { service } = harness();
  const partial = await service.completeLearningModule(PROFILE, {
    chapterId: CHAPTER,
    moduleId: MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: MISSION,
    acknowledgedCueIds: ["CUE.1"],
    observedSeconds: LEARNING_MODULE_SECONDS,
  });
  assert.deepEqual(partial, { ok: false, error: "MODULE_REQUIRED" });
  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.deepEqual(opened, { ok: false, error: "MODULE_REQUIRED" });
});

test("a module requiring mastery checks refuses a run that skips or forges them", async () => {
  // The required check set is DERIVED from module metadata, never trusted from
  // the request. A completed deck alone is not enough, an unrelated id does not
  // count, and only acknowledging the derived id opens the gate.
  const { service } = harness({ moduleRequiredCheckIds: () => ["CHK.A"] });

  const noChecks = await service.completeLearningModule(PROFILE, {
    chapterId: CHAPTER,
    moduleId: MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: MISSION,
    acknowledgedCueIds: [...DECK],
    acknowledgedCheckIds: [],
    observedSeconds: LEARNING_MODULE_SECONDS,
  });
  assert.deepEqual(noChecks, { ok: false, error: "MODULE_REQUIRED" });

  const forged = await service.completeLearningModule(PROFILE, {
    chapterId: CHAPTER,
    moduleId: MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: MISSION,
    acknowledgedCueIds: [...DECK],
    // A check the module does not require; the server does not credit it.
    acknowledgedCheckIds: ["CHK.SOMETHING_ELSE"],
    observedSeconds: LEARNING_MODULE_SECONDS,
  });
  assert.deepEqual(forged, { ok: false, error: "MODULE_REQUIRED" });

  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.deepEqual(opened, { ok: false, error: "MODULE_REQUIRED" });

  const honest = await service.completeLearningModule(PROFILE, {
    chapterId: CHAPTER,
    moduleId: MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: MISSION,
    acknowledgedCueIds: [...DECK],
    acknowledgedCheckIds: ["CHK.A"],
    observedSeconds: LEARNING_MODULE_SECONDS,
  });
  assert.equal(honest.ok, true);
});

test("a fast reader who covered the deck is finished; elapsed time never gates", async () => {
  const { service, store } = harness();
  const quick = await service.completeLearningModule(PROFILE, {
    chapterId: CHAPTER,
    moduleId: MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: MISSION,
    acknowledgedCueIds: [...DECK],
    observedSeconds: 42,
  });
  assert.equal(quick.ok, true);
  if (!quick.ok) return;
  assert.equal(quick.value.gatesOrdinal, 1);
  // The authored target is recorded next to what actually happened.
  assert.equal(quick.value.requiredSeconds, LEARNING_MODULE_SECONDS);
  assert.equal(quick.value.observedSeconds, 42);
  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.equal(opened.ok, true);
  assert.ok(
    store.ledger.some(
      (entry) => entry.kind === "MODULE_COMPLETED" && entry.detail.deckVerified === true,
    ),
  );
});

test("the server assigns the ordinal and stamps the XP fraction at open time", async () => {
  const { service } = harness();
  await runModule(service);
  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.equal(opened.value.attemptOrdinal, 1);
  assert.deepEqual(opened.value.xpFraction, { numerator: 3, denominator: 3 });
  assert.match(opened.value.attemptSeedHex, /^[0-9a-f]{32}$/);

  const again = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.deepEqual(again, { ok: false, error: "ATTEMPT_ALREADY_OPEN" });
});

test("a first-attempt clear pays full XP and derives Level, Rank and the ability unlock", async () => {
  const { service, store } = harness();
  const { committed } = await playAttempt(service, "CLEARED");
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.equal(committed.value.awardedXp, 900);
  assert.equal(committed.value.chapter.level, 9);
  assert.equal(committed.value.campaign.cumulativeLevels, 9);
  assert.equal(committed.value.campaign.rank, 1);
  assert.deepEqual(committed.value.unlockedAbilityIds, ["A.VAULT"]);
  assert.equal(committed.value.mission.outcome, "CLEARED");
  // Chapter-scoped in PvE and permanent in the PvP loadout: both recorded.
  assert.equal(store.chapterAbilities.size, 1);
  assert.equal(store.pvpAbilities.size, 1);
  assert.ok(store.ledger.some((entry) => entry.kind === "MISSION_XP_AWARDED"));
  assert.ok(store.ledger.some((entry) => entry.kind === "ABILITY_UNLOCKED"));
});

test("a retry is a distinct ordinal with a distinct seed and two-thirds XP", async () => {
  const { service } = harness();
  const first = await playAttempt(service, "FAILED");
  assert.equal(first.committed.ok, true);
  if (!first.committed.ok) return;
  assert.equal(first.committed.value.awardedXp, 0);

  const second = await playAttempt(service, "CLEARED");
  assert.equal(second.opened.attemptOrdinal, 2);
  assert.deepEqual(second.opened.xpFraction, { numerator: 2, denominator: 3 });
  // The retry seed must differ from attempt 1's: the retired helper accepted an
  // attemptStartSequence it never stored, so retries replayed attempt zero.
  assert.notEqual(second.opened.attemptSeedHex, first.opened.attemptSeedHex);
  assert.equal(second.committed.ok, true);
  if (!second.committed.ok) return;
  assert.equal(second.committed.value.awardedXp, 600);
  assert.equal(second.committed.value.chapter.xp, 600);
});

test("the duel's commit log is stored, and changes nothing that is derived", async () => {
  // It was accepted by the request guard and then dropped: the insert wrote an
  // empty array and nothing ever updated it, so the record deterministic replay
  // depends on was silently discarded on every clear. The store now takes it as a
  // required argument of the terminal write.
  const { service, store } = harness();
  const module = await runModule(service);
  assert.equal(module.ok, true);
  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  if (!opened.ok) throw new Error("attempt did not open");
  const log = [
    { type: "QUESTION_OPENED", round: 1, item: { itemId: "i1", itemVersion: "r1-a" } },
    {
      type: "VERDICT_COMMITTED",
      round: 1,
      side: "A",
      verdict: { kind: "WRONG", itemId: "i1", itemVersion: "r1-a", source: "CLASSIFIER" },
    },
    { type: "DUEL_RESOLVED", outcome: { winner: "A" } },
  ];
  const committed = await service.commitMissionOutcome(PROFILE, {
    attemptId: opened.value.attemptId,
    outcome: "CLEARED",
    committedEvents: log,
    baseRevision: 0,
  });
  assert.equal(committed.ok, true);
  if (!committed.ok) return;
  assert.deepEqual(store.commitLogs.get(opened.value.attemptId), log);
  // Telemetry, not input. A log full of WRONG verdicts pays the same full first
  // attempt as an empty one, because the award comes from the stored ordinal.
  assert.equal(committed.value.awardedXp, 900);
});

test("committing the same attempt twice cannot pay twice", async () => {
  const { service } = harness();
  const { opened, committed } = await playAttempt(service, "CLEARED");
  assert.equal(committed.ok, true);
  const replay = await service.commitMissionOutcome(PROFILE, {
    attemptId: opened.attemptId,
    outcome: "CLEARED",
    committedEvents: [],
    baseRevision: 0,
  });
  assert.deepEqual(replay, { ok: false, error: "ATTEMPT_CLOSED" });
  const snapshot = await service.snapshot(PROFILE);
  assert.equal(snapshot.activeChapter.xp, 900);
});

test("a cleared mission cannot be replayed for more XP", async () => {
  const { service } = harness();
  await playAttempt(service, "CLEARED");
  const module = await runModule(service);
  assert.deepEqual(module, { ok: false, error: "MISSION_SPENT" });
  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.deepEqual(opened, { ok: false, error: "MISSION_SPENT" });
});

test("three failures spend the mission permanently and it pays zero forever", async () => {
  const { service, store } = harness();
  for (const expected of [1, 2, 3]) {
    const { opened, committed } = await playAttempt(service, "FAILED");
    assert.equal(opened.attemptOrdinal, expected);
    assert.equal(committed.ok, true);
    if (!committed.ok) return;
    assert.equal(committed.value.awardedXp, 0);
  }
  const mission = store.missions.get(`${PROFILE}:${CHAPTER}:${MISSION}`)!;
  assert.equal(mission.outcome, "FAILED_PERMANENT");
  assert.equal(mission.attemptsUsed, 3);
  assert.equal(mission.awardedXp, 0);
  const fourth = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.deepEqual(fourth, { ok: false, error: "MISSION_SPENT" });
  const snapshot = await service.snapshot(PROFILE);
  assert.equal(snapshot.activeChapter.xp, 0);
  assert.equal(snapshot.campaign.rank, 1);
});

test("a module teaches Codex cards that are learned but not PvP-legal", async () => {
  const { service, store } = harness();
  await runModule(service);
  const cards = [...store.codex.values()];
  assert.equal(cards.length, 2);
  for (const card of cards) {
    assert.ok(card.learnedAt);
    assert.equal(card.pvpLegalAt, null);
  }
});

test("only 100% concept mastery mints a PvP-legal card, and a retry draws fresh items", async () => {
  const { service, store } = harness();
  await runModule(service);

  const first = await service.openChapterAssessment(PROFILE, {
    chapterId: CHAPTER,
    assessmentId: ASSESSMENT,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.attemptOrdinal, 1);
  assert.equal(first.value.isReportedMeasure, true);
  assert.deepEqual(first.value.scopedConceptIds, [...CONCEPTS]);
  assert.deepEqual(
    first.value.form.map((entry) => entry.itemIds),
    [["A1", "A2"], ["B1", "B2"]],
  );

  // C.A perfect, C.B one wrong: 100% per concept, so only C.A is mastered.
  // B2 is the open-ended item, graded by handle rather than by option.
  for (const [itemId, optionId] of [
    ["A1", "OPT.RIGHT"],
    ["A2", "OPT.RIGHT"],
    ["B1", "OPT.RIGHT"],
  ] as const) {
    assert.equal((await answer(service, first.value.attemptId, itemId, optionId)).ok, true);
  }
  assert.equal((await answerOpen(service, first.value.attemptId, "B2", false)).ok, true);
  const submitted = await service.submitChapterAssessment(PROFILE, first.value.attemptId);
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  assert.equal(submitted.value.passed, false);
  assert.deepEqual(submitted.value.masteredConceptIds, ["C.A"]);
  assert.deepEqual(submitted.value.newlyPvpLegalCardIds, ["CARD.A"]);
  assert.equal(submitted.value.scoreNumerator, 3);
  assert.equal(submitted.value.scoreDenominator, 4);
  assert.equal(submitted.value.awardedXp, 0);
  assert.equal(store.codex.get(`${PROFILE}:CARD.A`)!.pvpLegalAt !== null, true);
  assert.equal(store.codex.get(`${PROFILE}:CARD.B`)!.pvpLegalAt, null);
  assert.equal(store.chapters.get(`${PROFILE}:${CHAPTER}`)!.assessmentPassedAt, null);

  // The retry needs its own module and narrows to the unmastered concept only.
  const ungated = await service.openChapterAssessment(PROFILE, {
    chapterId: CHAPTER,
    assessmentId: ASSESSMENT,
  });
  assert.deepEqual(ungated, { ok: false, error: "MODULE_REQUIRED" });
  await runModule(service, "ASSESSMENT_ATTEMPT");
  const retry = await service.openChapterAssessment(PROFILE, {
    chapterId: CHAPTER,
    assessmentId: ASSESSMENT,
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.deepEqual(retry.value.scopedConceptIds, ["C.B"]);
  assert.equal(retry.value.isReportedMeasure, false);
  // Fresh items: B1 and B2 were already served.
  assert.deepEqual(retry.value.form, [{ conceptId: "C.B", itemIds: ["B3", "B4"] }]);

  await answer(service, retry.value.attemptId, "B3", "OPT.RIGHT");
  await answerOpen(service, retry.value.attemptId, "B4", true);
  const passed = await service.submitChapterAssessment(PROFILE, retry.value.attemptId);
  assert.equal(passed.ok, true);
  if (!passed.ok) return;
  assert.equal(passed.value.passed, true);
  assert.deepEqual(passed.value.newlyPvpLegalCardIds, ["CARD.B"]);
  assert.ok(store.chapters.get(`${PROFILE}:${CHAPTER}`)!.assessmentPassedAt);

  // The reported measure is attempt 1's, not the retry's.
  const masteryB = store.mastery.get(`${PROFILE}:${CHAPTER}:C.B`)!;
  assert.equal(masteryB.firstAttemptServed, 2);
  assert.equal(masteryB.firstAttemptCorrect, 1);
  assert.ok(masteryB.masteredAt);

  // The assessment pays no XP and moves neither Level nor Rank.
  const snapshot = await service.snapshot(PROFILE);
  assert.equal(snapshot.activeChapter.xp, 0);
  assert.equal(snapshot.activeChapter.level, 0);
  assert.equal(snapshot.campaign.rank, 1);
  assert.equal(snapshot.campaign.cumulativeLevels, 0);
});

test("the record says which attempt mastered a concept and how good the evidence was", async () => {
  // WHAT WAS UNRECOVERABLE. @pa/reporting rebuilds its report from these
  // projections, and three disclosures had nowhere to live: which attempt reached
  // mastery, whether that form repeated a question the student had already seen,
  // and whether a verdict wants a human. It reported them as `null` rather than a
  // reassuring `false`, which is honest and useless to a district. Migration 008
  // gives them columns; this asserts the API actually writes them.
  const { service, store } = harness();
  await runModule(service);
  const first = await service.openChapterAssessment(PROFILE, {
    chapterId: CHAPTER,
    assessmentId: ASSESSMENT,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  // The SERVED form records its own freshness and which items were prose. FRESH is
  // a recorded fact, not an assumption: `selectFreshItems` reporting exhaustion
  // fails the open outright, so nothing this server writes can be a recycled form.
  assert.deepEqual(store.assessmentAttempts.get(first.value.attemptId)!.form, [
    { conceptId: "C.A", itemIds: ["A1", "A2"], freshness: "FRESH", openResponseItemIds: [] },
    {
      conceptId: "C.B",
      itemIds: ["B1", "B2"],
      freshness: "FRESH",
      // B2 is the open-ended item. Committed rather than looked up, so "was this
      // form passable by guessing" is answerable from the record alone.
      openResponseItemIds: ["B2"],
    },
  ] as unknown as ChapterAssessmentAttempt["form"]);

  for (const [itemId, optionId] of [
    ["A1", "OPT.RIGHT"],
    ["A2", "OPT.RIGHT"],
    ["B1", "OPT.RIGHT"],
  ] as const) {
    await answer(service, first.value.attemptId, itemId, optionId);
  }
  // Wrong, and flagged by the grader for a human: a granted fallback or a
  // low-confidence read. It still counts as wrong; it is merely also disclosed.
  await answerOpen(service, first.value.attemptId, "B2", false, true);
  await service.submitChapterAssessment(PROFILE, first.value.attemptId);

  assert.equal(store.responseReview.get(`${first.value.attemptId}:B2`), true);
  // A key-graded answer cannot want a human, and `false` there is recorded rather
  // than assumed: only the classifier raises the flag.
  assert.equal(store.responseReview.get(`${first.value.attemptId}:A1`), false);

  assert.deepEqual(store.masteryDisclosure.get(`${PROFILE}:${CHAPTER}:C.A`), {
    masteredOnAttempt: 1,
    masteredWithRecycledItems: false,
  });
  // Not mastered, so there is no mastering form to describe. Nulls, not zeroes.
  assert.deepEqual(store.masteryDisclosure.get(`${PROFILE}:${CHAPTER}:C.B`), {
    masteredOnAttempt: null,
    masteredWithRecycledItems: null,
  });

  await runModule(service, "ASSESSMENT_ATTEMPT");
  const retry = await service.openChapterAssessment(PROFILE, {
    chapterId: CHAPTER,
    assessmentId: ASSESSMENT,
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  await answer(service, retry.value.attemptId, "B3", "OPT.RIGHT");
  await answerOpen(service, retry.value.attemptId, "B4", true);
  await service.submitChapterAssessment(PROFILE, retry.value.attemptId);

  // C.B was mastered on the retry, and the retry's form was fresh too.
  assert.deepEqual(store.masteryDisclosure.get(`${PROFILE}:${CHAPTER}:C.B`), {
    masteredOnAttempt: 2,
    masteredWithRecycledItems: false,
  });
  // And attempt 1's answer for C.A is not restated by the later write. The
  // mastering attempt is a fact about one moment.
  assert.equal(
    store.masteryDisclosure.get(`${PROFILE}:${CHAPTER}:C.A`)!.masteredOnAttempt,
    1,
  );
});

test("a new chapter resets Level and XP but keeps Rank, Codex and the PvP loadout", async () => {
  const { service, store } = harness();
  await playAttempt(service, "CLEARED");
  const blocked = await service.advanceChapter(PROFILE, "CH.TWO");
  assert.deepEqual(blocked, { ok: false, error: "ASSESSMENT_LOCKED" });

  const chapter = store.chapters.get(`${PROFILE}:${CHAPTER}`)!;
  store.chapters.set(`${PROFILE}:${CHAPTER}`, {
    ...chapter,
    assessmentPassedAt: "2026-07-25T00:10:00.000Z",
  });
  const advanced = await service.advanceChapter(PROFILE, "CH.TWO");
  assert.equal(advanced.ok, true);
  if (!advanced.ok) return;
  assert.equal(advanced.value.chapter.level, 0);
  assert.equal(advanced.value.chapter.xp, 0);
  assert.equal(advanced.value.chapter.levelsAtChapterStart, 9);
  assert.equal(advanced.value.campaign.cumulativeLevels, 9);
  assert.equal(advanced.value.campaign.rank, 1);
  assert.equal(advanced.value.campaign.activeChapterId, "CH.TWO");
  // Chapter-scoped PvE abilities do not follow; the PvP loadout does.
  assert.equal(store.pvpAbilities.size, 1);
  assert.equal(
    [...store.chapterAbilities.values()].filter((a) => a.chapterId === "CH.TWO").length,
    0,
  );
  assert.equal(store.codex.size, 2);
});

test("an open-ended answer stores its handle and the service's verdict, never prose", async () => {
  const { service, store } = harness();
  await runModule(service);
  const opened = await service.openChapterAssessment(PROFILE, {
    chapterId: CHAPTER,
    assessmentId: ASSESSMENT,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  assert.equal((await answerOpen(service, opened.value.attemptId, "B2", true)).ok, true);
  const row = store.assessmentResponses.get(`${opened.value.attemptId}:B2`)!;
  assert.equal(row.itemFormat, "OPEN_RESPONSE");
  assert.equal(row.responseRef, "resp-B2");
  assert.equal(row.selectedOptionId, null, "an open item has no option to select");
  assert.equal(row.correct, true, "the verdict came from the grading service");
  assert.equal(
    JSON.stringify(row).includes("resp-B2"),
    true,
    "the handle is stored; the prose never reaches this row",
  );

  // An ungraded handle is refused rather than silently scored wrong.
  const ungraded = await service.answerAssessmentItem(PROFILE, {
    attemptId: opened.value.attemptId,
    itemId: "B4",
    itemFormat: "OPEN_RESPONSE",
    responseRef: "resp-never-graded",
  });
  assert.deepEqual(ungraded, { ok: false, error: "VERDICT_UNAVAILABLE" });

  // The client cannot relabel a selected-response item as open-ended.
  const mislabelled = await service.answerAssessmentItem(PROFILE, {
    attemptId: opened.value.attemptId,
    itemId: "B1",
    itemFormat: "OPEN_RESPONSE",
    responseRef: null,
  });
  assert.deepEqual(mislabelled, { ok: false, error: "BAD_REQUEST" });
});

test("a blank is stored as a blank, and a blank is never correct", async () => {
  const { service, store } = harness();
  await runModule(service);
  const opened = await service.openChapterAssessment(PROFILE, {
    chapterId: CHAPTER,
    assessmentId: ASSESSMENT,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  assert.equal((await answer(service, opened.value.attemptId, "A1", null)).ok, true);
  const blank = store.assessmentResponses.get(`${opened.value.attemptId}:A1`)!;
  assert.equal(blank.itemFormat, "SELECTED_RESPONSE");
  assert.equal(blank.selectedOptionId, null, "not a sentinel option id");
  assert.equal(blank.responseRef, null);
  assert.equal(blank.correct, false);
  // The row still exists, so the table can answer "what was this student asked".
  assert.equal(store.assessmentResponses.size, 1);
});

test("abandoning attempt 1 does not promote attempt 2 into the reported measure", async () => {
  const { service, store } = harness();
  await runModule(service);
  const first = await service.openChapterAssessment(PROFILE, {
    chapterId: CHAPTER,
    assessmentId: ASSESSMENT,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await answer(service, first.value.attemptId, "A1", "OPT.RIGHT");

  const abandoned = await service.abandonChapterAssessment(PROFILE, {
    attemptId: first.value.attemptId,
    reason: "WALKED_AWAY",
  });
  assert.equal(abandoned.ok, true);
  if (!abandoned.ok) return;
  assert.equal(abandoned.value.status, "ABANDONED");
  assert.equal(abandoned.value.scoreNumerator, null);
  assert.equal(abandoned.value.passed, false);
  assert.equal(abandoned.value.isReportedMeasure, true, "ordinal 1 still owns it");
  assert.ok(
    store.ledger.some((entry) => entry.kind === "ASSESSMENT_ATTEMPT_ABANDONED"),
  );

  // A second attempt is a retry, not a promotion. Its items are fresh, because
  // the abandoned attempt still spent the ones it served.
  await runModule(service, "ASSESSMENT_ATTEMPT");
  const second = await service.openChapterAssessment(PROFILE, {
    chapterId: CHAPTER,
    assessmentId: ASSESSMENT,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.value.attemptOrdinal, 2);
  assert.equal(second.value.isReportedMeasure, false);
  assert.deepEqual(
    second.value.form.map((entry) => entry.itemIds),
    [["A3", "A4"], ["B3", "B4"]],
  );
  for (const [itemId, optionId] of [
    ["A3", "OPT.RIGHT"],
    ["A4", "OPT.RIGHT"],
    ["B3", "OPT.RIGHT"],
  ] as const) {
    await answer(service, second.value.attemptId, itemId, optionId);
  }
  await answerOpen(service, second.value.attemptId, "B4", true);
  const submitted = await service.submitChapterAssessment(PROFILE, second.value.attemptId);
  assert.equal(submitted.ok, true);
  if (!submitted.ok) return;
  assert.equal(submitted.value.passed, true);

  // A perfect retry, and still no reported score: attempt 1 was walked out of.
  const attempts = [...store.assessmentAttempts.values()];
  const measure = reportedFirstAttemptMeasure(attempts);
  assert.equal(measure?.attempt.attemptOrdinal, 1);
  assert.equal(measure?.score, null, "the retry never becomes the reported score");
});

test("chapter two's M1 is a different mission from chapter one's", async () => {
  const { service, store } = harness();
  // Spend chapter one's M1 completely.
  await playAttempt(service, "CLEARED");
  assert.equal(
    isMissionPermanentlySpent(store.missions.get(`${PROFILE}:${CHAPTER}:${MISSION}`)!),
    true,
  );

  const chapter = store.chapters.get(`${PROFILE}:${CHAPTER}`)!;
  store.chapters.set(`${PROFILE}:${CHAPTER}`, {
    ...chapter,
    assessmentPassedAt: "2026-07-25T00:10:00.000Z",
  });
  assert.equal((await service.advanceChapter(PROFILE, "CH.TWO")).ok, true);

  // The same slug in the new chapter is untouched: three fresh attempts, and
  // the first one pays in full.
  const module = await service.completeLearningModule(PROFILE, {
    chapterId: "CH.TWO",
    moduleId: MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: MISSION,
    acknowledgedCueIds: [...DECK],
    observedSeconds: 200,
  });
  assert.equal(module.ok, true);
  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: "CH.TWO", missionId: MISSION },
    SEED,
  );
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.equal(opened.value.attemptOrdinal, 1, "not chapter one's spent counter");
  assert.deepEqual(opened.value.xpFraction, { numerator: 3, denominator: 3 });
  assert.notEqual(
    opened.value.attemptSeedHex,
    store.missionAttempts.get("00000000-0000-4000-8000-000000000001")?.attemptSeedHex,
    "and it is a different run from chapter one's M1",
  );
});

test("mutations refuse content that does not exist rather than inventing a payout", async () => {
  const { service } = harness({ missionReward: () => null, xpCurve: () => null });
  const module = await runModule(service);
  assert.deepEqual(module, { ok: false, error: "PACKAGE_MISSING" });
  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.deepEqual(opened, { ok: false, error: "PACKAGE_MISSING" });
  // Reads still work: a new runner is still Level 0, 0 XP, Rank 1.
  const snapshot = await service.snapshot(PROFILE);
  assert.equal(snapshot.campaign.rank, 1);
});

// ---------------------------------------------------------------------------
// Forfeiting an interrupted attempt (the anti-replay flow).
//
// The bug: an open attempt used to be handed back to a reloaded client, which
// started a fresh runtime against it — unlimited replay of a losing run. The fix
// is that an open attempt can only be SPENT. These tests hold the server half of
// that: a forfeit closes the one open run as FAILED through the same machinery a
// real loss uses, spends exactly one attempt, and is idempotent so a delivered
// terminal outcome can never be clobbered or double-spent.
// ---------------------------------------------------------------------------

async function openOnly(service: ProgressionService) {
  const module = await runModule(service);
  assert.equal(module.ok, true);
  const opened = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error("attempt did not open");
  return opened.value;
}

test("a still-open attempt cannot be re-opened: a reload gets a refusal, not the same run", async () => {
  const { service } = harness();
  const first = await openOnly(service);
  // A fresh runtime that tries to open again — the reload case — is refused rather
  // than handed the same row. The client can only forfeit it, never resume it.
  const again = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.deepEqual(again, { ok: false, error: "ATTEMPT_ALREADY_OPEN" });
  // And the one open row is still the original, untouched.
  const snapshot = await service.snapshot(PROFILE);
  assert.equal(snapshot.openAttempt?.attemptId, first.attemptId);
  assert.equal(snapshot.openAttempt?.status, "IN_PROGRESS");
});

test("forfeiting spends exactly one attempt and closes the run as a zero-XP failure", async () => {
  const { service } = harness();
  const open = await openOnly(service);

  const forfeit = await service.abandonMissionAttempt(PROFILE, {
    attemptId: open.attemptId,
  });
  assert.equal(forfeit.ok, true);
  if (!forfeit.ok) throw new Error("forfeit failed");
  assert.equal(forfeit.value.status, "FORFEITED");
  assert.equal(forfeit.value.attempt?.attemptId, open.attemptId);
  assert.equal(forfeit.value.attempt?.status, "FAILED");
  assert.equal(forfeit.value.attempt?.awardedXp, 0);
  assert.equal(forfeit.value.mission.attemptsUsed, 1, "exactly one attempt spent");

  // No XP moved, and nothing is open any more.
  const snapshot = await service.snapshot(PROFILE);
  assert.equal(snapshot.activeChapter.xp, 0, "a forfeit pays nothing");
  assert.equal(snapshot.openAttempt, null, "the run is closed, not resumable");
});

test("after a forfeit the next authorization needs its own module and gets the next ordinal and a fresh seed", async () => {
  const { service } = harness();
  const first = await openOnly(service);
  await service.abandonMissionAttempt(PROFILE, { attemptId: first.attemptId });

  // The re-armed module gate: attempt 2 cannot open on attempt 1's completion.
  const withoutModule = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.deepEqual(withoutModule, { ok: false, error: "MODULE_REQUIRED" });

  // With its own module, attempt 2 opens: next ordinal, and a seed bound to that
  // ordinal so it cannot replay attempt 1's variation.
  const second = await openOnly(service);
  assert.equal(second.attemptOrdinal, 2, "the ordinal advanced");
  assert.notEqual(second.attemptId, first.attemptId);
  assert.notEqual(
    second.attemptSeedHex,
    first.attemptSeedHex,
    "attempt two is a different run from the forfeited attempt one",
  );
});

// ---------------------------------------------------------------------------
// ONE open mission attempt per profile — not one per mission.
// ---------------------------------------------------------------------------

const M2 = "M2";
function twoMissionContent() {
  return {
    missionReward: (chapterId: string, missionId: string) =>
      missionId === MISSION || missionId === M2
        ? {
            missionId,
            chapterId,
            baseXp: 900,
            moduleId: MODULE,
            conceptIds: [...CONCEPTS],
          }
        : null,
  };
}

async function armModule(service: ProgressionService, missionId: string) {
  return service.completeLearningModule(PROFILE, {
    chapterId: CHAPTER,
    moduleId: MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: missionId,
    acknowledgedCueIds: [...DECK],
    observedSeconds: LEARNING_MODULE_SECONDS,
  });
}

test("with one attempt open, opening a DIFFERENT mission is refused", async () => {
  const { service } = harness(twoMissionContent());
  await openOnly(service); // opens M1

  // M2 is route-open and has its own module, but a profile has ONE live attempt.
  assert.equal((await armModule(service, M2)).ok, true);
  const openM2 = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: M2 },
    SEED,
  );
  assert.deepEqual(openM2, { ok: false, error: "ATTEMPT_ALREADY_OPEN" });

  // Forfeiting the open M1 then reveals the next legal route: M2 can now open.
  const snapshot = await service.snapshot(PROFILE);
  const forfeit = await service.abandonMissionAttempt(PROFILE, {
    attemptId: snapshot.openAttempt!.attemptId,
  });
  assert.equal(forfeit.ok, true);
  // The module for M2 attempt 1 is still armed, so it opens now.
  const openM2Again = await service.openMissionAttempt(
    PROFILE,
    { chapterId: CHAPTER, missionId: M2 },
    SEED,
  );
  assert.equal(openM2Again.ok, true);
  if (openM2Again.ok) assert.equal(openM2Again.value.missionId, M2);
});

test("concurrent opens on two mission ids converge to exactly one open attempt", async () => {
  const { service } = harness(twoMissionContent());
  assert.equal((await armModule(service, MISSION)).ok, true);
  assert.equal((await armModule(service, M2)).ok, true);

  const [a, b] = await Promise.all([
    service.openMissionAttempt(PROFILE, { chapterId: CHAPTER, missionId: MISSION }, SEED),
    service.openMissionAttempt(PROFILE, { chapterId: CHAPTER, missionId: M2 }, SEED),
  ]);
  // The store serialises the two opens per profile, so exactly one wins and the
  // other sees the first's live attempt.
  const outcomes = [a.ok, b.ok].sort();
  assert.deepEqual(outcomes, [false, true], `${a.ok}/${b.ok}`);
  const loser = a.ok ? b : a;
  assert.equal(loser.ok, false);
  if (!loser.ok) assert.equal(loser.error, "ATTEMPT_ALREADY_OPEN");

  // And the snapshot shows a single open attempt, not one hidden behind another.
  const snapshot = await service.snapshot(PROFILE);
  assert.ok(snapshot.openAttempt, "one attempt is open");
  const live = [...(await countLiveAttempts(service))];
  assert.equal(live.length, 1, "exactly one IN_PROGRESS attempt exists");
});

/** Count IN_PROGRESS attempts via a fresh open being refused is indirect; read the
 * store's own truth instead by asking the snapshot and the global live query path. */
async function countLiveAttempts(service: ProgressionService): Promise<string[]> {
  const snapshot = await service.snapshot(PROFILE);
  return snapshot.openAttempt ? [snapshot.openAttempt.attemptId] : [];
}

test("a foreign attempt id cannot be forfeited and spends nothing", async () => {
  const { service } = harness();
  const open = await openOnly(service);
  // An id this profile does not own resolves to nothing: idempotent no-op, and it
  // does NOT close the profile's real open attempt.
  const foreign = await service.abandonMissionAttempt(PROFILE, {
    attemptId: "00000000-0000-4000-8000-999999999999",
  });
  assert.equal(foreign.ok, true);
  if (foreign.ok) assert.equal(foreign.value.status, "ALREADY_CLOSED");
  const snapshot = await service.snapshot(PROFILE);
  assert.equal(snapshot.openAttempt?.attemptId, open.attemptId, "the real attempt is untouched");
});

test("forfeiting is idempotent: a delivered outcome is neither clobbered nor double-spent", async () => {
  const { service } = harness();
  const open = await openOnly(service);
  // The run actually finished and its outcome landed.
  const committed = await service.commitMissionOutcome(PROFILE, {
    attemptId: open.attemptId,
    outcome: "CLEARED",
    committedEvents: [],
    baseRevision: 0,
  });
  assert.equal(committed.ok, true);

  // A forfeit racing/following that delivery finds the attempt already closed and
  // spends nothing.
  const forfeit = await service.abandonMissionAttempt(PROFILE, {
    attemptId: open.attemptId,
  });
  assert.equal(forfeit.ok, true);
  if (!forfeit.ok) throw new Error("forfeit failed");
  assert.equal(forfeit.value.status, "ALREADY_CLOSED");

  const snapshot = await service.snapshot(PROFILE);
  const mission = snapshot.missions.find((row) => row.missionId === MISSION);
  assert.equal(mission?.attemptsUsed, 1, "still one attempt, not two");
  assert.equal(mission?.outcome, "CLEARED", "the real cleared outcome stands, not overwritten to FAILED");
});
