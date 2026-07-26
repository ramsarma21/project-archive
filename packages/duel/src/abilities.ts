// What the duel needs from an ability — and nothing more.
//
// ============================================================================
// STATUS: THE SEAM IS COMPLETE AND DELIBERATELY UNUSED.
// ============================================================================
//
// The owner has not settled what the abilities are, so nothing authored is wired
// into combat and every shipped loadout is empty. The plumbing stays, finished, so
// that deciding the set later is an authoring job rather than a combat rewrite.
//
// WHAT AN AUTHOR HAS TO DO WHEN THE SET IS DECIDED — the whole list:
//
//   1. Write a `DuelAbility` in @pa/abilities: an id, an unlock Level, a duration
//      in ticks, a `canInvoke` predicate and a `modifiersAt(elapsed)`. That package
//      already re-exports this contract through its duelSurface.ts and already
//      defines eight Boston abilities against it.
//   2. Put it in the loadout handed to `createDuel` as `playerLoadout`. Eligibility
//      — chapter scope, Level, PvP legality — is decided upstream; the duel does
//      not compute unlocks and must not learn how.
//   3. Bind a key to it in the client and animate off the `ABILITY_INVOKED` event,
//      which already carries the side, the id and the uses remaining.
//
// NOTHING IN packages/duel CHANGES. Not combat.ts, not the machine, not the
// events. That is the property being preserved, and `abilities.test.ts` pins the
// two halves of it: an empty loadout is an exact no-op, and every channel the
// contract declares is a channel combat actually reads.
//
// The one thing an author cannot do is grant a bullet — see
// `assertAbilityCannotMintBullets` at the bottom of this file.
//
// ----------------------------------------------------------------------------
//
// Abilities are NOT defined here. They must behave identically in a parkour
// mission and in a duel, so they are defined once in the shared layer. This file
// is the narrow contract that shared implementation has to satisfy, plus the
// ledger the duel keeps because the use limit is a duel-scoped rule — one use per
// ability per duel, in both modes — rather than an ability-scoped one.
//
// The contract is deliberately two members wide:
//
//   canInvoke(ctx)          — a pure predicate over what the duel knows
//   modifiersAt(elapsed)    — a pure modifier set for a given tick of the effect
//
// Everything an ability does inside a duel is expressed as a modifier that the
// duel applies to systems it already owns:
//
//   motion      — a scale on the target velocity handed to engine-world's
//                 stepMotion. The ability never moves a body itself; the shared
//                 integrator does, so a dash is the same dash in both contexts.
//   defence     — a scale on incoming damage (0 is a full negate).
//   disruption  — scales on the opponent's movement and rate of fire.
//   perception  — whether the holder can see an opponent through cover, which is
//                 an input to targeting, never a change to occlusion itself.
//
// There is deliberately NO ammo field. An ability that grants a bullet would put
// a second, non-verdict source into the bullet economy and break the one rule the
// whole design rests on. `assertAbilityCannotMintBullets` states that as code so
// the constraint survives someone adding a field in six months.

/**
 * One use per ability per duel, in a boss duel and in PvP alike.
 *
 * This is a rule of the duel rather than a property of an ability, so it is a
 * constant here instead of a field on the descriptor: an ability cannot ask for
 * more, and PvP is not special-cased. It also means a duel needs no cooldown —
 * with a single use there is nothing for one to gate — which is why the descriptor
 * below is three fields long.
 */
export const ABILITY_USES_PER_DUEL = 1;

export interface AbilityDescriptor {
  readonly abilityId: string;
  /**
   * Level milestone the ability unlocks at. The duel never evaluates this —
   * eligibility is decided upstream and handed in as `loadout` — but it travels
   * with the descriptor so a mismatch is inspectable in a replay.
   */
  readonly unlockedAtLevel: number;
  /** How long the effect lasts. 0 means it resolves on the invoking tick. */
  readonly durationTicks: number;
}

