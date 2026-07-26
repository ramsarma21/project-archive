// ---------------------------------------------------------------------------
// The mission container's public surface.
//
// Three audiences, and the surface is deliberately different for each.
//
//   THE HUB needs two things: `useMissionSession` and `MissionDeck`. It holds one
//   object, renders one component, and hands `requestDeploy` to its Deploy button.
//   It cannot reach a ticket, a runtime, or an XP calculation from here.
//
//   A MISSION LEVEL needs `registerMission` and the types in ./levelPort. It
//   supplies data, predicates and its own imported art; it never gets a loop.
//
//   THE DUEL VIEW needs `registerDuelView` and the types in ./duelPort.
//
// Everything else — the session machine, the attempt ticket, the traversal
// runtime, the result derivation — is exported for tests and for the two views
// that live in here, not because a fourth caller should be reaching for it.
// ---------------------------------------------------------------------------

// The hub's surface.
export { useMissionSession } from "./useMissionSession.js";
export type {
  MissionSessionApi,
  MissionSessionOptions,
} from "./useMissionSession.js";
export { MissionDeck } from "./MissionDeck.js";
export { MissionRun } from "./MissionRun.js";

// The level author's surface.
export {
  clearMissionRegistry,
  missionDefinition,
  missionDefinitionDefects,
  registerMission,
  registeredMissionIds,
} from "./missionFormat.js";
export type { MissionDefinition, MissionLoadContext } from "./missionFormat.js";
export { missionInstanceDefects } from "./levelPort.js";
export type {
  MissionBeatMount,
  MissionBriefing,
  MissionCivilian,
  MissionCrowdCluster,
  MissionFailure,
  MissionFieldRead,
  MissionInstance,
  MissionObjective,
  MissionPlayerRead,
} from "./levelPort.js";
/**
 * A dev fixture and a worked example of the port above. Not registered anywhere;
 * see the file for what registering it buys and when to stop.
 */
export { smokeMissionDefinition } from "./smokeMission.js";

// The duel view author's surface.
export {
  clearDuelView,
  duelSurfaceMode,
  duelView,
  registerDuelView,
} from "./duelPort.js";
export type {
  DuelSurfaceMode,
  DuelSideId,
  MissionDuelBrief,
  MissionDuelOutcome,
  MissionDuelReport,
  MissionDuelRoundReport,
  MissionDuelView,
  MissionDuelViewProps,
} from "./duelPort.js";

// The machine, the ticket, the runtime and the result. Tests and the container.
export {
  MISSION_BLOCK_COPY,
  initialMissionSession,
  missionBlockForRefusal,
  missionSessionIsForeground,
  missionTally,
  reduceMission,
  sessionInstance,
} from "./session.js";
export type {
  MissionBlock,
  MissionCommand,
  MissionEffect,
  MissionPhaseName,
  MissionPhaseState,
  MissionReduceResult,
  MissionSession,
  MissionSessionEnv,
} from "./session.js";
export {
  attemptChildSeed,
  attemptOpening,
  attemptSeed,
  attemptSeedHex,
  openAttempt,
} from "./attempt.js";
export type {
  AttemptGrant,
  MissionAttemptOpening,
  MissionAttemptTicket,
  ServerAttemptGrant,
} from "./attempt.js";
export { deriveMissionResult } from "./result.js";
export type {
  MissionAchievement,
  MissionKnowledgeSummary,
  MissionResult,
  MissionTiming,
  MissionTraversalObservation,
  MissionTraversalOutcome,
} from "./result.js";
export {
  createMissionRuntime,
  disposeMissionRuntime,
  missionCrowdParity,
  missionObservation,
  missionPresentation,
  stepMissionRuntime,
  throwMissionDiversion,
} from "./traversal.js";
export type {
  MissionInputFrame,
  MissionObjectiveReadout,
  MissionPresentation,
  MissionRuntime,
  MissionRuntimeEvent,
  MissionRuntimeStep,
} from "./traversal.js";
export {
  MISSION_BINDINGS,
  MISSION_LEGEND,
  attachMissionInput,
  clearMissionInput,
  createMissionInputState,
} from "./missionInput.js";
export type { MissionAction, MissionInputState } from "./missionInput.js";
