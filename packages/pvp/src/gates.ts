// Every "is this player allowed to do this" switch in PvP, in one object.
//
// PvP is being opened early — unlocked, M1 concepts only — so the owner can play it
// tomorrow and decide what to change. The shipping design is stricter on three counts,
// and all three are BUILT AND WIRED, just switched off here. Turning PvP into its
// shipping form is editing this object; it is not adding a system, and the checks are
// not scattered through the package waiting to be rediscovered.
//
// Each flag names the single function that enforces it, so the enforcement path is
// greppable from the switch:
//
//   requireChapterComplete  -> assertPvpEligible (this file)
//   requirePvpLegalCards    -> askableItems       (questionPool.ts)
//   enforceRankBrackets     -> ranksCompatible    (brackets.ts)
//
// The tests cover BOTH positions of every flag, so the shipping configuration is not
// an untested code path on the day somebody flips it.

export interface PvpGates {
  /**
   * Shipping: true. A profile may only enter PvP once it has completed a chapter,
   * which is what makes Rank mean something and what keeps a brand-new player out of
   * a ranked ladder.
   *
   * Open for now because nobody has completed a chapter yet, and a gate nobody can
   * pass is indistinguishable from a broken button.
   */
  readonly requireChapterComplete: boolean;
  /**
   * Shipping: true. A concept may only be ASKED in PvP once both players have hit
   * 100% on it in a chapter capstone, which mints a PvP-legal Codex card.
   *
   * Open for now because no capstone has been sat, so no card has been minted, so the
   * askable pool would be empty and every match would fail to start.
   */
  readonly requirePvpLegalCards: boolean;
  /**
   * Shipping: true, at ±1 Rank. Off for now because with the unlock gate open nobody
   * has earned a Level, so the entire population is Rank 1 — brackets would be
   * arithmetically satisfied but meaningless, and leaving the check on invites a
   * deadlock the first time somebody does earn a Rank while others have not.
   */
  readonly enforceRankBrackets: boolean;
}

/**
 * What runs during the playtest: open on chapter completion and rank, but the
 * PvP-legal card gate is now LIVE. Both participants carry the M1 Codex cards a
 * server-side access policy grants them (see the API's `M1_PVP_CARD_ACCESS`), and
 * `askableItems` enforces the intersection — so a question can only be asked if
 * both players hold every card it draws on. Chapter-complete and rank-bracket stay
 * off because nobody has completed a chapter or earned a Rank yet, and a gate
 * nobody can pass is indistinguishable from a broken button.
 */
export const OPEN_PLAYTEST_GATES: PvpGates = {
  requireChapterComplete: false,
  requirePvpLegalCards: true,
  enforceRankBrackets: false,
};

/** What ships. Kept beside the other one so the difference is one screen. */
export const SHIPPING_GATES: PvpGates = {
  requireChapterComplete: true,
  requirePvpLegalCards: true,
  enforceRankBrackets: true,
};

/**
 * The active configuration. THIS IS THE ONE VALUE TO CHANGE.
 *
 * Flip to SHIPPING_GATES when chapter one is complete and capstones have been sat.
 * Nothing else in the package needs to change with it.
 */
export const PVP_GATES: PvpGates = OPEN_PLAYTEST_GATES;

export type EligibilityRefusal =
  | "CHAPTER_NOT_COMPLETE"
  | "NO_PVP_LEGAL_CARDS"
  | "PROFILE_UNKNOWN";

export type EligibilityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: EligibilityRefusal; readonly detail: string };

export interface PvpEligibilityInput {
  readonly profileId: string;
  /** Chapters this profile has completed, from the progression service. */
  readonly completedChapterIds: readonly string[];
  /** Cards the capstone has promoted. Empty until a capstone is sat. */
  readonly pvpLegalCardIds: readonly string[];
}

/**
 * The ONLY place the unlock gate is decided. Called once when a profile asks to queue
 * or to create a lobby; nothing downstream re-checks it, and nothing downstream
 * bypasses it.
 */
export function assertPvpEligible(
  input: PvpEligibilityInput,
  gates: PvpGates = PVP_GATES,
): EligibilityResult {
  if (!input.profileId) {
    return { ok: false, reason: "PROFILE_UNKNOWN", detail: "missing profileId" };
  }
  if (gates.requireChapterComplete && input.completedChapterIds.length === 0) {
    return {
      ok: false,
      reason: "CHAPTER_NOT_COMPLETE",
      detail: "PvP unlocks when a chapter is complete",
    };
  }
  if (gates.requirePvpLegalCards && input.pvpLegalCardIds.length === 0) {
    return {
      ok: false,
      reason: "NO_PVP_LEGAL_CARDS",
      detail: "no concept has been mastered to 100% on a capstone",
    };
  }
  return { ok: true };
}
