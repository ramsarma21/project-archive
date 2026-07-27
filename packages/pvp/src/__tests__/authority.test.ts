// Server authority: what a modified client can say, and how each lie fails.

import { test } from "node:test";
import assert from "node:assert/strict";
// The bullet and health figures are IMPORTED, never restated. The duel retuned
// both during the open-ended-rounds work — bullets 3/1 to 14/7, player health 100
// to 200 — and a test carrying its own copy of either would have needed editing
// per retune, which is the same copied-constant failure that broke the grading
// service's round bound. check-boundaries.mjs now fails the build on a re-declared
// one, so this is enforced rather than advised.
import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  FIELD_DT,
  IDLE_INTENT,
  PLAYER_MAX_HEALTH,
  currentAmmo,
  currentHealth,
} from "@pa/duel";
import {
  advanceMatch,
  awaitingVerdicts,
  decayHeldIntents,
  ingestIntent,
  markSeen,
  matchResult,
  silentSides,
  submitVerdict,
  DISCONNECT_GRACE_MS,
  INTENT_DECAY_MS,
} from "../authority.js";
import {
  INTENT_FRAME_KEYS,
  MAX_INTENT_LEAD_TICKS,
  MAX_INTENT_LAG_TICKS,
  parseIntentFrame,
  toCombatIntent,
  type ClientIntentFrame,
} from "../intents.js";
import {
  advanceUntil,
  answerRound,
  askedEnvelope,
  envelopeFor,
  expectedReceipt,
  liveMatch,
  unaskedItem,
} from "./harness.js";

function frame(overrides: Partial<ClientIntentFrame> = {}): ClientIntentFrame {
  return {
    seq: 1,
    tick: 0,
    moveX: 0,
    moveZ: 1,
    sprint: false,
    crouch: false,
    jump: false,
    dodge: false,
    fire: false,
    aimX: 0,
    aimZ: 1,
    abilityId: null,
    ...overrides,
  };
}

test("a client cannot describe state, so it cannot lie about state", () => {
  // The anti-cheat design in one assertion: there is no field for a position, a
  // health value, a hit, a bullet count or an outcome, so a modified client has no
  // vocabulary for any of them.
  for (const forbidden of [
    "x",
    "z",
    "position",
    "health",
    "hit",
    "damage",
    "ammo",
    "bullets",
    "kill",
    "winner",
    "score",
  ]) {
    assert.equal(
      (INTENT_FRAME_KEYS as readonly string[]).includes(forbidden),
      false,
      `${forbidden} must not be an input`,
    );
    const parsed = parseIntentFrame({ ...frame(), [forbidden]: 1 });
    assert.equal(parsed.ok, false, `${forbidden} must be refused`);
    if (!parsed.ok) assert.equal(parsed.reason, "UNKNOWN_FIELD");
  }
});

test("a speed hack normalises away to a direction", () => {
  const cheating = toCombatIntent(frame({ moveX: 1e9, moveZ: 1e9 }));
  const honest = toCombatIntent(frame({ moveX: 1, moveZ: 1 }));
  // A billion and a one produce the same instruction: go that way.
  assert.ok(Math.abs(cheating.moveX - honest.moveX) < 1e-9);
  assert.ok(Math.abs(cheating.moveZ - honest.moveZ) < 1e-9);
  assert.ok(Math.hypot(cheating.moveX, cheating.moveZ) <= 1 + 1e-9);
  assert.ok(Math.hypot(cheating.aimX, cheating.aimZ) <= 1 + 1e-9);
});

test("non-finite and malformed inputs are refused rather than coerced", () => {
  assert.equal(parseIntentFrame({ ...frame(), moveX: Number.NaN }).ok, false);
  assert.equal(parseIntentFrame({ ...frame(), moveZ: Number.POSITIVE_INFINITY }).ok, false);
  assert.equal(parseIntentFrame({ ...frame(), fire: "yes" }).ok, false);
  assert.equal(parseIntentFrame({ ...frame(), abilityId: 7 }).ok, false);
  assert.equal(parseIntentFrame(null).ok, false);
  assert.equal(parseIntentFrame([frame()]).ok, false);
});

test("replayed and rewound frames are dropped", () => {
  const fixture = liveMatch();
  const first = ingestIntent(fixture.authority, "A", frame({ seq: 5 }), 0);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const replayed = ingestIntent(first.authority, "A", frame({ seq: 5 }), 0);
  assert.equal(replayed.ok, false);
  if (!replayed.ok) assert.equal(replayed.reason, "STALE_SEQUENCE");
  const rewound = ingestIntent(first.authority, "A", frame({ seq: 2 }), 0);
  assert.equal(rewound.ok, false);
});

