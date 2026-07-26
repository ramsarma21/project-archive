// Form selection: which items a given attempt serves.
//
// THE SHRINKING RETRY. Attempt 1 scopes every assessable concept in the chapter.
// A retry scopes only the concepts not yet mastered, and it draws FRESH items
// rather than the same ones. Both halves matter and for different reasons:
// narrowing is what makes a retry a repair rather than a re-sit of material the
// student has already demonstrated, and freshness is what stops the second
// attempt from measuring recall of the first attempt's answers.
//
// THE ITEM-EXHAUSTION ANSWER, which is the genuinely hard part.
//
// The reserve is sized for three attempts. A student on their fourth attempt at
// one stubborn concept has exhausted it, and there are only three possible
// responses: refuse the retry, serve fewer items, or repeat an item. This engine
// repeats, and records that it did.
//
//   - Refusing the retry converts a learning gate into a permanent wall. The
//     entire design rests on the assessment being the route forward that is
//     always open; a student who cannot try again is a student the product has
//     given up on, over a content shortage that is our fault and not theirs.
//   - Serving fewer items silently weakens the 100% rule exactly where it is
//     being leaned on hardest. One item at 100% is a coin flip dressed as
//     mastery.
//   - Repeating is measurably weaker evidence, so it is never hidden: the
//     concept's selection carries `freshness`, the mastery record carries
//     `masteredWithRecycledItems`, and the teacher-facing report surfaces it. A
//     repeated item is recycled OLDEST-SERVED FIRST, which puts the maximum
//     distance between the two exposures.
//
// The one case that is not repaired by recycling is a concept whose whole
// eligible pool is smaller than a single form — two items, today, for most of
// Boston. Recycling cannot manufacture a second item out of one. Such a concept
// is UNASSESSABLE: it is excluded from the form, and gate.ts excludes it from the
// unlock requirement while refusing to mint its card. See the argument there.

import type { CurriculumConceptId } from "./curriculum.js";
import { conceptStreamSeed, seededShuffle, type FormSeedHex } from "./determinism.js";
import type { ChapterAssessmentBlueprint } from "./blueprint.js";
import type { AssessmentItemDescriptor, ItemBank, ItemProbe } from "./items.js";
import { selectFreshItems, type AssessmentConceptLedger } from "./protocol.js";

/**
 * FRESH           — every served item is one this profile has never seen.
 * PARTIAL_RECYCLE — the reserve ran short and some items repeat.
 * FULL_RECYCLE    — every item repeats. The reserve is spent for this concept.
 */
export type ConceptFreshness = "FRESH" | "PARTIAL_RECYCLE" | "FULL_RECYCLE";

export interface SelectedConceptItems {
  readonly conceptId: CurriculumConceptId;
  readonly itemIds: readonly string[];
  readonly freshness: ConceptFreshness;
  readonly freshCount: number;
  readonly recycledCount: number;
  /**
   * Which of the served items are open response. Ids rather than a count, because
   * the log commits them: an item's format is part of what a student was asked,
   * and a projection of the record should not have to consult the bank to know it.
   */
  readonly openResponseItemIds: readonly string[];
  /**
   * The form met its open-response quota, so it cannot be passed by guessing.
   * False means the reserve ran out of prose items and this concept's 100% is
   * reachable by luck — reported rather than blocked, for the same reason
   * exhaustion is.
   */
  readonly guessResistant: boolean;
  /**
   * The two items ask by different routes. False means a probe repeated, or an
   * item was untagged, so the form may be one question asked twice.
   */
  readonly probesDistinct: boolean;
}

export interface FormSelection {
  readonly seedHex: FormSeedHex;
  readonly concepts: readonly SelectedConceptItems[];
  /**
   * Scoped concepts the bank cannot build one form for. Not served, and carried
   * forward so the gate and the report can both say so out loud.
   */
  readonly unassessableConceptIds: readonly CurriculumConceptId[];
  /** True when any concept had to repeat an item. */
  readonly anyRecycled: boolean;
  /** Concepts whose form missed its open-response quota and is guessable. */
  readonly guessableConceptIds: readonly CurriculumConceptId[];
}

// ---------------------------------------------------------------------------
// The served ledger
// ---------------------------------------------------------------------------

