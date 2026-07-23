import { CONCEPTS, type ConceptId } from "./ids.js";

// ============================================================================
// TEKS coverage map. Backs POV 6: "the whole standard gets taught, not the
// convenient parts." Every gated concept maps to a STAAR-eligible Grade 8
// Social Studies TEKS clause; the coverage table shows where each is taught
// and assessed, and which clauses are scheduled for later days.
// Source: 19 Tex. Admin. Code s.113.20, TEKS 8.4(A)/(B) (Adopted 2022).
// ============================================================================

export interface TeksClause {
  id: string;
  code: string;
  text: string;
}

// TEKS 8.4(A): the six named causes a student must analyze.
export const TEKS_8_4_A = {
  code: "8.4(A)",
  statement:
    "analyze causes of the American Revolution, including the Proclamation of 1763, the Intolerable Acts, the Stamp Act, mercantilism, lack of representation in Parliament, and British economic policies following the French and Indian War",
  clauses: [
    { id: "PROCLAMATION_1763", code: "8.4(A)", text: "the Proclamation of 1763" },
    { id: "INTOLERABLE_ACTS", code: "8.4(A)", text: "the Intolerable Acts" },
    { id: "STAMP_ACT", code: "8.4(A)", text: "the Stamp Act" },
    { id: "MERCANTILISM", code: "8.4(A)", text: "mercantilism" },
    { id: "NO_REPRESENTATION", code: "8.4(A)", text: "lack of representation in Parliament" },
    { id: "POSTWAR_POLICY", code: "8.4(A)", text: "British economic policies following the French and Indian War" },
  ] as TeksClause[],
} as const;

// TEKS 8.4(B): individuals the chapter surfaces as context (not gated concepts).
export const TEKS_8_4_B_INDIVIDUALS = ["Samuel Adams", "Crispus Attucks", "John Adams"] as const;

// Concept -> TEKS clause.
export const CONCEPT_TEKS: Record<ConceptId, TeksClause> = {
  [CONCEPTS.STAMP_SCOPE]: { id: "STAMP_ACT", code: "8.4(A)", text: "the Stamp Act" },
  [CONCEPTS.REPRESENTATION]: { id: "NO_REPRESENTATION", code: "8.4(A)", text: "lack of representation in Parliament" },
  [CONCEPTS.POSTWAR_REVENUE]: { id: "POSTWAR_POLICY", code: "8.4(A)", text: "British economic policies following the French and Indian War" },
};

// ============================================================================
// Concept classification registry (Learning-Ledger-Spec §3). Static
// content metadata — NOT per-student state. Lets the runtime route a concept:
//   MACRO_GATED -> full lifecycle + demonstration (the 3 macros + event anchors)
//   PATTERN     -> taught by a mechanic; Archive bridge only if archiveSafetyNet
//   MICRO       -> enrichment; engaged-only; debrief-sampled, never gates
// ============================================================================

export type ConceptClass = "MACRO_GATED" | "PATTERN" | "MICRO";
export type ConceptRecurrence = "ONCE" | "SPIRAL"; // ONCE = event-anchored; SPIRAL = reinforced across chapters

export interface ConceptMeta {
  conceptId: string;
  class: ConceptClass;
  recurrence: ConceptRecurrence;
  seIds: string[]; // STAAR SE codes, e.g. ["8.4A"]
  chapterOwner: string; // "BOSTON" | "PHILADELPHIA" | ...
  archiveSafetyNet?: boolean; // dual-delivered high-STAAR pattern → R5 bridge allowed
}

export type ConceptRegistry = Record<string, ConceptMeta>;

// The 3 Day-1 macros are the seed of the registry; micros/patterns are added
// as the vertical slice wires them (additive; unknown concepts default to the
// existing MACRO_GATED lifecycle so nothing regresses).
export const CONCEPT_META: ConceptRegistry = {
  [CONCEPTS.STAMP_SCOPE]: { conceptId: CONCEPTS.STAMP_SCOPE, class: "MACRO_GATED", recurrence: "ONCE", seIds: ["8.4A"], chapterOwner: "BOSTON" },
  [CONCEPTS.REPRESENTATION]: { conceptId: CONCEPTS.REPRESENTATION, class: "MACRO_GATED", recurrence: "SPIRAL", seIds: ["8.4A"], chapterOwner: "BOSTON", archiveSafetyNet: true },
  [CONCEPTS.POSTWAR_REVENUE]: { conceptId: CONCEPTS.POSTWAR_REVENUE, class: "MACRO_GATED", recurrence: "ONCE", seIds: ["8.4A"], chapterOwner: "BOSTON" },
};

