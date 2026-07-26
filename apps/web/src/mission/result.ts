import {
  MAX_MISSION_ATTEMPTS,
  attemptXpFraction,
  canAdvancePastMission,
  isMissionPermanentlySpent,
  missionXpAward,
  remainingMissionAttempts,
  type MissionOutcome,
  type MissionOutcomeCommit,
  type XpFraction,
} from "@pa/contracts";
import {
  recordAttemptResolved,
  type MissionAttemptTally,
} from "../module/moduleGate.js";
import type { MissionFailure } from "./levelPort.js";
import type { MissionDuelReport, MissionDuelRoundReport } from "./duelPort.js";
import type { MissionAttemptTicket } from "./attempt.js";

// ---------------------------------------------------------------------------
// The result, and the XP the attempt paid.
//
// One derivation, and it derives nothing itself. Every number that could be
// argued about — the fraction for an ordinal, the floored award, whether the
// mission is spent, whether the player advances — comes out of @pa/contracts,
// which is also what the server runs when it writes the row. A second copy of
// the decay schedule in the client is a divergence waiting to be exploited, so
// there is no arithmetic in this file beyond adding up seconds.
//
// The rules this enforces, stated once:
//
//   Full XP on attempt 1, two-thirds on the first retry, one-third on the
//   second. Only a clear pays. The award floors, so a two-thirds share of an
//   odd base can never round up past the attempt before it.
//
//   Three attempts, then the mission is spent forever and pays zero forever.
//   The player advances anyway: advancement is gated on the mission being
//   RESOLVED, never on it being cleared.
//
//   The duel's verdicts are reported and nothing else. They mint no card, gate
//   nothing, and are not a second axis that can fail an attempt.
// ---------------------------------------------------------------------------

/** What the run measured about itself, whatever way it ended. */
export interface MissionTraversalObservation {
  /** Traversal as the simulation counted it: fixed steps × FIELD_DT. */
  readonly simulatedS: number;
  /**
   * Fixed steps the catch-up bound discarded. Nonzero means the player's wall
   * clock ran ahead of the simulation's, so the two figures below diverge and the
   * simulated one understates how long the mission actually took.
   */
  readonly droppedSteps: number;
  readonly objectiveIds: readonly string[];
  readonly detections: number;
  /** Throws that struck a body instead of reaching their aim point. */
  readonly throwsStruckBody: number;
}

/** How the traversal phase ended. */
export type MissionTraversalOutcome =
  | ({ readonly kind: "REACHED_DUEL" } & MissionTraversalObservation)
  | ({
      readonly kind: "FAILED";
      readonly failure: MissionFailure;
    } & MissionTraversalObservation);

export interface MissionAchievement {
  /** The physical route was completed and the duel was armed. */
  readonly traversalCompleted: boolean;
  readonly objectiveIds: readonly string[];
  /** Confirmed sightings on the floor. Reported; never a fail axis of its own. */
  readonly detections: number;
  /**
   * Throws that hit a person instead of the wall they were aimed past. A player
   * learning to aim shows up here, and a beat that depends on a throw being
   * blockable is verifiable from it.
   */
  readonly throwsStruckBody: number;
  readonly duelReached: boolean;
  readonly duelWon: boolean;
}

export interface MissionKnowledgeSummary {
  readonly rounds: readonly MissionDuelRoundReport[];
  readonly correct: number;
  readonly asked: number;
  /** Concepts the six rounds touched, in the order they were asked. */
  readonly conceptIds: readonly string[];
}

/**
 * How long the attempt actually took, against what it was costed at.
 *
 * This gates nothing. It exists because the curriculum is costed at fourteen
 * missions of roughly five minutes and the twenty-to-thirty-hour claim rests on
 * that arithmetic — and the only figure anyone has today is an estimate of 145
 * seconds for a competent player. If real students spend eight minutes on
 * traversal the claim breaks quietly and no test finds out, so every attempt
 * reports its own evidence and the authored budget beside it.
 *
 * Two clocks, deliberately both. `traversalSimulatedS` is the simulation's own
 * count and is the number to compare against the authored budget, because it is
 * what the level was designed against and it is frame-rate independent.
 * `traversalWallS` is what the student sat through, and it is the number the
 * hours-per-chapter claim is actually made of. They diverge when frames are
 * dropped or the tab is backgrounded, which is exactly the case a school
 * Chromebook produces and exactly why `droppedSteps` is reported alongside.
 */
