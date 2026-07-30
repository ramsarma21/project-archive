import { bostonConceptId } from "./conceptRegistry.js";
import { BOSTON_ERA_WINDOW } from "./seRegistry.js";
import type {
  CurriculumConceptId,
  ItemConceptEvidence,
  ItemConceptMapping,
} from "./types.js";

// ============================================================================
// Item/concept mapping — many-to-many.
//
// One stem can evidence several concepts. The existing bank already does it: its
// Stamp Act item ties the Act's scope to the representation argument, and its
// Samuel Adams natural-rights item lands on natural rights, representation, and
// the growth of representative government at once. Forcing a single concept per
// item either loses that evidence or duplicates the item.
//
// Exactly one evidence per item is PRIMARY, so per-concept mastery scoring has
// an unambiguous owner while cross-concept evidence is still recorded and
// reportable.
//
// SEEDED FROM. The sixteen owner-provided items in cp1Bank.ts (retagged, not
// rewritten — the stems and rationales are byte-exact owner content and must not
// be touched) and the eighteen M1 duel items authored in Mission-Slate 4.9. The
// development fixture items in the same bank are deliberately not mapped: they
// are QA scaffolding and are never production-eligible.
// ============================================================================

const CP1_BANK_ID = "BOS.ACT01.CP1.PRODUCTION";
const M1_DUEL_BANK_ID = "BOS.MD01.DUEL.AUTHORED";

function primary(slug: string, note?: string): ItemConceptEvidence {
  return note
    ? { conceptId: bostonConceptId(slug), weight: "PRIMARY", note }
    : { conceptId: bostonConceptId(slug), weight: "PRIMARY" };
}

function secondary(slug: string, note?: string): ItemConceptEvidence {
  return note
    ? { conceptId: bostonConceptId(slug), weight: "SECONDARY", note }
    : { conceptId: bostonConceptId(slug), weight: "SECONDARY" };
}

// ---------------------------------------------------------------------------
// Era windows. Items carry a free-text era; Boston plays 1765-1775. An item
// whose era does not overlap that window cannot be selected for a Boston
// assessment however well its concept fits, which is a distinction the existing
// bank's `actScope` field approximates and this one computes.
// ---------------------------------------------------------------------------

export interface EraRange {
  start: number;
  end: number;
}

const YEAR = /(1[5-9]\d{2})/g;

/** Read "1765", "1764-1767", or "1789 (constitutional)" into a year range. */
export function parseEraRange(era: string | null): EraRange | null {
  if (!era) return null;
  const years = [...era.matchAll(YEAR)].map((m) => Number(m[1]));
  if (years.length === 0) return null;
  return { start: Math.min(...years), end: Math.max(...years) };
}

export function eraOverlapsWindow(
  era: string | null,
  window: EraRange = BOSTON_ERA_WINDOW,
): boolean | null {
  const range = parseEraRange(era);
  if (!range) return null;
  return range.start <= window.end && range.end >= window.start;
}

// ---------------------------------------------------------------------------
// The sixteen owner-provided assessment items, retagged.
// ---------------------------------------------------------------------------

