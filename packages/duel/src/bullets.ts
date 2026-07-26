// The bullet economy, as a pure reducer over a committed verdict.
//
// This is the whole of the game's knowledge-to-power conversion, and it is
// eleven lines of arithmetic wrapped in one guarantee: the only input that can
// change a bullet count is a verdict. Nothing here reads a request body, a model
// response, or a client-supplied number.
//
// PvP symmetry falls out rather than being special-cased. The brief states the
// PvP table as "both wrong grants 1 each, both correct grants 3 each, otherwise
// 3 against 1" — which is exactly `bulletsForVerdict` applied once per side.
// There is no two-player branch in this file, and that is the point: the same
// function serves player-versus-boss and player-versus-player.

import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  BULLET_CARRY_POLICY,
  type BulletCarryPolicy,
} from "./tuning.js";
import type { VerdictKind } from "./verdict.js";

/**
 * Where a side's round magazine comes from.
 *
 * VERDICT is the only source available to a human side, in either mode.
 * AUTHORED exists for a boss, whose magazine is authored content in its profile
 * rather than something it earns by answering — see `roundAmmoSources` in
 * machine.ts, which refuses AUTHORED for any side that owes a verdict.
 */
export type AmmoSource =
  | { readonly kind: "VERDICT"; readonly verdict: VerdictKind }
  | { readonly kind: "AUTHORED"; readonly bullets: number };

export interface BulletGrant {
  /** Derived from the verdict (or the authored profile) for this round. */
  readonly granted: number;
  /** Unspent bullets that survived the boundary under the carry policy. */
  readonly carriedIn: number;
  /** Unspent bullets destroyed at the boundary. */
  readonly expired: number;
  /** What the side actually fights this round with. */
  readonly magazine: number;
  readonly source: AmmoSource["kind"];
}

/** The entire knowledge-to-power conversion. */
export function bulletsForVerdict(verdict: VerdictKind): number {
  return verdict === "CORRECT" ? BULLETS_FOR_CORRECT : BULLETS_FOR_WRONG;
}

export function bulletsForSource(source: AmmoSource): number {
  return source.kind === "VERDICT"
    ? bulletsForVerdict(source.verdict)
    : Math.max(0, Math.trunc(source.bullets));
}

/** Split unspent bullets into what survives the boundary and what is destroyed. */
export function applyCarryPolicy(
  unspent: number,
  policy: BulletCarryPolicy = BULLET_CARRY_POLICY,
): { readonly carried: number; readonly expired: number } {
  const held = Math.max(0, Math.trunc(unspent));
  if (policy.kind === "EXPIRE") return { carried: 0, expired: held };
  const carried = Math.min(held, Math.max(0, Math.trunc(policy.cap)));
  return { carried, expired: held - carried };
}

export interface GrantRoundBulletsInput {
  readonly source: AmmoSource;
  readonly unspentFromPreviousRound: number;
  readonly policy?: BulletCarryPolicy;
}

export function grantRoundBullets(input: GrantRoundBulletsInput): BulletGrant {
  const { carried, expired } = applyCarryPolicy(
    input.unspentFromPreviousRound,
    input.policy ?? BULLET_CARRY_POLICY,
  );
  const granted = bulletsForSource(input.source);
  return {
    granted,
    carriedIn: carried,
    expired,
    magazine: carried + granted,
    source: input.source.kind,
  };
}

/**
 * The total a side can fire across a whole duel if every verdict goes one way.
 * Used by the boss winnability invariant, and worth having as a named function
 * because it is the number the entire damage model is derived from.
 */
export function lifetimeBullets(
  verdict: VerdictKind,
  rounds: number,
  policy: BulletCarryPolicy = BULLET_CARRY_POLICY,
): number {
  // Carry cannot create bullets, only defer them, so the lifetime total is the
  // per-round grant times the round count under either policy.
  void policy;
  return bulletsForVerdict(verdict) * rounds;
}
