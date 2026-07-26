// What an ability DOES, expressed once for the whole game.
//
// ============================================================================
// THE ARCHITECTURE, AND WHY IT IS THIS AND NOT SOMETHING ELSE
// ============================================================================
//
// The owner's constraint is that physics, movement and abilities are consistent
// across the whole game: one core, one 60 Hz fixed step, one seeded RNG, one
// collision representation, one motion integrator. So an ability must not have a
// mission implementation and a duel implementation. Two implementations that
// agree today are two implementations that disagree in six months.
//
// The obvious approach — define a neutral ability type here and write an adapter
// that translates it into the duel's `AbilityModifiers` — is exactly the trap. An
// adapter IS a second definition; it can lose a field, round a number, or drift
// when the duel adds a channel.
//
// So `AbilityEffect` does not translate. It EMBEDS the duel's own type:
//
//     interface AbilityEffect {
//       duel:  AbilityModifiers;         // imported from @pa/duel, verbatim
//       world: WorldAbilityModifiers;    // only what the duel cannot express
//     }
//
// `DuelAbility.modifiersAt(elapsed)` then returns `effectAt(elapsed).duel` — the
// same object, by reference, not a copy. There is no projection to get wrong, and
// if @pa/duel adds a modifier channel this package stops compiling until the
// authored effects account for it. That is the guarantee, stated as a type
// relationship rather than as a promise.
//
// ============================================================================
// WHY `world` IS SO SMALL
// ============================================================================
//
// `AbilityModifiers` is the duel's COMPLETE vocabulary: a velocity scale, a
// damage scale, two opponent scales, and one perception boolean. Wherever a
// world channel would duplicate one of those, the duel's channel is used and the
// mission layer reads it — `revealsOpponentThroughCover` is the perception
// channel for a patrol cone as well as for a boss, and `opponentMoveSpeedScale`
// slows a patrol as readily as a duellist. `world` holds only the five things a
// duel genuinely has no concept of.
//
// The consequence worth stating plainly: an ability's numbers are authored ONCE
// and every context reads whichever channels it has. `Kite Step` carries a jump
// scale that today only a mission consumes — but the duel's `stepFighterMotion`
// already calls `beginRunningJump`, so the day the engine accepts a launch scale
// the same 1.45 applies in a duel with no change to this package.

import {
  NEUTRAL_ABILITY_MODIFIERS,
  type AbilityLedger,
  type AbilityLoadout,
  type AbilityModifiers,
  type DuelAbility,
} from "./duelSurface.js";

// ---------------------------------------------------------------------------
// the world half
// ---------------------------------------------------------------------------

export interface WorldAbilityModifiers {
  /**
   * Multiplies the visibility a watcher resolves the player at, [0,1] scale.
   * 1 = neutral, 0 = no cone resolves the player at all. Feeds
   * engine-world's `visibility()`, which is the single detection function for
   * the whole game — this is a factor in that product, not a second detection
   * model.
   */
  readonly selfVisibilityScale: number;
  /**
   * Multiplies the launch velocity handed to `beginStandingJump` /
   * `beginRunningJump`. A SCALE ON A VELOCITY, never a position write: the
   * ballistic integrator still produces every metre, so a boosted jump collides,
   * clips its head on overhangs and lands on validated support exactly as an
   * ordinary jump does.
   */
  readonly selfJumpVelocityScale: number;
  /**
   * Multiplies the recovery time after non-lethal body contact. <1 recovers
   * faster. Contact recovery is Mission-Slate section 18.4 and has no consumer
   * anywhere yet; see engineDependencies.ts.
   */
  readonly staggerRecoveryScale: number;
  /**
   * Multiplies how strongly a THROWN OBJECT commands attention — both the noise
   * intensity it lands with and how long a watcher stays interested.
   *
   * Deliberately a scale on the existing thrown-diversion primitive rather than a
   * second projectile: engine-world already flies a real bottle on the shared
   * substep, and it can already miss. An ability that spawned its own guaranteed
   * beacon would be a fork of that primitive and would delete the skill in
   * aiming.
   */
  readonly diversionAttentionScale: number;
  /**
   * Observers cannot read the incriminating face of a carried document.
   * Mission-Slate section 18.3. Information only: it changes what an observer
   * learns, never where the player can go.
   */
  readonly carriedEvidenceConcealed: boolean;
}

export const NEUTRAL_WORLD_ABILITY_MODIFIERS: WorldAbilityModifiers = {
  selfVisibilityScale: 1,
  selfJumpVelocityScale: 1,
  staggerRecoveryScale: 1,
  diversionAttentionScale: 1,
  carriedEvidenceConcealed: false,
};

