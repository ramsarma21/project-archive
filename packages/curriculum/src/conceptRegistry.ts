import { CHAPTER_BOSTON } from "./chapters.js";
import {
  CURRICULUM_MISSION_IDS,
  UnknownMissionError,
  asCurriculumMissionId,
  resolveMissionId,
} from "./missionIds.js";
import { asSeCode, type SeCode } from "./seCode.js";
import {
  asCurriculumConceptId,
  type ConceptOwner,
  type ConceptReviewStatus,
  type ConceptSurface,
  type ConceptTier,
  type CurriculumConceptId,
  type InstructionalConcept,
  type ParentSeStatus,
  type Recurrence,
} from "./types.js";

// ============================================================================
// Instructional-concept registry — the layer beneath the student expectations.
//
// WHY THIS LAYER EXISTS. A student expectation is not an assessable unit.
// 8.4(A) names six independent causes of the Revolution; a student can hold the
// Stamp Act and lack mercantilism, and a per-SE mastery flag cannot say which.
// Every concept below is one proposition a module can teach in under a minute, a
// duel question can ask for, and a mastery record can be kept against.
//
// WHERE THE DEFINITIONS COME FROM. Nothing here is invented curriculum. Each
// definition is drawn from prose that already exists in the repository:
//
//   - the three M1 macros and their Codex cards from Mission-Slate.md 4.7/4.9,
//     which are authored at final quality;
//   - the remaining macros from the valley checks and boss questions authored in
//     Mission-Slate.md sections 5-17 — those questions ARE the assessable
//     propositions, so the concepts are named after what the mission already
//     asks;
//   - the fourteen micros from Micro-Concepts.md, which carries real
//     explanatory prose per concept.
//
// Everything authored here rather than supplied by the owner carries
// `reviewStatus: "DRAFT"`. No entry claims SME approval, because none has it.
//
// PARENT RETAGS. Micro-Concepts.md states that its TEKS tags are draft and asks
// for them to be confirmed; STAAR-Coverage-Map.md instructs that they be
// re-pointed at the specific assessed SEs. Where a draft tag named a strand
// (`8.12`, `8.19`, `8.29`) rather than a student expectation, or named a strand
// outside Boston's target set, the concept carries
// `parentSeStatus: "PROPOSED_RETAG"` and keeps the original tag in
// `sourceDraftTags` so the move is auditable rather than silent.
// ============================================================================

const MICRO_CONCEPTS_DOC = "docs/chapters/boston-1765/Micro-Concepts.md";
const MISSION_SLATE = "docs/chapters/boston-1765/Mission-Slate.md";
const COVERAGE_MAP = "docs/chapters/boston-1765/STAAR-Coverage-Map.md";
const CONCEPT_DELIVERY_MAP = "docs/chapters/boston-1765/Concept-Delivery-Map.md";
const CHAPTER_IDS = "packages/chapter-boston/src/ids.ts";
const CHAPTER_TEKS = "packages/chapter-boston/src/teks.ts";
const CHAPTER_FIELD_IDS = "packages/chapter-boston/src/fieldIds.ts";

/** Chapter prefix used to mint Boston concept ids. */
const BOS = "BOS";

interface ConceptSeed {
  slug: string;
  label: string;
  definition: string;
  parentSe: string;
  clause?: string;
  parentSeStatus?: ParentSeStatus;
  secondary?: string[];
  /**
   * Owning mission as the mission slate names it — `M1`, `M11` — or null when
   * the chapter delivers the concept directly. Canonicalised by `build()` onto
   * the runtime id, so a slug naming no mission throws at import rather than
   * producing a concept no mission-keyed lookup can find.
   */
  mission: string | null;
  surface?: ConceptSurface;
  tier?: ConceptTier;
  recurrence: Recurrence;
  assessable?: boolean;
  cards?: string[];
  review?: ConceptReviewStatus;
  draftTags?: string[];
  refs: string[];
  notes?: string[];
}

function build(seed: ConceptSeed): InstructionalConcept {
  const tier = seed.tier ?? "MACRO";
  const owner: ConceptOwner = {
    chapterId: CHAPTER_BOSTON,
    missionId: seed.mission === null ? null : asCurriculumMissionId(seed.mission),
    surface:
      seed.surface ??
      (seed.mission ? "MISSION_MODULE_AND_DUEL" : "UNALLOCATED"),
  };
  return {
    conceptId: asCurriculumConceptId(`${BOS}.CONCEPT.${seed.slug}.v1`),
    label: seed.label,
    definition: seed.definition,
    parentSe: asSeCode(seed.parentSe),
    parentClauseId: seed.clause ?? null,
    parentSeStatus: seed.parentSeStatus ?? "SOURCE_EXACT",
    secondarySeCodes: (seed.secondary ?? []).map(asSeCode),
    owner,
    tier,
    recurrence: seed.recurrence,
    assessable: seed.assessable ?? tier === "MACRO",
    codexCardIds: seed.cards ?? [],
    reviewStatus: seed.review ?? "DRAFT",
    sourceDraftTags: seed.draftTags ?? [],
    sourceRefs: seed.refs,
    notes: seed.notes ?? [],
  };
}