const OWNER_ITEM_MAPPINGS: ItemConceptMapping[] = [
  {
    itemId: "BANK.BOSTON.USER.Q05.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1764-1767",
    sourceTags: ["RCC.DEBT_POLICY_INTRO", "8.4(A):POSTWAR_POLICY"],
    evidences: [primary("POSTWAR_REVENUE")],
    note:
      "The correct option's rationale rests on 'the cost of defending the " +
      "colonies'. Mission-Slate 4.9 records that the M1 module deliberately " +
      "teaches the war debt and says nothing about defending new territory, and " +
      "that no duel item may depend on that clause. This multiple-choice item " +
      "does depend on it, so either the module gains the clause or this item's " +
      "rationale is out of alignment with what the game teaches.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q24.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1765",
    sourceTags: ["RCC.REPRESENTATION_CAUSE", "8.4(A):NO_REPRESENTATION"],
    evidences: [
      primary("REPRESENTATION"),
      secondary(
        "RIGHTS_OF_ENGLISHMEN",
        "The rationale grounds the claim in the rights colonists held as " +
          "Englishmen, which is 8.15(A) content.",
      ),
    ],
  },
  {
    itemId: "BANK.BOSTON.USER.STAMP.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1765",
    sourceTags: [
      "RCC.STAMP_INTERNAL_INTRO",
      "RCC.REPRESENTATION_CAUSE",
      "8.4(A)",
    ],
    evidences: [
      primary("STAMP_SCOPE"),
      secondary("REPRESENTATION"),
      secondary(
        "NON_IMPORTATION",
        "The correct option names the boycotts and the Sons of Liberty.",
      ),
    ],
    note:
      "MIS-TAG: this is the only production-eligible item for the Stamp-scope " +
      "concept, but its stem asks how colonists RESPONDED to the Act, not what " +
      "the Act taxed. It evidences organized resistance well and stamp scope " +
      "barely. The concept still has no item that asks what needed a stamp.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q04.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1774",
    sourceTags: [
      "RCL.INTOLERABLE_ACTS_RESPONSE",
      "8.4(A):INTOLERABLE_ACTS",
      "FIRST_CONTINENTAL_CONGRESS",
    ],
    evidences: [
      primary("INTOLERABLE_ACTS"),
      secondary("REVOLUTION_CAUSE_EFFECT_CHAIN"),
    ],
  },
  {
    itemId: "BANK.BOSTON.USER.Q22.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1789-1791",
    sourceTags: [
      "RCL.QUARTERING_THIRD_AMENDMENT",
      "TEKS.PENDING_SME_REVIEW",
      "QUARTERING",
      "BILL_OF_RIGHTS",
    ],
    evidences: [primary("GRIEVANCE_TO_RIGHT")],
    note:
      "Concept in scope, item out of era. The quartering grievance is Boston's; " +
      "the Third Amendment that answered it is a later chapter's. Usable in " +
      "Boston only if the stem is rescoped to the grievance.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q23.v1",
    bankId: CP1_BANK_ID,
    status: "UNMAPPED_OUT_OF_SCOPE",
    era: "1776",
    sourceTags: [
      "RCL.DECLARATION_NATURAL_RIGHTS",
      "TEKS.PENDING_SME_REVIEW",
      "DECLARATION_OF_INDEPENDENCE",
      "NATURAL_RIGHTS",
    ],
    evidences: [],
    note: "Jefferson and the Declaration belong to the Philadelphia chapter.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q26.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1772",
    sourceTags: [
      "RCL.NATURAL_RIGHTS_REPRESENTATION",
      "8.4(A):NO_REPRESENTATION",
      "RCC.REPRESENTATION_CAUSE",
      "NATURAL_RIGHTS",
    ],
    evidences: [
      primary("NATURAL_RIGHTS_GROUND"),
      secondary("REPRESENTATION"),
      secondary(
        "TOWN_MEETING_AUTHORITY",
        "The correct option is the growth of representative government, which is " +
          "8.3(A) content rather than 8.19(A).",
      ),
    ],
    note:
      "The clearest case for many-to-many mapping in the existing bank: one " +
      "Samuel Adams excerpt evidences three concepts across three standards.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q12.v1",
    bankId: CP1_BANK_ID,
    status: "UNMAPPED_OUT_OF_SCOPE",
    era: "1777",
    sourceTags: [
      "RCL.VALLEY_FORGE_WINTER",
      "TEKS.PENDING_SME_REVIEW",
      "VALLEY_FORGE",
      "CONTINENTAL_ARMY",
    ],
    evidences: [],
    note: "Valley Forge is after Boston's window.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q18.v1",
    bankId: CP1_BANK_ID,
    status: "UNMAPPED_OUT_OF_SCOPE",
    era: "1789 (constitutional)",
    sourceTags: [
      "RCL.CIVIL_MILITARY_SUPREMACY",
      "TEKS.PENDING_SME_REVIEW",
      "DECLARATION_GRIEVANCES",
      "US_CONSTITUTION",
    ],
    evidences: [],
    note:
      "Asks which constitutional provision answered a grievance, which is the " +
      "half of 8.15(C) Boston does not own.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q21.v1",
    bankId: CP1_BANK_ID,
    status: "UNMAPPED_OUT_OF_SCOPE",
    era: "1776-1783",
    sourceTags: [
      "RCL.CONTINENTAL_NAVY",
      "TEKS.PENDING_SME_REVIEW",
      "REVOLUTIONARY_WAR",
      "JOHN_PAUL_JONES",
    ],
    evidences: [],
    note: "Naval war, after Boston's window.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q31.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1776",
    sourceTags: [
      "RCL.UNALIENABLE_RIGHTS",
      "TEKS.PENDING_SME_REVIEW",
      "DECLARATION_OF_INDEPENDENCE",
      "NATURAL_RIGHTS",
    ],
    evidences: [primary("NATURAL_RIGHTS_GROUND")],
    note:
      "Concept in scope, item out of era: it asks for an example of an " +
      "unalienable right from the Declaration. Rescoping the stem to the 1770s " +
      "resistance would make it a Boston item.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q38.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1774",
    sourceTags: [
      "RCL.FIRST_CONTINENTAL_CONGRESS_GRIEVANCES",
      "8.4(A):INTOLERABLE_ACTS",
      "FIRST_CONTINENTAL_CONGRESS",
    ],
    evidences: [
      primary("INTOLERABLE_ACTS"),
      secondary(
        "GRIEVANCE_TO_RIGHT",
        "The four headlines are the grievances: harbour closure, dissolved " +
          "legislature, trials in England, quartering.",
      ),
    ],
  },
  {
    itemId: "BANK.BOSTON.USER.Q30.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1789-1791",
    sourceTags: [
      "RCL.TRIAL_BY_JURY_SIXTH_AMENDMENT",
      "TEKS.PENDING_SME_REVIEW",
      "DECLARATION_GRIEVANCES",
      "BILL_OF_RIGHTS",
    ],
    evidences: [primary("GRIEVANCE_TO_RIGHT")],
    note: "Same split as the quartering item: grievance in scope, amendment not.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q35.v1",
    bankId: CP1_BANK_ID,
    status: "UNMAPPED_OUT_OF_SCOPE",
    era: "1781-1783",
    sourceTags: [
      "RCL.YORKTOWN_TREATY_OF_PARIS",
      "TEKS.PENDING_SME_REVIEW",
      "YORKTOWN",
      "TREATY_OF_PARIS",
    ],
    evidences: [],
    note: "Yorktown and the peace, after Boston's window.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q43.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1770-1797",
    sourceTags: [
      "RCL.FOUNDER_JOHN_ADAMS",
      "TEKS.PENDING_SME_REVIEW",
      "JOHN_ADAMS",
      "BOSTON_MASSACRE",
      "TREATY_OF_PARIS",
    ],
    evidences: [primary("CIVIC_VIRTUE_UNPOPULAR_DEFENSE")],
    note:
      "Era overlaps Boston only because the range opens in 1770. Two of the " +
      "item's three clues (the presidency, the Treaty of Paris) are outside the " +
      "chapter, so a Boston form would need the stem narrowed to the Massacre " +
      "trial.",
  },
  {
    itemId: "BANK.BOSTON.USER.Q39.v1",
    bankId: CP1_BANK_ID,
    status: "MAPPED",
    era: "1773",
    sourceTags: [
      "RCL.BOSTON_TEA_PARTY",
      "8.4(A):NO_REPRESENTATION",
      "RCC.REPRESENTATION_CAUSE",
      "BOSTON_TEA_PARTY",
    ],
    evidences: [
      primary("DISCIPLINED_CIVIL_DISOBEDIENCE"),
      secondary("REPRESENTATION"),
    ],
    note:
      "MIS-TAG: the item is tagged 8.4(A):NO_REPRESENTATION, but the coverage " +
      "map assigns the Tea Party to 8.20(B) and names Boston its definitive " +
      "carrier. The representation link is real and is kept as secondary " +
      "evidence; the primary standard was wrong.",
  },
];

