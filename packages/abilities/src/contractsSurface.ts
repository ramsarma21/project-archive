// The progression protocol, imported from @pa/contracts and re-exported unchanged.
//
// @pa/contracts owns WHERE progression numbers live and HOW they are derived:
// the `XpCurve` shape, the `AbilityMilestone` shape, `levelForXp`, the attempt
// decay fractions, `rankFromCumulativeLevels`. This package owns WHAT the
// numbers are. The split is strict in both directions — nothing here reimplements
// a derivation that contracts already exports, and nothing here edits contracts.
//
// One file wide on purpose: if a schema field is renamed upstream, exactly this
// module has to be reconciled.

export {
  LEVELS_PER_RANK,
  MAX_MISSION_ATTEMPTS,
  MISSION_ATTEMPT_XP_FRACTIONS,
  STARTING_LEVEL,
  STARTING_RANK,
  STARTING_XP,
  ZERO_XP,
  AbilityMilestoneSchema,
  MissionRewardSchema,
  XpCurveSchema,
  type AbilityMilestone,
  type MissionReward,
  type XpCurve,
  type XpFraction,
} from "@pa/contracts";

export {
  attemptXpFraction,
  attemptXpMultiplier,
  levelForXp,
  levelsToNextRank,
  missionXpAward,
  monotonicRank,
  newlyUnlockedAbilityMilestones,
  rankFromCumulativeLevels,
  unlockedAbilityMilestones,
  xpToNextLevel,
} from "@pa/contracts";
