import { CONCEPTS, type ConceptId, type ExposureType } from "@pa/contracts";

// ---- Tracked exposure registry (spec §23). Only these IDs increment gates. ----
export interface ExposureDef {
  exposureId: string;
  concept: ConceptId;
  type: ExposureType;
}

export const EXPOSURES = {
  // Postwar revenue policy
  POLICY_B0: { exposureId: "POLICY.B0.ARCHIVE_ARTICLE_SCENE", concept: CONCEPTS.POSTWAR_REVENUE, type: "SCENE" },
  POLICY_B6: { exposureId: "POLICY.B6.PIKE_WAR_DEBT_LINE", concept: CONCEPTS.POSTWAR_REVENUE, type: "CONVERSATION" },
  POLICY_B7_5: { exposureId: "POLICY.B7_5.CROWN_PROCLAMATION", concept: CONCEPTS.POSTWAR_REVENUE, type: "ARTICLE" },
  POLICY_DEFICIT_SRC: { exposureId: "POLICY.B11_5.RETAINED_DEBT_SOURCE", concept: CONCEPTS.POSTWAR_REVENUE, type: "HANDS_ON" },
  POLICY_DEFICIT_LINE: { exposureId: "POLICY.B11_5.ABIGAIL_CAUSE_LINE", concept: CONCEPTS.POSTWAR_REVENUE, type: "CONVERSATION" },
  // Stamp scope
  STAMP_B3: { exposureId: "STAMP.B3.PROOF_COMPARISON", concept: CONCEPTS.STAMP_SCOPE, type: "HANDS_ON" },
  STAMP_B4_5: { exposureId: "STAMP.B4_5.OFFICIAL_NOTICE", concept: CONCEPTS.STAMP_SCOPE, type: "ARTICLE" },
  STAMP_B6: { exposureId: "STAMP.B6.PIKE_SCOPE_LINE", concept: CONCEPTS.STAMP_SCOPE, type: "CONVERSATION" },
  STAMP_B9: { exposureId: "STAMP.B9.OFFICER_STAMP_LINE", concept: CONCEPTS.STAMP_SCOPE, type: "CONVERSATION" },
  STAMP_DEFICIT_SRC: { exposureId: "STAMP.B11_5.RETAINED_FORM_COMPARE", concept: CONCEPTS.STAMP_SCOPE, type: "HANDS_ON" },
  STAMP_DEFICIT_LINE: { exposureId: "STAMP.B11_5.ABIGAIL_FEE_DISTINCTION", concept: CONCEPTS.STAMP_SCOPE, type: "CONVERSATION" },
  // Representation
  REP_B5_5: { exposureId: "REP.B5_5.FRESH_BROADSIDE", concept: CONCEPTS.REPRESENTATION, type: "ARTICLE" },
  REP_B5: { exposureId: "REP.B5.THOMAS_CONSENT_LINE", concept: CONCEPTS.REPRESENTATION, type: "CONVERSATION" },
  REP_B7: { exposureId: "REP.B7.CONCEALED_HANDBILL", concept: CONCEPTS.REPRESENTATION, type: "HANDS_ON" },
  REP_B10_4: { exposureId: "REP.B10_4.CROWD_BOARD", concept: CONCEPTS.REPRESENTATION, type: "ARTICLE" },
  REP_B11: { exposureId: "REP.B11.EVENT_BANNER", concept: CONCEPTS.REPRESENTATION, type: "SCENE" },
  REP_DEFICIT_SRC: { exposureId: "REP.B11_5.TOWN_INSTRUCTION_SOURCE", concept: CONCEPTS.REPRESENTATION, type: "HANDS_ON" },
  REP_DEFICIT_LINE: { exposureId: "REP.B11_5.ABIGAIL_NO_MEMBER_LINE", concept: CONCEPTS.REPRESENTATION, type: "CONVERSATION" },
} as const satisfies Record<string, ExposureDef>;

// Post-Sync re-exposure registry (spec §23). One per concept.
export const RETRY_EXPOSURES: Record<ConceptId, ExposureDef> = {
  [CONCEPTS.POSTWAR_REVENUE]: { exposureId: "POLICY.RETRY.SECOND_DEBT_EXCERPT", concept: CONCEPTS.POSTWAR_REVENUE, type: "ARTICLE" },
  [CONCEPTS.STAMP_SCOPE]: { exposureId: "STAMP.RETRY.COVERED_ITEMS_SCHEDULE", concept: CONCEPTS.STAMP_SCOPE, type: "HANDS_ON" },
  [CONCEPTS.REPRESENTATION]: { exposureId: "REP.RETRY.MASSACHUSETTS_INSTRUCTION", concept: CONCEPTS.REPRESENTATION, type: "ARTICLE" },
};

