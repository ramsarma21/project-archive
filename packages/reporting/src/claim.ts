// What this data honestly supports, attached to the data.
//
// A report that is accurate row by row can still be dishonest as an artifact, and
// the way it happens is omission: a district reads "82%" next to "8.4(A)
// Readiness" and files it as an assessment result, because that is what a number
// next to a state standard means everywhere else they have seen one. Nothing in
// the rows is false. The artifact is still misleading.
//
// So the claim travels with the payload rather than living in a sales deck or a
// footnote somebody can crop. Every student report, every roster and every export
// carries a `ReportClaim`, and its qualifiers are machine-readable so a UI can
// render them as badges rather than as prose nobody reads.
//
// THE CEILING IS STRUCTURAL. `ClaimStrength` has three values and the highest is
// LOCAL_SUMMATIVE_WITH_CAVEATS. There is deliberately no value for "state
// aligned", "predictive of STAAR", or "grade of record", because two properties
// of the design put a permanent ceiling below all three:
//
//   - THE ADMINISTRATION IS UNPROCTORED. A student sits the capstone at home, on
//     their own machine, with the internet open. Nothing here establishes that
//     the answers are the student's own work, and no amount of item quality fixes
//     that.
//   - RETRIES ARE UNLIMITED BY DESIGN. `ASSESSMENT_ATTEMPTS_ARE_UNLIMITED` is a
//     deliberate and correct decision about a learning gate — a student who runs
//     out of chances is a student the product has given up on — but a bar you may
//     re-attempt forever is not a bar that measures a population.
//
// Both are right for a learning product and both are disqualifying for
// accountability. The honest response is to say so in the payload, not to add a
// stronger enum value later when a district asks for one.

import type { ProvenanceRollup } from "./assessment.js";
import type { DisclosureGap, EvidenceFidelity } from "./source.js";

export type ClaimQualifier =
  /** Not a state assessment and not aligned to one. Always present. */
  | "NOT_A_STATE_ASSESSMENT"
  /** Sat without supervision. Authorship of the answers is not established. */
  | "UNPROCTORED_ADMINISTRATION"
  /** The capstone may be re-attempted without limit, by design. */
  | "UNLIMITED_RETRIES"
  /** Game performance is deliberately absent. It measures dexterity, not learning. */
  | "MISSION_PERFORMANCE_EXCLUDED"
  /** No first sitting has been submitted, so there is no academic measure at all. */
  | "NO_FIRST_SITTING"
  /** Some chapter concepts had too few items to ask. The score is over a subset. */
  | "PARTIAL_CHAPTER_COVERAGE"
  /** Nothing on the reported form was published by TEA. */
  | "NO_RELEASED_TEA_ITEMS"
  /** Most of the reported form was authored in-house in the STAAR idiom. */
  | "MOSTLY_AUTHORED_ITEMS"
  /** Mastery was demonstrated on at least one repeated item. Weaker evidence. */
  | "MASTERY_ON_RECYCLED_ITEMS"
  /** At least one verdict is flagged for a human to check. */
  | "ITEMS_AWAITING_GRADING_REVIEW"
  /** A human review changed the first-sitting number after it was submitted. */
  | "SCORE_REVISED_BY_REVIEW"
  /** The standards text we hold is our paraphrase, not the state's wording. */
  | "STANDARDS_TEXT_UNVERIFIED"
  /** No curriculum SME has signed off the concept-to-standard mapping. */
  | "CONCEPT_MAPPING_NOT_SME_APPROVED"
  /** Rebuilt from projections; some disclosures could not be recovered. */
  | "DISCLOSURES_INCOMPLETE"
  /** Aggregates over fewer students than the suppression floor were withheld. */
  | "SMALL_COHORT_SUPPRESSED";

/**
 * NONE                        — nothing has been submitted. No claim of any kind.
 * INSTRUCTIONAL_ONLY          — good enough to decide who to reteach and on what.
 *                               Not a record of achievement.
 * LOCAL_SUMMATIVE_WITH_CAVEATS— a defensible local record that a student
 *                               demonstrated each concept at 100% under our
 *                               conditions. Still not a grade, still not a state
 *                               measure, still unproctored.
 *
 * There is no fourth value, and adding one is a design conversation rather than a
 * one-line enum change.
 */
