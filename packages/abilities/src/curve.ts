// THE BOSTON XP AND LEVEL CURVE.
//
// No curve existed in the repository; the hub rendered a hardcoded placeholder
// because there was nothing to read. This module is the authored answer. It holds
// data and derivation only — the SHAPE of an XP curve, the attempt decay, and
// `levelForXp` all belong to @pa/contracts and are consumed, not restated.
//
// ============================================================================
// THE FOUR RULES THE CURVE HAS TO SATISFY
// ============================================================================
//
//   1. A new runner is Level 0, 0 XP, Rank 1.
//   2. XP has exactly one payer: clearing a mission. Modules pay nothing.
//      Assessments pay nothing. The capstone pays nothing.
//   3. A mission pays full on attempt 1, two-thirds on the first retry,
//      one-third on the second, and nothing after that — and the player
//      advances regardless.
//   4. Level and XP reset at the chapter boundary. Level's only job is to gate
//      ability unlocks. `Rank = 1 + floor(cumulative Levels / 10)` carries.
//
// ============================================================================
// DECISION 1 — MISSION AWARDS RISE ACROSS THE CHAPTER
// ============================================================================
//
// base(n) = 120 + 15*(n-1), so M1 pays 120 and M14 pays 315.
//
// A flat award was the obvious option and it is the wrong one. The slate scales
// difficulty through the boss and through route density (Mission-Slate.md
// section 1.4), so a late mission is a strictly harder piece of work than an
// early one; paying the same for both makes the back half of the chapter feel
// like a tax. The ramp also carries the design's own catch-up promise — "getting
// better is rewarded; early failure has a permanent cost" (section 1.5) — with
// arithmetic instead of hope: a player who was weak through M1-M4 and improves
// is earning from a larger pool than the one they fumbled, so improvement
// visibly closes the gap.
//
// The step is 15 rather than a rounder number because every award must be
// divisible by 3. `missionXpAward` floors the two-thirds and one-third shares, so
// a base that is not a multiple of 3 quietly loses XP to rounding and makes two
// adjacent missions pay the same on a retry. 120 and 15 are both multiples of 3,
// so every award and every decayed award is exact.
//
// The chapter's whole XP pool is therefore 3045, and that is a HARD ceiling: the
// capstone, the modules and the assessments pay zero, so there is no other
// source to borrow from.
//
// ============================================================================
// DECISION 2 — THE FIRST THRESHOLD IS DERIVED, NOT CHOSEN
// ============================================================================
//
// Level 1 costs exactly what the WORST possible clear of the FIRST mission pays:
// a third-attempt clear of M1, floor(120/3) = 40 XP. That is not a tuned number,
// it is an identity (see `LEVEL_1_XP`), and it discharges the hardest
// requirement in the brief — a player who fails a lot must still have something
// to show for an hour of play. Every player who clears M1 at all, however badly,
// is Level 1. Nobody who plays and succeeds once is left at Level 0.
//
// ============================================================================
// DECISION 3 — LEVEL COST RISES LINEARLY, AT A SLOPE MATCHED TO THE AWARD RAMP
// ============================================================================
//
// cost(L) = 40 + 3*(L-1), so the cumulative threshold is
// T(L) = 40L + 3L(L-1)/2 — a quadratic, i.e. the classic RPG curve.
//
// The slope of 3 is not a feel guess; it is the value that holds LEVELS PER
// MISSION between 2 and 3 for a player clearing on the first attempt, across all
// fourteen missions (asserted in curve.test.ts). Both the award and the cost grow
// linearly, so their ratio is nearly constant: a full clear pays 2 or 3 Levels at
// M1 and still pays 2 or 3 Levels at M14. That is what "steady progress" has to
// mean mechanically — never a dead mission, never a spike.
//
// A steeper slope stalls the back half. A shallower one hands out Levels fast
// enough that the whole ability schedule lands in the first four missions and the
// remaining ten pay nothing anybody can see.
//
// ============================================================================
// DECISION 4 — WHERE THE CURVE ENDS, AND WHAT THAT MEANS FOR RANK
// ============================================================================
//
// A flawless Boston (3045 XP) reaches Level 34, which is Rank 4. So one chapter
// is worth roughly three Ranks, and Boston cannot produce a Rank above 4 for
// anybody. That is a deliberate calibration of the matchmaking input rather than
// a side effect. PvP unlocks only when Boston is complete, so end-of-Boston Rank
// IS the opening ladder, and the ladder has to be coarse enough to populate:
//
//   Rank 1  cleared almost nothing
//   Rank 2  weak or badly-paid clears        (Levels 10-19)
//   Rank 3  the median finisher              (Levels 20-29)
//   Rank 4  strong, near-flawless            (Levels 30-34)
//
// Three populated brackets out of a class of twenty-five is roughly six to ten
// players each, which is the point of the exercise. A curve paying fifty Levels
// per chapter would produce Ranks 1-6 and leave brackets holding two people.
//
// Thresholds are authored to Level 40 rather than 34: `xpToNextLevel` must never
// return null inside a chapter (the hub always has a "next Level" to draw), and
// the headroom means retuning the awards upward does not immediately overrun the
// curve.

