// The path tomorrow depends on: two accounts on one machine, a code, a real duel.
// If anything in this file fails, the playtest does not happen.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_DT } from "@pa/duel";
import {
  createLobby,
  joinLobby,
  lobbySides,
  markLobbyStarted,
  matchCodeFor,
  normaliseMatchCode,
  MATCH_CODE_ALPHABET,
  MATCH_CODE_LENGTH,
  LOBBY_EXPIRY_MS,
} from "../lobby.js";
import {
  advanceMatch,
  awaitingVerdicts,
  forfeitMatch,
  matchResult,
} from "../authority.js";
import { BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG, currentAmmo } from "@pa/duel";
import { DUEL_ROUND_CEILING } from "@pa/duel/structure";
import { advanceUntil, answerRound, liveMatch, member } from "./harness.js";

test("a match code is short, typable and unambiguous", () => {
  const code = matchCodeFor("profile-host", 1_000_000);
  assert.equal(code.length, MATCH_CODE_LENGTH);
  for (const character of code) assert.ok(MATCH_CODE_ALPHABET.includes(character));
  // The characters a person confuses when reading a code aloud are simply absent.
  for (const confusable of ["0", "O", "1", "I", "L", "U", "V"]) {
    assert.equal(MATCH_CODE_ALPHABET.includes(confusable), false, confusable);
  }
});

test("a typed code survives realistic mistyping", () => {
  const code = matchCodeFor("profile-host", 1_000_000);
  assert.equal(normaliseMatchCode(code.toLowerCase()), code);
  assert.equal(normaliseMatchCode(` ${code} `), code);
  assert.equal(normaliseMatchCode(`${code.slice(0, 3)}-${code.slice(3)}`), code);
  assert.equal(normaliseMatchCode("SHORT"), null);
  assert.equal(normaliseMatchCode("0OIL11"), null);
  assert.equal(normaliseMatchCode(42), null);
});

test("two different profiles on one machine can join by code", () => {
  const lobby = createLobby(member("profile-host"), 1_000_000);
  assert.equal(lobby.status, "OPEN");
  const joined = joinLobby(lobby, member("profile-guest"), 1_000_500);
  assert.equal(joined.ok, true);
  if (!joined.ok) return;
  assert.equal(joined.lobby.status, "READY");
  const sides = lobbySides(joined.lobby);
  assert.equal(sides?.A.profileId, "profile-host");
  assert.equal(sides?.B.profileId, "profile-guest");
  assert.equal(markLobbyStarted(joined.lobby, "pvp_1").status, "STARTED");
});

test("a stale session cannot join its own lobby", () => {
  // The specific failure that would waste the owner's evening: one browser, two tabs,
  // one cookie, and a duel that can never resolve because both sides are one person.
  const lobby = createLobby(member("profile-host"), 1_000_000);
  const rejoined = joinLobby(lobby, member("profile-host"), 1_000_500);
  assert.equal(rejoined.ok, false);
  if (!rejoined.ok) assert.equal(rejoined.reason, "CANNOT_DUEL_YOURSELF");
});

test("a lobby expires, and a second joiner is refused", () => {
  const lobby = createLobby(member("profile-host"), 1_000_000);
  const late = joinLobby(lobby, member("profile-guest"), 1_000_000 + LOBBY_EXPIRY_MS + 1);
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.reason, "LOBBY_EXPIRED");

  const joined = joinLobby(lobby, member("profile-guest"), 1_000_500);
  assert.equal(joined.ok, true);
  if (!joined.ok) return;
  const third = joinLobby(joined.lobby, member("profile-third"), 1_000_600);
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.reason, "LOBBY_NOT_OPEN");
});

test("the match starts on M1's questions with both players Rank 1", () => {
  const fixture = liveMatch();
  assert.equal(fixture.authority.phase, "LIVE");
  // The whole askable bank, not a six-item slice. The count is the bank's to
  // decide — what matters here is that a match starts with a real pool of M1
  // items behind it rather than with a number this test invented.
  assert.ok(fixture.questions.length > 0, "a match needs questions");
  assert.equal(fixture.authority.participants.A.rank, 1);
  assert.equal(fixture.authority.participants.B.rank, 1);
  for (const question of fixture.questions) {
    assert.ok(
      question.itemId.startsWith("BOS.MD01.DUEL."),
      `${question.itemId} is not an M1 duel item`,
    );
  }
});

