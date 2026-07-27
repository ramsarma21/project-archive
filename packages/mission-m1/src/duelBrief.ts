// The duel M1 ends in: the constable at the post, in the rope-walk yard.
//
// The eighteen items are authored in content/m1/duel-items.json; only their
// refs live here, because a ref is all the duel carries — the question text and
// the rubric are the grading service's, and putting them in the client would
// hand every answer to anybody with a debugger.
//
// Six of the eighteen run per attempt, two per concept, in the authored concept
// order, drawn on the attempt seed and never repeating across the three
// attempts. That last property is what the pool structure is for: six items per
// concept is exactly three attempts' worth of two.

// The seeded-RNG primitives come from @pa/duel's package root, which re-exports
// them straight from the engine (`@pa/engine-world`'s ./engine.js). Importing them
// here rather than from `@pa/engine-world/fieldSimulation` removes the last deep
// engine import in this package WITHOUT dragging the engine's React/`.tsx` surface
// into a headless level module — `@pa/engine-world`'s own package root pulls in
// GroundSurface, RiggedCharacter and friends, which do not belong in a package that
// runs under `node --test`. @pa/duel is already a dependency (askQuestion below),
// and its re-export is the same one canonical primitive, not a second copy.
import {
  askQuestion,
  fieldRandom,
  projectFieldSeed,
  type AskedQuestion,
  type DuelQuestionRef,
} from "@pa/duel";
import { M1_EFFIGY_RUN } from "./level/index.js";
import { duelItemCodexCardIds } from "./duelCodex.js";

export interface DuelItemRef {
  readonly itemId: string;
  readonly itemVersion: string;
  readonly conceptId: string;
  readonly poolId: string;
}

/** Authored concept order. The duel asks them in this sequence, two each. */
export const M1_CONCEPT_ORDER = [
  "BOS.CONCEPT.POSTWAR_REVENUE.v1",
  "BOS.CONCEPT.STAMP_SCOPE.v1",
  "BOS.CONCEPT.REPRESENTATION.v1",
] as const;

