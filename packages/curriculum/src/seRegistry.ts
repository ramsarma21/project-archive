import { CHAPTER_BOSTON } from "./chapters.js";
import { asSeCode, compareSeCodes, type SeCode } from "./seCode.js";
import type { StudentExpectation } from "./types.js";

// ============================================================================
// Student-expectation registry — Boston's 23 target standards.
//
// SCOPE. Grade 8 Social Studies has 85 assessed student expectations. Boston
// carries 23 of them. Only those 23 are seeded here; the structure is
// chapter-agnostic so Philadelphia and the later chapters add their own rows
// without touching these.
//
// TEXT HONESTY. Exactly one entry, 8.4(A), holds the standard's own words, and
// it holds them because `packages/chapter-boston/src/teks.ts` transcribed them
// with a citation. For the other 22 the repository never held the official text,
// so `officialText` is null and `textStatus` is UNVERIFIED_MISSING. The
// `workingDescription` on every row is our paraphrase and is labelled as such.
// Inventing standards text would be worse than a visible gap: a teacher-facing
// mastery report that quotes a fabricated standard is a compliance problem, not
// a cosmetic one.
//
// DESIGNATION HONESTY. Reporting category and readiness/supporting status come
// from `docs/chapters/boston-1765/STAAR-Coverage-Map.md`, which transcribes the
// TEA assessed-curriculum document. That makes every designation second-hand
// (`SECONDARY_INTERNAL`), and no row in this seed was re-read against the
// primary document (`independentlyReverified: false`).
// ============================================================================

/** Era window Boston plays across, used for item-scope checks. */
export const BOSTON_ERA_WINDOW = { start: 1765, end: 1775 } as const;

const COVERAGE_MAP = "docs/chapters/boston-1765/STAAR-Coverage-Map.md";
const CURRICULUM_WORLD_MAP = "docs/design/Curriculum-World-Map.md";
const CONCEPT_DELIVERY_MAP = "docs/chapters/boston-1765/Concept-Delivery-Map.md";
const MISSION_SLATE = "docs/chapters/boston-1765/Mission-Slate.md";
const CHAPTER_TEKS = "packages/chapter-boston/src/teks.ts";

const DESIGNATION_SOURCE =
  `${COVERAGE_MAP} — transcribing the TEA STAAR Grade 8 Social Studies ` +
  `assessed curriculum (rev. Aug 2024)`;

/** Provenance for a row whose official text we do not hold. */
function unverified(): StudentExpectation["provenance"] {
  return {
    adoption: null,
    textSource: null,
    designationSource: DESIGNATION_SOURCE,
    designationStatus: "SECONDARY_INTERNAL",
    independentlyReverified: false,
  };
}

// 8.4(A) is the one standard whose words the repository actually holds.
const TEKS_8_4_A_TEXT =
  "analyze causes of the American Revolution, including the Proclamation of " +
  "1763, the Intolerable Acts, the Stamp Act, mercantilism, lack of " +
  "representation in Parliament, and British economic policies following the " +
  "French and Indian War";

