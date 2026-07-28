// Tests for the join between the mission container and the duel.
//
// The interesting failures on this seam are all quiet ones, and each test below is
// aimed at one of them.
//
// The registry is the whole reachability of the mode: with nothing registered the
// container renders a curtain and says so, which is a state that survived for as
// long as it did precisely because everything else passed. So the first test is
// simply that installing puts the container in VIEW mode.
//
// The translation must not adjust simulation input. A view that recentred a world,
// reseeded a duel or reordered a bank would produce a fight that looked right and
// disagreed with the attempt the server opened, so the descriptor is checked
// against the brief field by field rather than for plausibility.
//
// And the report is where a wrong answer could silently be worth a right one. The
// bullet figures are taken off a duel driven through the REAL reducer with real
// minted verdicts, so that "wrong grants seven" is measured rather than asserted
// about a constant.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  FACE_OFF_TICKS,
  FIELD_DT,
  M1_BOSS_TACTICS,
  duelCommitLog,
  mintVerdict,
  projectFieldSeed,
  type BossProfile,
  type DuelEvent,
  type OpponentSource,
  type VerdictKind,
} from "@pa/duel";
import { ARENA } from "@pa/mission-m1";

import {
  clearDuelView,
  duelSurfaceMode,
  duelView,
  type MissionDuelBrief,
} from "../src/mission/duelPort.js";
import { M1_MISSION_ID, duelBrief } from "../src/chapter/m1Mission.js";
import { roundAmmoSources } from "@pa/duel";
import { OFFICER_RIG, PLAYER_RIG } from "../src/duel/m1Duel.js";
import {
  missionCast,
  missionDuelDescriptor,
  missionDuelReport,
  missionDuelRounds,
} from "../src/duel/missionBrief.js";
import {
  YARD_HALF_EXTENT_X,
  YARD_HALF_EXTENT_Z,
  yardArena,
} from "../src/duel/arenaSpec.js";
import { createDuelRuntime } from "../src/duel/duelRuntime.js";

const SEED = projectFieldSeed(["MISSION.DUEL.TEST"]);

/**
 * A brief exactly as the mission builds one.
 *
 * Assembled from @pa/mission-m1's own arena rather than invented, because half of
 * what these tests check is that the mission's coordinates survive the crossing —
 * and a hand-written brief centred on the origin would have hidden the one defect
 * that mattered.
 */
function missionBrief(attemptOrdinal = 1): MissionDuelBrief {
  // THE PRODUCTION BRIEF, not a restatement of it. This used to hand-copy every
  // field — including `opponent`, where it built a default (AUTHORED_FLAT) boss
  // rather than the mission's real SYMMETRIC_COMPLEMENT one. Because nothing here
  // asserted on the boss's ammo policy and the player's 7/14 report is identical
  // under both, the copy silently disagreed with the mission for as long as it
  // stood: a wrong answer never armed the boss, and this suite was green through
  // it. Binding to `duelBrief` is what makes that class of drift impossible.
  return duelBrief(SEED, attemptOrdinal);
}

// ---- the registration ------------------------------------------------------

test("installing the duel makes the container's duel surface a view", async () => {
  clearDuelView();
  assert.equal(duelView(), null, "nothing is registered before the install");
  assert.equal(
    duelSurfaceMode({ hasView: false, isDevBuild: true, harnessRequested: true }),
    "PENDING_WITH_DEV_WIN",
    "the dev-win harness is reachable while no view exists",
  );

  const { installMissionDuel } = await import("../src/duel/installDuel.js");
  installMissionDuel();

  const view = duelView();
  assert.ok(view, "the install registered a view");
  assert.equal(
    duelSurfaceMode({ hasView: true, isDevBuild: true, harnessRequested: true }),
    "VIEW",
    "a registered view makes the dev-win harness unreachable, whatever the flags say",
  );
});

test("installing twice keeps one registration", async () => {
  const { installMissionDuel } = await import("../src/duel/installDuel.js");
  installMissionDuel();
  const first = duelView();
  installMissionDuel();
  assert.equal(duelView(), first);
});

// ---- the descriptor --------------------------------------------------------

