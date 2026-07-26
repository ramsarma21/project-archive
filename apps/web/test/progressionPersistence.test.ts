import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CommitMissionOutcomeRequestSchema,
  MAX_MISSION_ATTEMPTS,
  ProgressionSnapshotSchema,
  attemptXpFraction,
  missionXpAward,
  rankFromCumulativeLevels,
  type ProgressionSnapshot,
} from "@pa/contracts";
import {
  classifyDelivery,
  commitForResult,
  deployStanding,
  missionOutcomeRequest,
  moduleCompletionRequest,
  projectProgression,
  resolveEquipped,
  snapshotBelongsTo,
  standingFor,
  EQUIPPED_ABILITY_SLOTS,
} from "../src/progression/index.js";
import { hubStateFrom } from "../src/pages/hub/hubState.js";
import type { MissionResult } from "../src/mission/result.js";
import type { ModuleRunCompletion } from "../src/module/moduleGate.js";

// ===========================================================================
// What has to be true for progression to be worth persisting at all.
//
// These are not tests of the arithmetic — @pa/contracts owns and tests that.
// They are tests of the CLIENT'S HONESTY: that nothing it sends can move a
// number, that nothing it stores can be reset to buy an attempt, and that two
// students on one machine cannot see each other.
// ===========================================================================

const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const CHAPTER = "boston-1765";
const M1 = "PA.SEA01.CH02.BOSTON.MD01";
const M2 = "PA.SEA01.CH02.BOSTON.MD02";
const AT = "2026-07-25T12:00:00.000Z";

function snapshot(overrides: {
  profileId?: string;
  rank?: number;
  cumulativeLevels?: number;
  level?: number;
  xp?: number;
  missions?: {
    missionId: string;
    attemptsUsed: number;
    outcome: "UNSTARTED" | "IN_PROGRESS" | "CLEARED" | "FAILED_PERMANENT";
  }[];
  codex?: { cardId: string; conceptId: string; pvpLegalAt: string | null }[];
  mastery?: { conceptId: string; chapterId: string; masteredAt: string | null }[];
  chapterAbilities?: { abilityId: string; unlockedAtLevel: number }[];
  pvpAbilities?: { abilityId: string; firstUnlockedAtLevel: number }[];
} = {}): ProgressionSnapshot {
  const profileId = overrides.profileId ?? PROFILE_A;
  const cumulativeLevels = overrides.cumulativeLevels ?? 0;
  const raw = {
    campaign: {
      profileId,
      modelVersion: 1,
      rank: overrides.rank ?? rankFromCumulativeLevels(cumulativeLevels),
      cumulativeLevels,
      activeChapterId: CHAPTER,
      revision: 3,
      createdAt: AT,
      updatedAt: AT,
    },
    activeChapter: {
      profileId,
      chapterId: CHAPTER,
      level: overrides.level ?? 0,
      xp: overrides.xp ?? 0,
      levelsAtChapterStart: 0,
      status: "ACTIVE" as const,
      assessmentPassedAt: null,
      startedAt: AT,
      completedAt: null,
      updatedAt: AT,
    },
    derived: {
      rank: overrides.rank ?? rankFromCumulativeLevels(cumulativeLevels),
      cumulativeLevels,
      levelsToNextRank: 10 - (cumulativeLevels % 10),
      level: overrides.level ?? 0,
      xp: overrides.xp ?? 0,
      xpToNextLevel: 40,
    },
    missions: (overrides.missions ?? []).map((mission) => ({
      profileId,
      chapterId: CHAPTER,
      missionId: mission.missionId,
      attemptsUsed: mission.attemptsUsed,
      outcome: mission.outcome,
      awardedXp: 0,
      clearedOnAttempt: null,
      clearedAt: null,
      failedAt: null,
      updatedAt: AT,
    })),
    openAttempt: null,
    codex: (overrides.codex ?? []).map((card) => ({
      profileId,
      cardId: card.cardId,
      conceptId: card.conceptId,
      learnedChapterId: CHAPTER,
      learnedAt: AT,
      pvpLegalAt: card.pvpLegalAt,
      updatedAt: AT,
    })),
    chapterAbilities: (overrides.chapterAbilities ?? []).map((ability) => ({
      profileId,
      chapterId: CHAPTER,
      abilityId: ability.abilityId,
      unlockedAtLevel: ability.unlockedAtLevel,
      unlockedAt: AT,
    })),
    pvpAbilities: (overrides.pvpAbilities ?? []).map((ability) => ({
      profileId,
      abilityId: ability.abilityId,
      firstUnlockedChapterId: CHAPTER,
      firstUnlockedAtLevel: ability.firstUnlockedAtLevel,
      firstUnlockedAt: AT,
    })),
    conceptMastery: (overrides.mastery ?? []).map((row) => ({
      profileId,
      chapterId: row.chapterId,
      conceptId: row.conceptId,
      itemsServed: 2,
      itemsCorrect: row.masteredAt ? 2 : 1,
      firstAttemptServed: 2,
      firstAttemptCorrect: row.masteredAt ? 2 : 1,
      masteredAt: row.masteredAt,
      updatedAt: AT,
    })),
  };
  // Parsed rather than cast: these fixtures are only useful if they are the
  // shape the server actually sends.
  return ProgressionSnapshotSchema.parse(raw);
}