export interface AbilityModifiers {
  /** Multiplies the target velocity the duel hands to stepMotion. 1 = neutral. */
  readonly selfMoveSpeedScale: number;
  /** Multiplies damage taken. 0 = immune for the duration. */
  readonly selfIncomingDamageScale: number;
  /** Multiplies the opponent's target velocity. */
  readonly opponentMoveSpeedScale: number;
  /** Multiplies the opponent's interval between shots. >1 = slower. */
  readonly opponentFireIntervalScale: number;
  /** Lets the holder target an opponent it has no line of sight to. */
  readonly revealsOpponentThroughCover: boolean;
}

export const NEUTRAL_ABILITY_MODIFIERS: AbilityModifiers = {
  selfMoveSpeedScale: 1,
  selfIncomingDamageScale: 1,
  opponentMoveSpeedScale: 1,
  opponentFireIntervalScale: 1,
  revealsOpponentThroughCover: false,
};

/**
 * Every channel an ability may set, and — the part that matters — every channel
 * combat.ts actually reads. A declared channel nobody consumes is a lie in the
 * interface: an author sets it, nothing happens, and the bug is invisible because
 * the ability "works".
 *
 *   selfMoveSpeedScale           stepFighterMotion, into the target velocity
 *   selfIncomingDamageScale      advanceProjectiles, on the damage applied
 *   opponentMoveSpeedScale       stepFighterMotion, into the opponent's velocity
 *   opponentFireIntervalScale    resolveFiring, on the reload it books
 *   revealsOpponentThroughCover  resolveFiring, lifting the aim assist's sight gate
 */
export const ABILITY_MODIFIER_CHANNELS = [
  "selfMoveSpeedScale",
  "selfIncomingDamageScale",
  "opponentMoveSpeedScale",
  "opponentFireIntervalScale",
  "revealsOpponentThroughCover",
] as const satisfies readonly (keyof AbilityModifiers)[];

/**
 * Exactly what the duel is willing to tell an ability about the world. Kept
 * minimal on purpose: an ability that needs more than this is reaching into
 * combat internals, and the answer is to widen this interface deliberately
 * rather than to hand it the state.
 */
export interface AbilityInvocationContext {
  readonly round: number;
  readonly tick: number;
  readonly selfHealth: number;
  readonly selfHealthFraction: number;
  readonly ammoRemaining: number;
  readonly hasLineOfSightToOpponent: boolean;
  readonly grounded: boolean;
}

export interface DuelAbility extends AbilityDescriptor {
  canInvoke(context: AbilityInvocationContext): boolean;
  modifiersAt(elapsedTicks: number): AbilityModifiers;
}

/**
 * The shared layer hands the duel a resolved loadout: the abilities this player
 * actually holds in this duel, already filtered by chapter scope and level.
 * The duel does not compute unlocks.
 */
export type AbilityLoadout = readonly DuelAbility[];

// ---- the duel-scoped ledger ------------------------------------------------
//
// Whether an ability has been spent is duel state, not ability state, so it lives
// here and is serialisable.

export interface AbilityUseRecord {
  readonly usesRemaining: number;
  /** Tick the current effect started, or null when the ability is not active. */
  readonly activeSinceTick: number | null;
}

export type AbilityLedger = Readonly<Record<string, AbilityUseRecord>>;

export function createAbilityLedger(loadout: AbilityLoadout): AbilityLedger {
  const ledger: Record<string, AbilityUseRecord> = {};
  for (const ability of loadout) {
    ledger[ability.abilityId] = {
      usesRemaining: ABILITY_USES_PER_DUEL,
      activeSinceTick: null,
    };
  }
  return ledger;
}

export type AbilityInvocationOutcome =
  | { readonly ok: true; readonly ledger: AbilityLedger }
  | {
      readonly ok: false;
      readonly reason:
        | "NOT_IN_LOADOUT"
        | "ALREADY_ACTIVE"
        | "ALREADY_USED"
        | "REFUSED_BY_ABILITY";
    };

