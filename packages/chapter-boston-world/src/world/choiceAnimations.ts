import type { AuthoredMotion } from "@pa/contracts";

// Mercer threshold approaches with an authored on-screen execution
// (EntryDirector). Absent for every other choice.
export type EntryApproach = "KNOCK" | "WALK_IN" | "LOOK_FIRST";

export interface ChoiceAnimation {
  motion: AuthoredMotion;
  durationMs: number;
  doorTargetId?: string;
  // Which EntryDirector execution to stage during the window.
  entry?: EntryApproach;
  // How long the door stays shut into the execution (raps land first,
  // the window peek holds first). 0 = swing immediately.
  doorDelayMs?: number;
}

export function choiceAnimationFor(choiceId: string): ChoiceAnimation {
  if (choiceId === "KNOCK") {
    return {
      motion: "GESTURE",
      durationMs: 4200,
      doorTargetId: "MERCER_PRESS",
      entry: "KNOCK",
      doorDelayMs: 2550,
    };
  }
  if (choiceId === "WALK_IN") {
    return {
      motion: "WALK",
      durationMs: 6400,
      doorTargetId: "MERCER_PRESS",
      entry: "WALK_IN",
      doorDelayMs: 1150,
    };
  }
  if (choiceId === "LOOK_FIRST") {
    return {
      motion: "READ",
      durationMs: 6500,
      doorTargetId: "MERCER_PRESS",
      entry: "LOOK_FIRST",
      doorDelayMs: 1850,
    };
  }
  // Every other action is executed by the next authored mechanic, travel leg,
  // or dialogue beat. Playing a generic clip before advancing made choices
  // feel like loading screens and duplicated the real action.
  return { motion: "IDLE", durationMs: 0 };
}