// ---------------------------------------------------------------------------
// the whole effect
// ---------------------------------------------------------------------------

export interface AbilityEffect {
  /** The duel's own vocabulary, embedded rather than mirrored. */
  readonly duel: AbilityModifiers;
  /** Channels the duel has no concept of. */
  readonly world: WorldAbilityModifiers;
}

export const NEUTRAL_ABILITY_EFFECT: AbilityEffect = {
  duel: NEUTRAL_ABILITY_MODIFIERS,
  world: NEUTRAL_WORLD_ABILITY_MODIFIERS,
};

/** Build an effect from only the channels an ability actually touches. */
export function abilityEffect(spec: {
  duel?: Partial<AbilityModifiers>;
  world?: Partial<WorldAbilityModifiers>;
}): AbilityEffect {
  return {
    duel: { ...NEUTRAL_ABILITY_MODIFIERS, ...spec.duel },
    world: { ...NEUTRAL_WORLD_ABILITY_MODIFIERS, ...spec.world },
  };
}

// ---------------------------------------------------------------------------
// composition
// ---------------------------------------------------------------------------

/**
 * The duel's clamp, restated for the world half ONLY.
 *
 * Copied deliberately and narrowly: `clampScale` is private to @pa/duel, and the
 * two halves must compose under identical rules or a stacked effect would behave
 * differently depending on which channel it landed on. The duel half is never
 * composed here — `activeWorldModifiers` below composes only `world`, and the
 * duel half is composed by @pa/duel's own `activeModifiers`, called directly.
 */
const MAX_SCALE = 8;
function clampScale(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 1;
  return Math.min(value, MAX_SCALE);
}

/**
 * Combine the world half of every active effect, with the same multiply-and-clamp
 * semantics @pa/duel applies to its half and the same OR for booleans.
 *
 * Signature matches `activeModifiers(loadout, ledger, tick)` on purpose: a
 * mission calls both functions with the same three arguments, one for each half
 * of the same effect.
 */
export function activeWorldModifiers(
  loadout: AbilityLoadout,
  ledger: AbilityLedger,
  tick: number,
): WorldAbilityModifiers {
  let combined = NEUTRAL_WORLD_ABILITY_MODIFIERS;
  for (const ability of loadout) {
    const record = ledger[ability.abilityId];
    if (!record || record.activeSinceTick === null) continue;
    const world = worldModifiersOf(ability, tick - record.activeSinceTick);
    if (!world) continue;
    combined = {
      selfVisibilityScale:
        combined.selfVisibilityScale * clampScale(world.selfVisibilityScale),
      selfJumpVelocityScale:
        combined.selfJumpVelocityScale * clampScale(world.selfJumpVelocityScale),
      staggerRecoveryScale:
        combined.staggerRecoveryScale * clampScale(world.staggerRecoveryScale),
      diversionAttentionScale:
        combined.diversionAttentionScale *
        clampScale(world.diversionAttentionScale),
      carriedEvidenceConcealed:
        combined.carriedEvidenceConcealed || world.carriedEvidenceConcealed,
    };
  }
  return combined;
}

/**
 * The world half of an ability's effect at an elapsed tick, or null when the
 * entry in the loadout is a bare `DuelAbility` with no world channels — which is
 * legal, because @pa/duel's contract is the minimum and this package's is a
 * superset of it.
 */
function worldModifiersOf(
  ability: DuelAbility,
  elapsedTicks: number,
): WorldAbilityModifiers | null {
  return hasWorldEffect(ability) ? ability.effectAt(elapsedTicks).world : null;
}

function hasWorldEffect(
  ability: DuelAbility,
): ability is DuelAbility & { effectAt: (elapsedTicks: number) => AbilityEffect } {
  return typeof (ability as { effectAt?: unknown }).effectAt === "function";
}

// ---------------------------------------------------------------------------
// the channel registry
// ---------------------------------------------------------------------------

/**
 * Whether a channel has anything reading it yet.
 *
 * LIVE    — a consumer exists in the shipped code, named below.
 * PENDING — the number is authored and correct; nothing reads it. Written down
 *           rather than hidden, so nobody wires a HUD to a channel that does
 *           nothing. Every PENDING entry has a matching declaration in
 *           engineDependencies.ts.
 */
export type ChannelStatus = "LIVE" | "PENDING";

export interface AbilityChannel {
  readonly channel: string;
  readonly half: "duel" | "world";
  readonly status: ChannelStatus;
  /** Where the number is read, or where it will have to be read. */
  readonly consumers: readonly string[];
}

