// Which Codex cards a boss-duel item draws on — deterministic, server-owned, and
// safe to carry to a client.
//
// The item→cards relation is authored ONCE, in content/m1/codex-cards.json: every
// card lists the duel items that ask it under `askedBy`. Inverting that gives, per
// item, the cards it draws on — the same relation `content/m1/duel-items.json`
// carries as each item's `codexCardIds`, and a test pins the two together so this
// derived view cannot drift from the authored bank.
//
// WHY codex-cards.json AND NOT duel-items.json. duel-items.json carries the rubrics
// and reference answers, so it must never reach a browser; codex-cards.json is card
// definitions and provenance only. This module is imported by both the headless
// grading authority (Node) and the web presentation (bundled), so it reads the safe
// file. A card PROPOSITION is present in that file but is never projected out of
// here — the only projection this module exposes is a card id and its short title.
//
// DETERMINISTIC AND IDENTICAL EVERYWHERE. The map is built once, in the file's own
// definition order, so `duelItemCodexCards` returns the same cards in the same order
// for a given item id on every call, on the server and in the client alike. Keyed by
// item id, and the item id for a round is the server-authoritative one @pa/duel's
// `askQuestion` selects — so a client cannot choose, add, or replace a card by
// naming a different item.

import codexEnvelope from "../../../content/m1/codex-cards.json";

/** The safe card projection: an id and a short human title. Never a proposition. */
export interface DuelCodexCardRef {
  readonly cardId: string;
  readonly title: string;
}

interface AuthoredCard {
  readonly cardId?: unknown;
  readonly title?: unknown;
  readonly askedBy?: unknown;
}

const CARDS_BY_ITEM: ReadonlyMap<string, readonly DuelCodexCardRef[]> = (() => {
  const map = new Map<string, DuelCodexCardRef[]>();
  const cards = Array.isArray((codexEnvelope as { cards?: unknown }).cards)
    ? ((codexEnvelope as { cards: readonly AuthoredCard[] }).cards)
    : [];
  for (const card of cards) {
    if (typeof card.cardId !== "string" || typeof card.title !== "string") continue;
    if (!Array.isArray(card.askedBy)) continue;
    for (const itemId of card.askedBy) {
      if (typeof itemId !== "string") continue;
      const list = map.get(itemId) ?? [];
      // Definition order of codex-cards.json — stable, so replay/reload and the two
      // sides of the wire all see the same order.
      list.push({ cardId: card.cardId, title: card.title });
      map.set(itemId, list);
    }
  }
  return map;
})();

/**
 * Every M1 Codex card id, in the authored definition order of codex-cards.json.
 *
 * This is the card UNIVERSE the evidence hand draws its distractors from — the nine
 * claims a Mission-1 player can ever hold. It carries no proposition, so it is safe
 * on either side of the wire, and it is derived from the same file the resolver
 * reads so it cannot drift from the deck.
 */
export const M1_CODEX_CARD_IDS: readonly string[] = (() => {
  const ids: string[] = [];
  const cards = Array.isArray((codexEnvelope as { cards?: unknown }).cards)
    ? (codexEnvelope as { cards: readonly AuthoredCard[] }).cards
    : [];
  for (const card of cards) {
    if (typeof card.cardId === "string") ids.push(card.cardId);
  }
  return ids;
})();

/** The cards a duel item draws on, as id+title. Empty for an unknown item. */
export function duelItemCodexCards(itemId: string): readonly DuelCodexCardRef[] {
  return CARDS_BY_ITEM.get(itemId) ?? [];
}

/** Just the card ids a duel item draws on, in the same deterministic order. */
export function duelItemCodexCardIds(itemId: string): readonly string[] {
  return duelItemCodexCards(itemId).map((card) => card.cardId);
}