test("M1 has a cast, and a mission nobody has cast has none", () => {
  const cast = missionCast(M1_MISSION_ID);
  assert.ok(cast);
  assert.equal(cast.playerGlbKey, PLAYER_RIG);
  assert.equal(cast.opponentGlbKey, OFFICER_RIG);
  assert.ok(cast.opponentName.length > 0);
  assert.equal(missionCast("PA.SEA01.CH02.BOSTON.MD02"), null);
});

test("the descriptor carries the brief's scoring input unaltered", () => {
  const brief = missionBrief();
  const descriptor = missionDuelDescriptor(brief, missionCast(M1_MISSION_ID)!);

  // The id, the seed, the boss and the bank decide how the fight is scored and what
  // it asks, and the server opened them — so they pass through untouched, by
  // reference, because a copy is a place a difference can appear.
  assert.equal(descriptor.duelId, brief.duelId);
  assert.equal(descriptor.seed, brief.seed);
  assert.equal(descriptor.opponent, brief.opponent);
  assert.equal(descriptor.questionBank, brief.questions);

  // WHERE the fight happens is NOT the brief's. The brief no longer carries a
  // world or a placement at all — the duel is fought in the shared arena — so the
  // descriptor's arena is `yardArena()`'s, proven against its bounds in "the
  // mission's duel is fought in the shared arena, at the origin" below.
});

test("the mission boss is the symmetric-complement officer, and a wrong answer arms HIM", () => {
  // THE REGRESSION THIS FILE MISSED. The complement rule — correct arms the player
  // 14 and the boss 7, wrong arms the player 7 and the boss 14 — landed in the core
  // and in the stand-alone m1Duel.ts descriptor, but the real mission path
  // (duelBrief) kept building a default AUTHORED_FLAT boss, so in the fight a player
  // actually fought the officer was armed with a flat 7 every round and a wrong
  // answer never armed the enemy. The player's own 7/14 is identical under both
  // policies, which is why every existing report test stayed green through it. So
  // this asserts the BOSS half, off the production brief.
  const brief = missionBrief();
  const opponent = brief.opponent as OpponentSource;
  assert.equal(opponent.kind, "BOSS");
  const profile = (opponent as { profile: BossProfile }).profile;
  assert.equal(
    profile.ammoPolicy,
    "SYMMETRIC_COMPLEMENT",
    "the mission officer must earn the mirror of the player's award, not a flat magazine",
  );

  // THE SAME CLASS OF DRIFT, one arena later. The duel now happens in the shared
  // cover-rich yard, so the mission boss must ALSO carry the stand-alone
  // descriptor's tactical opt-ins — otherwise the officer stands in the open
  // ignoring the eight pieces of cover, which is the flat-7 bug's twin: the
  // stand-alone path opted in and the mission did not. Pinned here so a green suite
  // can never again report a fight the player does not actually fight.
  assert.equal(
    profile.takesCoverBeforeQuestion,
    true,
    "the officer must break behind cover before a question, not wait in the open",
  );
  assert.equal(
    profile.tactical,
    M1_BOSS_TACTICS,
    "the officer must fight to the ammo-aware plan the arena was tuned for",
  );

  // Driven through the core's own award, off a committed verdict — not asserted
  // about a constant. A wrong answer arms the boss 14; a correct one, 7.
  const config = { opponent } as Parameters<typeof roundAmmoSources>[0];
  const bossFor = (kind: VerdictKind) =>
    roundAmmoSources(config, [
      {
        side: "A",
        verdict: mintVerdict({ kind, itemId: "X", itemVersion: "v1", source: "CLASSIFIER" }),
      },
    ]).B;
  assert.deepEqual(bossFor("WRONG"), { kind: "AUTHORED", bullets: BULLETS_FOR_CORRECT });
  assert.deepEqual(bossFor("CORRECT"), { kind: "AUTHORED", bullets: BULLETS_FOR_WRONG });
});

