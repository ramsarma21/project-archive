import { bostonConceptId, ALL_CONCEPTS } from "./conceptRegistry.js";
import {
  asSeCode,
  formatBareLetter,
  formatClauseQualified,
  formatGradeOmitted,
  type SeCode,
} from "./seCode.js";
import { ALL_STUDENT_EXPECTATIONS } from "./seRegistry.js";
import type { ConceptAlias, CurriculumConceptId } from "./types.js";

// ============================================================================
// Alias table: every curriculum identifier this repository has ever produced,
// mapped to what it actually means.
//
// The point is retagging, not rewriting. Sixteen authored assessment items, the
// three runtime learner concepts, fourteen micro ids, and every design doc use
// mutually incompatible identifiers. Retagging authored content through this
// table is cheap. Reauthoring it is not, and reauthoring owner-supplied items
// would also destroy their provenance.
//
// Two kinds of entry:
//
//   MECHANICAL — generated from the SE and concept registries by a documented
//   rule (grade-omitted `(4)(A)`, bare-letter `8.4A`, clause-qualified
//   `8.4(A):STAMP_ACT`, bare clause `STAMP_ACT`, `MICRO.*`). Generating these
//   makes it impossible for the alias table to drift away from the registry when
//   a standard or concept is added.
//
//   HAND-AUTHORED — everything irregular: the RCC/RCL assessment vocabularies,
//   the runtime learner ids, the prose-clause doc forms, strand-only tags, and
//   free-text item lineage tags.
//
// An alias may also resolve to nothing. `UNRESOLVED` is a first-class outcome
// with a stated disposition, so "identifier we have never seen" and "identifier
// we know about and deliberately do not map" are different answers.
// ============================================================================

const IDS = "packages/chapter-boston/src/ids.ts";
const TEKS = "packages/chapter-boston/src/teks.ts";
const FIELD_IDS = "packages/chapter-boston/src/fieldIds.ts";
const CP1_IDS = "packages/chapter-boston/src/checkpoints/cp1Ids.ts";
const CP1_BANK = "packages/chapter-boston/src/checkpoints/cp1Bank.ts";
const MICRO_DOC = "docs/chapters/boston-1765/Micro-Concepts.md";
const DELIVERY_DOC = "docs/chapters/boston-1765/Concept-Delivery-Map.md";
const COVERAGE_DOC = "docs/chapters/boston-1765/STAAR-Coverage-Map.md";
const SLATE_DOC = "docs/chapters/boston-1765/Mission-Slate.md";
const DESIGN_DOCS = "docs/design/*.md";

function concept(slug: string): {
  kind: "CONCEPT";
  conceptId: CurriculumConceptId;
} {
  return { kind: "CONCEPT", conceptId: bostonConceptId(slug) };
}

function outOfScope(
  detail: string,
  suggestedChapter: string,
): ConceptAlias["target"] {
  return {
    kind: "UNRESOLVED",
    disposition: "OUT_OF_CHAPTER_SCOPE",
    detail,
    suggestedChapter,
  };
}

// ---------------------------------------------------------------------------
// Hand-authored aliases
// ---------------------------------------------------------------------------

