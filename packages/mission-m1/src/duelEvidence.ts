// The evidence-selection model for a duel question — server-owned, deterministic,
// and safe to project to a client.
//
// WHAT THIS IS. A duel question no longer asks only for prose. Before submitting an
// answer, a player is dealt a HAND of Codex cards and must drag the ones that
// actually support their answer into evidence slots. This module decides, for one
// item, WHICH cards are offered, HOW MANY of them a player must place, and whether a
// given selection is good enough. It is the authority the route grades against — the
// client's idea of which card is "relevant" is never trusted.
//
// WHY IT LIVES HERE. `@pa/mission-m1` already owns the two things this needs and
// neither of them is a rubric: the safe card universe (`M1_CODEX_CARD_IDS`, id-only)
// and the item→cards relation (`duelItemCodexCardIds`, derived from codex-cards.json).
// So this module reads no answers and no rubric text; it can be imported by the
// headless grading route and by the browser alike, exactly as `duelCodex` is.
//
// DETERMINISTIC HAND. The offered hand is a pure function of the item id: the
// relevant cards plus a seeded pick of distractors from the rest of the deck, shuffled
// by a seed derived from the item id. Every caller — the two sides of a PvP match, a
// replay from a log, the server validating a submission — computes the same hand in
// the same order, so a selection can be checked against the exact set it was offered.
//
// WHAT NEVER CROSSES THE WIRE. `EvidencePolicy` carries which cards are relevant, the
// accepted groups and the incompatible cards — the answer, in card form. Only
// `evidenceHandProjection` may be sent to a client: the offered ids and the minimum
// count. A player is told "place at least two", never which two.

import { M1_CODEX_CARD_IDS, duelItemCodexCardIds } from "./duelCodex.js";

/** The number of cards dealt into a hand, deck permitting. Relevant + distractors. */
export const M1_EVIDENCE_HAND_SIZE = 5;

/**
 * The full, server-side evidence policy for one item. NEVER sent to a client whole:
 * `relevantCardIds`, `acceptedGroups` and `incompatibleCardIds` are the answer said
 * in cards. Project it with `evidenceHandProjection` before it leaves the server.
 */
export interface EvidencePolicy {
  readonly itemId: string;
  /** The hand, in a deterministic order. Relevant cards plus decoys. */
  readonly offeredCardIds: readonly string[];
  /** The cards that genuinely support the answer. A subset of `offeredCardIds`. */
  readonly relevantCardIds: readonly string[];
  /**
   * Explicit valid combinations. A selection satisfies the policy if it covers ALL
   * of at least one group. Empty means "any `minSupport` of the relevant cards",
   * which is the common case and is what makes multiple combinations valid.
   */
  readonly acceptedGroups: readonly (readonly string[])[];
  /** How many relevant cards a selection must place. At least one. */
  readonly minSupport: number;
  /**
   * Decoys that actively contradict the answer. Placing one fails the selection even
   * if enough relevant cards are also placed — the point is that the two cannot both
   * be true of a correct answer. Empty for M1, whose nine cards are all true claims;
   * the mechanism exists for decks that carry a false card.
   */
  readonly incompatibleCardIds: readonly string[];
  /** The most cards a player may place. The whole hand, by default. */
  readonly maxSelectable: number;
}

/** The public projection: what a client may know before it answers. Never relevance. */
export interface EvidenceHandProjection {
  readonly itemId: string;
  readonly offeredCardIds: readonly string[];
  readonly minSupport: number;
  readonly maxSelectable: number;
}

/** An authored deviation from the derived defaults, for one item. */
interface EvidenceOverride {
  /** Force a minimum other than the derived one. */
  readonly minSupport?: number;
  /** Cards that must appear in the hand as decoys (e.g. a classic misconception). */
  readonly forcedDistractorIds?: readonly string[];
  /** Decoys whose selection fails the answer. */
  readonly incompatibleCardIds?: readonly string[];
  /** Explicit valid combinations, when "any N of the relevant" is too loose. */
  readonly acceptedGroups?: readonly (readonly string[])[];
}

