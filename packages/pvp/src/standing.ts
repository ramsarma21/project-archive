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
//   - STRICTLY ZERO-SUM between the two players: the winner gains EXACTLY what the
//     loser gives up, so the total points in a class is conserved and the board
//     cannot be farmed. Two students trading wins back and forth — the obvious farm,
//     and the obvious grind of immediate forfeits — net to zero over any even number
//     of matches, because every point one gains is a point the other lost.
//   - Floored at zero, WITHOUT breaking the zero-sum. Thirteen-year-olds do not need
//     a negative number attached to their name in front of the class; "carrot, not
//     punishment" is bedrock. The floor is honoured by capping the move at what the
//     loser actually has above zero and paying the winner that same capped amount —
//     never a nominal amount the loser could not cover, which is the loophole that
//     would let a pair at the floor mint points from nothing.
//   - An upset pays more. Brackets widen under patience, so a Rank 2 student can
//     legitimately meet a Rank 4 one; beating up the ladder moves more points, and
//     because the move is symmetric the higher-ranked loser gives up exactly that
//     more. The move is the same on both sides — that is what zero-sum means.
//   - A draw moves nothing, per the duel's own settled rule.
//
// Deliberately NOT Elo. Elo assumes many games against a wide field; a class of 25
// playing a handful of matches would produce ratings dominated by their initial value,
// and it would need a K-factor argument nobody has asked for. This is simple enough to
// explain to a student, which is a feature.

import type { DuelSide } from "@pa/duel";
import type { PvpMatchResult } from "./authority.js";
import type { ProfileId } from "./match.js";

/** The nominal move for a win between equal Ranks. Paid by the winner AND the loser. */
export const STANDING_WIN_BASE = 20;
/** Extra for each Rank the winner was below the loser. Symmetric: the loser gives it up too. */
export const STANDING_UPSET_BONUS_PER_RANK = 8;
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
  /** What the winner gains. Equal to `loser` — the move is symmetric by design. */
  readonly winner: number;
  /** What the loser gives up. Equal to `winner` — see above. */
  readonly loser: number;
}

/**
 * The NOMINAL move for one decided match, before the floor is applied.
 *
 * It is symmetric on purpose: `winner` and `loser` are the same number, because the
 * points the winner gains are precisely the points the loser gives up. `winnerRank`
 * below `loserRank` is the upset case and moves more; a favourite winning moves the
 * base. The floor cannot be honoured here because it depends on the loser's balance,
 * so `applyMatchResult` caps the actual move — see there.
 */
export function standingDelta(winnerRank: number, loserRank: number): StandingDelta {
  const upset = Math.max(0, loserRank - winnerRank);
  const move = STANDING_WIN_BASE + upset * STANDING_UPSET_BONUS_PER_RANK;
  return { winner: move, loser: move };
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
  // Standing is refused on needsReview INDEPENDENTLY of standingApplies. An
  // outage-graded result is flagged both ways at its source, but a caller must not be
  // able to move points by clearing one flag and forgetting the other: a result that
  // needs review moves nothing here, full stop. Wins and losses are not recorded
  // either — a match nobody trusts is a practice match, not a ranked one.
  if (result.needsReview || !result.standingApplies) {
    return { records: [records.A, records.B], delta: null, reviewRequired: true };
  }

  const winnerSide: DuelSide = result.winner;
  const winner = records[winnerSide];
  const loser = winnerSide === "A" ? records.B : records.A;
  const nominal = standingDelta(winner.rank, loser.rank);
  // THE MOVE IS CAPPED AT WHAT THE LOSER CAN COVER, and the winner is paid that same
  // capped amount. This is what keeps the floor from breaking zero-sum: a nominal 20
  // against a loser sitting on 3 points moves 3, not 20, so the winner gains 3 and the
  // loser lands on the floor. Paying the winner the full nominal while the loser only
  // gave up 3 would create 17 points out of nothing — the exact loophole a pair
  // grinding at the bottom of the board would find.
  const moved = Math.min(nominal.winner, Math.max(0, loser.points - STANDING_FLOOR));
  const updatedWinner: StandingRecord = {
    ...winner,
    points: winner.points + moved,
    wins: winner.wins + 1,
  };
  const updatedLoser: StandingRecord = {
    ...loser,
    points: loser.points - moved,
    losses: loser.losses + 1,
  };
  return {
    records:
      winnerSide === "A"
        ? [updatedWinner, updatedLoser]
        : [updatedLoser, updatedWinner],
    // The ACTUAL move, not the nominal, so telemetry sees what really changed.
    delta: { winner: moved, loser: moved },
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
