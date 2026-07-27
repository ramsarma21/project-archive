// The question pool: M1's eighteen authored items, and the round schedule they were
// authored for.
//
// The bank at content/m1/duel-items.json is not a bag of questions. It carries an
// authored ROUND SCHEDULE — postwar revenue, stamp scope, representation, then the
// same three again — so that no concept is asked twice in a row, and it carries six
// items per concept precisely so three attempts can be served without repeats. This
// module honours both rather than shuffling eighteen items and hoping.
//
// Selection is seeded from the match, so both clients and the server derive the same
// six questions from the same match seed, and a replay asks the same questions. Which
// item fills a round varies; WHICH CONCEPT fills it never does.

import { fieldRandom, projectFieldSeed, type DuelQuestionRef } from "@pa/duel";
import { PVP_GATES, type PvpGates } from "./gates.js";

export interface PvpQuestionItem {
  readonly itemId: string;
  readonly itemVersion: string;
  readonly poolId: string;
  readonly conceptId: string;
  /**
   * Codex cards this item requires. The PvP-legal gate is expressed in cards rather
   * than concepts because that is what a capstone mints, and an item can draw on more
   * than one card.
   */
  readonly codexCardIds: readonly string[];
  readonly question: string;
}

export interface PvpQuestionBank {
  readonly contentId: string;
  readonly items: readonly PvpQuestionItem[];
  /** Concept per round, in authored order. Length is the round count it serves. */
  readonly conceptByRound: readonly string[];
}

/** M1's three concepts, and the whole of the day-one pool. */
export const M1_CONCEPT_IDS: readonly string[] = [
  "BOS.CONCEPT.POSTWAR_REVENUE.v1",
  "BOS.CONCEPT.STAMP_SCOPE.v1",
  "BOS.CONCEPT.REPRESENTATION.v1",
];

interface RawBank {
  readonly contentId?: unknown;
  readonly items?: unknown;
  readonly pools?: unknown;
  readonly roundSchedule?: unknown;
}

export type BankParseResult =
  | { readonly ok: true; readonly bank: PvpQuestionBank }
  | { readonly ok: false; readonly reason: string };

/**
 * Parse the authored bank. Strict about the fields PvP depends on and silent about the
 * rest, because the file also carries authoring apparatus — grading policy, module
 * coverage, provenance — that is not this package's business.
 */
export function parseQuestionBank(input: unknown): BankParseResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "bank is not an object" };
  }
  const raw = input as RawBank;
  if (!Array.isArray(raw.items)) return { ok: false, reason: "bank.items is not an array" };

  const poolConcepts = new Map<string, string>();
  if (Array.isArray(raw.pools)) {
    for (const pool of raw.pools as ReadonlyArray<Record<string, unknown>>) {
      if (typeof pool.poolId === "string" && typeof pool.conceptId === "string") {
        poolConcepts.set(pool.poolId, pool.conceptId);
      }
    }
  }

  const items: PvpQuestionItem[] = [];
  for (const entry of raw.items as ReadonlyArray<Record<string, unknown>>) {
    const itemId = entry.itemId;
    const poolId = entry.poolId;
    if (typeof itemId !== "string" || typeof poolId !== "string") {
      return { ok: false, reason: `item missing itemId or poolId: ${String(itemId)}` };
    }
    const conceptId =
      typeof entry.conceptId === "string" ? entry.conceptId : poolConcepts.get(poolId);
    if (!conceptId) {
      return { ok: false, reason: `cannot resolve conceptId for ${itemId}` };
    }
    items.push({
      itemId,
      itemVersion: typeof entry.itemVersion === "string" ? entry.itemVersion : "v1",
      poolId,
      conceptId,
      codexCardIds: Array.isArray(entry.codexCardIds)
        ? (entry.codexCardIds as unknown[]).filter(
            (card): card is string => typeof card === "string",
          )
        : [],
      question: typeof entry.question === "string" ? entry.question : "",
    });
  }

  const conceptByRound: string[] = [];
  if (Array.isArray(raw.roundSchedule)) {
    for (const round of raw.roundSchedule as ReadonlyArray<Record<string, unknown>>) {
      const poolId = typeof round.poolId === "string" ? round.poolId : null;
      const conceptId =
        typeof round.conceptId === "string"
          ? round.conceptId
          : poolId
            ? poolConcepts.get(poolId)
            : undefined;
      if (conceptId) conceptByRound.push(conceptId);
    }
  }
  // No authored schedule: fall back to cycling the concepts present, which still
  // guarantees no concept twice in a row.
  if (conceptByRound.length === 0) {
    const distinct = [...new Set(items.map((item) => item.conceptId))];
    for (let round = 0; round < 6; round++) {
      conceptByRound.push(distinct[round % distinct.length] ?? distinct[0]!);
    }
  }

  return {
    ok: true,
    bank: {
      contentId: typeof raw.contentId === "string" ? raw.contentId : "UNKNOWN_BANK",
      items,
      conceptByRound,
    },
  };
}