test("the face-off ends in a question that BOTH players owe", () => {
  const fixture = liveMatch();
  const asking = advanceUntil(fixture.authority, (a) => a.state.phase === "QUESTION_PENDING");
  assert.deepEqual([...awaitingVerdicts(asking)], ["A", "B"]);
});

test("a full round runs: both answer, bullets are derived, play resumes", () => {
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );

  // Asymmetric verdicts, so the economy has something to say.
  fixture.authority = answerRound(fixture, { A: "CORRECT", B: "WRONG" });
  assert.equal(fixture.authority.state.phase, "VERDICT_COMMITTED");

  const granted = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "BULLETS_GRANTED" || a.state.phase === "ENGAGEMENT_LIVE",
  );
  assert.deepEqual(currentAmmo(granted.state), {
    A: BULLETS_FOR_CORRECT,
    B: BULLETS_FOR_WRONG,
  });

  const live = advanceUntil(granted, (a) => a.state.phase === "ENGAGEMENT_LIVE");
  assert.equal(live.state.round, 1);
  assert.equal(matchResult(live), null, "a match in progress has no result");
});

test("a match with no fixed round count still plays to an authoritative result", () => {
  // This used to loop exactly six times and assert a result at the end of them.
  // A duel now runs until a health pool empties, so six is not a length any more —
  // and since neither side fires here, no health moves and the match can only end
  // on the structural backstop. Running to resolution rather than to a number is
  // what the test was always about: a match ENDS, and the server says how.
  const fixture = liveMatch();
  let authority = fixture.authority;
  let roundsPlayed = 0;

  while (matchResult(authority) === null && roundsPlayed <= DUEL_ROUND_CEILING) {
    authority = advanceUntil(
      authority,
      (a) => a.state.phase === "QUESTION_PENDING" || matchResult(a) !== null,
      6000,
    );
    if (matchResult(authority) !== null) break;
    fixture.authority = authority;
    authority = answerRound(fixture, {
      A: roundsPlayed % 2 === 0 ? "WRONG" : "CORRECT",
      B: "CORRECT",
    });
    roundsPlayed += 1;
    // Run the round out: countdown, engagement, line-of-sight break.
    authority = advanceUntil(
      authority,
      (a) =>
        a.state.phase === "QUESTION_PENDING" ||
        a.state.phase === "DUEL_RESOLVED" ||
        matchResult(a) !== null,
      6000,
    );
  }

  const result = matchResult(authority);
  assert.ok(
    result,
    `a match must end with a result; stopped after ${roundsPlayed} rounds in ${authority.state.phase}`,
  );
  assert.equal(result.matchId, authority.identity.matchId);
  assert.ok(["KNOCKOUT", "ROUNDS_EXHAUSTED", "FORFEIT"].includes(result.reason));
  // It went past the old fixed length, which is the whole point of the change.
  assert.ok(
    roundsPlayed > 6,
    `an unfired duel should reach the ceiling, not stop at six; played ${roundsPlayed}`,
  );
});

test("leaving the match is a loss decided by the server", () => {
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  fixture.authority = answerRound(fixture, { A: "CORRECT", B: "CORRECT" });
  const live = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "ENGAGEMENT_LIVE",
  );
  const forfeited = forfeitMatch(live, "B", "ABANDONED");
  const result = matchResult(forfeited);
  assert.ok(result);
  assert.equal(result.winner, "A");
  assert.equal(result.loser, "B");
  assert.equal(result.reason, "FORFEIT");
  assert.equal(result.standingApplies, true, "closing the tab does not dodge the loss");
  // And it is terminal: further advancing cannot revive it.
  assert.equal(advanceMatch(forfeited, FIELD_DT).authority.phase, "FORFEITED");
});