// ---------------------------------------------------------------------------
// Authored per-item policy overrides.
//
// M1's nine cards are all TRUE claims — there is no false card to make a genuine
// "contradictory" decoy, so `incompatibleCardIds` stays empty here and the gate is
// `minSupport`: a player must place enough of the claims their answer actually rests
// on. The overrides below tune that minimum where the derived default is wrong, and
// the mechanism for forced/incompatible decoys is exercised so the engine is proven.
//
// MOST ITEMS NOW REQUIRE TWO. The pedagogical bar was raised so the majority of items
// make a player synthesise two distinct pieces of evidence — a cause plus its
// consequence, a mechanism plus who it burdened, a grievance plus the town's standing
// to make it. That is carried by the RELEVANT-CARD SET, not by these overrides: an
// item with two or more relevant cards derives `minSupport: 2` from
// `defaultMinSupport`, so raising the bar was a matter of giving those items their
// genuine second card in the authored bank (codex-cards.json `askedBy` and each
// item's `codexCardIds`) rather than of listing a minimum here. See README for the
// per-item distribution and the justification for every item deliberately left at one
// (the stamp-scope boundary items, the bare date, the year-pair pick), where the
// history genuinely turns on a single decisive claim.
//
// MULTIPLE VALID COMBINATIONS. `acceptedGroups` is left EMPTY on every M1 item on
// purpose: an empty group means "any `minSupport` of the relevant cards", which is the
// broadest possible admission — every defensible pair of an item's relevant cards
// passes. The four items with three relevant cards therefore admit three valid pairs
// each. `acceptedGroups` exists to NARROW to a specific combination, which no M1 item
// needs, so using it here would make the mechanic a single memorised pair.
// ---------------------------------------------------------------------------

const M1_EVIDENCE_OVERRIDES: Readonly<Record<string, EvidenceOverride>> = {
  // Three relevant cards, but the third (the synthesis chain) is a bonus rather
  // than a requirement — the causal story stands on the debt and the payer. Two is
  // the floor, which keeps more than one valid pair. (Redundant with the derived
  // default of two, and kept as an explicit pin on the "two of three" line.)
  "BOS.MD01.DUEL.POSTWAR.CAME_FROM_NOWHERE.v1": { minSupport: 2 },
  // The representation capstone: three relevant, but the consent ground plus either
  // the no-member card or the lawful-not-consented reply is enough. Two of three.
  "BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1": { minSupport: 2 },
};

// ---------------------------------------------------------------------------
// Relevant-card resolution.
// ---------------------------------------------------------------------------

/**
 * The hardening items' relevant cards. These seven are PvP-only and, unlike the
 * eighteen PvE items, are not listed in any card's `askedBy`, so the safe resolver
 * returns nothing for them. Their card sets are transcribed from their own
 * `codexCardIds` in content/m1/duel-items.json; a test pins them so this cannot
 * drift from the authored bank.
 */
const M1_HARDENING_RELEVANT: Readonly<Record<string, readonly string[]>> = {
  "BOS.MD01.DUEL.POSTWAR.WHICH_IS_FALSE.v1": [
    "BOS.MD01.CARD.WAR_DEBT.v1",
    "BOS.MD01.CARD.DEBT_TO_STAMP_CHAIN.v1",
  ],
  "BOS.MD01.DUEL.POSTWAR.WHICH_YEAR.v1": ["BOS.MD01.CARD.WAR_DEBT.v1"],
  "BOS.MD01.DUEL.REP.HOW_FAR_IT_GOES.v1": [
    "BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1",
    "BOS.MD01.CARD.CONSENT_GROUND.v1",
  ],
  "BOS.MD01.DUEL.REP.WHICH_TOWN.v1": [
    "BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1",
    "BOS.MD01.CARD.CONSENT_GROUND.v1",
  ],
  "BOS.MD01.DUEL.POSTWAR.STILL_HERE.v1": [
    "BOS.MD01.CARD.WAR_DEBT.v1",
    "BOS.MD01.CARD.COLONIAL_REVENUE.v1",
  ],
  "BOS.MD01.DUEL.REP.WHICH_MAN.v1": ["BOS.MD01.CARD.CONSENT_GROUND.v1"],
  "BOS.MD01.DUEL.STAMP.WHICH_HUNDRED.v1": [
    "BOS.MD01.CARD.STAMP_DATE.v1",
    "BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1",
  ],
};

