// Match identity and the participant model.
//
// The shape here is driven by one rule: A CLIENT NEVER LEARNS WHO IT IS PLAYING.
// A participant carries a profileId because the server needs it for standing, the
// verdict receipt binding and the Codex check — but `profileId` never appears in
// anything projected to a client (see projection.ts). What crosses to a client is a
// side letter, a generated handle and a Rank. That is enough to render a duel and
// not enough to identify a classmate.

import type { DuelSide } from "@pa/duel";
import type { CosmeticLoadout } from "./cosmetics.js";

export type MatchId = string;
export type ProfileId = string;

export { type DuelSide as MatchSide };

/**
 * Everything the server knows about one player in one match.
 *
 * `abilityIds` is the PERMANENT pool — every ability the profile has ever unlocked,
 * whatever chapter minted it — because PvP is not chapter-scoped. It is resolved
 * against the four-slot cap by @pa/abilities, never here.
 */
export interface PvpParticipant {
  readonly profileId: ProfileId;
  readonly handle: string;
  readonly rank: number;
  /** Permanent unlock pool, resolved and slot-capped by @pa/abilities. */
  readonly unlockedAbilityIds: readonly string[];
  /** Chosen equip order; the resolver falls back to newest-first. */
  readonly selectedAbilityIds?: readonly string[];
  /** Purely presentational. Never reaches the simulation. */
  readonly cosmetics: CosmeticLoadout;
  /** Concepts this profile may be ASKED about: 100% mastery only. */
  readonly pvpLegalCardIds: readonly string[];
}

export type MatchPhase =
  /** Both players accepted; the authority is simulating. */
  | "LIVE"
  /** Ended with an outcome from the simulation. */
  | "RESOLVED"
  /** Ended without one: a disconnect past the grace window, or an abandon. */
  | "FORFEITED";

export interface MatchIdentity {
  readonly matchId: MatchId;
  readonly seed: number;
  readonly startedAtMs: number;
}

/** Which concepts a match may draw questions from: the intersection of both Codexes. */
export function sharedPvpLegalCards(
  a: PvpParticipant,
  b: PvpParticipant,
): readonly string[] {
  const held = new Set(b.pvpLegalCardIds);
  // Intersection, not union: asking a question only one side could hold is the
  // definition of an unfair duel, and it is the direction a naive implementation
  // fails in, because each player's own Codex is the obvious source.
  return a.pvpLegalCardIds.filter((cardId) => held.has(cardId)).sort();
}

export function otherParticipant(
  participants: { readonly A: PvpParticipant; readonly B: PvpParticipant },
  side: DuelSide,
): PvpParticipant {
  return side === "A" ? participants.B : participants.A;
}
