import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCarryPolicy,
  bulletsForSource,
  bulletsForVerdict,
  grantRoundBullets,
  lifetimeBullets,
} from "../bullets.js";
import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  BULLET_CARRY_POLICY,
  KNOWLEDGE_ADVANTAGE_RATIO,
  MAX_SPENDABLE_SHOTS_PER_ROUND,
  SUGGESTED_CARRY_CAP,
  UNSPENDABLE_CORRECT_BULLETS,
  assertGrantIsSpendable,
} from "../tuning.js";

test("bullets are derived from the verdict and nothing else", () => {
  assert.equal(bulletsForVerdict("CORRECT"), 14);
  assert.equal(bulletsForVerdict("WRONG"), 7);
  assert.equal(BULLETS_FOR_CORRECT, 14);
  assert.equal(BULLETS_FOR_WRONG, 7);
  // 2, AND THE ROUND NUMBER IS A COINCIDENCE RATHER THAN A CONSTRAINT, which is the
  // one thing to understand here. The floor briefly went to 9 to fill the emptiest
  // round in the game and came back to 7 pending playtest; 14 did not move either
  // time, because it is what the round can physically discharge. So the ratio is an
  // OUTPUT of those two decisions, and it must never again be an input to either —
  // see KNOWLEDGE_ADVANTAGE_RATIO for the HUD test that used to make it one.
  assert.ok(
    Math.abs(KNOWLEDGE_ADVANTAGE_RATIO - BULLETS_FOR_CORRECT / BULLETS_FOR_WRONG) < 1e-9,
    `the ratio is ${KNOWLEDGE_ADVANTAGE_RATIO}`,
  );
  assert.ok(KNOWLEDGE_ADVANTAGE_RATIO > 1.15, "knowledge must still be worth having");
});

test("A CORRECT ANSWER'S MAGAZINE CAN ACTUALLY BE FIRED", () => {
  // The one failure in this package that would not show up as a failing test
  // anywhere else: a grant larger than the round can discharge expires unfired,
  // and 14 balls quietly becomes worth the same as 7 while everything stays green.
  assert.ok(
    BULLETS_FOR_CORRECT <= MAX_SPENDABLE_SHOTS_PER_ROUND,
    `a round can fire ${MAX_SPENDABLE_SHOTS_PER_ROUND} balls but grants ${BULLETS_FOR_CORRECT}`,
  );
  assert.equal(UNSPENDABLE_CORRECT_BULLETS, 0);
  assert.doesNotThrow(assertGrantIsSpendable);
  // And enough slack that a player who opens the round in cover can still spend it.
  assert.ok(
    MAX_SPENDABLE_SHOTS_PER_ROUND - BULLETS_FOR_CORRECT >= 4,
    "too little slack: a magazine only spendable by firing from the first tick is " +
      "a magazine that punishes using cover",
  );
});

test("the PvP table is the per-side rule applied twice, not a special case", () => {
  const rows: ReadonlyArray<readonly ["CORRECT" | "WRONG", "CORRECT" | "WRONG", number, number]> = [
    ["WRONG", "WRONG", BULLETS_FOR_WRONG, BULLETS_FOR_WRONG],
    ["CORRECT", "CORRECT", BULLETS_FOR_CORRECT, BULLETS_FOR_CORRECT],
    ["CORRECT", "WRONG", BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG],
    ["WRONG", "CORRECT", BULLETS_FOR_WRONG, BULLETS_FOR_CORRECT],
  ];
  for (const [a, b, expectedA, expectedB] of rows) {
    assert.equal(bulletsForVerdict(a), expectedA, `side A on ${a}`);
    assert.equal(bulletsForVerdict(b), expectedB, `side B on ${b}`);
  }
});

test("the economy is symmetric and zero-sum in advantage, never in total", () => {
  const advantage = (a: "CORRECT" | "WRONG", b: "CORRECT" | "WRONG") =>
    bulletsForVerdict(a) - bulletsForVerdict(b);
  assert.equal(advantage("CORRECT", "WRONG"), -advantage("WRONG", "CORRECT"));
  assert.equal(advantage("CORRECT", "CORRECT"), 0);
  assert.equal(advantage("WRONG", "WRONG"), 0);
});

test("the shipped carry policy expires unspent bullets at the boundary", () => {
  assert.equal(BULLET_CARRY_POLICY.kind, "EXPIRE");
  const { carried, expired } = applyCarryPolicy(2, BULLET_CARRY_POLICY);
  assert.equal(carried, 0);
  assert.equal(expired, 2);
});

test("carry is implemented and capped, so playtest can flip one constant", () => {
  const capped = applyCarryPolicy(SUGGESTED_CARRY_CAP + 2, {
    kind: "CARRY",
    cap: SUGGESTED_CARRY_CAP,
  });
  assert.equal(capped.carried, SUGGESTED_CARRY_CAP);
  assert.equal(capped.expired, 2);
  const under = applyCarryPolicy(1, { kind: "CARRY", cap: 3 });
  assert.deepEqual(under, { carried: 1, expired: 0 });
});

test("expiry is one parameter, and it is the only thing that decides carry", () => {
  // The owner wants to trade expiry against fire rate without the economy being
  // rewritten. That trade is this argument: same grant, same unspent, opposite
  // policy, and no other input differs.
  const shared = {
    source: { kind: "VERDICT", verdict: "CORRECT" },
    unspentFromPreviousRound: 5,
  } as const;
  const expire = grantRoundBullets({ ...shared, policy: { kind: "EXPIRE" } });
  assert.deepEqual(expire, {
    granted: BULLETS_FOR_CORRECT,
    carriedIn: 0,
    expired: 5,
    magazine: BULLETS_FOR_CORRECT,
    source: "VERDICT",
  });

  const carry = grantRoundBullets({
    ...shared,
    policy: { kind: "CARRY", cap: 3 },
  });
  assert.deepEqual(carry, {
    granted: BULLETS_FOR_CORRECT,
    carriedIn: 3,
    expired: 2,
    magazine: BULLETS_FOR_CORRECT + 3,
    source: "VERDICT",
  });
});

test("an authored magazine is a separate source and cannot be negative", () => {
  assert.equal(bulletsForSource({ kind: "AUTHORED", bullets: 3 }), 3);
  assert.equal(bulletsForSource({ kind: "AUTHORED", bullets: -5 }), 0);
  assert.equal(bulletsForSource({ kind: "AUTHORED", bullets: 2.9 }), 2);
});

test("carry cannot create bullets, only defer them", () => {
  const rounds = 9;
  assert.equal(lifetimeBullets("WRONG", rounds), BULLETS_FOR_WRONG * rounds);
  assert.equal(lifetimeBullets("CORRECT", rounds), BULLETS_FOR_CORRECT * rounds);
  assert.equal(
    lifetimeBullets("WRONG", rounds, { kind: "CARRY", cap: 99 }),
    lifetimeBullets("WRONG", rounds, { kind: "EXPIRE" }),
  );
});

test("a duel has no lifetime bullet budget any more, only a rate", () => {
  // Under six rounds this number was the whole damage model: a wrong-answer duel
  // was exactly six shots and boss health was capped against it. With the round
  // count unbounded there is no total to derive anything from — what matters is
  // balls PER ROUND, because that is what sets the damage rate the exchange model
  // compares. `lifetimeBullets` survives only as a projection over a given number
  // of rounds, and takes that number as an argument precisely because the duel
  // cannot supply one.
  assert.equal(lifetimeBullets("WRONG", 1), BULLETS_FOR_WRONG);
  assert.equal(lifetimeBullets("WRONG", 100), BULLETS_FOR_WRONG * 100);
});
