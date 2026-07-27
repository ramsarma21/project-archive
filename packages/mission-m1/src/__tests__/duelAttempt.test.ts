// The canonical duel identity and question selection, checked against the very
// algorithm the client runs.
//
// The grading authority reconstructs which item a round asks from a stored attempt
// (its 32-hex seed and ordinal). If that reconstruction drifts from what the client
// plays, the server grades the wrong question and the whole attempt-binding is
// theatre. These tests pin the helper to `duelQuestionsForAttempt` + `askQuestion`
// over the seed `m1DuelSeed` derives — the same three pieces the client uses — so a
// change to any of them that would desync the two fails here.

import assert from "node:assert/strict";
import test from "node:test";

import { askQuestion } from "@pa/duel";
import { M1_EFFIGY_RUN } from "../level/index.js";
import {
  duelQuestionsForAttempt,
  m1DuelBank,
  m1DuelId,
  m1DuelSeed,
  m1ExpectedDuelItem,
} from "../duelBrief.js";

const SEED_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("the duel id is the level id suffixed with the attempt ordinal", () => {
  for (const ordinal of [1, 2, 3]) {
    assert.equal(m1DuelId(ordinal), `${M1_EFFIGY_RUN.id}#duel@${ordinal}`);
  }
});

test("the server bank narrows duelQuestionsForAttempt to plain question refs on the same seed", () => {
  for (const ordinal of [1, 2, 3]) {
    const seed = m1DuelSeed(SEED_HEX);
    const rich = duelQuestionsForAttempt(seed, ordinal);
    const bank = m1DuelBank(SEED_HEX, ordinal);
    assert.equal(bank.length, rich.length);
    bank.forEach((ref, index) => {
      assert.deepEqual(ref, {
        itemId: rich[index]!.itemId,
        itemVersion: rich[index]!.itemVersion,
        conceptId: rich[index]!.conceptId,
      });
    });
  }
});

test("the expected item per round matches askQuestion over the same bank and seed", () => {
  for (const ordinal of [1, 2, 3]) {
    const seed = m1DuelSeed(SEED_HEX);
    const bank = m1DuelBank(SEED_HEX, ordinal);
    for (let round = 1; round <= 40; round += 1) {
      const expected = m1ExpectedDuelItem({
        attemptSeedHex: SEED_HEX,
        attemptOrdinal: ordinal,
        round,
      });
      const direct = askQuestion(bank, round, seed);
      assert.equal(expected.item.itemId, direct.item.itemId, `round ${round}, ordinal ${ordinal}`);
      assert.equal(expected.appearance, direct.appearance);
      assert.equal(expected.recycled, direct.recycled);
    }
  }
});

test("different attempts draw different questions for the same round", () => {
  const round = 1;
  const a1 = m1ExpectedDuelItem({ attemptSeedHex: SEED_HEX, attemptOrdinal: 1, round }).item.itemId;
  const a2 = m1ExpectedDuelItem({ attemptSeedHex: SEED_HEX, attemptOrdinal: 2, round }).item.itemId;
  assert.notEqual(a1, a2, "attempt two must not replay attempt one's first question");
});
