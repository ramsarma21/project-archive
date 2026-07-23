import {
  CP1_REQUIRED_MACROS,
  MICRO_CONCEPT_IDS,
  type AssessmentItem,
  type AssessmentQuestionBank,
} from "@pa/contracts";

export const CP1_PRODUCTION_BANK: AssessmentQuestionBank = {
  bankId: "BOS.ACT01.CP1.PRODUCTION",
  bankVersion: "0.0.0-unapproved",
  approvalStatus: "DRAFT",
  items: [],
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
