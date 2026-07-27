import {
  MAX_MISSION_ATTEMPTS,
  isMissionPermanentlySpent,
  moduleDeckCovered,
  nextAttemptOrdinal,
  type MissionOutcome,
} from "@pa/contracts";
import {
  moduleRequiredCheckIds,
  type LearningModuleDefinition,
} from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// The module gate.
//
// A player cannot reach a mission without completing its module, and a retry
// must redo it. Those are one rule, not two: a completion is scoped to a single
// ATTEMPT ORDINAL. Nothing in this file is keyed by mission alone, so a retry
// re-arming the gate falls out of the key rather than needing its own branch —
// attempt 2 simply finds no completion for attempt 2.
//
// The gate is structural rather than advisory. `deployDecision` is the only
// producer of an ENTER_MISSION decision, and it produces one only when the
// ledger holds a completion for the exact ordinal about to be opened. A caller
// that forgets to check the gate cannot get a mission id out of this module, so
// forgetting is not a failure mode that ships.
//
// It also fails closed. A mission with no authored module is BLOCKED, never
// waved through: thirteen of the fourteen modules are unwritten, and the wrong
// direction to be wrong in is the one that skips teaching.
//
// This is session state. The durable rows are LearningModuleCompletion and
// MissionAttempt in @pa/contracts and persisting them is a separate work item;
// the shapes here are deliberately subsets of those, so adopting them is a swap
// rather than a redesign.
// ---------------------------------------------------------------------------

/** The attempt counters the gate reads: a subset of contracts' MissionProgress. */
export interface MissionAttemptTally {
  missionId: string;
  /** Resolved attempts. A live attempt is not counted until it ends. */
  attemptsUsed: number;
  outcome: MissionOutcome;
}

export function newMissionTally(missionId: string): MissionAttemptTally {
  return { missionId, attemptsUsed: 0, outcome: "UNSTARTED" };
}

/**
 * One completed module run.
 *
 * `awardedXp` is the literal `0`, not a number: the type itself refuses the
 * small encouraging reward that §1.5 says was decided against twice.
 *
 * `observedSeconds` is recorded and reported and is never a gate condition. The
 * three minutes are a presentation target, so a student who reads faster than
 * the target is finished, and a student who reads slower is not being timed.
 */
export interface ModuleRunCompletion {
  moduleId: string;
  missionId: string;
  /** The attempt this completion opens, and only that one. */
  attemptOrdinal: number;
  /** Cue ids acknowledged. Every card in the deck must appear. */
  acknowledgedCueIds: readonly string[];
  /**
   * Mastery-check ids the learner answered correctly. Every check the deck
   * requires must appear, or the run does not complete. The server re-derives
   * the required set from module metadata rather than trusting these, so this
   * is evidence the client offers, not a claim the server accepts on faith.
   */
  acknowledgedCheckIds: readonly string[];
  observedSeconds: number;
  completedAt: string;
  awardedXp: 0;
}

/** Completions for this session, one per (mission, attempt ordinal) at most. */
export interface ModuleGateLedger {
  readonly completions: readonly ModuleRunCompletion[];
}

export const EMPTY_MODULE_GATE_LEDGER: ModuleGateLedger = { completions: [] };

/**
 * Whether a run covered the deck.
 *
 * Order-independent, because going back to re-read a card is allowed and must
 * not cost the student the cards already read: acknowledgement is a high-water
 * mark over cue ids and not a cursor position.
 *
 * The rule itself is @pa/contracts' `moduleDeckCovered`, not a second copy of
 * it. The server decides the same question about the same completion row, and an
 * order-independence that held in one place and not the other would deny the
 * mission to a student the client had already let through.
 */
export function moduleRunIsComplete(
  definition: LearningModuleDefinition,
  acknowledgedCueIds: readonly string[],
): boolean {
  return moduleDeckCovered(
    definition.cards.map((card) => card.cueId),
    acknowledgedCueIds,
  );
}

/** Cue ids in the deck that a run has not covered yet. */
export function unacknowledgedCueIds(
  definition: LearningModuleDefinition,
  acknowledgedCueIds: readonly string[],
): string[] {
  const acknowledged = new Set(acknowledgedCueIds);
  return definition.cards
    .filter((card) => !acknowledged.has(card.cueId))
    .map((card) => card.cueId);
}

/**
 * Whether a run mastered every check the deck requires. Order-independent, the
 * same as deck coverage: a student who went back and re-read a concept keeps
 * the check they already cleared. A deck with no checks is satisfied trivially.
 */
export function moduleRunChecksMastered(
  definition: LearningModuleDefinition,
  acknowledgedCheckIds: readonly string[],
): boolean {
  const mastered = new Set(acknowledgedCheckIds);
  return moduleRequiredCheckIds(definition).every((id) => mastered.has(id));
}

/** Required check ids the run has not mastered yet. */
export function unmasteredCheckIds(
  definition: LearningModuleDefinition,
  acknowledgedCheckIds: readonly string[],
): string[] {
  const mastered = new Set(acknowledgedCheckIds);
  return moduleRequiredCheckIds(definition).filter((id) => !mastered.has(id));
}

/**
 * A completion for a finished run, or null if the deck is not covered. The
 * player cannot mint one by asserting it finished; it has to pass the cue set.
 */
