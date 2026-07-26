// The chapter capstone blueprint, and the readiness check that says whether the
// content can actually build a form yet.
//
// ONE CAPSTONE PER CHAPTER, COVERING EVERY CONCEPT IN IT. Not one per mission.
// A per-mission assessment would test each concept while it was freshest, which
// is the opposite of what a capstone is for: the claim being made is that the
// student holds the chapter, not that they held each piece of it on the day they
// were taught it.
//
// TWO ITEMS PER CONCEPT, AND THAT IS DELIBERATELY SMALL. A larger form was
// rejected by the owner. The reason two is defensible rather than merely short is
// that mastery here is all-or-nothing at 100%: two items with no partial credit
// is a stricter bar than eight items at 75%, and it is a bar a student can
// actually clear in one sitting instead of abandoning halfway.
//
// THE RESERVE IS SIZED FOR THREE ATTEMPTS, NOT FOR ONE FORM. `itemsPerConcept` is
// what a form serves; `reserveTargetPerConcept` is what the bank must hold so
// that a first attempt and two shrinking retries can each draw fresh items. Six
// is three times two. Beyond that, items recycle rather than the retry being
// refused — see select.ts.

import { registryConceptSource, type ConceptSource, type CurriculumConceptId, type EraRange } from "./curriculum.js";
import {
  formProvenanceRollup,
  type ItemBank,
  type ItemProbe,
  type ProvenanceRollup,
} from "./items.js";
import { ASSESSMENT_ITEMS_PER_CONCEPT } from "./protocol.js";

/** Enough distinct forms for about three attempts before items may recycle. */
export const RESERVE_TARGET_PER_CONCEPT =
  ASSESSMENT_ITEMS_PER_CONCEPT * 3;

/** Forms the reserve target is sized for. */
export const FRESH_FORM_TARGET = 3;

/**
 * At least one open-response item on every concept's form, and it is a
 * requirement rather than a preference.
 *
 * THE ARITHMETIC THAT MAKES IT ONE. Mastery is 100% of two items with no partial
 * credit. Two four-option multiple-choice items give a blind guesser a 1/16 chance
 * of mastering the concept outright — so on a 32-concept chapter, guessing alone
 * falsely masters two concepts on the first sitting, and each one mints a permanent
 * PvP-legal Codex card.
 *
 * It gets worse rather than better with the retry policy this engine deliberately
 * chose. Retries are unlimited (see `ASSESSMENT_ATTEMPTS_ARE_UNLIMITED`) and each
 * draws fresh items, so the guesser gets independent 1/16 rolls forever: 17.6% per
 * concept within three attempts, 47.6% within ten, 72.5% within twenty. On an
 * all-multiple-choice capstone, guessing is a winning strategy given patience, and
 * the whole educational claim rests on this form.
 *
 * One open-response item per form fixes it, because prose cannot be guessed. The
 * two decisions are coupled: unlimited retries are only defensible while every
 * form contains something a student has to actually write.
 */
export const OPEN_RESPONSE_PER_FORM = 1;

/**
 * The capstone pays nothing. Typed as the literal `0` rather than `number`, so
 * the type itself refuses a future "small encouraging XP reward" — XP comes only
 * from mission clears, and an assessment that paid XP would make the mandatory
 * learning gate a grind target.
 */
export const ASSESSMENT_XP_AWARD: 0 = 0;

export interface ChapterAssessmentBlueprint {
  readonly assessmentId: string;
  readonly chapterId: string;
  /**
   * The learning module that gates the first attempt and every retry. On a retry
   * it is replayed narrowed to the unmastered concepts.
   */
  readonly moduleId: string;
  /** Every assessable concept in the chapter, in a stable order. */
  readonly conceptIds: readonly CurriculumConceptId[];
  readonly itemsPerConcept: number;
  readonly reserveTargetPerConcept: number;
  /**
   * Open-response items every concept's form must contain. The guess-resistance
   * floor; see `OPEN_RESPONSE_PER_FORM`.
   */
  readonly openResponsePerForm: number;
  /** Refuse items whose era falls outside the chapter. Omit to skip the check. */
  readonly eraWindow?: EraRange;
}

export interface CompileBlueprintInput {
  readonly assessmentId: string;
  readonly chapterId: string;
  readonly moduleId: string;
  /** Defaults to the real @pa/curriculum registry. */
  readonly concepts?: ConceptSource;
  readonly itemsPerConcept?: number;
  readonly reserveTargetPerConcept?: number;
  readonly openResponsePerForm?: number;
  readonly eraWindow?: EraRange;
}

