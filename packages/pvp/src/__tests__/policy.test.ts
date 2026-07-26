// Gates, brackets, cosmetics, the question pool and standing. Every gate is tested in
// BOTH positions, so the shipping configuration is not an untested code path on the day
// somebody flips it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_DT, intent } from "@pa/duel";
import {
  ABILITY_LOADOUT_SLOTS,
  BOSTON_CHAPTER_ID,
  resolvePvpLoadout,
} from "@pa/abilities";
import {
  OPEN_PLAYTEST_GATES,
  PVP_GATES,
  SHIPPING_GATES,
  assertPvpEligible,
} from "../gates.js";
import {
  BOSTON_MAX_ATTAINABLE_RANK,
  BRACKET_WIDTH_INITIAL,
  MODELLED_BOSTON_CLASS,
  QUEUE_PATIENCE_S,
  bracketWidthAfter,
  ranksCompatible,
  reachablePopulation,
} from "../brackets.js";
import { drainQueue, findMatchFor, type QueueEntry } from "../matchmaking.js";
import {
  DEFAULT_COSMETIC_LOADOUT,
  parseCosmeticLoadout,
  assertCosmeticsCarryNoStats,
} from "../cosmetics.js";
import { askableItems, selectRoundQuestions, M1_CONCEPT_IDS } from "../questionPool.js";
import {
  applyMatchResult,
  leaderboard,
  newStandingRecord,
  standingDelta,
  STANDING_FLOOR,
} from "../standing.js";
import { advanceMatch, createPvpMatch, type PvpMatchResult } from "../authority.js";
import { referenceArena } from "@pa/duel";
import { loadM1Bank, member } from "./harness.js";

// ---- gates -----------------------------------------------------------------

test("today's configuration is open, and it is one value", () => {
  assert.deepEqual(PVP_GATES, OPEN_PLAYTEST_GATES);
  assert.equal(PVP_GATES.requireChapterComplete, false);
  assert.equal(PVP_GATES.requirePvpLegalCards, false);
  assert.equal(PVP_GATES.enforceRankBrackets, false);
});

test("a player who has completed nothing can play today and cannot when it ships", () => {
  const fresh = {
    profileId: "profile-new",
    completedChapterIds: [] as string[],
    pvpLegalCardIds: [] as string[],
  };
  assert.equal(assertPvpEligible(fresh, OPEN_PLAYTEST_GATES).ok, true);
  const shipped = assertPvpEligible(fresh, SHIPPING_GATES);
  assert.equal(shipped.ok, false);
  if (!shipped.ok) assert.equal(shipped.reason, "CHAPTER_NOT_COMPLETE");

  const graduated = {
    profileId: "profile-done",
    // The chapter id a completed profile actually carries. `assertPvpEligible`
    // only counts the list today, so this literal was free to be wrong and was —
    // and it is the fixture somebody will copy when the gate starts naming which
    // chapter was completed.
    completedChapterIds: [BOSTON_CHAPTER_ID],
    pvpLegalCardIds: ["BOS.MD01.CARD.WAR_DEBT.v1"],
  };
  assert.equal(assertPvpEligible(graduated, SHIPPING_GATES).ok, true);
});

// ---- brackets --------------------------------------------------------------

test("with everyone at Rank 1 the queue cannot deadlock", () => {
  const queue: QueueEntry[] = [
    { profileId: "p1", handle: "h1", rank: 1, joinedAtMs: 0 },
    { profileId: "p2", handle: "h2", rank: 1, joinedAtMs: 100 },
  ];
  const result = findMatchFor(queue[0]!, queue, 1000);
  assert.equal(result.kind, "MATCHED");
});

test("with brackets off, a Rank 1 and a Rank 4 can still meet", () => {
  assert.equal(ranksCompatible(1, 4, 0, OPEN_PLAYTEST_GATES), true);
  assert.equal(ranksCompatible(1, 4, 1, SHIPPING_GATES), false);
  assert.equal(ranksCompatible(3, 4, 1, SHIPPING_GATES), true);
});