function missionResult(overrides: Partial<MissionResult> = {}): MissionResult {
  const base = {
    missionId: M1,
    chapterId: CHAPTER,
    attemptId: "local-attempt-id",
    attemptOrdinal: 1,
    outcome: "CLEARED" as const,
    headline: "Operation complete.",
    detail: "",
    achievement: {
      traversalCompleted: true,
      objectiveIds: [],
      detections: 0,
      throwsStruckBody: 0,
      duelReached: true,
      duelWon: true,
    },
    knowledge: { rounds: [], correct: 6, asked: 6, conceptIds: [] },
    timing: {
      traversalBudgetS: 145,
      traversalSimulatedS: 130,
      traversalWallS: 132,
      traversalOverBudgetS: -15,
      droppedSteps: 0,
      moduleObservedS: 180,
      duelEngagementS: 120,
      duelWallS: 160,
      attemptWallS: 480,
      isCompleteAttempt: true,
    },
    baseXp: 120,
    xpFraction: attemptXpFraction(1),
    awardedXp: missionXpAward({ baseXp: 120, attemptOrdinal: 1, outcome: "CLEARED" }),
    tally: { missionId: M1, attemptsUsed: 1, outcome: "CLEARED" as const },
    attemptsUsedAfter: 1,
    attemptsRemaining: 0,
    outcomeAfter: "CLEARED" as const,
    missionSpentAfter: true,
    advancesToNextMission: true,
    resolvedAt: AT,
    commit: {
      missionId: M1,
      chapterId: CHAPTER,
      attemptOrdinal: 1,
      outcome: "CLEARED" as const,
      baseXp: 120,
      at: AT,
    },
    committedEvents: [],
  };
  return { ...base, ...overrides } as MissionResult;
}

// ---------------------------------------------------------------------------
// 1. XP is recomputed, never claimed
// ---------------------------------------------------------------------------

test("the commit carries one bit of outcome and no XP, Level, Rank or ordinal", () => {
  const result = missionResult();
  // The container derived a real award for the result screen…
  assert.equal(result.awardedXp, 120);

  const payload = commitForResult({ durableAttemptId: ATTEMPT, result });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;

  // …and none of it reaches the wire.
  const keys = Object.keys(payload.body).sort();
  assert.deepEqual(keys, ["attemptId", "baseRevision", "committedEvents", "outcome"]);
  assert.equal(payload.body.outcome, "CLEARED");
  assert.equal(payload.body.attemptId, ATTEMPT);

  const serialised = JSON.stringify(payload.body);
  for (const forbidden of [
    "awardedXp",
    "xpFraction",
    "attemptOrdinal",
    "baseXp",
    "level",
    "rank",
  ]) {
    assert.ok(
      !serialised.includes(forbidden),
      `${forbidden} must not appear in a progression request`,
    );
  }
});

test("a payload that tried to claim a number is refused by the contract itself", () => {
  // The guard the server runs, run here: a future author who adds an award to
  // the commit body fails on this machine rather than in a classroom.
  const smuggled = CommitMissionOutcomeRequestSchema.safeParse({
    attemptId: ATTEMPT,
    outcome: "CLEARED",
    committedEvents: [],
    baseRevision: 0,
    awardedXp: 9999,
  });
  assert.equal(smuggled.success, false);

  // The guard still refuses a claim sitting BESIDE the log, which is the shape
  // a client asserting a verdict would actually take.
  const alongside = CommitMissionOutcomeRequestSchema.safeParse({
    attemptId: ATTEMPT,
    outcome: "CLEARED",
    committedEvents: [{ type: "DUEL_RESOLVED" }],
    baseRevision: 0,
    verdict: "CORRECT",
  });
  assert.equal(alongside.success, false);
});