test("a client cannot schedule the future or revise the past", () => {
  const fixture = liveMatch();
  const tick = fixture.authority.state.combat.tick;
  const ahead = ingestIntent(
    fixture.authority,
    "A",
    frame({ seq: 1, tick: tick + MAX_INTENT_LEAD_TICKS + 5 }),
    0,
  );
  assert.equal(ahead.ok, false);
  if (!ahead.ok) assert.equal(ahead.reason, "TICK_TOO_FAR_AHEAD");

  const behind = ingestIntent(
    fixture.authority,
    "A",
    frame({ seq: 1, tick: tick - MAX_INTENT_LAG_TICKS - 5 }),
    0,
  );
  assert.equal(behind.ok, false);
  if (!behind.ok) assert.equal(behind.reason, "TICK_TOO_FAR_BEHIND");
});

test("a forged verdict receipt cannot become bullets", () => {
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  // The item the authority is actually asking, so the forged RECEIPT is what fails
  // and not the item id. Indexing the draw refused this on WRONG_ITEM before the
  // receipt was ever checked, which made the test green about the wrong thing.
  const forged = submitVerdict(
    fixture.authority,
    "A",
    askedEnvelope(fixture.authority, "CORRECT"),
    "not-a-real-receipt",
    fixture.verify,
  );
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.reason, "RECEIPT_INVALID");
  assert.equal(
    forged.authority.state.phase,
    "QUESTION_PENDING",
    "the round did not advance on a forged verdict",
  );
});

test("a receipt from another round or another player does not transfer", () => {
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  const envelope = askedEnvelope(fixture.authority, "CORRECT");
  const round = fixture.authority.state.round;

  // A receipt minted for a LATER round of this same match.
  const wrongRound = expectedReceipt(envelope, {
    profileId: fixture.authority.participants.A.profileId,
    attemptId: fixture.authority.identity.matchId,
    roundIndex: round + 5,
  });
  const replayed = submitVerdict(fixture.authority, "A", envelope, wrongRound, fixture.verify);
  assert.equal(replayed.ok, false);
  // The REASON is asserted, not just the refusal. This test went on passing after
  // the draw changed because `WRONG_ITEM` is also a refusal — it was green while
  // checking nothing about receipts at all.
  if (!replayed.ok) assert.equal(replayed.reason, "RECEIPT_INVALID");

  // A receipt minted for the opponent.
  const otherPlayer = expectedReceipt(envelope, {
    profileId: fixture.authority.participants.B.profileId,
    attemptId: fixture.authority.identity.matchId,
    roundIndex: round,
  });
  const lifted = submitVerdict(fixture.authority, "A", envelope, otherPlayer, fixture.verify);
  assert.equal(lifted.ok, false);
  if (!lifted.ok) assert.equal(lifted.reason, "RECEIPT_INVALID");
});

test("a CORRECT flipped onto a WRONG envelope fails verification", () => {
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  const honest = askedEnvelope(fixture.authority, "WRONG");
  const receipt = expectedReceipt(honest, {
    profileId: fixture.authority.participants.A.profileId,
    attemptId: fixture.authority.identity.matchId,
    roundIndex: fixture.authority.state.round,
  });
  // Same receipt, kind flipped in flight.
  const flipped = { ...honest, kind: "CORRECT" as const };
  const result = submitVerdict(fixture.authority, "A", flipped, receipt, fixture.verify);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "RECEIPT_INVALID");
});

test("a verdict for the wrong item is refused", () => {
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  // Derived as "any item that is not the one being asked" rather than indexed at a
  // fixed position, which under a seeded draw could BE the asked item and turn this
  // into a test of nothing. The receipt is honest, so WRONG_ITEM is the only thing
  // left to fail on.
  const other = unaskedItem(fixture.authority, fixture.questions);
  const envelope = envelopeFor(other.itemId, "CORRECT");
  const receipt = expectedReceipt(envelope, {
    profileId: fixture.authority.participants.A.profileId,
    attemptId: fixture.authority.identity.matchId,
    roundIndex: fixture.authority.state.round,
  });
  const result = submitVerdict(fixture.authority, "A", envelope, receipt, fixture.verify);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "WRONG_ITEM");
});

