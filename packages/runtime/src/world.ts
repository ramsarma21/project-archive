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
      // The plain wrap is the concealment tool, not contraband: it rides
      // folded away (HIDDEN) so a customs inspection never reads it as an
      // exposed carried good. Without this, COMPLIED_CLEAR is unreachable.
      PLAIN_WRAP: { custody: "ABIGAIL", condition: "INTACT", concealment: "HIDDEN" },
      TAVERN_NOTE: { custody: "THOMAS", condition: "INTACT", concealment: "HIDDEN" },
      DOCK_BARREL: { custody: "DOCKHAND", condition: "INTACT", concealment: "EXPOSED" },
      FINAL_PAGE: { custody: "ABIGAIL", condition: "UNPRINTED" },
    },
    printJobs: {},
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
  crossedWarnings: WarningStage[];
  reachedBoundary: boolean;
}

const WARNING_ORDER: WarningStage[] = ["FIRST", "SECOND", "FINAL"];

// Advance the clock by `units`. Returns every newly-crossed warning, in order,
// and whether the fixed-event boundary was reached. Traversal (0) never
// advances. A large single cost can cross several thresholds at once; each
// warning must still be voiced so time pressure never silently skips a stage.
export function advanceClock(world: WorldState, units: number): ClockAdvanceResult {
  if (units <= 0) return { crossedWarnings: [], reachedBoundary: false };
  const before = world.clock.spentUnits;
  const after = before + units;
  world.clock.spentUnits = after;

  const prevStage = world.clock.warningStage;
  const newStage = warningStageForUnits(after);
  world.clock.phase = phaseForUnits(after);

  const crossedWarnings: WarningStage[] = [];
  if (newStage !== prevStage && newStage !== "NONE") {
    const prevIndex = WARNING_ORDER.indexOf(prevStage);
    const newIndex = WARNING_ORDER.indexOf(newStage);
    for (let i = prevIndex + 1; i <= newIndex; i += 1) {
      crossedWarnings.push(WARNING_ORDER[i]!);
    }
    world.clock.warningStage = newStage;
  }

  const reachedBoundary =
    before < DAY1_CLOCK.fixedEventBoundary && after >= DAY1_CLOCK.fixedEventBoundary;

  return { crossedWarnings, reachedBoundary };
}

export function bumpInteractionOrdinal(world: WorldState): number {
  world.currentInteractionOrdinal += 1;
  return world.currentInteractionOrdinal;
}