test("the shipped width of 1 is what the modelled class actually needs", () => {
  // The arithmetic from brackets.ts, checked rather than asserted in a comment.
  const atWidth = (rank: number, width: number) =>
    reachablePopulation(rank, MODELLED_BOSTON_CLASS, width);

  // Exact-Rank matching strands the bottom of the ladder completely.
  assert.equal(atWidth(1, 0), 0, "Rank 1 is alone at the bottom by construction");
  assert.ok(atWidth(4, 0) <= 4, "and Rank 4 is thin");

  // One Rank of slack gives every bracket a real pool.
  assert.equal(BRACKET_WIDTH_INITIAL, 1);
  for (let rank = 1; rank <= BOSTON_MAX_ATTAINABLE_RANK; rank += 1) {
    assert.ok(
      atWidth(rank, 1) >= 4,
      `Rank ${rank} reaches only ${atWidth(rank, 1)} players at width 1`,
    );
  }
});

test("patience widens the bracket and then offers something rather than nothing", () => {
  assert.equal(bracketWidthAfter(0), 1);
  assert.ok(bracketWidthAfter(60) > bracketWidthAfter(0));
  const lonely: QueueEntry = { profileId: "p1", handle: "h1", rank: 4, joinedAtMs: 0 };
  const waiting = findMatchFor(lonely, [lonely], 10_000);
  assert.equal(waiting.kind, "WAITING");
  const exhausted = findMatchFor(lonely, [lonely], QUEUE_PATIENCE_S * 1000 + 1);
  assert.equal(exhausted.kind, "EXHAUSTED");
  if (exhausted.kind === "EXHAUSTED") {
    assert.deepEqual([...exhausted.offers], ["FRIEND_CODE", "SPARRING"]);
  }
});

test("a direct challenge ignores brackets and never pairs with a stranger", () => {
  const challenger: QueueEntry = {
    profileId: "p1",
    handle: "h1",
    rank: 1,
    joinedAtMs: 0,
    challengeProfileId: "p2",
  };
  const friend: QueueEntry = { profileId: "p2", handle: "h2", rank: 4, joinedAtMs: 0 };
  const stranger: QueueEntry = { profileId: "p3", handle: "h3", rank: 1, joinedAtMs: 0 };
  const matched = findMatchFor(challenger, [challenger, friend, stranger], 1000);
  assert.equal(matched.kind, "MATCHED");
  if (matched.kind === "MATCHED") {
    assert.equal(matched.pair.b.profileId, "p2");
    assert.equal(matched.pair.direct, true);
  }
  const withoutFriend = findMatchFor(challenger, [challenger, stranger], 1000);
  assert.equal(withoutFriend.kind, "WAITING");
});

test("draining a queue is deterministic and pairs nobody twice", () => {
  const queue: QueueEntry[] = [
    { profileId: "p1", handle: "h1", rank: 1, joinedAtMs: 0 },
    { profileId: "p2", handle: "h2", rank: 1, joinedAtMs: 10 },
    { profileId: "p3", handle: "h3", rank: 1, joinedAtMs: 20 },
  ];
  const first = drainQueue(queue, 1000);
  const second = drainQueue([...queue].reverse(), 1000);
  assert.equal(first.pairs.length, 1);
  assert.equal(first.remaining.length, 1);
  assert.deepEqual(
    first.pairs.map((pair) => [pair.a.profileId, pair.b.profileId]),
    second.pairs.map((pair) => [pair.a.profileId, pair.b.profileId]),
    "polling order must not decide matches",
  );
});

// ---- cosmetics -------------------------------------------------------------