test("bullets come from the verdict and match the symmetric table", () => {
  // Symmetry is what this asserts, and it holds at any pair of values: the same
  // verdict pays the same on either side, and a correct answer pays more than a
  // wrong one. Both figures come from @pa/duel.
  assert.ok(BULLETS_FOR_CORRECT > BULLETS_FOR_WRONG, "knowledge must be worth more");
  for (const [a, b, expected] of [
    ["WRONG", "WRONG", { A: BULLETS_FOR_WRONG, B: BULLETS_FOR_WRONG }],
    ["CORRECT", "CORRECT", { A: BULLETS_FOR_CORRECT, B: BULLETS_FOR_CORRECT }],
    ["CORRECT", "WRONG", { A: BULLETS_FOR_CORRECT, B: BULLETS_FOR_WRONG }],
    ["WRONG", "CORRECT", { A: BULLETS_FOR_WRONG, B: BULLETS_FOR_CORRECT }],
  ] as const) {
    const fixture = liveMatch();
    fixture.authority = advanceUntil(
      fixture.authority,
      (x) => x.state.phase === "QUESTION_PENDING",
    );
    fixture.authority = answerRound(fixture, { A: a, B: b });
    const granted = advanceUntil(
      fixture.authority,
      (x) => x.state.phase === "BULLETS_GRANTED" || x.state.phase === "ENGAGEMENT_LIVE",
    );
    assert.deepEqual(currentAmmo(granted.state), expected, `${a} vs ${b}`);
  }
});

test("silence forfeits, but thinking about an untimed question does not", () => {
  const fixture = liveMatch();
  const asking = advanceUntil(fixture.authority, (a) => a.state.phase === "QUESTION_PENDING");
  assert.deepEqual(
    [...silentSides(asking, DISCONNECT_GRACE_MS * 10)],
    [],
    "an untimed question must never time a player out",
  );

  const fighting = (() => {
    const fx = liveMatch();
    fx.authority = advanceUntil(fx.authority, (a) => a.state.phase === "QUESTION_PENDING");
    fx.authority = answerRound(fx, { A: "CORRECT", B: "CORRECT" });
    return advanceUntil(fx.authority, (a) => a.state.phase === "ENGAGEMENT_LIVE");
  })();
  assert.deepEqual(
    [...silentSides(fighting, fighting.identity.startedAtMs + DISCONNECT_GRACE_MS + 1)],
    ["A", "B"],
    "silence during live play is a disconnect",
  );
});

test("a wrong answer is a graded penalty, never a forfeit or a resolution", () => {
  // The product invariant: a normal incorrect answer applies the configured penalty
  // (the reduced magazine) and the match continues through the post-answer countdown.
  // It is not a forfeit, and it does not resolve the match while both sides survive.
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  const answered = answerRound(fixture, { A: "WRONG", B: "WRONG" });

  // The match is still LIVE and has no result: a wrong answer decided nothing.
  assert.equal(answered.phase, "LIVE", "a wrong answer never forfeits the match");
  assert.equal(matchResult(answered), null, "and it does not resolve it");

  // The reduced (wrong-answer) magazine is what a wrong answer costs — both sides.
  const granted = advanceUntil(
    answered,
    (a) => a.state.phase === "BULLETS_GRANTED" || a.state.phase === "ENGAGEMENT_LIVE",
  );
  assert.deepEqual(currentAmmo(granted.state), {
    A: BULLETS_FOR_WRONG,
    B: BULLETS_FOR_WRONG,
  });
  assert.deepEqual(currentHealth(granted.state), {
    A: PLAYER_MAX_HEALTH,
    B: PLAYER_MAX_HEALTH,
  });
  assert.equal(matchResult(granted), null, "still no result: both players remain up");
});

test("presence, not input, decides a disconnect: a polling side is never forfeited", () => {
  // The live bug in one assertion. After an untimed question both sides' intent
  // clocks are stale (movement is suspended while answering). When combat resumes the
  // side that starts MOVING refreshes its intent clock; a side that is only POLLING
  // does not — so measured on intents alone it looks silent, one side, a spurious
  // DISCONNECTED forfeit of a player who never left. `markSeen` records that a
  // polling side is present, and `silentSides` measures presence.
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  const answered = answerRound(fixture, { A: "WRONG", B: "WRONG" });
  const fighting = advanceUntil(answered, (a) => a.state.phase === "ENGAGEMENT_LIVE");

  const t = fighting.identity.startedAtMs + DISCONNECT_GRACE_MS + 1;
  // Baseline (the guard we must preserve): with NO contact past the grace, both are
  // silent — the disconnect detector still works.
  assert.deepEqual([...silentSides(fighting, t)], ["A", "B"]);

  // A moves (an intent frame); B only polls (markSeen). Neither is now disconnected.
  const aMoved = ingestIntent(
    fighting,
    "A",
    frame({ seq: 99, tick: fighting.state.combat.tick }),
    t,
  );
  assert.equal(aMoved.ok, true);
  if (!aMoved.ok) return;
  const bPolled = markSeen(aMoved.authority, "B", t);
  assert.deepEqual(
    [...silentSides(bPolled, t)],
    [],
    "a side that is polling is present, not a disconnect",
  );

  // And a side that then genuinely stops — B keeps polling, A goes dark — is the one
  // and only side forfeited, so the guard still bites exactly where it should.
  const later = t + DISCONNECT_GRACE_MS + 1;
  const bStillPolling = markSeen(bPolled, "B", later);
  assert.deepEqual([...silentSides(bStillPolling, later)], ["A"]);
});

