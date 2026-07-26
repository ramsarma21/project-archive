// PvP standing and the leaderboard.
//
// A leaderboard needs an ordering, and Rank cannot be it: Rank comes only from mission
// XP, never decreases, and is therefore a measure of single-player progress rather than
// of duelling. Ordering a PvP board by Rank would make it a PvE leaderboard with extra
// steps, and PvE leaderboards are explicitly out.
//
// So PvP carries its own quantity. STANDING POINTS IS THE ONE INVENTED NUMBER IN THIS
// PACKAGE and it is flagged as needing ratification, because it is a design decision
// dressed as an implementation detail. What it is built to satisfy:
//
//   - Zero-sum between the two players, so the board cannot be farmed by volume.
//   - Floored at zero. Thirteen-year-olds do not need a negative number attached to
//     their name in front of the class; "carrot, not punishment" is bedrock.
//   - An upset pays more and costs less. Brackets widen under patience, so a Rank 2
//     student can legitimately meet a Rank 4 one, and the reward should reflect that
//     rather than punishing whoever was unlucky with the queue.
//   - A draw moves nothing, per the duel's own settled rule.
//
// Deliberately NOT Elo. Elo assumes many games against a wide field; a class of 25
// playing a handful of matches would produce ratings dominated by their initial value,
// and it would need a K-factor argument nobody has asked for. This is simple enough to
// explain to a student, which is a feature.

import type { DuelSide } from "@pa/duel";
import type { PvpMatchResult } from "./authority.js";
import type { ProfileId } from "./match.js";

/** Points for a win between equal Ranks. */
export const STANDING_WIN_BASE = 20;
/** Points the loser gives up between equal Ranks. */
export const STANDING_LOSS_BASE = 12;
/** Extra for each Rank the winner was below the loser. */
export const STANDING_UPSET_BONUS_PER_RANK = 8;
/** Reduction per Rank the loser was below the winner, so losing up is cheap. */
export const STANDING_UNDERDOG_RELIEF_PER_RANK = 6;
/** Nobody's public number goes below this. */
export const STANDING_FLOOR = 0;
/** Where a profile starts, so a first loss is survivable. */
export const STANDING_STARTING_POINTS = 100;

export interface StandingRecord {
  readonly profileId: ProfileId;
  readonly handle: string;
  readonly rank: number;
  readonly points: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export function newStandingRecord(
  profileId: ProfileId,
  handle: string,
  rank: number,
): StandingRecord {
  return {
    profileId,
    handle,
    rank,
    points: STANDING_STARTING_POINTS,
    wins: 0,
    losses: 0,
    draws: 0,
  };
}

export interface StandingDelta {
  readonly winner: number;
  readonly loser: number;
}

/**
 * Points moved by one decided match. `winnerRank` below `loserRank` is the upset case.
 */
export function standingDelta(winnerRank: number, loserRank: number): StandingDelta {
  const gap = loserRank - winnerRank;
  const upset = Math.max(0, gap);
  const favourite = Math.max(0, -gap);
  return {
    winner: STANDING_WIN_BASE + upset * STANDING_UPSET_BONUS_PER_RANK,
    loser: Math.max(
      0,
      STANDING_LOSS_BASE - favourite * STANDING_UNDERDOG_RELIEF_PER_RANK,
    ),
  };
}

export interface StandingUpdate {
  readonly records: readonly StandingRecord[];
  readonly delta: StandingDelta | null;
  readonly reviewRequired: boolean;
}

/**
 * Apply a match result to two records. Pure, so the API can persist the outcome and
 * the standing rows in one transaction and a test can assert on the arithmetic.
 */
export function applyMatchResult(
  result: PvpMatchResult,
  records: { readonly A: StandingRecord; readonly B: StandingRecord },
): StandingUpdate {
  if (result.winner === null) {
    // A true draw: no points move, and the match is flagged so telemetry can tell us
    // whether draws happen at a rate that justifies building a decider.
    return {
      records: [
        { ...records.A, draws: records.A.draws + 1 },
        { ...records.B, draws: records.B.draws + 1 },
      ],
      delta: null,
      reviewRequired: result.needsReview,
    };
  }
  if (!result.standingApplies) {
    return { records: [records.A, records.B], delta: null, reviewRequired: true };
  }

  const winnerSide: DuelSide = result.winner;
  const winner = records[winnerSide];
  const loser = winnerSide === "A" ? records.B : records.A;
  const delta = standingDelta(winner.rank, loser.rank);
  const updatedWinner: StandingRecord = {
    ...winner,
    points: winner.points + delta.winner,
    wins: winner.wins + 1,
  };
  const updatedLoser: StandingRecord = {
    ...loser,
    points: Math.max(STANDING_FLOOR, loser.points - delta.loser),
    losses: loser.losses + 1,
  };
  return {
    records:
      winnerSide === "A"
        ? [updatedWinner, updatedLoser]
        : [updatedLoser, updatedWinner],
    delta,
    reviewRequired: false,
  };
}

export interface LeaderboardRow {
  readonly position: number;
  /** The ONLY identity on a board. No profileId, no name, no school, no class. */
  readonly handle: string;
  readonly rank: number;
  readonly points: number;
  readonly wins: number;
  readonly losses: number;
}

/**
 * Order a board. Points, then wins, then handle for a total order.
 *
 * `profileId` is dropped here rather than by the caller, so a board row cannot carry an
 * identifier by accident: the row type has no field for one.
 */
export function leaderboard(
  records: readonly StandingRecord[],
  limit = 50,
): readonly LeaderboardRow[] {
  return [...records]
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.wins - left.wins ||
        (left.handle < right.handle ? -1 : left.handle > right.handle ? 1 : 0),
    )
    .slice(0, Math.max(0, limit))
    .map((record, index) => ({
      position: index + 1,
      handle: record.handle,
      rank: record.rank,
      points: record.points,
      wins: record.wins,
      losses: record.losses,
    }));
}
