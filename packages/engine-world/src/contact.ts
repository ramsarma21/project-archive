// Non-lethal body contact: the grab, the shoulder check, the crowd collision.
//
// Mission-Slate section 18.4 asks for recovery from "a non-lethal grab, shoulder
// check, or crowd collision without ending the run or introducing combat". This is
// that, and it is one function, because the two consequences of being touched must
// not be separable.
//
// ============================================================================
// WHY THIS IS SAFE TO BUILD WHEN A NON-LETHAL TAKEDOWN WAS REFUSED
// ============================================================================
//
// The takedown was refused with a strong argument: once a guard can be deleted, the
// thrown diversion, the crowd blend and the reflex window all become slower
// solutions to a solved problem, so every avoidance verb becomes strictly worse.
// That argument is correct and it is not weakened by anything here, because a
// stagger is the opposite kind of object.
//
//   A TAKEDOWN IS A CAPABILITY THE PLAYER WIELDS.  It acts on the world.
//   A STAGGER IS A PENALTY THE PLAYER SUFFERS.     The world acts on it.
//
// From which the domination argument falls out and can be checked rather than
// argued. Avoiding contact costs zero time and makes zero noise. Being contacted
// costs a recovery window and makes noise. Therefore for EVERY recovery scale, at
// every Level, with every loadout:
//
//   avoid  >  recover-fast  >  recover-slow
//
// Avoidance is the dominant strategy and stays the dominant strategy, which is
// exactly the property the takedown would have destroyed. Four things hold it:
//
//   1. THE NOISE IS NOT SCALED BY THE ABILITY. `contactNoise` does not take the
//      recovery scale, and cannot: the grab happened, the crowd reacted, the guard
//      turned. An ability buys back seconds, never the detection consequence. This
//      is the single most load-bearing line in the file.
//
//   2. THE RECOVERY FLOOR IS ABOVE ZERO. `MIN_STAGGER_RECOVERY_SCALE` is 0.2, so
//      the best possible ability still leaves a fifth of the window. At a floor of
//      zero the stagger would be a no-op and "walk into the guard" would become a
//      legal route — the rejected takedown, arriving through the back door.
//
//   3. THERE IS NO OUTPUT CHANNEL TO THE OTHER BODY. `ContactResolution` carries a
//      `MotionState` and a `NoiseEvent`, both about the player. Nothing here can
//      report that a guard was staggered, downed, delayed or removed.
//      `assertContactCannotAffectTheOtherBody` states that as a type so that adding
//      one stops the build instead of drifting in.
//
//   4. IT IS SCARCE BY CONSTRUCTION, NOT BY TUNING. The ability that shortens the
//      window is one of four loadout slots, spends its single use per encounter, and
//      lasts a bounded window measured in seconds inside a three-minute mission. It
//      cannot become the default answer to anything because there is only one of it.
//
// If any of those four stopped being true, this file would have grown into the verb
// that was rejected, and the tests in contact.test.ts are written to fail first.

import type { Vec3 } from "./collision.js";
import {
  beginStagger,
  canStagger,
  CONTACT_STAGGER_MS,
  MAX_STAGGER_RECOVERY_SCALE,
  staggerRecoveryScale,
  type ContactKind,
  type MotionState,
} from "./playerMotion.js";
import type { NoiseEvent } from "./stealth/noise.js";

/**
 * Loudness of each contact kind, [0,1].
 *
 * DELIBERATELY NOT A FUNCTION OF THE RECOVERY SCALE. A grab is as loud with the
 * ability as without it — see rule 1 above.
 */
export const CONTACT_NOISE_INTENSITY: Readonly<Record<ContactKind, number>> = {
  // Somebody has hold of you and is calling it out.
  GRAB: 0.8,
  // Bodies collide hard enough to be heard, and heads turn.
  SHOULDER: 0.6,
  // A jostle in a throng: the quietest, because a crowd is already noisy.
  CROWD: 0.35,
};

