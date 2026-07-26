// The capstone item bank.
//
// TWO PROPERTIES OF THIS FILE ARE LOAD-BEARING.
//
// 1. NO ANSWER KEY. `AssessmentItemDescriptor` has no `correctOptionId`, no
//    `isCorrect` on an option, and no rubric. That is not an omission to be
//    filled in later — it is the mechanism by which this package cannot grade
//    (see grading.ts). The retired `AssessmentItem` in
//    contracts/src/assessment.ts does carry a key, which is why this package
//    does not use it.
//
// 2. PROVENANCE IS PER ITEM, NEVER A BLANKET CLAIM. "Built on released STAAR
//    items" is a statement a district will act on, and it is false the moment
//    one item in the form was authored in-house. So provenance is a required
//    field on every item, it is a discriminated union rather than a boolean, and
//    a released item cannot be constructed without the fields that make the
//    claim checkable: the administration, TEA's own form title, the item number
//    as TEA published it, the URL the text came from, and the separate URL the
//    key came from. `formProvenanceRollup` turns that into the count a report
//    prints, so nobody has to summarise it by hand.

import { eraOverlapsWindow, type CurriculumConceptId, type EraRange } from "./curriculum.js";

export type AssessmentItemFormat = "SELECTED_RESPONSE" | "OPEN_RESPONSE";

/**
 * How an item comes at its concept.
 *
 * WHY THIS FIELD EXISTS. Selection treats a concept's reserve as interchangeable:
 * it shuffles and draws. That is only sound if the items are genuinely parallel
 * forms — the same proposition reached by different routes. If two items in a pool
 * are one question reworded, then a retry that draws a "fresh" item id draws the
 * reworded twin, and the retry measures recall of the first attempt's answer
 * instead of learning. Freshness is enforced by item id, and an id cannot detect
 * semantic duplication, so the distinctness has to be declared.
 *
 * The six values are not invented. They are the stances the eighteen M1 duel items
 * already use, named: `POSTWAR.WHY_NOW` is RECALL, `STAMP.DEED_OR_CLOTH` is
 * BOUNDARY, `POSTWAR.WHICH_CAME_FIRST` is ORDERING,
 * `STAMP.CORRECT_THE_APPRENTICE` is CORRECTION, `REP.NOT_THE_MONEY` is
 * DISCRIMINATION, and `REP.LAWFUL_BUT_UNJUST` is APPLICATION. Six stances is also
 * exactly the six-item reserve, one per probe.
 */
export type ItemProbe =
  /** States the proposition directly. "What right did the colonists claim?" */
  | "RECALL"
  /** A case just inside or outside the concept's edge. "A deed or a bolt of cloth?" */
  | "BOUNDARY"
  /** Which came first, or which caused which. "Debt, then tax — or the reverse?" */
  | "ORDERING"
  /** A wrong statement to repair. "An apprentice says… correct him." */
  | "CORRECTION"
  /** Rules out the plausible-but-wrong reading. "The objection was not the cost." */
  | "DISCRIMINATION"
  /** Applies the proposition to a situation the module never showed. */
  | "APPLICATION"
  /** Not yet tagged. Legal, and reported as a content gap. */
  | "UNSPECIFIED";

export const ITEM_PROBES: readonly ItemProbe[] = [
  "RECALL",
  "BOUNDARY",
  "ORDERING",
  "CORRECTION",
  "DISCRIMINATION",
  "APPLICATION",
];

/**
 * Review status, using @pa/curriculum's vocabulary rather than a new one.
 *
 * Nothing in the repository holds SME_APPROVED today, which is why review status
 * is reported rather than enforced by default: a gate that empties the bank is a
 * gate that gets turned off. `requireReviewed` in `ItemEligibilityOptions` is the
 * switch for the pass where sign-off exists.
 */
export type ItemReviewStatus = "DRAFT" | "OWNER_PROVIDED" | "SME_APPROVED";

/**
 * How strong TEA's own publication of an item is. Straight from the released-item
 * schema in content/staar, because weakening it here would launder it.
 */
export type ReleasedItemStrength =
  | "RELEASED_FORM_ITEM"
  | "SAMPLER_NOT_CONFIRMED_ADMINISTERED";

/**
 * An item TEA published. Every field is copied from a TEA document; none is
 * inferred. `keySourceUrl` is separate from `sourceUrl` on purpose — the answer
 * key is usually in a different document from the item text, and an item whose
 * key was decided by reading the options and picking the best-looking one is not
 * a released item.
 */
