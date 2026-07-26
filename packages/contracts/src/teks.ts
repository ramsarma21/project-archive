import type { ConceptId } from "./ids.js";

// ============================================================================
// TEKS/coverage machinery (types only). The concrete coverage tables, TEKS
// clause maps, and concept registries are chapter content and live in the
// chapter packages (e.g. @pa/chapter-boston). The report machinery below is
// chapter-agnostic protocol.
// ============================================================================

export interface TeksClause {
  id: string;
  code: string;
  text: string;
}

// ============================================================================
// Concept classification registry (Learning-Ledger-Spec §3). Static
// content metadata — NOT per-student state. Lets the runtime route a concept:
//   MACRO_GATED -> full lifecycle + demonstration (the macros + event anchors)
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
  // A canonical chapter id from @pa/curriculum's registry — the spelling stored
  // in `concept_mastery.chapter_id`, not a chapter's authoring name. The example
  // that used to sit here named the superseded spelling, which is how a second
  // one gets authored.
  chapterOwner: string;
  archiveSafetyNet?: boolean; // dual-delivered high-STAAR pattern → R5 bridge allowed
}

export type ConceptRegistry = Record<string, ConceptMeta>;

// ---- Static coverage-map row shapes (chapter packages own the data). ----
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
