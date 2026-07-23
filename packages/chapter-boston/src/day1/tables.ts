import type { ConceptId, ExposureType, ExposureProvenance } from "@pa/contracts";
import { CONCEPTS } from "../ids.js";

// ---- Tracked exposure registry (spec §23). Only these IDs increment gates. ----
// Every def carries provenance: the authored recall cue naming the concrete
// world moment that delivered it (Learning-Ledger-Spec §2). The Archive
// hint engine (R7) may only cue moments this student actually engaged.
export interface ExposureDef {
  exposureId: string;
  concept: ConceptId;
  type: ExposureType;
  provenance: ExposureProvenance;
}

export const EXPOSURES = {
  // Postwar revenue policy
  POLICY_B0: { exposureId: "POLICY.B0.ARCHIVE_ARTICLE_SCENE", concept: CONCEPTS.POSTWAR_REVENUE, type: "SCENE", provenance: { sourceId: "B0", sourceKind: "EVENT", label: "the Archive's intake brief on the war account" } },
  POLICY_B6: { exposureId: "POLICY.B6.PIKE_WAR_DEBT_LINE", concept: CONCEPTS.POSTWAR_REVENUE, type: "CONVERSATION", provenance: { sourceId: "NPC-pike", sourceKind: "NPC", label: "Pike grumbling about the war debt over his desk", zone: "Z5" } },
  POLICY_B7_5: { exposureId: "POLICY.B7_5.CROWN_PROCLAMATION", concept: CONCEPTS.POSTWAR_REVENUE, type: "ARTICLE", provenance: { sourceId: "LORE-customhouse-proclamation", sourceKind: "LORE", label: "the revenue proclamation on the Custom House wall", zone: "Z5" } },
  POLICY_DEFICIT_SRC: { exposureId: "POLICY.B11_5.RETAINED_DEBT_SOURCE", concept: CONCEPTS.POSTWAR_REVENUE, type: "HANDS_ON", provenance: { sourceId: "B11_5-policy-source", sourceKind: "EVENT", label: "the debt excerpt you pulled at the press before filing" } },
  POLICY_DEFICIT_LINE: { exposureId: "POLICY.B11_5.ABIGAIL_CAUSE_LINE", concept: CONCEPTS.POSTWAR_REVENUE, type: "CONVERSATION", provenance: { sourceId: "NPC-abigail", sourceKind: "NPC", label: "Abigail spelling out why London wants revenue" } },
  // Stamp scope
  STAMP_B3: { exposureId: "STAMP.B3.PROOF_COMPARISON", concept: CONCEPTS.STAMP_SCOPE, type: "HANDS_ON", provenance: { sourceId: "MECH-proof-compare", sourceKind: "MECHANIC", label: "the two proofs you compared side by side on the stone", zone: "Z4" } },
  STAMP_B4_5: { exposureId: "STAMP.B4_5.OFFICIAL_NOTICE", concept: CONCEPTS.STAMP_SCOPE, type: "ARTICLE", provenance: { sourceId: "LORE-noticeboard", sourceKind: "LORE", label: "the stamp schedule nailed by the town pump", zone: "Z4" } },
  STAMP_B6: { exposureId: "STAMP.B6.PIKE_SCOPE_LINE", concept: CONCEPTS.STAMP_SCOPE, type: "CONVERSATION", provenance: { sourceId: "NPC-pike", sourceKind: "NPC", label: "Pike listing which of his papers will need the stamp", zone: "Z5" } },
  STAMP_B9: { exposureId: "STAMP.B9.OFFICER_STAMP_LINE", concept: CONCEPTS.STAMP_SCOPE, type: "CONVERSATION", provenance: { sourceId: "MECH-customs-search", sourceKind: "MECHANIC", label: "the customs officer naming stamped paper at the checkpoint", zone: "Z5" } },
  STAMP_DEFICIT_SRC: { exposureId: "STAMP.B11_5.RETAINED_FORM_COMPARE", concept: CONCEPTS.STAMP_SCOPE, type: "HANDS_ON", provenance: { sourceId: "B11_5-stamp-source", sourceKind: "EVENT", label: "the stamped form you compared at the press before filing" } },
  STAMP_DEFICIT_LINE: { exposureId: "STAMP.B11_5.ABIGAIL_FEE_DISTINCTION", concept: CONCEPTS.STAMP_SCOPE, type: "CONVERSATION", provenance: { sourceId: "NPC-abigail", sourceKind: "NPC", label: "Abigail separating her fee from the Crown's stamp" } },
  // Representation
  REP_B5_5: { exposureId: "REP.B5_5.FRESH_BROADSIDE", concept: CONCEPTS.REPRESENTATION, type: "ARTICLE", provenance: { sourceId: "LORE-fresh-broadside", sourceKind: "LORE", label: "the fresh broadside pasted while you were inside", zone: "Z4" } },
  REP_B5: { exposureId: "REP.B5.THOMAS_CONSENT_LINE", concept: CONCEPTS.REPRESENTATION, type: "CONVERSATION", provenance: { sourceId: "NPC-thomas", sourceKind: "NPC", label: "Thomas saying it's the not being asked, not the shilling", zone: "Z3" } },
  REP_B7: { exposureId: "REP.B7.CONCEALED_HANDBILL", concept: CONCEPTS.REPRESENTATION, type: "HANDS_ON", provenance: { sourceId: "MECH-conceal", sourceKind: "MECHANIC", label: "the handbill you wrapped plain under Clarke's eye", zone: "Z4" } },
  REP_B10_4: { exposureId: "REP.B10_4.CROWD_BOARD", concept: CONCEPTS.REPRESENTATION, type: "ARTICLE", provenance: { sourceId: "LORE-crowd-board", sourceKind: "LORE", label: "the one-line broadside on the board by the elm", zone: "Z6" } },
  REP_B11: { exposureId: "REP.B11.EVENT_BANNER", concept: CONCEPTS.REPRESENTATION, type: "SCENE", provenance: { sourceId: "EVENT-effigy", sourceKind: "EVENT", label: "the banner over the crowd at the great elm", zone: "Z6" } },
  REP_DEFICIT_SRC: { exposureId: "REP.B11_5.TOWN_INSTRUCTION_SOURCE", concept: CONCEPTS.REPRESENTATION, type: "HANDS_ON", provenance: { sourceId: "B11_5-rep-source", sourceKind: "EVENT", label: "the town instruction you read back at the press" } },
  REP_DEFICIT_LINE: { exposureId: "REP.B11_5.ABIGAIL_NO_MEMBER_LINE", concept: CONCEPTS.REPRESENTATION, type: "CONVERSATION", provenance: { sourceId: "NPC-abigail", sourceKind: "NPC", label: "Abigail reminding you Boston seats no member in Parliament" } },
} as const satisfies Record<string, ExposureDef>;

