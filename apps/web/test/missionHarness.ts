import { LEARNING_MODULE_SECONDS } from "@pa/contracts";
import type { CollisionWorld, Platform } from "@pa/engine-world";
import type { LearningModuleDefinition } from "../src/module/moduleFormat.js";
import {
  completeModuleRun,
  type MissionAttemptTally,
  type ModuleRunCompletion,
} from "../src/module/moduleGate.js";
import type { MissionDuelBrief, MissionDuelReport } from "../src/mission/duelPort.js";
import type {
  MissionBeatMount,
  MissionCivilian,
  MissionCrowdCluster,
  MissionFailure,
  MissionFieldRead,
  MissionInstance,
  MissionObjective,
  MissionPlayerRead,
} from "../src/mission/levelPort.js";
import type { MissionDefinition } from "../src/mission/missionFormat.js";
import type { MissionSessionEnv } from "../src/mission/session.js";

// Fixtures for the mission container's tests. Deliberately minimal: a one-card
// module, a flat world, and a level whose predicates the test writes itself, so a
// test asserts the container's rules rather than M1's content.

export const TEST_CHAPTER = "boston-1765";
export const TEST_MISSION = "m1";
export const TEST_BASE_XP = 100;

export function testModule(
  missionId = TEST_MISSION,
): LearningModuleDefinition {
  return {
    moduleId: `${missionId}.MODULE`,
    chapterId: TEST_CHAPTER,
    missionId,
    title: "Test module",
    subtitle: "One card, so the deck is coverable in a line of test code.",
    cards: [
      {
        id: "card-1",
        cueId: "CUE.ONE",
        throughSeconds: LEARNING_MODULE_SECONDS,
        kicker: "Only card",
        body: ["The one proposition."],
        conceptIds: ["CONCEPT.ONE"],
        codexCardIds: [],
        advanceLabel: "Enter",
      },
    ],
  };
}

/** A completion for one attempt, minted the way the module player mints it. */
export function testCompletion(
  attemptOrdinal: number,
  missionId = TEST_MISSION,
): ModuleRunCompletion {
  const completion = completeModuleRun({
    definition: testModule(missionId),
    attemptOrdinal,
    acknowledgedCueIds: ["CUE.ONE"],
    observedSeconds: 174,
    at: "2026-07-25T12:00:00.000Z",
  });
  if (!completion) throw new Error("the fixture module deck did not complete");
  return completion;
}

const GROUND: Platform = {
  id: "GROUND",
  minX: -60,
  maxX: 60,
  minZ: -60,
  maxZ: 60,
  y: 0,
  tags: new Set<string>(),
};

export function testWorld(): CollisionWorld {
  return {
    blockers: [],
    platforms: [GROUND],
    bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
  };
}

export function testDuelBrief(): MissionDuelBrief {
  return {
    duelId: "duel-test",
    seed: 1234,
    rounds: 6,
    world: testWorld(),
    opponent: { kind: "BOSS", profile: { bossId: "test-boss" } },
    questions: [1, 2, 3, 4, 5, 6],
    placement: {
      A: { pos: { x: 0, y: 0, z: -4 }, yaw: 0 },
      B: { pos: { x: 0, y: 0, z: 4 }, yaw: Math.PI },
    },
    conceptIds: ["CONCEPT.ONE"],
  };
}

export interface TestInstanceOptions {
  missionId?: string;
  attemptOrdinal?: number;
  briefing?: MissionInstance["briefing"];
  spawn?: MissionInstance["spawn"];
  objectives?: readonly MissionObjective[];
  beat?: MissionBeatMount;
  failWhen?: (read: MissionPlayerRead, field: MissionFieldRead) => MissionFailure | null;
  traversalTimeoutS?: number | null;
  onDispose?: () => void;
  crowdClusters?: readonly MissionCrowdCluster[];
  civilians?: readonly MissionCivilian[];
  watcherIds?: readonly string[];
  watcherPosesAtTick?: MissionInstance["watcherPosesAtTick"];
  world?: CollisionWorld;
  traversalBudgetS?: number;
}

/** A civilian at a point, standing, with the fields the port requires. */
export function testCivilian(
  id: string,
  x: number,
  z: number,
  options: { clusterId?: string | null; capsuleHeight?: number } = {},
): MissionCivilian {
  return {
    id,
    clusterId: options.clusterId ?? null,
    pos: { x, y: 0, z },
    capsuleHeight: options.capsuleHeight ?? 1.55,
    yaw: 0,
    rigKey: "playerboy-rigged",
  };
}

