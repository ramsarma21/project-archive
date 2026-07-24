import type { WorldState } from "@pa/contracts";
import { BASELINES, DAY1_CLOCK } from "./tuning.js";

// The Boston Day-1 initial world: locations, objectives, job objects,
// relationship baselines, routes, and the day-clock tuning. Chapter content —
// the engine receives it via ChapterDefinition.content.createInitialWorldState.
export function createBostonWorldState(): WorldState {
  return {
    revision: "0",
    locationId: "ARCHIVE_TRANSIT",
    controlState: "ARCHIVE",
    clock: {
      spentUnits: 0,
      fixedEventBoundary: DAY1_CLOCK.fixedEventBoundary,
      warningAt: {
        first: DAY1_CLOCK.firstWarning,
        second: DAY1_CLOCK.secondWarning,
        final: DAY1_CLOCK.finalWarning,
      },
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
    printWorkshop: {
      sheetsPulled: 0,
      sheetsBeforeBell: 0,
      bestQuality: null,
      bestAverage: 0,
      bestPromptId: null,
    },
    relationships: {
      ABIGAIL_TRUST: BASELINES.abigailTrust,
      ABIGAIL_RESPECT: BASELINES.abigailRespect,
      ABIGAIL_WARMTH: BASELINES.abigailWarmth,
      THOMAS_OBLIGATION: BASELINES.thomasObligation,
      PIKE_RESPECT: BASELINES.pikeRespect,
      CLARKE_POLITICAL_READ: BASELINES.clarkePoliticalRead,
      RIDER_TRUST: BASELINES.riderTrust,
      NED_CLEANUP_CREDIT: 0,
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
