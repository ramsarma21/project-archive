// Who is allowed to be asked about which M1 Codex cards in PvP — the ONE reversible
// toggle that makes card-backed PvP work today and closes it later.
//
// The PvP-legal card gate in @pa/pvp is now live (`OPEN_PLAYTEST_GATES`), so a
// question can only be asked if BOTH players hold every card it draws on. That gate
// needs an answer to a question this file owns: which cards does the SERVER attribute
// to a caller? Never the client — a card set that came off the wire is a self-granted
// power — so it is derived here from an explicit access policy and, when the policy
// demands it, from the authoritative progression snapshot.

import { isCodexCardPvpLegal } from "@pa/contracts";

export type M1PvpCardAccess = "PLAYTEST_ALL" | "ASSESSMENT_PASSED";

/**
 * The shipping policy's whole reading of progression, in one place.
 *
 * `app.ts` wires this as `pvpLegalCardIds`, and a test can drive the SAME
 * function against a real snapshot. It lived as a two-line closure inside the
 * app wiring, which made the one rule the shipping gate turns on the only
 * part of that gate no test could reach without re-typing it — and a re-typed
 * rule is a second implementation that agrees until it doesn't. For the same
 * reason the per-card predicate is @pa/contracts' `isCodexCardPvpLegal` rather
 * than a `!== null` written out here.
 *
 * ACCESS FOLLOWS THE CARD, NOT THE ACTIVE CHAPTER. This used to read
 * `activeChapter.assessmentPassedAt`, which `advanceChapter` resets to null on the
 * next chapter while the Codex rows keep their `pvpLegalAt` forever — so a student
 * who passed Boston and moved to chapter two lost the nine cards they had earned,
 * while their Codex screen went on showing them as PvP-legal. The server refused
 * what the UI promised. A minted card is now kept for good, which is both the
 * owner's decision and what the durable record already said.
 *
 * WHAT THIS DOES NOT DO: make minting easier. It reads `pvpLegalAt`; only
 * `submitChapterAssessment` ever writes it, at 100% mastery of the card's concept.
 * Widening who may mint is a separate, load-bearing decision — see the invariant
 * in `pvp-shipping-card-gate.test.ts`.
 */
export function pvpLegalCardIdsFromSnapshot(snapshot: {
  readonly codex: readonly { readonly cardId: string; readonly pvpLegalAt: string | null }[];
}): readonly string[] {
  return snapshot.codex.filter(isCodexCardPvpLegal).map((card) => card.cardId);
}

/**
 * THE ONE VALUE TO CHANGE to open or close temporary M1 PvP card access.
 *
 *   PLAYTEST_ALL      Every caller carries all nine M1 Codex cards, whatever they
 *                     have learned or mastered, so any two players share the whole
 *                     eligible pool. This is the temporary playtest position, and it
 *                     mutates NOTHING durable — no Codex DB row is written to fake a
 *                     grant, so reverting is genuinely one value.
 *
 *   ASSESSMENT_PASSED The shipping position. A caller carries exactly the M1 cards
 *                     the authoritative progression snapshot says the chapter
 *                     assessment (the capstone) has MINTED PvP-legal for them, and
 *                     no others. It gates on assessment mastery and NOT on mission
 *                     clear. Flip this one value and access closes until a concept
 *                     has been mastered.
 *
 *                     The name is about what MINTS the card — 100% concept mastery on
 *                     the chapter assessment — not about a whole assessment having
 *                     been passed. `assessmentPassedAt` is deliberately not read; see
 *                     `pvpLegalCardIdsFromSnapshot`.
 */
export const M1_PVP_CARD_ACCESS: M1PvpCardAccess = "PLAYTEST_ALL";

export interface PvpCardResolverDeps {
  /** The full M1 card set the policy may grant, server-derived (never hand-listed). */
  readonly m1CardIds: readonly string[];
  /**
   * Every card the caller's authoritative progression snapshot records as PvP-legal.
   * Only consulted under ASSESSMENT_PASSED — under PLAYTEST_ALL nothing reads the
   * snapshot, so the temporary grant has no progression dependency at all.
   */
  readonly pvpLegalCardIds: (profileId: string) => Promise<readonly string[]>;
  /** Overridable so a test can drive both policy branches. Defaults to the constant. */
  readonly policy?: M1PvpCardAccess;
  readonly log?: { warn: (obj: unknown, msg: string) => void };
}

/**
 * Build the resolver the PvP routes call to learn a caller's server-side PvP card ids.
 *
 * Under PLAYTEST_ALL it returns the full M1 set unconditionally. Under
 * ASSESSMENT_PASSED it returns the M1 cards the caller has actually had minted, and
 * FAILS CLOSED — a snapshot that cannot be read grants nothing rather than leaking
 * access, matching how `masteredConcepts` withholds capstone items on an unreadable
 * profile.
 *
 * TWO NARROWINGS, both deliberate. The result is filtered THROUGH `m1CardIds`, so a
 * card minted by some future chapter cannot leak into a pool built from M1's bank,
 * and a card id the snapshot carries that the bank has never heard of is dropped
 * rather than handed to `askableItems`. Filtering the authored M1 order (rather than
 * mapping the snapshot's rows) also makes the result independent of database row
 * order, which the match's evidence deck is derived from positionally.
 */
export function pvpCardResolver(
  deps: PvpCardResolverDeps,
): (profileId: string) => Promise<readonly string[]> {
  const policy = deps.policy ?? M1_PVP_CARD_ACCESS;
  return async (profileId: string): Promise<readonly string[]> => {
    if (policy === "PLAYTEST_ALL") return deps.m1CardIds;
    try {
      const minted = new Set(await deps.pvpLegalCardIds(profileId));
      return deps.m1CardIds.filter((cardId) => minted.has(cardId));
    } catch (cause) {
      deps.log?.warn(
        { cause, profileId },
        "pvp: codex state unreadable; withholding M1 cards",
      );
      return [];
    }
  };
}
