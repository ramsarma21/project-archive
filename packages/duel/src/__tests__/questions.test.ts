import { test } from "node:test";
import assert from "node:assert/strict";
import { askQuestion, bankOrder, roundsBeforeRecycling } from "../questions.js";
import { bossProfileForTier } from "../boss.js";
import { referenceArena } from "../arena.js";
import { createDuel } from "../machine.js";
import { serialiseCommitLog } from "../events.js";
import { questionSet, runDuel } from "./harness.js";

const BANK = questionSet(18);

test("a bank covers its own length before anything repeats", () => {
  assert.equal(roundsBeforeRecycling(BANK), 18);
  const seen = new Set<string>();
  for (let round = 1; round <= BANK.length; round++) {
    const asked = askQuestion(BANK, round, 4242);
    assert.equal(asked.appearance, 1);
    assert.equal(asked.recycled, false);
    assert.equal(seen.has(asked.item.itemId), false, "no repeat inside a pass");
    seen.add(asked.item.itemId);
  }
  assert.equal(seen.size, BANK.length, "and every authored item gets asked");
});

test("PAST THE BOTTOM OF THE BANK IT RECYCLES, AND SAYS SO", () => {
  // An unbounded duel can outlast eighteen authored items. The assessment engine
  // met this first and answered it by disclosing reuse rather than hiding it —
  // @pa/reporting carries mastery on a repeat as RECYCLED_ITEMS and qualifies the
  // claim — and this is the same disclosure one layer down.
  const first = askQuestion(BANK, 1, 4242);
  const second = askQuestion(BANK, BANK.length + 1, 4242);
  assert.equal(first.recycled, false);
  assert.equal(second.recycled, true);
  assert.equal(second.appearance, 2);
  assert.equal(askQuestion(BANK, BANK.length * 2 + 1, 4242).appearance, 3);
});

test("every lap is a permutation, so no item is asked twice inside one", () => {
  // The seam adjustment swaps rather than skips, precisely so this stays true.
  for (const seed of [1, 19, 4242]) {
    for (let pass = 0; pass < 4; pass++) {
      const lap = Array.from({ length: BANK.length }, (_unused, index) =>
        askQuestion(BANK, pass * BANK.length + index + 1, seed).item.itemId,
      );
      assert.equal(new Set(lap).size, BANK.length, `seed ${seed} pass ${pass} repeats`);
    }
  }
});

test("the second lap is a different order from the first", () => {
  // Otherwise a long duel reads as a loop, which is the thing that makes recycling
  // feel like a bug rather than a policy.
  const firstPass = Array.from({ length: BANK.length }, (_unused, index) =>
    askQuestion(BANK, index + 1, 4242).item.itemId,
  );
  const secondPass = Array.from({ length: BANK.length }, (_unused, index) =>
    askQuestion(BANK, BANK.length + index + 1, 4242).item.itemId,
  );
  assert.notDeepEqual(firstPass, secondPass);
  assert.deepEqual([...secondPass].sort(), [...firstPass].sort(), "same items, new order");
});

test("no item is ever asked twice in a row, including across the seam", () => {
  for (const seed of [1, 7, 19, 4242, 90210]) {
    let previous = "";
    for (let round = 1; round <= BANK.length * 3; round++) {
      const asked = askQuestion(BANK, round, seed);
      assert.notEqual(
        asked.item.itemId,
        previous,
        `seed ${seed} asked ${asked.item.itemId} twice running at round ${round}`,
      );
      previous = asked.item.itemId;
    }
  }
});

test("the order is seeded, so an authority and a replay ask the same question", () => {
  const a = Array.from({ length: 40 }, (_unused, index) =>
    askQuestion(BANK, index + 1, 777).item.itemId,
  );
  const b = Array.from({ length: 40 }, (_unused, index) =>
    askQuestion(BANK, index + 1, 777).item.itemId,
  );
  assert.deepEqual(a, b);
  const other = Array.from({ length: 40 }, (_unused, index) =>
    askQuestion(BANK, index + 1, 778).item.itemId,
  );
  assert.notDeepEqual(a, other);
  assert.deepEqual(bankOrder(6, 5, 0), bankOrder(6, 5, 0));
});

