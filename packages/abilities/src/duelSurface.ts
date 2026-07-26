// The ability contract, imported from @pa/duel and re-exported unchanged.
//
// THIS PACKAGE DEFINES NO ABILITY INTERFACE OF ITS OWN. `packages/duel/src/
// abilities.ts` already defines the one a fight consumes — `AbilityDescriptor`,
// `AbilityModifiers`, `AbilityInvocationContext`, `DuelAbility` — and states the
// rule that makes an ability portable: a movement effect is a SCALE ON THE TARGET
// VELOCITY handed to engine-world's `stepMotion`, never a displacement. Anything
// authored here conforms to that file or it does not ship.
//
// Everything the duel needs from an ability comes through this module, so the
// coupling to @pa/duel is one file wide. That is the same discipline
// packages/duel/src/engine.ts applies to @pa/engine-world.
//
// The use LEDGER is re-exported too, and that is deliberate rather than
// incidental. `createAbilityLedger`, `invokeAbility`, `expireAbilityEffects` and
// `activeModifiers` are pure functions over a serialisable record; nothing in
// them is duel-specific. A mission therefore runs the SAME ledger the duel runs
// (see missionSession.ts) instead of a second one that agrees with it.

export {
  ABILITY_USES_PER_DUEL,
  NEUTRAL_ABILITY_MODIFIERS,
  activeModifiers,
  assertAbilityCannotMintBullets,
  createAbilityLedger,
  expireAbilityEffects,
  invokeAbility,
  type AbilityDescriptor,
  type AbilityInvocationContext,
  type AbilityInvocationOutcome,
  type AbilityLedger,
  type AbilityLoadout,
  type AbilityModifiers,
  type AbilityUseRecord,
  type DuelAbility,
} from "@pa/duel";

// Duel structure, used here only to check that an authored duration is sane
// against the round it has to fit inside. No tuning value is restated.
export {
  DUEL_ROUNDS,
  ENGAGEMENT_TICKS,
  FIELD_DT,
  FIELD_TICK_HZ,
  FIRE_INTERVAL_TICKS,
} from "@pa/duel";

import { FIELD_TICK_HZ } from "@pa/duel";

/**
 * Seconds to fixed-step ticks, on the one 60 Hz clock the whole game shares.
 * Durations are authored in seconds because that is how they are reasoned about,
 * and converted once, here, against the engine's own rate.
 */
export function ticks(seconds: number): number {
  return Math.round(seconds * FIELD_TICK_HZ);
}