export interface MissionTiming {
  /** The level's authored pacing budget for traversal. */
  readonly traversalBudgetS: number;
  readonly traversalSimulatedS: number;
  readonly traversalWallS: number;
  /** Simulated minus budget. Positive means the run ran long. */
  readonly traversalOverBudgetS: number;
  readonly droppedSteps: number;
  /** The mandatory module, as its own run reported it. Never a gate. */
  readonly moduleObservedS: number;
  /** The duel's fight clock: six rounds of twenty seconds, per §4.5. */
  readonly duelEngagementS: number;
  /** The duel including its untimed question pauses. Measured, not modelled. */
  readonly duelWallS: number;
  /** Module completion through result. What the five-minute costing is against. */
  readonly attemptWallS: number;
  /**
   * True when the attempt ran the whole shape. A failed run's traversal time is
   * not evidence about how long a completed route takes, so an average over
   * attempts has to filter on this.
   */
  readonly isCompleteAttempt: boolean;
}

export interface MissionResult {
  readonly missionId: string;
  readonly chapterId: string;
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly outcome: "CLEARED" | "FAILED";
  /** The result screen's first line. */
  readonly headline: string;
  readonly detail: string;
  readonly achievement: MissionAchievement;
  readonly knowledge: MissionKnowledgeSummary;
  /** Authored budget against real play. Reports; gates nothing. */
  readonly timing: MissionTiming;
  readonly baseXp: number;
  readonly xpFraction: XpFraction;
  /** What this attempt paid. Zero on any failure, always. */
  readonly awardedXp: number;
  /** The tally after this attempt. What the hub stores. */
  readonly tally: MissionAttemptTally;
  readonly attemptsUsedAfter: number;
  readonly attemptsRemaining: number;
  readonly outcomeAfter: MissionOutcome;
  readonly missionSpentAfter: boolean;
  /** True once the mission is resolved either way. Never gated on clearing. */
  readonly advancesToNextMission: boolean;
  readonly resolvedAt: string;
  /** The facts the server needs to commit. It re-derives every number from them. */
  readonly commit: MissionOutcomeCommit;
  /** @pa/duel's commit log, carried through untouched. Never raw answer text. */
  readonly committedEvents: readonly Record<string, unknown>[];
}

export interface DeriveMissionResultInput {
  readonly ticket: MissionAttemptTicket;
  readonly baseXp: number;
  readonly tallyBefore: MissionAttemptTally;
  readonly traversal: MissionTraversalOutcome | null;
  /**
   * What the run measured, for an attempt that has no terminal outcome because the
   * player walked out of it. A quit run's seconds are still evidence.
   */
  readonly observation: MissionTraversalObservation | null;
  readonly duel: MissionDuelReport | null;
  /** Set when the player left the attempt without finishing it. */
  readonly abandoned: { readonly reason: string } | null;
  /** The level's authored traversal budget, for the timing comparison. */
  readonly traversalBudgetS: number;
  /** Wall-clock instants the session recorded. Absent legs are null. */
  readonly clock: {
    readonly traversalStartedAt: string | null;
    readonly duelStartedAt: string | null;
  };
  readonly at: string;
}

function secondsBetween(from: string | null, to: string): number {
  if (!from) return 0;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, (end - start) / 1000);
}

function terminalNote(tally: MissionAttemptTally): string {
  if (tally.outcome === "FAILED_PERMANENT") {
    return (
      "That was the third attempt. This operation is failed permanently, it " +
      "pays nothing from here, and you advance to the next one regardless — " +
      "what is done is done. The next operation carries its own full schedule."
    );
  }
  const left = remainingMissionAttempts(tally);
  const share = attemptXpFraction(tally.attemptsUsed + 1);
  return (
    `${left} of ${MAX_MISSION_ATTEMPTS} attempts left. The next one pays ` +
    `${share.numerator}/${share.denominator} and requires the module again. ` +
    "Nothing about the operation gets easier."
  );
}