test("the module completion cannot name the attempt it opens", () => {
  const completion: ModuleRunCompletion = {
    moduleId: "BOS.MD01.MODULE.v1",
    missionId: M1,
    attemptOrdinal: 3,
    acknowledgedCueIds: ["cue.a", "cue.b"],
    observedSeconds: 184,
    completedAt: AT,
    awardedXp: 0,
  };
  const payload = moduleCompletionRequest({ chapterId: CHAPTER, completion });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;
  const serialised = JSON.stringify(payload.body);
  assert.ok(!serialised.includes("attemptOrdinal"));
  assert.ok(!("awardedXp" in payload.body));
  // The cue set is the gate, and it is the one thing the client does supply.
  assert.deepEqual(payload.body.acknowledgedCueIds, ["cue.a", "cue.b"]);
});

test("the duel's commit log reaches the server intact, verdicts and all", () => {
  // @pa/duel's log names a verdict on every round, because the SERVER minted
  // that verdict and the log is the record of it. The guard used to reject the
  // whole body for it, and the client's answer was to drop the log rather than
  // lose the clear. `committedEvents` is now exempt, so the evidence survives.
  const withVerdicts = missionResult({
    committedEvents: [
      { type: "DUEL_STARTED", seed: 1, rounds: 6, mode: "BOSS", opponentId: "boss" },
      { type: "VERDICT_COMMITTED", round: 1, side: "A", verdict: { kind: "CORRECT" } },
    ],
  });
  const payload = commitForResult({ durableAttemptId: ATTEMPT, result: withVerdicts });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;
  assert.equal(payload.body.committedEvents.length, 2);
  assert.equal(payload.note, null, "nothing had to be sacrificed to commit");
  assert.equal(payload.body.outcome, "CLEARED");
});

test("a log with no refused key is carried through untouched", () => {
  const clean = missionResult({
    committedEvents: [{ type: "DUEL_STARTED", seed: 1, rounds: 6 }],
  });
  const payload = commitForResult({ durableAttemptId: ATTEMPT, result: clean });
  assert.equal(payload.ok, true);
  if (!payload.ok) return;
  assert.equal(payload.body.committedEvents.length, 1);
  assert.equal(payload.note, null);
});

// ---------------------------------------------------------------------------
// 2. The attempt tally is the server's, and clearing storage does not touch it
// ---------------------------------------------------------------------------

test("attempts spent come from the server row, whatever this browser remembers", () => {
  const view = projectProgression(
    snapshot({ missions: [{ missionId: M1, attemptsUsed: 2, outcome: "IN_PROGRESS" }] }),
  );
  const standing = standingFor(view, M1);
  assert.equal(standing.attemptsUsed, 2);
  assert.equal(standing.attemptsRemaining, 1);
  assert.equal(standing.nextAttemptOrdinal, MAX_MISSION_ATTEMPTS);
  assert.equal(standing.spent, false);
});

test("a mission with three resolved attempts is spent and cannot be deployed to", () => {
  const view = projectProgression(
    snapshot({
      missions: [{ missionId: M1, attemptsUsed: 3, outcome: "FAILED_PERMANENT" }],
    }),
  );
  assert.deepEqual(
    deployStanding({ view, missionId: M1, routeOpen: true, known: true, unranked: false }),
    { deployable: false, reason: "SPENT" },
  );
  // …and the mission is still RESOLVED, so the chapter advances past it.
  assert.ok(view.resolvedMissionIds.has(M1));
  assert.equal(standingFor(view, M1).nextAttemptOrdinal, null);
});

test("a cleared mission is spent too: nothing is owed twice", () => {
  const view = projectProgression(
    snapshot({ missions: [{ missionId: M1, attemptsUsed: 1, outcome: "CLEARED" }] }),
  );
  assert.equal(standingFor(view, M1).spent, true);
  assert.equal(
    deployStanding({ view, missionId: M1, routeOpen: true, known: true, unranked: false })
      .reason,
    "SPENT",
  );
});

