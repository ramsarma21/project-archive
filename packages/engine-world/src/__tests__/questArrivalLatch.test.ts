import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARRIVAL_RETRY_MS,
  beginArrivalAttempt,
  createArrivalLatch,
  settleArrivalAttempt,
  shouldAttemptArrival,
} from "../questArrivalLatch.js";

// Feel-audit-1 P0-6 regression: the one-shot arrival latch may only be
// consumed by an ACCEPTED runtime commit. The audited effigy stall happened
// because the latch was consumed before the commit was accepted: the single
// FREE_ROAM_GOTO landed in a transient guard window, was dropped, and the
// event could never re-arm without a save/exit/resume cycle.

const KEY = "BOS.MD01.CUE.WALK_TO_LIBERTY_TREE.v1|CROWD";

test("a dropped commit leaves the latch clear and retries after backoff", () => {
  let state = createArrivalLatch();
  assert.ok(shouldAttemptArrival(state, KEY, 1_000, true));
  state = beginArrivalAttempt(state, KEY);
  // In flight: no duplicate attempts.
  assert.ok(!shouldAttemptArrival(state, KEY, 1_001, true));
  // Runtime dropped it (busy/persist window).
  state = settleArrivalAttempt(state, KEY, false, 1_050);
  assert.equal(state.firedKey, null, "latch must NOT be consumed by a drop");
  // Backoff window holds…
  assert.ok(!shouldAttemptArrival(state, KEY, 1_060, true));
  // …then the arrival re-fires while the player still stands in the radius.
  assert.ok(shouldAttemptArrival(state, KEY, 1_050 + ARRIVAL_RETRY_MS, true));
});

test("an accepted commit consumes the latch exactly once", () => {
  let state = createArrivalLatch();
  state = beginArrivalAttempt(state, KEY);
  state = settleArrivalAttempt(state, KEY, true, 1_050);
  assert.equal(state.firedKey, KEY);
  assert.ok(
    !shouldAttemptArrival(state, KEY, 999_999, true),
    "an accepted arrival never re-fires for the same cue|target",
  );
  // A NEW objective instance (different cue) is a fresh key.
  assert.ok(shouldAttemptArrival(state, "OTHER.CUE|CROWD", 999_999, true));
});

test("attempts require arrival conditions", () => {
  const state = createArrivalLatch();
  assert.ok(!shouldAttemptArrival(state, KEY, 1_000, false));
});

test("stale settlements for other keys are ignored", () => {
  let state = createArrivalLatch();
  state = beginArrivalAttempt(state, KEY);
  const unchanged = settleArrivalAttempt(state, "OTHER", false, 2_000);
  assert.deepEqual(unchanged, state);
});