export const M1_DUEL_ITEMS: readonly DuelItemRef[] = [
  { itemId: "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.WHAT_IT_LEFT.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.WHO_PAYS.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.WHICH_CAME_FIRST.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.CAME_FROM_NOWHERE.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.DEBT_TO_TAX.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1", poolId: "BOS.MD01.POOL.DUEL_POSTWAR.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.DEED_OR_CLOTH.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.FROM_WHEN.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.WHY_A_PRINTER.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.CORRECT_THE_APPRENTICE.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.NAME_TWO.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.STAMP.PRIVATE_LETTER.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1", poolId: "BOS.MD01.POOL.DUEL_STAMP_SCOPE.v1" },
  { itemId: "BOS.MD01.DUEL.REP.WHAT_RIGHT.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.NOT_THE_MONEY.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.FINISH_THE_CLAIM.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
  { itemId: "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1", itemVersion: "v1", conceptId: "BOS.CONCEPT.REPRESENTATION.v1", poolId: "BOS.MD01.POOL.DUEL_REPRESENTATION.v1" },
];

/**
 * The six items this attempt asks, two per concept in authored order.
 *
 * The attempt ordinal partitions each concept's six items into three disjoint
 * pairs, so attempt 1 draws items 0-1, attempt 2 draws 2-3 and attempt 3 draws
 * 4-5 — nothing repeats across a player's three attempts, which the slate
 * requires. The seed rotates which pair each ordinal lands on, so two players
 * on their first attempt do not see the same six.
 */
export function duelQuestionsForAttempt(
  seed: number,
  attemptOrdinal: number,
): DuelItemRef[] {
  const picked: DuelItemRef[] = [];
  for (const conceptId of M1_CONCEPT_ORDER) {
    const pool = M1_DUEL_ITEMS.filter((item) => item.conceptId === conceptId);
    const pairs = Math.max(1, Math.floor(pool.length / 2));
    const rotation = Math.floor(
      fieldRandom(seed, 0, projectFieldSeed([conceptId]) & 0xffff) * pairs,
    );
    const pair = (rotation + Math.max(0, attemptOrdinal - 1)) % pairs;
    const first = pool[(pair * 2) % pool.length]!;
    const second = pool[(pair * 2 + 1) % pool.length]!;
    picked.push(first, second);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// The canonical M1 duel identity and question selection, in ONE place.
//
// The duel-id, the attempt seed and the per-round item were all computed
// separately by the client (apps/web/src/chapter/m1Mission.ts) and could not be
// recomputed by the grading authority, which is why the boss route trusted an
// arbitrary duelId/itemId/conceptId. These helpers are the single source of both,
// derived from exactly what a stored mission attempt holds — its 32-hex seed and
// its ordinal — so the server can reconstruct the same fight the client is playing
// and grade the item the round is actually asking rather than the one the client
// claims.
//
// The lineage is the one the ticket already fixes: the mission attempt seed is
// `projectFieldSeed([attemptSeedHex])`, the duel is handed that same 32-bit value,
// and both `duelQuestionsForAttempt` and @pa/duel's `askQuestion` are driven by it.
// So `m1DuelSeed(row.attemptSeedHex)` equals the client's `brief.seed`, and
// `askQuestion` over the same bank and seed lands on the same item for every round.
// ---------------------------------------------------------------------------

/** The authored level id the duel id is composed from. */
export const M1_DUEL_LEVEL_ID = M1_EFFIGY_RUN.id;

/**
 * The duel id for one attempt: `<levelId>#duel@<ordinal>`.
 *
 * Both the client's brief and the grading authority compose it here, so the id
 * the browser posts to and the id the server binds a verdict receipt to are the
 * same string by construction rather than by two files agreeing.
 */
export function m1DuelId(attemptOrdinal: number): string {
  return `${M1_DUEL_LEVEL_ID}#duel@${attemptOrdinal}`;
}

/**
 * The 32-bit duel seed a stored attempt produces.
 *
 * The same value the ticket projects from the attempt's 128-bit hex, so a server
 * recomputing it from the durable row reproduces the client's `brief.seed`.
 */
export function m1DuelSeed(attemptSeedHex: string): number {
  return projectFieldSeed([attemptSeedHex]);
}

function asQuestionRef(ref: DuelItemRef): DuelQuestionRef {
  return { itemId: ref.itemId, itemVersion: ref.itemVersion, conceptId: ref.conceptId };
}

/**
 * The bank of six `DuelQuestionRef`s this attempt asks from, as @pa/duel sees it.
 *
 * `duelQuestionsForAttempt` returns the richer `DuelItemRef` (it also carries a
 * pool id); the duel core only knows `DuelQuestionRef`, so this narrows to exactly
 * what `askQuestion` walks.
 */
export function m1DuelBank(
  attemptSeedHex: string,
  attemptOrdinal: number,
): DuelQuestionRef[] {
  return duelQuestionsForAttempt(m1DuelSeed(attemptSeedHex), attemptOrdinal).map(
    asQuestionRef,
  );
}

/**
 * The item round `round` asks in a stored attempt's duel, server-side.
 *
 * Identical to what the client's runtime resolves: same bank, same seed, same
 * `askQuestion` permutation. This is what lets the grading authority grade the
 * server-selected item and ignore a forged itemId — choosing another bank item
 * cannot move the verdict because the server never looks at the claim.
 */
export function m1ExpectedDuelItem(input: {
  readonly attemptSeedHex: string;
  readonly attemptOrdinal: number;
  readonly round: number;
}): AskedQuestion {
  const seed = m1DuelSeed(input.attemptSeedHex);
  const bank = duelQuestionsForAttempt(seed, input.attemptOrdinal).map(asQuestionRef);
  return askQuestion(bank, input.round, seed);
}

/**
 * The Codex card ids the round's server-selected item draws on.
 *
 * Composed from the two authorities that already decide everything: `m1ExpectedDuelItem`
 * picks the item from the stored attempt (seed + ordinal + round), and
 * `duelItemCodexCardIds` maps that item id to its authored cards. Because the item id
 * is server-derived and the mapping is a pure function of it, the cards cannot be
 * chosen, added, or replaced by anything a client sends — a forged item claim in a
 * request is ignored the same way it is for grading, and there is no card field to
 * honour in the first place.
 */
export function m1ExpectedDuelCardIds(input: {
  readonly attemptSeedHex: string;
  readonly attemptOrdinal: number;
  readonly round: number;
}): readonly string[] {
  return duelItemCodexCardIds(m1ExpectedDuelItem(input).item.itemId);
}
