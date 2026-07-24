import type { JobObjectCondition, JobObjectCustody } from "./state.js";
import type {
  DeterministicResolution,
  OpenResponseReference,
  TypesetArtifactReference,
} from "./openResponse.js";

export const FIELD_STATE_VERSION = 4 as const;

export const HEAT_BANDS = ["CALM", "NOTICED", "WATCHED", "HUNTED"] as const;
export type HeatBand = (typeof HEAT_BANDS)[number];

export type HeatTransitionCause =
  | "DETECTION"
  | "INSPECTION"
  | "FAILED_TALK"
  | "RUN"
  | "CONFISCATION"
  | "DECAY"
  | "VOUCH"
  | "CITED"
  | "LEGACY_MIGRATION";

export interface HeatTransitionRecord {
  eventId: string;
  from: HeatBand;
  to: HeatBand;
  cause: HeatTransitionCause;
}

export interface HeatDecayProgress {
  band: HeatBand;
  elapsedSeconds: number;
  requiredSeconds: number | null;
  paused: boolean;
}

export interface HeatState {
  band: HeatBand;
  decay: HeatDecayProgress;
  history: HeatTransitionRecord[];
  authority: "LEGACY_WATCHER_HEAT" | "FIELD_EVENTS";
}

export const STANDING_BANDS = ["MARKED", "NEUTRAL", "FAMILIAR", "TRUSTED"] as const;
export type StandingBand = (typeof STANDING_BANDS)[number];

export interface StandingChangeRecord {
  eventId: string;
  delta: number;
  causeId: string;
}

export interface StandingState {
  /** Runtime-only social score. Presenter-facing views expose only `band`. */
  points: number;
  band: StandingBand;
  history: StandingChangeRecord[];
}

/**
 * Branded thread id (a chapter-minted stable id string, e.g. Boston's Ned
 * thread). The concrete vocabulary is chapter content
 * (FieldVocabulary.threadIds), validated at session creation and on every
 * committed thread event.
 */
export type ThreadId = string & { readonly __brand: "PA.ThreadId" };

/**
 * Stable thread-flag map. The concrete flag vocabulary is chapter content
 * (FieldVocabulary.threadFlags); the reducer rejects unknown flags at commit
 * time, so the protocol keys stay plain strings.
 */
export type ThreadFlagMap = Partial<Record<string, boolean>>;