/**
 * Per-concept record of every item this profile has been served, in service
 * order. Array order is load-bearing: it is what "oldest served" means when the
 * reserve runs out, so this is a list and not a set.
 */
export type ServedLedger = readonly AssessmentConceptLedger[];

export const EMPTY_SERVED_LEDGER: ServedLedger = [];

export function servedItemIds(
  ledger: ServedLedger,
  conceptId: CurriculumConceptId,
): readonly string[] {
  return ledger.find((entry) => entry.conceptId === conceptId)?.servedItemIds ?? [];
}

/**
 * Append a form's items to the ledger.
 *
 * Recorded at selection time, not at answer time. An abandoned attempt still
 * burned its items — the student saw them — so an attempt a student walks away
 * from must not hand them the same form again with the answers now known.
 */
export function recordServed(
  ledger: ServedLedger,
  selection: FormSelection,
): ServedLedger {
  const byConcept = new Map<string, string[]>(
    ledger.map((entry) => [entry.conceptId, [...entry.servedItemIds]]),
  );
  for (const concept of selection.concepts) {
    const served = byConcept.get(concept.conceptId) ?? [];
    for (const itemId of concept.itemIds) {
      // A recycled item keeps its original position rather than moving to the
      // back. Its first exposure is the fact that matters, and re-dating it
      // would make it look freshly served next time.
      if (!served.includes(itemId)) served.push(itemId);
    }
    byConcept.set(concept.conceptId, served);
  }
  return [...byConcept.entries()].map(([conceptId, ids]) => ({
    conceptId,
    servedItemIds: ids,
  }));
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface SelectFormInput {
  readonly blueprint: ChapterAssessmentBlueprint;
  readonly bank: ItemBank;
  /** Every chapter concept on attempt 1; only unmastered ones on a retry. */
  readonly scopedConceptIds: readonly CurriculumConceptId[];
  readonly ledger: ServedLedger;
  /** The attempt's stored seed. Same seed, same form, forever. */
  readonly seedHex: FormSeedHex;
}

/**
 * Choose the items for one attempt.
 *
 * Deterministic and side-effect free: the same input always yields the same
 * form, which is what makes an event-sourced replay reproduce the exact test the
 * student sat rather than an equivalent one.
 */
export function selectForm(input: SelectFormInput): FormSelection {
  const { blueprint, bank, scopedConceptIds, ledger, seedHex } = input;
  const count = blueprint.itemsPerConcept;
  const concepts: SelectedConceptItems[] = [];
  const unassessable: CurriculumConceptId[] = [];

  for (const conceptId of scopedConceptIds) {
    const pool = bank.eligibleForConcept(conceptId);
    if (pool.length < count) {
      unassessable.push(conceptId);
      continue;
    }

    // Permute the reserve per concept, so appending an item to one concept
    // cannot change what another concept draws.
    const stream = conceptStreamSeed(seedHex, conceptId);
    const order = seededShuffle(
      pool.map((item) => item.itemId),
      stream,
    );
    const served = servedItemIds(ledger, conceptId);
    const probeOf = new Map(
      pool.map((item) => [item.itemId, item.probe ?? "UNSPECIFIED"]),
    );
    const openResponseIds = new Set(
      pool
        .filter((item) => item.format === "OPEN_RESPONSE")
        .map((item) => item.itemId),
    );

    const chosen: string[] = [];
    const usedProbes = new Set<ItemProbe>();
    let recycledCount = 0;

    const draw = (
      candidates: readonly string[],
      need: number,
      deprioritise?: (itemId: string) => boolean,
    ): void => {
      if (need <= 0) return;
      // Prefer a probe stance this form has not used yet. A stable partition of
      // the already-shuffled order, so the preference never costs determinism.
      const available = candidates.filter((itemId) => !chosen.includes(itemId));
      const byProbe = [
        ...available.filter((itemId) => !usedProbes.has(probeOf.get(itemId)!)),
        ...available.filter((itemId) => usedProbes.has(probeOf.get(itemId)!)),
      ];
      // Applied after the probe partition, so it dominates: conserving a prose
      // item for a later form protects that form's guess-resistance outright,
      // where probe variety is a quality preference within this one.
      const ranked = deprioritise
        ? [
            ...byProbe.filter((itemId) => !deprioritise(itemId)),
            ...byProbe.filter((itemId) => deprioritise(itemId)),
          ]
        : byProbe;

      // The fresh-item rule itself is contracts' `selectFreshItems`, consumed
      // rather than re-derived: the API route and this engine must not hold two
      // opinions about what "fresh" means.
      const fresh = selectFreshItems({
        reserveItemIds: ranked,
        servedItemIds: served,
        count: need,
      });
      for (const itemId of fresh.itemIds) {
        chosen.push(itemId);
        usedProbes.add(probeOf.get(itemId)!);
      }
      if (!fresh.exhausted) return;

      const recycled = recycleOldestServed(
        ranked,
        served,
        chosen,
        need - fresh.itemIds.length,
      );
      for (const itemId of recycled) {
        chosen.push(itemId);
        usedProbes.add(probeOf.get(itemId)!);
      }
      recycledCount += recycled.length;
    };

    // Phase 1: the open-response quota, drawn first so a short reserve spends
    // its prose items on the quota rather than on whatever the shuffle put first.
    const quota = Math.min(blueprint.openResponsePerForm, count);
    draw(
      order.filter((itemId) => openResponseIds.has(itemId)),
      quota,
    );
    // Phase 2: fill the rest from the whole reserve, spending no MORE prose than
    // the quota. Two prose items on one form is one fewer guess-resistant form
    // later, and the reserve holds exactly three of them.
    //
    // Only when a quota exists. A blueprint that asks for no prose is saying it
    // has no requirement, not that prose should be avoided — there is nothing to
    // conserve it for, so selection stays format-blind.
    draw(
      order,
      count - chosen.length,
      quota > 0 ? (itemId) => openResponseIds.has(itemId) : undefined,
    );

    const chosenOpenResponse = chosen.filter((itemId) =>
      openResponseIds.has(itemId),
    );
    const probes = chosen.map((itemId) => probeOf.get(itemId)!);

    concepts.push({
      conceptId,
      itemIds: chosen,
      freshness:
        recycledCount === 0
          ? "FRESH"
          : recycledCount >= chosen.length
            ? "FULL_RECYCLE"
            : "PARTIAL_RECYCLE",
      freshCount: chosen.length - recycledCount,
      recycledCount,
      openResponseItemIds: chosenOpenResponse,
      guessResistant: chosenOpenResponse.length >= quota,
      probesDistinct:
        !probes.includes("UNSPECIFIED") &&
        new Set(probes).size === probes.length,
    });
  }

  return {
    seedHex,
    concepts,
    unassessableConceptIds: unassessable,
    anyRecycled: concepts.some((concept) => concept.recycledCount > 0),
    guessableConceptIds: concepts
      .filter((concept) => !concept.guessResistant)
      .map((concept) => concept.conceptId),
  };
}

/**
 * Refill a short form from items already served, oldest exposure first.
 *
 * Ordered by position in the served ledger rather than by the shuffle, because
 * the point is to maximise the gap since the student last saw the item. Ties
 * — items served in the same form — fall back to the shuffled order so the
 * choice stays deterministic.
 */
function recycleOldestServed(
  order: readonly string[],
  served: readonly string[],
  alreadyChosen: readonly string[],
  shortfall: number,
): string[] {
  if (shortfall <= 0) return [];
  const chosen = new Set(alreadyChosen);
  const candidates = order
    .filter((itemId) => served.includes(itemId) && !chosen.has(itemId))
    .sort((a, b) => {
      const byAge = served.indexOf(a) - served.indexOf(b);
      return byAge !== 0 ? byAge : order.indexOf(a) - order.indexOf(b);
    });
  return candidates.slice(0, shortfall);
}

/** The descriptors for a selection, in served order. Presentation input. */
export function formItems(
  selection: FormSelection,
  bank: ItemBank,
): readonly AssessmentItemDescriptor[] {
  const items: AssessmentItemDescriptor[] = [];
  for (const concept of selection.concepts) {
    for (const itemId of concept.itemIds) {
      const item = bank.item(itemId);
      if (item) items.push(item);
    }
  }
  return items;
}