/**
 * Build a blueprint from the curriculum registry.
 *
 * The concept list is read, not authored. A hand-written concept list on the
 * accountability surface would drift from the registry the moment a concept was
 * added, and the failure mode is silent: a chapter that stops assessing a
 * standard nobody noticed it dropped.
 *
 * MICRO concepts are excluded because the registry marks them unassessable —
 * they are enrichment reached through the reactive world, and gating a chapter on
 * content a student may never have encountered would be indefensible.
 */
export function compileBlueprint(
  input: CompileBlueprintInput,
): ChapterAssessmentBlueprint {
  const concepts = input.concepts ?? registryConceptSource();
  // Throws `UnknownChapterError` for a chapter the source does not hold, which
  // is a different fault from a chapter it holds and finds empty. Keeping both
  // checks is the point: the first says the key is wrong, the second says the
  // authoring is.
  const assessable = concepts
    .assessableConcepts(input.chapterId)
    .filter((concept) => concept.tier === "MACRO");
  if (assessable.length === 0) {
    throw new Error(
      `chapter has no assessable concepts, so it has no capstone: ${input.chapterId}`,
    );
  }
  return {
    assessmentId: input.assessmentId,
    chapterId: input.chapterId,
    moduleId: input.moduleId,
    conceptIds: assessable.map((concept) => concept.conceptId),
    itemsPerConcept: input.itemsPerConcept ?? ASSESSMENT_ITEMS_PER_CONCEPT,
    reserveTargetPerConcept:
      input.reserveTargetPerConcept ?? RESERVE_TARGET_PER_CONCEPT,
    openResponsePerForm: input.openResponsePerForm ?? OPEN_RESPONSE_PER_FORM,
    ...(input.eraWindow ? { eraWindow: input.eraWindow } : {}),
  };
}

/**
 * Concepts the bank cannot build one form for, read from the bank rather than
 * from a student's history.
 *
 * This exists separately from `blueprintReadiness` because the gate needs the
 * answer BEFORE an attempt is opened. Deriving it from the event log instead
 * would mean a chapter whose bank is empty could only be discovered to be
 * unassessable after the student had already been sent through a three-minute
 * module and handed an empty form.
 */
