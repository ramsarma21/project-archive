import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx, Flow } from "@pa/runtime";
import { Ctx as RuntimeCtx, Session } from "@pa/runtime";
import type { PresenterEvent } from "@pa/contracts";
import { BOSTON_1765_CHAPTER } from "../src/index.js";

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
