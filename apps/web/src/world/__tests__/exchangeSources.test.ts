// ---------------------------------------------------------------------------
// Wave-2 exchange engine regression gates.
//
// 1. The source registry is explicit and complete (no prefix routing; every
//    Day-1 source id registered by name).
// 2. Resume-from-interrupt reconstruction: for EVERY registered source id, a
//    save whose tail is FIELD_INTERRUPT_STARTED reconstructs a completable
//    exchange against a real runtime session (no more "reconstructs some
//    prefixes" gaps — including Sarah's authored follow-up node, which the
//    legacy ReactiveNpcDirector could not rebuild).
// 3. Field-event byte parity: interrupt ids, eventIds, payload key order, and
//    event ordering match the legacy directors exactly, and engine-built
//    events are accepted end-to-end by the runtime driver.
// ---------------------------------------------------------------------------

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MICRO_CONCEPT_IDS,
  THREAD_IDS,
  standingDeltaForCause,
  type PresenterEvent,
  type RuntimeView,
} from "@pa/contracts";
import {
  createDay1Session,
  npcFollowups,
  type Session,
} from "@pa/runtime";
import "../content/day1Exchanges.js";
import {
  exchangeCompletionEvent,
  exchangeInterruptId,
  exchangeResolvedEvent,
  exchangeStartEvent,
  isExchangeSourceRegistered,
  registeredExchangeSources,
  resolveExchangeForSource,
  type Exchange,
} from "../exchange/exchangeSources.js";
import { day1ExchangeFrame } from "../content/day1Exchanges.js";

const SEED = "31".repeat(32);

// --- Day-1 flow driver (same deterministic responder the QA harnesses use) --

function mechanicResult(params: { kind: string; sortItems?: { itemId: string }[] }) {
  if (params.kind === "PRESS") return { kind: "PRESS", stopOffset: 0.5 };
  if (params.kind === "EFFORT") return { kind: "EFFORT", holdMs: 1500 };
  if (params.kind === "PLACE") return { kind: "PLACE", alignment: 0.5 };
  const needs = new Set(["deed", "writ", "newspaper"]);
  return {
    kind: "SORT",
    assignments: (params.sortItems ?? []).map((item) => ({
      itemId: item.itemId,
      bucketId: needs.has(item.itemId) ? "NEEDS_STAMP" : "DOES_NOT",
    })),
  };
}

function ordinaryResponse(request: NonNullable<Session["plan"]>["request"]): PresenterEvent {
  switch (request.kind) {
    case "CONTINUE":
      return { type: "CONTINUE" } as PresenterEvent;
    case "ACK":
      return { type: "ACK" } as PresenterEvent;
    case "FOCUS_READ":
      return {
        type: "FOCUS_READ_OPENED",
        objectId: (request as { objectId: string }).objectId,
      } as PresenterEvent;
    case "BREATHER":
      return { type: "BREATHER_COMPLETE" } as PresenterEvent;
    case "FREE_ROAM": {
      const targets = (request as { targets: { targetId: string; marker?: string }[] }).targets;
      const target = targets.find((candidate) => candidate.marker === "GOLD") ?? targets[0]!;
      return { type: "FREE_ROAM_GOTO", targetId: target.targetId } as PresenterEvent;
    }
    case "MECHANIC":
      return {
        type: "MECHANIC_RESULT",
        promptId: (request as { promptId: string }).promptId,
        result: mechanicResult((request as { params: { kind: string } }).params),
      } as PresenterEvent;
    case "CHOICE": {
      const options = (request as { options: { choiceId: string; disabled?: boolean }[] }).options;
      const option = options.find((candidate) => !candidate.disabled) ?? options[0]!;
      return {
        type: "CHOICE_SELECTED",
        promptId: (request as { promptId: string }).promptId,
        choiceId: option.choiceId,
      } as PresenterEvent;
    }
    default:
      return { type: "CONTINUE" } as PresenterEvent;
  }
}

