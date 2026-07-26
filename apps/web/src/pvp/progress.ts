// Is this fight converging?
//
// A duel no longer runs for a known number of rounds; it runs until a health pool
// empties. That removes the progress bar the six-round format gave away for free,
// and it removes it from a mode where every round is an open-response question
// with evidence in it — so a match can legitimately run long, and a player with no
// read on whether it is going anywhere will assume it is not.
//
// The replacement is NOT a clock. A countdown would put a timer on the answering
// phase, which is deliberately untimed, and it would answer a different question
// ("how long is left") than the one being asked ("is this getting anywhere").
//
// So progress is derived from the only thing that actually settles a duel: health,
// and the rate it is moving. Everything here comes from observing successive
// authoritative snapshots. Nothing is predicted, nothing is simulated, and — this
// is the part that matters while @pa/duel is being rebuilt — NO CONSTANT FROM THE
// SIMULATION IS ASSUMED. The health maximum is the high-water mark this match has
// actually shown; damage per hit is measured, not looked up. A change to the
// health model or the damage numbers lands here as different readings, not as a
// wrong denominator.

import type { DuelSide } from "@pa/duel";
import type { MatchSnapshot } from "./protocol.js";

export interface RoundRecord {
  readonly round: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
}

export interface MatchProgress {
  /** Highest health each side has been observed at. The honest denominator. */
  readonly selfHealthMax: number;
  readonly opponentHealthMax: number;
  readonly selfHealth: number;
  readonly opponentHealth: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  /** Observed drops in the opponent's health. One drop is one landed shot. */
  readonly hitsLanded: number;
  readonly hitsTaken: number;
  readonly round: number;
  /** Closed rounds, newest last. The current round is not in here yet. */
  readonly rounds: readonly RoundRecord[];
  readonly currentRoundDealt: number;
  readonly currentRoundTaken: number;
  readonly lastTick: number;
}

export const EMPTY_PROGRESS: MatchProgress = {
  selfHealthMax: 0,
  opponentHealthMax: 0,
  selfHealth: 0,
  opponentHealth: 0,
  damageDealt: 0,
  damageTaken: 0,
  hitsLanded: 0,
  hitsTaken: 0,
  round: 0,
  rounds: [],
  currentRoundDealt: 0,
  currentRoundTaken: 0,
  lastTick: -1,
};

/**
 * Fold one snapshot in.
 *
 * Idempotent on a repeated tick, because a poll that races another poll must not
 * count the same damage twice — the tick is the authority's own counter, so it is
 * the right thing to deduplicate on.
 *
 * A health INCREASE is not a negative hit. Nothing in the duel heals today, but an
 * ability might, and the arithmetic should degrade to "the maximum went up" rather
 * than to a negative damage total.
 */
export function observeProgress(
  previous: MatchProgress,
  snapshot: MatchSnapshot,
): MatchProgress {
  const first = previous.lastTick < 0;
  if (!first && snapshot.tick <= previous.lastTick) return previous;

  const selfHealth = snapshot.self.health;
  const opponentHealth = snapshot.opponent.health;
  const dealt = first ? 0 : Math.max(0, previous.opponentHealth - opponentHealth);
  const taken = first ? 0 : Math.max(0, previous.selfHealth - selfHealth);

  const roundChanged = !first && snapshot.round !== previous.round;
  const closed: readonly RoundRecord[] = roundChanged
    ? [
        ...previous.rounds,
        {
          round: previous.round,
          damageDealt: previous.currentRoundDealt,
          damageTaken: previous.currentRoundTaken,
        },
      ]
    : previous.rounds;

  return {
    selfHealthMax: Math.max(previous.selfHealthMax, selfHealth),
    opponentHealthMax: Math.max(previous.opponentHealthMax, opponentHealth),
    selfHealth,
    opponentHealth,
    damageDealt: previous.damageDealt + dealt,
    damageTaken: previous.damageTaken + taken,
    hitsLanded: previous.hitsLanded + (dealt > 0 ? 1 : 0),
    hitsTaken: previous.hitsTaken + (taken > 0 ? 1 : 0),
    round: snapshot.round,
    rounds: closed,
    currentRoundDealt: roundChanged ? dealt : previous.currentRoundDealt + dealt,
    currentRoundTaken: roundChanged ? taken : previous.currentRoundTaken + taken,
    lastTick: snapshot.tick,
  };
}

export interface ConvergenceReading {
  /** 0..1 of each pool remaining. The two health bars. */
  readonly selfFraction: number;
  readonly opponentFraction: number;
  /**
   * −1..1. Positive means this player is ahead on health. This is the single
   * number that answers "which way is the fight going".
   */
  readonly advantage: number;
  /** Mean damage per landed shot, measured. Null until a shot has landed. */
  readonly damagePerHit: number | null;
  /**
   * Clean hits still needed to finish the opponent, at the rate observed so far.
   * Null until there is a rate. An ESTIMATE, and labelled as one in the UI.
   */
  readonly hitsToFinish: number | null;
  readonly hitsToSurvive: number | null;
  /**
   * True once either pool is under a quarter. The fight is demonstrably ending,
   * which is the reassurance an open-ended match owes the player.
   */
  readonly closing: boolean;
}

export function convergence(progress: MatchProgress): ConvergenceReading {
  const selfFraction =
    progress.selfHealthMax > 0 ? progress.selfHealth / progress.selfHealthMax : 1;
  const opponentFraction =
    progress.opponentHealthMax > 0
      ? progress.opponentHealth / progress.opponentHealthMax
      : 1;
  const damagePerHit =
    progress.hitsLanded > 0 ? progress.damageDealt / progress.hitsLanded : null;
  const damagePerHitTaken =
    progress.hitsTaken > 0 ? progress.damageTaken / progress.hitsTaken : null;
  return {
    selfFraction,
    opponentFraction,
    advantage: selfFraction - opponentFraction,
    damagePerHit,
    hitsToFinish:
      damagePerHit && damagePerHit > 0
        ? Math.max(1, Math.ceil(progress.opponentHealth / damagePerHit))
        : null,
    hitsToSurvive:
      damagePerHitTaken && damagePerHitTaken > 0
        ? Math.max(1, Math.ceil(progress.selfHealth / damagePerHitTaken))
        : null,
    closing: selfFraction <= 0.25 || opponentFraction <= 0.25,
  };
}

/** Whose fight it is, for a result line that reads as English rather than a letter. */
export function outcomeLine(
  winner: DuelSide | null,
  self: DuelSide,
  reason: string,
): string {
  if (winner === null) return `Drawn — ${reason.toLowerCase().replace(/_/g, " ")}`;
  const verb = reason === "FORFEIT" ? "by forfeit" : reason.toLowerCase().replace(/_/g, " ");
  return winner === self ? `You won — ${verb}` : `You lost — ${verb}`;
}