// ---------------------------------------------------------------------------
// The eighteen M1 duel items, authored at final quality in Mission-Slate 4.9.
// Regular by construction — six items per pool, one concept per pool — so the
// mapping is generated rather than transcribed.
// ---------------------------------------------------------------------------

const DUEL_POOLS: { conceptSlug: string; itemIds: string[] }[] = [
  {
    conceptSlug: "INTOLERABLE_ACTS",
    itemIds: [
      "BOS.MD01.DUEL.ACTS.WHO_IT_FALLS_ON.v1",
      "BOS.MD01.DUEL.ACTS.NOT_A_FINE.v1",
      "BOS.MD01.DUEL.ACTS.WHY_THE_TOWN.v1",
      "BOS.MD01.DUEL.ACTS.STILL_LAWFUL.v1",
      "BOS.MD01.DUEL.ACTS.FOUR_NOT_ONE.v1",
      "BOS.MD01.DUEL.ACTS.WHICH_ACT.v1",
    ],
  },
  {
    conceptSlug: "REPRESENTATION",
    itemIds: [
      "BOS.MD01.DUEL.REP.WHAT_RIGHT.v1",
      "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1",
      "BOS.MD01.DUEL.REP.NOT_THE_MONEY.v1",
      "BOS.MD01.DUEL.REP.FINISH_THE_CLAIM.v1",
      "BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1",
      "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1",
    ],
  },
  {
    conceptSlug: "MERCANTILISM",
    itemIds: [
      "BOS.MD01.DUEL.RESIST.HOW_THEY_ANSWER.v1",
      "BOS.MD01.DUEL.RESIST.NOT_WAR.v1",
      "BOS.MD01.DUEL.RESIST.NOT_COUNTERTAX.v1",
      "BOS.MD01.DUEL.RESIST.WHY_IT_BITES.v1",
      "BOS.MD01.DUEL.RESIST.THE_COVENANT.v1",
      "BOS.MD01.DUEL.RESIST.PETITION_AND_CONGRESS.v1",
    ],
  },
];

