import test from "node:test";
import assert from "node:assert/strict";
import { breatherScheduleKey } from "../src/presenter/Controls.js";

test("projection-only request clones preserve a breather timer", () => {
  const first = {
    kind: "BREATHER" as const,
    durationMs: 7000,
    requestId: "BOS.MD01.CUE.BREATHER_AFTER_CUSTOMHOUSE_NOTICE.v1",
  };
  const projectionRefresh = structuredClone(first);
  assert.notEqual(projectionRefresh, first);
  assert.equal(
    breatherScheduleKey(projectionRefresh),
    breatherScheduleKey(first),
  );
});

test("consecutive authored breathers always receive distinct schedules", () => {
  assert.notEqual(
    breatherScheduleKey({
      kind: "BREATHER",
      durationMs: 7000,
      requestId: "BOS.MD01.CUE.BREATHER_AFTER_PIKE_PROOF.v1",
    }),
    breatherScheduleKey({
      kind: "BREATHER",
      durationMs: 7000,
      requestId: "BOS.MD01.CUE.BREATHER_AFTER_CUSTOMHOUSE_NOTICE.v1",
    }),
  );
});
