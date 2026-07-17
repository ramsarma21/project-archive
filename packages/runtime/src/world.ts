import {
  DAY1_CLOCK,
  BASELINES,
  warningStageForUnits,
  phaseForUnits,
  type WorldState,
  type WarningStage,
} from "@pa/contracts";

export function initialWorldState(): WorldState {
  return {
    revision: "0",
    locationId: "ARCHIVE_TRANSIT",
    controlState: "ARCHIVE",
    clock: {
      spentUnits: 0,
      fixedEventBoundary: DAY1_CLOCK.fixedEventBoundary,
      warningStage: "NONE",
      phase: "MORNING",
    },
    currentInteractionOrdinal: 0,
    lastSyncCompletionInteractionOrdinal: null,
    firstErrandCompletionRecorded: false,
    fixedEvent: "NOT_STARTED",
    objectives: {
      REPORT_TO_MERCER: "ACTIVE",
      THOMAS_CIRCULAR: "NOT_YET_ELIGIBLE",
      PIKE_PROOF: "NOT_YET_ELIGIBLE",
      RIDER_HANDBILLS: "NOT_YET_ELIGIBLE",
      CUSTOMHOUSE_NOTICE: "NOT_YET_ELIGIBLE",
      OBSERVE_CROWD: "NOT_YET_ELIGIBLE",
      RETURN_TO_PRESS: "NOT_YET_ELIGIBLE",
      SET_HEADLINE: "NOT_YET_ELIGIBLE",
    },
    jobObjects: {
      THOMAS_CIRCULAR: { custody: "ABIGAIL", condition: "INTACT" },
      PIKE_PROOF: { custody: "ABIGAIL", condition: "UNPRINTED" },
      CARRIER_HANDBILLS: { custody: "ABIGAIL", condition: "INTACT", concealment: "EXPOSED" },
      CUSTOMHOUSE_NOTICE: { custody: "ABIGAIL", condition: "INTACT" },
      PLAIN_WRAP: { custody: "ABIGAIL", condition: "INTACT" },
    },
    relationships: {
      ABIGAIL_TRUST: BASELINES.abigailTrust,
      ABIGAIL_RESPECT: BASELINES.abigailRespect,
      ABIGAIL_WARMTH: BASELINES.abigailWarmth,
      THOMAS_OBLIGATION: BASELINES.thomasObligation,
      PIKE_RESPECT: BASELINES.pikeRespect,
      CLARKE_POLITICAL_READ: BASELINES.clarkePoliticalRead,
      RIDER_TRUST: BASELINES.riderTrust,
    },
    routes: {
      THOMAS_DOCK_ROUTE: "LOCKED",
    },
    attention: {
      watcherHeat: 0,
      clarkeInformed: false,
      recognized: false,
      politicalSympathy: false,
    },
    pendingContingentEffects: [],
    realizedHiddenEffects: [],
  };
}

export interface ClockAdvanceResult {
  crossedWarning: WarningStage | null;
  reachedBoundary: boolean;
}

// Advance the clock by `units`. Returns any newly-crossed warning and whether
// the fixed-event boundary was reached. Traversal (0) never advances.
export function advanceClock(world: WorldState, units: number): ClockAdvanceResult {
  if (units <= 0) return { crossedWarning: null, reachedBoundary: false };
  const before = world.clock.spentUnits;
  const after = before + units;
  world.clock.spentUnits = after;

  const prevStage = world.clock.warningStage;
  const newStage = warningStageForUnits(after);
  world.clock.phase = phaseForUnits(after);

  let crossedWarning: WarningStage | null = null;
  if (newStage !== prevStage && newStage !== "NONE") {
    world.clock.warningStage = newStage;
    crossedWarning = newStage;
  }

  const reachedBoundary =
    before < DAY1_CLOCK.fixedEventBoundary && after >= DAY1_CLOCK.fixedEventBoundary;

  return { crossedWarning, reachedBoundary };
}

export function bumpInteractionOrdinal(world: WorldState): number {
  world.currentInteractionOrdinal += 1;
  return world.currentInteractionOrdinal;
}
