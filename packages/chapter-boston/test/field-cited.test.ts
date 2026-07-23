// Knowledge as ammunition (design1 feature 2): the cited confrontation
// option and the micro-gated exchange outcome are runtime-authoritative,
// deterministic, and replay-safe. Never gates required learning; the plain
// Comply/Talk/Run triangle and the Talk failure path are untouched.
import type { PresenterEvent } from "@pa/contracts";
import { CITED_CONFRONTATION_DEFENSES, MICRO_CONCEPT_IDS } from "../src/fieldIds.js";
import { Ctx, Session, compileFieldVocabulary } from "@pa/runtime";
import { BOSTON_1765_CHAPTER } from "../src/index.js";
import type { Flow } from "@pa/runtime";
import { citedConfrontationOptionFor } from "@pa/runtime";
import { resolveRegisteredReactiveOutcome } from "../src/day1/reactive.js";

const VOCAB = compileFieldVocabulary(BOSTON_1765_CHAPTER.fieldVocabulary);

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

function* roamFlow(_ctx: Ctx): Flow {
  yield {
    present: [],
    request: {
      kind: "FREE_ROAM",
      targets: [{ targetId: "PIKE_PROOF", label: "Pike's proof", marker: "GOLD" }],
      canProceed: false,
      selectedTargetId: "PIKE_PROOF",
    },
    cueId: "TEST.ROAM",
  };
}

const seed = new Uint8Array(16).fill(29);

const WRITS_ENGAGED: PresenterEvent = {
  type: "FIELD_MICRO_ENGAGED",
  eventId: "writs-poster-read",
  record: {
    recordId: "writs-poster-record",
    microConceptId: MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE,
    sourceId: "KN-customhouse",
    interactionOrdinal: 1,
  },
};

const CHALLENGE: PresenterEvent = {
  type: "FIELD_WATCHER_CHALLENGE",
  eventId: "cited-challenge",
  interruptId: "cited-interrupt",
  challengeId: "cited-challenge-id",
  watcherId: "WATCH-customs",
  reason: "CHECKPOINT",
};

// The authored defense table itself: exactly one writs entry with real copy.
{
  const writs = CITED_CONFRONTATION_DEFENSES.find(
    (defense) => defense.microConceptId === MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE,
  );
  assert(writs, "writs defense is authored");
  equal(writs!.choice, "CITE");
  equal(writs!.label, "Quote the writs procedure");
  assert(writs!.line.length > 0 && writs!.reply.length > 0);
}

// The option is offered ONLY with the durable engagement, only while choosing.
{
  const session = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow);
  session.advance(CHALLENGE);
  equal(
    session.ctx.view().field.citedConfrontationOption,
    null,
    "no engagement -> no cited option",
  );
  equal(citedConfrontationOptionFor(session.ctx.field, VOCAB), null);

  const armed = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow, [WRITS_ENGAGED, CHALLENGE]);
  const offered = armed.ctx.view().field.citedConfrontationOption;
  assert(offered, "engaged writs -> cited option offered");
  equal(offered!.microConceptId, MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE);
  equal(offered!.label, "Quote the writs procedure");
}

// A presenter can never invent the option: CITE without engagement rejects,
// and the confrontation stays exactly where it was (failure paths unchanged).
{
  const session = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow);
  session.advance(CHALLENGE);
  throws(
    () =>
      session.advance({
        type: "FIELD_CONFRONTATION_DECISION",
        eventId: "cite-unarmed",
        interruptId: "cited-interrupt",
        choice: "CITE",
      }),
    "requires its durably engaged micro-concept",
  );
  equal(session.ctx.field.activeConfrontation?.phase, "CHOOSING");
  // The ordinary triangle still resolves: talk at CALM succeeds as before.
  session.advance({
    type: "FIELD_CONFRONTATION_DECISION",
    eventId: "talk-after-reject",
    interruptId: "cited-interrupt",
    choice: "TALK",
  });
  equal(session.ctx.field.activeConfrontation?.outcome, "TALK_RELEASED");
}

