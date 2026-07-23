import type { WorldState, WarningStage, DayPhase } from "@pa/contracts";

// Generic day-clock machinery. The initial WorldState (locations, objectives,
// job objects, relationships, clock tuning) is chapter content and arrives
// via ChapterDefinition.content.createInitialWorldState(); the warning
// thresholds live on world.clock.warningAt so replay projection depends only
// on the seeded state.

export interface ClockAdvanceResult {
  crossedWarnings: WarningStage[];
  reachedBoundary: boolean;
}

const WARNING_ORDER: WarningStage[] = ["FIRST", "SECOND", "FINAL"];

export function warningStageForUnits(
  spentUnits: number,
  warningAt: WorldState["clock"]["warningAt"],
): WarningStage {
  if (spentUnits >= warningAt.final) return "FINAL";
  if (spentUnits >= warningAt.second) return "SECOND";
  if (spentUnits >= warningAt.first) return "FIRST";
  return "NONE";
}

export function phaseForUnits(
  spentUnits: number,
  warningAt: WorldState["clock"]["warningAt"],
): DayPhase {
  if (spentUnits >= warningAt.final) return "DUSK";
  if (spentUnits >= warningAt.second) return "AFTERNOON";
  if (spentUnits >= warningAt.first) return "MIDDAY";
  return "MORNING";
}

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
  const newStage = warningStageForUnits(after, world.clock.warningAt);
  world.clock.phase = phaseForUnits(after, world.clock.warningAt);

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
    before < world.clock.fixedEventBoundary && after >= world.clock.fixedEventBoundary;

  return { crossedWarnings, reachedBoundary };
}

export function bumpInteractionOrdinal(world: WorldState): number {
  world.currentInteractionOrdinal += 1;
  return world.currentInteractionOrdinal;
}