export interface ReleasedTeaProvenance {
  readonly kind: "RELEASED_TEA";
  readonly publisher: "Texas Education Agency";
  /** As TEA labels it, e.g. "2019 May". */
  readonly administration: string;
  /** TEA's own form title, verbatim. */
  readonly testForm: string;
  /** Position exactly as TEA numbered it. Never renumbered. */
  readonly itemNumberAsPublished: number;
  /** TEA's notation for that year, unnormalized: "8.4(A)", "8.4.A", "4.A". */
  readonly teksAsPublished: string;
  readonly reportingCategory: number;
  readonly sourceUrl: string;
  readonly keySourceUrl: string;
  readonly strength: ReleasedItemStrength;
  /** Present when provenance is weaker than the strength alone suggests. */
  readonly caveat?: string;
}

/**
 * An item written for this product in the STAAR idiom. Authored items are what
 * make two-items-per-concept reachable, and calling them released items would be
 * the single most damaging thing this package could get wrong.
 */
export interface AuthoredProvenance {
  readonly kind: "AUTHORED_STAAR_STYLE";
  /** Repository path or document section the item was authored in. */
  readonly authoredIn: string;
  /** A released item this was modelled on, when there is one. */
  readonly modelledOnItemId?: string;
  readonly note?: string;
}

export type ItemProvenance = ReleasedTeaProvenance | AuthoredProvenance;

/** Presentation only. There is deliberately no `isCorrect` and no `rationale`. */
export interface AssessmentItemOption {
  readonly optionId: string;
  readonly text: string;
}

export interface AssessmentItemDescriptor {
  readonly itemId: string;
  readonly itemVersion: string;
  /**
   * The concept this item is scored against — the PRIMARY evidence in
   * @pa/curriculum's many-to-many item mapping. Secondary evidence is real and
   * is recorded there, but per-concept mastery needs one unambiguous owner or
   * one wrong answer would deny mastery on three concepts at once.
   */
  readonly conceptId: CurriculumConceptId;
  readonly format: AssessmentItemFormat;
  /**
   * Which route this item takes to the concept. Two items on one form must not
   * share a probe; see `selectForm`. Defaults to UNSPECIFIED when absent, which
   * is legal and is reported rather than refused.
   */
  readonly probe?: ItemProbe;
  readonly provenance: ItemProvenance;
  readonly reviewStatus: ItemReviewStatus;
  /** Historical era as authored, e.g. "1765" or "1764-1767". */
  readonly era: string | null;
  /** The stimulus and question, composed. Null when only a prompt exists. */
  readonly stem: string | null;
  /** Used instead of `stem` for an open-response item. */
  readonly prompt?: string;
  /** Empty for open response. */
  readonly options: readonly AssessmentItemOption[];
  /**
   * False when the item cannot be used as captured — almost always because it
   * depends on an image TEA never published as text.
   */
  readonly usableAsIs: boolean;
  /**
   * False when TEA published only the correct placements, so the distractor pool
   * is unknown. Such an item is not a reconstructed item and must not be served.
   */
  readonly optionPoolComplete: boolean | null;
  readonly usabilityNote?: string;
}

export type ItemRefusal =
  /** Depends on an image or table that was never published as text. */
  | "NOT_USABLE_AS_IS"
  /** TEA published the key but not the full distractor pool. */
  | "OPTION_POOL_INCOMPLETE"
  /** A selected-response item with fewer than two options is not an item. */
  | "TOO_FEW_OPTIONS"
  /** Neither a stem nor a prompt: there is no question to ask. */
  | "NO_QUESTION_TEXT"
  /** The item's era does not overlap the chapter's window. */
  | "ERA_OUTSIDE_WINDOW"
  /** Only under `requireReviewed`. */
  | "NOT_SME_APPROVED";

export interface ItemEligibilityOptions {
  /** Chapter era window. Omit to skip the era check entirely. */
  readonly eraWindow?: EraRange;
  /** Refuse anything short of SME_APPROVED. Off by default; see above. */
  readonly requireReviewed?: boolean;
}

export interface ItemEligibility {
  readonly itemId: string;
  readonly eligible: boolean;
  readonly refusals: readonly ItemRefusal[];
}

/**
 * Whether an item may be served. Returns every reason rather than the first, so
 * a content report can fix an item in one pass.
 *
 * An item with an unknown era is allowed through with a null era rather than
 * refused. Refusing it would silently drop authored items that simply have not
 * been tagged, and the era check exists to catch a Yorktown item in a Boston
 * form, not to enforce tagging discipline.
 */