const HAND_AUTHORED: ConceptAlias[] = [
  // -- Runtime learner concept ids. The mission-day segment is exactly the
  // -- problem: a spiral concept cannot belong to mission day 1.
  {
    alias: "BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1",
    form: "LEARNER_CONCEPT_ID",
    target: concept("POSTWAR_REVENUE"),
    usedBy: [IDS, TEKS, CP1_IDS, SLATE_DOC],
  },
  {
    alias: "BOS.MD01.CONCEPT.STAMP_SCOPE.v1",
    form: "LEARNER_CONCEPT_ID",
    target: concept("STAMP_SCOPE"),
    usedBy: [IDS, TEKS, CP1_IDS, SLATE_DOC],
  },
  {
    alias: "BOS.MD01.CONCEPT.REPRESENTATION.v1",
    form: "LEARNER_CONCEPT_ID",
    target: concept("REPRESENTATION"),
    usedBy: [IDS, TEKS, CP1_IDS, SLATE_DOC],
  },

  // -- Checkpoint macro vocabulary.
  {
    alias: "RCC.DEBT_POLICY_INTRO",
    form: "ASSESSMENT_CONCEPT_RCC",
    target: concept("POSTWAR_REVENUE"),
    usedBy: [CP1_IDS, CP1_BANK, MICRO_DOC, SLATE_DOC],
  },
  {
    alias: "RCC.STAMP_INTERNAL_INTRO",
    form: "ASSESSMENT_CONCEPT_RCC",
    target: concept("STAMP_SCOPE"),
    usedBy: [CP1_IDS, CP1_BANK, MICRO_DOC, SLATE_DOC],
  },
  {
    alias: "RCC.REPRESENTATION_CAUSE",
    form: "ASSESSMENT_CONCEPT_RCC",
    target: concept("REPRESENTATION"),
    usedBy: [CP1_IDS, CP1_BANK, MICRO_DOC, SLATE_DOC],
  },
  {
    alias: "RCC.ORGANIZED_RESISTANCE_EVENT",
    form: "ASSESSMENT_CONCEPT_RCC",
    target: {
      kind: "UNRESOLVED",
      disposition: "NOT_A_CONCEPT",
      detail:
        "Micro-Concepts.md lists this beside the three macros as a required " +
        "experience rather than a proposition. It names an event the student " +
        "must witness, so it belongs to mission or exposure tracking, not to a " +
        "concept registry with mastery semantics.",
    },
    usedBy: [MICRO_DOC],
  },

  // -- Owner-item concept vocabulary. Half of these are other chapters'.
  {
    alias: "RCL.INTOLERABLE_ACTS_RESPONSE",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: concept("INTOLERABLE_ACTS"),
    usedBy: [CP1_BANK],
  },
  {
    alias: "RCL.QUARTERING_THIRD_AMENDMENT",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: concept("GRIEVANCE_TO_RIGHT"),
    usedBy: [CP1_BANK],
    note:
      "The grievance half is Boston's; the Third Amendment half is not. The item " +
      "carrying this tag is dated 1789-1791 and therefore falls outside Boston's " +
      "era window even though the concept is in scope.",
  },
  {
    alias: "RCL.DECLARATION_NATURAL_RIGHTS",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: outOfScope(
      "The Declaration was drafted and adopted in Philadelphia in July 1776; " +
        "the coverage map moves that content out of Boston explicitly.",
      "PHILADELPHIA",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "RCL.NATURAL_RIGHTS_REPRESENTATION",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: concept("NATURAL_RIGHTS_GROUND"),
    usedBy: [CP1_BANK],
  },
  {
    alias: "RCL.VALLEY_FORGE_WINTER",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: outOfScope(
      "Valley Forge is winter 1777-78, two years past Boston's 1775 close, and " +
        "concerns the Continental Army's supply rather than the revolution's causes.",
      "WAR_CHAPTER",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "RCL.CIVIL_MILITARY_SUPREMACY",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: outOfScope(
      "Civil control of the military is a constitutional-design question answered " +
        "in 1787, which is the half of the grievance standard Boston does not own.",
      "PHILADELPHIA",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "RCL.CONTINENTAL_NAVY",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: outOfScope(
      "The naval war runs 1776-1783, entirely after Boston's window closes.",
      "WAR_CHAPTER",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "RCL.UNALIENABLE_RIGHTS",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: concept("NATURAL_RIGHTS_GROUND"),
    usedBy: [CP1_BANK],
    note:
      "The concept is a Boston Tier B standard, but the item carrying this tag " +
      "frames it through the 1776 Declaration, which is outside Boston's window. " +
      "Retag the concept and rescope or reauthor the item's stem.",
  },
  {
    alias: "RCL.FIRST_CONTINENTAL_CONGRESS_GRIEVANCES",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: concept("INTOLERABLE_ACTS"),
    usedBy: [CP1_BANK],
  },
  {
    alias: "RCL.TRIAL_BY_JURY_SIXTH_AMENDMENT",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: concept("GRIEVANCE_TO_RIGHT"),
    usedBy: [CP1_BANK],
    note:
      "Same split as the quartering tag: Boston owns the grievance, a later " +
      "chapter owns the amendment.",
  },
  {
    alias: "RCL.YORKTOWN_TREATY_OF_PARIS",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: outOfScope(
      "The surrender at Yorktown and the peace that followed are 1781-1783, " +
        "well past Boston's window, and belong to the war's conclusion.",
      "WAR_CHAPTER",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "RCL.FOUNDER_JOHN_ADAMS",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: concept("CIVIC_VIRTUE_UNPOPULAR_DEFENSE"),
    usedBy: [CP1_BANK],
    note:
      "The item spans 1770-1797. Only the Massacre-defense strand is Boston's; " +
      "the presidency and the Treaty of Paris are not.",
  },
  {
    alias: "RCL.BOSTON_TEA_PARTY",
    form: "ASSESSMENT_CONCEPT_RCL",
    target: concept("DISCIPLINED_CIVIL_DISOBEDIENCE"),
    usedBy: [CP1_BANK],
    note:
      "CONTRADICTION in the existing bank: the item carrying this concept is " +
      "tagged 8.4(A):NO_REPRESENTATION, but the coverage map assigns the Boston " +
      "Tea Party to 8.20(B) civil disobedience and names Boston its definitive " +
      "carrier. The TEKS tag on that item is wrong, not the concept.",
  },

  // -- Prose-clause doc form. Normalizing the prose does not always land on the
  // -- clause id, so these are mapped explicitly.
  {
    alias: "(4)(A)\u00b7Stamp Act",
    form: "SE_DOT_CLAUSE",
    target: concept("STAMP_SCOPE"),
    usedBy: [DELIVERY_DOC],
  },
  {
    alias: "(4)(A)\u00b7no representation",
    form: "SE_DOT_CLAUSE",
    target: concept("REPRESENTATION"),
    usedBy: [DELIVERY_DOC],
  },
  {
    alias: "(4)(A)\u00b7postwar revenue",
    form: "SE_DOT_CLAUSE",
    target: concept("POSTWAR_REVENUE"),
    usedBy: [DELIVERY_DOC],
    note:
      "The prose says 'postwar revenue' while the clause id is POSTWAR_POLICY " +
      "and the runtime concept slug is POSTWAR_REVENUE. Three names, one thing.",
  },
  {
    alias: "(4)(A)\u00b7Proclamation 1763",
    form: "SE_DOT_CLAUSE",
    target: concept("PROCLAMATION_1763"),
    usedBy: [DELIVERY_DOC],
  },
  {
    alias: "(4)(A)\u00b7Intolerable/Coercive Acts",
    form: "SE_DOT_CLAUSE",
    target: concept("INTOLERABLE_ACTS"),
    usedBy: [DELIVERY_DOC],
  },
  {
    alias: "(4)(A)\u00b7mercantilism",
    form: "SE_DOT_CLAUSE",
    target: concept("MERCANTILISM"),
    usedBy: [DELIVERY_DOC],
  },

  // -- Two standards written as one token.
  {
    alias: "(15)(A/E)",
    form: "SE_MULTI_LETTER",
    target: { kind: "SE_SET", codes: [asSeCode("8.15(A)"), asSeCode("8.15(E)")] },
    usedBy: [DELIVERY_DOC],
  },
  {
    alias: "(12)(A/C)",
    form: "SE_MULTI_LETTER",
    target: { kind: "SE_SET", codes: [asSeCode("8.12(A)"), asSeCode("8.12(C)")] },
    usedBy: [DELIVERY_DOC],
  },

  // -- Strand-only tags. These look like SE codes and are not. Every one comes
  // -- from Micro-Concepts.md's self-declared draft TEKS tags.
  {
    alias: "8.12",
    form: "SE_STRAND_ONLY",
    target: {
      kind: "UNRESOLVED",
      disposition: "NOT_AN_SE_CODE",
      detail:
        "Strand 8.12 has assessed expectations (A), (B), and (C) with different " +
        "content; the bare strand does not identify one. Boston's in-scope " +
        "members are 8.12(A) and 8.12(C).",
    },
    usedBy: [MICRO_DOC],
  },
  {
    alias: "8.13",
    form: "SE_STRAND_ONLY",
    target: {
      kind: "UNRESOLVED",
      disposition: "NOT_AN_SE_CODE",
      detail:
        "Strand 8.13 is the Industrial Revolution and the War of 1812, which the " +
        "coverage map places outside Boston's era entirely. Tagging a 1765 micro " +
        "to it is a defect, not a normalization problem.",
    },
    usedBy: [MICRO_DOC],
  },
  {
    alias: "8.15",
    form: "SE_STRAND_ONLY",
    target: {
      kind: "UNRESOLVED",
      disposition: "NOT_AN_SE_CODE",
      detail:
        "Strand 8.15 covers historic documents, colonial grievances, and " +
        "political philosophers. Micro-Concepts.md describes it as 'symbols/" +
        "citizenship', which matches none of its expectations.",
    },
    usedBy: [MICRO_DOC],
  },
  {
    alias: "8.19",
    form: "SE_STRAND_ONLY",
    target: {
      kind: "UNRESOLVED",
      disposition: "NOT_AN_SE_CODE",
      detail:
        "Strand 8.19 covers natural rights, enumerated rights, and citizen " +
        "responsibilities. Boston's in-scope members are 8.19(A) and 8.19(C).",
    },
    usedBy: [MICRO_DOC],
  },
  {
    alias: "8.29",
    form: "SE_STRAND_ONLY",
    target: {
      kind: "UNRESOLVED",
      disposition: "NOT_AN_SE_CODE",
      detail:
        "Strand 8.29 is a social-studies-skills strand and appears nowhere in " +
        "the 85 assessed expectations the coverage map enumerates. Four micros " +
        "carry it as a draft tag; none can be assessed against it.",
    },
    usedBy: [MICRO_DOC],
  },

  // -- A tag that means "no tag".
  {
    alias: "TEKS.PENDING_SME_REVIEW",
    form: "REVIEW_PLACEHOLDER",
    target: {
      kind: "UNRESOLVED",
      disposition: "REVIEW_PLACEHOLDER",
      detail:
        "Eight of the sixteen owner items carry this in place of a TEKS tag. It " +
        "is honest, but it is not a code, and nothing downstream may treat it as " +
        "one.",
    },
    usedBy: [CP1_BANK],
  },

  // -- Free-text lineage tags on authored items.
  {
    alias: "FIRST_CONTINENTAL_CONGRESS",
    form: "ITEM_LINEAGE_TAG",
    target: concept("INTOLERABLE_ACTS"),
    usedBy: [CP1_BANK],
    note: "The Congress is the colonial response the Coercive Acts produced.",
  },
  {
    alias: "QUARTERING",
    form: "ITEM_LINEAGE_TAG",
    target: concept("GRIEVANCE_TO_RIGHT"),
    usedBy: [CP1_BANK],
  },
  {
    alias: "DECLARATION_GRIEVANCES",
    form: "ITEM_LINEAGE_TAG",
    target: concept("GRIEVANCE_TO_RIGHT"),
    usedBy: [CP1_BANK],
  },
  {
    alias: "NATURAL_RIGHTS",
    form: "ITEM_LINEAGE_TAG",
    target: concept("NATURAL_RIGHTS_GROUND"),
    usedBy: [CP1_BANK],
  },
  {
    alias: "JOHN_ADAMS",
    form: "ITEM_LINEAGE_TAG",
    target: concept("CIVIC_VIRTUE_UNPOPULAR_DEFENSE"),
    usedBy: [CP1_BANK],
  },
  {
    alias: "BOSTON_MASSACRE",
    form: "ITEM_LINEAGE_TAG",
    target: concept("CROWD_COMPOSITION_NOT_MOB"),
    usedBy: [CP1_BANK],
    note:
      "Boston owns the Massacre, but the assessed concept beneath it is the " +
      "crowd's composition rather than the event as a fact.",
  },
  {
    alias: "BOSTON_TEA_PARTY",
    form: "ITEM_LINEAGE_TAG",
    target: concept("DISCIPLINED_CIVIL_DISOBEDIENCE"),
    usedBy: [CP1_BANK],
  },
  {
    alias: "BILL_OF_RIGHTS",
    form: "ITEM_LINEAGE_TAG",
    target: outOfScope(
      "Boston teaches the grievances that became amendments; the enumerated Bill " +
        "of Rights is 1791 and belongs to a later chapter.",
      "PHILADELPHIA",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "DECLARATION_OF_INDEPENDENCE",
    form: "ITEM_LINEAGE_TAG",
    target: outOfScope(
      "Drafted and adopted in Philadelphia in July 1776, a year after Boston's " +
        "chapter ends. Boston may foreshadow it and may not assess it.",
      "PHILADELPHIA",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "US_CONSTITUTION",
    form: "ITEM_LINEAGE_TAG",
    target: outOfScope(
      "Written in Philadelphia in 1787; the constitutional remedy to Boston's " +
        "grievances is a later chapter's content.",
      "PHILADELPHIA",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "VALLEY_FORGE",
    form: "ITEM_LINEAGE_TAG",
    target: outOfScope(
      "Winter 1777-78, after Boston's window, and about army supply rather than " +
        "the revolution's causes.",
      "WAR_CHAPTER",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "CONTINENTAL_ARMY",
    form: "ITEM_LINEAGE_TAG",
    target: outOfScope(
      "The army's campaigns run past Boston's window; only its formation " +
        "outside the besieged town is Boston's.",
      "WAR_CHAPTER",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "REVOLUTIONARY_WAR",
    form: "ITEM_LINEAGE_TAG",
    target: outOfScope(
      "The war as a whole spans several chapters; Boston owns only its opening " +
        "at Lexington, Concord, and the siege.",
      "WAR_CHAPTER",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "JOHN_PAUL_JONES",
    form: "ITEM_LINEAGE_TAG",
    target: outOfScope(
      "Took naval command in 1776 and never appears in Boston's window or in any " +
        "of its 23 target standards.",
      "WAR_CHAPTER",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "YORKTOWN",
    form: "ITEM_LINEAGE_TAG",
    target: outOfScope(
      "The 1781 surrender is six years past Boston's close and belongs to the " +
        "war's conclusion.",
      "WAR_CHAPTER",
    ),
    usedBy: [CP1_BANK],
  },
  {
    alias: "TREATY_OF_PARIS",
    form: "ITEM_LINEAGE_TAG",
    target: outOfScope(
      "The 1783 peace ends the war Boston's chapter only begins.",
      "WAR_CHAPTER",
    ),
    usedBy: [CP1_BANK],
  },
];

// ---------------------------------------------------------------------------
// Mechanical alias families, generated from the registries.
// ---------------------------------------------------------------------------

function generateSeFormAliases(): ConceptAlias[] {
  const out: ConceptAlias[] = [];
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    out.push({
      alias: formatGradeOmitted(se.code),
      form: "SE_GRADE_OMITTED",
      target: { kind: "SE", code: se.code, clauseId: null },
      usedBy: [COVERAGE_DOC, DELIVERY_DOC, DESIGN_DOCS],
    });
    out.push({
      alias: formatBareLetter(se.code),
      form: "SE_BARE_LETTER",
      target: { kind: "SE", code: se.code, clauseId: null },
      usedBy: [`${TEKS} (ConceptMeta.seIds)`],
    });
  }
  return out;
}

function generateClauseAliases(): ConceptAlias[] {
  const out: ConceptAlias[] = [];
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    for (const clause of se.clauses) {
      out.push({
        alias: formatClauseQualified(se.code, clause.clauseId),
        form: "SE_CLAUSE_QUALIFIED",
        target: { kind: "SE", code: se.code, clauseId: clause.clauseId },
        usedBy: [`${CP1_BANK} (AssessmentItem.teksTags)`],
      });
      out.push({
        alias: clause.clauseId,
        form: "TEKS_CLAUSE_ID",
        target: { kind: "SE", code: se.code, clauseId: clause.clauseId },
        usedBy: [`${TEKS} (TeksClause.id, DAY1_CLAUSE_STATUS)`],
      });
    }
  }
  return out;
}

function generateMicroAliases(): ConceptAlias[] {
  return ALL_CONCEPTS.filter((c) => c.tier === "MICRO").map((c) => {
    const slug = c.conceptId.split(".")[2]!;
    return {
      alias: `MICRO.${slug}`,
      form: "MICRO_CONCEPT_ID",
      target: { kind: "CONCEPT", conceptId: c.conceptId },
      usedBy: [FIELD_IDS, CP1_BANK, MICRO_DOC],
    } satisfies ConceptAlias;
  });
}

export const ALIASES: readonly ConceptAlias[] = [
  ...HAND_AUTHORED,
  ...generateSeFormAliases(),
  ...generateClauseAliases(),
  ...generateMicroAliases(),
];

/** Exact-string index. Duplicates are reported by the validator, not silently won. */
export const ALIAS_INDEX: ReadonlyMap<string, ConceptAlias> = new Map(
  ALIASES.map((entry) => [entry.alias, entry]),
);

export function lookupAlias(raw: string): ConceptAlias | undefined {
  return ALIAS_INDEX.get(raw) ?? ALIAS_INDEX.get(raw.trim());
}

/** Aliases grouped by the concept they point at, for retagging work lists. */
export function aliasesForConcept(
  conceptId: CurriculumConceptId,
): ConceptAlias[] {
  return ALIASES.filter(
    (a) => a.target.kind === "CONCEPT" && a.target.conceptId === conceptId,
  );
}

/** Aliases that point at an SE rather than a concept. */
export function aliasesForSe(code: SeCode): ConceptAlias[] {
  return ALIASES.filter(
    (a) =>
      (a.target.kind === "SE" && a.target.code === code) ||
      (a.target.kind === "SE_SET" && a.target.codes.includes(code)),
  );
}

/** Known-but-deliberately-unmapped identifiers, with their reasons. */
export function unresolvedAliases(): ConceptAlias[] {
  return ALIASES.filter((a) => a.target.kind === "UNRESOLVED");
}