/**
 * Items both players are allowed to be asked.
 *
 * THE ONLY place the PvP-legal card rule is enforced. With the gate open every item is
 * askable; with it closed an item needs EVERY one of its cards held by BOTH players,
 * and the intersection is deliberate — asking a question only one side could hold is
 * the definition of an unfair duel, and it is the direction a naive implementation
 * fails in, because each player's own Codex is the obvious thing to check.
 */
export function askableItems(
  bank: PvpQuestionBank,
  legalCards: { readonly A: readonly string[]; readonly B: readonly string[] },
  gates: PvpGates = PVP_GATES,
): readonly PvpQuestionItem[] {
  if (!gates.requirePvpLegalCards) return bank.items;
  const heldByA = new Set(legalCards.A);
  const heldByB = new Set(legalCards.B);
  return bank.items.filter(
    (item) =>
      item.codexCardIds.length > 0 &&
      item.codexCardIds.every((card) => heldByA.has(card) && heldByB.has(card)),
  );
}

/**
 * Every Codex card any item in the bank draws on, sorted and de-duplicated.
 *
 * This is the full M1 card set — derived from the authored items that reference the
 * cards rather than hand-listed anywhere, so it cannot drift from the bank. It is
 * what the PLAYTEST_ALL access policy grants a caller, and what the route's default
 * card resolver hands both participants so `askableItems` keeps the whole eligible
 * pool. Capstone items carry no cards and contribute nothing here.
 */
export function allAskableCardIds(bank: PvpQuestionBank): readonly string[] {
  const cards = new Set<string>();
  for (const item of bank.items) {
    for (const card of item.codexCardIds) cards.add(card);
  }
  return [...cards].sort();
}

export type SelectionResult =
  | { readonly ok: true; readonly questions: readonly PvpQuestionItem[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Draw one item per round, following the authored concept order, seeded by the match.
 *
 * Never repeats an item inside a match. If a concept's pool runs dry — only possible
 * with the card gate on and a thin Codex — it falls back to any other askable item
 * rather than failing the match, and reports nothing, because a duel that starts with a
 * slightly-off concept order is better than a duel that does not start.
 */
export function selectRoundQuestions(input: {
  readonly bank: PvpQuestionBank;
  readonly seed: number;
  readonly rounds: number;
  readonly askable: readonly PvpQuestionItem[];
}): SelectionResult {
  const { bank, seed, rounds, askable } = input;
  if (askable.length === 0) {
    return { ok: false, reason: "no askable items: both players share no PvP-legal card" };
  }
  if (askable.length < rounds) {
    return {
      ok: false,
      reason: `only ${askable.length} askable items for ${rounds} rounds`,
    };
  }

  const used = new Set<string>();
  const questions: PvpQuestionItem[] = [];
  for (let round = 0; round < rounds; round++) {
    const wanted = bank.conceptByRound[round % bank.conceptByRound.length];
    const pool = askable.filter(
      (item) => item.conceptId === wanted && !used.has(item.itemId),
    );
    const fallback = askable.filter((item) => !used.has(item.itemId));
    const candidates = pool.length > 0 ? pool : fallback;
    if (candidates.length === 0) {
      return { ok: false, reason: `ran out of items at round ${round + 1}` };
    }
    // Sorted before drawing so the choice depends on the seed and not on file order.
    const ordered = [...candidates].sort((left, right) =>
      left.itemId < right.itemId ? -1 : 1,
    );
    const draw = Math.floor(fieldRandom(seed, round, 91) * ordered.length);
    const chosen = ordered[Math.min(ordered.length - 1, Math.max(0, draw))]!;
    used.add(chosen.itemId);
    questions.push(chosen);
  }
  return { ok: true, questions };
}

/** Project onto what @pa/duel commits: identity only, never the question text. */
export function toDuelQuestionRefs(
  items: readonly PvpQuestionItem[],
): readonly DuelQuestionRef[] {
  return items.map((item) => ({
    itemId: item.itemId,
    itemVersion: item.itemVersion,
    conceptId: item.conceptId,
  }));
}

/** Seed for a match's question draw, so both sides derive the same six. */
export function questionSeedFor(matchId: string, bankContentId: string): number {
  return projectFieldSeed(["PVP_QUESTIONS", matchId, bankContentId]);
}
