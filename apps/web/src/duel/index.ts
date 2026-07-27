// The visible duel.
//
// `packages/duel` is the fight. This is what it looks like: a mountable screen, the
// runtime that holds one DuelState and projects it for rendering, and the seams a
// mission (or PvP) fills in — an arena, an opponent source, a question supply, a
// grading authority and a content source.
//
// What a caller needs is `DuelScreen` plus a `DuelDescriptor`. Everything else is
// exported because the mission container, PvP transport and asset QA each need one
// piece of it.

export { DuelScreen, bossOpponent, type DuelDescriptor, type DuelScreenProps } from "./DuelScreen.js";
export { DuelStage, type DuelStageProps } from "./DuelStage.js";
export { DuelActor, DEFAULT_GRIP, type GripTuning } from "./DuelActor.js";

export {
  createDuelRuntime,
  hitsToFall,
  interpolatedProjectile,
  lerpPose,
  phaseProgressSeconds,
  type ActorPose,
  type DuelCues,
  type DuelHud,
  type DuelImpact,
  type DuelRuntime,
  type DuelRuntimeInput,
  type PoseFrame,
} from "./duelRuntime.js";

export {
  createDuelInput,
  duelControls,
  intentFrom,
  moveVector,
  DUEL_CONTROLS,
  type DuelInputController,
} from "./duelInput.js";

export {
  GRADING_CAP_MS,
  VERDICT_RECEIPT_HEADER,
  alternatingVerdicts,
  attachVerdictReceipts,
  createStandInVerdictAuthority,
  duelVerdictEndpoint,
  httpVerdictAuthority,
  type VerdictAuthority,
  type VerdictReceipt,
  type VerdictRequest,
  type VerdictResult,
} from "./duelGrading.js";

export {
  M1_ITEM_SOURCE,
  m1QuestionBank,
  missingItemContent,
  questionSpeaker,
  type DuelItemContent,
  type DuelItemSource,
} from "./duelItems.js";

export {
  M1_BOSS_ID,
  M1_DUEL_ID,
  OFFICER_RIG,
  PLAYER_RIG,
  m1DuelDescriptor,
  type M1DuelOptions,
} from "./m1Duel.js";

// The join with the mission container. `installMissionDuel` is the only one of
// these the app calls; the rest are exported because they are what a test can
// check the translation with.
export { installMissionDuel } from "./installDuel.js";
export { MissionDuel } from "./MissionDuel.js";
export {
  MISSION_CAST,
  missionCast,
  missionDuelDescriptor,
  missionDuelReport,
  missionDuelRounds,
  type MissionCast,
} from "./missionBrief.js";
export {
  ARENA_CONTEXT_M,
  MissionArenaView,
  arenaGround,
  arenaScenery,
} from "./missionArena.js";

export {
  YARD_COVER,
  fitPropToHeight,
  fittedCover,
  perimeterWall,
  yardArena,
  yardArenaSpec,
  type CoverPlacement,
} from "./arenaSpec.js";

export {
  DUEL_CLIP_NAMES,
  DUEL_LOCOMOTION_ROLES,
  DUEL_ONE_SHOT_ROLES,
  authoredSecondsFor,
  duelClipTimeScale,
  type DuelClipRole,
} from "./duelClips.js";

export { selectActorVisual, type ActorVisual, type ActorVisualInput } from "./actorVisual.js";

export { grantSummary, magazineRowSize } from "./RoundHud.js";

export {
  DEFAULT_GRIP_PLACEMENT,
  GRIP_POINT_M,
  HAND_BONE_CANDIDATES,
  PALM_DROP_M,
  SOCKET_OFFSET_M,
  TRIM_EULER_DEG,
  findHandBone,
  gripQuaternion,
  resolveHandBoneName,
  seatWeaponInHand,
  socketInverseScale,
  weaponLocalOffset,
  type GripPlacement,
} from "./weaponSocket.js";

export {
  AIM_PLANE_Y,
  desiredCamera,
  type CameraPose,
  type InspectFraming,
} from "./duelCamera.js";