export function itemEligibility(
  item: AssessmentItemDescriptor,
  options: ItemEligibilityOptions = {},
): ItemEligibility {
  const refusals: ItemRefusal[] = [];
  if (!item.usableAsIs) refusals.push("NOT_USABLE_AS_IS");
  if (item.optionPoolComplete === false) refusals.push("OPTION_POOL_INCOMPLETE");
  if (item.format === "SELECTED_RESPONSE" && item.options.length < 2) {
    refusals.push("TOO_FEW_OPTIONS");
  }
  const hasQuestion =
    (item.stem !== null && item.stem.length > 0) ||
    (item.prompt !== undefined && item.prompt.length > 0);
  if (!hasQuestion) refusals.push("NO_QUESTION_TEXT");
  if (options.eraWindow && eraOverlapsWindow(item.era, options.eraWindow) === false) {
    refusals.push("ERA_OUTSIDE_WINDOW");
  }
  if (options.requireReviewed && item.reviewStatus !== "SME_APPROVED") {
    refusals.push("NOT_SME_APPROVED");
  }
  return { itemId: item.itemId, eligible: refusals.length === 0, refusals };
}

// ---------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------

export interface ItemBank {
  /** Every item, in authored order. */
  readonly items: readonly AssessmentItemDescriptor[];
  item(itemId: string): AssessmentItemDescriptor | undefined;
  /**
   * Items eligible for this concept, in authored order. Authored order is the
   * reserve order, and selection permutes it with a stored seed rather than
   * relying on it, so an author can append to a bank without changing which
   * items an existing attempt would replay.
   */
  eligibleForConcept(conceptId: CurriculumConceptId): readonly AssessmentItemDescriptor[];
  /** Why each refused item was refused. The content-defect work list. */
  readonly refused: readonly ItemEligibility[];
}