function duelMappings(): ItemConceptMapping[] {
  return DUEL_POOLS.flatMap((pool) =>
    pool.itemIds.map((itemId) => ({
      itemId,
      bankId: M1_DUEL_BANK_ID,
      status: "MAPPED" as const,
      era: "1774",
      sourceTags: [`BOS.MD01.CONCEPT.${pool.conceptSlug}.v1`],
      evidences: [primary(pool.conceptSlug)],
    })),
  );
}

export const ITEM_MAPPINGS: readonly ItemConceptMapping[] = [
  ...OWNER_ITEM_MAPPINGS,
  ...duelMappings(),
];

export const ITEM_INDEX: ReadonlyMap<string, ItemConceptMapping> = new Map(
  ITEM_MAPPINGS.map((m) => [m.itemId, m]),
);

/** Concepts an item evidences, primary first. */
export function conceptsForItem(itemId: string): ItemConceptEvidence[] {
  const mapping = ITEM_INDEX.get(itemId);
  if (!mapping) return [];
  return [...mapping.evidences].sort((a, b) =>
    a.weight === b.weight ? 0 : a.weight === "PRIMARY" ? -1 : 1,
  );
}

/** Items that evidence a concept, optionally only where it is primary. */
export function itemsForConcept(
  conceptId: CurriculumConceptId,
  options: { primaryOnly?: boolean } = {},
): ItemConceptMapping[] {
  return ITEM_MAPPINGS.filter((m) =>
    m.evidences.some(
      (e) =>
        e.conceptId === conceptId &&
        (!options.primaryOnly || e.weight === "PRIMARY"),
    ),
  );
}

export interface ConceptItemDepth {
  conceptId: CurriculumConceptId;
  primaryItems: number;
  supportingItems: number;
  /** Primary items whose era overlaps the chapter window. */
  eraEligiblePrimaryItems: number;
}

/** Item depth per concept — the input to any "can we build a form yet" gate. */
export function conceptItemDepth(
  conceptId: CurriculumConceptId,
  window: EraRange = BOSTON_ERA_WINDOW,
): ConceptItemDepth {
  const all = itemsForConcept(conceptId);
  const primaryItems = all.filter((m) =>
    m.evidences.some((e) => e.conceptId === conceptId && e.weight === "PRIMARY"),
  );
  return {
    conceptId,
    primaryItems: primaryItems.length,
    supportingItems: all.length - primaryItems.length,
    eraEligiblePrimaryItems: primaryItems.filter(
      (m) => eraOverlapsWindow(m.era, window) !== false,
    ).length,
  };
}