/** A level instance whose behaviour the test supplies. */
export function testInstance(options: TestInstanceOptions = {}): MissionInstance {
  const civilians = options.civilians ?? [];
  const instance: MissionInstance = {
    missionId: options.missionId ?? TEST_MISSION,
    attemptOrdinal: options.attemptOrdinal ?? 1,
    world: options.world ?? testWorld(),
    spawn: options.spawn ?? { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    briefing: options.briefing ?? null,
    traversalBudgetS: options.traversalBudgetS ?? 180,
    traversalTimeoutS: options.traversalTimeoutS ?? null,
    // A level always has at least one required objective; the default one is
    // simply never reached, so a test that only wants the clock gets a run that
    // does not end under it.
    objectives:
      options.objectives ?? [tickObjective("reach-post", Number.MAX_SAFE_INTEGER)],
    receivingTargets: [],
    watcherIds: options.watcherIds ?? [],
    watcherPosesAtTick: options.watcherPosesAtTick ?? (() => []),
    crowdClusters: options.crowdClusters ?? [],
    civiliansAtTick: () => civilians,
    duel: testDuelBrief(),
    Scenery: null,
    dispose: () => options.onDispose?.(),
    ...(options.beat ? { beat: options.beat } : {}),
  };
  return options.failWhen ? { ...instance, failWhen: options.failWhen } : instance;
}

export interface TestDefinitionOptions {
  missionId?: string;
  baseXp?: number;
  instance?: MissionInstance;
  load?: MissionDefinition["load"];
}

export function testDefinition(
  options: TestDefinitionOptions = {},
): MissionDefinition {
  const missionId = options.missionId ?? TEST_MISSION;
  return {
    missionId,
    chapterId: TEST_CHAPTER,
    title: "Nailed to the Post",
    baseXp: options.baseXp ?? TEST_BASE_XP,
    moduleId: `${missionId}.MODULE`,
    conceptIds: ["CONCEPT.ONE"],
    load:
      options.load ??
      (async () => options.instance ?? testInstance({ missionId })),
  };
}

export interface TestEnvOptions {
  definition?: MissionDefinition | undefined;
  module?: LearningModuleDefinition | undefined;
  unlocked?: boolean;
  now?: string;
  /** True to make the attempt server-opened. Default is unranked practice. */
  ranked?: boolean;
  /** Resolved attempts as a snapshot reports them. */
  serverTallies?: Readonly<Record<string, MissionAttemptTally>>;
}

let attemptCounter = 0;

export function testEnv(options: TestEnvOptions = {}): MissionSessionEnv {
  const definition =
    "definition" in options ? options.definition : testDefinition();
  const module = "module" in options ? options.module : testModule();
  return {
    chapterId: TEST_CHAPTER,
    isUnlocked: () => options.unlocked ?? true,
    moduleFor: () => module,
    definitionFor: () => definition,
    now: options.now ?? "2026-07-25T12:00:00.000Z",
    newAttemptId: () => `attempt-${(attemptCounter += 1)}`,
    profileSeedHex: null,
    authorizesAttempts: options.ranked ?? false,
    serverTallies: options.serverTallies ?? {},
  };
}

export function testDuelReport(won: boolean): MissionDuelReport {
  return {
    won,
    outcome: {
      winner: won ? "A" : "B",
      reason: "KNOCKOUT",
      healthA: won ? 44 : 0,
      healthB: won ? 0 : 38,
      tiebreak: "NONE",
    },
    rounds: [
      { round: 1, itemId: "i1", conceptId: "CONCEPT.ONE", verdict: "CORRECT", bullets: 3 },
      { round: 2, itemId: "i2", conceptId: "CONCEPT.ONE", verdict: "WRONG", bullets: 1 },
    ],
    engagementSeconds: 120,
    committedEvents: [{ type: "DUEL_RESOLVED" }],
  };
}

/** An objective met once the run has been going for `afterTicks` fixed steps. */
export function tickObjective(
  id: string,
  afterTicks: number,
  required = true,
): MissionObjective {
  return {
    id,
    label: id,
    required,
    satisfiedBy: (read) => read.tick >= afterTicks,
  };
}