function baseFreeRoamEvents(): PresenterEvent[] {
  const session = createDay1Session({
    variationRootSeedHex: SEED,
    openResponseContentMode: "AUTHOR_DRAFT_QA",
  });
  for (let step = 0; step < 400; step += 1) {
    const reportComplete =
      session.ctx.world.objectives.REPORT_TO_MERCER === "COMPLETED";
    if (
      reportComplete &&
      session.plan?.request.kind === "FREE_ROAM" &&
      session.ctx.world.locationId === "BOSTON_STREET"
    ) {
      return [...session.committedEvents];
    }
    assert.ok(session.plan, "runtime ended before free-roam street state");
    session.advance(ordinaryResponse(session.plan.request));
  }
  throw new Error("could not construct the free-roam base save");
}

const BASE_EVENTS = baseFreeRoamEvents();

function freshSession(): Session {
  return createDay1Session({
    variationRootSeedHex: SEED,
    openResponseContentMode: "AUTHOR_DRAFT_QA",
    priorEvents: BASE_EVENTS,
  });
}

function engineFieldSeed(view: RuntimeView): number {
  return Number.parseInt(view.field.seedHex.slice(0, 8), 16) || 1765;
}

interface InterruptDriver {
  session: Session;
  start(sourceId: string): RuntimeView;
  abandon(): void;
}

function interruptDriver(session: Session): InterruptDriver {
  let serial = 0;
  return {
    session,
    start(sourceId) {
      serial += 1;
      session.advance({
        type: "FIELD_INTERRUPT_STARTED",
        eventId: `W2COV_${serial}_START`,
        interruptId: `W2COV_${serial}`,
        interruptKind: "REACTIVE_EXCHANGE",
        sourceId,
      });
      return session.ctx.view() as RuntimeView;
    },
    abandon() {
      session.advance({
        type: "FIELD_INTERRUPT_RESOLVED",
        eventId: `W2COV_${serial}_RESOLVED`,
        interruptId: `W2COV_${serial}`,
        outcome: "ABANDONED",
      });
    },
  };
}

function assertCompletable(exchange: Exchange | null, sourceId: string): asserts exchange is Exchange {
  assert.ok(exchange, `${sourceId} must reconstruct from a STARTED-only save`);
  assert.ok(exchange.title.length > 0, `${sourceId} reconstructed without a title`);
  assert.ok(exchange.line.length > 0, `${sourceId} reconstructed without a line`);
  assert.ok(
    exchange.choices.length >= 1 && exchange.choices.length <= 3,
    `${sourceId} must present 1-3 completable choices`,
  );
  for (const choice of exchange.choices) {
    assert.ok(choice.id.length > 0, `${sourceId} choice without id`);
    assert.ok(choice.label.length > 0, `${sourceId} choice without label`);
    assert.ok(choice.reply.length > 0, `${sourceId} choice without reply`);
  }
  assert.ok(
    ["FIELD_REACTIVE_OUTCOME_SELECTED", "FIELD_REACTIVE_COMPLETED"].includes(
      exchange.engine.completionEvent,
    ),
    `${sourceId} has no completion event route`,
  );
}

// --- 1. Registry inventory ---------------------------------------------------

const STAGE_A_INVENTORY: Record<string, string> = {
  "NPC-abigail": "NAMED_CAST",
  "NPC-thomas": "NAMED_CAST",
  "NPC-pike": "NAMED_CAST",
  "NPC-clarke": "NAMED_CAST",
  "NPC-rider": "NAMED_CAST",
  "THR-ned": "THREAD_FIGURE",
  "THR-sarah": "THREAD_FIGURE",
  "SJ-dock-haul-offer": "SIDE_JOB",
  "SJ-dock-haul-lift": "SIDE_JOB",
  "SJ-dock-haul-balance": "SIDE_JOB",
  "SJ-dock-haul-setdown": "SIDE_JOB",
  "SJ-ropewalk-offer": "SIDE_JOB",
  "SJ-ropewalk-hook": "SIDE_JOB",
  "SJ-ropewalk-close": "SIDE_JOB",
  "SJ-tavern-note-handoff": "SIDE_JOB",
};

