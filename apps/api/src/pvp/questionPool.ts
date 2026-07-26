// The pool a PvP duel actually draws from.
//
// A duel now runs until a health pool empties, so the question bank is a resource
// the match consumes at a rate no author controls. Eighteen items were sized for a
// six-round PvE attempt and are not a PvP pool. `content/m1/duel-items.json`'s own
// `pvpPool` block composes the real one, and this module is that composition in
// code:
//
//   18  the PvE duel items                     unguarded
//    7  pvpHardening.items, PvP-only           unguarded
//    9  shared from the Boston capstone        GUARDED — see below
//   --
//   34  full, 25 under the guard
//
// THE INVARIANT THIS EXISTS TO HOLD. @pa/duel's `DUEL_ROUND_CEILING` is 24, and a
// pool larger than the ceiling means no single match can ever repeat a question.
// 25 > 24 holds for a player who has mastered nothing, which is every player until
// the first capstone is sat. The guarded margin is ONE ITEM, so anything that
// shrinks this pool or raises that ceiling breaks it — `poolHealth()` reports both
// numbers so a caller can assert rather than assume.
//
// SELECTION IS NOT HERE. @pa/duel's `askQuestion` walks a seeded permutation,
// reshuffles per lap, avoids a back-to-back repeat across the lap seam and marks a
// recycled item with `appearance`/`recycled`. This module hands it the whole
// eligible pool and gets out of the way. Nothing here picks a round's question.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ItemBank,
  compilePool,
  m1ContentBank,
  toAuthoredPools,
  type ContentBank,
} from "@pa/grading";
import { parseQuestionBank, type PvpQuestionBank, type PvpQuestionItem } from "@pa/pvp";

/** `apps/api/src/pvp` → repo root. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

const CAPSTONE_OPEN_RESPONSE = "content/capstone/boston-1765/items/open-response.json";

interface CapstoneEntry {
  readonly descriptor: {
    readonly itemId: string;
    readonly itemVersion: string;
    readonly conceptId: string;
    readonly prompt: string;
  };
}

interface HardeningBlock {
  readonly items?: readonly {
    readonly itemId: string;
    readonly poolId: string;
    readonly conceptId: string;
  }[];
}

/**
 * The content bank the GRADER is built from: the PvE items plus the PvP-only
 * hardening items, which share their rubric shape and their three pool ids exactly,
 * so `toAuthoredPools` ports them with no special case.
 *
 * The capstone nine are deliberately absent. Their rubric lives in the capstone's
 * own shape and has not been ported to this one, and an item the grader cannot
 * compile is an item PvP must not serve — see `gradableItemIds`.
 */
function pvpContentBank(): ContentBank {
  const base = m1ContentBank();
  const hardening = (base as unknown as { pvpHardening?: HardeningBlock }).pvpHardening;
  const extra = hardening?.items ?? [];
  return { ...base, items: [...base.items, ...(extra as ContentBank["items"])] };
}

let cachedItemBank: ItemBank | null = null;

/**
 * The compiled bank PvP grades against. Wider than `m1ItemBank()` by the seven
 * hardening items, and it must stay at least as wide as the pool below: a question
 * the grader does not know throws `UnknownItemError` mid-match, which reads to a
 * player as the duel breaking rather than as a content gap.
 */
export function pvpItemBank(): ItemBank {
  cachedItemBank ??= new ItemBank(toAuthoredPools(pvpContentBank()).map(compilePool));
  return cachedItemBank;
}

function readCapstoneEntries(): readonly CapstoneEntry[] {
  try {
    const parsed = JSON.parse(
      readFileSync(resolve(repoRoot(), CAPSTONE_OPEN_RESPONSE), "utf8"),
    ) as { entries?: readonly CapstoneEntry[] };
    return parsed.entries ?? [];
  } catch {
    // The shared nine are an enrichment, not a dependency: the pool clears the
    // round ceiling without them, which is exactly why three extra PvP-only items
    // were authored. A missing capstone file must not take PvP down with it.
    return [];
  }
}

/** Items shared in from the capstone, and therefore subject to the mastery guard. */
export const CAPSTONE_ORIGIN_POOL = "BOS.CAP.POOL.SHARED_OPEN_RESPONSE.v1";

let cachedQuestionBank: PvpQuestionBank | null = null;
let cachedCapstoneIds: ReadonlySet<string> | null = null;

