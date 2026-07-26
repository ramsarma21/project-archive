// Which item a round asks, when the duel can outlast its bank.
//
// A six-round duel could be handed six items and be done with it. An unbounded one
// cannot: M1 authors 18 duel items and PvP was drawing 6, but a match that runs
// until a health bar empties has no upper bound on questions, so the bank WILL run
// out and something has to happen at the bottom of it.
//
// THE PRECEDENT IS ALREADY SET AND THIS FOLLOWS IT. The chapter assessment met the
// same problem — a retry can need more items than the reserve holds — and answered
// it by recycling openly rather than concealing the reuse: `@pa/reporting` records
// mastery shown on a repeated item as `evidenceStrength: "RECYCLED_ITEMS"` and
// qualifies the whole claim with `MASTERY_ON_RECYCLED_ITEMS`, on the reasoning that
// a repeat is weaker evidence and a report that hides it is lying by omission. The
// duel does the same one layer down: it repeats, it marks the repeat, and it lets
// the consumer decide what a repeat is worth.
//
// The three alternatives were considered and rejected:
//
//   ending the duel when the bank empties      turns the question bank into a hidden
//                                              round cap and hands a win to whoever
//                                              happens to be ahead at item 18
//   generating items                           the architecture is explicit that
//                                              every question is pre-authored and the
//                                              model only ever classifies
//   granting bullets without a question        severs the knowledge link exactly when
//                                              the match is at its most decided
//
// Determinism: the order is a seeded permutation, so the PvP authority, the client
// and a replay all ask the same question on round 40. No clock, no Math.random.

import { fieldRandom } from "./engine.js";
import type { AskedQuestion, DuelQuestionRef } from "./events.js";

const SALT_ORDER = 911;

/**
 * A deterministic permutation of `0..count-1` for one pass through the bank.
 *
 * Fisher-Yates driven by the shared seeded RNG. The pass index is folded into the
 * stream so the second lap through a bank is a different order from the first,
 * which is what stops a long duel feeling like a loop of the same five questions.
 */
export function bankOrder(count: number, seed: number, pass: number): readonly number[] {
  const order = Array.from({ length: count }, (_unused, index) => index);
  for (let index = count - 1; index > 0; index--) {
    const draw = fieldRandom(seed, pass * 1000 + index, SALT_ORDER);
    const swap = Math.floor(draw * (index + 1));
    const held = order[index]!;
    order[index] = order[swap]!;
    order[swap] = held;
  }
  return order;
}

/**
 * The item round `round` asks, and whether the player has seen it before.
 *
 * Rounds are 1-based. A bank of N items is walked in a seeded order for rounds
 * 1..N, reshuffled for N+1..2N, and so on. The one adjustment is at the seam: if a
 * new pass would open with the item the previous pass closed on, the pass is
 * rotated by one, because asking the same question twice in a row is the single
 * most visible way for recycling to read as a bug rather than a policy.
 */
export function askQuestion(
  bank: readonly DuelQuestionRef[],
  round: number,
  seed: number,
): AskedQuestion {
  if (bank.length === 0) {
    throw new Error("a duel needs at least one authored question");
  }
  const index = resolveBankIndex(bank.length, round, seed);
  const item = bank[index]!;
  const appearance = Math.floor((round - 1) / bank.length) + 1;
  return { item, appearance, recycled: appearance > 1 };
}

function resolveBankIndex(count: number, round: number, seed: number): number {
  if (count === 1) return 0;
  const pass = Math.floor((round - 1) / count);
  const offset = (round - 1) % count;
  return passOrder(count, seed, pass)[offset]!;
}

/**
 * A pass's order, adjusted at the seam.
 *
 * The adjustment SWAPS rather than skips. Returning `order[1]` for offset 0 and
 * leaving the rest alone would ask that item again at offset 1 — a repeat inside a
 * single pass, which is worse than the seam repeat it was avoiding. Swapping the
 * first two entries keeps the pass a permutation, and it cannot disturb the next
 * seam because it does not touch the last entry.
 */
function passOrder(count: number, seed: number, pass: number): readonly number[] {
  const order = [...bankOrder(count, seed, pass)];
  if (pass === 0 || count < 2) return order;
  const previous = bankOrder(count, seed, pass - 1);
  if (order[0] === previous[count - 1]) {
    const held = order[0]!;
    order[0] = order[1]!;
    order[1] = held;
  }
  return order;
}

/**
 * How many rounds a bank covers before it starts repeating. Purely informational —
 * nothing gates on it — but it is the number a content author wants when deciding
 * whether a mission has enough items for the duels it will actually produce.
 */
export function roundsBeforeRecycling(bank: readonly DuelQuestionRef[]): number {
  return bank.length;
}