test("wiping local state yields an EMPTY view, which is refused rather than opened", () => {
  // This is the exploit, stated as a test. A player who clears site data has a
  // client that knows nothing. Knowing nothing must not read as "no attempts
  // spent"; it reads as "ask the server", and until the server answers the
  // gate is shut.
  const wiped = projectProgression(snapshot());
  assert.equal(standingFor(wiped, M1).attemptsUsed, 0);
  assert.deepEqual(
    deployStanding({ view: wiped, missionId: M1, routeOpen: true, known: false, unranked: false }),
    { deployable: false, reason: "UNKNOWN" },
  );
});

test("signed out, the route alone decides and nothing is durable", () => {
  const view = projectProgression(snapshot());
  const standing = deployStanding({
    view,
    missionId: M1,
    routeOpen: true,
    known: true,
    unranked: true,
  });
  assert.equal(standing.deployable, true);
  assert.equal(standing.reason, "OPEN");
});

// ---------------------------------------------------------------------------
// 3. Rank is monotonic across a reload
// ---------------------------------------------------------------------------

test("a reload cannot lower a Rank the player already holds", () => {
  // The stored Rank is 4 while the Level count alone would derive 3 — the shape
  // a curve retune or a corrected Level count produces. The held Rank wins.
  const view = projectProgression(snapshot({ rank: 4, cumulativeLevels: 25 }));
  assert.equal(rankFromCumulativeLevels(25), 3);
  assert.equal(view.rank, 4);

  const hub = hubStateFrom({ view, runnerName: "Runner" });
  assert.equal(hub.rank, 4);
  // The caption derives Rank from this figure, so it has to support Rank 4 too,
  // or the panel prints "Rank 4" over "3 Levels to Rank 4".
  assert.equal(rankFromCumulativeLevels(hub.cumulativeLevels), 4);
});

test("Rank tracks Levels in the ordinary case without inflating them", () => {
  const view = projectProgression(snapshot({ cumulativeLevels: 23, level: 8, xp: 400 }));
  const hub = hubStateFrom({ view, runnerName: "Runner" });
  assert.equal(hub.rank, 3);
  assert.equal(hub.cumulativeLevels, 23);
  assert.equal(hub.level, 8);
  assert.equal(hub.xp, 400);
  assert.equal(hub.xpToNext, 440, "the bar's ceiling is xp plus what is owed");
});

// ---------------------------------------------------------------------------
// 4. Codex, abilities, and per-chapter mastery
// ---------------------------------------------------------------------------

test("a learned card is not a PvP-legal card", () => {
  const view = projectProgression(
    snapshot({
      codex: [
        { cardId: "BOS.CARD.A", conceptId: "C1", pvpLegalAt: null },
        { cardId: "BOS.CARD.B", conceptId: "C2", pvpLegalAt: AT },
      ],
    }),
  );
  assert.deepEqual(view.codex.learnedCardIds, ["BOS.CARD.A", "BOS.CARD.B"]);
  assert.deepEqual(view.codex.pvpLegalCardIds, ["BOS.CARD.B"]);
});

test("mastery is keyed by chapter, so a second chapter cannot overwrite the first", () => {
  const view = projectProgression(
    snapshot({
      mastery: [
        { conceptId: "C1", chapterId: CHAPTER, masteredAt: AT },
        { conceptId: "C1.NEXT", chapterId: "philadelphia-1776", masteredAt: null },
      ],
    }),
  );
  assert.equal(view.masteryByChapter.size, 2);
  assert.equal(view.masteryByChapter.get(CHAPTER)?.get("C1")?.masteredAt, AT);
  assert.equal(
    view.masteryByChapter.get("philadelphia-1776")?.get("C1.NEXT")?.masteredAt,
    null,
  );
});

test("PvE unlocks are chapter-scoped and the PvP pool is permanent", () => {
  const view = projectProgression(
    snapshot({
      chapterAbilities: [{ abilityId: "BOS.AB.SMOKE", unlockedAtLevel: 3 }],
      pvpAbilities: [
        { abilityId: "BOS.AB.SMOKE", firstUnlockedAtLevel: 3 },
        { abilityId: "OLD.AB.FROM.A.PAST.CHAPTER", firstUnlockedAtLevel: 7 },
      ],
    }),
  );
  assert.deepEqual(view.abilities.chapterUnlockedIds, ["BOS.AB.SMOKE"]);
  assert.equal(view.abilities.pvpUnlockedIds.length, 2);
});

