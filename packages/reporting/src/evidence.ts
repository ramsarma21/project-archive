// The two distinctions this whole package exists to preserve.
//
// ============================================================================
// DISTINCTION 1: A STUDENT GAP IS NOT AN ITEM SHORTAGE.
//
// "This student has not mastered the Stamp Act" and "we did not have enough
// questions to find out whether they had" are different facts with different
// owners, and conflating them is the most damaging error this report could make:
// one is a statement about a child that a teacher will act on, and the other is a
// statement about us. Today it is also the LIKELIER error, because a concept
// whose eligible pool is smaller than one form is UNASSESSABLE, and that is
// currently most of Boston.
//
// @pa/assessment already keeps the two apart — `NOT_MASTERED` versus
// `NOT_ASSESSED_CONTENT_GAP` — but it keeps them apart as two values of one
// enum, which is right for an engine and wrong for a reader: a UI that groups by
// "not mastered" merges them back together, and a count called "concepts
// outstanding" is where they merge silently.
//
// So reporting splits them structurally rather than by value:
//
//   * `ConceptOutcome` names five outcomes, and `outcomeOwner` maps each to who
//     owes the work — STUDENT, PRODUCT, or NOBODY.
//   * `EvidenceProfile` counts them into SEPARATE FIELDS with separate names:
//     `studentGaps` is the reteach list, `coverageDebt` is the content backlog.
//     There is deliberately no field that sums the two, because the sum is not a
//     quantity anybody should be shown.
//   * `measuredConcepts` excludes coverage debt, so every rate in this package is
//     over what was actually asked and says so.
//
// ============================================================================
// DISTINCTION 2: THE FIRST SITTING IS NOT CURRENT MASTERY.
//
// The capstone produces two facts and they answer different questions. The first
// sitting says what the student held unaided; current mastery says what they can
// demonstrate after however many retries it took. A teacher needs both, and the
// gap between them is more informative than either alone — it is the gap that
// says whether the missions taught the chapter or whether the retry module did.
//
// The requirement is not just that both exist. It is that a reader can never be
// shown one while believing it is the other. Two separate fields are not enough,
// because a number pulled into a cell, a chart, or a CSV column loses its field
// name. So EVERY measure in this package carries its own identity:
//
//   * a `measure` discriminant (`FIRST_SITTING_UNAIDED` / `CURRENT_AFTER_SUPPORT`),
//   * a `label` and a `basis` sentence, travelling with the number,
//   * and there is no type here with a bare `score` or `percent` at its root.
//
// A UI has to reach past a field literally called `label` to render one of these
// anonymously.

import type { ConceptReportStatus } from "./assessment.js";

// ---------------------------------------------------------------------------
// Per-concept outcomes
// ---------------------------------------------------------------------------

/**
 * MASTERED_UNAIDED        — 100% on the first sitting. The student had it.
 * MASTERED_AFTER_SUPPORT  — repaired on a retry, after retaking the module.
 *                           Counts for the gate and the card; it does NOT change
 *                           the first-sitting measure.
 * NOT_YET_MASTERED        — asked, and still owed. THE STUDENT'S WORK LIST.
 * NOT_MEASURED_ITEM_SHORTAGE
 *                         — the item bank could not build one form for this
 *                           concept, so the student was never asked. OUR WORK
 *                           LIST. Never counted against the student, never
 *                           counted as covered.
 * NOT_MEASURED_NOT_SAT    — no submitted attempt has scoped this concept yet.
 */
export type ConceptOutcome =
  | "MASTERED_UNAIDED"
  | "MASTERED_AFTER_SUPPORT"
  | "NOT_YET_MASTERED"
  | "NOT_MEASURED_ITEM_SHORTAGE"
  | "NOT_MEASURED_NOT_SAT";

/** Who owes the work an outcome implies. */
export type OutcomeOwner =
  /** The student. Reteach, then retry. */
  | "STUDENT"
  /** Us. Author items until the concept can be asked at all. */
  | "PRODUCT"
  /** Nobody: the concept is demonstrated. */
  | "NOBODY";

