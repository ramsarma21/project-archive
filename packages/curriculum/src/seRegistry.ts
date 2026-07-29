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
// TEXT HONESTY. All 23 rows hold the standard's own words, taken from TEA's
// verbatim transcription in `content/staar/boston-coverage.json` (see
// STAAR_SOURCE below for the document and its hash). `workingDescription`
// remains our paraphrase, is labelled as such, and is never what a report
// quotes as the standard's wording — `packages/reporting/src/curriculum.ts`
// prefers `officialText` and falls back to the paraphrase only without it.
//
// Until 29 Jul this said 22 of the 23 rows had no official text. That was true
// of the registry and false of the repository: the verbatim text for every one
// of them was already sitting in `content/staar`. The rows were empty, not
// unknowable, and a teacher-facing mastery report was quoting our paraphrases
// for 22 of the standards it claimed alignment to.
//
// PARAPHRASE DRIFT. With the official text now beside it, three paraphrases
// were provably wrong rather than merely loose, and are corrected here: 8.20(B)
// carried 8.21(B)'s "free speech ... in a constitutional republic" (TEA's
// 8.20(B) is about civil disobedience and does not contain the phrase), 8.14(A)
// invented a fourth clause "entrepreneurship", and 8.19(A) added "natural" to
// TEA's "unalienable rights". Divergences that remain are narrowing, not
// invention — a paraphrase scoped to Boston's half of a split standard — except
// the four recorded in `sourceDefects.ts` under PARAPHRASE_* , which need an
// SME.
//
// DESIGNATION HONESTY. Reporting category and readiness/supporting status still
// come from `docs/chapters/boston-1765/STAAR-Coverage-Map.md`
// (`SECONDARY_INTERNAL`), and `independentlyReverified` stays false on every row
// because that flag means a *human* re-read the primary document and none has.
// Both are now understated rather than wrong: all 23 designations were checked
// against the primary document mechanically and all 23 agree, so the upgrade to
// PRIMARY_SOURCE is evidenced and available. It was deliberately not taken
// here, because the designation layer was out of scope for the pass that
// populated the text.
// ============================================================================

/** Era window Boston plays across, used for item-scope checks. */
export const BOSTON_ERA_WINDOW = { start: 1765, end: 1775 } as const;

const COVERAGE_MAP = "docs/chapters/boston-1765/STAAR-Coverage-Map.md";
const CURRICULUM_WORLD_MAP = "docs/design/Curriculum-World-Map.md";
const CONCEPT_DELIVERY_MAP = "docs/chapters/boston-1765/Concept-Delivery-Map.md";
const MISSION_SLATE = "docs/chapters/boston-1765/Mission-Slate.md";

/**
 * Where every `officialText` below comes from.
 *
 * The PDF is deliberately not vendored (TEA licensing — `content/staar/README.md`
 * section 4), so the in-repo carrier is the transcription, and the hash in
 * `sources.json` is what lets a later pass prove the document behind it has not
 * changed. `seRegistryText.test.ts` pins every string here against that
 * transcription, so the two cannot drift apart silently.
 */
const STAAR_COVERAGE = "content/staar/boston-coverage.json";

const STAAR_SOURCE =
  "TEA, STAAR Grade 8 Social Studies Assessment Eligible Texas Essential " +
  "Knowledge and Skills, Revised August 2024 " +
  "(staar-8-social-studies-assessed-curriculum.pdf, sha256 " +
  "dc48abcad536d4e47a9b54374324dd494f3ae870174d1bb08fe2c40a7b0483a5), " +
  `transcribed verbatim in ${STAAR_COVERAGE}; URL and hash in ` +
  "content/staar/sources.json";

const DESIGNATION_SOURCE =
  `${COVERAGE_MAP} — transcribing the TEA STAAR Grade 8 Social Studies ` +
  `assessed curriculum (rev. Aug 2024)`;