// Armed cite: the constable stands down deterministically — no search, no
// clock cost, no recognized flag, and heat steps DOWN one band (CITED cause).
{
  const ctx = new Ctx(seed, BOSTON_1765_CHAPTER);
  const session = new Session(ctx, roamFlow);
  const originalPlan = session.plan;
  const events: PresenterEvent[] = [
    WRITS_ENGAGED,
    {
      type: "FIELD_HEAT_TRANSITION",
      eventId: "pre-watched",
      from: "CALM",
      to: "WATCHED",
      cause: "DETECTION",
    },
    CHALLENGE,
    {
      type: "FIELD_CONFRONTATION_DECISION",
      eventId: "cite-decision",
      interruptId: "cited-interrupt",
      choice: "CITE",
    },
  ];
  for (const event of events) session.advance(event);
  equal(ctx.field.activeConfrontation?.phase, "RESOLVING");
  equal(ctx.field.activeConfrontation?.outcome, "CITED_RELEASED");
  const clockBefore = ctx.world.clock.spentUnits;
  const resolve: PresenterEvent = {
    type: "FIELD_CONFRONTATION_RESOLVED",
    eventId: "cite-resolved",
    interruptId: "cited-interrupt",
    outcome: "CITED_RELEASED",
  };
  session.advance(resolve);
  equal(ctx.field.heat.band, "NOTICED", "heat steps down one band");
  equal(ctx.field.heat.history.at(-1)?.cause, "CITED");
  equal(ctx.field.identity.recognized, false, "citing never marks the face");
  equal(ctx.world.clock.spentUnits, clockBefore, "citing costs no daylight");
  equal(ctx.field.activeConfrontation, null);
  equal(ctx.field.confrontationHistory.at(-1)?.outcome, "CITED_RELEASED");
  deepEqual(session.plan, originalPlan, "suspended route resumes exactly");

  // Replay safety: the same committed log reproduces the same field state.
  const replay = new Session(new Ctx(seed, BOSTON_1765_CHAPTER), roamFlow, [...events, resolve]);
  deepEqual(replay.ctx.view().field, ctx.view().field);
}

// Cite is a CHOOSING-only card: after a failed talk the recovery options stay
// exactly comply-or-run, even with the micro engaged.
{
  const ctx = new Ctx(seed, BOSTON_1765_CHAPTER);
  const session = new Session(ctx, roamFlow);
  session.advance(WRITS_ENGAGED);
  session.advance({
    type: "FIELD_IDENTITY_CHANGED",
    eventId: "clarke-marked",
    clarkeMarked: true,
    reason: "clarke-informed",
  });
  session.advance({
    type: "FIELD_HEAT_TRANSITION",
    eventId: "hunted",
    from: "CALM",
    to: "HUNTED",
    cause: "RUN",
  });
  session.advance(CHALLENGE);
  session.advance({
    type: "FIELD_CONFRONTATION_DECISION",
    eventId: "talk-fails",
    interruptId: "cited-interrupt",
    choice: "TALK",
  });
  equal(ctx.field.activeConfrontation?.phase, "TALK_FAILED");
  equal(
    ctx.view().field.citedConfrontationOption,
    null,
    "cited option is withdrawn once talk has failed",
  );
  throws(
    () =>
      session.advance({
        type: "FIELD_CONFRONTATION_DECISION",
        eventId: "cite-after-failure",
        interruptId: "cited-interrupt",
        choice: "CITE",
      }),
    "before talk fails",
  );
}

// Exchange side: the merchant-defense outcome resolves only with the
// non-importation engagement; effects are deterministic.
{
  const ctx = new Ctx(seed, BOSTON_1765_CHAPTER);
  throws(
    () =>
      resolveRegisteredReactiveOutcome({
        field: ctx.field,
        interactionId: "NPC-clarke:1",
        sourceId: "NPC-clarke",
        outcomeId: "CITE_COMPACT",
      }),
    "requires engaged MICRO.NON_IMPORTATION",
  );
  ctx.applyFieldEvent({
    type: "FIELD_MICRO_ENGAGED",
    eventId: "nonimport-engaged",
    record: {
      recordId: "nonimport-record",
      microConceptId: MICRO_CONCEPT_IDS.NON_IMPORTATION,
      sourceId: "NPC-thomas",
      interactionOrdinal: 1,
    },
  });
  const first = resolveRegisteredReactiveOutcome({
    field: ctx.field,
    interactionId: "NPC-clarke:2",
    sourceId: "NPC-clarke",
    outcomeId: "CITE_COMPACT",
  });
  const second = resolveRegisteredReactiveOutcome({
    field: ctx.field,
    interactionId: "NPC-clarke:2",
    sourceId: "NPC-clarke",
    outcomeId: "CITE_COMPACT",
  });
  deepEqual(first, second, "cited exchange effects are deterministic");
  equal(first.relationships?.[0]?.relationshipId, "CLARKE_POLITICAL_READ");
  assert((first.relationships?.[0]?.delta ?? 0) > 0);
  assert(!first.identity, "cited defense never marks the runner");
  assert(!first.heat, "cited defense never raises heat");
  // The reckless CURT path is untouched for players without the knowledge.
  const curt = resolveRegisteredReactiveOutcome({
    field: ctx.field,
    interactionId: "NPC-clarke:3",
    sourceId: "NPC-clarke",
    outcomeId: "CURT",
  });
  equal(curt.identity?.clarkeMarked, true);
}

console.log("field-cited: all assertions passed");
