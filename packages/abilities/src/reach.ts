// What an ability's numbers mean in metres, asked of the engine.
//
// This module used to report RATIOS, because engine-world's movement envelope was
// only reachable through the package root and a headless package cannot import
// React. That is fixed: `@pa/engine-world/parkour` is a subpath export, and
// `maxGapMetersForDrop` and `jumpApexM` now take the approach speed and the launch
// velocity, so an ability can ask the authoritative function what its own numbers
// produce instead of computing a ratio beside it.
//
// THE RATIOS WERE WRONG, WHICH IS THE POINT.
//
// The old comment here asserted that a gap scales linearly with speed, "because
// airtime is fixed and range is speed x airtime". The airtime part is right and the
// conclusion is not: two CONSTANTS come off every gap — the takeoff setback behind
// the near lip and the capsule radius that must clear the far one — and a constant
// deduction is a much larger fraction of a 3.7 m gap than of a 6.7 m one. So a 1.7x
// approach speed buys about 1.83x the gap, not 1.7x. Half a metre of level-design
// budget that a plausible-looking ratio quietly lost.
//
// Nothing here recomputes ballistics. Every number below comes out of the engine.

import {
  MOVEMENT_CAPABILITIES,
  jumpApexM,
  levelDesignMaxGapM,
  maxGapMetersForDrop,
} from "@pa/engine-world/parkour";
import {
  RUNNING_JUMP_VY,
  RUN_SPEED,
  STANDING_JUMP_VY,
  jumpLaunchScale,
} from "./engineSurface.js";
import type { GameAbility } from "./ability.js";

export interface AbilityReach {
  readonly abilityId: string;
  /** Multiplier on the target velocity handed to the shared integrator. */
  readonly moveSpeedScale: number;
  /** Multiplier on the launch velocity, after the engine's clamp. */
  readonly jumpLaunchScale: number;

  /** Top speed while the window is open, m/s. */
  readonly boostedRunSpeedMps: number;
  /** Standing-jump apex while the window is open, metres above the feet. */
  readonly boostedStandingApexM: number;
  /** Running-jump apex while the window is open. */
  readonly boostedRunningApexM: number;
  /** Largest flat lip-to-lip gap clearable while the window is open. */
  readonly boostedFlatGapM: number;
  /** The same gap at a 2 m drop, which is the common rooftop case. */
  readonly boostedGapAt2mDropM: number;

  /** Metres of gap the ability adds over the Level 0 envelope. */
  readonly gapGainM: number;
  /** Metres of apex it adds. */
  readonly apexGainM: number;
}

/**
 * What an ability actually opens up, in metres, against the engine's own envelope.
 *
 * Both scales are put through the engine's clamps first, so this reports what the
 * player will really get rather than what the ability asked for.
 */
export function abilityReach(ability: GameAbility): AbilityReach {
  const effect = ability.effectAt(0);
  const moveSpeedScale = Math.max(0, effect.duel.selfMoveSpeedScale);
  const launchScale = jumpLaunchScale(effect.world.selfJumpVelocityScale);

  const speedMps = RUN_SPEED * moveSpeedScale;
  const launchVy = RUNNING_JUMP_VY * launchScale;

  const boostedFlatGapM = maxGapMetersForDrop(0, speedMps, launchVy);
  const boostedStandingApexM = jumpApexM(STANDING_JUMP_VY * launchScale);

  return {
    abilityId: ability.abilityId,
    moveSpeedScale,
    jumpLaunchScale: launchScale,
    boostedRunSpeedMps: speedMps,
    boostedStandingApexM,
    boostedRunningApexM: jumpApexM(launchVy),
    boostedFlatGapM,
    boostedGapAt2mDropM: maxGapMetersForDrop(2, speedMps, launchVy),
    gapGainM: boostedFlatGapM - MOVEMENT_CAPABILITIES.maxFlatGapM,
    apexGainM: boostedStandingApexM - jumpApexM(STANDING_JUMP_VY),
  };
}

/**
 * The unmodified envelope, straight off the engine. This is what level design
 * budgets against and what every mission must be traversable inside; an ability may
 * only ever widen it, never move it.
 */
export const BASE_REACH = {
  runSpeedMps: MOVEMENT_CAPABILITIES.sprintSpeedMps,
  standingApexM: jumpApexM(STANDING_JUMP_VY),
  runningApexM: MOVEMENT_CAPABILITIES.jumpApexM,
  maxFlatGapM: MOVEMENT_CAPABILITIES.maxFlatGapM,
  levelDesignMaxFlatGapM: MOVEMENT_CAPABILITIES.levelDesignMaxFlatGapM,
  maxClimbHeightM: MOVEMENT_CAPABILITIES.maxClimbHeightM,
  maxMantleHeightM: MOVEMENT_CAPABILITIES.maxMantleHeightM,
} as const;

/**
 * The gap band an ability opens: wider than level design may author for a Level 0
 * player, and no wider than the ability actually delivers. A section 18.5 crossing
 * has to sit inside this band to be a shortcut rather than a wall.
 */
export function abilityGapBand(ability: GameAbility): {
  readonly floorM: number;
  readonly ceilingM: number;
} {
  return {
    floorM: levelDesignMaxGapM(0),
    ceilingM: abilityReach(ability).boostedFlatGapM,
  };
}