/** Provenance for a row quoting TEA's assessed-curriculum document. */
function teaVerbatim(
  overrides: Partial<StudentExpectation["provenance"]> = {},
): StudentExpectation["provenance"] {
  return {
    // TEA's assessed-curriculum document states an SE's text and its
    // designation; it does not state an adoption year, so this stays null
    // except where a row cites the Administrative Code directly.
    adoption: null,
    textSource: STAAR_SOURCE,
    designationSource: DESIGNATION_SOURCE,
    designationStatus: "SECONDARY_INTERNAL",
    independentlyReverified: false,
    ...overrides,
  };
}

const ROWS: StudentExpectation[] = [
  // -- Reporting Category 1: History ----------------------------------------
  {
    code: asSeCode("8.1(A)"),
    officialText:
      "identify the major eras in U.S. history through 1877, including " +
      "colonization, revolution, creation and ratification of the " +
      "Constitution, early republic, the Age of Jackson, westward " +
      "expansion, reform movements, sectionalism, Civil War, and " +
      "Reconstruction, and describe their causes and effects",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Identify the major eras in United States history through 1877, including " +
      "the revolution, and describe their causes and effects.",
    reportingCategory: 1,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP, CURRICULUM_WORLD_MAP],
    notes: [
      "Boston is the revolution era lived as cause and effect, but the era set " +
        "itself spans every chapter, so mastery is cross-chapter.",
    ],
  },
  {
    code: asSeCode("8.3(A)"),
    officialText:
      "explain the reasons for the growth of representative government and " +
      "institutions during the colonial period",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Explain the reasons for the growth of representative government and " +
      "institutions during the colonial period.",
    reportingCategory: 1,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "Boston town meetings and the Massachusetts assembly are the carrier; " +
        "the House of Burgesses and the Mayflower Compact belong to earlier chapters.",
    ],
  },
  {
    code: asSeCode("8.4(A)"),
    officialText:
      "analyze causes of the American Revolution, including the " +
      "Proclamation of 1763, the Intolerable Acts, the Stamp Act, " +
      "mercantilism, lack of representation in Parliament, and British " +
      "economic policies following the French and Indian War",
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
    provenance: teaVerbatim({
      adoption: "2022",
      textSource:
        "19 Tex. Admin. Code s.113.20, TEKS 8.4(A) (adopted 2022); " +
        STAAR_SOURCE,
    }),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "The single most valuable standard in the chapter and the reason one SE " +
        "cannot be the assessment unit: six independent causes sit inside it.",
      "The only row with two independent citations for its text: the " +
        "Administrative Code reference the seed was written from, and TEA's " +
        "assessed-curriculum document. The two agree character for character, " +
        "which is what licensed quoting the other 22 from the same document.",
    ],
  },
  {
    code: asSeCode("8.4(B)"),
    officialText:
      "explain the roles played by significant individuals during the " +
      "American Revolution, including Abigail Adams, John Adams, Wentworth " +
      "Cheswell, Samuel Adams, Mercy Otis Warren, James Armistead, Benjamin " +
      "Franklin, Crispus Attucks, King George III, Patrick Henry, Thomas " +
      "Jefferson, the Marquis de Lafayette, Thomas Paine, and George " +
      "Washington",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Explain the roles played by significant individuals during the American " +
      "Revolution, across fourteen named individuals.",
    reportingCategory: 1,
    standardType: "SUPPORTING",
    recurrence: "ONCE",
    chapterTier: "A_MUST_OWN",
    // `IND_` prefix, deliberately. Clause ids are generated into the alias
    // table as bare strings, and a bare `JOHN_ADAMS` collides with an existing
    // free-text item-lineage tag of the same spelling that resolves to
    // CIVIC_VIRTUE_UNPOPULAR_DEFENSE — the validator caught it as
    // ALIAS_DUPLICATE. Person names are exactly the strings a content author
    // reaches for as informal tags, so the standard's own clause ids are kept
    // out of that namespace rather than winning it by declaration order. Do not
    // "tidy" the prefix away; it reintroduces a silent alias override.
    clauses: [
      { clauseId: "IND_ABIGAIL_ADAMS", text: "Abigail Adams", textStatus: "VERBATIM_CITED" },
      { clauseId: "IND_JOHN_ADAMS", text: "John Adams", textStatus: "VERBATIM_CITED" },
      {
        clauseId: "IND_WENTWORTH_CHESWELL",
        text: "Wentworth Cheswell",
        textStatus: "VERBATIM_CITED",
      },
      { clauseId: "IND_SAMUEL_ADAMS", text: "Samuel Adams", textStatus: "VERBATIM_CITED" },
      {
        clauseId: "IND_MERCY_OTIS_WARREN",
        text: "Mercy Otis Warren",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "IND_JAMES_ARMISTEAD",
        text: "James Armistead",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "IND_BENJAMIN_FRANKLIN",
        text: "Benjamin Franklin",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "IND_CRISPUS_ATTUCKS",
        text: "Crispus Attucks",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "IND_KING_GEORGE_III",
        text: "King George III",
        textStatus: "VERBATIM_CITED",
      },
      { clauseId: "IND_PATRICK_HENRY", text: "Patrick Henry", textStatus: "VERBATIM_CITED" },
      {
        clauseId: "IND_THOMAS_JEFFERSON",
        text: "Thomas Jefferson",
        textStatus: "VERBATIM_CITED",
      },
      {
        clauseId: "IND_MARQUIS_DE_LAFAYETTE",
        text: "the Marquis de Lafayette",
        textStatus: "VERBATIM_CITED",
      },
      { clauseId: "IND_THOMAS_PAINE", text: "Thomas Paine", textStatus: "VERBATIM_CITED" },
      {
        clauseId: "IND_GEORGE_WASHINGTON",
        text: "George Washington",
        textStatus: "VERBATIM_CITED",
      },
    ],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "THE CONTRADICTION RECORDED HERE UNTIL 29 JUL WAS NOT ONE. This row used " +
        "to set TEA's enumeration against a list of three individuals in " +
        "packages/chapter-boston/src/teks.ts and conclude that neither list was " +
        "verifiable, so no clauses could be declared. Two things were wrong " +
        "with that. The file had been deleted (9f9a4d0) and is absent from " +
        "HEAD, so the registry was citing a dead path as an authority. And its " +
        "list never claimed to be the standard's enumeration — its own comment " +
        "read 'individuals the chapter surfaces as context (not gated " +
        "concepts)', an inventory of three NPCs. The two answered different " +
        "questions, so there was no authority conflict to adjudicate. Do not " +
        "re-open it: the fourteen above are TEA's own words.",
      "Boston owns seven of the fourteen: Samuel Adams, John Adams, Crispus " +
        "Attucks, Mercy Otis Warren, Abigail Adams, King George III and George " +
        "Washington. Benjamin Franklin, Thomas Jefferson and Thomas Paine are " +
        "Philadelphia's per " +
        CURRICULUM_WORLD_MAP +
        ", which has that chapter sharing this SE. Wentworth Cheswell, James " +
        "Armistead, Patrick Henry and the Marquis de Lafayette have no chapter " +
        "at all in the five-chapter plan — see OTHER_CHAPTER_HINTS.WAR_CHAPTER, " +
        "which posits a home that does not exist.",
      "DEFECT, not fixed here: recurrence is ONCE, but " +
        CURRICULUM_WORLD_MAP +
        " has Philadelphia sharing this SE, so ONCE is true only of Boston's " +
        "half — exactly the caveat 8.4(C) already carries. An item bank built " +
        "on ONCE will assess it only at Boston checkpoints. Left as ONCE " +
        "because the coverage map counts it among the five Boston-only " +
        "standards and moving it is a curriculum decision, not a transcription.",
    ],
  },
  {
    code: asSeCode("8.4(C)"),
    officialText:
      "explain the issues surrounding important events of the American " +
      "Revolution, including declaring independence; fighting the battles " +
      "of Lexington and Concord, Saratoga, and Yorktown; enduring the " +
      "winter at Valley Forge; and signing the Treaty of Paris of 1783",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Explain the significance of events of the American Revolution, including " +
      "the Battles of Lexington and Concord and declaring independence.",
    reportingCategory: 1,
    standardType: "READINESS",
    recurrence: "ONCE",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP, CURRICULUM_WORLD_MAP],
    notes: [
      "Split standard: Boston owns Lexington and Concord (April 1775); the " +
        "declaring-independence half hands off to the Philadelphia chapter. " +
        "Recurrence is recorded as ONCE per " +
        COVERAGE_MAP +
        ", which is true only of Boston's half.",
      "Now that the official text is here, the split is visible in it: of the " +
        "six named clauses, Saratoga, Yorktown, Valley Forge and the Treaty of " +
        "Paris fall outside Boston's 1765-1775 window and outside every " +
        "chapter in " +
        CURRICULUM_WORLD_MAP +
        ". Clauses are deliberately not declared — unlike 8.4(B)'s " +
        "individuals, these are semicolon-separated event phrases rather than " +
        "a clean enumeration, and splitting them is an authoring decision.",
    ],
  },

  // -- Reporting Category 2: Geography and Culture ---------------------------
  {
    code: asSeCode("8.10(A)"),
    officialText:
      "locate places and regions directly related to major eras and turning " +
      "points in the United States during the 17th, 18th, and 19th " +
      "centuries",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Locate places and regions of importance in the United States during the " +
      "major eras through 1877.",
    reportingCategory: 2,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.10(C)"),
    officialText:
      "analyze the effects of physical and human geographic factors such as " +
      "weather, landforms, waterways, transportation, and communication on " +
      "major historical events in the United States",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Analyze the effects of physical and human geographic factors — waterways, " +
      "transportation, and communication — on major historical events.",
    reportingCategory: 2,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "The paraphrase keeps three of TEA's five factors and drops weather and " +
        "landforms. Defensible only if 'such as' is illustrative — see " +
        "PARAPHRASE_SUCH_AS_AS_INCLUDING in sourceDefects.ts, which is the one " +
        "interpretive question this alignment could not close.",
    ],
  },
  {
    code: asSeCode("8.11(A)"),
    officialText:
      "analyze how physical characteristics of the environment influenced " +
      "population distribution, settlement patterns, and economic " +
      "activities in the United States",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Analyze how physical characteristics of the environment influenced " +
      "population distribution, settlement patterns, and economic activities.",
    reportingCategory: 2,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.23(B)"),
    officialText:
      "explain how urbanization contributed to conflicts resulting from " +
      "differences in religion, social class, and political beliefs",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Explain how urbanization contributed to conflicts resulting from " +
      "differences in social class, political beliefs, and religious beliefs.",
    reportingCategory: 2,
    standardType: "SUPPORTING",
    recurrence: "ONCE",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "Boston's carrier is the ropewalk wage conflict between town labourers " +
        "and billeted soldiers that fed the Massacre.",
    ],
  },
  {
    code: asSeCode("8.23(E)"),
    officialText:
      "identify the political, social, and economic contributions of women " +
      "to American society",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Identify the political, social, and economic contributions of women to " +
      "American society.",
    reportingCategory: 2,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [],
  },

  // -- Reporting Category 3: Government and Citizenship ---------------------
  {
    code: asSeCode("8.15(A)"),
    officialText:
      "identify the influence of ideas from historic documents, including " +
      "the Magna Carta, the English Bill of Rights, the Mayflower Compact, " +
      "and the Federalist Papers, on the U.S. system of government",
    textStatus: "VERBATIM_CITED",
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
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "Cited by " +
        MISSION_SLATE +
        " section 2.1 as an example of the slate's vocabulary, but no mission " +
        "in the slate table is assigned to it. See MISSION_SLATE_2_1 in the " +
        "known-defect list.",
      "The official text names four documents under 'including'; the " +
        "paraphrase keeps the two Boston can carry. The Mayflower Compact and " +
        "the Federalist Papers belong to earlier and later chapters, so this " +
        "standard is under-gated at chapter scope and its one concept, " +
        "RIGHTS_OF_ENGLISHMEN, has no mission owner. Recorded, not resolved.",
    ],
  },
  {
    code: asSeCode("8.15(C)"),
    officialText:
      "identify colonial grievances listed in the Declaration of " +
      "Independence and explain how those grievances were addressed in the " +
      "U.S. Constitution and the Bill of Rights",
    textStatus: "VERBATIM_CITED",
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
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
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
    officialText:
      "explain the role of significant individuals such as Thomas Hooker, " +
      "Charles de Montesquieu, and John Locke in the development of " +
      "self-government in colonial America",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Explain the role of significant individuals such as John Locke and " +
      "Charles de Montesquieu in the development of self-government in " +
      "colonial America.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP, MISSION_SLATE],
    notes: [
      "The paraphrase said 'including John Locke and Charles de Montesquieu' " +
        "where TEA says 'such as Thomas Hooker, Charles de Montesquieu, and " +
        "John Locke'. Restating an illustrative list as a mandatory one is the " +
        "kind of error that makes Boston's choice of Locke and Montesquieu over " +
        "Hooker look like a gap; TEA's connective is restored. Whether 'such " +
        "as' is in fact illustrative is PARAPHRASE_SUCH_AS_AS_INCLUDING.",
    ],
  },
  {
    code: asSeCode("8.19(A)"),
    officialText: "define and give examples of unalienable rights",
    textStatus: "VERBATIM_CITED",
    workingDescription: "Define and give examples of unalienable rights.",
    reportingCategory: 3,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "The paraphrase read 'unalienable and natural rights'. 'Natural' is not " +
        "in TEA's text and is not a synonym a report may add on the standard's " +
        "behalf, so it is removed. The chapter may still teach the natural-" +
        "rights vocabulary — NATURAL_RIGHTS_GROUND does — but the standard's " +
        "own words are the narrower ones.",
    ],
  },
  {
    code: asSeCode("8.19(C)"),
    officialText:
      "identify examples of responsible citizenship, including obeying " +
      "rules and laws, staying informed on public issues, voting, and " +
      "serving on juries",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Identify examples of responsible citizenship, including staying informed " +
      "on public issues and serving on juries.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "Under-gated, and now visibly so: TEA names four examples under " +
        "'including' and the chapter carries one, juries " +
        "(JURY_ROLE_CITIZENSHIP). Obeying rules and laws, staying informed, and " +
        "voting have no concept. Voting has no honest 1765-1775 Boston carrier; " +
        "the other two do. Recorded for the authoring pass, not invented here.",
    ],
  },
  {
    code: asSeCode("8.20(A)"),
    officialText:
      "evaluate the contributions of the Founding Fathers as models of " +
      "civic virtue",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Evaluate the contributions of the Founding Fathers as models of civic " +
      "virtue.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "The paraphrase said 'identify ... and explain' where TEA says " +
        "'evaluate', which lowers the cognitive demand the standard is written " +
        "at. TEA's verb is restored. This matters for items, not just wording: " +
        "an item that asks a student to identify a Founding Father does not " +
        "assess this standard at the level it is written.",
    ],
  },
  {
    code: asSeCode("8.20(B)"),
    officialText:
      "analyze reasons for and the impact of selected examples of civil " +
      "disobedience in U.S. history such as the Boston Tea Party and Henry " +
      "David Thoreau's refusal to pay a tax",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Analyze the reasons for and the impact of civil disobedience, taking the " +
      "Boston Tea Party as the example.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "ONCE",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP, CURRICULUM_WORLD_MAP],
    notes: [
      "Boston is the definitive carrier: the Tea Party is the standard's named " +
        "example and it is this chapter's Act 3.",
      "CORRECTED 29 Jul: the paraphrase read 'Describe the importance of free " +
        "speech and civil disobedience ... in a constitutional republic', which " +
        "is 8.21(B)'s content — 'describe the importance of free speech and " +
        "press in a constitutional republic' — welded onto this standard's " +
        "subject. 'Free speech' does not appear anywhere in TEA's 8.20(B), and " +
        "the real verb is 'analyze reasons for and the impact of', not " +
        "'describe the importance of'. Two adjacent standards had been " +
        "collapsed into one description, so an item written from it would have " +
        "assessed neither.",
    ],
  },
  {
    code: asSeCode("8.21(A)"),
    officialText:
      "identify different points of view of political parties and interest " +
      "groups on important historical issues",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Identify different points of view of political parties and interest " +
      "groups on important historical issues.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "A Tier A must-own standard with no mission assignment anywhere in the " +
        "slate table. Only the LOYALIST_VIEW enrichment micro sits beneath it, " +
        "so there is nothing on the assessment spine for it today.",
      "Cited by " +
        MISSION_SLATE +
        " section 2.1 as an example of the slate's vocabulary; the table assigns " +
        "8.21(B) to M5 instead.",
      "The paraphrase said 'analyze' where TEA says 'identify' — the opposite " +
        "of 8.20(A)'s error, and the reason both are worth naming: the " +
        "paraphrases were drifting in both directions, so the set of them was " +
        "not a reliable guide to how hard an item should be.",
    ],
  },
  {
    code: asSeCode("8.21(B)"),
    officialText:
      "describe the importance of free speech and press in a constitutional " +
      "republic",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Describe the importance of free speech and the press in a constitutional " +
      "republic.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "A_MUST_OWN",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP, MISSION_SLATE],
    notes: [
      "This is the standard whose words had leaked into 8.20(B)'s description. " +
        "With both official texts present the two are plainly distinct: this one " +
        "is speech and press, 8.20(B) is civil disobedience.",
    ],
  },
  {
    code: asSeCode("8.22(A)"),
    officialText:
      "analyze the leadership qualities of elected and appointed leaders of " +
      "the United States such as George Washington, John Marshall, and " +
      "Abraham Lincoln",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Analyze the leadership qualities of elected and appointed leaders of the " +
      "United States such as George Washington.",
    reportingCategory: 3,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP, MISSION_SLATE],
    notes: [
      "Reporting category 3 rather than 1: " +
        COVERAGE_MAP +
        " lists (22)(A) under Government and Citizenship.",
      "The paraphrase said 'including George Washington' where TEA says 'such " +
        "as George Washington, John Marshall, and Abraham Lincoln'. Marshall " +
        "and Lincoln are outside Boston's era entirely, so Washington alone is " +
        "the right chapter scope — but TEA's connective is restored so the other " +
        "two do not read as omissions from a mandatory list.",
    ],
  },

  // -- Reporting Category 4: Economics, Science, Technology, and Society ----
  {
    code: asSeCode("8.12(A)"),
    officialText:
      "identify economic differences among different regions of the United " +
      "States",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Identify economic differences among different regions of the United States.",
    reportingCategory: 4,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [],
  },
  {
    code: asSeCode("8.12(C)"),
    officialText:
      "analyze the causes and effects of economic differences among " +
      "different regions of the United States at selected times",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Analyze the causes and effects of economic differences among regions of " +
      "the United States over time.",
    reportingCategory: 4,
    standardType: "READINESS",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "Peaks in a later sectionalism chapter; Boston can only introduce it.",
    ],
  },
  {
    code: asSeCode("8.14(A)"),
    officialText:
      "explain why a free enterprise system of economics developed in the " +
      "new nation, including minimal government regulation, taxation, and " +
      "property rights",
    textStatus: "VERBATIM_CITED",
    workingDescription:
      "Explain why a free enterprise system of economics developed in the new " +
      "nation, including minimal government regulation, taxation, and property " +
      "rights.",
    reportingCategory: 4,
    standardType: "SUPPORTING",
    recurrence: "SPIRAL",
    chapterTier: "B_REINFORCE",
    clauses: [],
    primaryChapter: CHAPTER_BOSTON,
    provenance: teaVerbatim(),
    sourceRefs: [STAAR_COVERAGE, COVERAGE_MAP],
    notes: [
      "CORRECTED 29 Jul: the paraphrase named a fourth clause, " +
        "'entrepreneurship', which is not in TEA's text. TEA's 'including' list " +
        "is exactly three — minimal government regulation, taxation, and " +
        "property rights. An invented clause under an 'including' list is worse " +
        "than a missing one: it manufactures a coverage obligation, and the " +
        "set-1 authoring spec would have been written to satisfy it. Two lesser " +
        "drifts fixed with it: 'minimal regulation' was missing 'government', " +
        "and 'private property rights' added 'private'.",
      "MISSION_SLATE was dropped from sourceRefs: it is the delivery source for " +
        "the concept beneath this standard, not a source for the standard's text " +
        "or designation.",
    ],
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
