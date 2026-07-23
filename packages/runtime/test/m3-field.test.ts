import {
  MICRO_CONCEPT_IDS,
  THREAD_IDS,
  type FieldCommittedEvent,
  type PresenterEvent,
} from "@pa/contracts";
import { Ctx, Session } from "../src/index.js";
import type { Flow } from "../src/engine/ctx.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\n${JSON.stringify(actual)}\n${JSON.stringify(expected)}`);
  }
}

function* roamFlow(_ctx: Ctx): Flow {
  yield {
    present: [],
    request: {
      kind: "FREE_ROAM",
      targets: [{ targetId: "PIKE_PROOF", label: "Pike", marker: "GOLD" }],
      selectedTargetId: "PIKE_PROOF",
      canProceed: false,
    },
    cueId: "M3.TEST.ROAM",
  };
}

const seed = new Uint8Array(16).fill(31);

function runExchange(
  session: Session,
  id: string,
  completion: Extract<
    FieldCommittedEvent,
    { type: "FIELD_REACTIVE_COMPLETED" }
  >["completion"],
): PresenterEvent[] {
  const events: PresenterEvent[] = [
    {
      type: "FIELD_INTERRUPT_STARTED",
      eventId: `${id}-start`,
      interruptId: id,
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId: completion.sourceId,
    },
    {
      type: "FIELD_REACTIVE_COMPLETED",
      eventId: `${id}-complete`,
      interruptId: id,
      completion,
    },
    {
      type: "FIELD_INTERRUPT_RESOLVED",
      eventId: `${id}-resolved`,
      interruptId: id,
      outcome: completion.outcomeId,
    },
  ];
  for (const event of events) session.advance(event);
  return events;
}

// Thread effects are atomic, replayable, and idempotent by interaction id.
{
  const session = new Session(new Ctx(seed), roamFlow);
  const originalPlan = session.plan;
  const learnerBefore = JSON.stringify(session.ctx.learner);
  const events = runExchange(session, "ned", {
    interactionId: "THR-ned:fetch",
    sourceId: "THR-ned",
    outcomeId: "FETCH",
    standing: { delta: 2, causeId: "ned-type-fetch" },
    threads: [{
      threadId: THREAD_IDS.NED,
      flags: { MET: true, OPENED: true, NED_FETCHED_TYPE: true },
      status: "ACTIVE",
      trustDelta: 2,
      breadcrumb: "You helped Ned with a tray of type.",
    }],
    micros: [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
  });
  deepEqual(session.plan, originalPlan, "reactive exchange must resume selected objective");
  equal(session.ctx.field.standing.points, 2, "Standing applied");
  equal(session.ctx.field.threads[THREAD_IDS.NED].trust, 2, "Thread trust applied");
  equal(session.ctx.world.currentInteractionOrdinal, 1, "completed interaction counted");
  assert(
    session.ctx.field.engagedMicroIds.includes(MICRO_CONCEPT_IDS.PRINTERS_ROLE),
    "completed Ned exchange must log printers role",
  );
  equal(JSON.stringify(session.ctx.learner), learnerBefore, "optional content changed required learning");

  const replay = new Session(new Ctx(seed), roamFlow, events);
  deepEqual(replay.ctx.view().field, session.ctx.view().field, "reactive replay diverged");
  runExchange(session, "ned-repeat", {
    interactionId: "THR-ned:fetch",
    sourceId: "THR-ned",
    outcomeId: "FETCH",
    standing: { delta: 2, causeId: "ned-type-fetch" },
    threads: [{ threadId: THREAD_IDS.NED, trustDelta: 2 }],
  });
  equal(session.ctx.field.standing.points, 2, "duplicate Standing cause applied");
  equal(session.ctx.field.threads[THREAD_IDS.NED].trust, 2, "duplicate Thread completion applied");
  equal(session.ctx.world.currentInteractionOrdinal, 1, "duplicate completion counted");
}

// Tavern note and dock haul preserve custody and charge time only at completion.
{
  const session = new Session(new Ctx(seed), roamFlow);
  const learnerBefore = JSON.stringify(session.ctx.learner);
  runExchange(session, "tavern-accept", {
    interactionId: "tavern:accept",
    sourceId: "NPC-thomas",
    outcomeId: "TAKE_NOTE",
    activities: [{ activityId: "SJ-tavern-note", stage: "ACCEPTED" }],
    custody: [{ objectId: "TAVERN_NOTE", custody: "PLAYER" }],
  });
  equal(session.ctx.world.clock.spentUnits, 0, "offer charged clock");
  runExchange(session, "tavern-deliver", {
    interactionId: "tavern:deliver",
    sourceId: "SJ-tavern-note-handoff",
    outcomeId: "HANDOFF",
    activities: [{ activityId: "SJ-tavern-note", stage: "COMPLETED" }],
    custody: [{ objectId: "TAVERN_NOTE", custody: "TAVERN_KEEPER" }],
    standing: { delta: 4, causeId: "tavern-note-delivered" },
    micros: [MICRO_CONCEPT_IDS.NON_IMPORTATION, MICRO_CONCEPT_IDS.LOYAL_NINE],
    rumors: ["The Loyal Nine meet quietly."],
    clockUnits: 1,
  });
  equal(session.ctx.world.jobObjects.TAVERN_NOTE?.custody, "TAVERN_KEEPER", "note custody");

  runExchange(session, "dock-accept", {
    interactionId: "dock:accept",
    sourceId: "SJ-dock-haul-offer",
    outcomeId: "ACCEPT",
    activities: [{ activityId: "SJ-dock-haul", stage: "ACCEPTED" }],
  });
  runExchange(session, "dock-lift", {
    interactionId: "dock:lift",
    sourceId: "SJ-dock-haul-lift",
    outcomeId: "LIFT",
    activities: [{ activityId: "SJ-dock-haul", stage: "CARRYING" }],
    custody: [{ objectId: "DOCK_BARREL", custody: "PLAYER" }],
  });
  runExchange(session, "dock-balance", {
    interactionId: "dock:balance",
    sourceId: "SJ-dock-haul-balance",
    outcomeId: "BALANCE",
    activities: [{ activityId: "SJ-dock-haul", stage: "READY_HANDOFF" }],
  });
  equal(session.ctx.world.clock.spentUnits, 1, "incomplete haul charged clock");
  runExchange(session, "dock-setdown", {
    interactionId: "dock:setdown",
    sourceId: "SJ-dock-haul-setdown",
    outcomeId: "SET_DOWN",
    activities: [{ activityId: "SJ-dock-haul", stage: "COMPLETED" }],
    custody: [{ objectId: "DOCK_BARREL", custody: "SHIP" }],
    standing: { delta: 4, causeId: "dock-haul-completed" },
    micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
    rumors: ["Dock workers know a scaffold route."],
    clockUnits: 1,
  });
  equal(session.ctx.world.jobObjects.DOCK_BARREL?.custody, "SHIP", "barrel custody");
  equal(session.ctx.world.clock.spentUnits, 2, "completed jobs clock");
  equal(session.ctx.field.standing.points, 8, "completed jobs Standing");
  equal(JSON.stringify(session.ctx.learner), learnerBefore, "side jobs changed required learning");
}
