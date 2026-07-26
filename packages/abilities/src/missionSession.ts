// Running abilities inside a mission — using the duel's machinery, not a copy of it.
//
// This is the file that makes "one ability system" true rather than aspirational.
// A mission needs four things: a use ledger, an invocation with refusals, expiry,
// and the combined effect for the current tick. @pa/duel already exports all four
// as pure functions over a serialisable record, and none of them contains anything
// duel-specific:
//
//     createAbilityLedger    ->  used verbatim
//     invokeAbility          ->  used verbatim (so the refusal reasons match too)
//     expireAbilityEffects   ->  used verbatim
//     activeModifiers        ->  used verbatim, for the duel half of the effect
//
// The only thing added is `activeWorldModifiers`, which composes the half a duel
// has no concept of, under the same multiply-and-clamp rules.
//
// So a mission does not have a parallel ability runtime. It has the duel's runtime
// plus five extra channels. `oneUseAcrossBothEncounters` in the tests drives the
// same loadout through a mission-shaped session and a duel-shaped session and
// asserts the ledgers are identical, which is a claim about one implementation
// rather than two.

import type { GameAbility } from "./ability.js";
import { activeWorldModifiers, type WorldAbilityModifiers } from "./effects.js";
import {
  jumpLaunchScale,
  staggerRecoveryScale,
  type InvokedAbilityEffect,
} from "./engineSurface.js";
import {
  activeModifiers,
  createAbilityLedger,
  expireAbilityEffects,
  invokeAbility,
  type AbilityInvocationContext,
  type AbilityInvocationOutcome,
  type AbilityLedger,
  type AbilityModifiers,
} from "./duelSurface.js";

export interface MissionAbilityState {
  readonly loadout: readonly GameAbility[];
  readonly ledger: AbilityLedger;
}

/** Open a mission's ability state. One use per ability, exactly as a duel. */
export function createMissionAbilityState(
  loadout: readonly GameAbility[],
): MissionAbilityState {
  return { loadout, ledger: createAbilityLedger(loadout) };
}

/**
 * Spend an ability in a mission. The duel's own `invokeAbility`, so the ordering
 * of refusals — still running, then already spent, then the ability's own
 * objection — is identical, and so are the reason codes a HUD renders.
 */
export function invokeMissionAbility(
  state: MissionAbilityState,
  abilityId: string,
  context: AbilityInvocationContext,
): { state: MissionAbilityState; outcome: AbilityInvocationOutcome } {
  const outcome = invokeAbility(state.loadout, state.ledger, abilityId, context);
  return {
    state: outcome.ok ? { ...state, ledger: outcome.ledger } : state,
    outcome,
  };
}

export interface MissionAbilityTick {
  readonly state: MissionAbilityState;
  /** The duel half, composed by @pa/duel. Missions read what applies to them. */
  readonly duel: AbilityModifiers;
  /** The half a duel cannot express. */
  readonly world: WorldAbilityModifiers;
}

/**
 * One fixed step. Expire first, then read — so an effect that ends on this tick
 * does not contribute to it, matching the order a duel steps in.
 */
export function stepMissionAbilities(
  state: MissionAbilityState,
  tick: number,
): MissionAbilityTick {
  const ledger = expireAbilityEffects(state.loadout, state.ledger, tick);
  return {
    state: { ...state, ledger },
    duel: activeModifiers(state.loadout, ledger, tick),
    world: activeWorldModifiers(state.loadout, ledger, tick),
  };
}

/**
 * The one number a mission's movement code needs from this system: the factor to
 * apply to the target velocity before handing it to the flow layer.
 *
 * `FlowInput.targetVelX/Z` is documented as "already scaled to target speed", so
 * the mission multiplies here and engine-world's integrator does the rest — the
 * same factor `combat.ts` folds into its own `speedScale`, and the same factor it
 * passes through `dashSpeed(RUN_SPEED * speedScale)` when it opens a burst.
 *
 * Only the `self` term. `opponentMoveSpeedScale` is deliberately absent, and the
 * asymmetry is worth spelling out because getting it backwards would make an
 * ability slow the player who used it. In a duel, `combat.ts` applies the
 * OPPONENT's `opponentMoveSpeedScale` to this fighter — it is a term one side
 * writes and the other side reads. A mission's watchers hold no abilities, so the
 * term slowing the player is always 1, and the player's own value is the one that
 * belongs to the patrols. See `missionOppositionSpeedScale`.
 */
export function missionMoveSpeedScale(tick: MissionAbilityTick): number {
  return tick.duel.selfMoveSpeedScale;
}

/**
 * The factor the level/AI layer applies to patrol movement, which is the mission's
 * reading of the same `opponentMoveSpeedScale` a duel applies to the other
 * duellist. The stealth field deliberately does not move watchers, so this is
 * consumed where their pose is produced.
 */
export function missionOppositionSpeedScale(tick: MissionAbilityTick): number {
  return tick.duel.opponentMoveSpeedScale;
}

/**
 * The record `stepStealthField` and `throwFieldDiversion` take.
 *
 * Built in the engine's own shape rather than translated into it: `InvokedAbilityEffect`
 * is imported from @pa/engine-world, so if the engine grows a channel this stops
 * compiling instead of silently dropping one.
 *
 * Hand it to `stepStealthField` every tick, and to `throwFieldDiversion` at the
 * throw — the field reads the visibility scale per tick, and the throw captures the
 * attention scale once and gives it to the object.
 */
export function invokedAbilityEffect(
  tick: MissionAbilityTick,
): InvokedAbilityEffect {
  return {
    visibilityScale: tick.world.selfVisibilityScale,
    diversionAttentionScale: tick.world.diversionAttentionScale,
  };
}

/**
 * The launch scale for `beginStandingJump` / `beginRunningJump`, already through
 * the engine's clamp so a caller sees what the player will actually get.
 */
export function missionJumpLaunchScale(tick: MissionAbilityTick): number {
  return jumpLaunchScale(tick.world.selfJumpVelocityScale);
}

/**
 * The recovery scale for `resolveContact`, already through the engine's clamp.
 *
 * The clamp is the interesting part: its floor is above zero, so no ability can make
 * being grabbed free, and the noise a contact makes is not on this channel at all.
 * See contact.ts in @pa/engine-world.
 */
export function missionStaggerRecoveryScale(tick: MissionAbilityTick): number {
  return staggerRecoveryScale(tick.world.staggerRecoveryScale);
}

/**
 * Whether an observer can read the face of a carried document right now.
 *
 * The one channel with no engine consumer, and correctly so: a document with a
 * readable face and a reading distance is mission content, not physics. Exposed here
 * so the mission layer that eventually owns it has one place to ask.
 */
export function missionCarriedEvidenceConcealed(tick: MissionAbilityTick): boolean {
  return tick.world.carriedEvidenceConcealed;
}