function copyFor(input: {
  outcome: "CLEARED" | "FAILED";
  traversal: MissionTraversalOutcome | null;
  duel: MissionDuelReport | null;
  abandoned: { reason: string } | null;
}): { headline: string; detail: string } {
  if (input.outcome === "CLEARED") {
    const knockout = input.duel?.outcome.reason === "KNOCKOUT";
    return {
      headline: "Operation complete.",
      detail: knockout
        ? "The route held and the boss went down."
        : "The route held and the duel went to you on damage dealt.",
    };
  }
  if (input.abandoned) {
    return {
      headline: "Attempt abandoned.",
      detail: `You left before the operation resolved (${input.abandoned.reason}). The attempt is spent.`,
    };
  }
  if (input.traversal?.kind === "FAILED") {
    return {
      headline: input.traversal.failure.headline,
      detail: input.traversal.failure.detail,
    };
  }
  if (input.duel) {
    return {
      headline: "The duel is lost.",
      detail:
        "Losing the duel is losing the duel. It is not reclassified as a " +
        "knowledge failure — the questions only ever set your ammunition.",
    };
  }
  return {
    headline: "The attempt is over.",
    detail: "The operation did not resolve in your favour.",
  };
}

/**
 * The one derivation of everything an attempt's end changes.
 *
 * A clear requires both halves: the physical route completed, and the duel won.
 * Either half missing is a failure, and a failure pays zero — there is no
 * partial credit for reaching the arena, because the arena is not the mission.
 */
export function deriveMissionResult(
  input: DeriveMissionResultInput,
): MissionResult {
  const { ticket, traversal, duel } = input;
  const traversalCompleted = traversal?.kind === "REACHED_DUEL";
  const duelWon = duel?.won === true;
  const outcome: "CLEARED" | "FAILED" =
    traversalCompleted && duelWon && input.abandoned === null
      ? "CLEARED"
      : "FAILED";

  const tally = recordAttemptResolved(
    input.tallyBefore,
    outcome === "CLEARED" ? "CLEARED" : "FAILED",
  );

  const xpFraction = attemptXpFraction(ticket.attemptOrdinal);
  const awardedXp = missionXpAward({
    baseXp: input.baseXp,
    attemptOrdinal: ticket.attemptOrdinal,
    outcome,
  });

  const rounds = duel?.rounds ?? [];
  const copy = copyFor({
    outcome,
    traversal,
    duel,
    abandoned: input.abandoned,
  });

  // The outcome carries the observation when there is one; a quit run only has the
  // observation. Neither is preferred over the other — they are the same numbers
  // taken from the same runtime, and one of the two is always absent.
  const observed = traversal ?? input.observation;
  const simulatedS = observed?.simulatedS ?? 0;
  const traversalWallS = secondsBetween(input.clock.traversalStartedAt, input.at);
  const timing: MissionTiming = {
    traversalBudgetS: input.traversalBudgetS,
    traversalSimulatedS: simulatedS,
    traversalWallS,
    traversalOverBudgetS: simulatedS - input.traversalBudgetS,
    droppedSteps: observed?.droppedSteps ?? 0,
    moduleObservedS: ticket.moduleCompletion.observedSeconds,
    duelEngagementS: duel?.engagementSeconds ?? 0,
    duelWallS: secondsBetween(input.clock.duelStartedAt, input.at),
    attemptWallS: secondsBetween(ticket.openedAt, input.at),
    isCompleteAttempt: traversalCompleted && duel !== null,
  };

  return {
    missionId: ticket.missionId,
    chapterId: ticket.chapterId,
    attemptId: ticket.attemptId,
    attemptOrdinal: ticket.attemptOrdinal,
    outcome,
    headline: copy.headline,
    detail: `${copy.detail} ${terminalNote(tally)}`,
    achievement: {
      traversalCompleted,
      objectiveIds: observed?.objectiveIds ?? [],
      detections: observed?.detections ?? 0,
      throwsStruckBody: observed?.throwsStruckBody ?? 0,
      duelReached: traversalCompleted,
      duelWon,
    },
    knowledge: {
      rounds,
      correct: rounds.filter((round) => round.verdict === "CORRECT").length,
      asked: rounds.length,
      conceptIds: rounds.map((round) => round.conceptId),
    },
    timing,
    baseXp: input.baseXp,
    xpFraction,
    awardedXp,
    tally,
    attemptsUsedAfter: tally.attemptsUsed,
    attemptsRemaining: remainingMissionAttempts(tally),
    outcomeAfter: tally.outcome,
    missionSpentAfter: isMissionPermanentlySpent(tally),
    advancesToNextMission: canAdvancePastMission(tally),
    resolvedAt: input.at,
    commit: {
      missionId: ticket.missionId,
      chapterId: ticket.chapterId,
      attemptOrdinal: ticket.attemptOrdinal,
      outcome,
      baseXp: input.baseXp,
      at: input.at,
    },
    committedEvents: duel?.committedEvents ?? [],
  };
}
