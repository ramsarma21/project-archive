// What an INVOKED ability does to the stealth field.
//
// This file exists as its own file, rather than as two more fields somewhere, for
// one reason: to be the place where the difference between an invoked effect and a
// per-player difficulty multiplier is written down, so that nobody later reads
// `visibilityScale` as a licence to bring back the thing that was cut.
//
// ============================================================================
// WHAT WAS CUT, AND WHY THIS IS NOT IT
// ============================================================================
//
// The previous detection code multiplied suspicion accrual by STANDING_FACTORS — a
// per-player social-camouflage band from 0.7x to 1.4x — and by HEAT_FACTORS, a
// global 0.8x to 1.6x band. Both are gone, and `visibility()` takes geometry,
// stance, motion, cover, light and crowd and NO PLAYER IDENTITY. That is what makes
// "one difficulty, identical detection values for every player" a structural
// guarantee rather than an intention, and there is a test asserting the tuning table
// carries no key matching standing, heat, difficulty, tier, skill, rank or level.
//
// An ability-supplied scale is a different kind of object, and it differs on three
// axes that are each checkable rather than rhetorical:
//
//   1. IT IS NEUTRAL UNLESS INVOKED. Absent means 1 means today's behaviour, exactly.
//      A difficulty multiplier is never neutral — it is always on, silently, for
//      whoever it was computed for. Nothing here applies until a player spends
//      something.
//
//   2. IT IS SPENT. One use per encounter, competing for one of four loadout slots,
//      lasting a window measured in seconds. A difficulty band has no charge, no
//      duration and no opportunity cost; it is a property of the player.
//
//   3. IT IS SYMMETRIC. Two players in identical geometry with the same effect
//      invoked get the same number, because this is not derived from who they are.
//      The Standing band's whole purpose was the opposite: two players in identical
//      geometry got DIFFERENT numbers. That is the definition of a per-player term,
//      and it is the thing this is not.
//
// And one structural fact behind all three: THE ENGINE CANNOT COMPUTE THIS VALUE.
// engine-world has no notion of Level, Rank, Standing, profile or progression, and
// depends on no package that does. The number arrives from the caller. So the only
// way to reintroduce a per-player multiplier is for a caller to compute one, at a
// call site, in the open — never buried inside the detection maths where the last
// one lived.
//
// ============================================================================
// WHERE THE TWO CHANNELS ARE CONSUMED, AND WHY NOT IN THE SAME PLACE
// ============================================================================
//
// `visibilityScale` is read PER TICK by `stepStealthField`, because concealment is
// true for exactly as long as the window is open.
//
// `diversionAttentionScale` is read ONCE, AT THE THROW, by `throwFieldDiversion`,
// and is then carried by the object itself. That is deliberate. The ability arms a
// throw; the object it armed keeps its louder, longer pull for its whole life, which
// outlasts the window on purpose — a chime that stopped ringing the moment the
// ability expired would be a worse thing than the bottle it was meant to improve.

/**
 * Effects an invoked ability is applying. Both channels are neutral at 1.
 *
 * Deliberately two numbers and nothing else. This is not a general-purpose modifier
 * bag: the ability layer owns the full effect vocabulary, and hands the stealth
 * field only the part the stealth field consumes.
 */
export interface InvokedAbilityEffect {
  /**
   * Multiplies the visibility a watcher resolves the player at. 1 is no effect, 0
   * is a total break of every cone. Enters the same product as cover, light and
   * crowd blend — one more factor, not a second detection model.
   */
  readonly visibilityScale: number;
  /**
   * Multiplies how strongly a THROWN OBJECT commands attention: how far its noise
   * carries, and how long a watcher stays interested in where it landed. Above 1
   * amplifies. Applies to the base thrown object rather than replacing it, so the
   * throw still arcs and can still miss.
   */
  readonly diversionAttentionScale: number;
}

/** No ability invoked. Identical in every respect to the field before this existed. */
export const NO_INVOKED_ABILITY: InvokedAbilityEffect = {
  visibilityScale: 1,
  diversionAttentionScale: 1,
};

/**
 * Ceiling on either channel. Not a balance number — a guard against a caller
 * handing in something that makes a watcher's noise radius the size of the map.
 */
export const MAX_INVOKED_ABILITY_SCALE = 8;

/** Clamp a scale into [0, MAX]. Non-finite or negative input is neutral. */
export function invokedAbilityScale(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 1;
  return Math.min(value, MAX_INVOKED_ABILITY_SCALE);
}

/** Normalise an effect, filling in neutral for anything absent or nonsensical. */
export function resolveInvokedAbility(
  effect: InvokedAbilityEffect | undefined,
): InvokedAbilityEffect {
  if (!effect) return NO_INVOKED_ABILITY;
  return {
    visibilityScale: invokedAbilityScale(effect.visibilityScale),
    diversionAttentionScale: invokedAbilityScale(effect.diversionAttentionScale),
  };
}

/**
 * States in code that an invoked effect is not a player attribute.
 *
 * `InvokedAbilityEffect` may only ever describe what is HAPPENING. The moment a
 * field names who the player is — their Standing, their Level, their skill band —
 * the one-difficulty guarantee is gone, and it goes quietly, because a field like
 * that reads perfectly reasonable in a diff. So it is a type error instead.
 */
export type InvokedAbilityKeys = keyof InvokedAbilityEffect;
export type ForbiddenInvokedAbilityKeys = Extract<
  InvokedAbilityKeys,
  | "standing"
  | "standingFactor"
  | "heat"
  | "heatFactor"
  | "difficulty"
  | "difficultyScale"
  | "tier"
  | "skill"
  | "skillBand"
  | "rank"
  | "level"
  | "playerLevel"
  | "profileId"
  | "playerId"
>;
export function assertInvokedAbilityIsNotAPlayerAttribute(): void {
  const forbidden: ForbiddenInvokedAbilityKeys[] = [];
  if (forbidden.length > 0) {
    throw new Error(
      "an invoked ability describes what is happening, never who the player is",
    );
  }
}