// ---------------------------------------------------------------------------
// Macro concepts: required learning, on the assessment spine.
// ---------------------------------------------------------------------------

const MACRO_SEEDS: ConceptSeed[] = [
  // -- 8.4(A), all six clauses ---------------------------------------------
  {
    slug: "POSTWAR_REVENUE",
    label: "Postwar revenue policy",
    definition:
      "The war with France ended in 1763 and left Britain carrying its debt, " +
      "so Parliament turned to the colonies for revenue against it. The debt " +
      "came first and the tax is Parliament's response to it, not the reverse.",
    parentSe: "8.4(A)",
    clause: "POSTWAR_POLICY",
    mission: "M1",
    recurrence: "ONCE",
    review: "OWNER_PROVIDED",
    cards: [
      "BOS.MD01.CARD.WAR_DEBT.v1",
      "BOS.MD01.CARD.COLONIAL_REVENUE.v1",
      "BOS.MD01.CARD.DEBT_TO_STAMP_CHAIN.v1",
    ],
    refs: [`${MISSION_SLATE} 4.7, 4.9 pool A`, CHAPTER_IDS, CHAPTER_TEKS],
    notes: [
      "Six duel items are authored against this concept in Mission-Slate 4.9 " +
        "pool A.",
    ],
  },
  {
    slug: "STAMP_SCOPE",
    label: "Stamp Act scope",
    definition:
      "The Stamp Act taxes printed and legal paper from 1 November; ordinary " +
      "goods and private handwritten items are outside it. That boundary is why " +
      "a printer's shop, whose whole trade is printed paper, is the point of " +
      "impact.",
    parentSe: "8.4(A)",
    clause: "STAMP_ACT",
    mission: "M1",
    recurrence: "ONCE",
    review: "OWNER_PROVIDED",
    cards: [
      "BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1",
      "BOS.MD01.CARD.STAMP_DATE.v1",
      "BOS.MD01.CARD.PRINTER_IMPACT.v1",
    ],
    refs: [`${MISSION_SLATE} 4.7, 4.9 pool B`, CHAPTER_IDS, CHAPTER_TEKS],
    notes: [],
  },
  {
    slug: "REPRESENTATION",
    label: "Representation and consent",
    definition:
      "Boston elects its own local assembly but elects no member of Parliament, " +
      "so a tax laid by Parliament is laid by a body the town did not choose. " +
      "The objection is to who laid the tax, not to what it cost.",
    parentSe: "8.4(A)",
    clause: "NO_REPRESENTATION",
    mission: "M1",
    recurrence: "SPIRAL",
    review: "OWNER_PROVIDED",
    cards: [
      "BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1",
      "BOS.MD01.CARD.CONSENT_GROUND.v1",
      "BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1",
    ],
    refs: [`${MISSION_SLATE} 4.7, 4.9 pool C`, CHAPTER_IDS, CHAPTER_TEKS],
    notes: [
      "The one M1 macro the existing registry marks SPIRAL with an Archive " +
        "safety net; consent recurs under 8.15(E) and 8.19(A) later in the chapter.",
    ],
  },
  {
    slug: "PROCLAMATION_1763",
    label: "Proclamation of 1763",
    definition:
      "In 1763 the Crown barred colonial settlement west of the Appalachians, " +
      "so the same postwar policy that produced new taxes also closed land " +
      "colonists expected to claim. It is a cause of the Revolution because it " +
      "is Parliament and the Crown deciding a colonial question without the " +
      "colonies.",
    parentSe: "8.4(A)",
    clause: "PROCLAMATION_1763",
    mission: null,
    surface: "UNALLOCATED",
    recurrence: "ONCE",
    refs: [`${CONCEPT_DELIVERY_MAP} gated-facts table`, CHAPTER_TEKS],
    notes: [
      "GAP: this is a named clause of the chapter's top Readiness standard with " +
        "no mission owner. " +
        CHAPTER_TEKS +
        " marks it SCHEDULED_LATER, " +
        CONCEPT_DELIVERY_MAP +
        " promotes it to a gated Act 2 concept, and no mission in the " +
        "fourteen-mission slate claims it. One of the three must move.",
    ],
  },
  {
    slug: "INTOLERABLE_ACTS",
    label: "Intolerable Acts",
    definition:
      "Parliament answered the destruction of the tea with the Coercive Acts of " +
      "1774 — the Port Act closing Boston's harbour, the Massachusetts " +
      "Government Act, the Administration of Justice Act, and the Quartering " +
      "Act. The closure was meant to isolate Boston and produced colonial unity " +
      "and a Continental Congress instead.",
    parentSe: "8.4(A)",
    clause: "INTOLERABLE_ACTS",
    mission: "M11",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 14`, CHAPTER_TEKS, CONCEPT_DELIVERY_MAP],
    notes: [
      "M11's first valley check distinguishes the four acts from one another, so " +
        "items must be able to separate them rather than treat 'Intolerable Acts' " +
        "as one undifferentiated label.",
    ],
  },
  {
    slug: "MERCANTILISM",
    label: "Mercantilism",
    definition:
      "Under mercantilism colonial trade existed to enrich the mother country, " +
      "so Parliament controlled which goods could move through which channels " +
      "and who could carry them. The colonists' answer was to withhold their " +
      "side of that trade through non-importation.",
    parentSe: "8.4(A)",
    clause: "MERCANTILISM",
    mission: "M11",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 14`, COVERAGE_MAP, CHAPTER_TEKS],
    notes: [
      "The coverage map spreads mercantilism and non-importation across Acts 1-4 " +
        "while the slate assigns the 8.4(A) revisit to M11 only. Act 1 exposure " +
        "currently runs through the NON_IMPORTATION micro rather than a macro.",
    ],
  },

  // -- 8.1(A) ---------------------------------------------------------------
  {
    slug: "REVOLUTION_CAUSE_EFFECT_CHAIN",
    label: "Cause and effect in the revolution era",
    definition:
      "The revolution runs as an ordered chain rather than a set of separate " +
      "incidents: destroyed tea produced the port closure, the closure produced " +
      "a colonial response, and that response produced the Continental Congress. " +
      "Getting the order right is the skill; each link is a cause of the next.",
    parentSe: "8.1(A)",
    mission: "M11",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 14`],
    notes: [],
  },
  {
    slug: "ERA_ARC_1765_TO_1775",
    label: "From a paper tax to a siege",
    definition:
      "The revolutionary era arcs from a 1765 tax on printed paper to a 1775 " +
      "siege of Boston as one connected sequence. A student who can trace that " +
      "chain end to end holds the era's causes and effects, not ten separate " +
      "dates.",
    parentSe: "8.1(A)",
    mission: null,
    surface: "CHAPTER_ASSESSMENT",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 17`],
    notes: [
      "Assessed at the chapter capstone rather than in one mission. M14's final " +
        "open prompt asks it too, even though 8.1(A) is not among M14's assigned " +
        "SEs; that is a cross-mission assessment, not a reassignment.",
    ],
  },

  // -- 8.3(A) ---------------------------------------------------------------
  {
    slug: "TOWN_MEETING_AUTHORITY",
    label: "What a town meeting may lawfully do",
    definition:
      "A New England town meeting is a lawful body of the town's own electors: " +
      "it may deliberate, vote, instruct its representatives, and petition its " +
      "own assembly. Representative government grew in the colonies because " +
      "towns already governed themselves this way before any dispute with " +
      "Parliament.",
    parentSe: "8.3(A)",
    mission: "M8",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 11`, COVERAGE_MAP],
    notes: [
      "M8's packet asks other towns to call their own meetings and reply, not " +
        "to send men or money; the lawful-petition framing is the assessable line.",
    ],
  },

  // -- 8.10(C) --------------------------------------------------------------
  {
    slug: "HARBOR_COMMUNICATION_HUB",
    label: "Harbour and roads as a communication network",
    definition:
      "Boston's harbour and the roads out of it made it the hub through which " +
      "resistance news travelled — coasting sloops, post riders, and carters " +
      "carried the committees' letters. Geography decided which town could " +
      "coordinate the others, which is why closing the port was an attack on " +
      "communication as much as on trade.",
    parentSe: "8.10(C)",
    mission: "M8",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 11`, COVERAGE_MAP],
    notes: [],
  },

  // -- 8.11(A) --------------------------------------------------------------
  {
    slug: "PORT_ECONOMY_DEPENDENCE",
    label: "Boston as a port economy",
    definition:
      "Boston's economy ran on its harbour — shipping, fishing, and the " +
      "carrying trade rather than farmland. That physical dependence is why " +
      "customs duties and enforcement struck this town harder than an inland " +
      "one, and why the town had no other trade to fall back on.",
    parentSe: "8.11(A)",
    mission: "M2",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 5`, COVERAGE_MAP],
    notes: [
      "M2's boss asks what Boston has to trade if not this; the correct answer " +
        "names the port's actual economy.",
    ],
  },

  // -- 8.15(C) --------------------------------------------------------------
  {
    slug: "GRIEVANCE_TO_RIGHT",
    label: "Colonial grievances against Crown enforcement",
    definition:
      "The colonists' concrete grievances were about enforcement, not abstract " +
      "theory: general search warrants that named no house, soldiers quartered " +
      "in the town, trial without a local jury in vice-admiralty courts, and " +
      "taxation without consent. These are the specific complaints later written " +
      "into the Bill of Rights.",
    parentSe: "8.15(C)",
    mission: null,
    surface: "UNALLOCATED",
    recurrence: "SPIRAL",
    refs: [COVERAGE_MAP, `${MISSION_SLATE} 6`],
    notes: [
      "GAP: the slate offers 8.15(C) as M3's one retained concept, but M3's " +
        "assignment is open, so this concept has no mission owner. Its two " +
        "supporting micros (writs of assistance, vice-admiralty courts) are Act 1 " +
        "enrichment and cannot carry a Readiness standard on their own.",
      "Boston must stop at the grievance. The 'how it was addressed in the " +
        "Constitution' half of this SE belongs to a later chapter, so a Boston " +
        "item that asks which amendment fixed it is out of scope.",
    ],
  },

  // -- 8.4(B) ---------------------------------------------------------------
  {
    slug: "ATTUCKS_IDENTITY",
    label: "Crispus Attucks and the town's account",
    definition:
      "Crispus Attucks, a sailor of African and Wampanoag descent, was among " +
      "the five killed on King Street on 5 March 1770. How the town's own " +
      "account named him, and who it counted as one of its own, is part of what " +
      "the Massacre came to mean.",
    parentSe: "8.4(B)",
    mission: "M6",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 9`, COVERAGE_MAP],
    notes: [
      "The slate requires historical review of Attucks's depiction before art. " +
        "The same review should cover item wording.",
    ],
  },
  {
    slug: "WARREN_ADAMS_AUTHORSHIP",
    label: "Warren and Adams in print",
    definition:
      "Mercy Otis Warren wrote and published political satire anonymously " +
      "because attribution would have been ruinous, and Abigail Adams carried " +
      "political argument in private letters. Both are how women shaped the " +
      "resistance through writing rather than through office.",
    parentSe: "8.4(B)",
    mission: "M12",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 15`, COVERAGE_MAP],
    notes: [
      "Scope guard from the slate: 'Remember the Ladies' is 1776 and too late " +
        "for this chapter, so no item may rest on it.",
    ],
  },

  // -- 8.20(B) --------------------------------------------------------------
  {
    slug: "TEA_NONLANDING_RESISTANCE",
    label: "Refusing the landing",
    definition:
      "For twenty days Boston's nightly guard on Griffin's Wharf prevented one " +
      "specific legal act — the landing and customs entry of the tea — rather " +
      "than seizing or damaging it. Resistance began as a lawful refusal, which " +
      "is what makes the later destruction a decision rather than a drift.",
    parentSe: "8.20(B)",
    mission: "M9",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 12`],
    notes: [],
  },
  {
    slug: "DISCIPLINED_CIVIL_DISOBEDIENCE",
    label: "The Tea Party as disciplined civil disobedience",
    definition:
      "On the night of 16 December 1773 roughly a hundred participants " +
      "destroyed the tea and nothing else, in front of thousands of witnesses. " +
      "The restraint is the point: the target was the East India Company's " +
      "monopoly and the Crown's revenue, which is what separates civil " +
      "disobedience from theft from a neighbour.",
    parentSe: "8.20(B)",
    mission: "M10",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 13`, COVERAGE_MAP],
    notes: [],
  },

  // -- 8.21(B) --------------------------------------------------------------
  {
    slug: "PRESS_AS_PUBLIC_RECORD",
    label: "The press as a checkable record",
    definition:
      "A free press does political work by keeping a record others can check: a " +
      "dated deposition with a named witness, circulated to other towns, carries " +
      "weight that rumour or verse cannot. That is why the occupation's conduct " +
      "was published rather than merely complained about.",
    parentSe: "8.21(B)",
    mission: "M5",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 8`, COVERAGE_MAP],
    notes: [],
  },

  // -- 8.23(E) --------------------------------------------------------------
  {
    slug: "WOMENS_ECONOMIC_ACTION",
    label: "Women and the boycott economy",
    definition:
      "Women made the boycott work: spinning meetings produced the homespun " +
      "cloth that replaced British imports, and household tea agreements " +
      "enforced non-consumption. That turned a merchants' policy into an " +
      "economy-wide one, which is a political contribution made through " +
      "economic action.",
    parentSe: "8.23(E)",
    mission: "M12",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 15`, COVERAGE_MAP],
    notes: [],
  },

  // -- 8.4(C) ---------------------------------------------------------------
  {
    slug: "LEXINGTON_CONCORD_TRIGGER",
    label: "Why the regulars marched",
    definition:
      "The regulars marched on 19 April 1775 to seize the colony's military " +
      "stores at Concord and to arrest its leaders. Both sides afterwards " +
      "disputed who fired first at Lexington because the answer decided who had " +
      "begun a war.",
    parentSe: "8.4(C)",
    mission: "M13",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 16`],
    notes: [],
  },
  {
    slug: "APRIL_19_RESULT",
    label: "The result of 19 April 1775",
    definition:
      "The result of 19 April was not a battle won but a war begun: the regulars " +
      "withdrew into Boston and a militia army closed around the town. That " +
      "siege is the situation Washington arrived to command.",
    parentSe: "8.4(C)",
    mission: "M14",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 17`],
    notes: [],
  },

  // -- 8.12(C) --------------------------------------------------------------
  {
    slug: "REGIONAL_RESPONSE_DIFFERENCES",
    label: "Different ports, different answers",
    definition:
      "New York, Philadelphia, and Charleston each met the tea ships " +
      "differently — turning them back, refusing to unload, or landing and " +
      "storing the cargo — because each port's economy and politics differed. " +
      "One imperial policy produced different regional responses.",
    parentSe: "8.12(C)",
    mission: "M10",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 13`],
    notes: [
      "The coverage map notes this standard peaks in a later sectionalism " +
        "chapter, so Boston items should stay at the comparison and not reach " +
        "for nineteenth-century regional economics.",
    ],
  },

  // -- 8.15(A) --------------------------------------------------------------
  {
    slug: "RIGHTS_OF_ENGLISHMEN",
    label: "The rights of Englishmen",
    definition:
      "The colonists argued as Englishmen, not yet as revolutionaries: no " +
      "taxation without consent and trial by jury were rights they claimed from " +
      "Magna Carta and the English Bill of Rights. The early resistance " +
      "therefore demanded existing rights rather than new ones.",
    parentSe: "8.15(A)",
    mission: null,
    surface: "UNALLOCATED",
    recurrence: "SPIRAL",
    refs: [COVERAGE_MAP],
    notes: [
      "GAP: no mission is assigned to 8.15(A). The coverage map's cross-Act note " +
        "says to surface the founding-principles thread in syncs and debriefs " +
        "rather than as a separate errand, which leaves the concept without a " +
        "duel or module home under the restructured mission form.",
    ],
  },

  // -- 8.19(A) --------------------------------------------------------------
  {
    slug: "NATURAL_RIGHTS_GROUND",
    label: "Natural and unalienable rights",
    definition:
      "A natural or unalienable right is one a person holds independently of any " +
      "government's grant, and which therefore cannot be taken away by one. The " +
      "property and consent claims behind Boston's resistance rest on that " +
      "ground rather than on statute.",
    parentSe: "8.19(A)",
    mission: "M9",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 12`, COVERAGE_MAP],
    notes: [],
  },

  // -- 8.10(A) --------------------------------------------------------------
  {
    slug: "ALARM_NETWORK_GEOGRAPHY",
    label: "The alarm network on the map",
    definition:
      "Boston sits on a neck with water on three sides, so both the regulars' " +
      "route out and the alarm riders' route ahead of them were decided by that " +
      "geography. Naming the places along the Charlestown-Lexington-Concord road " +
      "is naming how the warning outran the column.",
    parentSe: "8.10(A)",
    mission: "M13",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 16`],
    notes: [
      "M13's country corridor is this SE's only carrier in the chapter. If the " +
        "corridor is cut, the SE has no home.",
    ],
  },

  // -- 8.12(A) --------------------------------------------------------------
  {
    slug: "NEW_ENGLAND_EXPORTS",
    label: "What New England had to sell",
    definition:
      "New England exported what its own land and water produced — dried fish, " +
      "timber and barrel staves — and sold shipping services, while importing " +
      "British manufactures such as broadcloth. That mix is what distinguishes " +
      "its regional economy from the plantation South.",
    parentSe: "8.12(A)",
    mission: "M2",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 5`],
    notes: [],
  },

  // -- 8.14(A) --------------------------------------------------------------
  {
    slug: "ORGANIZED_FREE_ENTERPRISE",
    label: "Merchants acting as private parties",
    definition:
      "Colonial merchants acted as private owners, not as a government: by " +
      "agreeing among themselves to stop importing British goods they used their " +
      "own property and trade as leverage on Parliament. Resistance to taxation " +
      "plus a claim on private property is the seedbed of the free-enterprise " +
      "argument.",
    parentSe: "8.14(A)",
    mission: "M4",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 7`, COVERAGE_MAP],
    notes: [],
  },

  // -- 8.15(E) --------------------------------------------------------------
  {
    slug: "CONSENT_OF_THE_GOVERNED_SOURCE",
    label: "Where the consent argument comes from",
    definition:
      "The resistance's central line — that lawful authority rests on the " +
      "consent of the governed — is a borrowed idea. Locke supplied consent and " +
      "natural rights and Montesquieu supplied divided power, which is why the " +
      "colonists' case reads as political philosophy rather than as a threat.",
    parentSe: "8.15(E)",
    mission: "M4",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 7`, COVERAGE_MAP],
    notes: [],
  },

  // -- 8.19(C) --------------------------------------------------------------
  {
    slug: "JURY_ROLE_CITIZENSHIP",
    label: "The jury decides, not the street",
    definition:
      "A citizen's responsibility can run against the crowd's wish: guilt is for " +
      "a jury to decide, not for the street. Keeping a trial possible for men " +
      "the town wanted convicted is the responsible act, whatever the verdict " +
      "turns out to be.",
    parentSe: "8.19(C)",
    mission: "M7",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 10`],
    notes: [
      "M7's decisive answer protects the jury's role without asserting the " +
        "soldiers' guilt or innocence, so items must not have a correct answer " +
        "that takes a side on the verdict.",
    ],
  },

  // -- 8.20(A) --------------------------------------------------------------
  {
    slug: "CIVIC_VIRTUE_UNPOPULAR_DEFENSE",
    label: "Civic virtue at a cost",
    definition:
      "John Adams defended the soldiers accused after the Massacre against his " +
      "own town's wishes, because a rule of law that protects only the popular " +
      "side is not one. Civic virtue is holding the principle when it costs you " +
      "standing.",
    parentSe: "8.20(A)",
    mission: "M7",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 10`, COVERAGE_MAP],
    notes: [],
  },

  // -- 8.22(A) --------------------------------------------------------------
  {
    slug: "WASHINGTON_COMMAND_PROBLEM",
    label: "Command as a problem of information",
    definition:
      "Taking command outside a besieged Boston, Washington's first problem was " +
      "information — how many regulars, which batteries, which wharves still " +
      "worked — and his answer was a restrained order rather than an assault. " +
      "Leadership here is judgement under uncertainty, not boldness.",
    parentSe: "8.22(A)",
    mission: "M14",
    recurrence: "SPIRAL",
    refs: [`${MISSION_SLATE} 17`, COVERAGE_MAP],
    notes: [],
  },

  // -- 8.23(B) --------------------------------------------------------------
  {
    slug: "OCCUPATION_WAGE_CONFLICT",
    label: "Soldiers, ropewalks, and day wages",
    definition:
      "Billeted soldiers took day work at the ropewalks for less than the town's " +
      "own labourers would accept, so a crowded port that quartered an army " +
      "produced a wage conflict between working men. That structural friction, " +
      "not any single insult, is what made the Massacre likely.",
    parentSe: "8.23(B)",
    mission: "M5",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 8`, COVERAGE_MAP],
    notes: [],
  },
  {
    slug: "CROWD_COMPOSITION_NOT_MOB",
    label: "Who was actually on King Street",
    definition:
      "The crowd on King Street was made of the town's working people — " +
      "dockworkers, ropemakers, apprentices, and sailors. Calling it a mob was a " +
      "claim about who counted rather than a description, which is why both sides " +
      "argued about the crowd's composition afterwards.",
    parentSe: "8.23(B)",
    secondary: ["8.21(A)"],
    mission: "M6",
    recurrence: "ONCE",
    refs: [`${MISSION_SLATE} 9`],
    notes: [],
  },
];