export function outcomeOwner(outcome: ConceptOutcome): OutcomeOwner {
  switch (outcome) {
    case "MASTERED_UNAIDED":
    case "MASTERED_AFTER_SUPPORT":
      return "NOBODY";
    case "NOT_YET_MASTERED":
    case "NOT_MEASURED_NOT_SAT":
      return "STUDENT";
    case "NOT_MEASURED_ITEM_SHORTAGE":
      return "PRODUCT";
  }
}

/** True when the student was actually asked about this concept at least once. */
export function outcomeWasMeasured(outcome: ConceptOutcome): boolean {
  return (
    outcome === "MASTERED_UNAIDED" ||
    outcome === "MASTERED_AFTER_SUPPORT" ||
    outcome === "NOT_YET_MASTERED"
  );
}

export function outcomeIsMastered(outcome: ConceptOutcome): boolean {
  return outcome === "MASTERED_UNAIDED" || outcome === "MASTERED_AFTER_SUPPORT";
}

/**
 * Translate the engine's status onto the reporting vocabulary.
 *
 * A total mapping over `ConceptReportStatus`, so a value added upstream fails the
 * build here rather than falling into a default bucket. Defaulting is exactly how
 * a new "we could not ask this" status would end up counted as a student gap.
 */
export function outcomeFromEngineStatus(
  status: ConceptReportStatus,
): ConceptOutcome {
  switch (status) {
    case "MASTERED_FIRST_ATTEMPT":
      return "MASTERED_UNAIDED";
    case "MASTERED_AFTER_RETRY":
      return "MASTERED_AFTER_SUPPORT";
    case "NOT_MASTERED":
      return "NOT_YET_MASTERED";
    case "NOT_ASSESSED_CONTENT_GAP":
      return "NOT_MEASURED_ITEM_SHORTAGE";
    case "NOT_ATTEMPTED":
      return "NOT_MEASURED_NOT_SAT";
  }
}

/**
 * How strong the evidence behind a mastered concept is.
 *
 * FRESH_ITEMS      — every item on the mastering form was one this student had
 *                    never seen.
 * RECYCLED_ITEMS   — the mastering form repeated an item the student had already
 *                    been served, because the concept's reserve was exhausted.
 *                    Weaker evidence, and disclosed rather than hidden.
 * NOT_RECORDED     — the durable rows this report was rebuilt from do not carry
 *                    per-form freshness. NOT the same as FRESH_ITEMS, and
 *                    deliberately not defaulted to it: claiming fresh evidence we
 *                    did not record would be a fabricated strengthening of the
 *                    exact claim this field exists to weaken.
 * NOT_APPLICABLE   — the concept is not mastered, so there is no mastering form.
 */
export type EvidenceStrength =
  | "FRESH_ITEMS"
  | "RECYCLED_ITEMS"
  | "NOT_RECORDED"
  | "NOT_APPLICABLE";

export function evidenceStrength(
  outcome: ConceptOutcome,
  masteredWithRecycledItems: boolean | null,
): EvidenceStrength {
  if (!outcomeIsMastered(outcome)) return "NOT_APPLICABLE";
  if (masteredWithRecycledItems === null) return "NOT_RECORDED";
  return masteredWithRecycledItems ? "RECYCLED_ITEMS" : "FRESH_ITEMS";
}

// ---------------------------------------------------------------------------
// The evidence profile: the counts, in separate fields
// ---------------------------------------------------------------------------

