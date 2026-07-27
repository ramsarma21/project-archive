// The PvE boss-duel question content carries safe Codex provenance and nothing more.
//
// The panel renders `DuelItemContent.codexCards` as titled chips. This pins that the
// content source attaches those cards (id + title only), that they match the
// server-owned resolver keyed off the same item id, and that no rubric or reference
// answer ever rides along with them. The renderer itself is verified by looking at it.

import test from "node:test";
import assert from "node:assert/strict";
import { duelItemCodexCards, duelItemCodexCardIds } from "@pa/mission-m1";
import {
  M1_ITEM_SOURCE,
  m1QuestionBank,
  missingItemContent,
} from "../src/duel/duelItems.js";

test("every resolvable item carries id+title Codex chips that match the resolver", () => {
  const bank = m1QuestionBank();
  assert.ok(bank.length > 0);
  for (const ref of bank) {
    const content = M1_ITEM_SOURCE.get(ref);
    assert.ok(content, `${ref.itemId} resolves`);
    assert.deepEqual(
      content!.codexCards.map((card) => card.cardId),
      [...duelItemCodexCardIds(ref.itemId)],
      `${ref.itemId}: the panel's cards are the server-owned cards`,
    );
    assert.ok(content!.codexCards.length > 0, `${ref.itemId} shows at least one card`);
    for (const card of content!.codexCards) {
      assert.deepEqual(Object.keys(card).sort(), ["cardId", "title"], "id + title only");
      assert.ok(card.title.length > 0, "a chip needs a readable title");
    }
  }
});

test("the safe labels carry no rubric, answer, or proposition text", () => {
  const content = M1_ITEM_SOURCE.get(m1QuestionBank()[0]!)!;
  const json = JSON.stringify(content.codexCards).toLowerCase();
  for (const forbidden of ["proposition", "rubric", "accept", "reject", "answer", "verdict"]) {
    assert.ok(!json.includes(forbidden), `a chip must not carry ${forbidden}`);
  }
});

test("an unresolved item still carries deterministic provenance, never a fabricated card", () => {
  const ref = { itemId: "BOS.MD01.DUEL.REP.WHAT_RIGHT.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1" };
  const missing = missingItemContent(ref);
  assert.deepEqual(
    missing.codexCards.map((card) => card.cardId),
    [...duelItemCodexCards(ref.itemId).map((card) => card.cardId)],
  );
  // A truly unknown id yields no chips rather than an invented one.
  const unknown = missingItemContent({ itemId: "NOPE.v1", itemVersion: "v1", conceptId: "X" });
  assert.deepEqual(unknown.codexCards, []);
});
