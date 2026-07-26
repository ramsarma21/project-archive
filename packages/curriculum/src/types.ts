import type { CurriculumChapterId } from "./chapters.js";
import type { CurriculumMissionId } from "./missionIds.js";
import type { SeCode } from "./seCode.js";

// ============================================================================
// Registry shapes. Three layers, in dependency order:
//
//   student expectation  ->  instructional concept  ->  assessment item
//
// A student expectation is the accountability unit the state publishes. It is
// too coarse to assess directly: 8.4(A) alone names six independent causes of
// the Revolution, and a student can hold four of them and miss two. The
// instructional concept is the unit a module teaches, a duel question asks
// about, and a mastery record is kept for. Items sit beneath concepts and are
// many-to-many, because one stem can evidence more than one concept.
// ============================================================================

// ---------------------------------------------------------------------------
// Student expectations
// ---------------------------------------------------------------------------

export type ReportingCategory = 1 | 2 | 3 | 4;

export const REPORTING_CATEGORY_NAMES: Readonly<
  Record<ReportingCategory, string>
> = {
  1: "History",
  2: "Geography and Culture",
  3: "Government and Citizenship",
  4: "Economics, Science, Technology, and Society",
};

/** STAAR weighting class. Readiness standards carry more of the exam. */
export type StandardType = "READINESS" | "SUPPORTING";

/**
 * ONCE  — event-anchored; one chapter is the sole and definitive teacher.
 * SPIRAL — thematic; a chapter can only introduce it and later chapters
 *          reinforce it, so mastery is assessed across chapters.
 */
export type Recurrence = "ONCE" | "SPIRAL";

/**
 * A_MUST_OWN   — the chapter is the primary carrier; full assessment depth.
 * B_REINFORCE  — the chapter authentically touches it; lighter assessment.
 */
export type ChapterTier = "A_MUST_OWN" | "B_REINFORCE";

/**
 * VERBATIM_CITED     — the words are the standard's own, with a cited source.
 * UNVERIFIED_MISSING — we do not hold the official text. `officialText` is null
 *                      and `workingDescription` is our paraphrase. Never render
 *                      a paraphrase to a teacher as the standard's own wording.
 */
export type TextStatus = "VERBATIM_CITED" | "UNVERIFIED_MISSING";

/**
 * PRIMARY_SOURCE     — read off the published standards/blueprint document.
 * SECONDARY_INTERNAL — taken from an internal design doc that asserted it.
 */
export type DesignationStatus = "PRIMARY_SOURCE" | "SECONDARY_INTERNAL";

export interface SeProvenance {
  /** Adoption year of the standards text, when known. */
  adoption: string | null;
  /** Citation for `officialText`. Null whenever the text is unverified. */
  textSource: string | null;
  /** Citation for reporting category and readiness/supporting status. */
  designationSource: string;
  designationStatus: DesignationStatus;
  /**
   * True only when a human re-read the primary standards document while
   * authoring this entry. False everywhere in the Boston seed: the entries were
   * transcribed from repository sources, not from 19 Tex. Admin. Code.
   */
  independentlyReverified: boolean;
}

/**
 * A named piece inside one student expectation. 8.4(A) enumerates six causes;
 * each is a clause, and each needs its own concept because a student can know
 * the Stamp Act and not know mercantilism.
 */
export interface SeClause {
  clauseId: string;
  text: string;
  textStatus: TextStatus;
}

