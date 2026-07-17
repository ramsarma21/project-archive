import type { WarningStage, DayPhase } from "./constants.js";

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
  | "NARRATOR";

export type Glyph = "SPEECH" | "INTERACTION" | "NONE";

export type PresentationDirective =
  | { kind: "SCENE"; locationId: string; text: string }
  | { kind: "NARRATION"; text: string }
  | { kind: "DIALOGUE"; speaker: Speaker; glyph: Glyph; text: string }
  | { kind: "ARCHIVE"; text: string }
  | { kind: "AMBIENT_CHATTER"; text: string }
  | { kind: "READ_PANEL"; objectId: string; title: string; body: string }
  | { kind: "FLICKER"; flicker: FlickerKind; label: string }
  | { kind: "CLOCK_UPDATE"; spentUnits: number; phase: DayPhase; warningStage: WarningStage }
  | { kind: "OBJECTIVE_STRIP"; lines: ObjectiveLine[] }
  | { kind: "RELATIONSHIP_CARD"; character: string; dimension: string; direction: "UP" | "DOWN"; label: string }
  | { kind: "DAY_END_CARD"; card: DayEndCard };

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

export type MechanicKind = "PRESS" | "EFFORT" | "SORT" | "PLACE";

export interface MechanicParams {
  kind: MechanicKind;
  // PRESS: oscillating + accelerating needle; presenter emits stopOffset 0..1
  // EFFORT: hold-to-fill; presenter emits holdMs
  // SORT: buckets; presenter emits assignments
  // PLACE: line-up + tack; presenter emits alignment 0..1
  prompt: string;
  sortItems?: { itemId: string; label: string }[];
  sortBuckets?: { bucketId: string; label: string }[];
}

export type InputRequest =
  | { kind: "CONTINUE"; label?: string }
  | { kind: "ACK"; text: string }
  | { kind: "CHOICE"; promptId: string; frame: string; options: ChoiceOption[]; mechanic?: MechanicParams }
  | { kind: "MECHANIC"; promptId: string; params: MechanicParams }
  | { kind: "FOCUS_READ"; objectId: string; title: string; teaser: string }
  | { kind: "FREE_ROAM"; targets: FreeRoamTarget[]; canProceed: boolean }
  | { kind: "DAY_END" };

export interface FreeRoamTarget {
  targetId: string;
  label: string;
  marker: "BLUE" | "GOLD" | "HIDDEN";
}

// ============================================================================
// Presenter events: typed input the presenter returns to the runtime.
// ============================================================================

export type PresenterEvent =
  | { type: "CONTINUE" }
  | { type: "ACK" }
  | { type: "CHOICE_SELECTED"; promptId: string; choiceId: string }
  | { type: "MECHANIC_RESULT"; promptId: string; result: MechanicRawResult }
  | { type: "FOCUS_READ_OPENED"; objectId: string }
  | { type: "FOCUS_READ_SKIPPED"; objectId: string }
  | { type: "FREE_ROAM_GOTO"; targetId: string }
  | { type: "FREE_ROAM_IDLE" };

export type MechanicRawResult =
  | { kind: "PRESS"; stopOffset: number } // 0..1 position of oscillating needle when stopped
  | { kind: "EFFORT"; holdMs: number }
  | { kind: "SORT"; assignments: { itemId: string; bucketId: string }[] }
  | { kind: "PLACE"; alignment: number }; // 0..1

// ============================================================================
// A single runtime step: directives to render + the input it now awaits.
// ============================================================================

export interface ExecutionPlan {
  present: PresentationDirective[];
  request: InputRequest;
}

// ============================================================================
// Worker message protocol (main thread <-> runtime worker).
// ============================================================================

export type WorkerRequest =
  | { id: number; type: "INIT"; payload: InitPayload }
  | { id: number; type: "EVENT"; payload: PresenterEvent }
  | { id: number; type: "SNAPSHOT" };

export interface InitPayload {
  profileId: string;
  chapterId: string;
  variationRootSeedHex: string; // 32 bytes hex
  priorEvents: PresenterEvent[]; // for resume
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
  relationships: Record<string, number>;
  routes: Record<string, string>;
  learner: Record<string, { understanding: string; demonstration: string; occasions: number; types: number }>;
  notes: { concept: string; body: string }[];
  peopleMet: string[];
  routesUnlocked: string[];
}