test("a held intent decays to idle after silence, before the forfeit", () => {
  const fixture = liveMatch();
  // A sends one instruction at t = 1000, then goes quiet. A fresh match is already
  // in a live, pre-question phase, so nothing is awaiting a verdict.
  const moving = ingestIntent(fixture.authority, "A", frame({ seq: 1, moveZ: 1 }), 1_000);
  assert.equal(moving.ok, true);
  if (!moving.ok) return;
  assert.notEqual(moving.authority.heldIntents.A, IDLE_INTENT, "the instruction is held");

  // Still inside the decay window: the instruction keeps repeating, which is what
  // carries a player through one dropped packet.
  const held = decayHeldIntents(moving.authority, 1_000 + INTENT_DECAY_MS - 1);
  assert.notEqual(held.heldIntents.A, IDLE_INTENT);

  // Past it: the body stops rather than sprinting into a wall for the whole grace
  // window, and B — which never moved — is untouched.
  const decayed = decayHeldIntents(moving.authority, 1_000 + INTENT_DECAY_MS + 1);
  assert.equal(decayed.heldIntents.A, IDLE_INTENT, "a silent side stops");
  assert.equal(decayed.heldIntents.B, moving.authority.heldIntents.B);
  // And it decays before the disconnect grace forfeits, which is the ordering.
  assert.ok(INTENT_DECAY_MS < DISCONNECT_GRACE_MS);
});

test("thinking about an untimed question never zeroes a player's movement", () => {
  const fixture = liveMatch();
  const moving = ingestIntent(fixture.authority, "A", frame({ seq: 1, moveZ: 1 }), 1_000);
  assert.equal(moving.ok, true);
  if (!moving.ok) return;
  const asking = advanceUntil(moving.authority, (a) => a.state.phase === "QUESTION_PENDING");
  // Long past the decay window, but the machine is awaiting a verdict, so nobody is
  // "silent" — they are answering. The held intent is left alone.
  const unchanged = decayHeldIntents(asking, 1_000 + INTENT_DECAY_MS * 100);
  assert.equal(unchanged, asking, "no decay while a verdict is owed");
});

test("once a side answers, it no longer owes a verdict this round", () => {
  // The mechanism the read route uses to omit the question from the side that has
  // already answered: `awaitingVerdicts` shrinks to just the side still owing one.
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  assert.deepEqual([...awaitingVerdicts(fixture.authority)], ["A", "B"]);

  const envelope = askedEnvelope(fixture.authority, "CORRECT");
  const receipt = expectedReceipt(envelope, {
    profileId: fixture.authority.participants.A.profileId,
    attemptId: fixture.authority.identity.matchId,
    roundIndex: fixture.authority.state.round,
  });
  const committed = submitVerdict(fixture.authority, "A", envelope, receipt, fixture.verify);
  assert.equal(committed.ok, true);
  if (!committed.ok) return;

  const owed = awaitingVerdicts(committed.authority);
  assert.equal(owed.includes("A"), false, "the answered side is no longer handed the question");
  assert.equal(owed.includes("B"), true, "the opponent still owes one");
});

test("the result is the server's, and there is no client path to it", () => {
  const fixture = liveMatch();
  assert.equal(matchResult(fixture.authority), null);
  // Nothing a client sends is an outcome: the only mutators are intents (validated),
  // verdicts (receipt-bound) and a forfeit (which is a loss for the sender).
  const withIntent = ingestIntent(fixture.authority, "A", frame(), 0);
  assert.equal(withIntent.ok, true);
  if (!withIntent.ok) return;
  assert.equal(matchResult(withIntent.authority), null);
  // PvP is symmetric: both sides are players, so both start on the player pool.
  assert.deepEqual(currentHealth(withIntent.authority.state), {
    A: PLAYER_MAX_HEALTH,
    B: PLAYER_MAX_HEALTH,
  });
  assert.equal(advanceMatch(withIntent.authority, FIELD_DT).authority.phase, "LIVE");
});