export const THREAD_STATUSES = ["UNMET", "OPEN", "ACTIVE", "DORMANT", "COMPLETE"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export interface ThreadState {
  threadId: ThreadId;
  flags: ThreadFlagMap;
  status: ThreadStatus;
  trust: number;
  breadcrumb: string | null;
}

/**
 * Branded optional-activity id (e.g. "SJ-tavern-note"). The concrete
 * vocabulary is chapter content (FieldVocabulary.activityIds).
 */
export type OptionalActivityId = string & {
  readonly __brand: "PA.ActivityId";
};

export const OPTIONAL_ACTIVITY_STAGES = [
  "AVAILABLE",
  "ACCEPTED",
  "CARRYING",
  "BALANCING",
  "READY_HANDOFF",
  "COMPLETED",
  "DORMANT",
] as const;
export type OptionalActivityStage = (typeof OPTIONAL_ACTIVITY_STAGES)[number];

export interface OptionalActivityState {
  activityId: OptionalActivityId;
  stage: OptionalActivityStage;
  breadcrumb: string | null;
}

/**
 * Branded micro-concept id (e.g. "MICRO.LIBERTY_TREE"). The concrete
 * vocabulary is chapter content (FieldVocabulary.microConceptIds), validated
 * on every micro engagement.
 */
export type MicroConceptId = string & { readonly __brand: "PA.MicroConceptId" };

export interface MicroEngagementRecord {
  recordId: string;
  microConceptId: MicroConceptId;
  sourceId: string;
  interactionOrdinal: number;
  provenance?: {
    sourcePacketIds: string[];
    claimIds?: string[];
    evidenceIds?: string[];
    contentPackageHash?: string;
  };
}

export interface SourceEngagementRecord {
  recordId: string;
  sourcePacketId: string;
  backingSourceId: string;
  interactionOrdinal: number;
  contentPackageHash: string;
  reviewStatus: "AUTHOR_DRAFT" | "HISTORICAL_REVIEW_PENDING" | "SME_APPROVED";
}

export interface ReactiveCompletionRecord {
  interactionId: string;
  sourceId: string;
  outcomeId: string;
  interactionOrdinal: number;
}

export interface OpenResponseCompletionRecord {
  promptId: string;
  response: OpenResponseReference;
  artifact: TypesetArtifactReference;
  progressionAuthority: false;
  rawTextInSave: false;
  resolution: DeterministicResolution;
  interactionOrdinal: number;
}

export interface ReactiveCompletionEffects {
  interactionId: string;
  sourceId: string;
  outcomeId: string;
  standing?: { delta: number; causeId: string };
  threads?: {
    threadId: ThreadId;
    flags?: ThreadFlagMap;
    status?: ThreadStatus;
    trustDelta?: number;
    breadcrumb?: string | null;
  }[];
  micros?: MicroConceptId[];
  activities?: {
    activityId: OptionalActivityId;
    stage: OptionalActivityStage;
    breadcrumb?: string | null;
  }[];
  custody?: {
    objectId: string;
    custody: JobObjectCustody;
    condition?: JobObjectCondition;
    concealment?: CompatibleConcealmentState;
  }[];
  clockUnits?: number;
  rumors?: string[];
  // Owned-route unlocks (Quests-and-NPCs §2A): completing a living
  // route grants a persistent, reusable capability. The routeId lands in
  // world.routes as UNLOCKED; the label appears in the Archive ROUTES pane
  // and powers R3 reminders.
  routes?: { routeId: string; label: string }[];
  relationships?: {
    relationshipId: string;
    delta: number;
    causeId: string;
  }[];
  identity?: {
    recognized?: boolean;
    clarkeMarked?: boolean;
    reason: string;
  };
  heat?: {
    to: HeatBand;
    cause: HeatTransitionCause;
  };
}

export type ConcealmentState = "EXPOSED" | "WRAPPED" | "HIDDEN";
export type LegacyConcealmentOutcome = "EXPOSED" | "CONCEALED";
export type CompatibleConcealmentState = ConcealmentState | LegacyConcealmentOutcome;

export function normalizeConcealment(value: CompatibleConcealmentState): ConcealmentState {
  return value === "CONCEALED" ? "WRAPPED" : value;
}

export function legacyConcealmentOutcome(value: CompatibleConcealmentState): LegacyConcealmentOutcome {
  return normalizeConcealment(value) === "EXPOSED" ? "EXPOSED" : "CONCEALED";
}

export function heatBandForLegacyWatcherHeat(watcherHeat: number): HeatBand {
  if (!Number.isFinite(watcherHeat) || watcherHeat <= 0) return "CALM";
  if (watcherHeat < 2) return "NOTICED";
  if (watcherHeat < 3) return "WATCHED";
  return "HUNTED";
}

export function standingBandForPoints(points: number): StandingBand {
  if (points < 0) return "MARKED";
  if (points < 5) return "NEUTRAL";
  if (points < 12) return "FAMILIAR";
  return "TRUSTED";
}

export interface FieldIdentityState {
  clarkeMarked: boolean;
  recognized: boolean;
}

export function legacyFieldIdentity(input: {
  clarkeInformed?: boolean;
  clarkeMarked?: boolean;
  recognized?: boolean;
}): FieldIdentityState {
  return {
    clarkeMarked: input.clarkeMarked ?? input.clarkeInformed ?? false,
    recognized: input.recognized ?? false,
  };
}

export type FieldInterruptKind =
  | "CONFRONTATION"
  | "CHASE"
  | "REACTIVE_EXCHANGE"
  | "OPEN_RESPONSE";

export interface FieldInterruptPlan {
  interruptId: string;
  kind: FieldInterruptKind;
  phase: "ACTIVE";
  sourceId?: string;
}

export interface WatcherChallengeRecord {
  interruptId: string;
  challengeId: string;
  watcherId: string;
  reason: "SUSPICION" | "CHECKPOINT" | "CLARKE_INFORMED";
}

export type ConfrontationChoice = "COMPLY" | "TALK" | "RUN" | "CITE";
export type ConfrontationPhase =
  | "CHOOSING"
  | "INSPECTING"
  | "RESOLVING"
  | "TALK_FAILED"
  | "CHASE_ACTIVE";
export type ConfrontationOutcome =
  | "COMPLIED_CLEAR"
  | "COMPLIED_CONFISCATED"
  | "TALK_RELEASED"
  | "CITED_RELEASED"
  | "CHASE_ESCAPED"
  | "CHASE_REFUGE"
  | "CHASE_CAUGHT";

// ---------------------------------------------------------------------------
// Knowledge as ammunition (design1 feature 2). A durable engaged micro-concept
// can arm ONE cited dialogue option in a watcher confrontation: the runtime
// offers it (projected on the field view), validates it, and resolves its
// deterministic effects. The web renders exactly what the runtime offers —
// the cited option replaces the generic Talk, preserving the three-option
// panel. Knowledge is never required: Comply/Talk/Run remain untouched for
// players without the flag, and the Talk failure path is unchanged.
// ---------------------------------------------------------------------------
export interface CitedConfrontationOption {
  choice: "CITE";
  microConceptId: MicroConceptId;
  /** Button label, player voice. */
  label: string;
  /** The line the runner actually says. */
  line: string;
  /** The officer's stand-down reply. */
  reply: string;
}

export interface ConfrontationRecord extends WatcherChallengeRecord {
  phase: ConfrontationPhase;
  lastChoice?: ConfrontationChoice;
  outcome?: ConfrontationOutcome;
}

export interface ChaseRecord {
  interruptId: string;
  chaseId: string;
  sourceId: string;
  outcome?: "ESCAPED" | "REFUGE" | "CAUGHT";
}

export interface RepositionIntent {
  eventId: string;
  interruptId: string;
  locationId: string;
  anchorId: string;
  reason: "RELEASE" | "REFUGE" | "REROUTE";
}

// A chapter-authored, runtime-validated reposition target. The vocabulary of
// anchor ids is chapter content (see FieldVocabulary.repositionAnchors).
export interface FieldRepositionAnchor {
  locationId: string;
  reason: RepositionIntent["reason"];
}

export interface FieldDurableState {
  version: typeof FIELD_STATE_VERSION;
  heat: HeatState;
  standing: StandingState;
  threads: Record<ThreadId, ThreadState>;
  activities: Record<OptionalActivityId, OptionalActivityState>;
  rumors: string[];
  appliedRelationshipCauses: string[];
  reactiveCompletions: Record<string, ReactiveCompletionRecord>;
  openResponseCompletions: Record<string, OpenResponseCompletionRecord>;
  microEngagements: Record<string, MicroEngagementRecord>;
  sourceEngagements: Record<string, SourceEngagementRecord>;
  engagedMicroIds: MicroConceptId[];
  identity: FieldIdentityState;
  lastChallenge: WatcherChallengeRecord | null;
  activeConfrontation: ConfrontationRecord | null;
  confrontationHistory: ConfrontationRecord[];
  activeChase: ChaseRecord | null;
  chaseHistory: ChaseRecord[];
  pendingReposition: RepositionIntent | null;
  discoveredMapIds: string[];
}

export interface FieldRuntimeView {
  version: typeof FIELD_STATE_VERSION;
  seedHex: string;
  heat: HeatState;
  standing: { band: StandingBand };
  threads: Record<ThreadId, ThreadState>;
  activities: Record<OptionalActivityId, OptionalActivityState>;
  rumors: string[];
  engagedMicroIds: MicroConceptId[];
  openResponseCompletions: OpenResponseCompletionRecord[];
  reactiveCompletions: ReactiveCompletionRecord[];
  sourceEngagements: SourceEngagementRecord[];
  interactionOrdinal: number;
  identity: FieldIdentityState;
  concealmentByObjectId: Record<string, ConcealmentState>;
  /** Carried job goods eligible for bounded chase confiscation. */
  carriedObjectIds: string[];
  /** Job goods removed by a bounded field consequence. */
  confiscatedObjectIds: string[];
  lastChallenge: WatcherChallengeRecord | null;
  activeConfrontation: ConfrontationRecord | null;
  /**
   * The one cited option the runtime offers for the ACTIVE confrontation
   * (null unless a confrontation is CHOOSING and its arming micro is
   * durably engaged). Presenters render exactly this — never their own copy.
   */
  citedConfrontationOption: CitedConfrontationOption | null;
  confrontationHistory: ConfrontationRecord[];
  activeChase: ChaseRecord | null;
  chaseHistory: ChaseRecord[];
  pendingReposition: RepositionIntent | null;
  discoveredMapIds: string[];
  activeInterrupt: FieldInterruptPlan | null;
}

interface FieldEventMeta {
  eventId: string;
  interruptId?: string;
}

export type FieldCommittedEvent =
  | (FieldEventMeta & {
      type: "FIELD_HEAT_TRANSITION";
      from: HeatBand;
      to: HeatBand;
      cause: HeatTransitionCause;
    })
  | (FieldEventMeta & {
      type: "FIELD_HEAT_DECAY_CHECKPOINT";
      band: HeatBand;
      elapsedSeconds: number;
      paused: boolean;
    })
  | (FieldEventMeta & {
      type: "FIELD_STANDING_DELTA";
      delta: number;
      causeId: string;
    })
  | (FieldEventMeta & {
      type: "FIELD_THREAD_PATCH";
      threadId: ThreadId;
      flags: ThreadFlagMap;
    })
  | (FieldEventMeta & {
      type: "FIELD_MICRO_ENGAGED";
      record: MicroEngagementRecord;
    })
  | {
      type: "FIELD_REACTIVE_COMPLETED";
      eventId: string;
      interruptId: string;
      completion: ReactiveCompletionEffects;
    }
  | {
      type: "FIELD_REACTIVE_OUTCOME_SELECTED";
      eventId: string;
      interruptId: string;
      interactionId: string;
      sourceId: string;
      outcomeId: string;
    }
  | {
      type: "FIELD_INTERRUPT_STARTED";
      eventId: string;
      interruptId: string;
      interruptKind: "CONFRONTATION" | "REACTIVE_EXCHANGE";
      sourceId: string;
    }
  | {
      type: "FIELD_OPEN_RESPONSE_STARTED";
      eventId: string;
      interruptId: string;
      promptId: string;
    }
  | {
      type: "FIELD_OPEN_RESPONSE_SUBMITTED";
      eventId: string;
      interruptId: string;
      promptId: string;
      response: OpenResponseReference;
      artifact: TypesetArtifactReference;
      resolution: DeterministicResolution;
    }
  | {
      type: "FIELD_WATCHER_CHALLENGE";
      eventId: string;
      interruptId: string;
      challengeId: string;
      watcherId: string;
      reason: WatcherChallengeRecord["reason"];
    }
  | {
      type: "FIELD_CONFRONTATION_DECISION";
      eventId: string;
      interruptId: string;
      choice: ConfrontationChoice;
    }
  | {
      type: "FIELD_CONFRONTATION_RESOLVED";
      eventId: string;
      interruptId: string;
      outcome:
        | "COMPLIED_CLEAR"
        | "COMPLIED_CONFISCATED"
        | "TALK_RELEASED"
        | "CITED_RELEASED";
    }
  | (FieldEventMeta & {
      type: "FIELD_IDENTITY_CHANGED";
      recognized?: boolean;
      clarkeMarked?: boolean;
      reason: string;
    })
  | {
      type: "FIELD_CHASE_STARTED";
      eventId: string;
      interruptId: string;
      chaseId: string;
      sourceId: string;
    }
  | {
      type: "FIELD_CHASE_RESOLVED";
      eventId: string;
      interruptId: string;
      chaseId: string;
      outcome: "ESCAPED" | "REFUGE" | "CAUGHT";
    }
  | {
      type: "FIELD_INTERRUPT_RESOLVED";
      eventId: string;
      interruptId: string;
      outcome: string;
    }
  | {
      type: "FIELD_CUSTODY_CHANGED";
      eventId: string;
      interruptId: string;
      objectId: string;
      custody: JobObjectCustody;
      condition?: JobObjectCondition;
      concealment?: CompatibleConcealmentState;
      reason: string;
    }
  | {
      type: "FIELD_CLOCK_ADVANCED";
      eventId: string;
      interruptId: string;
      units: number;
      reason: string;
    }
  | {
      type: "FIELD_REPOSITION_INTENT";
      eventId: string;
      interruptId: string;
      locationId: string;
      anchorId: string;
      reason: RepositionIntent["reason"];
    }
  | (FieldEventMeta & {
      type: "FIELD_REPOSITION_APPLIED";
      intentEventId: string;
    })
  | (FieldEventMeta & {
      type: "FIELD_MAP_DISCOVERED";
      landmarkId: string;
    });

export type FieldEphemeralEvent =
  | { type: "FIELD_SUSPICION_FRAME"; watcherId: string; suspicion: number }
  | { type: "FIELD_STAMINA_FRAME"; stamina: number }
  | {
      type: "FIELD_TRANSFORM_FRAME";
      actorId: string;
      position: readonly [number, number, number];
      forward: readonly [number, number, number];
    };

const FIELD_COMMITTED_EVENT_TYPES = new Set<FieldCommittedEvent["type"]>([
  "FIELD_HEAT_TRANSITION",
  "FIELD_HEAT_DECAY_CHECKPOINT",
  "FIELD_STANDING_DELTA",
  "FIELD_THREAD_PATCH",
  "FIELD_MICRO_ENGAGED",
  "FIELD_REACTIVE_COMPLETED",
  "FIELD_REACTIVE_OUTCOME_SELECTED",
  "FIELD_INTERRUPT_STARTED",
  "FIELD_OPEN_RESPONSE_STARTED",
  "FIELD_OPEN_RESPONSE_SUBMITTED",
  "FIELD_WATCHER_CHALLENGE",
  "FIELD_CONFRONTATION_DECISION",
  "FIELD_CONFRONTATION_RESOLVED",
  "FIELD_IDENTITY_CHANGED",
  "FIELD_CHASE_STARTED",
  "FIELD_CHASE_RESOLVED",
  "FIELD_INTERRUPT_RESOLVED",
  "FIELD_CUSTODY_CHANGED",
  "FIELD_CLOCK_ADVANCED",
  "FIELD_REPOSITION_INTENT",
  "FIELD_REPOSITION_APPLIED",
  "FIELD_MAP_DISCOVERED",
]);

export function isFieldEventLike(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("FIELD_");
}

export function isFieldCommittedEvent(value: unknown): value is FieldCommittedEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && FIELD_COMMITTED_EVENT_TYPES.has(type as FieldCommittedEvent["type"]);
}