test("a bank of one is legal and simply repeats, disclosing every time", () => {
  const single = questionSet(1);
  assert.equal(askQuestion(single, 1, 1).recycled, false);
  assert.equal(askQuestion(single, 2, 1).recycled, true);
  assert.equal(askQuestion(single, 9, 1).appearance, 9);
});

test("an empty bank is refused rather than silently skipping the question", () => {
  assert.throws(() => askQuestion([], 1, 1), /at least one authored question/);
  const arena = referenceArena();
  assert.throws(
    () =>
      createDuel({
        duelId: "TEST",
        seed: 1,
        world: arena.world,
        opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
        questions: [],
      }),
    /at least one authored question/,
  );
});

test("a duel that outlasts its bank keeps asking, and the log discloses it", () => {
  // Three items and a duel with nobody firing, so it runs to the backstop and has
  // to ask far more questions than it was given.
  const result = runDuel({
    opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
    verdicts: () => "WRONG",
    intents: () => ({
      moveX: 0,
      moveZ: 0,
      sprint: false,
      crouch: false,
      jump: false,
      dodge: false,
      fire: false,
      aimX: 0,
      aimZ: 0,
      abilityId: null,
    }),
    bankSize: 3,
    roundCeiling: 8,
  });
  const opened = result.log.filter((event) => event.type === "QUESTION_OPENED");
  assert.equal(opened.length, 8, "the duel did not stop when the bank ran out");
  const recycled = opened.filter(
    (event) => event.type === "QUESTION_OPENED" && event.recycled,
  );
  assert.equal(recycled.length, 5, "rounds 4 to 8 are repeats, and every one is flagged");
});

test("a reused item is identifiable as a repeat in the PERSISTED record, not just at ask time", () => {
  // Reuse is a stopgap (see questions.ts), and the owner's condition on it is that a
  // repeat must not read as a fresh question to either the player or the learning
  // record. The player half is the "asked again" marker in QuestionPanel. This is the
  // record half: the durable commit log the API's per-concept retrieval ledger reads
  // must carry, per round, whether the graded item was a repeat and its appearance
  // ordinal — so "asked five times, right five times in one match" cannot be booked as
  // five independent retrievals. It rides the committed VERDICT_COMMITTED record
  // because the grading-request wire is a strict allowlist that cannot carry it.
  const result = runDuel({
    opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
    verdicts: () => "WRONG",
    intents: () => ({
      moveX: 0,
      moveZ: 0,
      sprint: false,
      crouch: false,
      jump: false,
      dodge: false,
      fire: false,
      aimX: 0,
      aimZ: 0,
      abilityId: null,
    }),
    bankSize: 3,
    roundCeiling: 8,
  });

  const committed = serialiseCommitLog(result.log).filter(
    (entry) => entry.type === "VERDICT_COMMITTED" && entry.side === "A",
  );
  assert.equal(committed.length, 8, "every round commits a player verdict");

  // Rounds 1-3 are the first pass: fresh, appearance 1. Rounds 4-8 are reuse: flagged
  // as recycled with a rising appearance ordinal the ledger can weight down.
  for (const entry of committed) {
    const round = entry.round as number;
    const expectedAppearance = Math.floor((round - 1) / 3) + 1;
    assert.equal(
      entry.appearance,
      expectedAppearance,
      `round ${round} should record appearance ${expectedAppearance}`,
    );
    assert.equal(
      entry.recycled,
      round > 3,
      `round ${round} recycled flag`,
    );
  }
  // And the fact is durable specifically — it survives serialisation into the log
  // that leaves the client, rather than living only on the transient QUESTION_OPENED.
  assert.ok(
    committed.some((entry) => entry.recycled === true),
    "at least one repeat is recorded as a repeat in the persisted log",
  );
});
