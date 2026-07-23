import {
  HEAT_BANDS,
  FIELD_STATE_VERSION,
  FIELD_REPOSITION_ANCHORS,
  MICRO_CONCEPT_IDS,
  DeterministicResolutionSchema,
  OpenResponseReferenceSchema,
  OPTIONAL_ACTIVITY_IDS,
  OPTIONAL_ACTIVITY_STAGES,
  THREAD_IDS,
  THREAD_STATUSES,
  THREAD_STABLE_FLAGS,
  heatBandForLegacyWatcherHeat,
  legacyFieldIdentity,
  normalizeConcealment,
  standingBandForPoints,
  type FieldCommittedEvent,
  type FieldDurableState,
  type FieldInterruptPlan,
  type FieldRuntimeView,
  type HeatBand,
  type MicroConceptId,
  type ThreadId,
  type WorldState,
} from "@pa/contracts";
import { advanceClock } from "./world.js";
import { canonicalSourceIds } from "./content/provenance.js";
import { ACT1_OPEN_RESPONSE_PACKAGE_HASH } from "./assessment/openResponseRegistry.js";

const HEAT_DECAY_SECONDS: Record<HeatBand, number | null> = {
  CALM: null,
  NOTICED: 90,
  WATCHED: 60,
  HUNTED: 45,
};

const MICRO_IDS = new Set<string>(Object.values(MICRO_CONCEPT_IDS));
const THREAD_ID_SET = new Set<string>(Object.values(THREAD_IDS));
const THREAD_FLAGS = new Set<string>(THREAD_STABLE_FLAGS);
const THREAD_STATUS_SET = new Set<string>(THREAD_STATUSES);
const ACTIVITY_ID_SET = new Set<string>(Object.values(OPTIONAL_ACTIVITY_IDS));
const ACTIVITY_STAGE_SET = new Set<string>(OPTIONAL_ACTIVITY_STAGES);
const HEAT_BAND_SET = new Set<string>(HEAT_BANDS);
const CUSTODY = new Set([
  "ABIGAIL",
  "PLAYER",
  "THOMAS",
  "PIKE",
  "CUSTOMHOUSE",
  "RIDER",
  "DOCKHAND",
  "TAVERN_KEEPER",
  "SHIP",
  "CONFISCATED",
]);
const CONDITION = new Set([
  "INTACT",
  "UNPRINTED",
  "CRISP",
  "USABLE",
  "SMUDGED",
  "CREASED",
  "LOST",
]);
const CONCEALMENT = new Set(["EXPOSED", "WRAPPED", "HIDDEN", "CONCEALED"]);

function decayProgress(band: HeatBand): FieldDurableState["heat"]["decay"] {
  return {
    band,
    elapsedSeconds: 0,
    requiredSeconds: HEAT_DECAY_SECONDS[band],
    paused: false,
  };
}

export function initialFieldState(world: WorldState): FieldDurableState {
  const band = heatBandForLegacyWatcherHeat(world.attention.watcherHeat);
  return {
    version: FIELD_STATE_VERSION,
    heat: {
      band,
      decay: decayProgress(band),
      history: [],
      authority: "LEGACY_WATCHER_HEAT",
    },
    standing: {
      points: 0,
      band: "NEUTRAL",
      history: [],
    },
    threads: {
      [THREAD_IDS.NED]: {
        threadId: THREAD_IDS.NED,
        flags: {},
        status: "UNMET",
        trust: 0,
        breadcrumb: null,
      },
      [THREAD_IDS.SARAH]: {
        threadId: THREAD_IDS.SARAH,
        flags: {},
        status: "UNMET",
        trust: 0,
        breadcrumb: null,
      },
    },
    activities: {
      [OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE]: {
        activityId: OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE,
        stage: "AVAILABLE",
        breadcrumb: null,
      },
      [OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]: {
        activityId: OPTIONAL_ACTIVITY_IDS.DOCK_HAUL,
        stage: "AVAILABLE",
        breadcrumb: null,
      },
      [OPTIONAL_ACTIVITY_IDS.ROOF_KID]: {
        activityId: OPTIONAL_ACTIVITY_IDS.ROOF_KID,
        stage: "AVAILABLE",
        breadcrumb: null,
      },
      [OPTIONAL_ACTIVITY_IDS.CRIER]: {
        activityId: OPTIONAL_ACTIVITY_IDS.CRIER,
        stage: "AVAILABLE",
        breadcrumb: null,
      },
      [OPTIONAL_ACTIVITY_IDS.ROPEWALK]: {
        activityId: OPTIONAL_ACTIVITY_IDS.ROPEWALK,
        stage: "AVAILABLE",
        breadcrumb: null,
      },
      [OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE]: {
        activityId: OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE,
        stage: "AVAILABLE",
        breadcrumb: null,
      },
      [OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN]: {
        activityId: OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN,
        stage: "DORMANT",
        breadcrumb: null,
      },
      [OPTIONAL_ACTIVITY_IDS.LOSE_WATCH]: {
        activityId: OPTIONAL_ACTIVITY_IDS.LOSE_WATCH,
        stage: "AVAILABLE",
        breadcrumb: null,
      },
    },
    rumors: [],
    appliedRelationshipCauses: [],
    reactiveCompletions: {},
    openResponseCompletions: {},
    microEngagements: {},
    sourceEngagements: {},
    engagedMicroIds: [],
    identity: legacyFieldIdentity(world.attention),
    lastChallenge: null,
    activeConfrontation: null,
    confrontationHistory: [],
    activeChase: null,
    chaseHistory: [],
    pendingReposition: null,
  };
}

