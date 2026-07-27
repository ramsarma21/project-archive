// The boss duel resolves each round's item to its authored Codex cards, and does so
// deterministically and canonically.
//
// The relation is authored once (codex-cards.json `askedBy`), and this proves the
// derived view matches the other authored file (duel-items.json `codexCardIds`), so
// the two cannot drift; that same seed/ordinal/round resolves the same item and the
// same cards; that different rounds land on each item's own authored cards; and that
// no resolved card id is one the Codex does not define.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  M1_DUEL_ITEMS,
  duelItemCodexCardIds,
  duelItemCodexCards,
  m1ExpectedDuelItem,
  m1ExpectedDuelCardIds,
} from "../index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(HERE, "../../../../content/m1");

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(CONTENT, name), "utf8"));
}

const codexCards = (readJson("codex-cards.json").cards ?? []) as {
  cardId: string;
  title: string;
}[];
const AUTHORED_CARD_IDS = new Set(codexCards.map((card) => card.cardId));

const SEED_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("the item→cards inversion matches duel-items.json exactly — the two files agree", () => {
  const bank = readJson("duel-items.json").items as {
    itemId: string;
    codexCardIds: string[];
  }[];
  assert.ok(bank.length >= 18);
  for (const item of bank) {
    assert.deepEqual(
      [...duelItemCodexCardIds(item.itemId)].sort(),
      [...item.codexCardIds].sort(),
      `${item.itemId}: derived cards must equal the authored codexCardIds`,
    );
  }
});

test("every authored duel item resolves to at least one known card, and no unknown cards", () => {
  for (const item of M1_DUEL_ITEMS) {
    const cards = duelItemCodexCardIds(item.itemId);
    assert.ok(cards.length > 0, `${item.itemId} draws on no card`);
    for (const cardId of cards) {
      assert.ok(AUTHORED_CARD_IDS.has(cardId), `${item.itemId} names unknown card ${cardId}`);
    }
  }
});

test("same seed/ordinal/round resolves the same item and the same cards", () => {
  const input = { attemptSeedHex: SEED_HEX, attemptOrdinal: 1, round: 3 };
  const itemA = m1ExpectedDuelItem(input).item.itemId;
  const itemB = m1ExpectedDuelItem(input).item.itemId;
  assert.equal(itemA, itemB, "the item selection is deterministic");
  assert.deepEqual(
    [...m1ExpectedDuelCardIds(input)],
    [...m1ExpectedDuelCardIds(input)],
    "the card resolution is deterministic",
  );
  // And the cards are exactly the selected item's authored cards.
  assert.deepEqual(
    [...m1ExpectedDuelCardIds(input)],
    [...duelItemCodexCardIds(itemA)],
    "the round's cards are the selected item's cards, not a separate draw",
  );
});

test("each round of an attempt maps to its own item's authored cards", () => {
  for (let round = 1; round <= 6; round += 1) {
    const input = { attemptSeedHex: SEED_HEX, attemptOrdinal: 1, round };
    const itemId = m1ExpectedDuelItem(input).item.itemId;
    assert.deepEqual(
      [...m1ExpectedDuelCardIds(input)],
      [...duelItemCodexCardIds(itemId)],
      `round ${round} carries item ${itemId}'s cards`,
    );
  }
});

test("the safe projection is id + title only — no proposition, no rubric", () => {
  const cards = duelItemCodexCards("BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1");
  assert.ok(cards.length > 0);
  for (const card of cards) {
    assert.deepEqual(Object.keys(card).sort(), ["cardId", "title"]);
    assert.ok(card.title.length > 0);
    assert.ok(AUTHORED_CARD_IDS.has(card.cardId));
  }
});

test("an unknown item resolves to no cards rather than throwing or inventing", () => {
  assert.deepEqual([...duelItemCodexCardIds("NOT.A.REAL.ITEM.v1")], []);
});