export interface EvidenceProfile {
  /** Every concept the chapter's capstone scopes. The honest denominator. */
  readonly conceptsInChapter: number;
  /** Concepts the student was actually asked about. */
  readonly measuredConcepts: number;
  readonly masteredUnaided: number;
  readonly masteredAfterSupport: number;
  /**
   * Measured, and not mastered. THE STUDENT'S WORK LIST — the only number that
   * belongs in a sentence beginning "this student needs".
   */
  readonly studentGaps: number;
  /**
   * Never asked, because the bank could not build a form. OUR WORK LIST. It is a
   * separate field from `studentGaps` and there is no field that adds them,
   * because the sum describes nothing.
   */
  readonly coverageDebt: number;
  /** Never asked, because no submitted attempt has scoped them yet. */
  readonly notYetSat: number;
}

/**
 * Count outcomes into the profile.
 *
 * One pass over one switch, so the buckets partition the input by construction:
 * every concept lands in exactly one, and `evidenceProfileIsPartition` lets a
 * test assert that against real data rather than against the claim.
 */
export function summariseOutcomes(
  outcomes: readonly ConceptOutcome[],
): EvidenceProfile {
  let masteredUnaided = 0;
  let masteredAfterSupport = 0;
  let studentGaps = 0;
  let coverageDebt = 0;
  let notYetSat = 0;

  for (const outcome of outcomes) {
    switch (outcome) {
      case "MASTERED_UNAIDED":
        masteredUnaided += 1;
        break;
      case "MASTERED_AFTER_SUPPORT":
        masteredAfterSupport += 1;
        break;
      case "NOT_YET_MASTERED":
        studentGaps += 1;
        break;
      case "NOT_MEASURED_ITEM_SHORTAGE":
        coverageDebt += 1;
        break;
      case "NOT_MEASURED_NOT_SAT":
        notYetSat += 1;
        break;
    }
  }

  return {
    conceptsInChapter: outcomes.length,
    measuredConcepts: masteredUnaided + masteredAfterSupport + studentGaps,
    masteredUnaided,
    masteredAfterSupport,
    studentGaps,
    coverageDebt,
    notYetSat,
  };
}

/** Every concept is in exactly one bucket. Asserted by the test suite. */
export function evidenceProfileIsPartition(profile: EvidenceProfile): boolean {
  const buckets =
    profile.masteredUnaided +
    profile.masteredAfterSupport +
    profile.studentGaps +
    profile.coverageDebt +
    profile.notYetSat;
  const measured =
    profile.masteredUnaided + profile.masteredAfterSupport + profile.studentGaps;
  return (
    buckets === profile.conceptsInChapter && measured === profile.measuredConcepts
  );
}

// ---------------------------------------------------------------------------
// The two measures, each carrying its own identity
// ---------------------------------------------------------------------------

export const MEASURE_FIRST_SITTING = "FIRST_SITTING_UNAIDED";
export const MEASURE_CURRENT = "CURRENT_AFTER_SUPPORT";

export const FIRST_SITTING_LABEL = "First sitting, unaided";
export const FIRST_SITTING_BASIS =
  "Attempt 1 only, before any retry or any reteaching. Retries repair mastery; " +
  "they never change this number. Scored over the items the student was actually " +
  "served.";

export const CURRENT_STANDING_LABEL = "Current mastery, after support";
export const CURRENT_STANDING_BASIS =
  "What the student can demonstrate now, after any number of retries, each " +
  "gated on retaking the learning module. This is what opens the next chapter " +
  "and mints a PvP-legal card. It is not an unaided measure and must never be " +
  "reported as one.";

/**
 * The reported academic measure: the first sitting.
 *
 * `coversWholeChapter` is false whenever the chapter carried any coverage debt,
 * because the percentage is then over a subset of the chapter and a reader who
 * does not know that will over-read it. There is no variant of this type that can
 * omit the flag.
 */
export interface FirstSittingMeasure {
  readonly measure: typeof MEASURE_FIRST_SITTING;
  readonly label: string;
  readonly basis: string;
  readonly itemsCorrect: number;
  readonly itemsServed: number;
  readonly percent: number;
  readonly conceptsMasteredUnaided: number;
  readonly conceptsAsked: number;
  readonly submittedAt: string;
  /**
   * A human review corrected a verdict on attempt 1 and the number moved. The
   * first sitting is protected from retries repairing it, not from a mis-grade
   * being fixed, so this is visible rather than silent.
   */
  readonly revisedByReview: boolean;
  /** The number as handed in, before review. Present only when it differs. */
  readonly asSubmitted: { readonly itemsCorrect: number; readonly itemsServed: number } | null;
  readonly coversWholeChapter: boolean;
}

