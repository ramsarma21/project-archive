import type { InputRequest, PresenterEvent } from "@pa/contracts";
import { createDay1Session } from "../src/index.js";
import { autoplay } from "./autoplay.js";

// The CP1 mastery gate: wrong answers climb the locked friction ladder
// (memory cue -> explicit -> elimination), passage is guaranteed, hints are
// recorded, and >=2 hints marks the macro REVISIT + spaced re-test DUE.

const seed = "5c".repeat(32);

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message = "values differ"): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

// Drive a run to the first CP1 QUESTION phase using the happy autoplay
// responder, then take manual control of the debrief.
function sessionAtFirstQuestion() {
  const run = autoplay(seed, "happy");
  const firstAnswer = run.events.findIndex((e) => e.type === "DEBRIEF_ANSWERED");
  assert(firstAnswer > 0, "autoplay must reach the debrief");
  return createDay1Session({
    variationRootSeedHex: seed,
    assessmentMode: "QA_DRAFT",
    priorEvents: run.events.slice(0, firstAnswer),
  });
}

{
  // Wrong -> memory cue (from provenance) -> wrong same -> explicit ->
  // wrong distinct -> elimination -> forced resolution.
  const session = sessionAtFirstQuestion();
  const req = session.plan?.request;
  assert(req?.kind === "CHECKPOINT_DEBRIEF" && req.phase === "QUESTION" && req.item);
  const item = req.item!;
  const formId = req.state.selection!.formId;
  const wrongIds = item.options
    .map((o) => o.optionId)
    .filter((id) => id !== item.correctOptionId);
  assert(wrongIds.length === 2, "fixture items carry 2 distractors");

  const answer = (optionId: string): InputRequest | null => {
    const r = session.advance({
      type: "DEBRIEF_ANSWERED",
      checkpointId: req.checkpointId,
      formId,
      itemId: item.itemId,
      optionId,
    } as PresenterEvent);
    return r.plan?.request ?? null;
  };

  // attempt 1: wrong -> MEMORY_CUE, no eliminations, 3s dwell / 2s pause
  let next = answer(wrongIds[0]!);
  assert(next?.kind === "CHECKPOINT_DEBRIEF" && next.gate, "gate must appear");
  equal(next.gate!.hintKind, "MEMORY_CUE", "first hint is the memory cue");
  equal(next.gate!.attempt, 1);
  equal(next.gate!.disabledOptionIds.length, 0);
  equal(next.gate!.dwellMs, 3000);
  equal(next.gate!.pauseMs, 2000);
  assert(
    next.gate!.hint.startsWith("Remember "),
    `memory cue must cue a lived moment, got: ${next.gate!.hint}`,
  );

  // attempt 2: same wrong again -> EXPLICIT, 4s dwell / 4s pause
  next = answer(wrongIds[0]!);
  assert(next?.kind === "CHECKPOINT_DEBRIEF" && next.gate);
  equal(next.gate!.hintKind, "EXPLICIT", "second hint is explicit");
  equal(next.gate!.pauseMs, 4000);

  // attempt 3: other wrong -> ELIMINATION begins, picked distractors die first
  next = answer(wrongIds[1]!);
  assert(next?.kind === "CHECKPOINT_DEBRIEF" && next.gate);
  equal(next.gate!.hintKind, "ELIMINATION");
  equal(next.gate!.disabledOptionIds.length, 1, "one distractor eliminated");
  equal(next.gate!.pauseMs, 6000);

  // Correct answer resolves; hintsUsed recorded; macro marked REVISIT.
  next = answer(item.correctOptionId);
  assert(next?.kind === "CHECKPOINT_DEBRIEF", "moves to the next item");
  const response = session.ctx.checkpoint.responses.find((r) => r.itemId === item.itemId);
  assert(response, "response recorded");
  equal(response!.hintsUsed, 3, "three wrong attempts recorded");
  const outcome = session.ctx.checkpoint.macroOutcomes.find((o) => o.itemId === item.itemId);
  assert(outcome, "macro outcome recorded");
  equal(outcome!.correct, false, ">=2 hints -> REVISIT");
}