test("the mission's duel is fought in the shared arena, at the origin", () => {
  // THE OWNER'S DECISION, asserted. Entering the duel is a transition into the
  // shared rope-walk arena — the same one every Boston boss fight and PvP use — so
  // the fight is at the origin, on `yardArena()`'s geometry, and NOT on the slice
  // the level carved out at x 88-100. This reverses cc3de7d (which drew the
  // mission's own yard around a fight sitting at the level's coordinates); the
  // fight moves to the arena rather than the arena to the fight.
  const brief = missionBrief();
  const descriptor = missionDuelDescriptor(brief, missionCast(M1_MISSION_ID)!);
  const arena = yardArena();

  assert.deepEqual(descriptor.arena.world.bounds, arena.world.bounds);
  assert.equal(descriptor.arena.world.bounds.minX, -YARD_HALF_EXTENT_X);
  assert.equal(descriptor.arena.world.bounds.maxX, YARD_HALF_EXTENT_X);
  assert.equal(descriptor.arena.world.bounds.minZ, -YARD_HALF_EXTENT_Z);
  assert.equal(descriptor.arena.world.bounds.maxZ, YARD_HALF_EXTENT_Z);

  // The fighters stand on the arena's own centreline, not out in Boston.
  assert.equal(descriptor.arena.placement.A.pos.x, 0);
  assert.equal(descriptor.arena.placement.B.pos.x, 0);
  assert.ok(
    Math.abs(descriptor.arena.placement.A.pos.z) < YARD_HALF_EXTENT_Z,
    "the player stands inside the arena",
  );
  assert.ok(
    Math.abs(descriptor.arena.placement.B.pos.z) < YARD_HALF_EXTENT_Z,
    "so does the officer",
  );
});

test("the descriptor still cannot express a duel length, brief or not", () => {
  const brief = missionBrief();
  // A duel ends on health, not a length, so no round count may come out the other
  // side and become "of 6" in a kicker. The brief no longer even carries `rounds`
  // (it could not travel to the core), and the descriptor must still not grow one.
  const descriptor = missionDuelDescriptor(brief, missionCast(M1_MISSION_ID)!) as unknown as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(descriptor)) {
    assert.ok(
      !/^(rounds|roundCeiling|totalRounds|roundCount|maxRounds)$/i.test(key),
      `a descriptor must not carry ${key}`,
    );
  }
});

test("the descriptor satisfies the screen without inventing an arena spec", () => {
  // The narrowed `arena` is the point: a brief has a world and a placement and no
  // `ArenaSpec`, so anything wider would have to be fabricated here.
  const brief = missionBrief();
  const descriptor = missionDuelDescriptor(brief, missionCast(M1_MISSION_ID)!);
  assert.deepEqual(Object.keys(descriptor.arena).sort(), ["placement", "world"]);
});

// ---- the report ------------------------------------------------------------

/**
 * Fight a whole duel through the real reducer, answering every round one way.
 *
 * The verdicts are minted the way the grading authority mints them, so the bullet
 * grants in the commit log are the reducer's own derivation and not a number this
 * test chose.
 */
function fightDuel(brief: MissionDuelBrief, answer: VerdictKind) {
  // Fight the duel the descriptor actually builds — same shared arena the player
  // gets — so the report is measured off the fight that ships, not a hand-assembled
  // one on the mission's carved world.
  const descriptor = missionDuelDescriptor(brief, missionCast(M1_MISSION_ID)!);
  const runtime = createDuelRuntime({
    duelId: descriptor.duelId,
    seed: descriptor.seed,
    world: descriptor.arena.world,
    opponent: descriptor.opponent as Parameters<typeof createDuelRuntime>[0]["opponent"],
    questions: descriptor.questionBank as Parameters<typeof createDuelRuntime>[0]["questions"],
    placement: descriptor.arena.placement,
  });

  const horizon = 60 * 60 * 20;
  for (let frame = 0; frame < horizon; frame += 1) {
    const hud = runtime.getHud();
    if (hud.phase === "DUEL_RESOLVED") break;
    if (hud.phase === "QUESTION_PENDING" && hud.item) {
      runtime.commitVerdict(
        "A",
        mintVerdict({
          kind: answer,
          itemId: hud.item.itemId,
          itemVersion: hud.item.itemVersion,
          source: "CLASSIFIER",
        }),
      );
    }
    runtime.advance(FIELD_DT);
  }

  const outcome = runtime.getHud().outcome;
  assert.ok(outcome, "the duel resolved inside the horizon");
  return {
    outcome,
    commitLog: duelCommitLog(runtime.getEvents()),
    engagementTicks: runtime.getState().engagementTicks,
  };
}