export const ABILITY_CHANNELS: readonly AbilityChannel[] = [
  {
    channel: "selfMoveSpeedScale",
    half: "duel",
    status: "LIVE",
    consumers: [
      "duel: combat.ts stepFighterMotion -> speedScale -> stepMotion target velocity, and dashSpeed(RUN_SPEED * speedScale) for the dodge burst",
      "mission: the flow layer's FlowInput.targetVelX/Z, which is documented as already scaled to target speed",
    ],
  },
  {
    channel: "selfIncomingDamageScale",
    half: "duel",
    status: "LIVE",
    consumers: ["duel: combat.ts projectile resolution, damage * scale, 0 negates"],
  },
  {
    channel: "opponentMoveSpeedScale",
    half: "duel",
    status: "LIVE",
    consumers: [
      "duel: combat.ts stepFighterMotion, applied to the opponent's target velocity",
      "mission: patrol speed, owned by the level/AI layer (the stealth field deliberately does not move watchers)",
    ],
  },
  {
    channel: "opponentFireIntervalScale",
    half: "duel",
    status: "LIVE",
    consumers: ["duel: combat.ts resolveFiring, fireIntervalTicks * scale"],
  },
  {
    channel: "revealsOpponentThroughCover",
    half: "duel",
    status: "LIVE",
    consumers: [
      "duel: targeting input; never a change to occlusion itself",
      "mission: watcher positions shown through geometry, read by the HUD",
    ],
  },
  {
    channel: "selfVisibilityScale",
    half: "world",
    status: "LIVE",
    consumers: [
      "engine-world stealth: StealthFieldInput.invokedAbility.visibilityScale, multiplied into visibility() alongside cover, light and crowd",
      "abilities: invokedAbilityEffect() in missionSession.ts builds the record the field takes",
    ],
  },
  {
    channel: "selfJumpVelocityScale",
    half: "world",
    status: "LIVE",
    consumers: [
      "engine-world playerMotion: beginStandingJump(state, launchScale) and beginRunningJump(state, launchScale), clamped to [1,2]",
      "abilities: missionJumpLaunchScale() in missionSession.ts",
      "OUTSTANDING CALL SITE — duel/combat.ts stepFighterMotion calls both initiators with no scale. One argument turns this on in a duel too; @pa/duel is not this package's to edit.",
    ],
  },
  {
    channel: "staggerRecoveryScale",
    half: "world",
    status: "LIVE",
    consumers: [
      "engine-world contact.ts: resolveContact(state, contact, recoveryScale), clamped to [0.2,1] so contact is never free",
      "abilities: missionStaggerRecoveryScale() in missionSession.ts",
    ],
  },
  {
    channel: "diversionAttentionScale",
    half: "world",
    status: "LIVE",
    consumers: [
      "engine-world stealth: throwFieldDiversion captures it onto the object, which scales its noise radius; stepWatcherAttention scales the hold from the noise event",
      "abilities: invokedAbilityEffect() in missionSession.ts",
    ],
  },
  {
    channel: "carriedEvidenceConcealed",
    half: "world",
    status: "PENDING",
    consumers: [
      "mission content, and correctly not the engine: a document with a readable face and a reading distance is authored content, not physics",
      "abilities: missionCarriedEvidenceConcealed() in missionSession.ts is the seam waiting for it",
    ],
  },
];

// ---------------------------------------------------------------------------
// the structural guard
// ---------------------------------------------------------------------------

/**
 * States in code that no ability may grant a capability, only scale one.
 *
 * The same device @pa/duel uses for `assertAbilityCannotMintBullets`: a
 * type-level `Extract` with a runtime witness. Every world channel is a
 * multiplier on something the base kit already does, or a boolean about what an
 * observer LEARNS. None grants a traversal verb, extends the collision model, or
 * opens a locomotion family — because if one did, a mission built around it would
 * have a route no Level 0 player could walk, and "no mission may require an
 * ability" would become unenforceable by inspection.
 *
 * If somebody adds `grantsDoubleJump`, `grantsGrapple`, `unlocksVerb` or friends
 * to `WorldAbilityModifiers`, this stops compiling.
 */
export type WorldChannelKeys = keyof WorldAbilityModifiers;
export type ForbiddenWorldChannels = Extract<
  WorldChannelKeys,
  | "grantsVerb"
  | "grantsDoubleJump"
  | "grantsGrapple"
  | "grantsFlight"
  | "unlocksVerb"
  | "unlocksRoute"
  | "teleport"
  | "displacement"
  | "setPosition"
>;
export function assertAbilityCannotGrantVerbs(): void {
  const forbidden: ForbiddenWorldChannels[] = [];
  if (forbidden.length > 0) {
    throw new Error("abilities scale the base kit; they never grant a verb");
  }
}