// Deficit-closure fallback pool per concept (source then line), spec §23/§29.
export const DEFICIT_FALLBACKS: Record<ConceptId, ExposureDef[]> = {
  [CONCEPTS.POSTWAR_REVENUE]: [EXPOSURES.POLICY_DEFICIT_SRC, EXPOSURES.POLICY_DEFICIT_LINE],
  [CONCEPTS.STAMP_SCOPE]: [EXPOSURES.STAMP_DEFICIT_SRC, EXPOSURES.STAMP_DEFICIT_LINE],
  [CONCEPTS.REPRESENTATION]: [EXPOSURES.REP_DEFICIT_SRC, EXPOSURES.REP_DEFICIT_LINE],
};

// ---- Understanding Sync prompts (spec §25). ----
export interface SyncPrompt {
  concept: ConceptId;
  initialActionId: string;
  retryActionId: string;
  frame: string;
  choices: { choiceId: string; label: string; correct: boolean; nudge?: string }[];
  notes: { concept: string; body: string };
}

export const SYNC_PROMPTS: Record<ConceptId, SyncPrompt> = {
  [CONCEPTS.STAMP_SCOPE]: {
    concept: CONCEPTS.STAMP_SCOPE,
    initialActionId: "BOS.MD01.ACT.SYNC.STAMP.INITIAL.v1",
    retryActionId: "BOS.MD01.ACT.SYNC.STAMP.RETRY.v1",
    frame: "Before I file, what is that stamp, really?",
    choices: [
      { choiceId: "STAMP_SYNC.SHOP_CHARGE", label: "A charge Mercer's shop adds to the paper.", correct: false, nudge: "Mercer charges for her work. Who requires the stamp?" },
      { choiceId: "STAMP_SYNC.PUNISHMENT", label: "Something Boston was hit with for stirring up trouble.", correct: false, nudge: "The law was written before tonight's crowd. What kind of charge does Pike describe?" },
      { choiceId: "STAMP_SYNC.CROWN_TAX", label: "A tax the Crown put on printed and legal paper.", correct: true },
    ],
    notes: { concept: "Stamp Act", body: "The Stamp Act required paid stamps on covered printed and legal paper beginning 1 November 1765." },
  },
  [CONCEPTS.REPRESENTATION]: {
    concept: CONCEPTS.REPRESENTATION,
    initialActionId: "BOS.MD01.ACT.SYNC.REPRESENTATION.INITIAL.v1",
    retryActionId: "BOS.MD01.ACT.SYNC.REPRESENTATION.RETRY.v1",
    frame: 'That banner said, "We were never asked." What are they actually angry about?',
    choices: [
      { choiceId: "REP_SYNC.ALL_TAXES", label: "The Crown raising taxes at all.", correct: false, nudge: "Thomas said it wasn't only the shilling. What did Boston lack in Parliament?" },
      { choiceId: "REP_SYNC.NO_ELECTED_VOICE", label: "Being taxed by a Parliament they elected no one to.", correct: true },
      { choiceId: "REP_SYNC.OLIVER_PERSONAL", label: "Andrew Oliver personally.", correct: false, nudge: "Oliver distributes the stamp. Who made the law?" },
    ],
    notes: { concept: "Representation", body: "Colonists objected that Parliament taxed them even though they elected no representatives to it." },
  },
  [CONCEPTS.POSTWAR_REVENUE]: {
    concept: CONCEPTS.POSTWAR_REVENUE,
    initialActionId: "BOS.MD01.ACT.SYNC.POLICY.INITIAL.v1",
    retryActionId: "BOS.MD01.ACT.SYNC.POLICY.RETRY.v1",
    frame: "Why does London want money from these colonies in the first place?",
    choices: [
      { choiceId: "POLICY_SYNC.PUNISH_MOB", label: "To punish Boston for the mob at the elm.", correct: false, nudge: "The tax came before tonight's mob. What expense was London already carrying?" },
      { choiceId: "POLICY_SYNC.WAR_DEBT", label: "To pay debt from the war Britain just fought.", correct: true },
      { choiceId: "POLICY_SYNC.COLONIES_RICH", label: "Because the colonies had become rich enough to afford it.", correct: false, nudge: "Look back to the war account. What debt followed it?" },
    ],
    notes: { concept: "Postwar revenue policy", body: "After the French and Indian War, British debt helped drive Parliament to seek more colonial revenue." },
  },
};