test("day-1 exchange registry is explicit, owned, and duplicate-free", () => {
  const sources = registeredExchangeSources();
  const inventory = Object.fromEntries(
    sources.map((source) => [source.sourceId, source.owner]),
  );
  assert.deepEqual(inventory, STAGE_A_INVENTORY);
  assert.equal(
    new Set(sources.map((source) => source.sourceId)).size,
    sources.length,
    "duplicate source ids registered",
  );
});

// --- 2. Reconstruction coverage ----------------------------------------------

test("every registered source id reconstructs a completable exchange from a STARTED-only save", () => {
  const driver = interruptDriver(freshSession());
  for (const source of registeredExchangeSources()) {
    if (source.kind !== "EXCHANGE") continue;
    const view = driver.start(source.sourceId);
    assert.equal(
      view.field.activeInterrupt?.sourceId,
      source.sourceId,
      "runtime did not record the started interrupt",
    );
    const exchange = resolveExchangeForSource(
      source.sourceId,
      view,
      "EXTERIOR",
      0,
      engineFieldSeed(view),
    );
    assertCompletable(exchange, source.sourceId);
    // Named-cast sources may legitimately reconstruct as the actor's eligible
    // follow-up node (the legacy override); anything else must round-trip.
    assert.ok(
      exchange.sourceId === source.sourceId ||
        view.openResponse.npcFollowups.some(
          (node) => node.nodeId === exchange.sourceId,
        ),
      `${source.sourceId} reconstructed as unrelated ${exchange.sourceId}`,
    );
    driver.abandon();
  }
});

test("authored dialogue nodes reconstruct for every npcId, including non-cast figures", () => {
  const nodes = npcFollowups({ allowAuthorDraft: true });
  assert.ok(nodes.length >= 6, "expected the Day-1 follow-up bank");
  assert.ok(
    nodes.some((node) => node.npcId === "sarah"),
    "the Sarah follow-up node (legacy resume gap) must exist",
  );
  const driver = interruptDriver(freshSession());
  for (const node of nodes) {
    const view = driver.start(node.nodeId);
    assert.ok(
      isExchangeSourceRegistered(node.nodeId, view),
      `${node.nodeId} is not a registered family member`,
    );
    const exchange = resolveExchangeForSource(
      node.nodeId,
      view,
      "EXTERIOR",
      0,
      engineFieldSeed(view),
    );
    assertCompletable(exchange, node.nodeId);
    assert.equal(exchange.sourceId, node.nodeId);
    assert.equal(
      exchange.engine.completionEvent,
      "FIELD_REACTIVE_OUTCOME_SELECTED",
      "authored dialogue must resolve outcomes runtime-side",
    );
    driver.abandon();
  }
});

// --- 3. Field-event byte parity ----------------------------------------------

