import type { SeCode } from "./seCode.js";
import { asSeCode } from "./seCode.js";

// ============================================================================
// Defects found in the source documents while seeding the registry.
//
// These are recorded as data rather than as prose in a handoff note, because a
// handoff note is read once and a registry is read every build. Each entry names
// the document, what it says, what contradicts it, and who has to decide.
//
// Nothing here is resolved unilaterally. Where a source document declined to
// invent an answer, this registry declines too.
// ============================================================================

export type DefectKind =
  /** Two sources assert incompatible things. */
  | "CONTRADICTION"
  /** A tag or reference that cannot resolve to anything real. */
  | "INVALID_REFERENCE"
  /** A required assignment that no document makes. */
  | "MISSING_ASSIGNMENT"
  /** Content taught in one place and graded in another, or vice versa. */
  | "TEACH_ASSESS_MISMATCH";

export type DefectOwner =
  | "CURRICULUM_SME"
  | "PRODUCT_OWNER"
  | "CONTENT_AUTHOR"
  | "ENGINEERING";

export interface SourceDefect {
  id: string;
  kind: DefectKind;
  /** Documents or files the defect lives in. */
  sources: string[];
  /** Standards the defect touches, when it touches any. */
  seCodes: SeCode[];
  summary: string;
  /** What the registry did about it, and why that is not a resolution. */
  registryDisposition: string;
  owner: DefectOwner;
}

const SLATE = "docs/chapters/boston-1765/Mission-Slate.md";
const COVERAGE = "docs/chapters/boston-1765/STAAR-Coverage-Map.md";
const MICRO = "docs/chapters/boston-1765/Micro-Concepts.md";
const DELIVERY = "docs/chapters/boston-1765/Concept-Delivery-Map.md";
const TEKS = "packages/chapter-boston/src/teks.ts";
const BANK = "packages/chapter-boston/src/checkpoints/cp1Bank.ts";