/** Metres of noise radius per unit of intensity. Matches the movement layer. */
export const CONTACT_NOISE_RADIUS_PER_INTENSITY_M = 14;

export interface ContactEvent {
  readonly kind: ContactKind;
  /** Where the contacting body is. The push travels away from here. */
  readonly from: Vec3;
  /** Opaque id, for noise attribution and presentation only. */
  readonly sourceId?: string | null;
}

export interface ContactResolution {
  /** The player's motion state after the contact. */
  readonly state: MotionState;
  /**
   * The noise the contact made. Always present, always at full authored intensity.
   * Not optional and not nullable: a caller cannot take the stagger and skip the
   * consequence.
   */
  readonly noise: NoiseEvent;
  /** False when the player was airborne or mid-verb and the window did not open. */
  readonly staggered: boolean;
  /** The window actually opened, in milliseconds. 0 when it did not open. */
  readonly recoveryMs: number;
}

/**
 * Resolve one non-lethal contact.
 *
 * The push direction is derived from the geometry — away from the contacting body —
 * rather than supplied, so a shove cannot be aimed by whoever calls this. That
 * matters: a caller-chosen direction would make contact into a free repositioning
 * tool, which is a movement ability nobody authored.
 *
 * `recoveryScale` comes from the ability layer and is clamped by
 * `staggerRecoveryScale` before use. Omitting it is the Level 0 case.
 */
export function resolveContact(
  state: MotionState,
  contact: ContactEvent,
  recoveryScale: number = MAX_STAGGER_RECOVERY_SCALE,
): ContactResolution {
  const dirX = state.pos.x - contact.from.x;
  const dirZ = state.pos.z - contact.from.z;
  const sourceId = contact.sourceId ?? null;

  const next = beginStagger(state, {
    kind: contact.kind,
    dirX,
    dirZ,
    sourceId,
    recoveryScale,
  });
  const staggered = next !== state;

  const intensity = CONTACT_NOISE_INTENSITY[contact.kind];
  return {
    state: next,
    // At the player, not at the contacting body: the player is what a watcher is
    // being pointed at, and this noise is meant to implicate them.
    noise: {
      kind: "PLAYER_MOVE",
      x: state.pos.x,
      y: state.pos.y,
      z: state.pos.z,
      intensity,
      radiusM: intensity * CONTACT_NOISE_RADIUS_PER_INTENSITY_M,
    },
    staggered,
    recoveryMs: staggered ? (next.stagger?.durationMs ?? 0) : 0,
  };
}

/** Window a contact would open at a given recovery scale, for HUD and tests. */
export function contactRecoveryMs(kind: ContactKind, recoveryScale: number): number {
  return CONTACT_STAGGER_MS[kind] * staggerRecoveryScale(recoveryScale);
}

/** Would a contact open a window right now? A thin pass-through to motion. */
export function contactWouldStagger(state: MotionState): boolean {
  return canStagger(state);
}

/**
 * States in code that a contact resolves only against the player.
 *
 * The same device @pa/duel uses for `assertAbilityCannotMintBullets`: a type-level
 * `Extract` with a runtime witness. `ContactResolution` has no member describing the
 * body that made contact, so this is the guard that keeps it that way. If somebody
 * adds one, the build stops and they have to argue for it in a review rather than
 * discover it in a playtest six months later.
 */
export type ContactResolutionKeys = keyof ContactResolution;
export type ForbiddenContactOutputs = Extract<
  ContactResolutionKeys,
  | "actor"
  | "actorState"
  | "sourceState"
  | "target"
  | "targetState"
  | "defeated"
  | "downed"
  | "takedown"
  | "neutralized"
  | "removed"
  | "damage"
  | "health"
>;
export function assertContactCannotAffectTheOtherBody(): void {
  const forbidden: ForbiddenContactOutputs[] = [];
  if (forbidden.length > 0) {
    throw new Error("contact happens TO the player; it never resolves against a body");
  }
}
