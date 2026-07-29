// Which item a round asks, when the duel can outlast its bank.
//
// A six-round duel could be handed six items and be done with it. An unbounded one
// cannot: M1 authors 18 duel items and PvP was drawing 6, but a match that runs
// until a health bar empties has no upper bound on questions, so the bank WILL run
// out and something has to happen at the bottom of it.
//
// ---- REUSE IS A STOPGAP, NAMED AS ONE (owner decision, 28 Jul) ---------------
//
// WHAT HAPPENS AT THE BOTTOM OF THE BANK, TODAY: the bank is REUSED. When a match
// outlasts its eligible pool, `askQuestion` reshuffles and asks a repeat, disclosing
// it (`recycled`/`appearance`). A repeat is served and graded exactly like a fresh
// item. This is deliberately the simplest thing that works, and it is explicitly
// TEMPORARY:
//
//   > "just reuse questions for now until we figure out pipeline and bank" — owner
//
// WHAT REPLACES IT, so "for now" does not become permanent by default. The question
// GENERATION PIPELINE (content/QUESTION-PIPELINE.md) is built through its verification
// gauntlet and will grow each chapter's bank to a few HUNDRED items. At that volume a
// single match cannot realistically outlast the eligible pool — even under the PvP
// symmetry rule, a fresh draw survives dozens of matches between the same pair rather
// than five (§7 of that doc) — so exhaustion stops being reachable in practice and the
// question of what to do at the bottom of the bank becomes moot for real play.
//
// WHAT IS DEFERRED, NOT REJECTED. `content/m1/BANK-EXHAUSTION-PROPOSAL.md` proposes a
// DEFINED degrade for when the pool genuinely runs out — cap the questions rather than
// the rounds, stop asking, grant the wrong-answer floor to both sides, and disclose it.
// It was written from the content side precisely so two proposals could be RECONCILED
// rather than two behaviours discovered, and that is still the right instinct: when the
// pipeline lands and the bank is large, the owner should reconcile that proposal with
// whatever the pipeline wants before choosing a permanent behaviour. Until then, reuse.
// Do not delete that proposal; it is the design for the case this stopgap papers over.
//
// THE PRECEDENT REUSE FOLLOWS. The chapter assessment met the same problem — a retry
// can need more items than the reserve holds — and answered it by recycling openly
// rather than concealing the reuse: `@pa/reporting` records mastery shown on a repeated
// item as `evidenceStrength: "RECYCLED_ITEMS"` and qualifies the whole claim with
// `MASTERY_ON_RECYCLED_ITEMS`, on the reasoning that a repeat is weaker evidence and a
// report that hides it is lying by omission. The duel does the same one layer down: it
// repeats, it MARKS the repeat (so the player sees "asked again" and the learning
// record can discount it — see the note on `appearance`/`recycled` reaching grade time
// in events.ts), and it lets the consumer decide what a repeat is worth.
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
// (The bank-exhaustion proposal above is a fourth option — defined degrade — deferred
// pending the pipeline, not one of these three rejected ones.)
//
// ---- THE DRAW IS CONCEPT-ORDERED, AND IT USED NOT TO BE -----------------------
//
// A duel has no round schedule — it runs until a health bar empties — so the number
// of questions a fight asks is whatever the fight lasted. Measured against M1's
// six-item per-attempt bank (three concepts, two authored items each), a
// concept-BLIND permutation asked all three concepts in only 40.2% of three-round
// fights and 79.9% of four-round ones. Driven end to end against the tier-1 boss on
// the correct-answer path, where fights land on three or four rounds, 41.5% of
// students finished the duel never having been asked about one of the three things
// the lesson taught. The better the student, the shorter the fight, so the fewer
// concepts they were assessed on — backwards for an ed-tech product, and invisible
// because nothing checked which concepts a fight actually asked.
//
// So a pass no longer walks a flat permutation of the bank. It deals ROUND-ROBIN
// across the concepts: the bank is grouped by `conceptId`, each group is shuffled,
// the group ORDER is shuffled, and then one item is taken from each concept in turn
// before any concept is returned to. The first C rounds of a pass therefore ask C
// distinct concepts, where C is the number of concepts the bank carries.
//
// WHAT THIS DOES NOT DO, stated because the obvious next inference is wrong. It
// makes coverage REACHABLE within the round count a duel actually has; it does not
// guarantee coverage in general, and it cannot. A duel that lasts R rounds can ask
// at most R concepts, so a unit teaching nine concepts cannot be covered by a
// four-round fight however the draw is ordered. Two rounds cannot cover M1's three.
// The coverage GUARANTEE belongs to the mission encounters; the duel carries depth
// and item volume. Do not read this draw as satisfying a coverage invariant.
//
// Determinism: the order is a seeded permutation, so the PvP authority, the client
// and a replay all ask the same question on round 40. No clock, no Math.random.
// `askQuestion` stays a pure function of (bank, round, seed) — it is called for an
// arbitrary round by the client runtime and INDEPENDENTLY by the grading authority
// (`m1ExpectedDuelItem`), which is what lets the server ignore a forged item claim.
// Nothing here may accumulate state across rounds.

import { fieldRandom } from "./engine.js";
import type { AskedQuestion, DuelQuestionRef } from "./events.js";

const SALT_CONCEPT = 2311;
const SALT_WITHIN = 3733;

