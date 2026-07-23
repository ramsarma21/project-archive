import type { WarningStage, DayPhase } from "./constants.js";
import type {
  FieldCommittedEvent,
  FieldInterruptPlan,
  FieldRuntimeView,
} from "./field.js";
import type {
  PrintJobPhaseScores,
  PrintJobQuality,
  PrintJobState,
  PrintJobVariant,
} from "./state.js";
import type {
  CheckpointDebriefRequest,
  CheckpointPresenterEvent,
  Cp1CheckpointState,
} from "./assessment.js";
import type {
  FormativeEvidenceRecord,
  OpenResponsePrompt,
  AuthoredNpcFollowupView,
  ArchiveConnectionView,
} from "./openResponse.js";

// ============================================================================
// Presentation directives: WHAT the runtime tells a presenter to render.
// The presenter is disposable (text today, Three.js later). It never mutates
// game state; it only renders directives and returns typed PresenterEvents.
// ============================================================================

export type Speaker =
  | "ARCHIVE" // the meta handler (JARVIS-like); only voice that knows the future
  | "ABIGAIL"
  | "THOMAS"
  | "PIKE"
  | "CLARKE"
  | "RIDER"
  | "OFFICER"
  | "CROWD"
  | "PLAYER"
  | "NARRATOR";

export type Glyph = "SPEECH" | "INTERACTION" | "NONE";

export interface PresentationMeta {
  // Stable authored boundary used by disposable presenters for staging,
  // animation, camera, and props. It is not game state and carries no evidence.
  cueId?: string;
  // Semantic world location at the moment this directive was authored. This
  // lets disposable presenters stage buffered multi-location plans exactly,
  // including after save/replay, without changing the game script.
  locationId?: string;
}

export type PresentationDirective =
  | ({ kind: "SCENE"; locationId: string; text: string } & PresentationMeta)
  | ({ kind: "NARRATION"; text: string } & PresentationMeta)
  | ({ kind: "DIALOGUE"; speaker: Speaker; glyph: Glyph; text: string } & PresentationMeta)
  | ({ kind: "ARCHIVE"; text: string } & PresentationMeta)
  | ({ kind: "AMBIENT_CHATTER"; text: string } & PresentationMeta)
  | ({ kind: "READ_PANEL"; objectId: string; title: string; body: string } & PresentationMeta)
  | ({ kind: "FLICKER"; flicker: FlickerKind; label: string } & PresentationMeta)
  | ({ kind: "CLOCK_UPDATE"; spentUnits: number; phase: DayPhase; warningStage: WarningStage } & PresentationMeta)
  | ({ kind: "OBJECTIVE_STRIP"; lines: ObjectiveLine[] } & PresentationMeta)
  | ({ kind: "RELATIONSHIP_CARD"; character: string; dimension: string; direction: "UP" | "DOWN"; label: string } & PresentationMeta)
  | ({ kind: "DAY_END_CARD"; card: DayEndCard } & PresentationMeta);

export type FlickerKind = "NOTES_ADDED" | "ROUTE_UNLOCKED";

export interface ObjectiveLine {
  objectiveId: string;
  label: string;
  marker: "BLUE" | "GOLD" | "HIDDEN";
  status: string;
}

export interface DayEndCard {
  headerLine: string;
  selectedHeadline: string;
  notes: { concept: string; body: string }[];
  peopleMet: string[];
  routesUnlocked: string[];
}

// ============================================================================
// Input requests: what the runtime is waiting for before it can continue.
// ============================================================================

export interface ChoiceOption {
  choiceId: string;
  label: string;
  tags: string[]; // e.g. ["costs time", "earns a favor"]
  disabled?: boolean;
}

export type MechanicKind =
  | "PRESS"
  | "EFFORT"
  | "SORT"
  | "PLACE"
  | "PRINT_JOB"
  | "HAUL_JOB"
  | "POST_JOB";

export interface MechanicParams {
  kind: MechanicKind;
  // PRESS: oscillating + accelerating needle; presenter emits stopOffset 0..1
  // EFFORT: hold-to-fill; presenter emits holdMs
  // SORT: buckets; presenter emits assignments
  // PLACE: line-up + tack; presenter emits alignment 0..1
  // PRINT_JOB: catch -> ink -> register -> pull -> peel, committed atomically
  // HAUL_JOB: load -> balance -> thread, all object-space phases required
  // POST_JOB: line-up -> left tack -> right tack, all phases required
  prompt: string;
  printVariant?: PrintJobVariant;
  sortItems?: { itemId: string; label: string }[];
  sortBuckets?: { bucketId: string; label: string }[];
}

export type InputRequest =
  | { kind: "CONTINUE"; label?: string }
  | { kind: "ACK"; text: string }
  | { kind: "CHOICE"; promptId: string; frame: string; options: ChoiceOption[]; mechanic?: MechanicParams }
  | { kind: "MECHANIC"; promptId: string; params: MechanicParams }
  | { kind: "FOCUS_READ"; objectId: string; title: string; teaser: string }
  | { kind: "BREATHER"; durationMs: number }
  | {
      kind: "FREE_ROAM";
      targets: FreeRoamTarget[];
      canProceed: boolean;
      // Selecting a destination and physically reaching it are separate acts.
      // With multiple targets, selection collapses the field to one gold ping;
      // FREE_ROAM_GOTO is emitted only when the player reaches that ping.
      selectedTargetId?: string;
    }
  | { kind: "DAY_END" }
  | CheckpointDebriefRequest;