const ROWS: StudentExpectation[] = [
  // -- Reporting Category 1: History ----------------------------------------
  {
    code: asSeCode("8.1(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Identify the major eras in United States history through 1877, including " +
      "the revolution, and describe their causes and effects.",
    reportingCategory: 1,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP, CURRICULUM_WORLD_MAP],
    notes: [
      "Boston is the revolution era lived as cause and effect, but the era set " +
        "itself spans every chapter, so mastery is cross-chapter.",
    ],
  },
  {
    code: asSeCode("8.3(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Explain the reasons for the growth of representative government and " +
      "institutions during the colonial period.",
    reportingCategory: 1,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [
      "Boston town meetings and the Massachusetts assembly are the carrier; " +
        "the House of Burgesses and the Mayflower Compact belong to earlier chapters.",
    ],
  },
  {
    code: asSeCode("8.4(A)"),
    officialText: TEKS_8_4_A_TEXT,
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Analyze the causes of the American Revolution across six named causes.",
    reportingCategory: 1,
    standardType: "READINESS",
    recurrence: "ONCE",
    chapterTier: "A_MUST_OWN",
    clauses: [
      {
        clauseId: "PROCLAMATION_1763",
        text: "the Proclamation of 1763",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "INTOLERABLE_ACTS",
        text: "the Intolerable Acts",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "STAMP_ACT",
        text: "the Stamp Act",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "MERCANTILISM",
        text: "mercantilism",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "NO_REPRESENTATION",
        text: "lack of representation in Parliament",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "POSTWAR_POLICY",
        text: "British economic policies following the French and Indian War",
        textStatus: "VERBATIM_CITED",
      },
    ],
    primaryChapter: CHAPTER_BOSTON,
    provenance: {
      adoption: "2022",
      textSource: "19 Tex. Admin. Code s.113.20, TEKS 8.4(A) (adopted 2022)",
      designationSource: DESIGNATION_SOURCE,
      designationStatus: "SECONDARY_INTERNAL",
      independentlyReverified: false,
    },
    sourceRefs: [CHAPTER_TEKS, COVERAGE_MAP],
    notes: [
      "The single most valuable standard in the chapter and the reason one SE " +
        "cannot be the assessment unit: six independent causes sit inside it.",
      "Text transcribed from " +
        CHAPTER_TEKS +
        "; not independently re-read against 19 Tex. Admin. Code during this seed.",
    ],
  },
  {
    code: asSeCode("8.4(B)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Explain the roles played by significant individuals during the American " +
      "Revolution.",
    reportingCategory: 1,
    standardType: "SUPPORTING",
    recurrence: "ONCE",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [CHAPTER_TEKS, COVERAGE_MAP],
    notes: [
      "CONTRADICTION: the repository holds two partial and mutually " +
        "inconsistent lists of the enumerated individuals. " +
        CHAPTER_TEKS +
        " names three (Samuel Adams, Crispus Attucks, John Adams) and calls " +
        "them context rather than gated concepts; " +
        COVERAGE_MAP +
        " names eight followed by an ellipsis and says the SE enumerates " +
        "fourteen. Neither list is verifiable here, so no clauses are declared.",
      "Clause-level concepts under this SE therefore name individuals the " +
        "chapter teaches, not clauses of the standard.",
    ],
  },
  {
    code: asSeCode("8.4(C)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Explain the significance of events of the American Revolution, including " +
      "the Battles of Lexington and Concord and declaring independence.",
    reportingCategory: 1,
    standardType: "READINESS",
    recurrence: "ONCE",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP, CURRICULUM_WORLD_MAP],
    notes: [
      "Split standard: Boston owns Lexington and Concord (April 1775); the " +
        "declaring-independence half hands off to the Philadelphia chapter. " +
        "Recurrence is recorded as ONCE per " +
        COVERAGE_MAP +
        ", which is true only of Boston's half.",
    ],
  },

  // -- Reporting Category 2: Geography and Culture ---------------------------
  {
    code: asSeCode("8.10(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Locate places and regions of importance in the United States during the " +
      "major eras through 1877.",
    reportingCategory: 2,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.10(C)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Analyze the effects of physical and human geographic factors — waterways, " +
      "transportation, and communication — on major historical events.",
    reportingCategory: 2,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.11(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Analyze how physical characteristics of the environment influenced " +
      "population distribution, settlement patterns, and economic activities.",
    reportingCategory: 2,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.23(B)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Explain how urbanization contributed to conflicts resulting from " +
      "differences in social class, political beliefs, and religious beliefs.",
    reportingCategory: 2,
    standardType: "SUPPORTING",
    recurrence: "ONCE",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [
      "Boston's carrier is the ropewalk wage conflict between town labourers " +
        "and billeted soldiers that fed the Massacre.",
    ],
  },
  {
    code: asSeCode("8.23(E)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Identify the political, social, and economic contributions of women to " +
      "American society.",
    reportingCategory: 2,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [],
  },

  // -- Reporting Category 3: Government and Citizenship ---------------------
  {
    code: asSeCode("8.15(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Identify the influence of ideas from historic documents, including the " +
      "Magna Carta and the English Bill of Rights, on the U.S. system of " +
      "government.",
    reportingCategory: 3,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [
      "Cited by " +
        MISSION_SLATE +
        " section 2.1 as an example of the slate's vocabulary, but no mission " +
        "in the slate table is assigned to it. See MISSION_SLATE_2_1 in the " +
        "known-defect list.",
    ],
  },
  {
    code: asSeCode("8.15(C)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Identify colonial grievances listed in the Declaration of Independence " +
      "and explain how those grievances were addressed in the U.S. Constitution " +
      "and the Bill of Rights.",
    reportingCategory: 3,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [
      "Boston owns the grievances themselves — writs of assistance, quartering, " +
        "trial without jury in vice-admiralty courts, taxation without consent. " +
        "The 'addressed in the Constitution' half belongs to a later chapter, so " +
        "Boston items must stop at the grievance.",
      MISSION_SLATE +
        " section 6 offers this SE as M3's one retained concept, but M3's " +
        "assignment is unsettled, so the concept beneath it has no mission owner.",
    ],
  },
  {
    code: asSeCode("8.15(E)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Identify the contributions of political philosophers, including John " +
      "Locke and Charles de Montesquieu, to the development of self-government.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP, MISSION_SLATE],
    notes: [],
  },
  {
    code: asSeCode("8.19(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Define and give examples of unalienable and natural rights.",
    reportingCategory: 3,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.19(C)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Describe the responsibilities of citizens of the United States, including " +
      "staying informed on public issues and serving on juries.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.20(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Identify the Founding Fathers who modelled civic virtue and explain how " +
      "their example shaped citizenship.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.20(B)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Describe the importance of free speech and civil disobedience, including " +
      "the Boston Tea Party, in a constitutional republic.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "ONCE",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP, CURRICULUM_WORLD_MAP],
    notes: [
      "Boston is the definitive carrier: the Tea Party is the standard's named " +
        "example and it is this chapter's Act 3.",
    ],
  },
  {
    code: asSeCode("8.21(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Analyze different points of view of political parties and interest groups " +
      "on important historical issues.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [
      "A Tier A must-own standard with no mission assignment anywhere in the " +
        "slate table. Only the LOYALIST_VIEW enrichment micro sits beneath it, " +
        "so there is nothing on the assessment spine for it today.",
      "Cited by " +
        MISSION_SLATE +
        " section 2.1 as an example of the slate's vocabulary; the table assigns " +
        "8.21(B) to M5 instead.",
    ],
  },
  {
    code: asSeCode("8.21(B)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Explain the importance of free speech and the press in a constitutional " +
      "republic.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP, MISSION_SLATE],
    notes: [],
  },
  {
    code: asSeCode("8.22(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Analyze the leadership qualities of elected and appointed leaders, " +
      "including George Washington.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP, MISSION_SLATE],
    notes: [
      "Reporting category 3 rather than 1: " +
        COVERAGE_MAP +
        " lists (22)(A) under Government and Citizenship.",
    ],
  },

  // -- Reporting Category 4: Economics, Science, Technology, and Society ----
  {
    code: asSeCode("8.12(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Identify economic differences among different regions of the United States.",
    reportingCategory: 4,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.12(C)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Analyze the causes and effects of economic differences among regions of " +
      "the United States over time.",
    reportingCategory: 4,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP],
    notes: [
      "Peaks in a later sectionalism chapter; Boston can only introduce it.",
    ],
  },
  {
    code: asSeCode("8.14(A)"),
    officialText: null,
    textStatus: "UNVERIFIED_MISSING",
    workingDescription:
      "Explain why a free-enterprise system of economics developed in the new " +
      "nation, including minimal regulation, taxation, private property rights, " +
      "and entrepreneurship.",
    reportingCategory: 4,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: unverified(),
    sourceRefs: [COVERAGE_MAP, MISSION_SLATE],
    notes: [],
  },
];

/** The registry, keyed by canonical code. */
export const STUDENT_EXPECTATIONS: ReadonlyMap<SeCode, StudentExpectation> =
  new Map(
    [...ROWS]
      .sort((a, b) => compareSeCodes(a.code, b.code))
      .map((row) => [row.code, row]),
  );

/** All rows in code order. */
export const ALL_STUDENT_EXPECTATIONS: readonly StudentExpectation[] = [
  ...STUDENT_EXPECTATIONS.values(),
];

export function getStudentExpectation(
  code: SeCode,
): StudentExpectation | undefined {
  return STUDENT_EXPECTATIONS.get(code);
}

/** True when the code is a Boston target SE. */
export function isTargetSe(code: string): boolean {
  return STUDENT_EXPECTATIONS.has(code as SeCode);
}

export const OTHER_CHAPTER_HINTS: Readonly<Record<string, string>> = {
  PHILADELPHIA:
    "Constitution, Declaration of Independence, Bill of Rights, early republic",
  WAR_CHAPTER: "Continental Army campaigns after 1775, Yorktown, Treaty of Paris",
};
