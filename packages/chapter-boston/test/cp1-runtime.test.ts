import type {
  AssessmentQuestionBank,
  PresenterEvent,
} from "@pa/contracts";
import {
  CP1_DEVELOPMENT_FIXTURE_BANK,
  CP1_PRODUCTION_BANK,
  CP1_REQUIRED_MACROS,
  createDay1Session,
} from "../src/index.js";
import { autoplay } from "./autoplay.js";

const seed = "9a".repeat(32);

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message = "values differ"): void {
  if (actual !== expected) {
    throw new Error(`${message}: ${String(actual)} !== ${String(expected)}`);
  }
}

function cpIndex(
  events: PresenterEvent[],
  type: PresenterEvent["type"],
): number {
  return events.findIndex((event) => event.type === type);
}

{
  const run = autoplay(seed, "happy");
  equal(run.done, true);
  const commitIndex = cpIndex(run.events, "DEBRIEF_COMMITTED");
  const transitionIndex = cpIndex(run.events, "ACT_TRANSITIONED");
  assert(commitIndex > 0);
  assert(transitionIndex > commitIndex);

  const committed = createDay1Session({
    variationRootSeedHex: seed,
    assessmentMode: "QA_DRAFT",
    priorEvents: run.events.slice(0, commitIndex + 1),
  });
  equal(committed.isDone, false);
  equal(committed.ctx.checkpoint.status, "COMMITTED");
  equal(
    committed.ctx.checkpoint.annotation,
    "Set it in type and let the street read it.",
    "optional annotation rides the commit and replays",
  );
  equal(committed.plan?.request.kind, "CHECKPOINT_DEBRIEF");
  equal(
    committed.plan?.request.kind === "CHECKPOINT_DEBRIEF"
      ? committed.plan.request.phase
      : "",
    "TRANSITION",
  );
  assert(committed.ctx.checkpoint.carryover);
  equal(committed.ctx.checkpoint.macroOutcomes.length, 3);
}

{
  const run = autoplay(seed, "happy");
  const firstAnswer = cpIndex(run.events, "DEBRIEF_ANSWERED");
  assert(firstAnswer > 0);
  const prefix = run.events.slice(0, firstAnswer + 1);
  const resumed = createDay1Session({
    variationRootSeedHex: seed,
    assessmentMode: "QA_DRAFT",
    priorEvents: prefix,
  });
  equal(resumed.ctx.checkpoint.responses.length, 1);
  equal(resumed.ctx.checkpoint.currentItemIndex, 1);
  equal(resumed.plan?.request.kind, "CHECKPOINT_DEBRIEF");
  if (resumed.plan?.request.kind !== "CHECKPOINT_DEBRIEF") {
    throw new Error("expected checkpoint request");
  }
  equal(resumed.plan.request.phase, "QUESTION");
  equal(
    resumed.plan.request.item?.itemId,
    resumed.ctx.checkpoint.selection?.itemIds[1],
  );
}

{
  const run = autoplay(seed, "happy");
  const selected = run.events.find(
    (event) => event.type === "DEBRIEF_FORM_SELECTED",
  );
  assert(selected && selected.type === "DEBRIEF_FORM_SELECTED");
  const v2: AssessmentQuestionBank = {
    ...structuredClone(CP1_DEVELOPMENT_FIXTURE_BANK),
    bankVersion: "dev.2",
    items: CP1_DEVELOPMENT_FIXTURE_BANK.items.map((item) => ({
      ...structuredClone(item),
      itemVersion: "dev.2",
    })),
  };
  const registry = new Map([
    [CP1_DEVELOPMENT_FIXTURE_BANK.bankVersion, CP1_DEVELOPMENT_FIXTURE_BANK],
    [v2.bankVersion, v2],
  ]);
  const replay = createDay1Session({
    variationRootSeedHex: seed,
    priorEvents: run.events,
    assessmentConfig: {
      mode: "QA_DRAFT",
      activeBankVersion: v2.bankVersion,
      banks: registry,
    },
  });
  equal(replay.isDone, true);
  equal(
    replay.ctx.checkpoint.selection?.formId,
    selected.selection.formId,
  );
  equal(replay.ctx.checkpoint.bankVersion, "dev.1");
}

{
  const run = autoplay(seed, "happy");
  const firstAnswer = cpIndex(run.events, "DEBRIEF_ANSWERED");
  const session = createDay1Session({
    variationRootSeedHex: seed,
    assessmentMode: "QA_DRAFT",
    priorEvents: run.events.slice(0, firstAnswer),
  });
  const before = session.committedEvents.length;
  const request = session.plan?.request;
  assert(request?.kind === "CHECKPOINT_DEBRIEF");
  if (request?.kind !== "CHECKPOINT_DEBRIEF") throw new Error("expected CP1");
  let threw = false;
  try {
    session.advance({
        type: "DEBRIEF_ANSWERED",
        checkpointId: request.checkpointId,
        formId: request.state.selection?.formId ?? "",
        itemId: "MALFORMED.ITEM",
        optionId: "MALFORMED.OPTION",
      });
  } catch (error) {
    threw = error instanceof Error && /DEBRIEF_EVENT_INVALID/.test(error.message);
  }
  assert(threw, "malformed answer must reject");
  equal(session.committedEvents.length, before);
}

{
  // With all three CP1 macros OWNER_PROVIDED, PRODUCTION mode (the default) now
  // serves the real owner bank instead of the CONTENT_BLOCKED gate. The student
  // path selects the production bank and advances into the questions; no draft
  // fixtures ever appear in production.
  const qaRun = autoplay(seed, "happy");
  const dayEndIndex = cpIndex(qaRun.events, "DEBRIEF_FORM_SELECTED");
  const production = createDay1Session({
    variationRootSeedHex: seed,
    priorEvents: qaRun.events.slice(0, dayEndIndex),
  });
  equal(production.plan?.request.kind, "CHECKPOINT_DEBRIEF");
  if (production.plan?.request.kind !== "CHECKPOINT_DEBRIEF") {
    throw new Error("expected production form selection");
  }
  const request = production.plan.request;
  equal(request.phase, "FORM_SELECTION");
  const proposed = request.proposedSelection;
  assert(proposed, "production proposes a real form");
  equal(proposed!.bankVersion, "0.1.0-owner.2", "form rides the production bank");
  equal(proposed!.macroItemIds.length, 3, "all three CP1 macros in the form");
  // Every selected macro item is an OWNER_PROVIDED item covering each required
  // macro concept exactly once.
  const coveredConcepts = new Set<string>();
  for (const itemId of proposed!.macroItemIds) {
    const item = CP1_PRODUCTION_BANK.items.find((i) => i.itemId === itemId);
    assert(item, `selected item ${itemId} lives in the production bank`);
    equal(item!.approvalStatus, "OWNER_PROVIDED", `${itemId} is owner-provided`);
    coveredConcepts.add(item!.conceptId);
  }
  for (const macro of CP1_REQUIRED_MACROS) {
    assert(coveredConcepts.has(macro), `production form covers macro ${macro}`);
  }
  // Committing the proposed form is accepted and advances into the questions —
  // the gate is unblocked, not rejected.
  const after = production.advance({
    type: "DEBRIEF_FORM_SELECTED",
    checkpointId: request.checkpointId,
    selection: proposed!,
  });
  assert(
    after.plan?.request.kind === "CHECKPOINT_DEBRIEF" &&
      after.plan.request.phase === "QUESTION",
    "production advances into the question phase, unblocked",
  );
}