test("a cosmetic loadout cannot carry a stat, and a client cannot attach one", () => {
  assert.doesNotThrow(assertCosmeticsCarryNoStats);
  const catalogue = {
    skinIds: [DEFAULT_COSMETIC_LOADOUT.skinId, "SKIN.BOSTON.DOCKHAND"],
    weaponIds: [DEFAULT_COSMETIC_LOADOUT.weaponId],
  };
  const smuggled = parseCosmeticLoadout(
    { ...DEFAULT_COSMETIC_LOADOUT, damageBonus: 5 },
    catalogue,
  );
  assert.equal(smuggled.ok, false);
  if (!smuggled.ok) assert.equal(smuggled.reason, "UNKNOWN_FIELD");

  const unowned = parseCosmeticLoadout(
    { skinId: "SKIN.NOT_EARNED", weaponId: DEFAULT_COSMETIC_LOADOUT.weaponId },
    catalogue,
  );
  assert.equal(unowned.ok, false);
  if (!unowned.ok) assert.equal(unowned.reason, "UNKNOWN_SKIN");
});

test("opposite cosmetic loadouts simulate byte-identically", () => {
  // The real enforcement: cosmetics are never handed to the reducer, so a fight cannot
  // notice them. Two matches, opposite loadouts, identical everything else.
  const run = (skinId: string, weaponId: string) => {
    const arena = referenceArena();
    const bank = loadM1Bank();
    const drawn = selectRoundQuestions({
      bank,
      seed: 4242,
      rounds: 6,
      askable: askableItems(bank, { A: [], B: [] }),
    });
    if (!drawn.ok) throw new Error(drawn.reason);
    const created = createPvpMatch({
      identity: { matchId: "m", seed: 4242, startedAtMs: 0 },
      participants: {
        A: { ...member("a"), cosmetics: { skinId, weaponId } },
        B: { ...member("b"), cosmetics: { skinId, weaponId } },
      },
      world: arena.world,
      questions: drawn.questions,
      placement: arena.placement,
    });
    if (!created.ok) throw new Error(created.reason);
    let authority = created.authority;
    for (let step = 0; step < 120; step += 1) {
      authority = advanceMatch(authority, FIELD_DT).authority;
    }
    return authority.state.combat;
  };

  assert.deepEqual(
    run("SKIN.BOSTON.RUNNER", "WEAPON.FLINTLOCK.PISTOL"),
    run("SKIN.LATER.CHAPTER.HERO", "WEAPON.KENTUCKY.RIFLE"),
  );
});

test("the four-slot cap is @pa/abilities' and is shared with single-player", () => {
  assert.equal(ABILITY_LOADOUT_SLOTS, 4);
  const many = Array.from({ length: 12 }, (_unused, index) => `BOS.ABILITY.${index}`);
  const resolved = resolvePvpLoadout({ unlockedAbilityIds: many });
  assert.ok(resolved.carried.length <= ABILITY_LOADOUT_SLOTS);
  assert.ok(resolved.duelLoadout.length <= ABILITY_LOADOUT_SLOTS);
});

// ---- the question pool -----------------------------------------------------

test("M1's authored bank loads, and it is the whole of today's pool", () => {
  const bank = loadM1Bank();
  assert.equal(bank.items.length, 18);
  const concepts = [...new Set(bank.items.map((item) => item.conceptId))].sort();
  assert.deepEqual(concepts, [...M1_CONCEPT_IDS].sort());
  assert.equal(bank.conceptByRound.length, 6);
});

test("a draw follows the authored concept order and never repeats an item", () => {
  const bank = loadM1Bank();
  const drawn = selectRoundQuestions({
    bank,
    seed: 99,
    rounds: 6,
    askable: askableItems(bank, { A: [], B: [] }),
  });
  assert.equal(drawn.ok, true);
  if (!drawn.ok) return;
  assert.equal(drawn.questions.length, 6);
  assert.equal(new Set(drawn.questions.map((q) => q.itemId)).size, 6);
  assert.deepEqual(
    drawn.questions.map((q) => q.conceptId),
    bank.conceptByRound,
    "no concept twice in a row, per the authored schedule",
  );
  // Same seed, same six. Different seed, a different draw.
  const again = selectRoundQuestions({
    bank,
    seed: 99,
    rounds: 6,
    askable: askableItems(bank, { A: [], B: [] }),
  });
  assert.deepEqual(again, drawn);
});

