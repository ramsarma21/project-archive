// Codex card minting: the 100% rule's only reward.
//
// A Codex card holds two independent states, and the whole point of this file is
// that they are not one boolean:
//
//   learnedAt   — held in single-player, from the mission's learning module, and
//                 usable there. A student can win a boss duel on a card they
//                 half-understand.
//   pvpLegalAt  — minted ONLY by 100% mastery of the card's concept on the
//                 chapter capstone.
//
// WHY THE STRICT VERSION IS THE RIGHT ONE. PvP is the surface where a card is
// leverage against another student, and the standing that comes out of it is
// public. A card earned by getting most of a concept right converts a partial
// understanding into a competitive advantage over a classmate, and it does it
// invisibly — the opponent cannot tell. Requiring complete mastery of the concept
// is the only bar that makes "this student may use this in PvP" mean something a
// teacher would defend. It is deliberately harsher than the single-player bar,
// because single-player failure costs a student nothing but their own progress.
//
// THIS FILE DOES NOT CREATE CARDS. It promotes existing ones. A card that was
// never learned is refused rather than invented, because `learnedAt` and
// `learnedChapterId` are claims about a module the student actually ran, and
// fabricating them to make a promotion tidy would put a fact in the record that
// never happened.

import type { CurriculumConceptId } from "./curriculum.js";
import type { MintedPvpCard } from "./reduce.js";
import { isCodexCardPvpLegal, type CodexCardState } from "./protocol.js";

/**
 * Settled: a card the student never learned is NOT promoted, even on a mastered
 * concept. Named rather than implicit so the alternative is visible.
 *
 * It should not arise in the intended flow — the learning module is mandatory
 * before every mission attempt and before every assessment attempt, so the card
 * is learned before the capstone can be sat. If it does arise, it means a card
 * was authored onto a concept no module teaches, which is a content defect worth
 * a loud report rather than a quiet backfill.
 */
export const PROMOTE_UNLEARNED_CARDS = false;

export type CardPromotionRefusal =
  /** No Codex row: the student never learned this card. A content defect. */
  | "CARD_NOT_LEARNED"
  /** Already PvP-legal. Promotion is idempotent, so this is a no-op, not an error. */
  | "ALREADY_PVP_LEGAL";

export interface CardPromotion {
  readonly cardId: string;
  readonly conceptId: CurriculumConceptId;
  readonly pvpLegalAt: string;
}

export interface RefusedPromotion {
  readonly cardId: string;
  readonly conceptId: CurriculumConceptId;
  readonly reason: CardPromotionRefusal;
}

export interface CardPromotionPlan {
  readonly promotions: readonly CardPromotion[];
  readonly refusals: readonly RefusedPromotion[];
}

/**
 * What mastery would do to the Codex, computed without applying it.
 *
 * Separated from `applyCardPromotions` so the API route can persist the Codex
 * change and write its ledger rows in one transaction, and so a test can assert
 * on the plan without a Codex to mutate.
 */
export function planCardPromotions(
  minted: readonly MintedPvpCard[],
  codex: readonly CodexCardState[],
): CardPromotionPlan {
  const byCardId = new Map(codex.map((card) => [card.cardId, card]));
  const promotions: CardPromotion[] = [];
  const refusals: RefusedPromotion[] = [];
  const seen = new Set<string>();

  for (const card of minted) {
    if (seen.has(card.cardId)) continue;
    seen.add(card.cardId);
    const existing = byCardId.get(card.cardId);
    if (!existing) {
      if (!PROMOTE_UNLEARNED_CARDS) {
        refusals.push({
          cardId: card.cardId,
          conceptId: card.conceptId,
          reason: "CARD_NOT_LEARNED",
        });
        continue;
      }
    } else if (isCodexCardPvpLegal(existing)) {
      refusals.push({
        cardId: card.cardId,
        conceptId: card.conceptId,
        reason: "ALREADY_PVP_LEGAL",
      });
      continue;
    }
    promotions.push({
      cardId: card.cardId,
      conceptId: card.conceptId,
      pvpLegalAt: card.mintedAt,
    });
  }

  return { promotions, refusals };
}

/**
 * Apply a plan. Only `pvpLegalAt` and `updatedAt` move: `learnedAt` and
 * `learnedChapterId` are history and are never rewritten by an assessment.
 */
export function applyCardPromotions(
  codex: readonly CodexCardState[],
  plan: CardPromotionPlan,
): readonly CodexCardState[] {
  const promoted = new Map(
    plan.promotions.map((promotion) => [promotion.cardId, promotion]),
  );
  return codex.map((card) => {
    const promotion = promoted.get(card.cardId);
    if (!promotion || isCodexCardPvpLegal(card)) return card;
    return {
      ...card,
      pvpLegalAt: promotion.pvpLegalAt,
      updatedAt: promotion.pvpLegalAt,
    };
  });
}

/** Cards this profile may take into PvP. The only question PvP needs answered. */
export function pvpLegalCardIds(
  codex: readonly CodexCardState[],
): readonly string[] {
  return codex.filter(isCodexCardPvpLegal).map((card) => card.cardId);
}