test("the loadout carries four, and never an ability the server has not granted", () => {
  const pool = [
    { abilityId: "A", level: 1 },
    { abilityId: "B", level: 5 },
    { abilityId: "C", level: 9 },
    { abilityId: "D", level: 11 },
    { abilityId: "E", level: 14 },
  ];
  const chosen = resolveEquipped({
    pool,
    selectedAbilityIds: ["A", "B", "C", "D", "E", "NEVER_UNLOCKED"],
  });
  assert.equal(chosen.carried.length, EQUIPPED_ABILITY_SLOTS);
  assert.deepEqual(chosen.droppedIds, ["NEVER_UNLOCKED"]);
  assert.ok(!chosen.carried.includes("NEVER_UNLOCKED"));

  // A selection made last chapter names nothing this one has granted: a smaller
  // loadout, never a failed deploy.
  const stale = resolveEquipped({ pool: [], selectedAbilityIds: ["A", "B"] });
  assert.deepEqual(stale.carried, []);

  // No choice yet: the newest four, deterministically.
  const fallback = resolveEquipped({ pool, selectedAbilityIds: null });
  assert.deepEqual(fallback.carried, ["E", "D", "C", "B"]);
  assert.equal(fallback.chosen, false);
});

// ---------------------------------------------------------------------------
// 5. Two accounts, one machine
// ---------------------------------------------------------------------------

test("a snapshot is only ever read back under the profile it was written for", () => {
  const forA = snapshot({ profileId: PROFILE_A, cumulativeLevels: 30 });
  assert.equal(snapshotBelongsTo(forA, PROFILE_A), true);
  assert.equal(snapshotBelongsTo(forA, PROFILE_B), false);
  assert.equal(snapshotBelongsTo(forA, ""), false);
  assert.equal(snapshotBelongsTo(null, PROFILE_A), false);
});

test("two profiles project to two independent views", () => {
  const a = projectProgression(
    snapshot({
      profileId: PROFILE_A,
      cumulativeLevels: 30,
      missions: [{ missionId: M1, attemptsUsed: 3, outcome: "FAILED_PERMANENT" }],
    }),
  );
  const b = projectProgression(snapshot({ profileId: PROFILE_B }));
  assert.equal(a.rank, 4);
  assert.equal(b.rank, 1);
  assert.equal(standingFor(a, M1).spent, true);
  assert.equal(standingFor(b, M1).spent, false);
  assert.notEqual(a.profileId, b.profileId);
});

// ---------------------------------------------------------------------------
// 6. Delivery classification — the offline rules
// ---------------------------------------------------------------------------

test("an unreachable server never reads as a refusal", () => {
  assert.equal(classifyDelivery({ status: "UNREACHABLE", detail: "Failed to fetch" }), "RETAIN");
  assert.equal(classifyDelivery({ status: "UNREACHABLE", detail: "HTTP_503" }), "RETAIN");
});

test("a lost response is a success on retry, not a stuck queue", () => {
  assert.equal(
    classifyDelivery({ status: "REFUSED", error: "ATTEMPT_CLOSED", httpStatus: 409 }),
    "SETTLED",
  );
});

test("an unpriced chapter is retained, so today's clears pay out when content lands", () => {
  // The API ships `emptyProgressionContent`, so every commit answers
  // PACKAGE_MISSING right now. Discarding it would bin a real mission clear.
  assert.equal(
    classifyDelivery({ status: "REFUSED", error: "PACKAGE_MISSING", httpStatus: 400 }),
    "RETAIN",
  );
});

test("another profile's outcome waits for its owner instead of being dropped", () => {
  assert.equal(
    classifyDelivery({ status: "REFUSED", error: "AUTH_REQUIRED", httpStatus: 401 }),
    "RETAIN",
  );
  assert.equal(
    classifyDelivery({ status: "REFUSED", error: "PROFILE_FORBIDDEN", httpStatus: 403 }),
    "RETAIN",
  );
});

test("a spent mission is a game rule, not a save failure", () => {
  assert.equal(
    classifyDelivery({ status: "REFUSED", error: "MISSION_SPENT", httpStatus: 409 }),
    "DISCARD",
  );
  assert.equal(
    classifyDelivery({ status: "REFUSED", error: "ATTEMPT_NOT_FOUND", httpStatus: 400 }),
    "DISCARD",
  );
});

test("an outcome for an attempt that was never opened cannot be addressed at all", () => {
  const payload = missionOutcomeRequest({
    attemptId: "not-a-uuid",
    outcome: "CLEARED",
    committedEvents: [],
    baseRevision: 0,
  });
  assert.equal(payload.ok, false);
});