export interface FreeRoamTarget {
  targetId: string;
  label: string;
  marker: "BLUE" | "GOLD" | "HIDDEN";
}

// ============================================================================
// Presenter events: typed input the presenter returns to the runtime.
// ============================================================================

export type OrdinaryPresenterEvent =
  | { type: "CONTINUE" }
  | { type: "ACK" }
  | { type: "CHOICE_SELECTED"; promptId: string; choiceId: string }
  | { type: "MECHANIC_RESULT"; promptId: string; result: MechanicRawResult }
  | { type: "FOCUS_READ_OPENED"; objectId: string }
  | { type: "FOCUS_READ_SKIPPED"; objectId: string }
  | { type: "BREATHER_COMPLETE" }
  | { type: "FREE_ROAM_SELECT"; targetId: string }
  | { type: "FREE_ROAM_GOTO"; targetId: string }
  | { type: "FREE_ROAM_IDLE" }
  | CheckpointPresenterEvent;

// Durable field events share the save log with ordinary presenter events.
// Per-frame suspicion, stamina, and transforms deliberately do not.
export type PresenterEvent = OrdinaryPresenterEvent | FieldCommittedEvent;

export type MechanicRawResult =
  | { kind: "PRESS"; stopOffset: number } // 0..1 position of oscillating needle when stopped
  | { kind: "EFFORT"; holdMs: number }
  | { kind: "SORT"; assignments: { itemId: string; bucketId: string }[] }
  | { kind: "PLACE"; alignment: number } // 0..1
  | {
      kind: "PRINT_JOB";
      phases: PrintJobPhaseScores;
      quality: PrintJobQuality;
      accessible: boolean;
    }
  | {
      kind: "HAUL_JOB";
      phases: { load: number; balance: number; thread: number };
      accessible: boolean;
    }
  | {
      kind: "POST_JOB";
      phases: { lineUp: number; tackLeft: number; tackRight: number };
      accessible: boolean;
    };

// ============================================================================
// A single runtime step: directives to render + the input it now awaits.
// ============================================================================

export interface ExecutionPlan {
  present: PresentationDirective[];
  request: InputRequest;
  cueId: string;
  // Present only while the ordinary FREE_ROAM generator is suspended. The
  // request remains the suspended request so existing presenters stay source-
  // compatible until they opt into the typed field adapter.
  fieldInterrupt?: FieldInterruptPlan;
}

// ============================================================================
// Worker message protocol (main thread <-> runtime worker).
// ============================================================================

export type WorkerRequest =
  | { id: number; type: "INIT"; payload: InitPayload }
  | { id: number; type: "EVENT"; payload: PresenterEvent }
  | { id: number; type: "FIELD_EVENT"; payload: FieldCommittedEvent }
  | { id: number; type: "SNAPSHOT" };

export interface InitPayload {
  profileId: string;
  chapterId: string;
  variationRootSeedHex: string; // 32 bytes hex
  priorEvents: PresenterEvent[]; // for resume
  assessmentMode?: "PRODUCTION" | "QA_DRAFT";
  openResponseContentMode?: "PRODUCTION" | "AUTHOR_DRAFT_QA";
}

export type WorkerResponse =
  | { id: number; type: "READY"; plan: ExecutionPlan; transcript: PresentationDirective[]; committedEventCount: number }
  | { id: number; type: "STEP"; plan: ExecutionPlan | null; newDirectives: PresentationDirective[]; committedEventCount: number; done: boolean }
  | { id: number; type: "SNAPSHOT"; snapshot: RuntimeSnapshot }
  | { id: number; type: "ERROR"; code: string; message: string };

export interface RuntimeSnapshot {
  profileId: string;
  chapterId: string;
  committedEvents: PresenterEvent[];
  worldRevision: string;
  done: boolean;
  view: RuntimeView;
  report: import("./teks.js").MasteryReport;
}

export interface RuntimeView {
  locationId: string;
  clock: { spentUnits: number; fixedEventBoundary: number; phase: DayPhase; warningStage: WarningStage };
  objectives: Record<string, string>;
  printJobs: Record<string, PrintJobState>;
  relationships: Record<string, number>;
  routes: Record<string, string>;
  learner: Record<string, { understanding: string; demonstration: string; occasions: number; types: number }>;
  notes: { concept: string; body: string }[];
  peopleMet: string[];
  routesUnlocked: string[];
  field: FieldRuntimeView;
  checkpoint: Cp1CheckpointState;
  openResponse: {
    eligible: OpenResponsePrompt[];
    activePrompt: OpenResponsePrompt | null;
    evidence: FormativeEvidenceRecord[];
    npcFollowups: AuthoredNpcFollowupView[];
    archiveConnections: ArchiveConnectionView[];
  };
}
