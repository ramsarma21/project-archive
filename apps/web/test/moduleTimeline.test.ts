import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MODULE_FRAME_MS,
  advanceModuleTimeline,
  beatDurationMs,
  createModuleCursor,
  moduleBeatDurations,
  seekModuleTimeline,
} from "../src/module/moduleTimeline.js";

// The cinematic cursor advances beats WITHIN a card by clamped frame deltas.
// The audited failure it exists to prevent is a stall or backgrounded tab
// fast-forwarding the whole slideshow so the learner returns to a finished,
// unseen scene. It never turns the card — that is the learner's.

const beats = [{ id: "a", text: "one two three" }, { id: "b", text: "four five" }, { id: "c", text: "six" }];
const durations = moduleBeatDurations(beats);

test("a normal frame advances within a beat", () => {
  const cursor = createModuleCursor(3);
  const next = advanceModuleTimeline(durations, cursor, 16);
  assert.equal(next.beatIndex, 0);
  assert.equal(next.elapsedInBeatMs, 16);
  assert.equal(next.done, false);
});

test("a giant stall delta cannot fast-forward past unseen beats", () => {
  // Simulate a five-minute background gap: a single frame reports 300_000ms.
  const cursor = createModuleCursor(3);
  const next = advanceModuleTimeline(durations, cursor, 300_000);
  // Clamped to at most MAX_MODULE_FRAME_MS of progress: still on the first beat
  // (its duration far exceeds the clamp), nowhere near the end of the scene.
  assert.equal(next.beatIndex, 0);
  assert.ok(next.elapsedInBeatMs <= MAX_MODULE_FRAME_MS);
  assert.equal(next.done, false);
});

test("many clamped frames are needed to cross the scene — no skipping", () => {
  let cursor = createModuleCursor(3);
  let frames = 0;
  while (!cursor.done && frames < 100_000) {
    cursor = advanceModuleTimeline(durations, cursor, 300_000); // each clamped
    frames += 1;
  }
  const total = durations.reduce((a, b) => a + b, 0);
  // At most MAX_MODULE_FRAME_MS per frame, so at least total/clamp frames.
  assert.ok(frames >= Math.floor(total / MAX_MODULE_FRAME_MS) - 3, `took ${frames} frames`);
  assert.equal(cursor.done, true);
});

test("the cursor holds on the last beat and never rolls off the scene", () => {
  let cursor = createModuleCursor(3);
  for (let i = 0; i < 100; i += 1) cursor = advanceModuleTimeline(durations, cursor, MAX_MODULE_FRAME_MS);
  assert.equal(cursor.beatIndex, durations.length - 1);
  assert.equal(cursor.done, true);
});

test("an empty scene is done at once and advancing is a no-op", () => {
  const cursor = createModuleCursor(0);
  assert.equal(cursor.done, true);
  const next = advanceModuleTimeline([], cursor, 100);
  assert.equal(next.done, true);
  assert.equal(next.beatIndex, 0);
});

test("seeking shows a beat fresh without marking the scene done", () => {
  const cursor = seekModuleTimeline(durations, 1);
  assert.equal(cursor.beatIndex, 1);
  assert.equal(cursor.elapsedInBeatMs, 0);
  assert.equal(cursor.done, false);
});

test("beat durations are clamped and scale with word count", () => {
  assert.ok(beatDurationMs("one") >= 2200);
  assert.ok(beatDurationMs("word ".repeat(400)) <= 14_000);
  assert.ok(beatDurationMs("a b c d e f g h") > beatDurationMs("a b"));
});
