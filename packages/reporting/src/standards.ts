// The TEKS view: concept evidence rolled up onto student expectations.
//
// WHY THIS LAYER EXISTS. A Texas district reports in student expectations —
// 8.4(A), Reporting Category 1, Readiness — and a report that only speaks in
// instructional concepts is one they cannot file. But a student expectation is
// not an assessable unit: 8.4(A) names six independent causes of the Revolution
// and a student can hold four of them. So mastery is kept per concept and rolled
// up here, and the rollup is where the roll-up has to stay honest.
//
// `MET` REQUIRES FULL COVERAGE, NOT JUST FULL MASTERY. This is the item-shortage
// rule at standard level, and it is the single most consequential decision in
// this file. A student who mastered the three concepts under 8.4(A) that we could
// ask, while the other three had no item pool, has not met 8.4(A) — we simply did
// not find out. Reporting that as MET would tell a district the standard was
// covered when a half of it was never asked, and it is precisely the claim a
// district would act on. It reports as INSUFFICIENT_EVIDENCE, with the coverage
// debt named.
//
// The mirror of that rule matters too: partial coverage never becomes NOT_MET
// either. A concept nobody asked is not a concept the student failed.
//
// SECONDARY STANDARDS ARE LISTED, NEVER COUNTED. A concept may legitimately
// evidence other standards; the registry records that. Rolling one concept's
// mastery into three standards would inflate coverage threefold on the surface
// where inflation is least acceptable, so the rollup counts a concept once,
// against its parent, and `alsoEvidences` travels along as supporting context.

import {
  compareStandardCodes,
  type StandardsSource,
} from "./curriculum.js";
import {
  outcomeIsMastered,
  outcomeWasMeasured,
  type ConceptOutcome,
} from "./evidence.js";

/** How much of a standard's concept set produced evidence for this student. */
export type StandardCoverage =
  | "FULLY_MEASURED"
  | "PARTIALLY_MEASURED"
  | "NOT_MEASURED";

/**
 * MET                  — every concept under the standard was asked, and every
 *                        one was mastered. The only value that claims coverage.
 * PARTIALLY_MET        — some measured concepts mastered, some not. A real
 *                        student gap.
 * NOT_MET              — measured, and none mastered.
 * INSUFFICIENT_EVIDENCE— we did not ask enough of the standard to say. Includes
 *                        the case where everything we DID ask was mastered.
 */
export type StandardMasteryVerdict =
  | "MET"
  | "PARTIALLY_MET"
  | "NOT_MET"
  | "INSUFFICIENT_EVIDENCE";

export interface StandardEvidenceRow {
  /** Canonical spelling, `8.4(A)`. */
  readonly seCode: string;
  /** `8.4A`, from the registry's own formatter. */
  readonly seCodeBare: string;
  readonly reportingCategory: number;
  readonly reportingCategoryName: string;
  readonly standardType: "READINESS" | "SUPPORTING";
  readonly description: string;
  /** Whether `description` is the state's words or our paraphrase. */
  readonly descriptionSource: "OFFICIAL_TEXT" | "WORKING_PARAPHRASE";

  readonly conceptsInStandard: number;
  readonly conceptsMeasured: number;
  readonly masteredUnaided: number;
  readonly masteredAfterSupport: number;
  /** Measured and not mastered. The student's work under this standard. */
  readonly notYetMastered: number;
  /** Never asked, item shortage. Our work under this standard. */
  readonly coverageDebt: number;
  readonly notYetSat: number;

  readonly coverage: StandardCoverage;
  readonly mastery: StandardMasteryVerdict;

  readonly conceptIds: readonly string[];
  readonly outstandingConceptIds: readonly string[];
  readonly coverageDebtConceptIds: readonly string[];
}

export interface StandardsRollup {
  readonly rows: readonly StandardEvidenceRow[];
  /**
   * Concepts whose parent standard the registry could not resolve. Reported
   * rather than dropped: a concept silently missing from the standards view is a
   * standard silently missing from the coverage claim.
   */
  readonly unmappedConceptIds: readonly string[];
  readonly standardsMet: number;
  readonly standardsWithCoverageDebt: number;
}