// ---- Demonstration targets (spec §26). ----
export const STAMP_SORT = {
  items: [
    { itemId: "deed", label: "a court deed", correct: "NEEDS_STAMP" },
    { itemId: "writ", label: "a court writ", correct: "NEEDS_STAMP" },
    { itemId: "newspaper", label: "a printed newspaper", correct: "NEEDS_STAMP" },
    { itemId: "letter", label: "a personal letter", correct: "DOES_NOT" },
    { itemId: "tool", label: "a wooden tool", correct: "DOES_NOT" },
  ],
  buckets: [
    { bucketId: "NEEDS_STAMP", label: "Needs the stamp" },
    { bucketId: "DOES_NOT", label: "Does not" },
  ],
  nudge: "Would the Crown fuss over what a man writes to his own sister?\nThink which of these is printed, or made official.",
};

export const HEADLINE_CHOICES = [
  { choiceId: "MOB_WRECKS", label: "MOB WRECKS STAMP OFFICE", correct: false, nudge: "That tells people what the crowd did. What made them gather?" },
  { choiceId: "WONT_PAY", label: "BOSTON WON'T PAY THE TAX", correct: false, nudge: "Cost mattered. What did they say they never had?" },
  { choiceId: "TAXED_NO_VOICE", label: "TAXED WITHOUT A VOICE", correct: true },
];

export const CAUSE_CHOICES = [
  { choiceId: "CAUSE_PARLIAMENT", label: "By order of Parliament, to raise revenue after the war.", correct: true },
  { choiceId: "CAUSE_SHOP_FEE", label: "A printing fee, added by the shop.", correct: false, nudge: "That's my fee, not the Crown's reason. Why would London suddenly need money from the likes of us?" },
  { choiceId: "CAUSE_EFFIGY", label: "After a mob burned the stamp man in effigy.", correct: false, nudge: "That happened after the tax. What came before it?" },
];

export const EVIDENCE_CHOICES = [
  { choiceId: "EV_DEED", label: "A court deed", correct: true },
  { choiceId: "EV_LETTER", label: "Thomas's personal letter", correct: false, nudge: "Thomas wrote that by hand for one person. Think about the official papers on Pike's desk." },
  { choiceId: "EV_RULER", label: "A carpenter's wooden ruler", correct: false, nudge: "That's a tool, not a printed or legal paper." },
];

// ---- Outcome policies (spec §27). ----
export const OUTCOME_WEIGHTS = {
  B8_MAIN_FAST: [{ outcome: "CLEAR", weight: 75 }, { outcome: "STOP_TRIGGERED", weight: 25 }],
  B9_COMPLY_CONCEALED: [{ outcome: "PASS", weight: 90 }, { outcome: "RECOGNIZED", weight: 10 }],
  B9_TALK_NORMAL: [{ outcome: "PASS", weight: 70 }, { outcome: "SEARCH", weight: 30 }],
  B9_TALK_INFORMED: [{ outcome: "PASS", weight: 35 }, { outcome: "SEARCH", weight: 65 }],
  B9_SLIP: [{ outcome: "ESCAPE", weight: 65 }, { outcome: "CAUGHT", weight: 35 }],
  B10_QUICK_LOW_HEAT: [{ outcome: "DELIVERED_UNSEEN", weight: 90 }, { outcome: "DELIVERED_RECOGNIZED", weight: 10 }],
  B10_QUICK_HIGH_HEAT: [{ outcome: "DELIVERED_UNSEEN", weight: 65 }, { outcome: "DELIVERED_RECOGNIZED", weight: 35 }],
} as const;

// ---- Ambient replay slots (spec §36). ----
export const AMBIENT_SLOTS = {
  EARLY: { slotId: "BOS.MD01.SLOT.AMBIENT_EARLY.v1", candidates: ["PRINTER_PAPER", "MERCHANT_NOTICE", "NO_ACTION"] },
  MID: { slotId: "BOS.MD01.SLOT.AMBIENT_MID.v1", candidates: ["DOCK_WAR_BILL", "SHOPKEEPER_CROWD", "NO_ACTION"] },
  LATE: { slotId: "BOS.MD01.SLOT.AMBIENT_LATE.v1", candidates: ["OLIVER_RUMOR", "BELL_WARNING", "NO_ACTION"] },
} as const;