// ---------------------------------------------------------------------------
// Micro concepts: Tier-2 enrichment. Never gates, sampled only when the student
// actually engaged the surface that teaches them.
// ---------------------------------------------------------------------------

const MICRO_DEFAULTS = {
  tier: "MICRO" as ConceptTier,
  assessable: false,
  recurrence: "ONCE" as Recurrence,
  mission: null,
  surface: "ACT1_REACTIVE_WORLD" as ConceptSurface,
};

const MICRO_DELIVERY_NOTE =
  "Delivery surfaces are Day-1 beats (focus-reads, side jobs, NPC exchanges) " +
  "that the mission restructure has not remapped. The concept is intact; where " +
  "it is reached from is not.";

const STRAND_TAG_NOTE = (strandTag: string, why: string) =>
  `Draft tag ${strandTag} is not a student expectation — ${why}`;

const MICRO_SEEDS: ConceptSeed[] = [
  {
    ...MICRO_DEFAULTS,
    slug: "SALUTARY_NEGLECT_END",
    label: "The end of salutary neglect",
    definition:
      "Before 1763 Britain enforced its colonial trade laws loosely. After the " +
      "war it began enforcing and taxing directly, and that change of habit is " +
      "what stung as much as any single duty.",
    parentSe: "8.4(A)",
    clause: "POSTWAR_POLICY",
    draftTags: ["8.4(A) causes of the American Revolution"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS],
    notes: [MICRO_DELIVERY_NOTE],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "PORT_TOWN_BOSTON",
    label: "Boston as a port town",
    definition:
      "Boston's economy ran on its harbour and shipping, so Crown trade duties " +
      "and customs enforcement hit this town harder than most.",
    parentSe: "8.11(A)",
    parentSeStatus: "PROPOSED_RETAG",
    secondary: ["8.4(A)"],
    draftTags: ["8.12 economic patterns", "8.4(A)"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS, COVERAGE_MAP],
    notes: [
      MICRO_DELIVERY_NOTE,
      STRAND_TAG_NOTE(
        "8.12",
        "the assessed standard for physical geography driving economic activity is 8.11(A).",
      ),
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "HARD_COIN_SCARCITY",
    label: "Scarcity of hard coin",
    definition:
      "Hard coin was scarce in the colonies and the stamp duties had to be paid " +
      "in it, which squeezed people who otherwise traded in paper and credit.",
    parentSe: "8.12(A)",
    parentSeStatus: "PROPOSED_RETAG",
    secondary: ["8.4(A)"],
    draftTags: ["8.12", "8.13 economics"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS],
    notes: [
      MICRO_DELIVERY_NOTE,
      STRAND_TAG_NOTE(
        "8.13",
        "strand 8.13 is the Industrial Revolution and the War of 1812, which the " +
          "coverage map places outside Boston's era entirely. Retagged to 8.12(A) " +
          "as the nearest in-scope economics standard; this one needs SME " +
          "confirmation more than any other micro.",
      ),
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "PRINTERS_ROLE",
    label: "The printers' stake",
    definition:
      "The tax fell directly on newspapers, pamphlets, and legal paper, so " +
      "printers had a personal stake in the Act and became its loudest opponents " +
      "in print.",
    parentSe: "8.4(A)",
    clause: "STAMP_ACT",
    secondary: ["8.21(B)"],
    draftTags: ["8.4(A)", "8.29 primary-source analysis"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS],
    notes: [
      MICRO_DELIVERY_NOTE,
      STRAND_TAG_NOTE(
        "8.29",
        "strand 8.29 is a social-studies-skills strand and is not in the assessed " +
          "target set; the press half of this concept is carried as a secondary " +
          "tag on 8.21(B) instead.",
      ),
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "VICE_ADMIRALTY_COURTS",
    label: "Vice-admiralty courts",
    definition:
      "Accused Stamp Act violators could be tried in vice-admiralty courts, " +
      "before a judge and with no jury, which colonists read as stripping a " +
      "basic English right.",
    parentSe: "8.15(C)",
    parentSeStatus: "PROPOSED_RETAG",
    secondary: ["8.4(A)"],
    draftTags: ["8.4(A) causes", "8.19 rights/citizenship"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS, COVERAGE_MAP],
    notes: [
      MICRO_DELIVERY_NOTE,
      STRAND_TAG_NOTE(
        "8.19",
        "the coverage map assigns trial without jury and vice-admiralty courts to " +
          "8.15(C) colonial grievances.",
      ),
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "STAMP_WHAT_COUNTS",
    label: "What the stamp was required on",
    definition:
      "The stamp was required on printed and official paper — newspapers, deeds, " +
      "court writs, licences, playing cards — and not on private letters or " +
      "ordinary goods. The boundary, not the definition, is the teaching point.",
    parentSe: "8.4(A)",
    clause: "STAMP_ACT",
    draftTags: ["8.4(A)"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS],
    notes: [
      MICRO_DELIVERY_NOTE,
      "Micro-Concepts.md open question 2 asks whether this should stay a " +
        "distinct micro or fold into the STAMP_SCOPE macro's demonstration. It " +
        "is kept distinct here because it teaches the boundary rather than the " +
        "definition, but the two are one SME decision apart.",
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "ANDREW_OLIVER",
    label: "Andrew Oliver",
    definition:
      "Andrew Oliver was appointed to distribute the stamps in Massachusetts. " +
      "The crowd of 14 August hung and burned his effigy to force him out, and " +
      "he resigned publicly the next day.",
    parentSe: "8.4(B)",
    draftTags: ["8.4(B) roles of significant individuals"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS],
    notes: [
      MICRO_DELIVERY_NOTE,
      "Oliver appears in neither of the repository's two partial lists of the " +
        "individuals 8.4(B) enumerates, so he sits under the SE as an " +
        "unenumerated individual the chapter teaches. Harmless for a micro; it " +
        "would matter if he were promoted to a gated concept.",
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "LIBERTY_TREE",
    label: "The Liberty Tree",
    definition:
      "The great elm where the protest gathered became known as the Liberty " +
      "Tree and stayed the movement's standing rallying point and symbol.",
    parentSe: "8.4(A)",
    clause: "NO_REPRESENTATION",
    draftTags: ["8.4(A)", "8.15 symbols/citizenship"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS],
    notes: [
      MICRO_DELIVERY_NOTE,
      STRAND_TAG_NOTE(
        "8.15",
        "strand 8.15 is historic documents, grievances, and political " +
          "philosophers, not symbols and citizenship; the draft tag describes a " +
          "strand that does not exist. The 8.4(A) half of the draft tag is kept.",
      ),
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "LOYAL_NINE",
    label: "The Loyal Nine",
    definition:
      "The protest was planned, not spontaneous: a small group of Boston " +
      "tradesmen known as the Loyal Nine organized the 14 August demonstration " +
      "and were an early nucleus of the Sons of Liberty.",
    parentSe: "8.4(B)",
    draftTags: ["8.4(B) significant individuals/groups"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS],
    notes: [MICRO_DELIVERY_NOTE],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "EFFIGY_PROTEST",
    label: "Effigy protest as political theatre",
    definition:
      "Hanging, parading, and burning an effigy was a common and deliberately " +
      "theatrical form of eighteenth-century crowd protest, meant to shame an " +
      "official in public and usually stopping short of killing anyone.",
    parentSe: "8.4(A)",
    clause: "NO_REPRESENTATION",
    draftTags: ["8.4(A)", "8.29 analysis (forms of protest)"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS],
    notes: [
      MICRO_DELIVERY_NOTE,
      STRAND_TAG_NOTE("8.29", "it is a skills strand outside the assessed target set."),
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "NON_IMPORTATION",
    label: "Non-importation",
    definition:
      "Colonists fought back economically as well as politically: merchants " +
      "agreed to stop importing British goods so that Britain's own merchants " +
      "would pressure Parliament.",
    parentSe: "8.4(A)",
    clause: "MERCANTILISM",
    secondary: ["8.12(A)"],
    draftTags: ["8.4(A)", "8.12 economics"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS],
    notes: [
      MICRO_DELIVERY_NOTE,
      "Micro-Concepts.md open question 3 flags the timing: the tactic matured " +
        "through 1767-70, so 1765 framing must stay at 'merchants began agreeing'.",
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "NEWS_NETWORKS",
    label: "Informal news networks",
    definition:
      "News and argument moved through informal networks of riders, printers, " +
      "and taverns well before any formal committee existed; those networks are " +
      "the seedbed of the committees of correspondence.",
    parentSe: "8.10(C)",
    parentSeStatus: "PROPOSED_RETAG",
    secondary: ["8.4(A)"],
    draftTags: ["8.4(A)", "8.29 communication of information"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS, COVERAGE_MAP],
    notes: [
      MICRO_DELIVERY_NOTE,
      STRAND_TAG_NOTE(
        "8.29",
        "the coverage map assigns communication networks and committees of " +
          "correspondence to 8.10(C).",
      ),
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "WRITS_OF_ASSISTANCE",
    label: "Writs of assistance",
    definition:
      "Customs officers could use writs of assistance — open-ended general " +
      "search warrants that named no person and no house and did not expire — " +
      "to search homes and shops. The objection was to the power to search, not " +
      "to any one search.",
    parentSe: "8.15(C)",
    parentSeStatus: "PROPOSED_RETAG",
    secondary: ["8.4(A)"],
    draftTags: ["8.4(A)", "8.19 rights/citizenship"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS, COVERAGE_MAP],
    notes: [
      MICRO_DELIVERY_NOTE,
      STRAND_TAG_NOTE(
        "8.19",
        "the coverage map assigns writs of assistance to 8.15(C) colonial grievances.",
      ),
    ],
  },
  {
    ...MICRO_DEFAULTS,
    slug: "LOYALIST_VIEW",
    label: "The Loyalist view",
    definition:
      "Not everyone agreed. Loyalists held that Parliament had lawful authority " +
      "over the colonies and that crowd action was dangerous and illegal; " +
      "colonial society was divided, and the resistance was contested rather " +
      "than unanimous.",
    parentSe: "8.21(A)",
    parentSeStatus: "PROPOSED_RETAG",
    secondary: ["8.4(A)"],
    draftTags: ["8.4(A) multiple perspectives", "8.29 point of view"],
    refs: [MICRO_CONCEPTS_DOC, CHAPTER_FIELD_IDS, COVERAGE_MAP],
    notes: [
      MICRO_DELIVERY_NOTE,
      STRAND_TAG_NOTE(
        "8.29",
        "the coverage map assigns Patriot-versus-Loyalist points of view to 8.21(A).",
      ),
      "This is currently the only concept of any tier beneath 8.21(A), a Tier A " +
        "must-own standard. An enrichment micro cannot carry it.",
    ],
  },
];

const ALL_SEEDS = [...MACRO_SEEDS, ...MICRO_SEEDS];

export const CONCEPTS: ReadonlyMap<CurriculumConceptId, InstructionalConcept> =
  new Map(ALL_SEEDS.map(build).map((concept) => [concept.conceptId, concept]));

export const ALL_CONCEPTS: readonly InstructionalConcept[] = [
  ...CONCEPTS.values(),
];

export function getConcept(
  conceptId: CurriculumConceptId,
): InstructionalConcept | undefined {
  return CONCEPTS.get(conceptId);
}

/** Mint a Boston concept id from a slug. Throws on a malformed slug. */
export function bostonConceptId(slug: string): CurriculumConceptId {
  return asCurriculumConceptId(`${BOS}.CONCEPT.${slug}.v1`);
}

/** Concepts whose parent is this SE, macros first. */
export function conceptsForSe(code: SeCode): InstructionalConcept[] {
  return ALL_CONCEPTS.filter((c) => c.parentSe === code).sort((a, b) =>
    a.tier === b.tier ? a.label.localeCompare(b.label) : a.tier === "MACRO" ? -1 : 1,
  );
}

/**
 * Concepts a mission owns.
 *
 * THROWS `UnknownMissionError` RATHER THAN RETURNING AN EMPTY LIST. This is the
 * function the mission-id divergence was waiting behind: the slate keyed its
 * missions `M1`..`M14`, the runtime asks with `PA.SEA01.CH02.BOSTON.MD01`, and
 * the filter matched no concept and answered "this mission teaches nothing". A
 * mission that teaches nothing is a real state — M3's assignment is
 * deliberately unsettled — so an empty answer is not distinguishable from a
 * spelling nobody caught, which is exactly why the spelling has to be refused
 * separately.
 *
 * The id is canonicalised rather than compared raw, so the slate labels and the
 * `.v1` content form reach the same concepts instead of matching none of them. A
 * caller whose mission id came from a request checks `isCurriculumMissionId`
 * first and answers 404.
 */
export function conceptsForMission(missionId: string): InstructionalConcept[] {
  const mission = resolveMissionId(missionId);
  if (mission === null) {
    throw new UnknownMissionError(missionId, [...CURRICULUM_MISSION_IDS]);
  }
  return ALL_CONCEPTS.filter((c) => c.owner.missionId === mission);
}