// ---- Static coverage map for Day 1 (mirrors docs/chapters/boston-1765/Day-1.md s.2C matrix). ----
export interface CoverageExposure {
  beat: string;
  type: "SCENE" | "CONVERSATION" | "ARTICLE" | "HANDS_ON";
  label: string;
}

export interface CoverageRow {
  conceptId: ConceptId;
  conceptName: string;
  teks: TeksClause;
  exposures: CoverageExposure[];
  understandingSync: string;
  demonstration: string;
}

export const DAY1_COVERAGE: CoverageRow[] = [
  {
    conceptId: CONCEPTS.STAMP_SCOPE,
    conceptName: "Stamp Act",
    teks: CONCEPT_TEKS[CONCEPTS.STAMP_SCOPE],
    exposures: [
      { beat: "B3", type: "HANDS_ON", label: "Compare the proofs (stamp revealed)" },
      { beat: "B4.5", type: "ARTICLE", label: "Town notice board: the Stamp notice" },
      { beat: "B6", type: "CONVERSATION", label: "Pike: a tax on the very paper" },
    ],
    understandingSync: "Sync 1 (after Pike): what is that stamp, really?",
    demonstration: "B6.5: flag which of Pike's papers need the stamp",
  },
  {
    conceptId: CONCEPTS.REPRESENTATION,
    conceptName: "Representation",
    teks: CONCEPT_TEKS[CONCEPTS.REPRESENTATION],
    exposures: [
      { beat: "B5.5", type: "ARTICLE", label: "Broadside read after the first delivery" },
      { beat: "B5", type: "CONVERSATION", label: "Thomas: it's the not being asked" },
      { beat: "B7", type: "HANDS_ON", label: "Conceal and read the anti-Stamp handbill" },
    ],
    understandingSync: "Sync 2 (after Clarke): what are they actually angry about?",
    demonstration: "B12: set the headline from the cause",
  },
  {
    conceptId: CONCEPTS.POSTWAR_REVENUE,
    conceptName: "Postwar revenue policy",
    teks: CONCEPT_TEKS[CONCEPTS.POSTWAR_REVENUE],
    exposures: [
      { beat: "B0", type: "SCENE", label: "Archive intake using a real period source" },
      { beat: "B6", type: "CONVERSATION", label: "Pike: London had a war to pay for" },
      { beat: "B7.5", type: "ARTICLE", label: "Custom House Crown revenue proclamation" },
    ],
    understandingSync: "Sync 3 (Custom House): why does London want money?",
    demonstration: "B7.5: post the notice under the correct cause",
  },
];

// Which 8.4(A) clauses Day 1 gates vs. schedules for later Boston days.
export const DAY1_CLAUSE_STATUS: Record<string, "GATED_DAY1" | "SCHEDULED_LATER"> = {
  STAMP_ACT: "GATED_DAY1",
  NO_REPRESENTATION: "GATED_DAY1",
  POSTWAR_POLICY: "GATED_DAY1",
  PROCLAMATION_1763: "SCHEDULED_LATER",
  INTOLERABLE_ACTS: "SCHEDULED_LATER",
  MERCANTILISM: "SCHEDULED_LATER",
};

// ============================================================================
// Per-student mastery report. Backs POV 6: "hand a teacher the receipts."
// Derived from the event-sourced learner state, so it is fully auditable.
// ============================================================================

export type MasteryStage = "NOT_STARTED" | "LEARNING" | "UNDERSTOOD" | "MASTERED";

export interface MasteryConceptRow {
  conceptId: string;
  conceptName: string;
  teksCode: string;
  teksClause: string;
  stage: MasteryStage;
  exposureCount: number;
  exposureTypes: string[];
  understandingPassed: boolean;
  understandingAttempts: number;
  demonstrated: boolean;
  misconceptions: string[];
}

export interface MasteryReport {
  profileId: string;
  packageId: string;
  chapterId: string;
  generatedAt: string;
  dayComplete: boolean;
  masteredCount: number;
  requiredCount: number;
  concepts: MasteryConceptRow[];
  // Engaged optional enrichment (micros the world actually delivered to this
  // student) — surfaced so the mastery panel can show the alive-world learning
  // alongside the required spine.
  engagedMicros?: { microId: string; label: string }[];
  checkpoint?: {
    checkpointId: string;
    status: string;
    bankVersion: string | null;
    formId: string | null;
    macroEvidence: { conceptId: string; outcome: "SUPPORTED" | "REVISIT"; hintsUsed?: number }[];
    enrichment: { included: boolean; responseCount: number; correctCount?: number };
  };
  integrity: {
    variationRootSeedHex: string;
    committedEventCount: number;
    deterministic: true;
    note: string;
  };
}