export interface StandardRollupConcept {
  readonly conceptId: string;
  readonly outcome: ConceptOutcome;
}

function verdictFor(input: {
  measured: number;
  mastered: number;
  notYetMastered: number;
  fullyCovered: boolean;
}): StandardMasteryVerdict {
  if (input.measured === 0) return "INSUFFICIENT_EVIDENCE";
  if (input.notYetMastered > 0) {
    return input.mastered > 0 ? "PARTIALLY_MET" : "NOT_MET";
  }
  // Everything asked was mastered. Whether that is MET depends entirely on
  // whether we asked all of it.
  return input.fullyCovered ? "MET" : "INSUFFICIENT_EVIDENCE";
}

export function rollUpToStandards(
  concepts: readonly StandardRollupConcept[],
  standards: StandardsSource,
): StandardsRollup {
  const grouped = new Map<string, StandardRollupConcept[]>();
  const unmappedConceptIds: string[] = [];

  for (const concept of concepts) {
    const descriptor = standards.concept(concept.conceptId);
    const standard = descriptor
      ? standards.standard(descriptor.parentSe)
      : undefined;
    if (!descriptor || !standard) {
      unmappedConceptIds.push(concept.conceptId);
      continue;
    }
    const bucket = grouped.get(standard.seCode) ?? [];
    bucket.push(concept);
    grouped.set(standard.seCode, bucket);
  }

  const rows: StandardEvidenceRow[] = [];
  for (const [seCode, bucket] of grouped) {
    const standard = standards.standard(seCode);
    if (!standard) continue;

    let masteredUnaided = 0;
    let masteredAfterSupport = 0;
    let notYetMastered = 0;
    let coverageDebt = 0;
    let notYetSat = 0;
    const outstandingConceptIds: string[] = [];
    const coverageDebtConceptIds: string[] = [];

    for (const concept of bucket) {
      switch (concept.outcome) {
        case "MASTERED_UNAIDED":
          masteredUnaided += 1;
          break;
        case "MASTERED_AFTER_SUPPORT":
          masteredAfterSupport += 1;
          break;
        case "NOT_YET_MASTERED":
          notYetMastered += 1;
          outstandingConceptIds.push(concept.conceptId);
          break;
        case "NOT_MEASURED_ITEM_SHORTAGE":
          coverageDebt += 1;
          coverageDebtConceptIds.push(concept.conceptId);
          break;
        case "NOT_MEASURED_NOT_SAT":
          notYetSat += 1;
          break;
      }
    }

    const measured = bucket.filter((concept) =>
      outcomeWasMeasured(concept.outcome),
    ).length;
    const mastered = bucket.filter((concept) =>
      outcomeIsMastered(concept.outcome),
    ).length;
    const fullyCovered = measured === bucket.length;
    const coverage: StandardCoverage = fullyCovered
      ? "FULLY_MEASURED"
      : measured === 0
        ? "NOT_MEASURED"
        : "PARTIALLY_MEASURED";

    rows.push({
      seCode: standard.seCode,
      seCodeBare: standard.seCodeBare,
      reportingCategory: standard.reportingCategory,
      reportingCategoryName: standard.reportingCategoryName,
      standardType: standard.standardType,
      description: standard.description,
      descriptionSource: standard.descriptionSource,
      conceptsInStandard: bucket.length,
      conceptsMeasured: measured,
      masteredUnaided,
      masteredAfterSupport,
      notYetMastered,
      coverageDebt,
      notYetSat,
      coverage,
      mastery: verdictFor({ measured, mastered, notYetMastered, fullyCovered }),
      conceptIds: bucket.map((concept) => concept.conceptId),
      outstandingConceptIds,
      coverageDebtConceptIds,
    });
  }

  rows.sort((left, right) => compareStandardCodes(left.seCode, right.seCode));

  return {
    rows,
    unmappedConceptIds,
    standardsMet: rows.filter((row) => row.mastery === "MET").length,
    standardsWithCoverageDebt: rows.filter((row) => row.coverageDebt > 0).length,
  };
}
