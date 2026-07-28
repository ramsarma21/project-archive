// The free, deterministic half of the gauntlet: everything that can be decided
// without a model. These run first, because a candidate that fails one of them is
// not worth a model call.
//
// The checks map one-to-one onto the owner's requirements:
//   * binding + concept agreement        -> "clearly tied to 1–2 evidence cards"
//   * non-vacuous relevant set           -> the reference answer actually uses them
//   * reasoning-not-recall               -> "critical thinking, not trivia"
//   * label coverage                     -> "gates must not cover a shrinking fraction"
//   * keyword-match core                 -> the classifier compares meaning, not words
//
// The model-judgement "no overlap" check is the discriminator in ./discriminator;
// it is the one thing here that a static rule cannot do, and it is why generation is
// not merely fast but safe.

import {
  MAX_BOUND_CARDS,
  MAX_REQUIRED_CORE,
  MIN_ACCEPT_LABELS,
  MIN_REJECT_LABELS,
  type CandidateItem,
  type CardRef,
  type Finding,
} from "./types.js";
import { contentOverlap, normalise, wordCount } from "./text.js";

// The same shape validateAuthoredPool warns on: an idea phrased as a string match.
const KEYWORD_MATCH_SHAPES =
  /\b(contains?|includes? the word|mentions? the word|exact(ly)? the (word|phrase)|spelled)\b/i;

// Recall tells in the question stem, paired with a bare-fact reference answer.
const RECALL_STEM = /\b(what year|which year|in what year|what date|when did|when was|what day)\b/i;
const BARE_FACT = /^\s*(in\s+)?(the\s+)?(year\s+)?1[5-9]\d\d\.?\s*$/i;
// Decision / application shapes that make an item reasoning rather than recall.
const DECISION_SHAPE =
  /\b(which|choose|decide|is it|are they|would|why|how|what makes|two are true|one of them|does (this|it)|would you|is that|separate|tell them apart)\b/i;

export function checkStatic(
  item: CandidateItem,
  cards: readonly CardRef[],
): readonly Finding[] {
  const findings: Finding[] = [];
  const push = (code: string, severity: Finding["severity"], detail: string): void =>
    void findings.push({ check: "static", code, severity, detail });

  const byId = new Map(cards.map((c) => [c.cardId, c]));

  // ---- binding: 1–2 cards, all real, all this item's concept ----------------
  const bound = item.boundCardIds;
  if (bound.length < 1) push("NO_BINDING", "ERROR", "item binds to no card");
  if (bound.length > MAX_BOUND_CARDS) {
    push("TOO_MANY_CARDS", "ERROR", `binds to ${bound.length} cards; at most ${MAX_BOUND_CARDS}`);
  }
  const boundCards: CardRef[] = [];
  for (const id of bound) {
    const card = byId.get(id);
    if (!card) {
      push("UNKNOWN_CARD", "ERROR", `bound card ${id} is defined in no known card set`);
      continue;
    }
    boundCards.push(card);
    if (card.conceptId !== item.conceptId) {
      push(
        "CARD_CONCEPT_MISMATCH",
        "ERROR",
        `bound card ${id} is on ${card.conceptId}, item is on ${item.conceptId}`,
      );
    }
  }

  // ---- non-vacuous relevant set: the reference answer must invoke each card ---
  // A binding the reference answer does not actually use is a binding in name only,
  // which is how "clearly tied to its evidence" degrades into a label. The overlap
  // is a heuristic (the model discriminator is the real judge), so this WARNs.
  for (const card of boundCards) {
    if (contentOverlap(item.referenceAnswer, card.proposition) < 0.04) {
      push(
        "VACUOUS_BINDING",
        "WARN",
        `the reference answer shares almost no content with bound card ${card.cardId}; check it truly rests on that card`,
      );
    }
  }

  // ---- required core: present, bounded, phrased as meaning ------------------
  const core = item.requiredCore;
  if (core.length < 1) push("NO_CORE", "ERROR", "item states no required core element");
  if (core.length > MAX_REQUIRED_CORE) {
    push("TOO_MANY_CORE", "ERROR", `${core.length} core elements; ${MAX_REQUIRED_CORE} is the ceiling`);
  }
  core.forEach((idea, i) => {
    if (idea.trim().length === 0) push("EMPTY_CORE", "ERROR", `requiredCore[${i}] is empty`);
    if (KEYWORD_MATCH_SHAPES.test(idea)) {
      push(
        "CORE_LOOKS_LIKE_KEYWORD_MATCH",
        "WARN",
        `requiredCore[${i}] states words to match, not a meaning; the comparison judges meaning`,
      );
    }
  });
  if (item.needs !== undefined && item.needs !== "all") {
    if (!Number.isInteger(item.needs) || item.needs < 1 || item.needs > Math.max(1, core.length)) {
      push("NEEDS_OUT_OF_RANGE", "ERROR", `needs ${item.needs} of ${core.length} core elements`);
    }
  }

  // ---- reasoning, not recall ------------------------------------------------
  // The one item the owner had rewritten was bare date recall. A question whose
  // stem asks for a year/date and whose reference answer is a bare fact, with no
  // decision or application anywhere, is that shape and is rejected.
  const looksRecall =
    RECALL_STEM.test(item.question) && BARE_FACT.test(item.referenceAnswer);
  const hasDecision = DECISION_SHAPE.test(item.question);
  if (looksRecall && !hasDecision) {
    push(
      "RECALL_NOT_REASONING",
      "ERROR",
      "the stem asks for a date and the reference is a bare year with no decision to make; this is recall, not concept application",
    );
  } else if (!hasDecision && wordCount(item.referenceAnswer) <= 4) {
    push(
      "THIN_ANSWER",
      "WARN",
      "the reference answer is very short and the question sets up no decision; check it is not trivia",
    );
  }

  // ---- label coverage: the anti-erosion floor -------------------------------
  // A candidate cannot pass without enough held-out labels to grow the eval set.
  // This is the item-level half of "the gates must not cover a shrinking fraction".
  if (item.accept.length < MIN_ACCEPT_LABELS) {
    push(
      "THIN_ACCEPT_LABELS",
      "ERROR",
      `${item.accept.length} accept labels; ${MIN_ACCEPT_LABELS} is the floor because these become the eval set and the fast-accept tier`,
    );
  }
  if (item.reject.length < MIN_REJECT_LABELS) {
    push(
      "THIN_REJECT_LABELS",
      "ERROR",
      `${item.reject.length} reject labels; ${MIN_REJECT_LABELS} is the floor so the gate can catch a runaway grader on this item`,
    );
  }
  const acceptKeys = new Set(item.accept.map(normalise));
  for (const r of item.reject) {
    if (acceptKeys.has(normalise(r))) {
      push("LABEL_IN_BOTH_LISTS", "ERROR", `"${r}" is both accepted and rejected`);
    }
  }

  return findings;
}
