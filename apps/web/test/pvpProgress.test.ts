import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PROGRESS,
  convergence,
  observeProgress,
  outcomeLine,
} from "../src/pvp/progress.js";
import { frameFrom, pollIntervalFor } from "../src/pvp/protocol.js";
import type { MatchSnapshot } from "../src/pvp/protocol.js";
import {
  clearPvpArenaView,
  pvpArenaMode,
  pvpArenaView,
  registerPvpArenaView,
} from "../src/pvp/arenaPort.js";
import { MATCH_CODE_LENGTH, refusalText } from "../src/pvp/refusals.js";

// A duel now runs until a health pool empties, so these tests are mostly about
// what the client is NOT allowed to assume: no round total, no health maximum
// looked up from a constant, no damage-per-hit taken from tuning. Every reading
// has to fall out of the snapshots the authority actually sent.

function snapshot(over: {
  tick: number;
  round?: number;
  selfHealth: number;
  opponentHealth: number;
  phase?: MatchSnapshot["phase"];
}): MatchSnapshot {
  return {
    matchId: "pvp_TEST_1",
    tick: over.tick,
    phase: over.phase ?? "ENGAGEMENT_LIVE",
    round: over.round ?? 1,
    self: {
      side: "A",
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      capsuleHeight: 1.8,
      health: over.selfHealth,
      ammo: 3,
      dashing: false,
      invulnerableUntilTick: 0,
      dodgeReadyAtTick: 0,
      abilityUsesRemaining: {},
    },
    opponent: {
      side: "B",
      handle: "QuietLantern-1234",
      rank: 1,
      position: { x: 5, y: 0, z: 5 },
      capsuleHeight: 1.8,
      health: over.opponentHealth,
      ammo: 3,
      visible: true,
      positionAtTick: over.tick,
      answering: false,
    },
    projectiles: [],
  };
}

test("the health maximum is the high-water mark this match showed, not a constant", () => {
  // A match that opened at 240 health must report a full bar at 240, and a match
  // that opened at 100 must report a full bar at 100. Nothing is looked up.
  for (const opening of [100, 240, 55]) {
    const first = observeProgress(
      EMPTY_PROGRESS,
      snapshot({ tick: 1, selfHealth: opening, opponentHealth: opening }),
    );
    assert.equal(convergence(first).selfFraction, 1);
    const half = observeProgress(
      first,
      snapshot({ tick: 2, selfHealth: opening / 2, opponentHealth: opening }),
    );
    assert.equal(convergence(half).selfFraction, 0.5);
  }
});

test("damage and hits are counted from health deltas", () => {
  let progress = observeProgress(
    EMPTY_PROGRESS,
    snapshot({ tick: 1, selfHealth: 100, opponentHealth: 100 }),
  );
  progress = observeProgress(
    progress,
    snapshot({ tick: 2, selfHealth: 100, opponentHealth: 80 }),
  );
  progress = observeProgress(
    progress,
    snapshot({ tick: 3, selfHealth: 75, opponentHealth: 80 }),
  );
  progress = observeProgress(
    progress,
    snapshot({ tick: 4, selfHealth: 75, opponentHealth: 60 }),
  );

  assert.equal(progress.damageDealt, 40);
  assert.equal(progress.damageTaken, 25);
  assert.equal(progress.hitsLanded, 2);
  assert.equal(progress.hitsTaken, 1);
});

test("a repeated or rewound tick is not counted twice", () => {
  const first = observeProgress(
    EMPTY_PROGRESS,
    snapshot({ tick: 10, selfHealth: 100, opponentHealth: 100 }),
  );
  const hit = observeProgress(
    first,
    snapshot({ tick: 11, selfHealth: 100, opponentHealth: 80 }),
  );
  // Two polls can race; the authority's tick is what deduplicates them.
  const again = observeProgress(
    hit,
    snapshot({ tick: 11, selfHealth: 100, opponentHealth: 80 }),
  );
  const stale = observeProgress(
    again,
    snapshot({ tick: 9, selfHealth: 100, opponentHealth: 100 }),
  );
  assert.equal(stale.damageDealt, 20);
  assert.equal(stale.hitsLanded, 1);
});

test("healing raises the maximum instead of producing negative damage", () => {
  let progress = observeProgress(
    EMPTY_PROGRESS,
    snapshot({ tick: 1, selfHealth: 100, opponentHealth: 100 }),
  );
  progress = observeProgress(
    progress,
    snapshot({ tick: 2, selfHealth: 60, opponentHealth: 100 }),
  );
  progress = observeProgress(
    progress,
    snapshot({ tick: 3, selfHealth: 120, opponentHealth: 100 }),
  );
  assert.equal(progress.damageTaken, 40);
  assert.equal(progress.selfHealthMax, 120);
  assert.ok(progress.damageTaken >= 0);
});