/**
 * Every item PvP could ever ask, before any guard. Parsed by @pa/pvp so the bank's
 * shape rules stay in one place rather than being re-checked here.
 */
export function pvpQuestionBank(): PvpQuestionBank {
  if (cachedQuestionBank) return cachedQuestionBank;
  const base = m1ContentBank() as unknown as Record<string, unknown> & {
    items: readonly unknown[];
  };
  const hardening =
    ((base as { pvpHardening?: HardeningBlock }).pvpHardening?.items ?? []) as readonly unknown[];
  const capstone = readCapstoneEntries().map((entry) => ({
    itemId: entry.descriptor.itemId,
    itemVersion: entry.descriptor.itemVersion,
    poolId: CAPSTONE_ORIGIN_POOL,
    conceptId: entry.descriptor.conceptId,
    codexCardIds: [],
    question: entry.descriptor.prompt,
  }));
  const parsed = parseQuestionBank({
    ...base,
    contentId: `${String(base.contentId)}+PVP`,
    items: [...base.items, ...hardening, ...capstone],
  });
  if (!parsed.ok) throw new Error(`PvP question pool is unusable: ${parsed.reason}`);
  cachedQuestionBank = parsed.bank;
  cachedCapstoneIds = new Set(capstone.map((item) => item.itemId));
  return cachedQuestionBank;
}

function capstoneItemIds(): ReadonlySet<string> {
  if (!cachedCapstoneIds) pvpQuestionBank();
  return cachedCapstoneIds ?? new Set();
}

export interface EligibilityInput {
  /** Items already passed through @pa/pvp's PvP-legal card gate. */
  readonly askable: readonly PvpQuestionItem[];
  /**
   * Concepts each side has MASTERED, in the `ConceptMastery.masteredAt != null`
   * sense. Not "sat": the shrinking retry still draws fresh items for a concept a
   * student failed, so that concept's reserve is still worth protecting.
   */
  readonly mastered: { readonly A: readonly string[]; readonly B: readonly string[] };
}

/**
 * Apply `PVP.GUARD.CAPSTONE_ALREADY_MASTERED.v1` and the grader's coverage.
 *
 * The mastery guard protects the capstone's first-attempt score: if PvP served a
 * gate item first, that score would be measuring recall of a duel, and the
 * student's own retry reserve would be smaller than the engine believes. It is
 * checked for BOTH sides, because a question only one player is allowed to be asked
 * is the definition of an unfair duel — the same intersection rule `askableItems`
 * applies to cards.
 *
 * The coverage filter is the harder rule and it fails CLOSED: PvP may only ask a
 * question the grader can grade. Without it, widening the pool would serve items
 * that throw `UnknownItemError` at answer time, and the failure would arrive
 * mid-match rather than at boot.
 */
export function eligiblePvpItems(input: EligibilityInput): readonly PvpQuestionItem[] {
  const capstone = capstoneItemIds();
  const bank = pvpItemBank();
  const masteredByBoth = new Set(
    input.mastered.A.filter((conceptId) => input.mastered.B.includes(conceptId)),
  );
  return input.askable.filter((item) => {
    if (bank.get(item.itemId) === undefined) return false;
    if (!capstone.has(item.itemId)) return true;
    return masteredByBoth.has(item.conceptId);
  });
}

export interface PoolHealth {
  /** Everything in the composed bank, guarded and unguarded. */
  readonly total: number;
  /** What a player who has mastered nothing can actually be asked. */
  readonly unguarded: number;
  /** Items the grader can compile. The pool is intersected with this. */
  readonly gradable: number;
  readonly capstoneShared: number;
}

/**
 * The numbers the invariant is stated in, so a caller can assert them instead of
 * trusting this comment. Logged once at boot.
 */
export function poolHealth(): PoolHealth {
  const bank = pvpQuestionBank();
  const capstone = capstoneItemIds();
  const grading = pvpItemBank();
  const unguarded = bank.items.filter(
    (item) => !capstone.has(item.itemId) && grading.get(item.itemId) !== undefined,
  );
  return {
    total: bank.items.length,
    unguarded: unguarded.length,
    gradable: bank.items.filter((item) => grading.get(item.itemId) !== undefined).length,
    capstoneShared: capstone.size,
  };
}

/** Test hook. Nothing in the server calls this. */
export function resetPvpPoolCache(): void {
  cachedItemBank = null;
  cachedQuestionBank = null;
  cachedCapstoneIds = null;
}
