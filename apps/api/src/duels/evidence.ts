// The server-authoritative evidence gate, shared by the boss duel and PvP.
//
// A duel answer is now TWO claims, not one: the prose the classifier grades, and the
// Codex cards the player placed to support it. This module is the authority for the
// second claim. It re-derives the offered hand for the server-selected item, checks
// that a submitted selection is one a legitimate client could have produced, and
// grades whether the placed cards actually support the answer — all against the
// server's own policy, so the client's idea of which card is "relevant" is never
// trusted.
//
// WHY A BAD SELECTION IS NEVER A 4xx. On the boss-duel wire every non-2xx grants the
// full magazine (the client's 1.5s cap mints a timeout verdict — see
// ../routes/duels.ts). So refusing an illegal selection would PAY a cheating client.
// Instead an illegal or insufficient selection is graded as EVIDENCE NOT SATISFIED,
// which folds into a WRONG verdict when the prose was CORRECT. The parser is lenient
// for the same reason: a malformed `selectedCardIds` is coerced to "no evidence
// placed", never a rejection.
//
// WHAT NEVER CROSSES THE WIRE. The policy's relevant/accepted/incompatible cards stay
// here. The feedback code this returns (TOO_FEW, INCOMPATIBLE, …) is a misconception
// CLASS, not the answer: "you placed too few supporting cards" never says which cards
// those were.

import {
  evidencePolicyFrom,
  evidenceHandProjection,
  gradeEvidenceSelection,
  m1EvidenceRelevantCardIds,
  validateEvidenceSelection,
  M1_CODEX_CARD_IDS,
  type EvidenceHandProjection,
  type EvidencePolicy,
} from "@pa/mission-m1";

/** A hard cap on how many card ids a submission may carry, before it is even looked
 * at. The largest legal hand is the nine-card M1 deck; anything beyond a small
 * multiple of that is a malformed or hostile body and is truncated rather than
 * processed. Truncation only ever makes a selection LESS satisfying, never more. */
const MAX_SELECTED_CARDS = 32;
/** A card id is a bounded string everywhere else; bound it here too. */
const MAX_CARD_ID_CHARS = 200;

/**
 * A non-leaking feedback code for the answering player. Every value names a class of
 * mistake, never the cards that would have been right:
 *
 *   OK           the evidence supports the answer.
 *   MISSING      no cards were placed at all.
 *   TOO_FEW      not enough supporting cards (a misconception: prose without proof).
 *   INCOMPATIBLE a card that contradicts the answer was placed.
 *   NOT_OFFERED  a card that was not in the dealt hand — an illegitimate client.
 *   DUPLICATE    the same card placed twice.
 *   TOO_MANY     more cards than the hand holds.
 *   UNAUTHORIZED a card the player is not entitled to hold.
 */
export type EvidenceFeedback =
  | "OK"
  | "MISSING"
  | "TOO_FEW"
  | "INCOMPATIBLE"
  | "NOT_OFFERED"
  | "DUPLICATE"
  | "TOO_MANY"
  | "UNAUTHORIZED";

export interface EvidenceEvaluation {
  /** Whether the placed cards support a correct answer under the server's policy. */
  readonly satisfied: boolean;
  /** The misconception class, safe to return to the answering player. */
  readonly feedback: EvidenceFeedback;
  /** The normalised selection actually evaluated (deduped, capped). For audit. */
  readonly selected: readonly string[];
}

/**
 * Coerce whatever arrived on the wire into a bounded array of card-id strings.
 *
 * LENIENT BY DESIGN: an absent, non-array, or partly-malformed value becomes the
 * cards it can legitimately read (dropping non-strings), never a rejection. A body
 * that is not the shape a real client sends simply placed fewer valid cards.
 */
export function parseSelectedCardIds(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    if (entry.length === 0 || entry.length > MAX_CARD_ID_CHARS) continue;
    out.push(entry);
    if (out.length >= MAX_SELECTED_CARDS) break;
  }
  return out;
}

/**
 * Grade a submitted selection against a policy and the caller's authorised cards.
 *
 * Never throws and never refuses: an illegal selection returns `satisfied: false`
 * with the reason, so the caller can fold it into a WRONG verdict rather than a
 * refusal the client turns into a full magazine.
 */
export function evaluateEvidence(
  policy: EvidencePolicy,
  selectedCardIds: readonly string[],
  authorizedCardIds: readonly string[],
): EvidenceEvaluation {
  const selected = parseSelectedCardIds(selectedCardIds);
  if (selected.length === 0) {
    return { satisfied: false, feedback: "MISSING", selected: [] };
  }
  const legal = validateEvidenceSelection(policy, selected, authorizedCardIds);
  if (!legal.ok) {
    return { satisfied: false, feedback: legal.code, selected };
  }
  const grade = gradeEvidenceSelection(policy, legal.selected);
  return {
    satisfied: grade.satisfied,
    feedback: grade.satisfied ? "OK" : grade.reason === "INCOMPATIBLE" ? "INCOMPATIBLE" : "TOO_FEW",
    selected: legal.selected,
  };
}

/**
 * The M1 evidence policy for an item, drawn from a caller-controlled deck.
 *
 * `deck` is the card universe distractors are drawn from — the full nine M1 cards by
 * default (the boss-duel case, where the player holds them all). PvP passes the
 * intersection of BOTH players' legal cards so the two sides derive an identical hand
 * and every offered card is one both players are entitled to place.
 */
export function m1EvidencePolicyFor(
  itemId: string,
  deck: readonly string[] = M1_CODEX_CARD_IDS,
): EvidencePolicy {
  return evidencePolicyFrom({
    itemId,
    relevantCardIds: m1EvidenceRelevantCardIds(itemId),
    allCardIds: deck,
  });
}

/** The safe public projection of an item's policy, for a client to render a hand. */
export function m1EvidenceProjectionFor(
  itemId: string,
  deck: readonly string[] = M1_CODEX_CARD_IDS,
): EvidenceHandProjection {
  return evidenceHandProjection(m1EvidencePolicyFor(itemId, deck));
}