test("rounds close as the round number advances, with no total anywhere", () => {
  let progress = observeProgress(
    EMPTY_PROGRESS,
    snapshot({ tick: 1, round: 1, selfHealth: 100, opponentHealth: 100 }),
  );
  progress = observeProgress(
    progress,
    snapshot({ tick: 2, round: 1, selfHealth: 100, opponentHealth: 80 }),
  );
  progress = observeProgress(
    progress,
    snapshot({ tick: 3, round: 2, selfHealth: 90, opponentHealth: 80 }),
  );

  assert.deepEqual(progress.rounds, [
    { round: 1, damageDealt: 20, damageTaken: 0 },
  ]);
  assert.equal(progress.round, 2);
  assert.equal(progress.currentRoundTaken, 10);

  // Round 9 is as legal as round 2. Nothing caps or wraps.
  const late = observeProgress(
    progress,
    snapshot({ tick: 4, round: 9, selfHealth: 90, opponentHealth: 80 }),
  );
  assert.equal(late.round, 9);
  assert.equal(late.rounds.length, 2);
});

test("hits-to-finish is measured from observed damage, not from a tuning constant", () => {
  let progress = observeProgress(
    EMPTY_PROGRESS,
    snapshot({ tick: 1, selfHealth: 100, opponentHealth: 100 }),
  );
  // No shot has landed: the client must not guess a rate.
  assert.equal(convergence(progress).hitsToFinish, null);
  assert.equal(convergence(progress).damagePerHit, null);

  progress = observeProgress(
    progress,
    snapshot({ tick: 2, selfHealth: 100, opponentHealth: 75 }),
  );
  const reading = convergence(progress);
  assert.equal(reading.damagePerHit, 25);
  assert.equal(reading.hitsToFinish, 3);
  assert.ok(reading.advantage > 0);
});

test("closing fires when either pool is nearly out", () => {
  let progress = observeProgress(
    EMPTY_PROGRESS,
    snapshot({ tick: 1, selfHealth: 100, opponentHealth: 100 }),
  );
  assert.equal(convergence(progress).closing, false);
  progress = observeProgress(
    progress,
    snapshot({ tick: 2, selfHealth: 100, opponentHealth: 20 }),
  );
  assert.equal(convergence(progress).closing, true);
});

test("an intent frame carries only the twelve fields the authority accepts", () => {
  const frame = frameFrom(
    {
      moveX: 1,
      moveZ: 0,
      sprint: false,
      crouch: false,
      jump: false,
      dodge: false,
      fire: true,
      aimX: 0,
      aimZ: 1,
      abilityId: null,
    },
    7,
    412,
  );
  assert.deepEqual(
    Object.keys(frame).sort(),
    [
      "abilityId",
      "aimX",
      "aimZ",
      "crouch",
      "dodge",
      "fire",
      "jump",
      "moveX",
      "moveZ",
      "seq",
      "sprint",
      "tick",
    ],
  );
  // @pa/pvp refuses an unknown field outright, so a stray key here is a rejected
  // frame rather than an ignored one.
  for (const forbidden of ["health", "position", "bullets", "ammo", "damage"]) {
    assert.equal(forbidden in frame, false);
  }
  assert.equal(frame.seq, 7);
  assert.equal(frame.tick, 412);
});

test("the poll slows down while a question is open and speeds up for the fight", () => {
  assert.ok(pollIntervalFor("QUESTION_PENDING") > pollIntervalFor("ENGAGEMENT_LIVE"));
  assert.ok(pollIntervalFor("VERDICT_COMMITTED") > pollIntervalFor("ENGAGEMENT_LIVE"));
  assert.ok(pollIntervalFor(null) > 0);
});

test("no arena view means PENDING, and there is no flag that fakes one", () => {
  clearPvpArenaView();
  assert.equal(pvpArenaView(), null);
  assert.equal(pvpArenaMode(false), "PENDING");
  const view = () => null;
  registerPvpArenaView(view);
  assert.equal(pvpArenaView(), view);
  assert.equal(pvpArenaMode(true), "VIEW");
  clearPvpArenaView();
});

test("every refusal the server can send reads as an instruction", () => {
  for (const code of [
    "CANNOT_DUEL_YOURSELF",
    "LOBBY_NOT_FOUND",
    "MATCH_NOT_FOUND",
    "AUTH_REQUIRED",
    "ANSWER_TOO_LONG",
  ]) {
    const text = refusalText(code);
    assert.ok(text.length > 20, `${code} needs a real sentence`);
    assert.ok(!text.includes(code), `${code} should not restate its own code`);
  }
  // The self-duel refusal is the one the owner will hit tomorrow, so it has to
  // name the fix rather than the problem.
  assert.match(refusalText("CANNOT_DUEL_YOURSELF"), /incognito|private/i);
  assert.match(refusalText("UNMAPPED_CODE_XYZ"), /UNMAPPED_CODE_XYZ/);
  assert.equal(MATCH_CODE_LENGTH, 6);
});

test("the result line names the winner from this player's side", () => {
  assert.match(outcomeLine("A", "A", "KNOCKOUT"), /^You won/);
  assert.match(outcomeLine("A", "B", "KNOCKOUT"), /^You lost/);
  assert.match(outcomeLine(null, "A", "ROUNDS_EXHAUSTED"), /^Drawn/);
  assert.match(outcomeLine("B", "A", "FORFEIT"), /forfeit/);
});
