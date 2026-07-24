import type {
  CitedConfrontationOption,
  FieldRepositionAnchor,
  MicroConceptId,
  OptionalActivityId,
  ThreadId,
} from "@pa/contracts";

// Boston field vocabulary: the chapter-owned id spaces the engine validates
// against (via ChapterDefinition.fieldVocabulary). Branded-id casts happen
// exactly once, here.

export const THREAD_IDS = {
  NED: "BOS.THREAD.NED.v1" as ThreadId,
  SARAH: "BOS.THREAD.SARAH.v1" as ThreadId,
} as const;

export const THREAD_STABLE_FLAGS = [
  "MET",
  "OPENED",
  "PRESENT",
  "FLED",
  "GONE",
  "NED_FETCHED_TYPE",
  "NED_COVERED_ERRAND",
  "NED_ENCOURAGED_CRAFT",
  "NED_ROPED_INTO_RUN",
  "NED_WAGER_ACCEPTED",
  "NED_WAGER_BEAT_BELL",
  "NED_WAGER_OUT_PRINT",
  "NED_WAGER_AVOID_STOP",
  "NED_WAGER_RESOLVED",
  "NED_WAGER_WON",
  "SARAH_BOUGHT_GOODS",
  "SARAH_HELPED_HAUL",
  "SARAH_HEARD_OUT",
] as const;

export const OPTIONAL_ACTIVITY_IDS = {
  TAVERN_NOTE: "SJ-tavern-note" as OptionalActivityId,
  DOCK_HAUL: "SJ-dock-haul" as OptionalActivityId,
  ROOF_KID: "SJ-roof-kid" as OptionalActivityId,
  CRIER: "SJ-crier" as OptionalActivityId,
  ROPEWALK: "SJ-ropewalk" as OptionalActivityId,
  AGITATOR_DARE: "CH-agitator-dare" as OptionalActivityId,
  ROOFTOP_RUN: "CH-rooftop-run" as OptionalActivityId,
  LOSE_WATCH: "CH-lose-the-watch" as OptionalActivityId,
} as const;

export const MICRO_CONCEPT_IDS = {
  SALUTARY_NEGLECT_END: "MICRO.SALUTARY_NEGLECT_END" as MicroConceptId,
  PORT_TOWN_BOSTON: "MICRO.PORT_TOWN_BOSTON" as MicroConceptId,
  HARD_COIN_SCARCITY: "MICRO.HARD_COIN_SCARCITY" as MicroConceptId,
  PRINTERS_ROLE: "MICRO.PRINTERS_ROLE" as MicroConceptId,
  VICE_ADMIRALTY_COURTS: "MICRO.VICE_ADMIRALTY_COURTS" as MicroConceptId,
  STAMP_WHAT_COUNTS: "MICRO.STAMP_WHAT_COUNTS" as MicroConceptId,
  ANDREW_OLIVER: "MICRO.ANDREW_OLIVER" as MicroConceptId,
  LIBERTY_TREE: "MICRO.LIBERTY_TREE" as MicroConceptId,
  LOYAL_NINE: "MICRO.LOYAL_NINE" as MicroConceptId,
  EFFIGY_PROTEST: "MICRO.EFFIGY_PROTEST" as MicroConceptId,
  NON_IMPORTATION: "MICRO.NON_IMPORTATION" as MicroConceptId,
  NEWS_NETWORKS: "MICRO.NEWS_NETWORKS" as MicroConceptId,
  WRITS_OF_ASSISTANCE: "MICRO.WRITS_OF_ASSISTANCE" as MicroConceptId,
  LOYALIST_VIEW: "MICRO.LOYALIST_VIEW" as MicroConceptId,
} as const;

export const STANDING_CAUSE_DELTAS = {
  NED_MET: 1,
  NED_TYPE_FETCH: 2,
  SARAH_BOUGHT_GOODS: 2,
  SARAH_HELPED_STALL: 3,
  CLARKE_INFORMED: -5,
  TAVERN_NOTE_DELIVERED: 4,
  DOCK_HAUL_COMPLETED: 4,
  ROPEWALK_COMPLETED: 4,
  ROOF_KID_COMPLETED: 3,
  CRIER_COMPLETED: 4,
  AGITATOR_DARE_COMPLETED: 6,
  ROOFTOP_RUN_COMPLETED: 3,
  LOSE_WATCH_COMPLETED: 4,
} as const;
export type StandingCauseId = keyof typeof STANDING_CAUSE_DELTAS;

export function standingDeltaForCause(cause: StandingCauseId): number {
  return STANDING_CAUSE_DELTAS[cause];
}

export const FIELD_REPOSITION_ANCHORS: Readonly<
  Record<string, FieldRepositionAnchor>
> = {
  INSPECTOR_OFFICE_RELEASE: {
    locationId: "BOSTON_STREET",
    reason: "RELEASE",
  },
};

/**
 * The authored cited-defense table (knowledge as ammunition). Keyed by the
 * durable micro that arms it; a confrontation offers the FIRST entry whose
 * micro the player has engaged (exactly one slot per confrontation,
 * Archive-Spec one-consideration rule).
 */
export const CITED_CONFRONTATION_DEFENSES: readonly CitedConfrontationOption[] = [
  {
    choice: "CITE",
    microConceptId: MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE,
    label: "Quote the writs procedure",
    line: "Your writ names no man and no house, officer. It is a general warrant — and a general warrant ends where a lawful errand begins.",
    reply: "…You know the paper better than most clerks. Go on, then — mind the street.",
  },
];
