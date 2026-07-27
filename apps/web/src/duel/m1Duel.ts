// M1's duel, assembled.
//
// This is content selection, not mechanism: which boss profile, which arena, which
// authored items, which rigs. A mission hands one of these to `DuelScreen` and the
// presentation layer knows nothing else about M1.
//
// Note what is not here: a length. The duel runs until someone falls, so M1 supplies
// a bank of items rather than a round-by-round schedule, and nothing in this file
// knows or could say how many rounds the fight will take.
//
// M1 is the format's clean base case (Mission-Slate 4.8): a first-mission player is
// Level 0 and has unlocked no abilities at all, so the loadout is empty and the duel
// is decided entirely by knowledge and movement.

import { bossProfileForTier, M1_BOSS_TACTICS, projectFieldSeed, type BossTier } from "@pa/duel";
import { yardArena } from "./arenaSpec.js";
import { m1QuestionBank } from "./duelItems.js";
import type { DuelDescriptor } from "./DuelScreen.js";

export const M1_BOSS_ID = "BOS.MD01.BOSS.OFFICER.v1";
export const M1_DUEL_ID = "BOS.MD01.DUEL";

/** The player rig, and the red-coated officer who enforces the Act. */
export const PLAYER_RIG = "playerboy-rigged";
export const OFFICER_RIG = "officer-rigged";

export interface M1DuelOptions {
  /** Attempt ordinal, 1-3. Folded into the seed so each attempt differs. */
  readonly attempt?: number;
  /** M1 is tier 1. Higher tiers exist for later missions on the same format. */
  readonly tier?: BossTier;
  readonly seed?: number;
}

export function m1DuelDescriptor(options: M1DuelOptions = {}): DuelDescriptor {
  const attempt = options.attempt ?? 1;
  const arena = yardArena();
  return {
    duelId: `${M1_DUEL_ID}.A${attempt}`,
    seed: options.seed ?? projectFieldSeed([M1_DUEL_ID, "attempt", attempt]),
    arena,
    opponent: {
      kind: "BOSS",
      // M1's officer is the symmetric-complement boss: a correct answer arms him
      // with 7 balls and a wrong one with 14, the mirror of the player's own
      // award (BossAmmoPolicy / complementaryBossBullets in @pa/duel). He also
      // physically breaks off behind yard cover and crouches before each question,
      // rather than freezing in the open while the overlay opens — and he now
      // fights to an ammo-aware tactical plan (M1_BOSS_TACTICS): armed he trades in
      // the open, low he peeks from cover, and out of ammo he ducks behind imported
      // cover and holds instead of standing exposed. See @pa/duel bossAi.ts.
      profile: bossProfileForTier(options.tier ?? 1, M1_BOSS_ID, {
        ammoPolicy: "SYMMETRIC_COMPLEMENT",
        takesCoverBeforeQuestion: true,
        tactical: M1_BOSS_TACTICS,
      }),
    },
    questionBank: m1QuestionBank(),
    playerLoadout: [],
    playerGlbKey: PLAYER_RIG,
    opponentGlbKey: OFFICER_RIG,
    // Mission-Slate 4.8 calls him the constable; the production rig is a red-coated
    // King's officer. The mission container owns the character's name, so this is a
    // neutral label rather than a decision made here.
    opponentName: "The King's officer",
  };
}