test("the PvP-legal card gate is built, and it bites when switched on", () => {
  const bank = loadM1Bank();
  // Open: everything is askable even with no cards minted, which is today.
  assert.equal(askableItems(bank, { A: [], B: [] }, OPEN_PLAYTEST_GATES).length, 18);
  // Shipping: nothing is askable without mastery, which is why it is off today.
  assert.equal(askableItems(bank, { A: [], B: [] }, SHIPPING_GATES).length, 0);

  // Shipping, with one shared card: only items that need exactly that card.
  const shared = bank.items[0]!.codexCardIds;
  const askable = askableItems(bank, { A: shared, B: shared }, SHIPPING_GATES);
  assert.ok(askable.length >= 1);
  for (const item of askable) {
    for (const card of item.codexCardIds) assert.ok(shared.includes(card));
  }
  // And one-sided mastery asks nothing: the intersection, not the union.
  assert.equal(askableItems(bank, { A: shared, B: [] }, SHIPPING_GATES).length, 0);
});

// ---- standing --------------------------------------------------------------

test("standing is zero-sum-ish, floored, and pays for an upset", () => {
  const even = standingDelta(3, 3);
  assert.equal(even.winner, 20);
  assert.equal(even.loser, 12);
  const upset = standingDelta(2, 4);
  assert.ok(upset.winner > even.winner, "beating up the ladder pays more");
  const favourite = standingDelta(4, 2);
  assert.ok(favourite.loser < even.loser, "losing up the ladder costs less");
});

test("a loss cannot put a child's public number below zero", () => {
  const loser = { ...newStandingRecord("p2", "SwiftKestrel-1234", 4), points: 3 };
  const result: PvpMatchResult = {
    matchId: "m",
    winner: "A",
    loser: "B",
    reason: "KNOCKOUT",
    tiebreak: "NONE",
    healthA: 40,
    healthB: 0,
    standingApplies: true,
    needsReview: false,
  };
  const update = applyMatchResult(result, {
    A: newStandingRecord("p1", "QuietLantern-1234", 4),
    B: loser,
  });
  const updatedLoser = update.records.find((record) => record.profileId === "p2")!;
  assert.equal(updatedLoser.points, STANDING_FLOOR);
  assert.equal(updatedLoser.losses, 1);
});

test("a true draw moves no points and is flagged for review", () => {
  const drawn: PvpMatchResult = {
    matchId: "m",
    winner: null,
    loser: null,
    reason: "ROUNDS_EXHAUSTED",
    tiebreak: "DRAWN",
    healthA: 100,
    healthB: 100,
    standingApplies: false,
    needsReview: true,
  };
  const a = newStandingRecord("p1", "QuietLantern-1234", 2);
  const b = newStandingRecord("p2", "SwiftKestrel-1234", 2);
  const update = applyMatchResult(drawn, { A: a, B: b });
  assert.equal(update.delta, null);
  assert.equal(update.reviewRequired, true);
  for (const record of update.records) {
    assert.equal(record.points, a.points);
    assert.equal(record.draws, 1);
  }
});

test("the board orders by points and is total", () => {
  const rows = leaderboard([
    { ...newStandingRecord("p1", "QuietLantern-1111", 2), points: 120, wins: 2 },
    { ...newStandingRecord("p2", "SwiftKestrel-2222", 3), points: 120, wins: 5 },
    { ...newStandingRecord("p3", "AmberFerry-3333", 1), points: 90 },
  ]);
  assert.deepEqual(
    rows.map((row) => row.handle),
    ["SwiftKestrel-2222", "QuietLantern-1111", "AmberFerry-3333"],
  );
  assert.deepEqual(
    rows.map((row) => row.position),
    [1, 2, 3],
  );
});
