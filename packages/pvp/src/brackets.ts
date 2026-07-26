// Rank brackets, sized by arithmetic rather than by taste.
//
// Rank comes from @pa/contracts and is not restated here: it is
// `1 + floor(cumulative Levels / RANK_LEVEL_COST)`, it spans chapters, and it never
// decreases. Because Levels come only from mission XP, Rank is a proxy for mission
// performance, which is what makes a bracket mean anything.
//
// THE DAY-ONE POPULATION IS THE WHOLE DESIGN CONSTRAINT. PvP unlocks on chapter
// completion, so the first population is one class that has finished Boston, and the
// authored curve deliberately makes one chapter worth about three Ranks:
//
//   flawless   Level 34 -> Rank 4        struggling  Level 18 -> Rank 2
//   strong     Level 31 -> Rank 4        grinder     Level 16 -> Rank 2
//   typical    Level 29 -> Rank 3        clears none Level  0 -> Rank 1
//
// So Boston cannot produce a Rank above 4, and a plausible class of 25 distributes
// roughly: Rank 1 ~1, Rank 2 ~7, Rank 3 ~9, Rank 4 ~5.
//
// WHY THE WIDTH IS 1, WITH THE ARITHMETIC:
//
// The pool that matters is not the class, it is who is QUEUEING AT THE SAME MOMENT.
// In a 50-minute period with 25 students, a generous estimate is 6-10 in the queue at
// once, which is 25-40% of the class. Multiply that through:
//
//   width 0 (exact Rank)   Rank 1 has 0 possible partners, ever, by construction —
//                          a player who cleared nothing is alone at the bottom.
//                          Rank 4 has ~5 in the class, so ~1-2 online: a coin flip
//                          on whether the button does anything.
//   width 1 (shipped)      Rank 1 reaches Rank 2 (~7). Rank 4 reaches Rank 3+4 (~14).
//                          Rank 2 reaches 1+2+3 (~17). Every bracket has a real pool,
//                          and the match graph is connected so nobody is isolated.
//   width 2               Rank 2 can meet Rank 4 — Level 18 against Level 34, nearly
//                          double the progress and a fuller ability pool. Reachable
//                          as a patience fallback, not as the default.
//
// That is why width 1 ships, matching the curve author's recommendation, and why it is
// reached by arithmetic instead of adopted on principle. It also fails safe: the
// worst outcome of too NARROW is a dead button, which is worse than an imperfect duel,
// so the width widens with waiting rather than starting wide.

import { LEVELS_PER_RANK, STARTING_RANK, rankFromCumulativeLevels } from "@pa/contracts";
import { PVP_GATES, type PvpGates } from "./gates.js";

/** The width a queue starts at. One Rank either side. */
export const BRACKET_WIDTH_INITIAL = 1;

/**
 * The widest a queue ever goes. 3 spans the whole of Boston's Rank 1-4, so a
 * sufficiently patient player is never structurally unmatchable — but by the time the
 * queue is this wide it has already offered the alternatives below.
 */
export const BRACKET_WIDTH_MAX = 3;

/** Seconds of waiting that buys one more Rank of width. */
export const BRACKET_WIDEN_INTERVAL_S = 20;

/**
 * When the queue gives up and offers something else. 90 seconds is chosen against
 * the failure mode: a student who has pressed a button and watched nothing happen for
 * a minute and a half has learned that the feature is broken.
 */
export const QUEUE_PATIENCE_S = 90;

// Re-exported, never restated: the Rank rule and its cost belong to @pa/contracts.
export { LEVELS_PER_RANK, STARTING_RANK, rankFromCumulativeLevels };

/** Ranks Boston can actually produce, for tests and for capacity reasoning. */
export const BOSTON_MAX_ATTAINABLE_RANK = 4;

export function bracketWidthAfter(waitSeconds: number): number {
  const steps = Math.floor(Math.max(0, waitSeconds) / BRACKET_WIDEN_INTERVAL_S);
  return Math.min(BRACKET_WIDTH_MAX, BRACKET_WIDTH_INITIAL + steps);
}

/**
 * The ONLY place a Rank bracket is decided, and the enforcement point for
 * `PVP_GATES.enforceRankBrackets`.
 *
 * With the gate off — today, because the unlock gate is open so nobody has earned a
 * Level and the whole population is Rank 1 — anyone matches anyone. That is not the
 * same as the width being satisfied by accident: leaving the check on while the first
 * player earns a Rank and the rest have not is exactly how a queue deadlocks.
 */
export function ranksCompatible(
  a: number,
  b: number,
  width: number,
  gates: PvpGates = PVP_GATES,
): boolean {
  if (!gates.enforceRankBrackets) return true;
  return Math.abs(a - b) <= width;
}

/** The Rank span a player at `rank` will accept after waiting. Inclusive. */
export function acceptableRankSpan(
  rank: number,
  waitSeconds: number,
): { readonly min: number; readonly max: number } {
  const width = bracketWidthAfter(waitSeconds);
  return { min: Math.max(STARTING_RANK, rank - width), max: rank + width };
}

/**
 * How many of a population a player could be matched against at a given width.
 * Exists so the arithmetic above is checkable in a test rather than a comment that
 * decays: `brackets.test.ts` runs the modelled class through it.
 */
export function reachablePopulation(
  rank: number,
  population: ReadonlyMap<number, number>,
  width: number,
): number {
  let total = 0;
  for (const [otherRank, count] of population) {
    // Asks the bracket question with enforcement ON regardless of the live gate, since
    // the point of this function is to check the shipping arithmetic.
    if (Math.abs(rank - otherRank) > width) continue;
    total += otherRank === rank ? Math.max(0, count - 1) : count;
  }
  return total;
}

/** The modelled day-one class, from the authored curve's archetypes. */
export const MODELLED_BOSTON_CLASS: ReadonlyMap<number, number> = new Map([
  [1, 1],
  [2, 7],
  [3, 9],
  [4, 5],
]);
