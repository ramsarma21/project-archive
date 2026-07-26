// One ability, defined once.
//
// `GameAbility extends DuelAbility`, so an ability authored here IS a duel
// ability — the compiler checks the conformance, no cast and no adapter. It adds
// exactly three things the duel does not need: a name and a line of fiction for
// the HUD, the affordances it serves, and `effectAt`, which is the SINGLE authored
// timeline the duel's `modifiersAt` is a view of.
//
// The identity that makes the whole thing work:
//
//     ability.modifiersAt(t) === ability.effectAt(t).duel      (by reference)
//
// `defineAbility` below is the only constructor, and it establishes that identity
// structurally: `modifiersAt` is `(t) => this.effectAt(t).duel`. A mission and a
// duel therefore do not consult two agreeing sources; they consult one source, and
// the duel's half of it is the duel's own type.

import type { AffordanceId } from "./missions.js";
import type { AbilityEffect } from "./effects.js";
import { NEUTRAL_ABILITY_EFFECT } from "./effects.js";
import {
  ABILITY_USES_PER_DUEL,
  ENGAGEMENT_TICKS,
  type AbilityInvocationContext,
  type AbilityLoadout,
  type AbilityModifiers,
  type DuelAbility,
} from "./duelSurface.js";
import type { MotionState } from "./engineSurface.js";

/**
 * One use per ability per mission, DERIVED from the duel's constant rather than
 * chosen alongside it.
 *
 * The duel fixes one use per ability per duel and states that this is a rule of
 * the encounter, not a property of an ability. A mission is the other encounter,
 * so it takes the same rule and the same number: a player's mental model of "I get
 * one of these" does not change when they walk from a rooftop into a face-off.
 *
 * It is also the right number on its own terms. The base kit already carries
 * three reflex charges and three throwable objects per mission; an ability is the
 * one deliberate moment on top of that, which is exactly how the affordance
 * schedule uses it — one crossing, one window, one gap. If playtest wants two, it
 * is one constant here and nothing else.
 */
export const ABILITY_USES_PER_MISSION = ABILITY_USES_PER_DUEL;

export interface GameAbility extends DuelAbility {
  /** Display name. */
  readonly name: string;
  /** One line of why a runner from another century can do this. */
  readonly fiction: string;
  /** What it is for, in the language of the slate's affordance schedule. */
  readonly affordanceIds: readonly AffordanceId[];
  /** Always ABILITY_USES_PER_MISSION. Present so a HUD does not hardcode it. */
  readonly usesPerMission: number;
  /** The one authored timeline. `modifiersAt` returns `effectAt(t).duel`. */
  effectAt(elapsedTicks: number): AbilityEffect;
}

export interface AbilitySpec {
  readonly abilityId: string;
  readonly name: string;
  readonly fiction: string;
  readonly unlockedAtLevel: number;
  /** Authored in seconds; converted once against the engine's tick rate. */
  readonly durationTicks: number;
  readonly affordanceIds: readonly AffordanceId[];
  /** The effect, constant for the window. */
  readonly effect: AbilityEffect;
  /**
   * Why the ability would refuse itself. Optional: most do not refuse. A refusal
   * exists for exactly two reasons — the engine will not honour the effect
   * (a burst is grounded-only), or the use would be provably wasted (seeing
   * through cover while already in the open). Never for balance.
   */
  readonly canInvoke?: (context: AbilityInvocationContext) => boolean;
}

/**
 * The only way to build an ability.
 *
 * A constant effect over a fixed window, neutral outside it. The window is closed
 * at both ends deliberately: @pa/duel's `expireAbilityEffects` retires an effect
 * at `elapsed >= durationTicks`, and returning neutral past that point means a
 * caller who forgets to expire cannot leave an effect running forever.
 */
export function defineAbility(spec: AbilitySpec): GameAbility {
  const inWindow = (elapsedTicks: number): boolean =>
    Number.isFinite(elapsedTicks) &&
    elapsedTicks >= 0 &&
    elapsedTicks < spec.durationTicks;

  const effectAt = (elapsedTicks: number): AbilityEffect =>
    inWindow(elapsedTicks) ? spec.effect : NEUTRAL_ABILITY_EFFECT;

  return {
    abilityId: spec.abilityId,
    name: spec.name,
    fiction: spec.fiction,
    unlockedAtLevel: spec.unlockedAtLevel,
    durationTicks: spec.durationTicks,
    affordanceIds: spec.affordanceIds,
    usesPerMission: ABILITY_USES_PER_MISSION,
    canInvoke: spec.canInvoke ?? (() => true),
    effectAt,
    // THE identity. Not a translation of the effect, a member of it.
    modifiersAt: (elapsedTicks: number): AbilityModifiers =>
      effectAt(elapsedTicks).duel,
  };
}

/**
 * Hand a resolved set of abilities to the duel.
 *
 * A named no-op, because the important thing about it is that there is nothing to
 * do: `GameAbility` already extends `DuelAbility`, so this is a widening and not a
 * conversion. It exists so the seam is visible at the call site and so a test can
 * assert that the duel receives the same objects a mission uses.
 */
export function toDuelLoadout(
  abilities: readonly GameAbility[],
): AbilityLoadout {
  return abilities;
}

/**
 * Build the invocation context a mission hands to `canInvoke`.
 *
 * Field for field the same construction the duel makes in
 * packages/duel/src/combat.ts (`invokeAbility(... { round, tick, selfHealth,
 * selfHealthFraction, ammoRemaining, hasLineOfSightToOpponent, grounded })`), so
 * the SAME predicate sees the same shape in both encounters.
 *
 * `grounded` is read straight off `MotionState.grounded`, which is precisely what
 * the duel reads. It is deliberately not `canDash(motion)`, even though a burst
 * needs the stricter test: `beginDash` applies `canDash` itself, in both contexts,
 * so borrowing it here would make a mission refuse an invocation the duel would
 * accept. The engine stays the one authority on burst legality.
 *
 * A mission has no rounds, no health and no ammo, so those carry mission-shaped
 * values: the round is 0, health is full, ammo is 0. `hasLineOfSightToOpponent`
 * maps to the nearest watcher — the closest thing a mission has to an opponent,
 * and the reading `Farsight` needs.
 */
export function missionInvocationContext(input: {
  tick: number;
  motion: Pick<MotionState, "grounded">;
  nearestWatcherHasLineOfSight: boolean;
}): AbilityInvocationContext {
  return {
    round: 0,
    tick: input.tick,
    selfHealth: 1,
    selfHealthFraction: 1,
    ammoRemaining: 0,
    hasLineOfSightToOpponent: input.nearestWatcherHasLineOfSight,
    grounded: input.motion.grounded,
  };
}

/**
 * An effect window must fit inside one 20-second engagement, or a single use
 * spills across the boss's line-of-sight break and the round stops being the unit
 * of the fight. Checked for every authored ability in boston.test.ts.
 */
export function fitsInsideOneRound(ability: GameAbility): boolean {
  return ability.durationTicks > 0 && ability.durationTicks <= ENGAGEMENT_TICKS;
}
