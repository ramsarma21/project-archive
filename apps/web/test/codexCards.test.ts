// The M1 Codex is one authored source, and every surface that references a card
// must reference a card that source defines.
//
// There is deliberately no second hand-written list here. The authored JSON is the
// definitions; the module deck and the duel bank are the two surfaces that name card
// ids; and this test reads all three straight from disk and proves the names line up.
// A card cited by the module or the duel bank that the Codex does not define would be
// a dangling reference the type system cannot catch, because these are JSON strings.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadM1Codex, M1_CODEX, M1_CODEX_CARDS, M1_CODEX_GROUPS } from "../src/codex/m1Codex.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT = resolve(HERE, "../../../content/m1");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(CONTENT, name), "utf8"));
}

const M1_CONCEPTS = [
  "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
  "BOS.CONCEPT.MERCANTILISM.v1",
  "BOS.CONCEPT.REPRESENTATION.v1",
];

test("the authored Codex loads, with nine cards across three concepts", () => {
  assert.equal(M1_CODEX.ok, true, M1_CODEX.ok ? "" : M1_CODEX.defects.join("; "));
  assert.equal(M1_CODEX_CARDS.length, 9, "nine authored cards");
  assert.equal(M1_CODEX_GROUPS.length, 3, "three concept groups");
  assert.deepEqual(
    M1_CODEX_GROUPS.reduce((sum, group) => sum + group.cards.length, 0),
    9,
    "every card lands in a group",
  );
});

test("every card carries one of the three M1 concepts and a non-empty title and proposition", () => {
  for (const card of M1_CODEX_CARDS) {
    assert.ok(M1_CONCEPTS.includes(card.conceptId), `${card.cardId} has an unknown concept`);
    assert.ok(card.title.length > 0);
    assert.ok(card.proposition.length > 0);
    assert.ok(card.askedBy.length > 0);
  }
  // The card ids are unique.
  assert.equal(new Set(M1_CODEX_CARDS.map((c) => c.cardId)).size, 9);
});

test("the loader fails closed and loud on a malformed definition — it never drops a card", () => {
  // A card missing its proposition must fail the WHOLE load rather than yield eight.
  const broken = {
    cards: [
      { cardId: "A", conceptId: "C", title: "t", proposition: "p", sourceCueId: "s", askedBy: ["x"] },
      { cardId: "B", conceptId: "C", title: "t", sourceCueId: "s", askedBy: ["x"] },
    ],
  };
  const loaded = loadM1Codex(broken);
  assert.equal(loaded.ok, false);
  if (!loaded.ok) assert.ok(loaded.defects.some((d) => d.includes("proposition")));
});

test("every module card reference resolves to an authored Codex card", () => {
  const moduleEnvelope = readJson("module.json") as { module?: { cards?: unknown[] } };
  const authored = new Set(M1_CODEX_CARDS.map((c) => c.cardId));
  const cards = moduleEnvelope.module?.cards ?? [];
  let referenced = 0;
  for (const card of cards as Array<{ codexCardIds?: unknown[] }>) {
    for (const id of card.codexCardIds ?? []) {
      referenced += 1;
      assert.ok(authored.has(id as string), `module cites unknown card ${String(id)}`);
    }
  }
  assert.ok(referenced > 0, "the module actually teaches cards");
});

test("every duel item's codexCardIds resolve to an authored Codex card", () => {
  const bank = readJson("duel-items.json") as {
    items?: Array<{ codexCardIds?: unknown[] }>;
    pvpHardening?: { items?: Array<{ codexCardIds?: unknown[] }> };
  };
  const authored = new Set(M1_CODEX_CARDS.map((c) => c.cardId));
  const everyItem = [...(bank.items ?? []), ...(bank.pvpHardening?.items ?? [])];
  assert.ok(everyItem.length >= 18, "the bank has its authored items");
  for (const item of everyItem) {
    assert.ok((item.codexCardIds ?? []).length > 0, "every duel item cites at least one card");
    for (const id of item.codexCardIds ?? []) {
      assert.ok(authored.has(id as string), `duel item cites unknown card ${String(id)}`);
    }
  }
  // Every authored card is asked by at least one duel item — no orphaned card.
  const cited = new Set(everyItem.flatMap((item) => (item.codexCardIds ?? []) as string[]));
  for (const card of M1_CODEX_CARDS) {
    assert.ok(cited.has(card.cardId), `${card.cardId} is defined but never asked`);
  }
});