export interface CurrentStandingMeasure {
  readonly measure: typeof MEASURE_CURRENT;
  readonly label: string;
  readonly basis: string;
  readonly conceptsMastered: number;
  /** Concepts that count toward the gate. Excludes coverage debt. */
  readonly conceptsRequired: number;
  readonly percent: number;
  readonly repairedConceptIds: readonly string[];
  readonly outstandingConceptIds: readonly string[];
  readonly attemptsUsed: number;
  readonly chapterUnlocked: boolean;
}

export function percentOf(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

// ---------------------------------------------------------------------------
// The gap between them
// ---------------------------------------------------------------------------

/**
 * How to read the distance between the two measures.
 *
 * TAUGHT_BY_THE_CHAPTER — the student held most of the chapter unaided. The
 *                         missions and modules did their job.
 * TAUGHT_BY_THE_RETRY   — they hold it now, but they did not hold it first time.
 *                         The chapter did not teach it; the retry loop did. This
 *                         is a signal about the CONTENT as much as the student.
 * NOT_YET_RESOLVED      — concepts are still outstanding.
 * NO_FIRST_SITTING      — attempt 1 has not been submitted, so there is nothing
 *                         to compare against and no reported measure exists.
 */
export type RepairInterpretation =
  | "TAUGHT_BY_THE_CHAPTER"
  | "TAUGHT_BY_THE_RETRY"
  | "NOT_YET_RESOLVED"
  | "NO_FIRST_SITTING";

/**
 * Distance, in percentage points of concept mastery, at which the retry loop is
 * doing more teaching than the chapter is.
 *
 * A display heuristic, not a gate. It is a threshold rather than a computation
 * because the useful question is binary — "did the chapter teach this student, or
 * did the retry?" — and the raw numbers travel alongside it on `RepairGap` so a
 * reader who disagrees with the cut can apply their own.
 */
export const REPAIR_GAP_MATERIAL_POINTS = 25;

export interface RepairGap {
  readonly conceptsRepaired: number;
  readonly repairedConceptIds: readonly string[];
  /** Concept mastery rate on the first sitting. Null when attempt 1 is absent. */
  readonly unaidedMasteryPercent: number | null;
  readonly currentMasteryPercent: number;
  /** Positive when current standing exceeds the first sitting. */
  readonly pointsGained: number | null;
  readonly interpretation: RepairInterpretation;
}

export function repairGap(input: {
  readonly firstSitting: FirstSittingMeasure | null;
  readonly current: CurrentStandingMeasure;
}): RepairGap {
  const { firstSitting, current } = input;
  const unaided = firstSitting
    ? percentOf(firstSitting.conceptsMasteredUnaided, current.conceptsRequired)
    : null;
  const pointsGained = unaided === null ? null : current.percent - unaided;

  let interpretation: RepairInterpretation;
  if (firstSitting === null) {
    interpretation = "NO_FIRST_SITTING";
  } else if (current.outstandingConceptIds.length > 0) {
    interpretation = "NOT_YET_RESOLVED";
  } else if ((pointsGained ?? 0) >= REPAIR_GAP_MATERIAL_POINTS) {
    interpretation = "TAUGHT_BY_THE_RETRY";
  } else {
    interpretation = "TAUGHT_BY_THE_CHAPTER";
  }

  return {
    conceptsRepaired: current.repairedConceptIds.length,
    repairedConceptIds: current.repairedConceptIds,
    unaidedMasteryPercent: unaided,
    currentMasteryPercent: current.percent,
    pointsGained,
    interpretation,
  };
}
