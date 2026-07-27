// Settlement: the whole route from a NATURAL KNOCKOUT to a banked standing, and the
// one property the banking must have — exactly once.
//
// The direct-match tests already drive a forfeit and a rounds-exhausted backstop; the
// outcome that decides most real duels — a health bar emptied by landed shots — was
// only covered inside @pa/duel. This drives it at the PvP authority, on FULL HEALTH
// and with legitimately earned ammunition: bullets granted by a CORRECT verdict, fired
// at a live opponent over real rounds, until the server itself declares the knockout.
// Nothing forces an outcome onto the state — no health is edited — so the result is
// the simulation's.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  IDLE_INTENT,
  PLAYER_MAX_HEALTH,
  currentHealth,
  intent,
} from "@pa/duel";
import { matchResult, type PvpAuthority, type PvpMatchResult } from "../authority.js";
import {
  applyMatchResult,
  newStandingRecord,
  type StandingRecord,
} from "../standing.js";
import { advanceUntil, answerRound, liveMatch } from "./harness.js";

/** Aim A straight at B, stand still, and hold the trigger. B never moves or fires. */
function firingAtOpponent(authority: PvpAuthority): PvpAuthority {
  const a = authority.state.combat.fighters.A.motion.pos;
  const b = authority.state.combat.fighters.B.motion.pos;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1;
  const fire = intent({
    moveX: 0,
    moveZ: 0,
    fire: true,
    aimX: dx / length,
    aimZ: dz / length,
  });
  return { ...authority, heldIntents: { A: fire, B: IDLE_INTENT } };
}

test("a full-health duel resolves on a natural knockout from earned ammunition", () => {
  const fixture = liveMatch();
  let auth = advanceUntil(fixture.authority, (a) => a.state.phase === "QUESTION_PENDING");
  // No health hacking: both start on the full player pool, and the fight is won by
  // firing the magazine a correct answer legitimately grants.
  assert.deepEqual(currentHealth(auth.state), {
    A: PLAYER_MAX_HEALTH,
    B: PLAYER_MAX_HEALTH,
  });

  let firing = false;
  let rounds = 0;
  while (matchResult(auth) === null && rounds < 40) {
    fixture.authority = auth;
    // A answers CORRECT for the 14-ball classified magazine; B answers WRONG for 7 and
    // never fires, so A whittles a FULL-HEALTH opponent down across real rounds rather
    // than off a wounded starting value.
    auth = answerRound(fixture, { A: "CORRECT", B: "WRONG" });
    if (!firing) {
      auth = firingAtOpponent(auth);
      firing = true;
    }
    auth = advanceUntil(
      auth,
      (a) => a.state.phase === "QUESTION_PENDING" || matchResult(a) !== null,
      8000,
    );
    rounds += 1;
  }

  const result = matchResult(auth);
  assert.ok(result, `expected a knockout; stopped after ${rounds} rounds in ${auth.state.phase}`);
  assert.equal(result.reason, "KNOCKOUT", "health, not the backstop, ended it");
  assert.equal(result.winner, "A");
  assert.equal(result.loser, "B");
  assert.ok(result.healthB <= 0, "the loser was knocked out");
  assert.ok(result.healthA > 0, "the winner, never fired on, kept health");
  assert.equal(result.standingApplies, true, "a knockout moves standing");
  assert.equal(result.needsReview, false);
});

// ---- exactly-once standing: the store contract -----------------------------
//
// A FOCUSED STORE-CONTRACT TEST, NOT A PROCESS-RESTART TEST. The real exactly-once
// guarantee lives in `postgresPvpStandingStore.bank`: a `pvp_match` primary key and an
// `on conflict do nothing` inside one transaction, so a second attempt to bank the
// same match id inserts nothing and moves no points — across polls, across API tasks
// and across a restart. Exercising THAT requires Postgres (the `test:postgres`
// harness), which is not available here, so this instead pins the CONTRACT every store
// must satisfy, without claiming to restart a process it never started: bank once,
// then no matter how many replays arrive, nothing moves again.

class StandingStoreContractFake {
  private readonly records = new Map<string, StandingRecord>();
  private readonly banked = new Set<string>();

  points(profileId: string): number | undefined {
    return this.records.get(profileId)?.points;
  }

  record(profileId: string): StandingRecord | undefined {
    return this.records.get(profileId);
  }

  bank(
    result: PvpMatchResult,
    participants: {
      A: { profileId: string; handle: string; rank: number };
      B: { profileId: string; handle: string; rank: number };
    },
  ): boolean {
    if (this.banked.has(result.matchId)) return false;
    this.banked.add(result.matchId);
    const a =
      this.records.get(participants.A.profileId) ??
      newStandingRecord(participants.A.profileId, participants.A.handle, participants.A.rank);
    const b =
      this.records.get(participants.B.profileId) ??
      newStandingRecord(participants.B.profileId, participants.B.handle, participants.B.rank);
    const update = applyMatchResult(result, { A: a, B: b });
    for (const record of update.records) this.records.set(record.profileId, record);
    return true;
  }
}

const KNOCKOUT: PvpMatchResult = {
  matchId: "pvp_ABC123_1",
  winner: "A",
  loser: "B",
  reason: "KNOCKOUT",
  tiebreak: "NONE",
  healthA: 40,
  healthB: 0,
  standingApplies: true,
  needsReview: false,
};

const PARTICIPANTS = {
  A: { profileId: "profile-a", handle: "QuietLantern-1234", rank: 2 },
  B: { profileId: "profile-b", handle: "SwiftKestrel-5678", rank: 2 },
} as const;

test("the store contract banks a match exactly once, however many replays arrive", () => {
  const store = new StandingStoreContractFake();
  const first = store.bank(KNOCKOUT, PARTICIPANTS);
  assert.equal(first, true, "the first attempt banks it");
  const winnerAfterFirst = store.points("profile-a");
  const loserAfterFirst = store.points("profile-b");

  // Both clients keep polling a finished match; every one of those calls `bank`.
  for (let replay = 0; replay < 10; replay += 1) {
    assert.equal(store.bank(KNOCKOUT, PARTICIPANTS), false, `replay ${replay} re-banked`);
  }
  assert.equal(store.points("profile-a"), winnerAfterFirst, "the winner moved once");
  assert.equal(store.points("profile-b"), loserAfterFirst, "the loser moved once");
  assert.equal(store.record("profile-a")?.wins, 1, "not a second win");
});

test("classified answers remain 14 for correct and 7 for wrong", () => {
  // The brief's invariant, pinned: hardening the settlement path must not disturb the
  // bullet economy a classified verdict pays into. The values are imported, so this
  // fails loudly if @pa/duel retunes them rather than silently drifting.
  assert.equal(BULLETS_FOR_CORRECT, 14);
  assert.equal(BULLETS_FOR_WRONG, 7);
});
