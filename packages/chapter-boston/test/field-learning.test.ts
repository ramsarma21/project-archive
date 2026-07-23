import type { FieldCommittedEvent, PresenterEvent } from "@pa/contracts";
import { CONCEPTS } from "../src/ids.js";
import { MICRO_CONCEPT_IDS, OPTIONAL_ACTIVITY_IDS } from "../src/fieldIds.js";
import { Ctx, Session } from "@pa/runtime";
import { BOSTON_1765_CHAPTER } from "../src/index.js";
import type { Flow } from "@pa/runtime";

// The alive-world learning bridges: free-roam knowledge inspects reinforce
// macros with provenance, living routes unlock owned routes, and the ropewalk
// activity stages through to its micro — all deterministic and replayable.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
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
    cueId: "LEARNING.TEST.ROAM",
  };
}

const seed = new Uint8Array(16).fill(77);

function exchangeEvents(
  id: string,
  completion: Extract<
    FieldCommittedEvent,
    { type: "FIELD_REACTIVE_COMPLETED" }
  >["completion"],
): PresenterEvent[] {
  return [
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
}

// 1. Tier-A lore inspect commits the mapped macro exposure with provenance.
{
  const session = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow);
  for (const event of exchangeEvents("lore1", {
    interactionId: "KN-noticeboard-stamp:1",
    sourceId: "KN-noticeboard-stamp",
    outcomeId: "READ",
    micros: [MICRO_CONCEPT_IDS.STAMP_WHAT_COUNTS],
  })) {
    session.advance(event);
  }
  const stamp = session.ctx.learner[CONCEPTS.STAMP_SCOPE]!;
  const exposure = stamp.exposures.find(
    (e) => e.exposureId === "STAMP.B4_5.OFFICIAL_NOTICE",
  );
  assert(exposure, "lore inspect must commit the macro-support exposure");
  equal(
    exposure!.provenance?.label,
    "the stamp schedule nailed by the town pump",
    "provenance label rides the exposure",
  );
  assert(
    session.ctx.field.engagedMicroIds.includes(MICRO_CONCEPT_IDS.STAMP_WHAT_COUNTS),
    "micro engaged",
  );

  // Idempotency: a second read of the same physical object (different
  // interaction id) cannot double-count the occasion.
  const before = stamp.exposures.length;
  for (const event of exchangeEvents("lore2", {
    interactionId: "KN-noticeboard-stamp:2",
    sourceId: "KN-noticeboard-stamp",
    outcomeId: "READ",
    micros: [MICRO_CONCEPT_IDS.STAMP_WHAT_COUNTS],
  })) {
    session.advance(event);
  }
  equal(stamp.exposures.length, before, "same exposureId never double-counts");
}

// 2. Living-route completion unlocks an owned route (world flag + label),
//    and the whole log replays deterministically.
{
  const session = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow);
  for (const event of exchangeEvents("note", {
    interactionId: "SJ-tavern-note-handoff:1",
    sourceId: "SJ-tavern-note-handoff",
    outcomeId: "HANDOFF",
    routes: [{ routeId: "NORTH_ALLEY_ROUTE", label: "The laundry-lane cut (north back alley)" }],
    micros: [MICRO_CONCEPT_IDS.LOYAL_NINE],
  })) {
    session.advance(event);
  }
  equal(
    session.ctx.world.routes.NORTH_ALLEY_ROUTE,
    "UNLOCKED",
    "owned route flag lands in world.routes",
  );
  assert(
    session.ctx.routesUnlocked.includes("The laundry-lane cut (north back alley)"),
    "route label reaches the Archive ROUTES list",
  );
  const replay = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow, [...session.committedEvents]);
  equal(
    replay.ctx.world.routes.NORTH_ALLEY_ROUTE,
    "UNLOCKED",
    "route survives replay",
  );
  equal(
    JSON.stringify(replay.ctx.learner),
    JSON.stringify(session.ctx.learner),
    "learner state replays identically",
  );
}

// 3. The ropewalk job stages AVAILABLE -> ACCEPTED -> READY_HANDOFF ->
//    COMPLETED, engages PORT_TOWN_BOSTON, and applies Standing exactly once.
{
  const session = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow);
  const stages: [string, string, Record<string, unknown>][] = [
    ["SJ-ropewalk-offer", "AVAILABLE", { activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.ROPEWALK, stage: "ACCEPTED" }] }],
    ["SJ-ropewalk-hook", "ACCEPTED", { activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.ROPEWALK, stage: "READY_HANDOFF" }] }],
    [
      "SJ-ropewalk-close",
      "READY_HANDOFF",
      {
        activities: [{ activityId: OPTIONAL_ACTIVITY_IDS.ROPEWALK, stage: "COMPLETED" }],
        micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
        standing: { delta: 4, causeId: "ROPEWALK_COMPLETED" },
        clockUnits: 1,
      },
    ],
  ];
  let n = 0;
  for (const [sourceId, stage, effects] of stages) {
    n += 1;
    equal(
      session.ctx.field.activities[OPTIONAL_ACTIVITY_IDS.ROPEWALK]!.stage,
      stage,
      `stage before step ${n}`,
    );
    for (const event of exchangeEvents(`rope${n}`, {
      interactionId: `${sourceId}:${n}`,
      sourceId,
      outcomeId: stage,
      ...effects,
    } as Extract<FieldCommittedEvent, { type: "FIELD_REACTIVE_COMPLETED" }>["completion"])) {
      session.advance(event);
    }
  }
  equal(
    session.ctx.field.activities[OPTIONAL_ACTIVITY_IDS.ROPEWALK]!.stage,
    "COMPLETED",
    "ropewalk completes",
  );
  assert(
    session.ctx.field.engagedMicroIds.includes(MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON),
    "PORT_TOWN_BOSTON engaged by the trades job",
  );
  equal(session.ctx.field.standing.points, 4, "standing applied once");
  equal(session.ctx.world.clock.spentUnits, 1, "activity cost one unit");
}

// 4. A chase teaches the writ and marks the face regardless of outcome:
//    escaping still sets identity.recognized and engages WRITS_OF_ASSISTANCE.
{
  const session = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow);
  const events: PresenterEvent[] = [
    {
      type: "FIELD_WATCHER_CHALLENGE",
      eventId: "esc-challenge",
      interruptId: "esc-int",
      challengeId: "esc-chal",
      watcherId: "WATCH-customs-a",
      reason: "SUSPICION",
    },
    {
      type: "FIELD_CONFRONTATION_DECISION",
      eventId: "esc-run",
      interruptId: "esc-int",
      choice: "RUN",
    },
    {
      type: "FIELD_CHASE_STARTED",
      eventId: "esc-start",
      interruptId: "esc-int",
      chaseId: "esc-chase",
      sourceId: "WATCH-customs-a",
    },
    {
      type: "FIELD_CHASE_RESOLVED",
      eventId: "esc-resolved",
      interruptId: "esc-int",
      chaseId: "esc-chase",
      outcome: "ESCAPED",
    },
  ];
  for (const event of events) session.advance(event);
  equal(session.ctx.field.identity.recognized, true, "escape keeps the face known");
  assert(
    session.ctx.field.engagedMicroIds.includes(MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE),
    "running from the writ still teaches the writ",
  );
  const replay = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow, [...session.committedEvents]);
  equal(replay.ctx.field.identity.recognized, true, "recognized survives replay");
}

console.log("field-learning: all assertions passed");
