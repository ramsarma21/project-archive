import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Flow } from "@pa/runtime";
import { Ctx as RuntimeCtx, Session } from "@pa/runtime";
import type { PresenterEvent } from "@pa/contracts";
import { BOSTON_1765_CHAPTER } from "../src/index.js";
import { createDay1Session } from "../src/index.js";

function* roam(_ctx: Ctx): Flow {
  yield {
    present: [],
    request: {
      kind: "FREE_ROAM",
      targets: [{ targetId: "MERCER_PRESS", label: "Mercer", marker: "GOLD" }],
      canProceed: false,
    },
    cueId: "MAP.TEST.ROAM",
  };
}

test("map discovery is durable, deterministic, and idempotent", () => {
  const seed = new Uint8Array(16).fill(61);
  const event: PresenterEvent = {
    type: "FIELD_MAP_DISCOVERED",
    eventId: "MAP_DISCOVERED:MERCER",
    landmarkId: "MERCER",
  };
  const live = new Session(
    new RuntimeCtx(seed, BOSTON_1765_CHAPTER),
    roam,
  );
  live.advance(event);
  live.advance({ ...event, eventId: "MAP_DISCOVERED:MERCER:RETRY" });
  assert.deepEqual(live.ctx.field.discoveredMapIds, ["MERCER"]);
  const resumed = new Session(
    new RuntimeCtx(seed, BOSTON_1765_CHAPTER),
    roam,
    [event],
  );
  assert.deepEqual(
    resumed.ctx.view().field.discoveredMapIds,
    live.ctx.view().field.discoveredMapIds,
  );
});

test("a free-roam discovery may settle across the arrival choice handoff", () => {
  const session = createDay1Session({
    variationRootSeedHex: "63".repeat(32),
  });
  session.advance({ type: "CONTINUE" });
  session.advance({
    type: "FREE_ROAM_GOTO",
    targetId: "MERCER_PRESS",
  });
  assert.equal(session.plan?.request.kind, "CHOICE");
  session.advance({
    type: "FIELD_MAP_DISCOVERED",
    eventId: "MAP_DISCOVERED:MERCER",
    landmarkId: "MERCER",
  });
  assert.equal(session.plan?.request.kind, "CHOICE");
  assert.deepEqual(session.ctx.field.discoveredMapIds, ["MERCER"]);
  session.advance({
    type: "FIELD_HEAT_DECAY_CHECKPOINT",
    eventId: "HEAT_DECAY_CHOICE_HANDOFF",
    band: "CALM",
    elapsedSeconds: 0,
    paused: false,
  });
  assert.equal(session.plan?.request.kind, "CHOICE");
  session.advance({
    type: "FIELD_HEAT_TRANSITION",
    eventId: "STALE_HEAT_DECAY_CHOICE_HANDOFF",
    from: "HUNTED",
    to: "WATCHED",
    cause: "DECAY",
  });
  assert.equal(session.ctx.field.heat.band, "CALM");
  assert.equal(session.plan?.request.kind, "CHOICE");
});
