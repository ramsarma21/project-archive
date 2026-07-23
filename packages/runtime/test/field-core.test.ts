import {
  MICRO_CONCEPT_IDS,
  THREAD_IDS,
  heatBandForLegacyWatcherHeat,
  legacyConcealmentOutcome,
  normalizeConcealment,
  type FieldCommittedEvent,
  type PresenterEvent,
} from "@pa/contracts";
import {
  BOSTON_1765_CHAPTER,
  Ctx,
  Session,
  applyFieldEvent,
  assertFieldEventPayload,
  compileFieldVocabulary,
  initialFieldState,
} from "../src/index.js";
import type { Flow } from "../src/engine/ctx.js";

const VOCAB = compileFieldVocabulary(BOSTON_1765_CHAPTER.fieldVocabulary);
const initialWorldState = BOSTON_1765_CHAPTER.content.createInitialWorldState;

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message = "values differ"): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown, message = "values differ"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nexpected ${JSON.stringify(expected)}\nreceived ${JSON.stringify(actual)}`);
  }
}

function throws(fn: () => void, expected: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expected), `expected error containing ${expected}, received ${message}`);
    return;
  }
  throw new Error(`expected error containing ${expected}`);
}

function* selectedRoamFlow(ctx: Ctx): Flow {
  const event = yield {
    present: [],
    request: {
      kind: "FREE_ROAM",
      targets: [
        { targetId: "PIKE_PROOF", label: "Pike's proof", marker: "GOLD" },
        { targetId: "THOMAS_CIRCULAR", label: "Thomas's circular", marker: "BLUE" },
      ],
      canProceed: false,
      selectedTargetId: "PIKE_PROOF",
    },
    cueId: "TEST.ROAM",
  };
  if (event.type === "FREE_ROAM_GOTO" && event.targetId === "PIKE_PROOF") {
    ctx.world.locationId = "PIKE_OFFICE";
  }
  yield {
    present: [],
    request: { kind: "CONTINUE" },
    cueId: "TEST.INTERIOR",
  };
}

function* continueFlow(_ctx: Ctx): Flow {
  yield {
    present: [],
    request: { kind: "CONTINUE" },
    cueId: "TEST.CONTINUE",
  };
}

const seed = new Uint8Array(16).fill(17);

// Pure compatibility and projection rules.
{
  equal(heatBandForLegacyWatcherHeat(0), "CALM");
  equal(heatBandForLegacyWatcherHeat(1), "NOTICED");
  equal(heatBandForLegacyWatcherHeat(2), "WATCHED");
  equal(heatBandForLegacyWatcherHeat(3), "HUNTED");
  equal(normalizeConcealment("CONCEALED"), "WRAPPED");
  equal(normalizeConcealment("HIDDEN"), "HIDDEN");
  equal(legacyConcealmentOutcome("WRAPPED"), "CONCEALED");
  equal(legacyConcealmentOutcome("EXPOSED"), "EXPOSED");
}

// Heat decay, Standing bands, stable Thread flags, and micro idempotence.
{
  const world = initialWorldState();
  const field = initialFieldState(world, VOCAB);
  const events: FieldCommittedEvent[] = [
    {
      type: "FIELD_HEAT_TRANSITION",
      eventId: "heat-1",
      from: "CALM",
      to: "NOTICED",
      cause: "DETECTION",
    },
    {
      type: "FIELD_HEAT_DECAY_CHECKPOINT",
      eventId: "heat-decay-1",
      band: "NOTICED",
      elapsedSeconds: 30,
      paused: true,
    },
    {
      type: "FIELD_STANDING_DELTA",
      eventId: "standing-1",
      delta: 5,
      causeId: "helped-dockhand",
    },
    {
      type: "FIELD_STANDING_DELTA",
      eventId: "standing-2",
      delta: 7,
      causeId: "helped-sarah",
    },
    {
      type: "FIELD_THREAD_PATCH",
      eventId: "thread-1",
      threadId: THREAD_IDS.NED,
      flags: { MET: true, OPENED: true, NED_ENCOURAGED_CRAFT: true },
    },
    {
      type: "FIELD_MICRO_ENGAGED",
      eventId: "micro-event-1",
      record: {
        recordId: "micro-record-printers",
        microConceptId: MICRO_CONCEPT_IDS.PRINTERS_ROLE,
        sourceId: "NED_INTRO",
        interactionOrdinal: 4,
      },
    },
    {
      type: "FIELD_MICRO_ENGAGED",
      eventId: "micro-event-2",
      record: {
        recordId: "micro-record-printers",
        microConceptId: MICRO_CONCEPT_IDS.PRINTERS_ROLE,
        sourceId: "NED_INTRO",
        interactionOrdinal: 4,
      },
    },
  ];
  for (const event of events) {
    assertFieldEventPayload(event, field, world, VOCAB);
    applyFieldEvent(field, world, event, VOCAB);
  }
  equal(field.heat.band, "NOTICED");
  equal(field.heat.decay.elapsedSeconds, 30);
  equal(field.heat.decay.requiredSeconds, 90);
  equal(field.heat.decay.paused, true);
  equal(field.standing.band, "TRUSTED");
  equal(field.threads[THREAD_IDS.NED].flags.NED_ENCOURAGED_CRAFT, true);
  equal(Object.keys(field.microEngagements).length, 1, "same micro record must be idempotent");
  deepEqual(field.engagedMicroIds, [MICRO_CONCEPT_IDS.PRINTERS_ROLE]);
}

const interruptEvents: PresenterEvent[] = [
  {
    type: "FIELD_WATCHER_CHALLENGE",
    eventId: "challenge-event",
    interruptId: "interrupt-customs",
    challengeId: "challenge-customs",
    watcherId: "watcher-customs-west",
    reason: "CHECKPOINT",
  },
  {
    type: "FIELD_HEAT_TRANSITION",
    eventId: "heat-noticed",
    interruptId: "interrupt-customs",
    from: "CALM",
    to: "NOTICED",
    cause: "DETECTION",
  },
  {
    type: "FIELD_CHASE_STARTED",
    eventId: "chase-start",
    interruptId: "interrupt-customs",
    chaseId: "chase-customs",
    sourceId: "watcher-customs-west",
  },
  {
    type: "FIELD_HEAT_TRANSITION",
    eventId: "heat-hunted",
    interruptId: "interrupt-customs",
    from: "NOTICED",
    to: "HUNTED",
    cause: "RUN",
  },
  {
    type: "FIELD_CUSTODY_CHANGED",
    eventId: "custody-caught",
    interruptId: "interrupt-customs",
    objectId: "CARRIER_HANDBILLS",
    custody: "CONFISCATED",
    condition: "LOST",
    concealment: "EXPOSED",
    reason: "caught-with-handbills",
  },
  {
    type: "FIELD_CLOCK_ADVANCED",
    eventId: "clock-caught",
    interruptId: "interrupt-customs",
    units: 2,
    reason: "watch-house-delay",
  },
  {
    type: "FIELD_REPOSITION_INTENT",
    eventId: "reposition-release",
    interruptId: "interrupt-customs",
    locationId: "BOSTON_STREET",
    anchorId: "INSPECTOR_OFFICE_RELEASE",
    reason: "RELEASE",
  },
  {
    type: "FIELD_CHASE_RESOLVED",
    eventId: "chase-resolved",
    interruptId: "interrupt-customs",
    chaseId: "chase-customs",
    outcome: "CAUGHT",
  },
];

// Escape keeps carried goods, leaves heat HUNTED, and resumes the exact spine.
{
  const ctx = new Ctx(seed, BOSTON_1765_CHAPTER);
  ctx.world.jobObjects.CARRIER_HANDBILLS = {
    custody: "PLAYER",
    condition: "INTACT",
    concealment: "WRAPPED",
  };
  const session = new Session(ctx, selectedRoamFlow);
  const originalPlan = session.plan;
  const escaped: PresenterEvent[] = [
    {
      type: "FIELD_WATCHER_CHALLENGE",
      eventId: "escape-challenge",
      interruptId: "escape-interrupt",
      challengeId: "escape-challenge-id",
      watcherId: "escape-watcher",
      reason: "SUSPICION",
    },
    {
      type: "FIELD_CHASE_STARTED",
      eventId: "escape-start",
      interruptId: "escape-interrupt",
      chaseId: "escape-chase",
      sourceId: "escape-watcher",
    },
    {
      type: "FIELD_HEAT_TRANSITION",
      eventId: "escape-heat",
      interruptId: "escape-interrupt",
      from: "CALM",
      to: "HUNTED",
      cause: "RUN",
    },
    {
      type: "FIELD_CHASE_RESOLVED",
      eventId: "escape-resolved",
      interruptId: "escape-interrupt",
      chaseId: "escape-chase",
      outcome: "ESCAPED",
    },
  ];
  for (const event of escaped) session.advance(event);
  deepEqual(session.plan, originalPlan);
  equal(ctx.field.heat.band, "HUNTED");
  equal(ctx.world.jobObjects.CARRIER_HANDBILLS?.custody, "PLAYER");
  equal(ctx.field.chaseHistory.at(-1)?.outcome, "ESCAPED");
}

// Interrupts suspend and restore the exact selected FREE_ROAM plan. Durable
// effects replay identically and never touch the learner state.
{
  const ctx = new Ctx(seed, BOSTON_1765_CHAPTER);
  const session = new Session(ctx, selectedRoamFlow);
  const originalPlan = session.plan;
  assert(originalPlan?.request.kind === "FREE_ROAM");
  equal(originalPlan.request.selectedTargetId, "PIKE_PROOF");
  const learnerBefore = JSON.stringify(ctx.learner);

  for (const event of interruptEvents) session.advance(event);

  deepEqual(session.plan, originalPlan, "resolved interrupt must restore exact FREE_ROAM plan");
  equal(JSON.stringify(ctx.learner), learnerBefore, "field interrupt must not alter learner state");
  equal(ctx.field.heat.band, "HUNTED");
  equal(ctx.world.clock.spentUnits, 2);
  equal(ctx.world.jobObjects.CARRIER_HANDBILLS?.custody, "CONFISCATED");
  equal(ctx.field.pendingReposition?.anchorId, "INSPECTOR_OFFICE_RELEASE");
  equal(ctx.view().field.activeInterrupt, null);
  assert(ctx.view().field.seedHex.length === 32, "field seed must be a derived 128-bit hex value");

  const replay = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), selectedRoamFlow, interruptEvents);
  deepEqual(replay.plan, originalPlan, "reload must restore the same selected FREE_ROAM plan");
  deepEqual(replay.ctx.view().field, ctx.view().field, "reload must reproduce the durable field slice");
  equal(replay.ctx.fieldSeedHex, ctx.fieldSeedHex, "same attempt seed must derive the same field seed");

  const midInterrupt = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), selectedRoamFlow, interruptEvents.slice(0, 3));
  equal(midInterrupt.plan?.fieldInterrupt?.kind, "CHASE");
  assert(midInterrupt.plan?.request.kind === "FREE_ROAM");
  equal(midInterrupt.plan.request.selectedTargetId, "PIKE_PROOF");
  for (const event of interruptEvents.slice(3)) midInterrupt.advance(event);
  deepEqual(midInterrupt.plan, originalPlan, "mid-interrupt reload must resume the suspended plan");

  session.advance({ type: "FREE_ROAM_GOTO", targetId: "PIKE_PROOF" });
  equal(ctx.world.locationId, "PIKE_OFFICE", "ordinary flow must resume after the interrupt");
  equal(ctx.field.heat.band, "HUNTED", "field state must survive an interior transition");
  equal(ctx.field.standing.band, "NEUTRAL", "unrelated field state must survive an interior transition");
}

// A validated reposition is spatial (location + authored anchor), survives a
// mid-resolution reload, and clears only after the presenter applies it.
{
  const throughIntent = interruptEvents.slice(0, 7);
  const midResolution = new Session(
    new Ctx(seed, BOSTON_1765_CHAPTER),
    selectedRoamFlow,
    throughIntent,
  );
  equal(midResolution.ctx.world.locationId, "BOSTON_STREET");
  equal(
    midResolution.ctx.view().field.pendingReposition?.anchorId,
    "INSPECTOR_OFFICE_RELEASE",
  );
  midResolution.advance(interruptEvents[7]!);
  midResolution.advance({
    type: "FIELD_REPOSITION_APPLIED",
    eventId: "reposition-release-applied",
    intentEventId: "reposition-release",
  });
  equal(midResolution.ctx.view().field.pendingReposition, null);

  const replay = new Session(
    new Ctx(seed, BOSTON_1765_CHAPTER),
    selectedRoamFlow,
    [
      ...interruptEvents,
      {
        type: "FIELD_REPOSITION_APPLIED",
        eventId: "reposition-release-applied",
        intentEventId: "reposition-release",
      },
    ],
  );
  equal(replay.ctx.view().field.pendingReposition, null);
  equal(replay.ctx.world.locationId, "BOSTON_STREET");
}

// Reactive exchanges use the same suspend/commit/resume envelope.
{
  const session = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), selectedRoamFlow);
  const originalPlan = session.plan;
  session.advance({
    type: "FIELD_INTERRUPT_STARTED",
    eventId: "sarah-exchange-start",
    interruptId: "sarah-exchange",
    interruptKind: "REACTIVE_EXCHANGE",
    sourceId: "SARAH",
  });
  session.advance({
    type: "FIELD_STANDING_DELTA",
    eventId: "sarah-standing",
    interruptId: "sarah-exchange",
    delta: 2,
    causeId: "heard-sarah-out",
  });
  session.advance({
    type: "FIELD_INTERRUPT_RESOLVED",
    eventId: "sarah-exchange-end",
    interruptId: "sarah-exchange",
    outcome: "HEARD_OUT",
  });
  deepEqual(session.plan, originalPlan);
  equal(session.ctx.field.standing.points, 2);
}

// Legacy heat remains authoritative until the first semantic transition, then
// cannot overwrite the field authority.
{
  const ctx = new Ctx(seed, BOSTON_1765_CHAPTER);
  ctx.world.attention.watcherHeat = 2;
  ctx.syncLegacyFieldCompatibility();
  equal(ctx.field.heat.band, "WATCHED");
  ctx.applyFieldEvent({
    type: "FIELD_HEAT_TRANSITION",
    eventId: "legacy-migration",
    from: "WATCHED",
    to: "WATCHED",
    cause: "LEGACY_MIGRATION",
  });
  equal(ctx.field.heat.authority, "FIELD_EVENTS");
  equal(ctx.field.heat.history.at(-1)?.cause, "LEGACY_MIGRATION");
  ctx.world.attention.watcherHeat = 0;
  ctx.syncLegacyFieldCompatibility();
  equal(ctx.field.heat.band, "WATCHED");
  ctx.applyFieldEvent({
    type: "FIELD_HEAT_TRANSITION",
    eventId: "legacy-to-field",
    from: "WATCHED",
    to: "HUNTED",
    cause: "RUN",
  });
  ctx.syncLegacyFieldCompatibility();
  equal(ctx.field.heat.band, "HUNTED", "legacy watcherHeat must not become a duplicate authority");
}

// Deterministic talk success commits heat + writs micro atomically and resumes
// the exact selected route without touching carried goods or learner state.
{
  const session = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), selectedRoamFlow);
  const originalPlan = session.plan;
  const learnerBefore = JSON.stringify(session.ctx.learner);
  const events: PresenterEvent[] = [
    {
      type: "FIELD_WATCHER_CHALLENGE",
      eventId: "talk-challenge",
      interruptId: "talk-interrupt",
      challengeId: "talk-challenge-id",
      watcherId: "WATCH-customs",
      reason: "CHECKPOINT",
    },
    {
      type: "FIELD_CONFRONTATION_DECISION",
      eventId: "talk-decision",
      interruptId: "talk-interrupt",
      choice: "TALK",
    },
  ];
  for (const event of events) session.advance(event);
  equal(session.ctx.field.activeConfrontation?.phase, "RESOLVING");
  equal(session.ctx.field.activeConfrontation?.outcome, "TALK_RELEASED");
  const resolve: PresenterEvent = {
    type: "FIELD_CONFRONTATION_RESOLVED",
    eventId: "talk-resolved",
    interruptId: "talk-interrupt",
    outcome: "TALK_RELEASED",
  };
  session.advance(resolve);
  deepEqual(session.plan, originalPlan);
  equal(session.ctx.field.heat.band, "WATCHED");
  equal(
    session.ctx.field.engagedMicroIds.includes(
      MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE,
    ),
    true,
  );
  equal(JSON.stringify(session.ctx.learner), learnerBefore);

  const replay = new Session(
    new Ctx(seed, BOSTON_1765_CHAPTER),
    selectedRoamFlow,
    [...events, resolve],
  );
  deepEqual(replay.ctx.view().field, session.ctx.view().field);
  deepEqual(replay.plan, originalPlan);
}

// Clarke + hunted heat deterministically fails TALK, then COMPLY remains
// available, confiscates only exposed carried goods, advances time, and cannot
// dead-end the suspended route.
{
  const ctx = new Ctx(seed, BOSTON_1765_CHAPTER);
  ctx.world.jobObjects.CARRIER_HANDBILLS = {
    custody: "PLAYER",
    condition: "INTACT",
    concealment: "EXPOSED",
  };
  const session = new Session(ctx, selectedRoamFlow);
  const originalPlan = session.plan;
  session.advance({
    type: "FIELD_IDENTITY_CHANGED",
    eventId: "clarke-marked",
    clarkeMarked: true,
    reason: "clarke-informed",
  });
  session.advance({
    type: "FIELD_HEAT_TRANSITION",
    eventId: "pre-hunted",
    from: "CALM",
    to: "HUNTED",
    cause: "RUN",
  });
  session.advance({
    type: "FIELD_WATCHER_CHALLENGE",
    eventId: "failed-talk-challenge",
    interruptId: "failed-talk-interrupt",
    challengeId: "failed-talk-id",
    watcherId: "WATCH-customs",
    reason: "CLARKE_INFORMED",
  });
  session.advance({
    type: "FIELD_CONFRONTATION_DECISION",
    eventId: "failed-talk-decision",
    interruptId: "failed-talk-interrupt",
    choice: "TALK",
  });
  equal(ctx.field.activeConfrontation?.phase, "TALK_FAILED");
  throws(
    () =>
      session.advance({
        type: "FIELD_CONFRONTATION_DECISION",
        eventId: "repeat-talk",
        interruptId: "failed-talk-interrupt",
        choice: "TALK",
      }),
    "comply or run",
  );
  session.advance({
    type: "FIELD_CONFRONTATION_DECISION",
    eventId: "comply-after-talk",
    interruptId: "failed-talk-interrupt",
    choice: "COMPLY",
  });
  equal(ctx.field.activeConfrontation?.outcome, "COMPLIED_CONFISCATED");
  session.advance({
    type: "FIELD_CONFRONTATION_RESOLVED",
    eventId: "comply-resolved",
    interruptId: "failed-talk-interrupt",
    outcome: "COMPLIED_CONFISCATED",
  });
  deepEqual(session.plan, originalPlan);
  equal(ctx.world.jobObjects.CARRIER_HANDBILLS?.custody, "CONFISCATED");
  equal(ctx.world.clock.spentUnits, 1);
  equal(ctx.field.identity.recognized, true);
  equal(ctx.field.heat.band, "HUNTED");
}

// Malformed and invalid-context field events reject without entering the log.
{
  const session = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), selectedRoamFlow);
  throws(
    () => session.advance({
      type: "FIELD_STANDING_DELTA",
      eventId: "standing-zero",
      delta: 0,
      causeId: "invalid",
    }),
    "standing delta",
  );
  equal(session.committedEvents.length, 0);
  throws(
    () => session.advance({ type: "FIELD_UNKNOWN", eventId: "unknown" } as unknown as PresenterEvent),
    "unknown or malformed",
  );
  equal(session.committedEvents.length, 0);

  const nonRoam = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), continueFlow);
  throws(
    () => nonRoam.advance(interruptEvents[0]!),
    "only during FREE_ROAM",
  );
  equal(nonRoam.committedEvents.length, 0);

  const invalidReposition = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), selectedRoamFlow);
  invalidReposition.advance(interruptEvents[0]!);
  invalidReposition.advance(interruptEvents[2]!);
  throws(
    () =>
      invalidReposition.advance({
        type: "FIELD_REPOSITION_INTENT",
        eventId: "bad-reposition",
        interruptId: "interrupt-customs",
        locationId: "CUSTOM_HOUSE",
        anchorId: "INSPECTOR_OFFICE_RELEASE",
        reason: "RELEASE",
      }),
    "validated anchor",
  );
}