export type ClaimStrength =
  | "NONE"
  | "INSTRUCTIONAL_ONLY"
  | "LOCAL_SUMMATIVE_WITH_CAVEATS";

export interface ReportClaim {
  readonly strength: ClaimStrength;
  readonly qualifiers: readonly ClaimQualifier[];
  /** Plain sentences a teacher or an administrator can read without training. */
  readonly supports: readonly string[];
  readonly doesNotSupport: readonly string[];
}

/** Always true of this artifact, whatever the data says. */
const UNIVERSAL_QUALIFIERS: readonly ClaimQualifier[] = [
  "NOT_A_STATE_ASSESSMENT",
  "UNPROCTORED_ADMINISTRATION",
  "UNLIMITED_RETRIES",
  "MISSION_PERFORMANCE_EXCLUDED",
];

/** Below this share of released TEA items, the form is mostly ours. */
const RELEASED_ITEM_MAJORITY = 0.5;

export interface ClaimInput {
  readonly hasFirstSitting: boolean;
  readonly coverageDebt: number;
  readonly masteryOnRecycledItems: boolean;
  readonly itemsAwaitingGradingReview: number;
  readonly scoreRevisedByReview: boolean;
  readonly reportedFormProvenance: ProvenanceRollup | null;
  readonly fidelity: EvidenceFidelity;
  readonly disclosureGaps: readonly DisclosureGap[];
  /** True when any standard on the report is described by our paraphrase. */
  readonly standardsTextUnverified: boolean;
  /** True when any concept's registry mapping is short of SME sign-off. */
  readonly conceptMappingUnreviewed: boolean;
  readonly smallCohortSuppressed?: boolean;
}

export function buildReportClaim(input: ClaimInput): ReportClaim {
  const qualifiers: ClaimQualifier[] = [...UNIVERSAL_QUALIFIERS];

  if (!input.hasFirstSitting) qualifiers.push("NO_FIRST_SITTING");
  if (input.coverageDebt > 0) qualifiers.push("PARTIAL_CHAPTER_COVERAGE");
  if (input.masteryOnRecycledItems) qualifiers.push("MASTERY_ON_RECYCLED_ITEMS");
  if (input.itemsAwaitingGradingReview > 0) {
    qualifiers.push("ITEMS_AWAITING_GRADING_REVIEW");
  }
  if (input.scoreRevisedByReview) qualifiers.push("SCORE_REVISED_BY_REVIEW");

  const provenance = input.reportedFormProvenance;
  const releasedShare =
    provenance && provenance.total > 0
      ? provenance.releasedTea / provenance.total
      : 0;
  if (provenance) {
    if (provenance.releasedTea === 0) qualifiers.push("NO_RELEASED_TEA_ITEMS");
    else if (releasedShare < RELEASED_ITEM_MAJORITY) {
      qualifiers.push("MOSTLY_AUTHORED_ITEMS");
    }
  }
  if (input.standardsTextUnverified) qualifiers.push("STANDARDS_TEXT_UNVERIFIED");
  if (input.conceptMappingUnreviewed) {
    qualifiers.push("CONCEPT_MAPPING_NOT_SME_APPROVED");
  }
  if (input.fidelity !== "EXACT_FROM_LOG" || input.disclosureGaps.length > 0) {
    qualifiers.push("DISCLOSURES_INCOMPLETE");
  }
  if (input.smallCohortSuppressed) qualifiers.push("SMALL_COHORT_SUPPRESSED");

  return {
    strength: strengthFor(input, provenance),
    qualifiers,
    supports: supportsFor(input),
    doesNotSupport: DOES_NOT_SUPPORT,
  };
}

function strengthFor(
  input: ClaimInput,
  provenance: ProvenanceRollup | null,
): ClaimStrength {
  if (!input.hasFirstSitting) return "NONE";
  const wholeChapter = input.coverageDebt === 0;
  const exact =
    input.fidelity === "EXACT_FROM_LOG" && input.disclosureGaps.length === 0;
  const anchored = provenance !== null && provenance.releasedTea > 0;
  const settled = input.itemsAwaitingGradingReview === 0;
  return wholeChapter && exact && anchored && settled
    ? "LOCAL_SUMMATIVE_WITH_CAVEATS"
    : "INSTRUCTIONAL_ONLY";
}