// Legacy saves are projected once until the first semantic field event. The
// old number is never written by M2 and cannot regain authority afterward.
export function syncLegacyFieldCompatibility(
  field: FieldDurableState,
  world: WorldState,
): void {
  if (field.heat.authority === "LEGACY_WATCHER_HEAT") {
    const band = heatBandForLegacyWatcherHeat(world.attention.watcherHeat);
    if (field.heat.band !== band) {
      field.heat.band = band;
      field.heat.decay = decayProgress(band);
    }
  }
  const legacyIdentity = legacyFieldIdentity(world.attention);
  field.identity = {
    clarkeMarked: field.identity.clarkeMarked || legacyIdentity.clarkeMarked,
    recognized: field.identity.recognized || legacyIdentity.recognized,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function projectFieldRuntimeView(
  field: FieldDurableState,
  world: WorldState,
  seedHex: string,
  activeInterrupt: FieldInterruptPlan | null,
): FieldRuntimeView {
  const concealmentByObjectId: FieldRuntimeView["concealmentByObjectId"] = {};
  const carriedObjectIds: string[] = [];
  const confiscatedObjectIds: string[] = [];
  for (const [objectId, object] of Object.entries(world.jobObjects)) {
    if (object.concealment) {
      concealmentByObjectId[objectId] = normalizeConcealment(object.concealment);
    }
    if (object.custody === "PLAYER") carriedObjectIds.push(objectId);
    if (object.custody === "CONFISCATED") confiscatedObjectIds.push(objectId);
  }
  return {
    version: FIELD_STATE_VERSION,
    seedHex,
    heat: clone(field.heat),
    standing: { band: field.standing.band },
    threads: clone(field.threads),
    activities: clone(field.activities),
    rumors: [...field.rumors],
    engagedMicroIds: [...field.engagedMicroIds],
    openResponseCompletions: Object.values(field.openResponseCompletions)
      .map((record) => clone(record))
      .sort((a, b) => a.interactionOrdinal - b.interactionOrdinal),
    reactiveCompletions: Object.values(field.reactiveCompletions)
      .map((record) => clone(record))
      .sort((a, b) => a.interactionOrdinal - b.interactionOrdinal),
    sourceEngagements: Object.values(field.sourceEngagements)
      .map((record) => clone(record))
      .sort((a, b) => a.interactionOrdinal - b.interactionOrdinal),
    interactionOrdinal: world.currentInteractionOrdinal,
    identity: { ...field.identity },
    concealmentByObjectId,
    carriedObjectIds: carriedObjectIds.sort(),
    confiscatedObjectIds: confiscatedObjectIds.sort(),
    lastChallenge: clone(field.lastChallenge),
    activeConfrontation: clone(field.activeConfrontation),
    confrontationHistory: clone(field.confrontationHistory),
    activeChase: clone(field.activeChase),
    chaseHistory: clone(field.chaseHistory),
    pendingReposition: clone(field.pendingReposition),
    activeInterrupt: clone(activeInterrupt),
  };
}

export function applyFieldEvent(
  field: FieldDurableState,
  world: WorldState,
  event: FieldCommittedEvent,
): void {
  switch (event.type) {
    case "FIELD_HEAT_TRANSITION":
      field.heat.authority = "FIELD_EVENTS";
      field.heat.band = event.to;
      field.heat.decay = decayProgress(event.to);
      field.heat.history.push({
        eventId: event.eventId,
        from: event.from,
        to: event.to,
        cause: event.cause,
      });
      return;
    case "FIELD_HEAT_DECAY_CHECKPOINT":
      field.heat.authority = "FIELD_EVENTS";
      field.heat.decay = {
        band: event.band,
        elapsedSeconds: event.elapsedSeconds,
        requiredSeconds: HEAT_DECAY_SECONDS[event.band],
        paused: event.paused,
      };
      return;
    case "FIELD_STANDING_DELTA":
      if (
        field.standing.history.some(
          (record) => record.causeId === event.causeId,
        )
      ) {
        return;
      }
      field.standing.points += event.delta;
      field.standing.band = standingBandForPoints(field.standing.points);
      field.standing.history.push({
        eventId: event.eventId,
        delta: event.delta,
        causeId: event.causeId,
      });
      return;
    case "FIELD_THREAD_PATCH": {
      const thread = field.threads[event.threadId];
      Object.assign(thread.flags, event.flags);
      return;
    }
    case "FIELD_MICRO_ENGAGED": {
      const existing = field.microEngagements[event.record.recordId];
      if (existing) return;
      field.microEngagements[event.record.recordId] = { ...event.record };
      world.currentInteractionOrdinal = Math.max(
        world.currentInteractionOrdinal,
        event.record.interactionOrdinal,
      );
      if (!field.engagedMicroIds.includes(event.record.microConceptId)) {
        field.engagedMicroIds.push(event.record.microConceptId);
      }
      engageSourcePackets(
        field,
        event.record.sourceId,
        event.record.interactionOrdinal,
      );
      return;
    }
    case "FIELD_REACTIVE_COMPLETED": {
      const completion = event.completion;
      if (field.reactiveCompletions[completion.interactionId]) return;
      world.currentInteractionOrdinal += 1;
      const interactionOrdinal = world.currentInteractionOrdinal;
      field.reactiveCompletions[completion.interactionId] = {
        interactionId: completion.interactionId,
        sourceId: completion.sourceId,
        outcomeId: completion.outcomeId,
        interactionOrdinal,
      };
      engageSourcePackets(
        field,
        completion.sourceId,
        interactionOrdinal,
      );
      if (
        completion.standing &&
        !field.standing.history.some(
          (record) => record.causeId === completion.standing!.causeId,
        )
      ) {
        field.standing.points += completion.standing.delta;
        field.standing.band = standingBandForPoints(field.standing.points);
        field.standing.history.push({
          eventId: event.eventId,
          delta: completion.standing.delta,
          causeId: completion.standing.causeId,
        });
      }
      for (const patch of completion.threads ?? []) {
        const thread = field.threads[patch.threadId];
        if (patch.flags) Object.assign(thread.flags, patch.flags);
        if (patch.status) thread.status = patch.status;
        if (patch.trustDelta) {
          thread.trust = Math.max(-10, Math.min(10, thread.trust + patch.trustDelta));
        }
        if (patch.breadcrumb !== undefined) {
          thread.breadcrumb = patch.breadcrumb;
        }
      }
      for (const microConceptId of completion.micros ?? []) {
        const recordId = `${completion.interactionId}:${microConceptId}`;
        if (field.microEngagements[recordId]) continue;
        field.microEngagements[recordId] = {
          recordId,
          microConceptId,
          sourceId: completion.sourceId,
          interactionOrdinal,
        };
        if (!field.engagedMicroIds.includes(microConceptId)) {
          field.engagedMicroIds.push(microConceptId);
        }
      }
      for (const patch of completion.activities ?? []) {
        const activity = field.activities[patch.activityId];
        activity.stage = patch.stage;
        if (patch.breadcrumb !== undefined) {
          activity.breadcrumb = patch.breadcrumb;
        }
      }
      for (const change of completion.custody ?? []) {
        const current = world.jobObjects[change.objectId]!;
        world.jobObjects[change.objectId] = {
          ...current,
          custody: change.custody,
          condition: change.condition ?? current.condition,
          concealment: change.concealment ?? current.concealment,
        };
      }
      if (completion.clockUnits) advanceClock(world, completion.clockUnits);
      for (const rumor of completion.rumors ?? []) {
        if (!field.rumors.includes(rumor)) field.rumors.push(rumor);
      }
      for (const route of completion.routes ?? []) {
        world.routes[route.routeId] = "UNLOCKED";
      }
      for (const relationship of completion.relationships ?? []) {
        if (
          field.appliedRelationshipCauses.includes(relationship.causeId)
        ) {
          continue;
        }
        const current = world.relationships[relationship.relationshipId] ?? 0;
        world.relationships[relationship.relationshipId] = Math.max(
          -100,
          Math.min(100, current + relationship.delta),
        );
        field.appliedRelationshipCauses.push(relationship.causeId);
      }
      if (completion.identity) {
        field.identity = {
          recognized:
            completion.identity.recognized ?? field.identity.recognized,
          clarkeMarked:
            completion.identity.clarkeMarked ?? field.identity.clarkeMarked,
        };
      }
      if (completion.heat && completion.heat.to !== field.heat.band) {
        const from = field.heat.band;
        field.heat.authority = "FIELD_EVENTS";
        field.heat.band = completion.heat.to;
        field.heat.decay = decayProgress(completion.heat.to);
        field.heat.history.push({
          eventId: event.eventId,
          from,
          to: completion.heat.to,
          cause: completion.heat.cause,
        });
      }
      return;
    }
    case "FIELD_REACTIVE_OUTCOME_SELECTED":
      throw new Error(
        "FIELD_EVENT_INVALID: stable reactive outcomes must be resolved by the runtime registry",
      );
    case "FIELD_OPEN_RESPONSE_STARTED":
      return;
    case "FIELD_OPEN_RESPONSE_SUBMITTED": {
      if (field.openResponseCompletions[event.promptId]) return;
      world.currentInteractionOrdinal += 1;
      field.openResponseCompletions[event.promptId] = {
        promptId: event.promptId,
        response: clone(event.response),
        resolution: clone(event.resolution),
        interactionOrdinal: world.currentInteractionOrdinal,
      };
      return;
    }
    case "FIELD_WATCHER_CHALLENGE": {
      field.lastChallenge = {
        interruptId: event.interruptId,
        challengeId: event.challengeId,
        watcherId: event.watcherId,
        reason: event.reason,
      };
      field.activeConfrontation = {
        ...field.lastChallenge,
        phase: "CHOOSING",
      };
      return;
    }
    case "FIELD_CONFRONTATION_DECISION": {
      const confrontation = field.activeConfrontation!;
      confrontation.lastChoice = event.choice;
      if (event.choice === "RUN") {
        confrontation.phase = "CHASE_ACTIVE";
        return;
      }
      if (event.choice === "COMPLY") {
        const exposed = Object.values(world.jobObjects).some(
          (object) =>
            object.custody === "PLAYER" &&
            normalizeConcealment(object.concealment ?? "EXPOSED") === "EXPOSED",
        );
        confrontation.phase = "INSPECTING";
        confrontation.outcome = exposed
          ? "COMPLIED_CONFISCATED"
          : "COMPLIED_CLEAR";
        return;
      }
      const standingScore =
        field.standing.band === "TRUSTED" || field.standing.band === "FAMILIAR"
          ? 2
          : field.standing.band === "MARKED"
            ? -2
            : 0;
      const heatScore =
        field.heat.band === "CALM"
          ? 2
          : field.heat.band === "NOTICED"
            ? 1
            : field.heat.band === "WATCHED"
              ? 0
              : -1;
      const clarkePenalty = field.identity.clarkeMarked ? -2 : 0;
      if (standingScore + heatScore + clarkePenalty >= 1) {
        confrontation.phase = "RESOLVING";
        confrontation.outcome = "TALK_RELEASED";
      } else {
        confrontation.phase = "TALK_FAILED";
      }
      return;
    }
    case "FIELD_CONFRONTATION_RESOLVED": {
      const confrontation = field.activeConfrontation!;
      const targetHeat =
        event.outcome === "COMPLIED_CONFISCATED" ? "HUNTED" : "WATCHED";
      if (HEAT_BANDS.indexOf(field.heat.band) < HEAT_BANDS.indexOf(targetHeat)) {
        const from = field.heat.band;
        field.heat.authority = "FIELD_EVENTS";
        field.heat.band = targetHeat;
        field.heat.decay = decayProgress(targetHeat);
        field.heat.history.push({
          eventId: event.eventId,
          from,
          to: targetHeat,
          cause:
            event.outcome === "COMPLIED_CONFISCATED"
              ? "CONFISCATION"
              : "INSPECTION",
        });
      }
      if (event.outcome.startsWith("COMPLIED")) {
        field.identity.recognized = true;
        advanceClock(world, 1);
      }
      if (event.outcome === "COMPLIED_CONFISCATED") {
        for (const [objectId, object] of Object.entries(world.jobObjects)) {
          if (
            object.custody === "PLAYER" &&
            normalizeConcealment(object.concealment ?? "EXPOSED") === "EXPOSED"
          ) {
            world.jobObjects[objectId] = {
              ...object,
              custody: "CONFISCATED",
              condition: "LOST",
              concealment: "EXPOSED",
            };
          }
        }
      }
      const recordId = `WRITS_${confrontation.challengeId}`;
      if (!field.microEngagements[recordId]) {
        const record = {
          recordId,
          microConceptId: MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE,
          sourceId: confrontation.challengeId,
          interactionOrdinal: world.currentInteractionOrdinal,
        };
        field.microEngagements[recordId] = record;
        if (!field.engagedMicroIds.includes(record.microConceptId)) {
          field.engagedMicroIds.push(record.microConceptId);
        }
      }
      confrontation.outcome = event.outcome;
      confrontation.phase = "RESOLVING";
      field.confrontationHistory.push({ ...confrontation });
      field.activeConfrontation = null;
      return;
    }
    case "FIELD_IDENTITY_CHANGED":
      field.identity = {
        clarkeMarked: event.clarkeMarked ?? field.identity.clarkeMarked,
        recognized: event.recognized ?? field.identity.recognized,
      };
      return;
    case "FIELD_CHASE_STARTED":
      field.activeChase = {
        interruptId: event.interruptId,
        chaseId: event.chaseId,
        sourceId: event.sourceId,
      };
      if (field.activeConfrontation) {
        field.activeConfrontation.phase = "CHASE_ACTIVE";
      }
      return;
    case "FIELD_CHASE_RESOLVED": {
      const resolved = {
        ...field.activeChase!,
        outcome: event.outcome,
      };
      field.chaseHistory.push(resolved);
      field.activeChase = null;
      // The challenge happened face-to-face before the run: escaping keeps
      // your face known to the watch (design: "the watch remembers faces
      // that run"), exactly like complying does.
      field.identity.recognized = true;
      // Running from a writ-backed stop teaches the writ as surely as
      // submitting to it — record the micro on every chase resolution (the
      // comply/talk path records it via FIELD_CONFRONTATION_RESOLVED).
      const recordId = `WRITS_CHASE_${event.chaseId}`;
      if (!field.microEngagements[recordId]) {
        const record = {
          recordId,
          microConceptId: MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE,
          sourceId: resolved.sourceId,
          interactionOrdinal: world.currentInteractionOrdinal,
        };
        field.microEngagements[recordId] = record;
        if (!field.engagedMicroIds.includes(record.microConceptId)) {
          field.engagedMicroIds.push(record.microConceptId);
        }
      }
      if (field.activeConfrontation) {
        field.activeConfrontation.outcome =
          event.outcome === "CAUGHT"
            ? "CHASE_CAUGHT"
            : event.outcome === "REFUGE"
              ? "CHASE_REFUGE"
              : "CHASE_ESCAPED";
        field.confrontationHistory.push({ ...field.activeConfrontation });
        field.activeConfrontation = null;
      }
      return;
    }
    case "FIELD_CUSTODY_CHANGED": {
      const current = world.jobObjects[event.objectId]!;
      world.jobObjects[event.objectId] = {
        ...current,
        custody: event.custody,
        condition: event.condition ?? current.condition,
        concealment: event.concealment ?? current.concealment,
      };
      return;
    }
    case "FIELD_CLOCK_ADVANCED":
      advanceClock(world, event.units);
      return;
    case "FIELD_REPOSITION_INTENT":
      world.locationId = event.locationId;
      field.pendingReposition = {
        eventId: event.eventId,
        interruptId: event.interruptId,
        locationId: event.locationId,
        anchorId: event.anchorId,
        reason: event.reason,
      };
      return;
    case "FIELD_REPOSITION_APPLIED":
      if (field.pendingReposition?.eventId === event.intentEventId) {
        field.pendingReposition = null;
      }
      return;
    case "FIELD_INTERRUPT_RESOLVED":
      if (field.activeConfrontation) {
        field.confrontationHistory.push({
          ...field.activeConfrontation,
          outcome:
            field.activeConfrontation.outcome ??
            (event.outcome as FieldDurableState["confrontationHistory"][number]["outcome"]),
        });
        field.activeConfrontation = null;
      }
      return;
    case "FIELD_INTERRUPT_STARTED":
      return;
  }
}

function engageSourcePackets(
  field: FieldDurableState,
  backingSourceId: string,
  interactionOrdinal: number,
): void {
  for (const sourcePacketId of canonicalSourceIds(backingSourceId)) {
    const recordId = `${sourcePacketId}:${backingSourceId}`;
    if (field.sourceEngagements[recordId]) continue;
    field.sourceEngagements[recordId] = {
      recordId,
      sourcePacketId,
      backingSourceId,
      interactionOrdinal,
      contentPackageHash: ACT1_OPEN_RESPONSE_PACKAGE_HASH,
      reviewStatus: "HISTORICAL_REVIEW_PENDING",
    };
  }
}

function fail(message: string): never {
  throw new Error(`FIELD_EVENT_INVALID: ${message}`);
}

function nonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${name} must be a non-empty string`);
}

function finite(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} must be finite`);
}