export function unassessableConceptIds(
  blueprint: ChapterAssessmentBlueprint,
  bank: ItemBank,
): readonly CurriculumConceptId[] {
  return blueprint.conceptIds.filter(
    (conceptId) =>
      bank.eligibleForConcept(conceptId).length < blueprint.itemsPerConcept,
  );
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * READY        — reserve meets the target; three attempts can draw fresh items.
 * THIN         — a form can be built, but a retry will recycle sooner than
 *                intended. Playable, and worth reporting.
 * UNASSESSABLE — fewer eligible items than one form needs. The concept cannot be
 *                asked at all, which has consequences in select.ts and gate.ts.
 */
export type ConceptReadinessStatus = "READY" | "THIN" | "UNASSESSABLE";

export type ReadinessFinding =
  /** No item TEA published. District accountability wants at least one. */
  | "NO_RELEASED_TEA_ITEM"
  /** Reserve below target: a third attempt will repeat items. */
  | "RESERVE_BELOW_TARGET"
  /** Fewer eligible items than one form serves. */
  | "INSUFFICIENT_FOR_ONE_FORM"
  /** No item at all, eligible or otherwise. */
  | "NO_ITEMS_AT_ALL"
  /** Items exist but every one of them was refused. See `ItemBank.refused`. */
  | "ALL_ITEMS_REFUSED"
  /** No open-ended item, so this concept is only ever tested by recognition. */
  | "NO_OPEN_RESPONSE_ITEM"
  /**
   * Fewer open-response items than three forms need, so at least one form is
   * all-multiple-choice and therefore guessable. See `OPEN_RESPONSE_PER_FORM`.
   */
  | "OPEN_RESPONSE_BELOW_FORM_QUOTA"
  /**
   * Two or more items share a probe stance, so a form may ask the same question
   * twice in different words. See `ItemProbe`.
   */
  | "DUPLICATE_PROBE"
  /** At least one item carries no probe stance, so distinctness cannot be checked. */
  | "UNTAGGED_PROBE";

export interface ConceptReadiness {
  readonly conceptId: CurriculumConceptId;
  readonly status: ConceptReadinessStatus;
  readonly eligibleItems: number;
  readonly releasedTeaItems: number;
  readonly authoredItems: number;
  readonly openResponseItems: number;
  /** Whole forms the reserve can build before anything repeats. */
  readonly freshFormsAvailable: number;
  /**
   * Forms that can be built with their full open-response quota. Below
   * `freshFormsAvailable` whenever the prose items run out first, and that
   * difference is the number of guessable forms in the reserve.
   */
  readonly guessResistantFormsAvailable: number;
  /** Distinct probe stances present. Six is the target; see `ItemProbe`. */
  readonly probesCovered: readonly ItemProbe[];
  readonly findings: readonly ReadinessFinding[];
}

export interface BlueprintReadiness {
  readonly assessmentId: string;
  readonly chapterId: string;
  readonly byConcept: readonly ConceptReadiness[];
  /** Concepts that cannot be asked. Excluded from every form and from the gate. */
  readonly unassessableConceptIds: readonly CurriculumConceptId[];
  /** True when every scoped concept can build at least one form. */
  readonly formBuildable: boolean;
  readonly provenance: ProvenanceRollup;
}

/**
 * Whether the content can build a form, per concept.
 *
 * Nothing here throws and nothing here is a hard failure. The Boston bank holds
 * three selectable items against roughly thirty concepts today, so a check that
 * refused to produce a report until the bank was complete would produce no report
 * at all for months. This is the work list.
 */
export function blueprintReadiness(
  blueprint: ChapterAssessmentBlueprint,
  bank: ItemBank,
): BlueprintReadiness {
  const refusedIds = new Set(bank.refused.map((entry) => entry.itemId));
  const byConcept: ConceptReadiness[] = blueprint.conceptIds.map((conceptId) => {
    const eligible = bank.eligibleForConcept(conceptId);
    const allForConcept = bank.items.filter(
      (item) => item.conceptId === conceptId,
    );
    const rollup = formProvenanceRollup(eligible);
    const findings: ReadinessFinding[] = [];

    if (allForConcept.length === 0) {
      findings.push("NO_ITEMS_AT_ALL");
    } else if (
      eligible.length === 0 &&
      allForConcept.every((item) => refusedIds.has(item.itemId))
    ) {
      findings.push("ALL_ITEMS_REFUSED");
    }
    if (eligible.length < blueprint.itemsPerConcept) {
      findings.push("INSUFFICIENT_FOR_ONE_FORM");
    } else if (eligible.length < blueprint.reserveTargetPerConcept) {
      findings.push("RESERVE_BELOW_TARGET");
    }
    if (rollup.releasedTea === 0) findings.push("NO_RELEASED_TEA_ITEM");
    if (rollup.openResponse === 0) {
      findings.push("NO_OPEN_RESPONSE_ITEM");
    } else if (
      rollup.openResponse <
      blueprint.openResponsePerForm * FRESH_FORM_TARGET
    ) {
      findings.push("OPEN_RESPONSE_BELOW_FORM_QUOTA");
    }

    const probeCounts = new Map<ItemProbe, number>();
    for (const item of eligible) {
      const probe = item.probe ?? "UNSPECIFIED";
      probeCounts.set(probe, (probeCounts.get(probe) ?? 0) + 1);
    }
    if (probeCounts.has("UNSPECIFIED")) findings.push("UNTAGGED_PROBE");
    for (const [probe, count] of probeCounts) {
      if (probe !== "UNSPECIFIED" && count > 1) {
        findings.push("DUPLICATE_PROBE");
        break;
      }
    }

    const status: ConceptReadinessStatus =
      eligible.length < blueprint.itemsPerConcept
        ? "UNASSESSABLE"
        : eligible.length < blueprint.reserveTargetPerConcept
          ? "THIN"
          : "READY";

    return {
      conceptId,
      status,
      eligibleItems: eligible.length,
      releasedTeaItems: rollup.releasedTea,
      authoredItems: rollup.authored,
      openResponseItems: rollup.openResponse,
      freshFormsAvailable: Math.floor(eligible.length / blueprint.itemsPerConcept),
      guessResistantFormsAvailable: Math.min(
        Math.floor(eligible.length / blueprint.itemsPerConcept),
        blueprint.openResponsePerForm === 0
          ? Number.POSITIVE_INFINITY
          : Math.floor(rollup.openResponse / blueprint.openResponsePerForm),
      ),
      probesCovered: [...probeCounts.keys()].filter(
        (probe) => probe !== "UNSPECIFIED",
      ),
      findings,
    };
  });

  const scopedItems = bank.items.filter(
    (item) =>
      blueprint.conceptIds.includes(item.conceptId) &&
      !refusedIds.has(item.itemId),
  );

  return {
    assessmentId: blueprint.assessmentId,
    chapterId: blueprint.chapterId,
    byConcept,
    unassessableConceptIds: byConcept
      .filter((entry) => entry.status === "UNASSESSABLE")
      .map((entry) => entry.conceptId),
    formBuildable: byConcept.every((entry) => entry.status !== "UNASSESSABLE"),
    provenance: formProvenanceRollup(scopedItems),
  };
}
