import type {
  AssessmentItem,
  AssessmentQuestionBank,
} from "@pa/contracts";
import { MICRO_CONCEPT_IDS } from "../fieldIds.js";
import {
  CP1_CHECKPOINT_ID,
  CP1_REQUIRED_MACROS,
} from "./cp1Ids.js";

// ============================================================================
// Owner-provided STAAR-style assessment content (ingested 2026-07-23).
//
// These are REAL product-owner-supplied items (not engineering fixtures):
// verbatim stems/options/rationales, marked OWNER_PROVIDED. This is NOT an
// SME/TEKS sign-off — TEKS tags are the obvious mapping where one exists and a
// review-pending placeholder otherwise.
//
// Era scoping (Archive assessment invariant): CP1 = Boston Day 1, 1765, and
// may select ONLY era-appropriate items. Two owner items are 1765-scope and
// become production CP1 macro items (actScope = [CP1]):
//   Q5  -> RCC.DEBT_POLICY_INTRO       (1764-1767 revenue acts / war debt)
//   Q24 -> RCC.REPRESENTATION_CAUSE    (1765 Virginia Stamp Act Resolutions)
// The remaining post-1765 (1770s-1790s) items are banked toward FUTURE
// checkpoints with lineage tags; their actScope excludes CP1 so CP1 selection
// and the CP1 validator requirements exclude them.
//
// RCC.STAMP_INTERNAL_INTRO still has NO owner item — production CP1 therefore
// stays blocked on that one macro (surfaced by the validator / CLI report).
// ============================================================================

const OWNER_PROVENANCE = "user-supplied 2026-07-23";
const TEKS_PLACEHOLDER = "TEKS.PENDING_SME_REVIEW";
// 1765-scope items eligible for CP1 selection.
const CP1_SCOPE: readonly string[] = [CP1_CHECKPOINT_ID];
// Post-1765 items banked for later Boston checkpoints (ids TBD); excluded from
// CP1 selection/validation by not listing the CP1 checkpoint id.
const FUTURE_SCOPE: readonly string[] = ["BOS.POST_CP1"];