import {
  MISSION_ATTEMPT_XP_FRACTIONS,
  XpCurveSchema,
  levelForXp,
  missionXpAward,
  xpToNextLevel,
  type XpCurve,
} from "./contractsSurface.js";

// ---------------------------------------------------------------------------
// the chapter
// ---------------------------------------------------------------------------

/** Fourteen missions, plus a capstone assessment that pays nothing. */
export const BOSTON_MISSION_COUNT = 14;

// ---------------------------------------------------------------------------
// mission awards
// ---------------------------------------------------------------------------

/** Base award for M1. A multiple of 3 so both retry shares are exact. */
export const FIRST_MISSION_BASE_XP = 120;

/** Added per mission. A multiple of 3 for the same reason. */
export const MISSION_BASE_XP_STEP = 15;

/**
 * Authored base award for a mission by its 1-based slate ordinal. Paid in full
 * only on attempt 1; @pa/contracts' `missionXpAward` applies the decay.
 */
export function missionBaseXp(ordinal: number): number {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > BOSTON_MISSION_COUNT) {
    return 0;
  }
  return FIRST_MISSION_BASE_XP + MISSION_BASE_XP_STEP * (ordinal - 1);
}

/** Every Boston base award, in slate order. */
export const BOSTON_MISSION_BASE_XP: readonly number[] = Array.from(
  { length: BOSTON_MISSION_COUNT },
  (_, index) => missionBaseXp(index + 1),
);

/**
 * Every XP point Boston can pay. Nothing else in the chapter pays, so this is a
 * hard ceiling on chapter Level and therefore on the Rank Boston can produce.
 */
export const BOSTON_CHAPTER_XP_CEILING = BOSTON_MISSION_BASE_XP.reduce(
  (sum, base) => sum + base,
  0,
);

/**
 * What a mission pays on a given attempt. A thin pass-through to
 * `missionXpAward` so this package never carries its own copy of the decay.
 */
export function missionAward(ordinal: number, attemptOrdinal: number): number {
  return missionXpAward({
    baseXp: missionBaseXp(ordinal),
    attemptOrdinal,
    outcome: "CLEARED",
  });
}

/** The worst-paying clear of a mission: the last attempt that still pays. */
export function worstPayingClear(ordinal: number): number {
  return missionAward(ordinal, MISSION_ATTEMPT_XP_FRACTIONS.length);
}

// ---------------------------------------------------------------------------
// the curve
// ---------------------------------------------------------------------------

/**
 * Cost of Level 1, DERIVED: the worst clear of the first mission, to the point.
 * Clearing M1 on the third attempt is the least XP any successful player can
 * hold, and it buys exactly one Level.
 */
export const LEVEL_1_XP = worstPayingClear(1);

/** Added to each successive Level's cost. See DECISION 3. */
export const LEVEL_COST_STEP = 3;

/** Highest Level the Boston curve authors thresholds for. */
export const BOSTON_LEVEL_CAP = 40;

/** Incremental XP from Level L-1 to Level L. */
export function levelCost(level: number): number {
  if (!Number.isInteger(level) || level < 1) return 0;
  return LEVEL_1_XP + LEVEL_COST_STEP * (level - 1);
}

/** Cumulative chapter XP required to hold Level L. T(L) = sum of costs. */
export function levelThreshold(level: number): number {
  if (!Number.isInteger(level) || level < 1) return 0;
  return LEVEL_1_XP * level + (LEVEL_COST_STEP * level * (level - 1)) / 2;
}

/**
 * The authored curve, in the shape @pa/contracts stores and validates.
 * `levelThresholds[i]` is the chapter XP required to reach Level i+1.
 */
export const BOSTON_XP_CURVE: XpCurve = XpCurveSchema.parse({
  curveId: "boston-1765.xp",
  version: "v1",
  levelThresholds: Array.from({ length: BOSTON_LEVEL_CAP }, (_, index) =>
    levelThreshold(index + 1),
  ),
});

/** Chapter Level for a chapter XP total. Level 0 below the first threshold. */
export function levelFor(xp: number): number {
  return levelForXp(BOSTON_XP_CURVE, xp);
}

/** XP still owed for the next Level, or null past the authored cap. */
export function xpOwedForNextLevel(xp: number): number | null {
  return xpToNextLevel(BOSTON_XP_CURVE, xp);
}

/** Highest Level Boston can produce, given that only missions pay. */
export const BOSTON_MAX_ATTAINABLE_LEVEL = levelFor(BOSTON_CHAPTER_XP_CEILING);