{
  // Selecting an eliminated option is a protocol violation and commits nothing.
  const session = sessionAtFirstQuestion();
  const req = session.plan?.request;
  assert(req?.kind === "CHECKPOINT_DEBRIEF" && req.item);
  const item = req.item!;
  const formId = req.state.selection!.formId;
  const wrongIds = item.options
    .map((o) => o.optionId)
    .filter((id) => id !== item.correctOptionId);
  // three wrongs: 1 -> memory, 2 -> explicit, 3 -> eliminate first picked
  for (const id of [wrongIds[0]!, wrongIds[0]!, wrongIds[1]!]) {
    session.advance({
      type: "DEBRIEF_ANSWERED",
      checkpointId: req.checkpointId,
      formId,
      itemId: item.itemId,
      optionId: id,
    } as PresenterEvent);
  }
  const gate = (session.plan?.request as Extract<InputRequest, { kind: "CHECKPOINT_DEBRIEF" }>).gate;
  assert(gate && gate.disabledOptionIds.length === 1);
  const before = session.committedEvents.length;
  let threw = false;
  try {
    session.advance({
      type: "DEBRIEF_ANSWERED",
      checkpointId: req.checkpointId,
      formId,
      itemId: item.itemId,
      optionId: gate.disabledOptionIds[0]!,
    } as PresenterEvent);
  } catch (error) {
    threw = error instanceof Error && /eliminated option/.test(error.message);
  }
  assert(threw, "eliminated option must reject");
  equal(session.committedEvents.length, before, "nothing committed");
}

{
  // One hint only -> macro still counts correct (no bonus tier here), no REVISIT.
  const session = sessionAtFirstQuestion();
  const req = session.plan?.request;
  assert(req?.kind === "CHECKPOINT_DEBRIEF" && req.item);
  const item = req.item!;
  const formId = req.state.selection!.formId;
  const wrongId = item.options.find((o) => o.optionId !== item.correctOptionId)!.optionId;
  session.advance({
    type: "DEBRIEF_ANSWERED",
    checkpointId: req.checkpointId,
    formId,
    itemId: item.itemId,
    optionId: wrongId,
  } as PresenterEvent);
  session.advance({
    type: "DEBRIEF_ANSWERED",
    checkpointId: req.checkpointId,
    formId,
    itemId: item.itemId,
    optionId: item.correctOptionId,
  } as PresenterEvent);
  const outcome = session.ctx.checkpoint.macroOutcomes.find((o) => o.itemId === item.itemId);
  assert(outcome);
  equal(outcome!.correct, true, "1 hint still passes clean-enough");
  equal(outcome!.hintsUsed, 1);
}

{
  // Deterministic replay: a run containing gate traffic replays to the same state.
  const session = sessionAtFirstQuestion();
  const req = session.plan?.request;
  assert(req?.kind === "CHECKPOINT_DEBRIEF" && req.item);
  const item = req.item!;
  const formId = req.state.selection!.formId;
  const wrongId = item.options.find((o) => o.optionId !== item.correctOptionId)!.optionId;
  for (const id of [wrongId, item.correctOptionId]) {
    session.advance({
      type: "DEBRIEF_ANSWERED",
      checkpointId: req.checkpointId,
      formId,
      itemId: item.itemId,
      optionId: id,
    } as PresenterEvent);
  }
  const replay = createDay1Session({
    variationRootSeedHex: seed,
    assessmentMode: "QA_DRAFT",
    priorEvents: [...session.committedEvents],
  });
  equal(
    JSON.stringify(replay.ctx.checkpoint.responses),
    JSON.stringify(session.ctx.checkpoint.responses),
    "gate traffic must replay deterministically",
  );
  equal(replay.plan?.cueId, session.plan?.cueId, "same resume point");
}

console.log("cp1-gate: all assertions passed");