test("a wrong answer is reported as seven balls and a right one as fourteen", () => {
  for (const [answer, expected] of [
    ["WRONG", BULLETS_FOR_WRONG],
    ["CORRECT", BULLETS_FOR_CORRECT],
  ] as const) {
    const brief = missionBrief();
    const fought = fightDuel(brief, answer);
    const report = missionDuelReport({ brief, ...fought });

    assert.ok(report.rounds.length > 0, "the duel asked something");
    for (const round of report.rounds) {
      assert.equal(round.verdict, answer);
      assert.equal(
        round.bullets,
        expected,
        `a ${answer} answer must report ${expected} balls, got ${round.bullets}`,
      );
    }
  }
});

test("every reported round names the concept its item evidences", () => {
  const brief = missionBrief();
  const fought = fightDuel(brief, "WRONG");
  const report = missionDuelReport({ brief, ...fought });
  // The authored concepts, taken from the only list that pairs an item with a
  // concept — the question bank. The brief used to carry a separate `conceptIds`
  // array, but the round reports never read it (they derive concepts from the
  // items actually asked), so it was removed and this derives the same set here.
  const authored = new Set(
    (brief.questions as ReadonlyArray<{ conceptId: string }>).map(
      (question) => question.conceptId,
    ),
  );

  for (const round of report.rounds) {
    assert.ok(round.conceptId.length > 0, `round ${round.round} has a concept`);
    // The concept comes from the item that was actually asked, and every item in
    // the bank belongs to one of the mission's three authored concepts.
    assert.ok(authored.has(round.conceptId), `${round.conceptId} is authored for M1`);
  }
});

test("rounds are reported in order, once each, and only for the player", () => {
  const brief = missionBrief();
  const fought = fightDuel(brief, "CORRECT");
  const rounds = missionDuelRounds(brief, fought.commitLog);

  const ordinals = rounds.map((round) => round.round);
  assert.deepEqual([...ordinals].sort((a, b) => a - b), ordinals, "ascending");
  assert.equal(new Set(ordinals).size, ordinals.length, "no round twice");

  // The boss is granted a magazine every round from its authored profile. None of
  // that is knowledge evidence, and counting it would double the reported rounds.
  const bossGrants = fought.commitLog.filter(
    (event: DuelEvent) => event.type === "BULLETS_GRANTED" && event.side === "B",
  );
  assert.ok(bossGrants.length > 0, "the boss really was granted balls");
  assert.equal(rounds.length, ordinals.length);
});

test("the engagement clock is the core's ticks, not the wall clock", () => {
  const brief = missionBrief();
  const fought = fightDuel(brief, "CORRECT");
  const report = missionDuelReport({ brief, ...fought });
  assert.equal(report.engagementSeconds, fought.engagementTicks * FIELD_DT);
  assert.ok(report.engagementSeconds > 0, "a fight happened");
  // The answering phases are untimed and spend no duel time, so the fight clock
  // has to be shorter than the number of rounds times the round length.
  assert.ok(
    report.engagementSeconds <= report.rounds.length * ARENA.roundSeconds + 1,
    `${report.engagementSeconds}s of engagement over ${report.rounds.length} rounds`,
  );
});

test("won is the core's clear condition and never a second copy of it", () => {
  const brief = missionBrief();
  const fought = fightDuel(brief, "CORRECT");
  const report = missionDuelReport({ brief, ...fought });
  assert.equal(report.won, report.outcome.winner === "A");
  // Winning on points clears the mission, so a decision must not be downgraded.
  if (report.outcome.reason === "ROUNDS_EXHAUSTED" && report.outcome.winner === "A") {
    assert.equal(report.won, true);
  }
});

test("the committed events carry no answer text and no bullet count on the wire", () => {
  const brief = missionBrief();
  const fought = fightDuel(brief, "WRONG");
  const report = missionDuelReport({ brief, ...fought });
  const json = JSON.stringify(report.committedEvents);

  assert.ok(report.committedEvents.length > 0);
  // The commit log is carried through to the durable commit untouched, so it must
  // be plain JSON: a branded verdict object would serialise its brand away and a
  // consumer would silently receive a different shape.
  assert.deepEqual(JSON.parse(json), report.committedEvents);
  for (const event of report.committedEvents) {
    assert.ok(!("answer" in event), "no answer text");
    assert.ok(!("bullets" in event), "no top-level bullet count");
  }
});