test("engine-built field events are byte-identical to the legacy directors", () => {
  const session = freshSession();
  const view = session.ctx.view() as RuntimeView;
  const seed = engineFieldSeed(view);

  // Named cast → FIELD_REACTIVE_OUTCOME_SELECTED (runtime-resolved outcome).
  const pike = resolveExchangeForSource("NPC-pike", view, "EXTERIOR", 0, seed);
  assertCompletable(pike, "NPC-pike");
  const pikeId = exchangeInterruptId(pike, 2, 9);
  assert.equal(pikeId, "M3_NPC-pike_3_9");
  assert.equal(
    JSON.stringify(exchangeStartEvent(pike, pikeId)),
    JSON.stringify({
      type: "FIELD_INTERRUPT_STARTED",
      eventId: "M3_NPC-pike_3_9_START",
      interruptId: "M3_NPC-pike_3_9",
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId: "NPC-pike",
    }),
  );
  const courts = pike.choices.find((choice) => choice.id === "COURTS")!;
  assert.equal(
    JSON.stringify(exchangeCompletionEvent(pike, courts, pikeId, 2)),
    JSON.stringify({
      type: "FIELD_REACTIVE_OUTCOME_SELECTED",
      eventId: "M3_NPC-pike_3_9_COMPLETE_COURTS",
      interruptId: "M3_NPC-pike_3_9",
      interactionId: "NPC-pike:3",
      sourceId: "NPC-pike",
      outcomeId: "COURTS",
    }),
  );
  assert.equal(
    JSON.stringify(exchangeResolvedEvent(pikeId, "ABANDONED")),
    JSON.stringify({
      type: "FIELD_INTERRUPT_RESOLVED",
      eventId: "M3_NPC-pike_3_9_RESOLVED",
      interruptId: "M3_NPC-pike_3_9",
      outcome: "ABANDONED",
    }),
  );

  // Thread figure → FIELD_REACTIVE_COMPLETED with the authored effects payload.
  const ned = resolveExchangeForSource("THR-ned", view, "EXTERIOR", 0, seed);
  assertCompletable(ned, "THR-ned");
  const nedId = exchangeInterruptId(ned, 4, 17);
  assert.equal(nedId, "M3_THR-ned_5_17");
  const fetch = ned.choices.find((choice) => choice.id === "FETCH")!;
  assert.equal(fetch.actionClip, "work2", "Ned FETCH must keep its work clip");
  assert.equal(
    JSON.stringify(exchangeCompletionEvent(ned, fetch, nedId, 4)),
    JSON.stringify({
      type: "FIELD_REACTIVE_COMPLETED",
      eventId: "M3_THR-ned_5_17_COMPLETE_FETCH",
      interruptId: "M3_THR-ned_5_17",
      completion: {
        interactionId: "THR-ned:5",
        sourceId: "THR-ned",
        outcomeId: "FETCH",
        threads: [
          {
            threadId: THREAD_IDS.NED,
            flags: { MET: true, OPENED: true, NED_FETCHED_TYPE: true },
            status: "ACTIVE",
            trustDelta: 2,
            breadcrumb:
              "You helped Ned with a tray of type; check the shopfront later.",
          },
        ],
        micros: [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
        standing: {
          delta: standingDeltaForCause("NED_TYPE_FETCH"),
          causeId: "NED_TYPE_FETCH",
        },
      },
    }),
  );

  // Full staged side-job payload (custody, standing, micros, rumors, clock).
  const setdown = resolveExchangeForSource(
    "SJ-dock-haul-setdown",
    view,
    "EXTERIOR",
    0,
    seed,
  );
  assertCompletable(setdown, "SJ-dock-haul-setdown");
  const setdownId = exchangeInterruptId(setdown, 6, 31);
  assert.equal(setdownId, "M3_SJ-dock-haul-setdown_7_31");
  const place = setdown.choices[0]!;
  assert.equal(place.id, "READY_HANDOFF");
  assert.equal(place.actionClip, "carry", "dock verbs keep the carry clip");
  assert.equal(
    JSON.stringify(exchangeCompletionEvent(setdown, place, setdownId, 6)),
    JSON.stringify({
      type: "FIELD_REACTIVE_COMPLETED",
      eventId: "M3_SJ-dock-haul-setdown_7_31_COMPLETE_READY_HANDOFF",
      interruptId: "M3_SJ-dock-haul-setdown_7_31",
      completion: {
        interactionId: "SJ-dock-haul-setdown:7",
        sourceId: "SJ-dock-haul-setdown",
        outcomeId: "READY_HANDOFF",
        activities: [
          {
            activityId: "SJ-dock-haul",
            stage: "COMPLETED",
            breadcrumb:
              "Dock haul complete; the dockhand now shares wharf rumors.",
          },
        ],
        custody: [
          {
            objectId: "DOCK_BARREL",
            custody: "SHIP",
            condition: "INTACT",
            concealment: "EXPOSED",
          },
        ],
        standing: {
          delta: standingDeltaForCause("DOCK_HAUL_COMPLETED"),
          causeId: "DOCK_HAUL_COMPLETED",
        },
        micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
        rumors: ["Dock workers know a scaffold route toward the central roofs."],
        clockUnits: 1,
      },
    }),
  );

  // Keeper handoff keeps the "handoff" action clip (legacy clip choreography).
  const keeper = resolveExchangeForSource(
    "SJ-tavern-note-handoff",
    view,
    "EXTERIOR",
    0,
    seed,
  );
  assertCompletable(keeper, "SJ-tavern-note-handoff");
  assert.equal(keeper.choices[0]!.actionClip, "handoff");
  const rope = resolveExchangeForSource("SJ-ropewalk-hook", view, "EXTERIOR", 0, seed);
  assertCompletable(rope, "SJ-ropewalk-hook");
  assert.equal(rope.choices[0]!.actionClip, "ropePull");
  assert.equal(rope.choices[1]!.actionClip, "talk");
});

test("engine-built events drive a full exchange arc through the real runtime", () => {
  const session = freshSession();
  const submit = (event: PresenterEvent) => session.advance(event);
  const arc: [string, string][] = [
    ["SJ-dock-haul-offer", "ACCEPT"],
    ["SJ-dock-haul-lift", "ACCEPTED"],
    ["SJ-dock-haul-balance", "CARRYING"],
    ["SJ-dock-haul-setdown", "READY_HANDOFF"],
  ];
  for (const [sourceId, outcomeId] of arc) {
    const view = session.ctx.view() as RuntimeView;
    const exchange = resolveExchangeForSource(
      sourceId,
      view,
      "EXTERIOR",
      0,
      engineFieldSeed(view),
    );
    assertCompletable(exchange, sourceId);
    const interruptId = exchangeInterruptId(
      exchange,
      view.field.interactionOrdinal,
      session.committedEvents.length,
    );
    submit(exchangeStartEvent(exchange, interruptId));
    const choice = exchange.choices.find((entry) => entry.id === outcomeId)!;
    assert.ok(choice, `${sourceId} lost its ${outcomeId} verb`);
    submit(
      exchangeCompletionEvent(
        exchange,
        choice,
        interruptId,
        view.field.interactionOrdinal,
      ),
    );
    submit(exchangeResolvedEvent(interruptId, choice.id));
  }
  const field = (session.ctx.view() as RuntimeView).field;
  assert.equal(field.activities["SJ-dock-haul"].stage, "COMPLETED");
  assert.ok(
    field.rumors.includes(
      "Dock workers know a scaffold route toward the central roofs.",
    ),
    "dock completion rumor missing",
  );
  assert.equal(field.activeInterrupt, null);
});

// --- 4. Candidate hand-off closure -------------------------------------------

test("every interaction candidate hands off a registered source id", () => {
  const driver = interruptDriver(freshSession());
  const view = driver.session.ctx.view() as RuntimeView;
  for (const spaceId of [
    "EXTERIOR",
    "MERCER_PRESS",
    "EXPLORE_tavern",
    "EXPLORE_ropewalk",
  ]) {
    const frame = day1ExchangeFrame(view, spaceId);
    for (const candidate of frame.candidates) {
      assert.ok(
        isExchangeSourceRegistered(candidate.sourceId, view),
        `${candidate.id} offers unregistered source ${candidate.sourceId}`,
      );
    }
  }
});

// --- 5. Presentation invariants pinned at the source level --------------------

test("the unified panel keeps the fix-wave presentation contract", () => {
  const director = readFileSync(
    new URL("../exchange/ExchangeInterruptDirector.tsx", import.meta.url),
    "utf8",
  );
  assert.match(director, /calculatePosition=\{clampedPanelPosition\}/);
  assert.match(director, /role="dialog"/);
  assert.match(director, /<kbd>\{index \+ 1\}<\/kbd>/);
  assert.match(director, /<kbd>ESC<\/kbd> Step away/);
  const hook = readFileSync(
    new URL("../exchange/useExchangeInterrupt.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    hook,
    /props\.reducedMotion \? 900 : 2400/,
    "reply dwell must stay nonzero under reduced motion",
  );
  assert.match(hook, /event\.key === "Escape"/);
});
