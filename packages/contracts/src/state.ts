import type { ConceptId } from "./ids.js";
import type { DayPhase, WarningStage } from "./constants.js";

export type ExposureType = "SCENE" | "CONVERSATION" | "ARTICLE" | "HANDS_ON";

export interface ExposureRecord {
  exposureId: string;
  type: ExposureType;
  interactionOrdinal: number;
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
  concealment?: "EXPOSED" | "CONCEALED";
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
  controlState: "ARCHIVE" | "FREE_ROAM" | "INTERACTION" | "FIXED_EVENT" | "DAY_END";
  clock: DayClockState;
  currentInteractionOrdinal: number;
  lastSyncCompletionInteractionOrdinal: number | null;
  firstErrandCompletionRecorded: boolean;
  fixedEvent: "NOT_STARTED" | "ACTIVE" | "COMPLETE";
  objectives: Record<string, ObjectiveStatus>;
  jobObjects: Record<string, JobObjectState>;
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
