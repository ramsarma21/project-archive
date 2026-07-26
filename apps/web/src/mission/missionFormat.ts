import type { MissionInstance } from "./levelPort.js";

// ---------------------------------------------------------------------------
// The mission definition and the registry.
//
// A mission is DATA plus a loader. Fourteen of them ship in Boston and none of
// them is a component: the container renders every mission, and what differs
// between them arrives as a registered definition. Adding M2 is a
// `registerMission` call and a level package, never a change in here.
//
// The registry fails closed. An unregistered mission cannot be deployed to, and
// the container reports that rather than mounting an empty instance — thirteen
// of the fourteen levels do not exist yet, and the wrong direction to be wrong
// in is the one that launches nothing and calls it a mission.
// ---------------------------------------------------------------------------

/**
 * What a loader is told about the attempt it is building for.
 *
 * The seed is the container's, projected once per attempt from the chapter, the
 * mission and the ordinal. A level uses it to pick its authored patrol phases,
 * obstacle states and precision patterns; it must never seed itself, because two
 * seeds would let a replay disagree with the run it is replaying.
 */
export interface MissionLoadContext {
  readonly missionId: string;
  readonly chapterId: string;
  readonly attemptOrdinal: number;
  /** 32-bit seed for the shared field clock. */
  readonly seed: number;
  /** The same seed as the 128-bit hex the durable attempt row stores. */
  readonly seedHex: string;
  readonly attemptId: string;
  /** Aborted when the player leaves before the load finishes. */
  readonly signal: AbortSignal;
}

export interface MissionDefinition {
  readonly missionId: string;
  readonly chapterId: string;
  readonly title: string;
  /**
   * The authored full award. Only attempt 1 pays it whole — the two-thirds and
   * one-third shares are derived in @pa/contracts from the ordinal, and are
   * deliberately not expressible here.
   */
  readonly baseXp: number;
  /** The module that gates every attempt. Identity only; the deck lives in ../module. */
  readonly moduleId: string;
  readonly conceptIds: readonly string[];
  /** Builds the instance for one attempt. Async so a mission is code-split. */
  load(context: MissionLoadContext): Promise<MissionInstance>;
}

const registry = new Map<string, MissionDefinition>();

/** Everything wrong with a definition, as sentences. */
export function missionDefinitionDefects(definition: MissionDefinition): string[] {
  const defects: string[] = [];
  if (definition.missionId.trim() === "") defects.push("the mission has no id");
  if (definition.chapterId.trim() === "") defects.push("the mission has no chapter");
  if (definition.title.trim() === "") defects.push("the mission has no title");
  if (definition.moduleId.trim() === "") {
    defects.push("the mission names no gating module");
  }
  if (!Number.isInteger(definition.baseXp) || definition.baseXp < 0) {
    defects.push(`baseXp ${definition.baseXp} is not a non-negative integer`);
  }
  if (definition.conceptIds.length === 0) {
    defects.push("the mission covers no concepts");
  }
  return defects;
}

/**
 * Registers a mission. A later call for the same id replaces the earlier one,
 * so a hot reload cannot leave two definitions fighting over a mission.
 *
 * A defective definition is refused outright rather than registered and warned
 * about: a mission with no base award or no gating module is a content bug that
 * should surface at boot, not as a zero-XP clear in playtest.
 */
export function registerMission(definition: MissionDefinition): void {
  const defects = missionDefinitionDefects(definition);
  if (defects.length > 0) {
    throw new Error(
      `mission ${definition.missionId || "(unnamed)"} cannot be registered: ${defects.join("; ")}`,
    );
  }
  registry.set(definition.missionId, definition);
}

export function missionDefinition(missionId: string): MissionDefinition | undefined {
  return registry.get(missionId);
}

export function registeredMissionIds(): string[] {
  return [...registry.keys()];
}

/** Test seam. Production registers at import time and never clears. */
export function clearMissionRegistry(): void {
  registry.clear();
}
