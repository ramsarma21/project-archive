// The inter-round resync barrier.
//
// THE ASSET. A duel is six twenty-second rounds separated by a free-response
// question with NO TIME LIMIT. That structure hands the netcode something most
// shooters have to buy expensively: a moment, six times a match, when both bodies
// are stationary, nothing is in flight, and neither player is looking at the
// arena. A full authoritative state transfer there costs nothing perceptually.
//
// WHAT IT BUYS. Drift cannot accumulate across a match. Whatever a client's
// prediction has got wrong, it is corrected at the next boundary and the error
// budget resets. The worst case is therefore bounded at ONE ROUND — twenty seconds
// — rather than at the length of a match, and that bound is what makes prediction
// error a smoothness question instead of a correctness question.
//
// It also bounds the cost of every hard case below it. A reconnect never has to
// replay a match; at worst it replays a round. A divergence report never spans
// more than a round of inputs, which is what keeps it small enough to attach to a
// bug and replay in a test.
//
// WHAT IT DOES NOT DO. It is not a substitute for correcting drift within a round.
// A client that is half a metre out for fifteen seconds and then snaps is a client
// that has been shooting at the wrong place for fifteen seconds. The barrier is
// the floor under the continuous reconciliation, not a replacement for it.

import type { DuelPhase } from "@pa/duel";

/**
 * Phases in which a full state transfer is perceptually free.
 *
 * The test is not "is the fight paused" but "would a player notice a body moving
 * to a corrected position". QUESTION_PENDING is the obvious one and the strongest:
 * it is untimed, so there is not even a countdown to disturb. The other three are
 * the round's own seams — the grant countdown, the reload break, and the resolved
 * round — where the fight has stopped but the clock has not.
 */
export const BARRIER_PHASES: ReadonlySet<DuelPhase> = new Set<DuelPhase>([
  "QUESTION_PENDING",
  "VERDICT_COMMITTED",
  "BULLETS_GRANTED",
  "ROUND_RESOLVED",
]);

export function isBarrierPhase(phase: DuelPhase): boolean {
  return BARRIER_PHASES.has(phase);
}

/**
 * Barrier tracking, per side.
 *
 * Fires on the EDGE into a barrier phase rather than continuously inside one, so a
 * twenty-second think does not become twenty seconds of full state transfers. One
 * per entry is all a resync is for.
 */
export interface BarrierTracker {
  readonly lastPhase: DuelPhase | null;
  readonly lastRound: number;
  readonly barriersFired: number;
}

export const INITIAL_BARRIER_TRACKER: BarrierTracker = {
  lastPhase: null,
  lastRound: 0,
  barriersFired: 0,
};

export interface BarrierDecision {
  readonly tracker: BarrierTracker;
  readonly fire: boolean;
}

export function observePhase(
  tracker: BarrierTracker,
  phase: DuelPhase,
  round: number,
): BarrierDecision {
  const changed = tracker.lastPhase !== phase || tracker.lastRound !== round;
  const next: BarrierTracker = {
    lastPhase: phase,
    lastRound: round,
    barriersFired: tracker.barriersFired,
  };
  if (!changed || !isBarrierPhase(phase)) {
    return { tracker: next, fire: false };
  }
  return {
    tracker: { ...next, barriersFired: tracker.barriersFired + 1 },
    fire: true,
  };
}

/**
 * The bound the barrier guarantees, in ticks: the longest a client can run on its
 * own prediction before the server hard-sets it.
 *
 * Derived from the duel's own round shape rather than restated, so it stays true if
 * the round length is ever retuned. This is the number to quote when someone asks
 * how bad an undetected drift can get.
 */
export function maxUncorrectedTicks(engagementTicks: number, breakTicks: number): number {
  return engagementTicks + breakTicks;
}
