import type { ConceptId } from "./ids.js";
import type { DayPhase, WarningStage } from "./constants.js";
import type { CompatibleConcealmentState } from "./field.js";

export type ExposureType = "SCENE" | "CONVERSATION" | "ARTICLE" | "HANDS_ON";

// Provenance: which concrete world moment delivered an exposure to THIS student.
// Optional + additive (older records simply omit it). Powers the Archive's
// memory-cued hints (Archive-Spec R7) — a hint may only cue a moment the
// student actually engaged, so the recall prompt is fair and personal.
export type ExposureSourceKind =
  | "LORE"
  | "MECHANIC"
  | "NPC"
  | "EVENT"
  | "SIDEJOB"
  | "EAVESDROP_TRACKED";

export interface ExposureProvenance {
  sourceId: string; // stable content id, e.g. "LORE-noticeboard", "MECH-search"
  sourceKind: ExposureSourceKind;
  label: string; // authored recall cue: "the stamp schedule nailed by the town pump"
  zone?: string; // optional spatial anchor, e.g. "Z4"
}

export interface ExposureRecord {
  exposureId: string;
  type: ExposureType;
  interactionOrdinal: number;
  provenance?: ExposureProvenance;
}

export type LearningGate = "NOT_READY" | "READY";
export type UnderstandingState =
  | "NOT_ASSESSED"
  | "REEXPOSURE_REQUIRED"
  | "RETRY_PENDING"
  | "UNDERSTOOD";
export type DemonstrationState = "LOCKED" | "PENDING" | "DEMONSTRATED";

export interface ReexposureObligation {
  retryExposureId: string;
  reexposureCommitted: boolean;
  spacingInteractionsSince: number;
}

export interface ConceptLearningState {
  exposures: ExposureRecord[];
  distinctOccasionCount: number;
  exposureTypes: ExposureType[];
  learningGate: LearningGate;
  understanding: UnderstandingState;
  firstUnderstandingAttemptCount: number;
  pendingReexposure: ReexposureObligation | null;
  notesAddedTransactionId: string | null;
  demonstration: DemonstrationState;
  priorDayReassessment: "NOT_DUE" | "DUE" | "DONE";
  misconceptionIds: string[];
}

export type LearnerState = Record<ConceptId, ConceptLearningState>;

// ---- World state ----

export interface DayClockState {
  spentUnits: number;
  fixedEventBoundary: number;
  warningStage: WarningStage;
  phase: DayPhase;
}

export type JobObjectCustody =
  | "ABIGAIL"
  | "PLAYER"
  | "THOMAS"
  | "PIKE"
  | "CUSTOMHOUSE"
  | "RIDER"
  | "DOCKHAND"
  | "TAVERN_KEEPER"
  | "SHIP"
  | "CONFISCATED";

export type JobObjectCondition =
  | "INTACT"
  | "UNPRINTED"
  | "CRISP"
  | "USABLE"
  | "SMUDGED"
  | "CREASED"
  | "LOST";

export interface JobObjectState {
  custody: JobObjectCustody;
  condition: JobObjectCondition;
  // CONCEALED remains accepted while Day-1 B8/B9 use the legacy weighted path.
  // New field systems project it explicitly to WRAPPED.
  concealment?: CompatibleConcealmentState;
}

export type PrintJobQuality = "CRISP" | "USABLE" | "SMUDGED";
export type PrintJobVariant = "PIKE_PROOF" | "PIKE_REPRINT" | "FINAL_PAGE";

export interface PrintJobPhaseScores {
  catch: number;
  ink: number;
  register: number;
  pull: number;
  peel: number;
}

export interface PrintJobState {
  promptId: string;
  variant: PrintJobVariant;
  phases: PrintJobPhaseScores;
  quality: PrintJobQuality;
  attempts: number;
}

export type ObjectiveStatus =
  | "NOT_YET_ELIGIBLE"
  | "ACTIVE"
  | "SELECTED"
  | "HIDDEN"
  | "COMPLETED"
  | "MISSED"
  | "FAILED";

export interface WorldState {
  revision: string;
  locationId: string;
  controlState:
    | "ARCHIVE"
    | "FREE_ROAM"
    | "INTERACTION"
    | "FIXED_EVENT"
    | "DAY_END"
    | "CHECKPOINT"
    | "ACT_TRANSITION";
  clock: DayClockState;
  currentInteractionOrdinal: number;
  lastSyncCompletionInteractionOrdinal: number | null;
  firstErrandCompletionRecorded: boolean;
  fixedEvent: "NOT_STARTED" | "ACTIVE" | "COMPLETE";
  objectives: Record<string, ObjectiveStatus>;
  jobObjects: Record<string, JobObjectState>;
  printJobs: Record<string, PrintJobState>;
  relationships: Record<string, number>;
  routes: Record<string, "LOCKED" | "UNLOCKED">;
  attention: {
    watcherHeat: number;
    clarkeInformed: boolean;
    recognized: boolean;
    politicalSympathy?: boolean;
  };
  pendingContingentEffects: PendingContingentEffect[];
  realizedHiddenEffects: RealizedHiddenEffect[];
}

export interface PendingContingentEffect {
  id: string;
  relationshipId: string;
  cause: string;
  resolveOn: string;
}

export interface RealizedHiddenEffect {
  id: string;
  relationshipId: string;
  newValue: number;
  cause: string;
  presented: boolean;
}
