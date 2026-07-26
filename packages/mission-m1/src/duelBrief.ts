// The duel M1 ends in: the constable at the post, in the rope-walk yard.
//
// The eighteen items are authored in content/m1/duel-items.json; only their
// refs live here, because a ref is all the duel carries — the question text and
// the rubric are the grading service's, and putting them in the client would
// hand every answer to anybody with a debugger.
//
// Six of the eighteen run per attempt, two per concept, in the authored concept
// order, drawn on the attempt seed and never repeating across the three
// attempts. That last property is what the pool structure is for: six items per
// concept is exactly three attempts' worth of two.

import { fieldRandom, projectFieldSeed } from "@pa/engine-world/fieldSimulation";

export interface DuelItemRef {
  readonly itemId: string;
  readonly itemVersion: string;
  readonly conceptId: string;
  readonly poolId: string;
}

/** Authored concept order. The duel asks them in this sequence, two each. */
export const M1_CONCEPT_ORDER = [
  "BOS.CONCEPT.POSTWAR_REVENUE.v1",
  "BOS.CONCEPT.STAMP_SCOPE.v1",
  "BOS.CONCEPT.REPRESENTATION.v1",
] as const;

export const M1_DUEL_ITEMS: readonly DuelItemRef[] = [
  { itemId: "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.WHAT_IT_LEFT.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.WHO_PAYS.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.WHICH_CAME_FIRST.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.CAME_FROM_NOWHERE.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.DEBT_TO_TAX.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.DEED_OR_CLOTH.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.FROM_WHEN.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.WHY_A_PRINTER.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.CORRECT_THE_APPRENTICE.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.NAME_TWO.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.PRIVATE_LETTER.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.REP.WHAT_RIGHT.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.NOT_THE_MONEY.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.FINISH_THE_CLAIM.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
];

/**
 * The six items this attempt asks, two per concept in authored order.
 *
 * The attempt ordinal partitions each concept's six items into three disjoint
 * pairs, so attempt 1 draws items 0-1, attempt 2 draws 2-3 and attempt 3 draws
 * 4-5 — nothing repeats across a player's three attempts, which the slate
 * requires. The seed rotates which pair each ordinal lands on, so two players
 * on their first attempt do not see the same six.
 */
export function duelQuestionsForAttempt(
  seed: number,
  attemptOrdinal: number,
): DuelItemRef[] {
  const picked: DuelItemRef[] = [];
  for (const conceptId of M1_CONCEPT_ORDER) {
    const pool = M1_DUEL_ITEMS.filter((item) => item.conceptId === conceptId);
    const pairs = Math.max(1, Math.floor(pool.length / 2));
    const rotation = Math.floor(
      fieldRandom(seed, 0, projectFieldSeed([conceptId]) & 0xffff) * pairs,
    );
    const pair = (rotation + Math.max(0, attemptOrdinal - 1)) % pairs;
    const first = pool[(pair * 2) % pool.length]!;
    const second = pool[(pair * 2 + 1) % pool.length]!;
    picked.push(first, second);
  }
  return picked;
}