export function completeModuleRun(input: {
  definition: LearningModuleDefinition;
  attemptOrdinal: number;
  acknowledgedCueIds: readonly string[];
  /** Checks the run mastered. Omitted defaults to none, which fails a deck
   * that requires any check — the honest degradation for a caller that has not
   * been updated to carry check evidence. */
  acknowledgedCheckIds?: readonly string[];
  observedSeconds: number;
  at: string;
}): ModuleRunCompletion | null {
  if (!moduleRunIsComplete(input.definition, input.acknowledgedCueIds)) return null;
  const acknowledgedCheckIds = input.acknowledgedCheckIds ?? [];
  // Completion requires all cues acknowledged AND all required checks mastered.
  // A deck with no checks passes this trivially, so the flat-module path is
  // unchanged.
  if (!moduleRunChecksMastered(input.definition, acknowledgedCheckIds)) return null;
  if (!Number.isInteger(input.attemptOrdinal) || input.attemptOrdinal < 1) return null;
  return {
    moduleId: input.definition.moduleId,
    missionId: input.definition.missionId,
    attemptOrdinal: input.attemptOrdinal,
    acknowledgedCueIds: [...input.acknowledgedCueIds],
    acknowledgedCheckIds: [...acknowledgedCheckIds],
    observedSeconds: Math.max(0, Math.floor(input.observedSeconds)),
    completedAt: input.at,
    awardedXp: 0,
  };
}

export function findModuleCompletion(
  ledger: ModuleGateLedger,
  missionId: string,
  attemptOrdinal: number,
): ModuleRunCompletion | undefined {
  return ledger.completions.find(
    (entry) =>
      entry.missionId === missionId && entry.attemptOrdinal === attemptOrdinal,
  );
}

/** Records a completion, replacing any earlier one for the same attempt. */
export function recordModuleCompletion(
  ledger: ModuleGateLedger,
  completion: ModuleRunCompletion,
): ModuleGateLedger {
  return {
    completions: [
      ...ledger.completions.filter(
        (entry) =>
          entry.missionId !== completion.missionId ||
          entry.attemptOrdinal !== completion.attemptOrdinal,
      ),
      completion,
    ],
  };
}

/**
 * Closes out an attempt. The local stand-in for the server reducer that owns
 * the real transition — deliberately only the counter and the outcome, because
 * XP is derived from the ordinal in @pa/contracts and must not be computed
 * twice.
 */
export function recordAttemptResolved(
  tally: MissionAttemptTally,
  outcome: "CLEARED" | "FAILED",
): MissionAttemptTally {
  const attemptsUsed = Math.min(MAX_MISSION_ATTEMPTS, tally.attemptsUsed + 1);
  return {
    missionId: tally.missionId,
    attemptsUsed,
    outcome:
      outcome === "CLEARED"
        ? "CLEARED"
        : attemptsUsed >= MAX_MISSION_ATTEMPTS
          ? "FAILED_PERMANENT"
          : "IN_PROGRESS",
  };
}

export type DeployBlock = "MISSION_LOCKED" | "MISSION_SPENT" | "MODULE_MISSING";

/**
 * What pressing Deploy does. Three outcomes and no fourth: run the module,
 * enter the mission, or explain why neither is possible.
 */
export type DeployDecision =
  | {
      kind: "RUN_MODULE";
      definition: LearningModuleDefinition;
      attemptOrdinal: number;
    }
  | {
      kind: "ENTER_MISSION";
      missionId: string;
      attemptOrdinal: number;
      /** The completion that opened this attempt. The gate's receipt. */
      completion: ModuleRunCompletion;
    }
  | { kind: "BLOCKED"; reason: DeployBlock };

/**
 * The gate. Every route into a mission runs through here.
 *
 * Note what the module completing does NOT do: it does not launch anything. A
 * caller records the completion and asks again, and this function is what
 * decides. That keeps one answer to "may this player be in a mission" instead
 * of one at Deploy and a second at the end of the module.
 */
export function deployDecision(input: {
  ledger: ModuleGateLedger;
  tally: MissionAttemptTally;
  /** False for a mission the route has not opened yet. */
  unlocked: boolean;
  definition: LearningModuleDefinition | undefined;
}): DeployDecision {
  if (!input.unlocked) return { kind: "BLOCKED", reason: "MISSION_LOCKED" };

  const attemptOrdinal = nextAttemptOrdinal(input.tally);
  if (attemptOrdinal === null || isMissionPermanentlySpent(input.tally)) {
    return { kind: "BLOCKED", reason: "MISSION_SPENT" };
  }

  const definition = input.definition;
  if (!definition) return { kind: "BLOCKED", reason: "MODULE_MISSING" };

  const completion = findModuleCompletion(
    input.ledger,
    input.tally.missionId,
    attemptOrdinal,
  );
  if (!completion) return { kind: "RUN_MODULE", definition, attemptOrdinal };

  return {
    kind: "ENTER_MISSION",
    missionId: input.tally.missionId,
    attemptOrdinal,
    completion,
  };
}

/**
 * True when the player may be inside the mission right now. Reads the same
 * decision the Deploy button does, so a second surface cannot disagree with it.
 */
export function canEnterMission(input: {
  ledger: ModuleGateLedger;
  tally: MissionAttemptTally;
  unlocked: boolean;
  definition: LearningModuleDefinition | undefined;
}): boolean {
  return deployDecision(input).kind === "ENTER_MISSION";
}