export interface StudentExpectation {
  /** Primary key. Canonical spelling, enforced by the branded type. */
  code: SeCode;
  /** The standard's own words, or null when we do not hold them. */
  officialText: string | null;
  textStatus: TextStatus;
  /** Our paraphrase. Always present; never a substitute for `officialText`. */
  workingDescription: string;
  reportingCategory: ReportingCategory;
  standardType: StandardType;
  recurrence: Recurrence;
  chapterTier: ChapterTier;
  clauses: SeClause[];
  /** Chapter that introduces and carries this SE. */
  primaryChapter: CurriculumChapterId;
  provenance: SeProvenance;
  /** Repository paths backing this entry. */
  sourceRefs: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Instructional concepts
// ---------------------------------------------------------------------------

/**
 * Canonical concept id: `<CHAPTER_PREFIX>.CONCEPT.<SLUG>.v<N>`.
 *
 * Deliberately no mission segment. The old `BOS.MD01.CONCEPT.*` ids nailed
 * every concept to mission day 1, which is wrong for the spiral standards that
 * recur across four acts and later chapters. Old ids resolve through the alias
 * table instead.
 */
export type CurriculumConceptId = string & {
  readonly __brand: "PA.CurriculumConceptId";
};

export const CONCEPT_ID_PATTERN = /^[A-Z]{3}\.CONCEPT\.[A-Z][A-Z0-9_]*\.v\d+$/;

export function isCurriculumConceptId(
  value: string,
): value is CurriculumConceptId {
  return CONCEPT_ID_PATTERN.test(value);
}

export function asCurriculumConceptId(value: string): CurriculumConceptId {
  if (!isCurriculumConceptId(value)) {
    throw new Error(
      `not a canonical concept id: ${JSON.stringify(value)} ` +
        `(expected e.g. BOS.CONCEPT.STAMP_SCOPE.v1)`,
    );
  }
  return value;
}

/**
 * MACRO — required learning. Taught by a module, asked in a duel, and assessed
 *         to 100% on the chapter capstone.
 * MICRO — enrichment. Reachable through the reactive world, sampled only when
 *         the student actually engaged it, and never a gate.
 */
export type ConceptTier = "MACRO" | "MICRO";

/**
 * DRAFT         — authored here from repository sources; needs SME sign-off.
 * OWNER_PROVIDED — the product owner supplied the content directly.
 * SME_APPROVED  — a curriculum SME has signed off. Nothing in the Boston seed
 *                 holds this status yet.
 */
export type ConceptReviewStatus = "DRAFT" | "OWNER_PROVIDED" | "SME_APPROVED";

/**
 * SOURCE_EXACT   — the parent SE is the one the source document already named.
 * PROPOSED_RETAG — we moved it, because the source's draft tag was a strand
 *                  rather than an SE, or named an SE outside the target set.
 *                  `sourceDraftTags` keeps the original so the move is auditable.
 */
export type ParentSeStatus = "SOURCE_EXACT" | "PROPOSED_RETAG";

export type ConceptSurface =
  | "MISSION_MODULE_AND_DUEL"
  | "ACT1_REACTIVE_WORLD"
  | "CHAPTER_ASSESSMENT"
  | "UNALLOCATED";

export interface ConceptOwner {
  chapterId: CurriculumChapterId;
  /**
   * Owning mission, or null when the chapter owns delivery directly.
   *
   * Branded for the same reason `chapterId` is: a concept seed writing its own
   * mission spelling is how `conceptsForMission` came to answer nothing for the
   * id the runtime actually uses. Seeds are still authored as `M1`; `build()`
   * canonicalises through `asCurriculumMissionId`, which throws on a slug that
   * names no mission.
   */
  missionId: CurriculumMissionId | null;
  surface: ConceptSurface;
}

export interface InstructionalConcept {
  /** Primary key. */
  conceptId: CurriculumConceptId;
  /** Short human label for reports and mastery panels. */
  label: string;
  /**
   * The proposition a student must be able to state. This is the assessable
   * unit: an item is on-concept when it asks for this proposition.
   */
  definition: string;
  parentSe: SeCode;
  /** Clause of the parent SE, when the parent enumerates clauses. */
  parentClauseId: string | null;
  parentSeStatus: ParentSeStatus;
  /** Other SEs this concept legitimately evidences. Never a second parent. */
  secondarySeCodes: SeCode[];
  owner: ConceptOwner;
  tier: ConceptTier;
  recurrence: Recurrence;
  /** On the assessment spine (capstone + duel), as opposed to enrichment only. */
  assessable: boolean;
  codexCardIds: string[];
  reviewStatus: ConceptReviewStatus;
  /** TEKS tags as the source document wrote them, kept for audit. */
  sourceDraftTags: string[];
  sourceRefs: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------

/** Every identifier family observed in the repository. */
export type AliasForm =
  /** `8.4A` — SE with the letter unparenthesized (`ConceptMeta.seIds`). */
  | "SE_BARE_LETTER"
  /** `(4)(A)` — SE with the grade omitted (every design doc). */
  | "SE_GRADE_OMITTED"
  /** `(15)(A/E)` — two SEs in one token. */
  | "SE_MULTI_LETTER"
  /** `8.4(A):POSTWAR_POLICY` — SE qualified by clause (`AssessmentItem.teksTags`). */
  | "SE_CLAUSE_QUALIFIED"
  /** `(4)(A)·Stamp Act` — SE qualified by prose clause (Concept-Delivery-Map). */
  | "SE_DOT_CLAUSE"
  /** `8.12` — a strand, not a student expectation (Micro-Concepts draft tags). */
  | "SE_STRAND_ONLY"
  /** `POSTWAR_POLICY` — bare clause id (`TeksClause.id`, `DAY1_CLAUSE_STATUS`). */
  | "TEKS_CLAUSE_ID"
  /** `BOS.MD01.CONCEPT.POSTWAR_REVENUE.v1` — runtime learner concept. */
  | "LEARNER_CONCEPT_ID"
  /** `RCC.DEBT_POLICY_INTRO` — checkpoint macro concept. */
  | "ASSESSMENT_CONCEPT_RCC"
  /** `RCL.BOSTON_TEA_PARTY` — owner-item concept tag. */
  | "ASSESSMENT_CONCEPT_RCL"
  /** `MICRO.WRITS_OF_ASSISTANCE` — field micro-concept id. */
  | "MICRO_CONCEPT_ID"
  /** `BOSTON_TEA_PARTY` — free-text `AssessmentItem.conceptLineage` entry. */
  | "ITEM_LINEAGE_TAG"
  /** `TEKS.PENDING_SME_REVIEW` — a tag that means "no tag". */
  | "REVIEW_PLACEHOLDER";

export type UnresolvedDisposition =
  /** A real concept, but another chapter owns it. */
  | "OUT_OF_CHAPTER_SCOPE"
  /** In scope, but no concept exists yet because allocation is unsettled. */
  | "AWAITING_CONCEPT_ALLOCATION"
  /** Structurally not a student expectation (a strand, a category). */
  | "NOT_AN_SE_CODE"
  /** Names an experience or event anchor rather than a concept. */
  | "NOT_A_CONCEPT"
  /** A placeholder standing in for a missing tag. */
  | "REVIEW_PLACEHOLDER";

export type AliasTarget =
  | { kind: "CONCEPT"; conceptId: CurriculumConceptId }
  | { kind: "SE"; code: SeCode; clauseId: string | null }
  | { kind: "SE_SET"; codes: SeCode[] }
  | {
      kind: "UNRESOLVED";
      disposition: UnresolvedDisposition;
      detail: string;
      suggestedChapter?: string;
    };

export interface ConceptAlias {
  /** The exact string as it appears in existing code or docs. */
  alias: string;
  form: AliasForm;
  target: AliasTarget;
  /** Where the string is used today, so a retag has a work list. */
  usedBy: string[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemEvidenceWeight = "PRIMARY" | "SECONDARY";

export interface ItemConceptEvidence {
  conceptId: CurriculumConceptId;
  weight: ItemEvidenceWeight;
  /** Why this item evidences this concept, when it is not self-evident. */
  note?: string;
}

export type ItemMappingStatus =
  | "MAPPED"
  | "UNMAPPED_OUT_OF_SCOPE"
  | "UNMAPPED_AWAITING_ALLOCATION";

/**
 * Many-to-many item/concept mapping. One item may evidence several concepts;
 * exactly one of them is PRIMARY, so per-concept mastery has an unambiguous
 * owner for scoring while cross-concept evidence is still recorded.
 */
export interface ItemConceptMapping {
  itemId: string;
  bankId: string;
  status: ItemMappingStatus;
  evidences: ItemConceptEvidence[];
  /** Era as authored on the item, e.g. "1765" or "1764-1767". */
  era: string | null;
  /** The item's original concept and lineage tags, kept for audit. */
  sourceTags: string[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export interface MissionSlot {
  /**
   * Primary key, in the spelling the database and the client use:
   * `PA.SEA01.CH02.BOSTON.MD01`. The slate's `M1`..`M14` labels resolve onto it
   * through `resolveMissionId`; `ordinal` is what those labels were carrying.
   */
  missionId: CurriculumMissionId;
  ordinal: number;
  title: string;
  date: string;
  /** Mission set, 1-4; a rank-up assessment gates each boundary. */
  set: 1 | 2 | 3 | 4;
  assignedSeCodes: SeCode[];
  /** OPEN means the slate has not settled an assignment for this mission. */
  assignmentStatus: "ASSIGNED" | "OPEN";
  notes: string[];
}