// The owner numbered items F/G/H/J or A/B/C/D; option ids preserve that letter
// so ids stay keyed to the owner's numbering. Stems/options/rationales are
// byte-exact from the product owner; do not edit wording.
const OWNER_ITEMS: AssessmentItem[] = [
  // -- CP1 PRODUCTION MACROS (1765-scope) -----------------------------------
  {
    itemId: "BANK.BOSTON.USER.Q05.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: CP1_REQUIRED_MACROS[0], // RCC.DEBT_POLICY_INTRO
    teksTags: ["8.4(A):POSTWAR_POLICY"],
    era: "1764-1767",
    actScope: CP1_SCOPE,
    conceptLineage: ["RCC.DEBT_POLICY_INTRO"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "1764 Sugar Act / 1765 Stamp Act / 1767 Townshend Acts — primary reason Parliament passed these?",
    options: [
      { optionId: "A", text: "promote colonial cottage industries", rationale: "not for cottage industries." },
      { optionId: "B", text: "encourage foreign trade", rationale: "not to encourage trade; Britain was not a foreign country to the colonies." },
      { optionId: "C", text: "recover the cost of defending the colonies", rationale: "these acts taxed colonial goods to help pay expenses from the French and Indian War and continued protection of British claims in America." },
      { optionId: "D", text: "fund new colonies", rationale: "funded existing colonies' defense costs, not new colonies." },
    ],
    correctOptionId: "C",
  },
  {
    itemId: "BANK.BOSTON.USER.Q24.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: CP1_REQUIRED_MACROS[2], // RCC.REPRESENTATION_CAUSE
    teksTags: ["8.4(A):NO_REPRESENTATION"],
    era: "1765",
    actScope: CP1_SCOPE,
    conceptLineage: ["RCC.REPRESENTATION_CAUSE"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Virginia Stamp Act Resolutions, May 30, 1765 (\"taxation of the people by themselves, or by persons chosen by themselves... the only security against a burdensome taxation\"). Why adopted?",
    options: [
      { optionId: "F", text: "upset by punishment after the Boston Tea Party", rationale: "Tea Party was 1773, years later." },
      { optionId: "G", text: "to address causes of the Boston Massacre", rationale: "Boston Massacre was 1770, years later." },
      { optionId: "H", text: "opposed to colonial laws being created only by Parliament", rationale: "colonists believed as Englishmen they had the right to political representation; they could not elect members of Parliament; the resolutions expressed opposition to taxation without representation." },
      { optionId: "J", text: "wanted to expand royal governors' powers", rationale: "adopted to oppose taxation without representation, not expand governor powers." },
    ],
    correctOptionId: "H",
  },

  // -- POST-1765 items banked for FUTURE checkpoints ------------------------
  {
    itemId: "BANK.BOSTON.USER.Q04.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.INTOLERABLE_ACTS_RESPONSE",
    teksTags: ["8.4(A):INTOLERABLE_ACTS"],
    era: "1774",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["8.4(A):INTOLERABLE_ACTS", "FIRST_CONTINENTAL_CONGRESS"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "How did the American colonies react to enforcement of the Intolerable Acts?",
    options: [
      { optionId: "F", text: "collecting funds to pay for the destroyed tea", rationale: "paying for the tea was Parliament's requirement in the Intolerable Acts; colonists resisted it." },
      { optionId: "G", text: "sending ambassadors to France for military aid", rationale: "in 1774 colonists were not seeking independence; Franklin's France trip came years after the Revolution began." },
      { optionId: "H", text: "placing a tax on all goods imported from Great Britain", rationale: "colonies lacked power to tax British imports; they boycotted instead." },
      { optionId: "J", text: "holding the First Continental Congress to discuss unified resistance", rationale: "After Parliament passed the Intolerable Acts in 1774, delegates met in the First Continental Congress and organized unified resistance." },
    ],
    correctOptionId: "J",
  },
  {
    itemId: "BANK.BOSTON.USER.Q22.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.QUARTERING_THIRD_AMENDMENT",
    teksTags: [TEKS_PLACEHOLDER],
    era: "1789-1791",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["QUARTERING", "BILL_OF_RIGHTS"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Why was the Third Amendment prohibiting the quartering of troops added?",
    options: [
      { optionId: "F", text: "to address colonial treatment by the British military", rationale: "Parliament's Quartering Act forced colonists to provision British troops; listed as a grievance in the Declaration; the Founders prohibited it via the Third Amendment." },
      { optionId: "G", text: "to maintain control over members of the British military", rationale: "by 1789 the US was independent, no British troops stationed." },
      { optionId: "H", text: "to ensure the national government could pay for the military", rationale: "the amendment protects citizens from housing soldiers, not military funding." },
      { optionId: "J", text: "to reinforce the need for state militias", rationale: "it did not impact state militias; it protected citizens from an egregious British practice." },
    ],
    correctOptionId: "F",
  },
  {
    itemId: "BANK.BOSTON.USER.Q23.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.DECLARATION_NATURAL_RIGHTS",
    teksTags: [TEKS_PLACEHOLDER],
    era: "1776",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["DECLARATION_OF_INDEPENDENCE", "NATURAL_RIGHTS"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Why is Jefferson's writing of the Declaration considered among his greatest contributions?",
    options: [
      { optionId: "A", text: "outlined the structure for a new government", rationale: "the Articles of Confederation provided government structure." },
      { optionId: "B", text: "helped define rights that would defeat tyranny", rationale: "Jefferson emphasized unalienable rights; natural rights formed the ideological basis of the fight; he listed grievances showing violations." },
      { optionId: "C", text: "developed a military plan to defeat the British", rationale: "military strategy was Washington et al." },
      { optionId: "D", text: "outlined a strategy for acquiring the Louisiana Territory", rationale: "the Louisiana Purchase was 1803; in 1776 his focus was independence." },
    ],
    correctOptionId: "B",
  },
  {
    itemId: "BANK.BOSTON.USER.Q26.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.NATURAL_RIGHTS_REPRESENTATION",
    teksTags: ["8.4(A):NO_REPRESENTATION"],
    era: "1772",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["RCC.REPRESENTATION_CAUSE", "NATURAL_RIGHTS"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Samuel Adams 1772 natural-rights excerpt (life, liberty, property, and the right to defend them). Belief in these rights helped lead to",
    options: [
      { optionId: "F", text: "establishment of royal courts", rationale: "colonists could not establish royal courts and wanted peer courts." },
      { optionId: "G", text: "growth of representative government", rationale: "colonists believed representation in government best protected life/liberty/property; Jefferson later addressed these ideas in the Declaration." },
      { optionId: "H", text: "implementation of the mercantile system", rationale: "mercantilism served the mother country; the causality runs the other way." },
      { optionId: "J", text: "abolishment of indentured servitude", rationale: "liberty was not applied to all; unfree labor persisted until the Thirteenth Amendment." },
    ],
    correctOptionId: "G",
  },
  {
    itemId: "BANK.BOSTON.USER.Q12.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.VALLEY_FORGE_WINTER",
    teksTags: [TEKS_PLACEHOLDER],
    era: "1777",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["VALLEY_FORGE", "CONTINENTAL_ARMY"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Washington's Dec 23, 1777 letter (starve, dissolve, or disperse). Prompted by?",
    options: [
      { optionId: "F", text: "shortage of soldiers at the siege of Yorktown", rationale: "Yorktown was 1781." },
      { optionId: "G", text: "casualties at Bunker Hill", rationale: "Bunker Hill was June 1775." },
      { optionId: "H", text: "low morale after the British captured New York City", rationale: "New York fell summer 1776; the letter is about Valley Forge." },
      { optionId: "J", text: "concern for the troops during the winter at Valley Forge", rationale: "written at Valley Forge; the army lacked clothing/supplies for the harsh winter." },
    ],
    correctOptionId: "J",
  },
  {
    itemId: "BANK.BOSTON.USER.Q18.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.CIVIL_MILITARY_SUPREMACY",
    teksTags: [TEKS_PLACEHOLDER],
    era: "1789 (constitutional)",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["DECLARATION_GRIEVANCES", "US_CONSTITUTION"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "\"He has affected to render the Military independent of and superior to the Civil power.\" How addressed?",
    options: [
      { optionId: "F", text: "making the president commander in chief", rationale: "Article II Section 2 makes the elected civilian president commander in chief, placing the military under civil power." },
      { optionId: "G", text: "oath of office requirements", rationale: "the grievance concerns control of the military, not oaths, treaties, or recruitment." },
      { optionId: "H", text: "treaty powers", rationale: "the grievance concerns control of the military, not oaths, treaties, or recruitment." },
      { optionId: "J", text: "draft powers", rationale: "the grievance concerns control of the military, not oaths, treaties, or recruitment." },
    ],
    correctOptionId: "F",
  },
  {
    itemId: "BANK.BOSTON.USER.Q21.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.CONTINENTAL_NAVY",
    teksTags: [TEKS_PLACEHOLDER],
    era: "1776-1783",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["REVOLUTIONARY_WAR", "JOHN_PAUL_JONES"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Why is John Paul Jones the \"Father of the American Navy\"?",
    options: [
      { optionId: "A", text: "won naval victories against the British in the Revolution", rationale: "captain from 1776 (Providence), captured many British vessels, conducted raids." },
      { optionId: "B", text: "led the assault against the Barbary States", rationale: "Revolution, not Barbary Wars." },
      { optionId: "C", text: "commanded the first steam-powered warship", rationale: "first steam warship was War of 1812." },
      { optionId: "D", text: "served as first Secretary of the Navy", rationale: "Benjamin Stoddart was first Navy secretary (1789 per source)." },
    ],
    correctOptionId: "A",
  },
  {
    itemId: "BANK.BOSTON.USER.Q31.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.UNALIENABLE_RIGHTS",
    teksTags: [TEKS_PLACEHOLDER],
    era: "1776",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["DECLARATION_OF_INDEPENDENCE", "NATURAL_RIGHTS"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Which is an example of an unalienable right from the Declaration?",
    options: [
      { optionId: "A", text: "Equality in education", rationale: "not among the three listed." },
      { optionId: "B", text: "Wealth by skills", rationale: "not among the three listed." },
      { optionId: "C", text: "Happiness — people can do lawful things they enjoy", rationale: "unalienable rights belong to all and cannot be taken away; Jefferson lists life, liberty, pursuit of happiness." },
      { optionId: "D", text: "Patriotism — joining armed forces", rationale: "not among the three listed." },
    ],
    correctOptionId: "C",
  },
  {
    itemId: "BANK.BOSTON.USER.Q38.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.FIRST_CONTINENTAL_CONGRESS_GRIEVANCES",
    teksTags: ["8.4(A):INTOLERABLE_ACTS"],
    era: "1774",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["8.4(A):INTOLERABLE_ACTS", "FIRST_CONTINENTAL_CONGRESS"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Four 1774 headlines (harbor closure, dissolved legislature, trials in England, quartering). Immediate colonial response?",
    options: [
      { optionId: "F", text: "First Continental Congress declared war", rationale: "no immediate declaration of war; the Olive Branch Petition followed in 1775." },
      { optionId: "G", text: "adopted the Articles of Confederation", rationale: "Articles written 1777." },
      { optionId: "H", text: "First Continental Congress sent a list of grievances to King George III", rationale: "the headlines describe the Intolerable Acts (punishment for the Tea Party, an act of civil disobedience); the 1774 First Continental Congress in Philadelphia sent a petition of grievances to the king." },
      { optionId: "J", text: "adopted the Bill of Rights", rationale: "Bill of Rights 1791." },
    ],
    correctOptionId: "H",
  },
  {
    itemId: "BANK.BOSTON.USER.Q30.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.TRIAL_BY_JURY_SIXTH_AMENDMENT",
    teksTags: [TEKS_PLACEHOLDER],
    era: "1789-1791",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["DECLARATION_GRIEVANCES", "BILL_OF_RIGHTS"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Which Declaration grievance is addressed by the Sixth Amendment?",
    options: [
      { optionId: "F", text: "dissolved Representative Houses", rationale: "the amendment addresses rights of the accused, not legislatures, judiciary establishment, or quartering." },
      { optionId: "G", text: "\"For depriving us in many cases, of the benefits of Trial by Jury\"", rationale: "the Sixth Amendment guarantees a speedy public trial by an impartial jury." },
      { optionId: "H", text: "obstructed judiciary laws", rationale: "the amendment addresses rights of the accused, not legislatures, judiciary establishment, or quartering." },
      { optionId: "J", text: "quartering troops", rationale: "the amendment addresses rights of the accused, not legislatures, judiciary establishment, or quartering." },
    ],
    correctOptionId: "G",
  },
  {
    itemId: "BANK.BOSTON.USER.Q35.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.YORKTOWN_TREATY_OF_PARIS",
    teksTags: [TEKS_PLACEHOLDER],
    era: "1781-1783",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["YORKTOWN", "TREATY_OF_PARIS"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Result of Cornwallis's surrender at Yorktown?",
    options: [
      { optionId: "A", text: "France recognized independence and declared war", rationale: "France's recognition followed Saratoga (1777)." },
      { optionId: "B", text: "Second Continental Congress agreed to the Articles", rationale: "Articles agreed 1777." },
      { optionId: "C", text: "Great Britain and the United States signed the Treaty of Paris", rationale: "the 1781 defeat led to peace talks; the 1783 Treaty of Paris ended the war." },
      { optionId: "D", text: "Olive Branch Petition sent", rationale: "Olive Branch was 1775." },
    ],
    correctOptionId: "C",
  },
  {
    itemId: "BANK.BOSTON.USER.Q43.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.FOUNDER_JOHN_ADAMS",
    teksTags: [TEKS_PLACEHOLDER],
    era: "1770-1797",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["JOHN_ADAMS", "BOSTON_MASSACRE", "TREATY_OF_PARIS"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Responsibility: Second President | Courage: Defending Redcoats at the Boston Massacre Trial | Perseverance: Negotiating the Treaty of Paris. Which Founding Father?",
    options: [
      { optionId: "A", text: "John Adams", rationale: "Adams was second president, defended British soldiers after the Boston Massacre, helped negotiate the Treaty of Paris." },
      { optionId: "B", text: "Benjamin Franklin", rationale: "the list refers to Adams." },
      { optionId: "C", text: "James Madison", rationale: "the list refers to Adams." },
      { optionId: "D", text: "John Jay", rationale: "the list refers to Adams." },
    ],
    correctOptionId: "A",
  },
  {
    itemId: "BANK.BOSTON.USER.Q39.v1",
    itemVersion: "v1",
    tier: "MACRO",
    conceptId: "RCL.BOSTON_TEA_PARTY",
    teksTags: ["8.4(A):NO_REPRESENTATION"],
    era: "1773",
    actScope: FUTURE_SCOPE,
    conceptLineage: ["RCC.REPRESENTATION_CAUSE", "BOSTON_TEA_PARTY"],
    provenance: OWNER_PROVENANCE,
    approvalStatus: "OWNER_PROVIDED",
    difficulty: "ON_LEVEL",
    stem: "Boston Gazette 1773 excerpt (342 chests of tea emptied into the sea). Actions carried out to",
    options: [
      { optionId: "A", text: "encourage war between England and France", rationale: "not meant to encourage another England-France war." },
      { optionId: "B", text: "protest British taxation policies", rationale: "the Boston Tea Party protested taxation without representation; the tea tax came from a Parliament with no colonial representatives." },
      { optionId: "C", text: "end disagreements with French traders", rationale: "no French traders involved." },
      { optionId: "D", text: "protest a ban on selling beverages", rationale: "the Tea Act granted a monopoly and maintained a tax; no beverage ban." },
    ],
    correctOptionId: "B",
  },
];

// Production CP1 bank. Now carries the owner-provided items: two 1765-scope
// macros (DEBT_POLICY, REPRESENTATION) plus post-1765 items banked for future
// checkpoints (era-scoped out of CP1). The bank is approved-for-use
// (OWNER_PROVIDED) but production CP1 selection remains BLOCKED because there
// is still no owner item for RCC.STAMP_INTERNAL_INTRO (see validator report).
export const CP1_PRODUCTION_BANK: AssessmentQuestionBank = {
  bankId: "BOS.ACT01.CP1.PRODUCTION",
  bankVersion: "0.1.0-owner.1",
  approvalStatus: "OWNER_PROVIDED",
  items: OWNER_ITEMS,
};

const macroItems: AssessmentItem[] = [
  {
    itemId: "BOS.CP1.MACRO.DEBT_POLICY.01",
    itemVersion: "dev.1",
    tier: "MACRO",
    conceptId: CP1_REQUIRED_MACROS[0],
    teksTags: [],
    stem: "Why did Parliament seek new revenue from the colonies after the French and Indian War?",
    options: [
      { optionId: "WAR_DEBT", text: "To help pay war debt and imperial costs" },
      { optionId: "BOSTON_GUILD", text: "To fund Boston's printers' guild" },
      { optionId: "COLONIAL_VOTE", text: "Because colonial assemblies requested it" },
    ],
    correctOptionId: "WAR_DEBT",
    approvalStatus: "DRAFT",
    difficulty: "ON_LEVEL",
  },
  {
    itemId: "BOS.CP1.MACRO.STAMP_SCOPE.01",
    itemVersion: "dev.1",
    tier: "MACRO",
    conceptId: CP1_REQUIRED_MACROS[1],
    teksTags: [],
    stem: "What made the Stamp Act different from a fee charged by one shop?",
    options: [
      { optionId: "CROWN_INTERNAL", text: "It was a Parliament-imposed internal tax on many printed papers" },
      { optionId: "SHOP_PRICE", text: "It was a price chosen by Boston shopkeepers" },
      { optionId: "PORT_ONLY", text: "It applied only to imported cargo at the harbor" },
    ],
    correctOptionId: "CROWN_INTERNAL",
    approvalStatus: "DRAFT",
    difficulty: "ON_LEVEL",
  },
  {
    itemId: "BOS.CP1.MACRO.REPRESENTATION.01",
    itemVersion: "dev.1",
    tier: "MACRO",
    conceptId: CP1_REQUIRED_MACROS[2],
    teksTags: [],
    stem: "Why did many colonists object to Parliament's new taxes?",
    options: [
      { optionId: "NO_VOICE", text: "They had no elected representatives voting in Parliament" },
      { optionId: "ALL_TAX", text: "They believed every kind of tax was always illegal" },
      { optionId: "NO_PAPER", text: "They wanted newspapers to stop printing political arguments" },
    ],
    correctOptionId: "NO_VOICE",
    approvalStatus: "DRAFT",
    difficulty: "ON_LEVEL",
  },
];

const microCopy: Record<
  keyof typeof MICRO_CONCEPT_IDS,
  { stem: string; correct: string; distractors: [string, string] }
> = {
  SALUTARY_NEGLECT_END: {
    stem: "What changed as Britain's earlier loose colonial oversight ended?",
    correct: "Imperial enforcement and revenue collection tightened",
    distractors: ["Colonial ports closed permanently", "Parliament gave colonies seats"],
  },
  PORT_TOWN_BOSTON: {
    stem: "Why did Boston's harbor matter to the town's daily life?",
    correct: "Trade, work, goods, and news moved through the port",
    distractors: ["It isolated Boston from Atlantic trade", "Only royal officials could use it"],
  },
  HARD_COIN_SCARCITY: {
    stem: "What did a shortage of hard coin make difficult?",
    correct: "Paying taxes and settling trade in specie",
    distractors: ["Printing any newspaper", "Growing food outside Boston"],
  },
  PRINTERS_ROLE: {
    stem: "How did printers shape political action?",
    correct: "They circulated arguments, notices, and news",
    distractors: ["They voted in Parliament for colonists", "They commanded customs patrols"],
  },
  VICE_ADMIRALTY_COURTS: {
    stem: "What was distinctive about vice-admiralty courts?",
    correct: "They handled maritime enforcement without local juries",
    distractors: ["They elected colonial governors", "They printed tax stamps"],
  },
  STAMP_WHAT_COUNTS: {
    stem: "Which material could require a stamp under the Act?",
    correct: "Legal papers and newspapers",
    distractors: ["Only barrels of tea", "Only letters sent to Britain"],
  },
  ANDREW_OLIVER: {
    stem: "Why was Andrew Oliver a target of protest?",
    correct: "He was designated to distribute stamps in Massachusetts",
    distractors: ["He led the Loyal Nine", "He represented Boston in Parliament"],
  },
  LIBERTY_TREE: {
    stem: "What role did the Liberty Tree serve?",
    correct: "It became a gathering place and protest symbol",
    distractors: ["It marked the customs warehouse", "It was Parliament's official seal"],
  },
  LOYAL_NINE: {
    stem: "Who were the Loyal Nine?",
    correct: "Boston organizers connected to early Stamp Act resistance",
    distractors: ["Nine customs judges", "Nine members of Parliament from Massachusetts"],
  },
  EFFIGY_PROTEST: {
    stem: "What did an effigy communicate in the protest?",
    correct: "Public condemnation of a targeted official",
    distractors: ["Approval of the stamp distributor", "A request for a trade license"],
  },
  NON_IMPORTATION: {
    stem: "What was non-importation?",
    correct: "An agreement to stop buying selected British goods",
    distractors: ["A ban on colonial newspapers", "A tax collected at local churches"],
  },
  NEWS_NETWORKS: {
    stem: "How could political news move between towns?",
    correct: "Riders, printers, letters, and reprinted accounts carried it",
    distractors: ["Only Parliament could send news", "News stayed inside each port"],
  },
  WRITS_OF_ASSISTANCE: {
    stem: "What did writs of assistance permit?",
    correct: "Broad searches for smuggled goods",
    distractors: ["Colonial votes in Parliament", "Free stamped paper for printers"],
  },
  LOYALIST_VIEW: {
    stem: "What concern might a Loyalist voice about street protest?",
    correct: "That disorder could damage lawful government and safety",
    distractors: ["That Parliament had no authority anywhere", "That all imports should stop forever"],
  },
};

const microItems: AssessmentItem[] = Object.entries(MICRO_CONCEPT_IDS).map(
  ([key, conceptId]) => {
    const copy = microCopy[key as keyof typeof microCopy];
    return {
      itemId: `BOS.CP1.${conceptId}.01`,
      itemVersion: "dev.1",
      tier: "MICRO",
      conceptId,
      teksTags: [],
      stem: copy.stem,
      options: [
        { optionId: "CORRECT", text: copy.correct },
        { optionId: "DISTRACTOR_A", text: copy.distractors[0] },
        { optionId: "DISTRACTOR_B", text: copy.distractors[1] },
      ],
      correctOptionId: "CORRECT",
      approvalStatus: "DRAFT",
      difficulty: "FOUNDATIONAL",
    };
  },
);

/** Development-only authored fixtures. Never eligible in production mode. */
export const CP1_DEVELOPMENT_FIXTURE_BANK: AssessmentQuestionBank = {
  bankId: "BOS.ACT01.CP1.DEVELOPMENT_FIXTURES",
  bankVersion: "dev.1",
  approvalStatus: "DRAFT",
  items: [...macroItems, ...microItems],
};

export const CP1_BANK_REGISTRY: ReadonlyMap<string, AssessmentQuestionBank> =
  new Map([
    [CP1_PRODUCTION_BANK.bankVersion, CP1_PRODUCTION_BANK],
    [CP1_DEVELOPMENT_FIXTURE_BANK.bankVersion, CP1_DEVELOPMENT_FIXTURE_BANK],
  ]);
