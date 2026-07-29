// Who is allowed to be asked about which M1 Codex cards in PvP — the ONE reversible
// toggle that makes card-backed PvP work today and closes it later.
//
// The PvP-legal card gate in @pa/pvp is now live (`OPEN_PLAYTEST_GATES`), so a
// question can only be asked if BOTH players hold every card it draws on. That gate
// needs an answer to a question this file owns: which cards does the SERVER attribute
// to a caller? Never the client — a card set that came off the wire is a self-granted
// power — so it is derived here from an explicit access policy and, when the policy
// demands it, from the authoritative progression snapshot.

export type M1PvpCardAccess = "PLAYTEST_ALL" | "ASSESSMENT_PASSED";

/**
 * The shipping policy's whole reading of progression, in one place.
 *
 * `app.ts` wires this as `assessmentPassed`, and a test can drive the SAME
 * function against a real snapshot. It lived as a two-line closure inside the
 * app wiring, which made the one predicate the shipping gate turns on the only
 * part of that gate no test could reach without re-typing it — and a re-typed
 * predicate is a second implementation that agrees until it doesn't.
 *
 * NOTE WHAT IT READS: the ACTIVE chapter. `advanceChapter` makes the next
 * chapter active with its own null `assessmentPassedAt`, while the Codex rows keep
 * their `pvpLegalAt` forever — so under ASSESSMENT_PASSED this answers false again
 * for a player who passed Boston and moved on, revoking access they earned. That is
 * a live defect in the shipping branch, not an intended narrowing; it is pinned by
 * `pvp-shipping-card-gate.test.ts` so the behaviour cannot change unnoticed while
 * the owner decides whether access should follow the chapter or the card.
 */
export function assessmentPassedFromSnapshot(snapshot: {
  readonly activeChapter: { readonly assessmentPassedAt: string | null };
}): boolean {
  return snapshot.activeChapter.assessmentPassedAt !== null;
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
 *   ASSESSMENT_PASSED The shipping position. A caller carries the nine M1 cards ONLY
 *                     when the authoritative progression snapshot says the chapter
 *                     assessment (the capstone) has passed; otherwise none. It gates
 *                     on the assessment result and NOT on mission clear. Flip this one
 *                     value and access closes until the assessment is passed.
 */
export const M1_PVP_CARD_ACCESS: M1PvpCardAccess = "PLAYTEST_ALL";

export interface PvpCardResolverDeps {
  /** The full M1 card set the policy grants, server-derived (never hand-listed). */
  readonly m1CardIds: readonly string[];
  /**
   * Whether the caller's authoritative progression snapshot says the chapter
   * assessment has passed. Only consulted under ASSESSMENT_PASSED — under
   * PLAYTEST_ALL nothing reads the snapshot, so the temporary grant has no
   * progression dependency at all.
   */
  readonly assessmentPassed: (profileId: string) => Promise<boolean>;
  /** Overridable so a test can drive both policy branches. Defaults to the constant. */
  readonly policy?: M1PvpCardAccess;
  readonly log?: { warn: (obj: unknown, msg: string) => void };
}

/**
 * Build the resolver the PvP routes call to learn a caller's server-side PvP card ids.
 *
 * Under PLAYTEST_ALL it returns the full M1 set unconditionally. Under
 * ASSESSMENT_PASSED it returns the full set only once the assessment has passed, and
 * FAILS CLOSED — a snapshot that cannot be read grants nothing rather than leaking
 * access, matching how `masteredConcepts` withholds capstone items on an unreadable
 * profile.
 */
export function pvpCardResolver(
  deps: PvpCardResolverDeps,
): (profileId: string) => Promise<readonly string[]> {
  const policy = deps.policy ?? M1_PVP_CARD_ACCESS;
  return async (profileId: string): Promise<readonly string[]> => {
    if (policy === "PLAYTEST_ALL") return deps.m1CardIds;
    try {
      const passed = await deps.assessmentPassed(profileId);
      return passed ? deps.m1CardIds : [];
    } catch (cause) {
      deps.log?.warn(
        { cause, profileId },
        "pvp: assessment state unreadable; withholding M1 cards",
      );
      return [];
    }
  };
}
