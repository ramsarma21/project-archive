import { M1_CODEX_GROUPS, type M1CodexCard } from "./m1Codex.js";

// How a Codex card reads to the player right now: what they hold, and whether the
// temporary playtest access is lending it to PvP.
//
// The durable truth is `progression.view.codex` — two lists the server minted:
// `learnedCardIds` (held in single-player) and `pvpLegalCardIds` (minted only at 100%
// mastery on the capstone). This layer never writes to either; it reads them and
// decides a label. The one extra thing it knows is that the server is currently in a
// TEMPORARY playtest position where every M1 card is usable in PvP regardless of
// mastery — and it says so with a distinct chip rather than by pretending the card is
// legitimately PvP-legal, so nothing here fakes learning or mastery.

/**
 * Whether the temporary all-cards PvP access is active on the CLIENT's understanding.
 *
 * MUST mirror the server's `M1_PVP_CARD_ACCESS`. It is PLAYTEST_ALL today, so this is
 * true and locked/learned cards additionally read "PvP trial access". Flip this ONE
 * value to false the same day the server flips to ASSESSMENT_PASSED, and the trial
 * chips disappear — the durable LEARNED / PVP LEGAL / LOCKED states are unchanged
 * because they never depended on it.
 */
export const M1_PVP_TRIAL_ACCESS = true;

/** The durable state a card can be in, most-earned first. */
export type CodexCardStatus = "PVP_LEGAL" | "LEARNED" | "LOCKED";

export interface CodexStandingLike {
  readonly learnedCardIds: readonly string[];
  readonly pvpLegalCardIds: readonly string[];
}

export interface CodexCardView {
  readonly cardId: string;
  readonly conceptId: string;
  /** The module card that teaches this. Presentation uses it for the source line. */
  readonly sourceCueId: string;
  readonly title: string;
  readonly proposition: string;
  readonly status: CodexCardStatus;
  /**
   * True when the temporary playtest access is what makes this card usable in PvP —
   * i.e. access is on and the card is NOT already legitimately PvP-legal. Presentation
   * only; it never turns a LOCKED card into a LEARNED one.
   */
  readonly trialAccess: boolean;
}

export interface CodexGroupView {
  readonly conceptId: string;
  readonly label: string;
  readonly cards: readonly CodexCardView[];
}

/** The durable status of one card, from the two server lists. */
export function codexCardStatus(
  cardId: string,
  codex: CodexStandingLike,
): CodexCardStatus {
  if (codex.pvpLegalCardIds.includes(cardId)) return "PVP_LEGAL";
  if (codex.learnedCardIds.includes(cardId)) return "LEARNED";
  return "LOCKED";
}

function viewForCard(
  card: M1CodexCard,
  codex: CodexStandingLike,
  trialAccessActive: boolean,
): CodexCardView {
  const status = codexCardStatus(card.cardId, codex);
  return {
    cardId: card.cardId,
    conceptId: card.conceptId,
    sourceCueId: card.sourceCueId,
    title: card.title,
    proposition: card.proposition,
    status,
    // Trial access lends PvP legality only to a card that is not already legitimately
    // PvP-legal. A signed-out preview holds nothing, so every card is LOCKED and — if
    // access is on — carries the trial chip, and never claims to be learned.
    trialAccess: trialAccessActive && status !== "PVP_LEGAL",
  };
}

/**
 * The whole Codex as the screen renders it: the authored nine, grouped by concept,
 * each carrying its player-facing status. Definitions come from the authored file;
 * status comes from the standing; nothing is invented.
 */
export function codexGroupsView(
  codex: CodexStandingLike,
  trialAccessActive: boolean = M1_PVP_TRIAL_ACCESS,
): readonly CodexGroupView[] {
  return M1_CODEX_GROUPS.map((group) => ({
    conceptId: group.conceptId,
    label: group.label,
    cards: group.cards.map((card) => viewForCard(card, codex, trialAccessActive)),
  }));
}

/** The label a status chip shows. */
export function codexStatusLabel(status: CodexCardStatus): string {
  switch (status) {
    case "PVP_LEGAL":
      return "PvP legal";
    case "LEARNED":
      return "Learned";
    case "LOCKED":
      return "Locked";
  }
}