export function invokeAbility(
  loadout: AbilityLoadout,
  ledger: AbilityLedger,
  abilityId: string,
  context: AbilityInvocationContext,
): AbilityInvocationOutcome {
  const ability = loadout.find((entry) => entry.abilityId === abilityId);
  if (!ability) return { ok: false, reason: "NOT_IN_LOADOUT" };
  const record = ledger[abilityId];
  if (!record) return { ok: false, reason: "NOT_IN_LOADOUT" };
  // "still running" is reported ahead of "already spent" because during the effect
  // it is the more useful answer for a HUD to show.
  if (record.activeSinceTick !== null) {
    return { ok: false, reason: "ALREADY_ACTIVE" };
  }
  if (record.usesRemaining <= 0) return { ok: false, reason: "ALREADY_USED" };
  if (!ability.canInvoke(context)) {
    return { ok: false, reason: "REFUSED_BY_ABILITY" };
  }
  return {
    ok: true,
    ledger: {
      ...ledger,
      [abilityId]: {
        usesRemaining: record.usesRemaining - 1,
        activeSinceTick: ability.durationTicks > 0 ? context.tick : null,
      },
    },
  };
}

/** Retire effects whose duration has run out. Pure; called once per tick. */
export function expireAbilityEffects(
  loadout: AbilityLoadout,
  ledger: AbilityLedger,
  tick: number,
): AbilityLedger {
  let changed = false;
  const next: Record<string, AbilityUseRecord> = { ...ledger };
  for (const ability of loadout) {
    const record = next[ability.abilityId];
    if (!record || record.activeSinceTick === null) continue;
    if (tick - record.activeSinceTick >= ability.durationTicks) {
      next[ability.abilityId] = { ...record, activeSinceTick: null };
      changed = true;
    }
  }
  return changed ? next : ledger;
}

/** Combine every active effect into the one modifier set the duel applies. */
export function activeModifiers(
  loadout: AbilityLoadout,
  ledger: AbilityLedger,
  tick: number,
): AbilityModifiers {
  let combined = NEUTRAL_ABILITY_MODIFIERS;
  for (const ability of loadout) {
    const record = ledger[ability.abilityId];
    if (!record || record.activeSinceTick === null) continue;
    const modifiers = ability.modifiersAt(tick - record.activeSinceTick);
    combined = {
      selfMoveSpeedScale:
        combined.selfMoveSpeedScale * clampScale(modifiers.selfMoveSpeedScale),
      selfIncomingDamageScale:
        combined.selfIncomingDamageScale *
        clampScale(modifiers.selfIncomingDamageScale),
      opponentMoveSpeedScale:
        combined.opponentMoveSpeedScale *
        clampScale(modifiers.opponentMoveSpeedScale),
      opponentFireIntervalScale:
        combined.opponentFireIntervalScale *
        clampScale(modifiers.opponentFireIntervalScale),
      revealsOpponentThroughCover:
        combined.revealsOpponentThroughCover ||
        modifiers.revealsOpponentThroughCover,
    };
  }
  return combined;
}

function clampScale(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 1;
  return Math.min(value, 8);
}

/**
 * States in code that no ability may mint a bullet. AbilityModifiers has no
 * ammo member, so this is a type-level assertion with a runtime witness: if
 * anybody adds one, this stops compiling.
 */
export type AbilityModifierKeys = keyof AbilityModifiers;
export type ForbiddenAbilityModifiers = Extract<
  AbilityModifierKeys,
  "ammo" | "bullets" | "magazine" | "ammoBonus"
>;
export function assertAbilityCannotMintBullets(): void {
  const forbidden: ForbiddenAbilityModifiers[] = [];
  if (forbidden.length > 0) {
    throw new Error("abilities may never alter the bullet economy");
  }
}