export const SOURCE_DEFECTS: readonly SourceDefect[] = [
  {
    id: "SLATE_2_1_EXAMPLE_CODES",
    kind: "CONTRADICTION",
    sources: [`${SLATE} section 2.1`, `${SLATE} section 3 table`],
    seCodes: [asSeCode("8.21(A)"), asSeCode("8.15(A)"), asSeCode("8.21(B)"), asSeCode("8.15(E)")],
    summary:
      "Section 2.1 names 8.21(A), 8.15(A), and 8.11(A) as examples of the " +
      "vocabulary the slate is written in. The mission table assigns 8.21(B) to " +
      "M5 and 8.15(E) to M4 and assigns neither 8.21(A) nor 8.15(A) to anything. " +
      "Only 8.11(A) actually appears in the table, on M2.",
    registryDisposition:
      "All four codes are registered, because all four are genuine Boston target " +
      "standards. The two that no mission claims are reported by the " +
      "SE_NOT_ASSIGNED_TO_ANY_MISSION check rather than quietly assigned to the " +
      "mission whose letter is adjacent.",
    owner: "PRODUCT_OWNER",
  },
  {
    id: "M3_CONCEPT_ALLOCATION_OPEN",
    kind: "MISSING_ASSIGNMENT",
    sources: [`${SLATE} section 3 table`, `${SLATE} section 6`],
    seCodes: [asSeCode("8.15(C)")],
    summary:
      "M1 took over the 8.4(A) content that originally made M3 its carrier. The " +
      "slate says M3 may retain 8.15(C) as one concept, that its second concept " +
      "or a full replacement pair has not been selected, and explicitly declines " +
      "to invent one.",
    registryDisposition:
      "M3 is recorded with assignmentStatus OPEN and zero assigned standards. " +
      "The GRIEVANCE_TO_RIGHT concept for 8.15(C) exists but has no mission " +
      "owner, so both the mission and the standard show up as blocked instead of " +
      "appearing to be handled.",
    owner: "PRODUCT_OWNER",
  },
  {
    id: "TIER_A_8_21_A_UNCARRIED",
    kind: "MISSING_ASSIGNMENT",
    sources: [COVERAGE, `${SLATE} section 3 table`],
    seCodes: [asSeCode("8.21(A)")],
    summary:
      "The coverage map lists 8.21(A) points of view as one of the eleven Tier A " +
      "standards Boston must own and describes it as a live mechanic. No mission " +
      "in the slate is assigned to it, and the only concept beneath it is the " +
      "LOYALIST_VIEW enrichment micro.",
    registryDisposition:
      "Registered as Tier A with one micro beneath it. Reported by both " +
      "SE_WITHOUT_ASSESSABLE_CONCEPT and SE_NOT_ASSIGNED_TO_ANY_MISSION. Either " +
      "a mission takes it or the coverage map should stop calling it must-own.",
    owner: "PRODUCT_OWNER",
  },
  {
    id: "PROCLAMATION_1763_NO_OWNER",
    kind: "CONTRADICTION",
    sources: [TEKS, DELIVERY, `${SLATE} section 3 table`],
    seCodes: [asSeCode("8.4(A)")],
    summary:
      "Three sources disagree about the Proclamation of 1763. It is a named " +
      "clause of the chapter's top Readiness standard. teks.ts marks it " +
      "SCHEDULED_LATER, the concept-delivery map promotes it to a gated Act 2 " +
      "concept, and the mission slate assigns it to no mission at all.",
    registryDisposition:
      "A concept exists for the clause with no mission owner and an UNALLOCATED " +
      "delivery surface, so CONCEPT_WITHOUT_MISSION_OWNER fires. One of the three " +
      "sources has to move.",
    owner: "PRODUCT_OWNER",
  },
  {
    id: "MICRO_DRAFT_TAGS_ARE_STRANDS",
    kind: "INVALID_REFERENCE",
    sources: [MICRO],
    seCodes: [],
    summary:
      "Seven of the fourteen micros carry draft TEKS tags that are strands " +
      "rather than student expectations: 8.12, 8.13, 8.15, 8.19, and 8.29. A " +
      "strand cannot be assessed against, and 8.13 and 8.29 are not in the " +
      "assessed target set at all — 8.13 is the Industrial Revolution and the " +
      "War of 1812, and 8.29 is a skills strand the coverage map's 85 " +
      "expectations never mention. The document says its tags are draft and asks " +
      "for confirmation.",
    registryDisposition:
      "Every strand-only tag is in the alias table with disposition NOT_AN_SE_CODE " +
      "so it can never resolve. Six micros carry PROPOSED_RETAG with the original " +
      "tags preserved in sourceDraftTags. HARD_COIN_SCARCITY is the weakest of " +
      "the six and needs SME attention first: both of its draft tags were " +
      "unusable.",
    owner: "CURRICULUM_SME",
  },
  {
    id: "MICRO_8_15_MISDESCRIBED",
    kind: "INVALID_REFERENCE",
    sources: [MICRO, COVERAGE],
    seCodes: [asSeCode("8.15(A)"), asSeCode("8.15(C)"), asSeCode("8.15(E)")],
    summary:
      "Micro-Concepts.md tags LIBERTY_TREE with '8.15 symbols/citizenship'. " +
      "Strand 8.15 is historic documents, colonial grievances, and political " +
      "philosophers. The tag describes a strand that does not exist under that " +
      "number.",
    registryDisposition:
      "The 8.4(A) half of the draft tag is kept as the parent; the 8.15 half is " +
      "discarded and recorded in the concept's notes.",
    owner: "CURRICULUM_SME",
  },
  {
    id: "TEA_PARTY_TAGGED_TO_WRONG_SE",
    kind: "CONTRADICTION",
    sources: [`${BANK} BANK.BOSTON.USER.Q39.v1`, COVERAGE],
    seCodes: [asSeCode("8.20(B)"), asSeCode("8.4(A)")],
    summary:
      "The Boston Tea Party item is tagged 8.4(A):NO_REPRESENTATION. The coverage " +
      "map assigns the Tea Party to 8.20(B) civil disobedience and names Boston " +
      "its definitive carrier. The representation link in the item's rationale is " +
      "real, but it is secondary evidence, not the standard the item measures.",
    registryDisposition:
      "Retagged: primary evidence is the 8.20(B) concept, with the representation " +
      "concept kept as secondary evidence. The item's stem and rationales are " +
      "untouched.",
    owner: "CONTENT_AUTHOR",
  },
  {
    id: "STAMP_ITEM_DOES_NOT_ASSESS_STAMP_SCOPE",
    kind: "CONTRADICTION",
    sources: [`${BANK} BANK.BOSTON.USER.STAMP.v1`],
    seCodes: [asSeCode("8.4(A)")],
    summary:
      "The only production-eligible item for the Stamp-scope concept asks how " +
      "colonists RESPONDED to the Act, not what the Act taxed. It measures " +
      "organized resistance well and stamp scope barely.",
    registryDisposition:
      "Mapped with the Stamp-scope concept as primary, since that is the slot it " +
      "fills in the existing bank, plus representation and non-importation as " +
      "secondary evidence. Flagged in the item note: the concept still has no " +
      "item that asks what needed a stamp.",
    owner: "CONTENT_AUTHOR",
  },
  {
    id: "Q05_RATIONALE_TEACHES_UNTAUGHT_CLAUSE",
    kind: "TEACH_ASSESS_MISMATCH",
    sources: [
      `${BANK} BANK.BOSTON.USER.Q05.v1`,
      `${SLATE} section 4.9 module-coverage verification`,
    ],
    seCodes: [asSeCode("8.4(A)")],
    summary:
      "The correct option's rationale rests on recovering 'the cost of defending " +
      "the colonies'. Mission-Slate 4.9 records that the M1 module deliberately " +
      "teaches only the war debt, says nothing about the cost of defending new " +
      "territory, and instructs that no item depend on that clause.",
    registryDisposition:
      "Recorded on the item mapping. Either the module gains the clause or the " +
      "item's rationale is grading content the game never taught; the slate is " +
      "explicit that one of the two has to change.",
    owner: "CONTENT_AUTHOR",
  },
  {
    id: "TEKS_8_4_B_TWO_PARTIAL_LISTS",
    kind: "CONTRADICTION",
    sources: [TEKS, COVERAGE],
    seCodes: [asSeCode("8.4(B)")],
    summary:
      "The repository holds two partial and mutually inconsistent lists of the " +
      "individuals 8.4(B) enumerates. teks.ts names three and calls them context " +
      "rather than gated concepts; the coverage map names eight followed by an " +
      "ellipsis and states the standard enumerates fourteen.",
    registryDisposition:
      "8.4(B) is registered with no clauses, because neither list is verifiable " +
      "here and a clause list is exactly the kind of thing that must not be " +
      "guessed. Its concepts name individuals the chapter teaches, not clauses of " +
      "the standard.",
    owner: "CURRICULUM_SME",
  },
  {
    id: "GRIEVANCE_HALF_STANDARD",
    kind: "CONTRADICTION",
    sources: [COVERAGE, BANK],
    seCodes: [asSeCode("8.15(C)")],
    summary:
      "8.15(C) has two halves: the colonial grievances and how the Constitution " +
      "and Bill of Rights addressed them. The coverage map gives Boston the " +
      "grievances and a later chapter the remedy. Three banked items ask only " +
      "about the remedy — which amendment answered which grievance — and are " +
      "dated 1789-1791.",
    registryDisposition:
      "The concept is scoped to the grievance. The three items map to it and are " +
      "reported by ITEM_ERA_OUTSIDE_CHAPTER_WINDOW, so they are visible as banked " +
      "for a later chapter rather than as Boston coverage.",
    owner: "CONTENT_AUTHOR",
  },
  {
    id: "OWNER_ITEMS_MOSTLY_OUT_OF_ERA",
    kind: "TEACH_ASSESS_MISMATCH",
    sources: [BANK],
    seCodes: [],
    summary:
      "Eight of the sixteen owner-provided items are dated outside Boston's " +
      "1765-1775 window, and eight carry TEKS.PENDING_SME_REVIEW instead of a " +
      "standard tag. The bank is genuinely half a Boston bank.",
    registryDisposition:
      "Every item is mapped or explicitly marked out of scope, and the era check " +
      "computes eligibility rather than trusting the actScope field. Eight items " +
      "are era-eligible for Boston.",
    owner: "CONTENT_AUTHOR",
  },
  {
    id: "MERCANTILISM_ACT_SPREAD",
    kind: "CONTRADICTION",
    sources: [COVERAGE, `${SLATE} section 14`],
    seCodes: [asSeCode("8.4(A)")],
    summary:
      "The coverage map spreads mercantilism and non-importation across Acts 1 " +
      "through 4. The mission slate assigns the only 8.4(A) revisit to M11 in " +
      "1774, which leaves Act 1's mercantilism exposure carried by an enrichment " +
      "micro rather than a macro.",
    registryDisposition:
      "The MERCANTILISM macro is owned by M11 and the NON_IMPORTATION micro sits " +
      "under the same clause for Act 1. Recorded in the concept's notes; not " +
      "resolved.",
    owner: "PRODUCT_OWNER",
  },
];

export const DEFECTS_BY_OWNER: ReadonlyMap<DefectOwner, SourceDefect[]> = (() => {
  const out = new Map<DefectOwner, SourceDefect[]>();
  for (const defect of SOURCE_DEFECTS) {
    const list = out.get(defect.owner);
    if (list) list.push(defect);
    else out.set(defect.owner, [defect]);
  }
  return out;
})();

export function defectsForSe(code: SeCode): SourceDefect[] {
  return SOURCE_DEFECTS.filter((d) => d.seCodes.includes(code));
}
