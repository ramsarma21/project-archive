// Day 1 global constants, verbatim from docs/archive/2026-07/Localhost-Text-Slice-Spec.md §16.

export const DAY1_CLOCK = {
  start: 0,
  firstWarning: 14,
  secondWarning: 19,
  finalWarning: 22,
  fixedEventBoundary: 24,
} as const;

export const RELATIONSHIP_RANGE = { min: 0, max: 100 } as const;

export const BASELINES = {
  abigailTrust: 35,
  abigailRespect: 35,
  abigailWarmth: 35,
  thomasObligation: 0,
  pikeRespect: 35,
  clarkePoliticalRead: 0,
  riderTrust: 35,
} as const;

export const SYNC_RULES = {
  minimumInteractionsBetweenSyncs: 2,
  initialUnderstandingReexposureCycles: 1,
  maximumCorrectionSteps: 2,
} as const;

export const REDIRECT_RULES = {
  textFreeRoamContinuesBeforeRedirect: 1,
  threeJsGraceSeconds: 7,
} as const;

// Standard time costs (spec §16). An ActionSpec binds one explicitly.
export const TIME_COST = {
  traversal: 0,
  neutralContinue: 0,
  shortDialogue: 1,
  focusRead: 1,
  archiveSyncQuestion: 1,
  simpleHandoff: 1,
  effortInteraction: 2,
  gradedPressPull: 2,
  longHelp: 3,
  fullReprintLoop: 5,
  waitForGap: 2,
  quickHandoff: 1,
} as const;

export type WarningStage = "NONE" | "FIRST" | "SECOND" | "FINAL";
export type DayPhase = "MORNING" | "MIDDAY" | "AFTERNOON" | "DUSK";

export function warningStageForUnits(spentUnits: number): WarningStage {
  if (spentUnits >= DAY1_CLOCK.finalWarning) return "FINAL";
  if (spentUnits >= DAY1_CLOCK.secondWarning) return "SECOND";
  if (spentUnits >= DAY1_CLOCK.firstWarning) return "FIRST";
  return "NONE";
}

export function phaseForUnits(spentUnits: number): DayPhase {
  if (spentUnits >= DAY1_CLOCK.finalWarning) return "DUSK";
  if (spentUnits >= DAY1_CLOCK.secondWarning) return "AFTERNOON";
  if (spentUnits >= DAY1_CLOCK.firstWarning) return "MIDDAY";
  return "MORNING";
}