/**
 * The cards an item's answer genuinely rests on. Derived from the safe resolver for
 * the eighteen PvE items and from the authored map for the seven hardening items;
 * empty for anything else.
 */
export function m1EvidenceRelevantCardIds(itemId: string): readonly string[] {
  const fromDeck = duelItemCodexCardIds(itemId);
  if (fromDeck.length > 0) return fromDeck;
  return M1_HARDENING_RELEVANT[itemId] ?? [];
}

// ---------------------------------------------------------------------------
// The deterministic hand.
// ---------------------------------------------------------------------------

/** FNV-1a over a string, so the seed is stable across processes and machines. */
function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: tiny, deterministic, good enough to shuffle a hand of nine. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Fisher–Yates shuffle driven by a seeded PRNG. Pure: input is never mutated. */
function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const held = out[index]!;
    out[index] = out[swap]!;
    out[swap] = held;
  }
  return out;
}

/**
 * Build the full evidence policy for an item.
 *
 * `relevantCardIds` is the authority for what supports the answer — the caller passes
 * the server-selected item's own cards. `allCardIds` is the deck the distractors come
 * from; it defaults to the nine M1 cards. The hand is deterministic in the item id,
 * so two callers agree without coordinating.
 */
export function evidencePolicyFrom(input: {
  readonly itemId: string;
  readonly relevantCardIds: readonly string[];
  readonly allCardIds?: readonly string[];
  readonly handSize?: number;
}): EvidencePolicy {
  const { itemId } = input;
  const deck = input.allCardIds ?? M1_CODEX_CARD_IDS;
  const handSize = input.handSize ?? M1_EVIDENCE_HAND_SIZE;
  const override = M1_EVIDENCE_OVERRIDES[itemId] ?? {};

  // Relevant, de-duplicated and intersected with the deck so a stray id cannot
  // become an un-showable "relevant" card.
  const deckSet = new Set(deck);
  const relevant = unique(input.relevantCardIds).filter((id) => deckSet.has(id));

  const forced = unique(override.forcedDistractorIds ?? []).filter(
    (id) => deckSet.has(id) && !relevant.includes(id),
  );

  const rng = mulberry32(seedFrom(itemId));
  // Distractors: the rest of the deck, shuffled, with any forced decoys first so they
  // are always present. Enough to fill the hand and never fewer than one decoy.
  const pool = seededShuffle(
    deck.filter((id) => !relevant.includes(id) && !forced.includes(id)),
    rng,
  );
  const wantDistractors = Math.max(1, handSize - relevant.length);
  const distractors = [...forced, ...pool].slice(
    0,
    Math.max(forced.length, wantDistractors),
  );

  const offeredCardIds = seededShuffle([...relevant, ...distractors], rng);

  const minSupport = clamp(
    override.minSupport ?? defaultMinSupport(relevant.length),
    1,
    Math.max(1, relevant.length),
  );

  return {
    itemId,
    offeredCardIds,
    relevantCardIds: relevant,
    acceptedGroups: (override.acceptedGroups ?? []).map((group) => [...group]),
    minSupport,
    incompatibleCardIds: unique(override.incompatibleCardIds ?? []).filter((id) =>
      offeredCardIds.includes(id),
    ),
    maxSelectable: offeredCardIds.length,
  };
}

/** One relevant card needs one placed; two or more need at least two by default. */
function defaultMinSupport(relevantCount: number): number {
  if (relevantCount <= 1) return 1;
  return 2;
}

/** The M1 policy for an item, resolving its relevant cards for you. */
export function m1EvidencePolicy(itemId: string): EvidencePolicy {
  return evidencePolicyFrom({
    itemId,
    relevantCardIds: m1EvidenceRelevantCardIds(itemId),
  });
}

