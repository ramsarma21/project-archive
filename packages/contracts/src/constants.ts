// Protocol-level clock/relationship machinery. Chapter tuning (clock
// thresholds, baselines, sync spacing, time costs) is chapter content: it is
// seeded into WorldState by ChapterDefinition.content.createInitialWorldState
// and read from there by the engine.

export const RELATIONSHIP_RANGE = { min: 0, max: 100 } as const;

export type WarningStage = "NONE" | "FIRST" | "SECOND" | "FINAL";
export type DayPhase = "MORNING" | "MIDDAY" | "AFTERNOON" | "DUSK";