// Post-Sync re-exposure registry (spec §23). One per concept.
export const RETRY_EXPOSURES: Record<ConceptId, ExposureDef> = {
  [CONCEPTS.POSTWAR_REVENUE]: { exposureId: "POLICY.RETRY.SECOND_DEBT_EXCERPT", concept: CONCEPTS.POSTWAR_REVENUE, type: "ARTICLE", provenance: { sourceId: "RETRY-policy", sourceKind: "EVENT", label: "the second debt excerpt you took another look at" } },
  [CONCEPTS.STAMP_SCOPE]: { exposureId: "STAMP.RETRY.COVERED_ITEMS_SCHEDULE", concept: CONCEPTS.STAMP_SCOPE, type: "HANDS_ON", provenance: { sourceId: "RETRY-stamp", sourceKind: "EVENT", label: "the covered-items schedule you went back over" } },
  [CONCEPTS.REPRESENTATION]: { exposureId: "REP.RETRY.MASSACHUSETTS_INSTRUCTION", concept: CONCEPTS.REPRESENTATION, type: "ARTICLE", provenance: { sourceId: "RETRY-rep", sourceKind: "EVENT", label: "the Massachusetts instruction you reread" } },
};

// ---- Found-History macro support (Environmental-Lore Tier A). ----
// Free-roam knowledge inspects arrive as FIELD_REACTIVE_COMPLETED with the
// placement id as sourceId. Tier-A placements additionally reinforce a
// required macro: the Ctx bridges them to these tracked exposures (idempotent
// by exposureId, so re-reading or overlapping with an authored flow read of
// the same physical object can never double-count).
export const LORE_MACRO_SUPPORT: Record<string, ExposureDef[]> = {
  // Same physical notice as the B4.5 street offer -> same exposure def.
  "KN-noticeboard-stamp": [EXPOSURES.STAMP_B4_5],
  "KN-noticeboard-revenue": [
    { exposureId: "POLICY.LORE.NOTICEBOARD", concept: CONCEPTS.POSTWAR_REVENUE, type: "ARTICLE", provenance: { sourceId: "KN-noticeboard-revenue", sourceKind: "LORE", label: "the revenue proclamation on the notice board", zone: "Z4" } },
  ],
  "KN-noconsent": [
    { exposureId: "REP.LORE.NOCONSENT", concept: CONCEPTS.REPRESENTATION, type: "ARTICLE", provenance: { sourceId: "KN-noconsent", sourceKind: "LORE", label: "the 'no consent' broadside chalked over the proclamation", zone: "Z4" } },
  ],
  "KN-watchhouse": [
    { exposureId: "STAMP.LORE.WATCHHOUSE", concept: CONCEPTS.STAMP_SCOPE, type: "ARTICLE", provenance: { sourceId: "KN-watchhouse", sourceKind: "LORE", label: "the Watch House sign across from the Custom House", zone: "Z5" } },
  ],
  "KN-cargomark": [
    { exposureId: "POLICY.LORE.CARGOMARK", concept: CONCEPTS.POSTWAR_REVENUE, type: "SCENE", provenance: { sourceId: "KN-cargomark", sourceKind: "LORE", label: "the collector's chalk marks on the London crates", zone: "Z1" } },
  ],
  "KN-marketstall": [
    { exposureId: "POLICY.LORE.MARKETSTALL", concept: CONCEPTS.POSTWAR_REVENUE, type: "SCENE", provenance: { sourceId: "KN-marketstall", sourceKind: "LORE", label: "Sarah's half-empty stall at the west market", zone: "Z3" } },
  ],
  "KN-assembly": [
    { exposureId: "REP.LORE.ASSEMBLY", concept: CONCEPTS.REPRESENTATION, type: "ARTICLE", provenance: { sourceId: "KN-assembly", sourceKind: "LORE", label: "the civic square note on the colony's own assembly", zone: "Z5" } },
  ],
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
  // B8/B9 are intentionally absent: live M2 field simulation owns them.
  B10_QUICK_LOW_HEAT: [{ outcome: "DELIVERED_UNSEEN", weight: 90 }, { outcome: "DELIVERED_RECOGNIZED", weight: 10 }],
  B10_QUICK_HIGH_HEAT: [{ outcome: "DELIVERED_UNSEEN", weight: 65 }, { outcome: "DELIVERED_RECOGNIZED", weight: 35 }],
} as const;

// ---- Ambient replay slots (spec §36). ----
export const AMBIENT_SLOTS = {
  EARLY: { slotId: "BOS.MD01.SLOT.AMBIENT_EARLY.v1", candidates: ["PRINTER_PAPER", "MERCHANT_NOTICE", "NO_ACTION"] },
  MID: { slotId: "BOS.MD01.SLOT.AMBIENT_MID.v1", candidates: ["DOCK_WAR_BILL", "SHOPKEEPER_CROWD", "NO_ACTION"] },
  LATE: { slotId: "BOS.MD01.SLOT.AMBIENT_LATE.v1", candidates: ["OLIVER_RUMOR", "BELL_WARNING", "NO_ACTION"] },
} as const;
