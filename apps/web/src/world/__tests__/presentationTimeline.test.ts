import { test } from "node:test";
import assert from "node:assert/strict";
import type { PresentationDirective } from "@pa/contracts";
import {
  MAX_TIMELINE_FRAME_MS,
  activeStep,
  advanceTimeline,
  buildTimeline,
  createTimelineCursor,
  subtitleDurationMs,
} from "../../presenter/presentationTimeline.js";

// Feel-audit-1 P0-1 regression: a wall-clock stall (frozen main thread,
// hidden tab, timer burst) must never fast-forward a presentation batch past
// its beats. The Mercer arrival dialogue was lost exactly this way.

const arrival: PresentationDirective[] = [
  {
    kind: "SCENE",
    locationId: "MERCER_PRESS",
    text: "Inside, the press knocks against the floorboards.",
  } as PresentationDirective,
  {
    kind: "DIALOGUE",
    speaker: "ABIGAIL",
    text: "If you're here for work, come in.",
  } as PresentationDirective,
  {
    kind: "DIALOGUE",
    speaker: "ABIGAIL",
    text: "Good, catch.",
  } as PresentationDirective,
];

test("buildTimeline compiles location swap + subtitles with gaps", () => {
  const steps = buildTimeline(arrival, "BOSTON_STREET", "STANDARD");
  assert.deepEqual(
    steps.map((step) => step.kind),
    ["LOCATION", "SUBTITLE", "GAP", "SUBTITLE", "GAP", "SUBTITLE", "GAP"],
  );
  // Durations mirror the reading-time model.
  assert.equal(
    steps[1]!.durationMs,
    subtitleDurationMs("Inside, the press knocks against the floorboards.", "STANDARD"),
  );
});

test("a single stalled frame advances at most the clamped delta", () => {
  const steps = buildTimeline(arrival, "BOSTON_STREET", "STANDARD");
  let cursor = createTimelineCursor(steps);
  // Simulate a 3-minute main-thread stall delivered as one giant delta.
  cursor = advanceTimeline(steps, cursor, 180_000);
  assert.equal(cursor.done, false, "a stall must not complete the batch");
  const consumed =
    steps.slice(0, cursor.stepIndex).reduce((sum, step) => sum + step.durationMs, 0) +
    cursor.elapsedInStepMs;
  assert.ok(
    consumed <= MAX_TIMELINE_FRAME_MS,
    `one frame may consume at most ${MAX_TIMELINE_FRAME_MS}ms (consumed ${consumed})`,
  );
});

test("every subtitle is displayed under a burst of stalled frames", () => {
  const steps = buildTimeline(arrival, "BOSTON_STREET", "STANDARD");
  let cursor = createTimelineCursor(steps);
  const displayed = new Set<string>();
  let guard = 0;
  while (!cursor.done && guard < 10_000) {
    guard += 1;
    const step = activeStep(steps, cursor);
    if (step?.kind === "SUBTITLE" && "text" in step.directive) {
      displayed.add(step.directive.text);
    }
    // Pathological cadence: alternating instant frames and huge stalls.
    cursor = advanceTimeline(steps, cursor, guard % 2 === 0 ? 100_000 : 120);
  }
  assert.equal(cursor.done, true);
  assert.equal(displayed.size, 3, "all three arrival beats must have been shown");
});

test("normal frame cadence completes in authored time", () => {
  const steps = buildTimeline(arrival, "BOSTON_STREET", "STANDARD");
  const total = steps.reduce((sum, step) => sum + step.durationMs, 0);
  let cursor = createTimelineCursor(steps);
  let elapsed = 0;
  while (!cursor.done) {
    cursor = advanceTimeline(steps, cursor, 16.67);
    elapsed += 16.67;
  }
  assert.ok(
    Math.abs(elapsed - total) < 50,
    `authored duration preserved (total ${total}, played ${elapsed})`,
  );
});

test("empty batches are done immediately", () => {
  const cursor = createTimelineCursor([]);
  assert.equal(cursor.done, true);
});
