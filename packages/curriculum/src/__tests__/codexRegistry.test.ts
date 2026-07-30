// The concept registry's Codex card ids and the authored Codex must agree.
//
// The registry names, per concept, the cards that concept mints as PvP-legal
// (`codexCardIds`); `content/m1/codex-cards.json` is what those ids actually mean.
// If the registry names a card the authored file does not define — or the file
// defines a card for a concept the registry does not list — one of the two is wrong,
// and card-backed PvP would draw on a card nothing resolves. This reads the authored
// file straight from disk rather than re-listing anything, so it cannot drift.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONCEPTS, bostonConceptId } from "../conceptRegistry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CODEX_PATH = resolve(HERE, "../../../../content/m1/codex-cards.json");

interface AuthoredCard {
  readonly cardId: string;
  readonly conceptId: string;
}

function authoredCards(): readonly AuthoredCard[] {
  const parsed = JSON.parse(readFileSync(CODEX_PATH, "utf8")) as { cards?: AuthoredCard[] };
  return parsed.cards ?? [];
}

const M1_CONCEPT_SLUGS = ["INTOLERABLE_ACTS", "REPRESENTATION", "MERCANTILISM"];

test("every card the authored file names carries a concept the registry knows", () => {
  const cards = authoredCards();
  assert.equal(cards.length, 9, "nine authored cards");
  for (const card of cards) {
    assert.ok(
      CONCEPTS.get(card.conceptId as never) !== undefined,
      `card ${card.cardId} names an unknown concept ${card.conceptId}`,
    );
  }
});

test("every M1 concept's codexCardIds resolve to an authored card", () => {
  const authored = new Set(authoredCards().map((card) => card.cardId));
  for (const slug of M1_CONCEPT_SLUGS) {
    const concept = CONCEPTS.get(bostonConceptId(slug));
    assert.ok(concept, `${slug} is missing from the registry`);
    assert.ok(concept!.codexCardIds.length > 0, `${slug} lists no cards`);
    for (const cardId of concept!.codexCardIds) {
      assert.ok(authored.has(cardId), `${slug} lists unknown card ${cardId}`);
    }
  }
});

test("the REPRESENTATION concept includes LAWFUL_NOT_CONSENTED — the registry gap is closed", () => {
  const concept = CONCEPTS.get(bostonConceptId("REPRESENTATION"));
  assert.ok(concept);
  assert.ok(
    concept!.codexCardIds.includes("BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1"),
    "the ninth card must be listed on REPRESENTATION, or two duel items rest on nothing",
  );
});

test("the registry's M1 card ids are exactly the nine authored ones — no more, no fewer", () => {
  const authored = new Set(authoredCards().map((card) => card.cardId));
  const listed = new Set(
    M1_CONCEPT_SLUGS.flatMap((slug) => [
      ...(CONCEPTS.get(bostonConceptId(slug))?.codexCardIds ?? []),
    ]),
  );
  assert.deepEqual([...listed].sort(), [...authored].sort());
});