export function assertFieldEventPayload(
  event: FieldCommittedEvent,
  field: FieldDurableState,
  world: WorldState,
): void {
  nonEmpty(event.eventId, "eventId");
  if ("interruptId" in event && event.interruptId !== undefined) {
    nonEmpty(event.interruptId, "interruptId");
  }

  switch (event.type) {
    case "FIELD_HEAT_TRANSITION": {
      if (!HEAT_BAND_SET.has(event.from) || !HEAT_BAND_SET.has(event.to)) fail("unknown heat band");
      if (event.from !== field.heat.band) fail(`heat transition expected ${field.heat.band}, received ${event.from}`);
      if (
        event.from === event.to &&
        event.cause !== "LEGACY_MIGRATION"
      ) {
        fail("heat transition must change band");
      }
      if (
        event.cause === "LEGACY_MIGRATION" &&
        event.from !== event.to
      ) {
        fail("legacy migration must preserve the projected heat band");
      }
      if (event.cause === "DECAY") {
        const from = HEAT_BANDS.indexOf(event.from);
        const to = HEAT_BANDS.indexOf(event.to);
        if (to !== from - 1) fail("decay must move down exactly one heat band");
      }
      return;
    }
    case "FIELD_HEAT_DECAY_CHECKPOINT": {
      if (!HEAT_BAND_SET.has(event.band) || event.band !== field.heat.band) fail("decay band is not current");
      finite(event.elapsedSeconds, "elapsedSeconds");
      if (event.elapsedSeconds < 0) fail("elapsedSeconds cannot be negative");
      const required = HEAT_DECAY_SECONDS[event.band];
      if (required === null && event.elapsedSeconds !== 0) fail("CALM cannot accumulate decay");
      if (required !== null && event.elapsedSeconds > required) fail("decay checkpoint exceeds transition boundary");
      if (typeof event.paused !== "boolean") fail("paused must be boolean");
      return;
    }
    case "FIELD_STANDING_DELTA":
      finite(event.delta, "delta");
      if (!Number.isInteger(event.delta) || event.delta === 0 || Math.abs(event.delta) > 100) {
        fail("standing delta must be a non-zero integer within [-100,100]");
      }
      nonEmpty(event.causeId, "causeId");
      return;
    case "FIELD_THREAD_PATCH": {
      if (!THREAD_ID_SET.has(event.threadId)) fail("unknown threadId");
      if (!event.flags || typeof event.flags !== "object") fail("thread flags must be an object");
      const entries = Object.entries(event.flags);
      if (entries.length === 0) fail("thread patch cannot be empty");
      for (const [flag, value] of entries) {
        if (!THREAD_FLAGS.has(flag) || typeof value !== "boolean") fail(`invalid stable thread flag ${flag}`);
      }
      return;
    }
    case "FIELD_MICRO_ENGAGED": {
      if (!event.record || typeof event.record !== "object") fail("micro record is required");
      nonEmpty(event.record.recordId, "record.recordId");
      nonEmpty(event.record.sourceId, "record.sourceId");
      if (!MICRO_IDS.has(event.record.microConceptId)) fail("unknown microConceptId");
      if (!Number.isInteger(event.record.interactionOrdinal) || event.record.interactionOrdinal < 0) {
        fail("interactionOrdinal must be a non-negative integer");
      }
      const existing = field.microEngagements[event.record.recordId];
      if (existing && JSON.stringify(existing) !== JSON.stringify(event.record)) {
        fail("recordId already names a different micro engagement");
      }
      return;
    }
    case "FIELD_REACTIVE_COMPLETED": {
      const completion = event.completion;
      if (!completion || typeof completion !== "object") {
        fail("reactive completion is required");
      }
      nonEmpty(completion.interactionId, "completion.interactionId");
      nonEmpty(completion.sourceId, "completion.sourceId");
      nonEmpty(completion.outcomeId, "completion.outcomeId");
      if (completion.standing) {
        finite(completion.standing.delta, "completion.standing.delta");
        if (
          !Number.isInteger(completion.standing.delta) ||
          completion.standing.delta === 0 ||
          Math.abs(completion.standing.delta) > 100
        ) {
          fail("reactive standing delta must be a non-zero integer within [-100,100]");
        }
        nonEmpty(completion.standing.causeId, "completion.standing.causeId");
      }
      for (const patch of completion.threads ?? []) {
        if (!THREAD_ID_SET.has(patch.threadId)) fail("unknown completion threadId");
        if (patch.status !== undefined && !THREAD_STATUS_SET.has(patch.status)) {
          fail("unknown completion thread status");
        }
        if (patch.flags) {
          for (const [flag, value] of Object.entries(patch.flags)) {
            if (!THREAD_FLAGS.has(flag) || typeof value !== "boolean") {
              fail(`invalid completion thread flag ${flag}`);
            }
          }
        }
        if (patch.trustDelta !== undefined) {
          finite(patch.trustDelta, "completion.thread.trustDelta");
          if (!Number.isInteger(patch.trustDelta) || Math.abs(patch.trustDelta) > 10) {
            fail("thread trust delta must be an integer within [-10,10]");
          }
        }
      }
      for (const micro of completion.micros ?? []) {
        if (!MICRO_IDS.has(micro)) fail("unknown completion microConceptId");
      }
      for (const patch of completion.activities ?? []) {
        if (!ACTIVITY_ID_SET.has(patch.activityId)) fail("unknown optional activity");
        if (!ACTIVITY_STAGE_SET.has(patch.stage)) fail("unknown optional activity stage");
      }
      for (const change of completion.custody ?? []) {
        nonEmpty(change.objectId, "completion.custody.objectId");
        if (!world.jobObjects[change.objectId]) {
          fail(`unknown job object ${change.objectId}`);
        }
        if (!CUSTODY.has(change.custody)) fail("invalid completion custody");
        if (change.condition !== undefined && !CONDITION.has(change.condition)) {
          fail("invalid completion condition");
        }
        if (
          change.concealment !== undefined &&
          !CONCEALMENT.has(change.concealment)
        ) {
          fail("invalid completion concealment");
        }
      }
      if (completion.clockUnits !== undefined) {
        finite(completion.clockUnits, "completion.clockUnits");
        if (
          !Number.isInteger(completion.clockUnits) ||
          completion.clockUnits <= 0
        ) {
          fail("completion clockUnits must be a positive integer");
        }
      }
      for (const route of completion.routes ?? []) {
        nonEmpty(route.routeId, "completion.route.routeId");
        nonEmpty(route.label, "completion.route.label");
      }
      if (completion.identity) {
        nonEmpty(completion.identity.reason, "completion.identity.reason");
      }
      for (const relationship of completion.relationships ?? []) {
        nonEmpty(
          relationship.relationshipId,
          "completion.relationship.relationshipId",
        );
        nonEmpty(relationship.causeId, "completion.relationship.causeId");
        finite(relationship.delta, "completion.relationship.delta");
        if (
          !Number.isInteger(relationship.delta) ||
          relationship.delta === 0 ||
          Math.abs(relationship.delta) > 100
        ) {
          fail("relationship delta must be a non-zero integer within [-100,100]");
        }
      }
      if (completion.heat && !HEAT_BAND_SET.has(completion.heat.to)) {
        fail("unknown completion heat band");
      }
      return;
    }
    case "FIELD_REACTIVE_OUTCOME_SELECTED":
      nonEmpty(event.interactionId, "interactionId");
      nonEmpty(event.sourceId, "sourceId");
      nonEmpty(event.outcomeId, "outcomeId");
      return;
    case "FIELD_INTERRUPT_STARTED":
      nonEmpty(event.sourceId, "sourceId");
      if (event.interruptKind !== "CONFRONTATION" && event.interruptKind !== "REACTIVE_EXCHANGE") {
        fail("invalid interrupt kind");
      }
      return;
    case "FIELD_OPEN_RESPONSE_STARTED":
      nonEmpty(event.promptId, "promptId");
      return;
    case "FIELD_OPEN_RESPONSE_SUBMITTED":
      nonEmpty(event.promptId, "promptId");
      if (!OpenResponseReferenceSchema.safeParse(event.response).success) {
        fail("invalid open-response reference");
      }
      if (!DeterministicResolutionSchema.safeParse(event.resolution).success) {
        fail("invalid open-response resolution");
      }
      return;
    case "FIELD_WATCHER_CHALLENGE":
      nonEmpty(event.challengeId, "challengeId");
      nonEmpty(event.watcherId, "watcherId");
      if (!["SUSPICION", "CHECKPOINT", "CLARKE_INFORMED"].includes(event.reason)) fail("invalid challenge reason");
      return;
    case "FIELD_CONFRONTATION_DECISION":
      if (!field.activeConfrontation) fail("confrontation is not active");
      if (field.activeConfrontation.interruptId !== event.interruptId) {
        fail("confrontation decision has the wrong interruptId");
      }
      if (!["COMPLY", "TALK", "RUN"].includes(event.choice)) {
        fail("invalid confrontation choice");
      }
      if (
        field.activeConfrontation.phase === "TALK_FAILED" &&
        event.choice === "TALK"
      ) {
        fail("failed talk may continue only with comply or run");
      }
      if (
        field.activeConfrontation.phase !== "CHOOSING" &&
        field.activeConfrontation.phase !== "TALK_FAILED"
      ) {
        fail("confrontation is not awaiting a choice");
      }
      return;
    case "FIELD_CONFRONTATION_RESOLVED": {
      const confrontation = field.activeConfrontation;
      if (!confrontation) fail("confrontation is not active");
      if (confrontation.interruptId !== event.interruptId) {
        fail("confrontation resolution has the wrong interruptId");
      }
      if (
        !["COMPLIED_CLEAR", "COMPLIED_CONFISCATED", "TALK_RELEASED"].includes(
          event.outcome,
        )
      ) {
        fail("invalid confrontation outcome");
      }
      if (confrontation.outcome !== event.outcome) {
        fail("confrontation outcome does not match deterministic resolution");
      }
      if (
        confrontation.phase !== "INSPECTING" &&
        confrontation.phase !== "RESOLVING"
      ) {
        fail("confrontation is not ready to resolve");
      }
      return;
    }
    case "FIELD_IDENTITY_CHANGED":
      nonEmpty(event.reason, "reason");
      if (
        event.recognized === undefined &&
        event.clarkeMarked === undefined
      ) {
        fail("identity change must set at least one field");
      }
      if (
        (event.recognized !== undefined &&
          typeof event.recognized !== "boolean") ||
        (event.clarkeMarked !== undefined &&
          typeof event.clarkeMarked !== "boolean")
      ) {
        fail("identity values must be boolean");
      }
      return;
    case "FIELD_CHASE_STARTED":
      nonEmpty(event.chaseId, "chaseId");
      nonEmpty(event.sourceId, "sourceId");
      return;
    case "FIELD_CHASE_RESOLVED":
      nonEmpty(event.chaseId, "chaseId");
      if (!["ESCAPED", "REFUGE", "CAUGHT"].includes(event.outcome)) fail("invalid chase outcome");
      if (!field.activeChase || field.activeChase.chaseId !== event.chaseId) fail("chase is not active");
      return;
    case "FIELD_INTERRUPT_RESOLVED":
      nonEmpty(event.outcome, "outcome");
      return;
    case "FIELD_CUSTODY_CHANGED":
      nonEmpty(event.objectId, "objectId");
      nonEmpty(event.reason, "reason");
      if (!world.jobObjects[event.objectId]) fail(`unknown job object ${event.objectId}`);
      if (!CUSTODY.has(event.custody)) fail("invalid custody");
      if (event.condition !== undefined && !CONDITION.has(event.condition)) fail("invalid condition");
      if (event.concealment !== undefined && !CONCEALMENT.has(event.concealment)) fail("invalid concealment");
      return;
    case "FIELD_CLOCK_ADVANCED":
      finite(event.units, "units");
      nonEmpty(event.reason, "reason");
      if (!Number.isInteger(event.units) || event.units <= 0) fail("clock units must be a positive integer");
      return;
    case "FIELD_REPOSITION_INTENT":
      nonEmpty(event.locationId, "locationId");
      nonEmpty(event.anchorId, "anchorId");
      if (!["RELEASE", "REFUGE", "REROUTE"].includes(event.reason)) fail("invalid reposition reason");
      {
        const anchor =
          FIELD_REPOSITION_ANCHORS[
            event.anchorId as keyof typeof FIELD_REPOSITION_ANCHORS
          ];
        if (
          !anchor ||
          anchor.locationId !== event.locationId ||
          anchor.reason !== event.reason
        ) {
          fail("reposition directive does not match a validated anchor");
        }
      }
      return;
    case "FIELD_REPOSITION_APPLIED":
      nonEmpty(event.intentEventId, "intentEventId");
      if (
        !field.pendingReposition ||
        field.pendingReposition.eventId !== event.intentEventId
      ) {
        fail("reposition intent is not pending");
      }
      return;
  }
}

export function microId(value: string): MicroConceptId {
  if (!MICRO_IDS.has(value)) fail(`unknown micro concept ${value}`);
  return value as MicroConceptId;
}

export function threadId(value: string): ThreadId {
  if (!THREAD_ID_SET.has(value)) fail(`unknown thread ${value}`);
  return value as ThreadId;
}