/** The safe, client-facing shape. Offered ids and the count — never relevance. */
export function evidenceHandProjection(policy: EvidencePolicy): EvidenceHandProjection {
  return {
    itemId: policy.itemId,
    offeredCardIds: policy.offeredCardIds,
    minSupport: policy.minSupport,
    maxSelectable: policy.maxSelectable,
  };
}

// ---------------------------------------------------------------------------
// Validation and grading.
// ---------------------------------------------------------------------------

export type EvidenceSelectionRejection =
  | "NOT_OFFERED"
  | "DUPLICATE"
  | "TOO_MANY"
  | "UNAUTHORIZED";

export type EvidenceSelectionCheck =
  | { readonly ok: true; readonly selected: readonly string[] }
  | { readonly ok: false; readonly code: EvidenceSelectionRejection; readonly detail: string };

/**
 * Server-authoritative legality check on a submitted selection.
 *
 * Rejects anything a legitimate client could not have produced: an id not in the
 * hand it was dealt, a repeat, more cards than the hand holds, or a card the player
 * is not authorised to hold (their legal / unlocked / temporary M1 set). It says
 * nothing about relevance — a legal selection can still grade as insufficient.
 */
export function validateEvidenceSelection(
  policy: EvidencePolicy,
  selectedCardIds: readonly string[],
  authorizedCardIds: readonly string[],
): EvidenceSelectionCheck {
  const seen = new Set<string>();
  const offered = new Set(policy.offeredCardIds);
  const authorized = new Set(authorizedCardIds);
  for (const id of selectedCardIds) {
    if (seen.has(id)) {
      return { ok: false, code: "DUPLICATE", detail: id };
    }
    seen.add(id);
    if (!offered.has(id)) {
      return { ok: false, code: "NOT_OFFERED", detail: id };
    }
    if (!authorized.has(id)) {
      return { ok: false, code: "UNAUTHORIZED", detail: id };
    }
  }
  if (selectedCardIds.length > policy.maxSelectable) {
    return {
      ok: false,
      code: "TOO_MANY",
      detail: `${selectedCardIds.length} > ${policy.maxSelectable}`,
    };
  }
  return { ok: true, selected: [...selectedCardIds] };
}

export type EvidenceReason = "OK" | "TOO_FEW" | "INCOMPATIBLE";

export interface EvidenceGrade {
  /** Whether the selection is good enough to support a correct answer. */
  readonly satisfied: boolean;
  /** How many placed cards are genuinely relevant. */
  readonly supportCount: number;
  /** Whether a contradictory card was placed. */
  readonly hasIncompatible: boolean;
  readonly reason: EvidenceReason;
}

/**
 * Grade a (pre-validated) selection against the policy.
 *
 * Satisfied when it places no contradictory card and either covers an accepted group
 * in full or places at least `minSupport` relevant cards. Extra neutral decoys are
 * allowed and do not help; only an incompatible card hurts. Multiple relevant subsets
 * of size `minSupport` are all valid, which is what lets more than one card set count.
 */
export function gradeEvidenceSelection(
  policy: EvidencePolicy,
  selectedCardIds: readonly string[],
): EvidenceGrade {
  const selected = new Set(selectedCardIds);
  const relevant = new Set(policy.relevantCardIds);
  const supportCount = [...selected].filter((id) => relevant.has(id)).length;
  const hasIncompatible = policy.incompatibleCardIds.some((id) => selected.has(id));

  if (hasIncompatible) {
    return { satisfied: false, supportCount, hasIncompatible: true, reason: "INCOMPATIBLE" };
  }
  const coversAGroup =
    policy.acceptedGroups.length > 0 &&
    policy.acceptedGroups.some((group) => group.every((id) => selected.has(id)));
  const satisfied = coversAGroup || supportCount >= policy.minSupport;
  return {
    satisfied,
    supportCount,
    hasIncompatible: false,
    reason: satisfied ? "OK" : "TOO_FEW",
  };
}

// ---------------------------------------------------------------------------

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