/**
 * Fisher-Yates over `0..count-1`, driven by the shared seeded RNG.
 *
 * `stream` separates independent shuffles that share a seed — the pass index for the
 * concept order, and pass+concept for each per-concept shuffle — so two shuffles
 * cannot draw the same numbers. The pass index being folded in is what makes the
 * second lap through a bank a different order from the first, which is what stops a
 * long duel feeling like a loop of the same five questions.
 *
 * `fieldRandom` is a pure hash of (seed, tick, salt) rather than a stateful
 * generator, so an extra shuffle consumes nothing and cannot perturb the combat
 * simulation's own draws. That is why ordering the draw cannot move difficulty.
 */
function seededPermutation(
  count: number,
  seed: number,
  stream: number,
  salt: number,
): number[] {
  const order = Array.from({ length: count }, (_unused, index) => index);
  for (let index = count - 1; index > 0; index--) {
    // index < 1000 for any bank a mission authors, so stream and index cannot alias.
    const draw = fieldRandom(seed, stream * 1000 + index, salt);
    const swap = Math.floor(draw * (index + 1));
    const held = order[index]!;
    order[index] = order[swap]!;
    order[swap] = held;
  }
  return order;
}

/**
 * One pass through the bank, dealt round-robin across concepts.
 *
 * Groups by `conceptId`, shuffles each group and the group order, then takes one item
 * per concept in rotation. Because every group contributes to the first rotation
 * before any contributes twice, the first C entries are C distinct concepts — which
 * is what makes coverage reachable inside a short fight. Groups of unequal size are
 * fine: a group simply drops out of later rotations once it is spent, so the result
 * is always a permutation of the whole bank.
 */
function conceptOrderedPass(
  bank: readonly DuelQuestionRef[],
  seed: number,
  pass: number,
): readonly number[] {
  const groups = new Map<string, number[]>();
  for (let index = 0; index < bank.length; index++) {
    const conceptId = bank[index]!.conceptId;
    const existing = groups.get(conceptId);
    if (existing) existing.push(index);
    else groups.set(conceptId, [index]);
  }

  // Keyed off the bank's own order, so the same bank always groups the same way.
  const conceptIds = [...groups.keys()];
  const conceptOrder = seededPermutation(conceptIds.length, seed, pass, SALT_CONCEPT);
  const queues = conceptOrder.map((slot, position) => {
    const members = groups.get(conceptIds[slot]!)!;
    // One stream per (pass, concept), injective for any concept count, so no two
    // per-concept shuffles can draw the same numbers.
    const stream = pass * (conceptIds.length + 1) + position + 1;
    const within = seededPermutation(members.length, seed, stream, SALT_WITHIN);
    return within.map((member) => members[member]!);
  });

  const deepest = queues.reduce((longest, queue) => Math.max(longest, queue.length), 0);
  const order: number[] = [];
  for (let rotation = 0; rotation < deepest; rotation++) {
    for (const queue of queues) {
      if (rotation < queue.length) order.push(queue[rotation]!);
    }
  }
  return order;
}

/**
 * The item round `round` asks, and whether the player has seen it before.
 *
 * Rounds are 1-based. A bank of N items is walked in a seeded CONCEPT-ORDERED order
 * for rounds 1..N, redealt for N+1..2N, and so on — one item per concept in rotation,
 * so a short fight still spreads across the concepts rather than landing twice on one
 * (see the header). The one adjustment is at the seam: if a new pass would open on
 * the concept the previous pass closed on, its first two entries are swapped, because
 * asking the same thing twice in a row is the single most visible way for recycling
 * to read as a bug rather than a policy.
 */
export function askQuestion(
  bank: readonly DuelQuestionRef[],
  round: number,
  seed: number,
): AskedQuestion {
  if (bank.length === 0) {
    throw new Error("a duel needs at least one authored question");
  }
  const index = resolveBankIndex(bank, round, seed);
  const item = bank[index]!;
  const appearance = Math.floor((round - 1) / bank.length) + 1;
  return { item, appearance, recycled: appearance > 1 };
}

function resolveBankIndex(
  bank: readonly DuelQuestionRef[],
  round: number,
  seed: number,
): number {
  const count = bank.length;
  if (count === 1) return 0;
  const pass = Math.floor((round - 1) / count);
  const offset = (round - 1) % count;
  return passOrder(bank, seed, pass)[offset]!;
}

/**
 * A pass's order, adjusted at the seam.
 *
 * The adjustment SWAPS rather than skips. Returning `order[1]` for offset 0 and
 * leaving the rest alone would ask that item again at offset 1 — a repeat inside a
 * single pass, which is worse than the seam repeat it was avoiding. Swapping the
 * first two entries keeps the pass a permutation, and it cannot disturb the next
 * seam because it does not touch the last entry. It also cannot cost coverage:
 * both entries live inside the opening rotation, so swapping them permutes that
 * block without changing which concepts it holds.
 *
 * The rule is stated on CONCEPTS now rather than items. Asking the same concept
 * twice running is the visible thing — two questions about the stamp's scope back
 * to back read as a stuck duel even when the items differ — and because the
 * round-robin deal guarantees `order[0]` and `order[1]` are different concepts, the
 * swap always resolves it. A bank carrying only one concept cannot satisfy that and
 * falls back to the item rule, which is the best available there.
 */
function passOrder(
  bank: readonly DuelQuestionRef[],
  seed: number,
  pass: number,
): readonly number[] {
  const order = [...conceptOrderedPass(bank, seed, pass)];
  if (pass === 0 || order.length < 2) return order;
  const previous = conceptOrderedPass(bank, seed, pass - 1);
  const closed = previous[previous.length - 1]!;
  const opensSameConcept = bank[order[0]!]!.conceptId === bank[closed]!.conceptId;
  const swapBreaksIt = bank[order[1]!]!.conceptId !== bank[closed]!.conceptId;
  if ((opensSameConcept && swapBreaksIt) || order[0] === closed) {
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