export function buildItemBank(
  items: readonly AssessmentItemDescriptor[],
  options: ItemEligibilityOptions = {},
): ItemBank {
  const byId = new Map<string, AssessmentItemDescriptor>();
  const byConcept = new Map<CurriculumConceptId, AssessmentItemDescriptor[]>();
  const refused: ItemEligibility[] = [];

  for (const item of items) {
    if (byId.has(item.itemId)) {
      throw new Error(`duplicate item id in bank: ${item.itemId}`);
    }
    byId.set(item.itemId, item);
    const eligibility = itemEligibility(item, options);
    if (!eligibility.eligible) {
      refused.push(eligibility);
      continue;
    }
    const list = byConcept.get(item.conceptId) ?? [];
    list.push(item);
    byConcept.set(item.conceptId, list);
  }

  return {
    items,
    refused,
    item: (itemId) => byId.get(itemId),
    eligibleForConcept: (conceptId) => byConcept.get(conceptId) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Provenance reporting
// ---------------------------------------------------------------------------

export interface ProvenanceRollup {
  readonly total: number;
  readonly releasedTea: number;
  readonly authored: number;
  /** Released items TEA published in a sampler without confirming they were administered. */
  readonly samplerNotConfirmed: number;
  readonly openResponse: number;
  /** Item ids by provenance kind, so a report can list rather than only count. */
  readonly releasedTeaItemIds: readonly string[];
  readonly authoredItemIds: readonly string[];
}

/**
 * The provenance of a set of items, counted rather than claimed.
 *
 * A teacher-facing report prints this for the FIRST-ATTEMPT form specifically,
 * because that is the form whose score is the reported measure. A retry form has
 * different items and therefore different provenance, and averaging the two
 * would produce a number describing no actual test.
 */
export function formProvenanceRollup(
  items: readonly AssessmentItemDescriptor[],
): ProvenanceRollup {
  const releasedTeaItemIds: string[] = [];
  const authoredItemIds: string[] = [];
  let samplerNotConfirmed = 0;
  let openResponse = 0;

  for (const item of items) {
    if (item.format === "OPEN_RESPONSE") openResponse += 1;
    if (item.provenance.kind === "RELEASED_TEA") {
      releasedTeaItemIds.push(item.itemId);
      if (item.provenance.strength === "SAMPLER_NOT_CONFIRMED_ADMINISTERED") {
        samplerNotConfirmed += 1;
      }
    } else {
      authoredItemIds.push(item.itemId);
    }
  }

  return {
    total: items.length,
    releasedTea: releasedTeaItemIds.length,
    authored: authoredItemIds.length,
    samplerNotConfirmed,
    openResponse,
    releasedTeaItemIds,
    authoredItemIds,
  };
}

// ---------------------------------------------------------------------------
// The adapter from content/staar
// ---------------------------------------------------------------------------

/**
 * The subset of a `content/staar/items/*.json` entry this adapter reads, as a
 * structural type.
 *
 * Structural rather than an import on purpose. `content/staar` is another work
 * item's output and is still moving, so binding to its JSON at build time would
 * couple this package's typecheck to a data file. A structural parameter means a
 * shape change surfaces at the one call site that builds the bank.
 */
export interface ReleasedItemCapture {
  readonly itemId: string;
  readonly itemVersion: string;
  readonly provenance: {
    readonly administration: string;
    readonly testForm: string;
    readonly itemNumberAsPublished: number;
    readonly teksAsPublished: string;
    readonly reportingCategory: number;
    readonly sourceUrl: string;
    readonly keySourceUrl: string;
    readonly provenanceCaveat?: string;
  };
  readonly provenanceStrength?: ReleasedItemStrength;
  readonly itemFormat?: string;
  readonly era?: string;
  readonly stem?: string | null;
  readonly prompt?: string;
  readonly stimulus?: { readonly text?: string | null; readonly imageDependent: boolean };
  readonly options?: readonly { readonly optionId: string; readonly text: string }[] | null;
  readonly optionPoolComplete?: boolean | null;
  readonly usableAsIs?: boolean;
  readonly usabilityNote?: string;
}

/**
 * Lift a released-item capture into a bank descriptor.
 *
 * Note the two things this drops on the floor. `correctOptionId` and
 * `correctAnswerFromOfficialKey` are present in the capture and are NOT copied:
 * they belong to the grading authority's key table, and carrying them into a
 * descriptor is how a key ends up in a client bundle. `rationale` is dropped for
 * the same reason — a distractor rationale explains which option is wrong.
 *
 * The concept id is a parameter rather than read from the capture's
 * `bostonConcept` field, because that field is free text and this package
 * accepts only canonical ids. Resolve it through `resolveConceptRef` first.
 */
export function fromReleasedItemCapture(
  capture: ReleasedItemCapture,
  conceptId: CurriculumConceptId,
): AssessmentItemDescriptor {
  const stimulusText = capture.stimulus?.text ?? null;
  const question = capture.stem ?? null;
  const stem =
    stimulusText && question
      ? `${stimulusText}\n\n${question}`
      : (question ?? stimulusText);
  const imageDependent = capture.stimulus?.imageDependent === true;
  const format: AssessmentItemFormat =
    capture.itemFormat === "SHORT_CONSTRUCTED_RESPONSE"
      ? "OPEN_RESPONSE"
      : "SELECTED_RESPONSE";

  const descriptor: AssessmentItemDescriptor = {
    itemId: capture.itemId,
    itemVersion: capture.itemVersion,
    conceptId,
    format,
    provenance: {
      kind: "RELEASED_TEA",
      publisher: "Texas Education Agency",
      administration: capture.provenance.administration,
      testForm: capture.provenance.testForm,
      itemNumberAsPublished: capture.provenance.itemNumberAsPublished,
      teksAsPublished: capture.provenance.teksAsPublished,
      reportingCategory: capture.provenance.reportingCategory,
      sourceUrl: capture.provenance.sourceUrl,
      keySourceUrl: capture.provenance.keySourceUrl,
      strength: capture.provenanceStrength ?? "RELEASED_FORM_ITEM",
      ...(capture.provenance.provenanceCaveat
        ? { caveat: capture.provenance.provenanceCaveat }
        : {}),
    },
    // A released TEA item is published curriculum, not our authoring, so it
    // needs no SME sign-off of its content. It still needs an alignment review,
    // which is the concept mapping's business rather than the item's.
    reviewStatus: "SME_APPROVED",
    era: capture.era ?? null,
    stem,
    ...(capture.prompt ? { prompt: capture.prompt } : {}),
    options: (capture.options ?? []).map((option) => ({
      optionId: option.optionId,
      text: option.text,
    })),
    // An image-dependent item is unusable however TEA flagged it.
    usableAsIs: (capture.usableAsIs ?? true) && !imageDependent,
    optionPoolComplete: capture.optionPoolComplete ?? null,
    ...(capture.usabilityNote ? { usabilityNote: capture.usabilityNote } : {}),
  };
  return descriptor;
}
