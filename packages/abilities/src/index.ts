// @pa/abilities — the XP and Level curve, and the one ability system that hangs
// off it.
//
// Headless: no rendering, no React, no three. Pure data and arithmetic, so it runs
// under `node --test`, inside the PvP server authority, and in the browser.
//
// The two halves of this package are one design decision, because ability unlocks
// are defined at Level milestones — the curve decides when a player can do
// something new, so the curve and the unlock schedule cannot be authored apart.
//
// Nothing here defines an ability interface: @pa/duel owns that contract and this
// package conforms to it (see duelSurface.ts). Nothing here defines progression
// arithmetic: @pa/contracts owns that and this package consumes it (see
// contractsSurface.ts). Nothing here contains physics: @pa/engine-world owns the
// one integrator and every movement effect is a scale on the target velocity handed
// to it (see engineDependencies.ts).

// ---- chapter and assessment identity ---------------------------------------
export {
  ABILITY_CHAPTER_IDS,
  BOSTON_CAPSTONE_ASSESSMENT_ID,
  BOSTON_CHAPTER_ID,
  UnknownAbilityChapterError,
  asAbilityChapterId,
  isAbilityChapterId,
  resolveAbilityChapterId,
  type AbilityChapterId,
} from "./chapters.js";

// ---- the curve --------------------------------------------------------------
export {
  BOSTON_CHAPTER_XP_CEILING,
  BOSTON_LEVEL_CAP,
  BOSTON_MAX_ATTAINABLE_LEVEL,
  BOSTON_MISSION_BASE_XP,
  BOSTON_MISSION_COUNT,
  BOSTON_XP_CURVE,
  FIRST_MISSION_BASE_XP,
  LEVEL_1_XP,
  LEVEL_COST_STEP,
  MISSION_BASE_XP_STEP,
  levelCost,
  levelFor,
  levelThreshold,
  missionAward,
  missionBaseXp,
  worstPayingClear,
  xpOwedForNextLevel,
} from "./curve.js";

// ---- the slate and its affordance schedule ---------------------------------
export {
  AFFORDANCE_IDS,
  BOSTON_AFFORDANCES,
  BOSTON_CAPSTONE,
  BOSTON_MISSIONS,
  BOSTON_MISSION_XP,
  missionByOrdinal,
  missionById,
  toMissionReward,
  type AffordanceId,
  type AffordanceSpec,
  type BostonMissionRow,
} from "./missions.js";

// ---- the ability system ----------------------------------------------------
export {
  ABILITY_USES_PER_MISSION,
  defineAbility,
  fitsInsideOneRound,
  missionInvocationContext,
  toDuelLoadout,
  type AbilitySpec,
  type GameAbility,
} from "./ability.js";

export {
  ABILITY_CHANNELS,
  NEUTRAL_ABILITY_EFFECT,
  NEUTRAL_WORLD_ABILITY_MODIFIERS,
  abilityEffect,
  activeWorldModifiers,
  assertAbilityCannotGrantVerbs,
  type AbilityChannel,
  type AbilityEffect,
  type ChannelStatus,
  type WorldAbilityModifiers,
} from "./effects.js";

// ---- the Boston set --------------------------------------------------------
export {
  BOSTON_ABILITIES,
  FARSIGHT,
  HOLD_FAST,
  KITE_STEP,
  LONGCOAT_HUSH,
  LONG_STRIDE,
  OUT_OF_TIME,
  POWDER_DAMP,
  WARD_CHIME,
  bostonAbility,
} from "./boston.js";

// ---- who holds what -------------------------------------------------------
export {
  ABILITY_LOADOUT_SLOTS,
  BOSTON_ABILITY_MILESTONES,
  bostonAbilitiesAtLevel,
  bostonMilestonesAtLevel,
  resolveChapterLoadout,
  resolvePvpLoadout,
  type ResolvedLoadout,
} from "./loadout.js";

// ---- running them in a mission --------------------------------------------
export {
  createMissionAbilityState,
  invokeMissionAbility,
  invokedAbilityEffect,
  missionCarriedEvidenceConcealed,
  missionJumpLaunchScale,
  missionMoveSpeedScale,
  missionOppositionSpeedScale,
  missionStaggerRecoveryScale,
  stepMissionAbilities,
  type MissionAbilityState,
  type MissionAbilityTick,
} from "./missionSession.js";

// ---- what the numbers mean in metres --------------------------------------
export {
  BASE_REACH,
  abilityGapBand,
  abilityReach,
  type AbilityReach,
} from "./reach.js";

// ---- trajectories, and the proofs -----------------------------------------
export {
  BOSTON_ARCHETYPES,
  archetype,
  arrivalLevels,
  attainableRanks,
  rankReport,
  walkAllArchetypes,
  walkChapter,
  type AttemptPlan,
  type PlayerArchetype,
  type RankReport,
  type Trajectory,
  type TrajectoryStep,
} from "./trajectory.js";

export {
  verifyBostonProgression,
  verifyChannelDependencies,
  verifyCurveShape,
  verifyNoMissionRequiresAbility,
  verifyRankLadder,
  verifyUnlockSchedule,
  type VerificationResult,
} from "./verify.js";

export {
  ENGINE_DEPENDENCIES,
  type DependencyStatus,
  type EngineDependency,
} from "./engineDependencies.js";

// The duel's contract, re-exported so a consumer building a duel does not have to
// import @pa/duel a second time to describe what it is being handed — and so the
// ability surface this package conforms to is discoverable from here.
export {
  ABILITY_USES_PER_DUEL,
  NEUTRAL_ABILITY_MODIFIERS,
  activeModifiers,
  createAbilityLedger,
  expireAbilityEffects,
  invokeAbility,
  ticks,
  type AbilityDescriptor,
  type AbilityInvocationContext,
  type AbilityLedger,
  type AbilityLoadout,
  type AbilityModifiers,
  type DuelAbility,
} from "./duelSurface.js";
