import test from "node:test";
import assert from "node:assert/strict";
import type { Flow, Ctx } from "@pa/runtime";
import { Ctx as RuntimeCtx, Session } from "@pa/runtime";
import type { PresenterEvent } from "@pa/contracts";
import {
  BOSTON_1765_CHAPTER,
  resolveNedWager,
} from "../src/index.js";
import { THREAD_IDS } from "../src/fieldIds.js";

test("each Ned wager resolves from committed day facts", () => {
  const completed = {
    THOMAS_CIRCULAR: "COMPLETED",
    PIKE_PROOF: "COMPLETED",
    CUSTOMHOUSE_NOTICE: "COMPLETED",
    RIDER_HANDBILLS: "COMPLETED",
  };
  assert.deepEqual(
    resolveNedWager({
      flags: { NED_WAGER_ACCEPTED: true, NED_WAGER_BEAT_BELL: true },
      objectives: completed,
      bestQuality: "USABLE",
      confrontationCount: 1,
      chaseCount: 0,
    }),
    { kind: "bell", won: true },
  );
  assert.deepEqual(
    resolveNedWager({
      flags: { NED_WAGER_ACCEPTED: true, NED_WAGER_OUT_PRINT: true },
      objectives: {},
      bestQuality: "CRISP",
      confrontationCount: 2,
      chaseCount: 1,
    }),
    { kind: "print", won: true },
  );
  assert.deepEqual(
    resolveNedWager({
      flags: { NED_WAGER_ACCEPTED: true, NED_WAGER_AVOID_STOP: true },
      objectives: {},
      bestQuality: null,
      confrontationCount: 1,
      chaseCount: 0,
    }),
    { kind: "watch", won: false },
  );
});

function* roamFlow(_ctx: Ctx): Flow {
  yield {
    present: [],
    request: {
      kind: "FREE_ROAM",
      targets: [{ targetId: "STREET", label: "Street", marker: "GOLD" }],
      selectedTargetId: "STREET",
      canProceed: false,
    },
    cueId: "NED.WAGER.TEST",
  };
}

test("accepted wager flags and progress survive replay and resume", () => {
  const seed = new Uint8Array(16).fill(47);
  const events: PresenterEvent[] = [
    {
      type: "FIELD_INTERRUPT_STARTED",
      eventId: "ned-wager-start",
      interruptId: "ned-wager",
      interruptKind: "REACTIVE_EXCHANGE",
      sourceId: "THR-ned",
    },
    {
      type: "FIELD_REACTIVE_COMPLETED",
      eventId: "ned-wager-accepted",
      interruptId: "ned-wager",
      completion: {
        interactionId: "THR-ned:WAGER_PRINT",
        sourceId: "THR-ned",
        outcomeId: "WAGER_PRINT",
        threads: [{
          threadId: THREAD_IDS.NED,
          flags: {
            MET: true,
            NED_WAGER_ACCEPTED: true,
            NED_WAGER_OUT_PRINT: true,
          },
          status: "ACTIVE",
          trustDelta: 1,
          breadcrumb: "Ned wagered on a crisp sheet.",
        }],
      },
    },
    {
      type: "FIELD_INTERRUPT_RESOLVED",
      eventId: "ned-wager-resolved",
      interruptId: "ned-wager",
      outcome: "WAGER_PRINT",
    },
  ];
  const live = new Session(
    new RuntimeCtx(seed, BOSTON_1765_CHAPTER),
    roamFlow,
  );
  for (const event of events) live.advance(event);
  const resumed = new Session(
    new RuntimeCtx(seed, BOSTON_1765_CHAPTER),
    roamFlow,
    events,
  );
  assert.deepEqual(
    resumed.ctx.field.threads[THREAD_IDS.NED],
    live.ctx.field.threads[THREAD_IDS.NED],
  );
  assert.equal(
    resumed.ctx.field.threads[THREAD_IDS.NED]?.flags.NED_WAGER_OUT_PRINT,
    true,
  );
});