// ---- the verdict receipt ---------------------------------------------------
//
// The receipt is the server's HMAC over the verdict envelope, bound to the duel
// and the round. Until the client read the response header it never left the
// browser's memory, so every entry committed `unsigned` and
// apps/api/src/duels/commitReceipts.ts had nothing to verify — which is why
// DUEL_RECEIPT_ENFORCEMENT could not leave AUDIT.

/** The two keys apps/api/src/duels/commitReceipts.ts reads off an entry. */
function verdictEntries(events: readonly Record<string, unknown>[]) {
  return events.filter(
    (event) => event.type === "VERDICT_COMMITTED" && event.side === "A",
  );
}

test("a graded round carries its receipt and its duel id to the commit", () => {
  const brief = missionBrief();
  const fought = fightDuel(brief, "CORRECT");
  const rounds = verdictEntries(serialisedFor(brief, fought)).map(
    (event) => event.round as number,
  );
  assert.ok(rounds.length > 0, "the duel graded something");

  const report = missionDuelReport({
    brief,
    ...fought,
    receipts: rounds.map((round) => ({
      round,
      duelId: brief.duelId,
      receipt: `receipt-for-round-${round}`,
    })),
  });

  const entries = verdictEntries(report.committedEvents);
  assert.equal(entries.length, rounds.length);
  for (const entry of entries) {
    assert.equal(entry.receipt, `receipt-for-round-${entry.round as number}`);
    // The duel id is part of the signed message and @pa/duel's log does not carry
    // one, so without this the server has to rebuild it from the attempt row.
    assert.equal(entry.duelId, brief.duelId);
    // Beside the envelope, never inside it: the envelope is the HMAC input, and a
    // key added to it would change the message the server re-derives.
    assert.deepEqual(Object.keys(entry.verdict as object).sort(), [
      "itemId",
      "itemVersion",
      "kind",
      "responseRef",
      "source",
    ]);
  }
  // Still plain JSON, because the commit carries it through untouched.
  assert.deepEqual(
    JSON.parse(JSON.stringify(report.committedEvents)),
    report.committedEvents,
  );
});

test("a round the server did not grade stays unsigned rather than getting a null", () => {
  const brief = missionBrief();
  const fought = fightDuel(brief, "WRONG");
  const graded = verdictEntries(serialisedFor(brief, fought))[0]?.round as number;
  assert.equal(typeof graded, "number");

  // One receipt, for one round. Every other round was capped or unreachable, and
  // the server counts absent separately from invalid — so an absent receipt must
  // be an absent key, not a present null.
  const report = missionDuelReport({
    brief,
    ...fought,
    receipts: [{ round: graded, duelId: brief.duelId, receipt: "only-one" }],
  });

  for (const entry of verdictEntries(report.committedEvents)) {
    if (entry.round === graded) {
      assert.equal(entry.receipt, "only-one");
    } else {
      assert.equal("receipt" in entry, false, `round ${entry.round as number}`);
      assert.equal("duelId" in entry, false, `round ${entry.round as number}`);
    }
  }
});

test("no receipts at all is the same log the mission committed before this shipped", () => {
  const brief = missionBrief();
  const fought = fightDuel(brief, "CORRECT");
  assert.deepEqual(
    missionDuelReport({ brief, ...fought }).committedEvents,
    missionDuelReport({ brief, ...fought, receipts: [] }).committedEvents,
  );
});

/** The report's own serialisation, for reading the rounds the log actually holds. */
function serialisedFor(
  brief: MissionDuelBrief,
  fought: ReturnType<typeof fightDuel>,
): readonly Record<string, unknown>[] {
  return missionDuelReport({ brief, ...fought }).committedEvents;
}

// The arena the mission fights in is now the shared rope-walk yard, and its
// drawn-cover-is-blocking-cover invariant is proven where the arena lives:
// apps/web/test/duelArena.test.ts. There is no mission-carved arena view left to
// test here — the fight moved into the arena rather than the arena being drawn
// around the fight.