function supportsFor(input: ClaimInput): readonly string[] {
  if (!input.hasFirstSitting) {
    return [
      "Nothing yet. This student has not submitted a first sitting, so the " +
        "report carries no academic measure — only what remains to be done.",
    ];
  }
  const supports = [
    "Deciding what to reteach and to whom: every row names a specific concept " +
      "the student was asked about and either did or did not demonstrate.",
    "An auditable record that this student demonstrated each mastered concept " +
      "at 100% of the items served, with no partial credit.",
    "Separating what the student knew unaided on the first sitting from what " +
      "they can demonstrate now, after retries.",
  ];
  if (input.coverageDebt > 0) {
    supports.push(
      `Identifying our own content debt: ${input.coverageDebt} concept(s) could ` +
        "not be asked at all, and they are named rather than scored as failures.",
    );
  }
  return supports;
}

const STRENGTH_ORDER: Readonly<Record<ClaimStrength, number>> = {
  NONE: 0,
  INSTRUCTIONAL_ONLY: 1,
  LOCAL_SUMMATIVE_WITH_CAVEATS: 2,
};

/**
 * The claim over a set of students.
 *
 * Qualifiers union: a caveat that applies to one student on the page applies to
 * the page, because a reader scanning thirty rows will not check which row it
 * came from.
 *
 * Strength is the WEAKEST among the students who have one, and NONE only when
 * nobody does. A roster where twenty-nine students sat and one did not still
 * supports what those twenty-nine demonstrated; collapsing the page to NONE
 * because of the thirtieth would be a caveat so blunt it stops being read. That
 * one student is visible anyway — as `NO_FIRST_SITTING` here, as NOT_STARTED at
 * the top of the triage order, and in the summary counts.
 */
export function mergeClaims(claims: readonly ReportClaim[]): ReportClaim {
  const qualifiers = new Set<ClaimQualifier>(UNIVERSAL_QUALIFIERS);
  for (const claim of claims) {
    for (const qualifier of claim.qualifiers) qualifiers.add(qualifier);
  }
  const scored = claims
    .map((claim) => claim.strength)
    .filter((strength) => strength !== "NONE");
  const strength = scored.reduce<ClaimStrength>(
    (weakest, candidate) =>
      STRENGTH_ORDER[candidate] < STRENGTH_ORDER[weakest] ? candidate : weakest,
    scored[0] ?? "NONE",
  );
  return {
    strength,
    qualifiers: [...qualifiers],
    supports:
      strength === "NONE"
        ? [
            "Nothing yet. No student on this page has submitted a first sitting.",
          ]
        : [
            "Deciding what to reteach and to whom, per concept and per student.",
            "Seeing which concepts the class as a whole has not demonstrated, " +
              "which is one reteach rather than one intervention per student.",
            "An auditable per-concept record of what each student demonstrated " +
              "at 100%, kept separately from what they knew unaided.",
          ],
    doesNotSupport: DOES_NOT_SUPPORT,
  };
}

/**
 * Fixed rather than derived, because these are properties of the design and not
 * of any particular student's data. A caveat that appears only when the data
 * happens to be thin is a caveat that disappears the moment the data looks good.
 */
const DOES_NOT_SUPPORT: readonly string[] = [
  "A STAAR score, a STAAR prediction, or any comparison with state results.",
  "A grade of record. The administration is unproctored and retries are " +
    "unlimited by design, so nothing here establishes that the work is the " +
    "student's own or that the bar was cleared under comparable conditions.",
  "Comparing one student, class, or campus with another. The form a student " +
    "sees is drawn per attempt and a retry narrows to what they missed, so two " +
    "students did not sit the same test.",
  "A growth or gain measure. There is one first sitting and no pre-test.",
  "Any claim about a concept nobody asked. A concept with too few items reports " +
    "as unmeasured and is never scored as a failure.",
  "Any claim about game performance. Mission outcomes measure dexterity and are " +
    "deliberately absent from this report.",
];
