// ---------------------------------------------------------------------------
// Quest-arrival latch state machine (pure, unit-tested). Extracted from the
// QuestArrivalTracker so the accepted-commit contract has a deterministic
// regression test (feel-audit-1 P0-6): an arrival may consume its one-shot
// latch ONLY once the runtime actually accepted the FREE_ROAM_GOTO commit.
// A dropped commit leaves the latch clear and schedules a bounded retry
// while the player keeps standing in the radius.
// ---------------------------------------------------------------------------

export const ARRIVAL_RETRY_MS = 350;

export interface ArrivalLatchState {
  firedKey: string | null; // accepted arrivals (one-shot per cue|target)
  inFlightKey: string | null; // commit currently awaiting the runtime
  retryAt: number; // no attempts before this timestamp
}

export function createArrivalLatch(): ArrivalLatchState {
  return { firedKey: null, inFlightKey: null, retryAt: 0 };
}

// Should this frame attempt the arrival commit?
export function shouldAttemptArrival(
  state: ArrivalLatchState,
  key: string,
  nowMs: number,
  arrivalConditionsMet: boolean,
): boolean {
  return (
    arrivalConditionsMet &&
    state.firedKey !== key &&
    state.inFlightKey !== key &&
    nowMs >= state.retryAt
  );
}

export function beginArrivalAttempt(
  state: ArrivalLatchState,
  key: string,
): ArrivalLatchState {
  return { ...state, inFlightKey: key };
}

// Commit settled: latch on acceptance, otherwise clear and back off.
export function settleArrivalAttempt(
  state: ArrivalLatchState,
  key: string,
  accepted: boolean,
  nowMs: number,
): ArrivalLatchState {
  if (state.inFlightKey !== key) return state;
  return accepted
    ? { ...state, inFlightKey: null, firedKey: key }
    : { ...state, inFlightKey: null, retryAt: nowMs + ARRIVAL_RETRY_MS };
}
