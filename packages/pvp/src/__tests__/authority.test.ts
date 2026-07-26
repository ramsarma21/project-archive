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
  PLAYER_MAX_HEALTH,
  currentAmmo,
  currentHealth,
} from "@pa/duel";
import {
  advanceMatch,
  ingestIntent,
  matchResult,
  silentSides,
  submitVerdict,
  DISCONNECT_GRACE_MS,
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
