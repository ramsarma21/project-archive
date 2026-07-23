// Day 1 global constants, verbatim from docs/archive/2026-07/Localhost-Text-Slice-Spec.md §16.
// Chapter tuning: consumed by the Boston flow/content and injected into the
// engine through the ChapterDefinition (never imported by the engine).

export const DAY1_CLOCK = {
  start: 0,
  firstWarning: 14,
  secondWarning: 19,
  finalWarning: 22,
  fixedEventBoundary: 24,
} as const;

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
