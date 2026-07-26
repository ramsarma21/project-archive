import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { GradingSignal, GRADING_METRIC_MARKER } from "../src/duels/gradingSignal.js";

// The signal that makes a grading outage visible.
//
// THE CONDITION THIS EXISTS FOR. Grading grants the maximum on timeout, which is
// the right rule and means an unreachable gateway is indistinguishable from a class
// of geniuses: every answer CORRECT, a full magazine each, /v1/health green, and a
// review log nobody reads during a lesson.
//
// TWO PROPERTIES ARE ASSERTED, AND THE SECOND IS THE ONE THAT ROTS.
//
//   1. The rate is computed, classified and escalated correctly.
//   2. `infra/lib/project-archive-stack.ts` still matches the field names this file
//      writes. The alarm reads them through a CloudWatch log metric filter, and a
//      rename here produces a metric that is permanently zero — which reads exactly
//      like healthy grading. Nothing else in either file would fail.

const stack = readFileSync(
  resolve(import.meta.dirname, "../../../infra/lib/project-archive-stack.ts"),
  "utf8",
);

interface Line {
  readonly fields: Record<string, unknown>;
  readonly level: "info" | "error";
}

function recorder(): { lines: Line[]; logger: FastifyBaseLogger } {
  const lines: Line[] = [];
  const push = (level: Line["level"]) => (fields: unknown) =>
    lines.push({ fields: fields as Record<string, unknown>, level });
  return {
    lines,
    logger: {
      info: push("info"),
      error: push("error"),
      warn: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
    } as unknown as FastifyBaseLogger,
  };
}

function round(fallback: boolean, index = 1) {
  return {
    profileId: "11111111-1111-4111-8111-111111111111",
    duelId: "PA.SEA01.CH02.BOSTON.MD01#duel@1",
    roundIndex: index,
    itemId: "BOS.ITEM.A.v1",
    path: (fallback ? "FALLBACK" : "MODEL") as "FALLBACK" | "MODEL",
    latencyMs: fallback ? 1250 : 610,
    fallbackReason: fallback ? ("TIMEOUT" as const) : null,
  };
}

test("the CloudWatch alarm still reads the field names this file writes", () => {
  // Four strings are the entire join between the API and the alarm.
  assert.equal(GRADING_METRIC_MARKER, "duel_grading_round");
  for (const required of [
    `const GRADING_LOG_MARKER = "${GRADING_METRIC_MARKER}"`,
    'metricValue: "$.graded"',
    'metricValue: "$.fallback"',
    '"$.paMetric"',
  ]) {
    assert.ok(
      stack.includes(required),
      `infra/lib/project-archive-stack.ts no longer contains ${required}; the ` +
        "grading-fallback metric would be permanently zero, which reads as healthy",
    );
  }
});

test("the alarm exists at all, and is not a colour on a console nobody has open", () => {
  for (const required of [
    "GradingFallbackRateHigh",
    "GradingUnreachable",
    // An alarm with no action was the state of every alarm in this stack.
    "addAlarmAction",
  ]) {
    assert.ok(stack.includes(required), `infra stack is missing ${required}`);
  }
});

test("every round logs, because a fallback count alone cannot become a rate", () => {
  const { lines, logger } = recorder();
  const signal = new GradingSignal({ configured: true, now: () => 1_000 });
  signal.record(logger, round(false, 1));
  signal.record(logger, round(true, 2));

  const metrics = lines.filter((line) => line.fields.paMetric === GRADING_METRIC_MARKER);
  assert.equal(metrics.length, 2, "the graded round must log too, or there is no denominator");
  assert.deepEqual(
    metrics.map((line) => [line.fields.graded, line.fields.fallback]),
    [
      [1, 0],
      [1, 1],
    ],
  );
});

test("no answer text, no verdict and no bullet count reaches the metric line", () => {
  const { lines, logger } = recorder();
  const signal = new GradingSignal({ configured: true, now: () => 1_000 });
  signal.record(logger, round(true, 1));
  const json = JSON.stringify(lines);
  for (const forbidden of ["answer", "bullets", "magazine", "kind"]) {
    assert.ok(!json.includes(forbidden), `the metric line must not carry ${forbidden}`);
  }
});

test("the rate is withheld until the window holds enough rounds to mean anything", () => {
  const { logger } = recorder();
  const signal = new GradingSignal({ configured: true, now: () => 1_000 });
  signal.record(logger, round(true, 1));
  signal.record(logger, round(true, 2));
  // Two ungraded rounds is one student whose laptop lid closed, not an outage.
  const early = signal.snapshot();
  assert.equal(early.ungradedPercent, null);
  assert.equal(early.status, "OK");
  assert.equal(early.ungradedInWindow, 2);
});

test("a fully ungraded window is UNGRADED and a partly ungraded one is DEGRADED", () => {
  const { logger } = recorder();
  process.env.GRADING_FALLBACK_ALERT_PERCENT = "25";

  const dead = new GradingSignal({ configured: true, now: () => 1_000 });
  for (let index = 1; index <= 6; index += 1) dead.record(logger, round(true, index));
  assert.equal(dead.snapshot().ungradedPercent, 100);
  assert.equal(dead.snapshot().status, "UNGRADED");

  const degraded = new GradingSignal({ configured: true, now: () => 1_000 });
  for (let index = 1; index <= 6; index += 1) {
    degraded.record(logger, round(index <= 2, index));
  }
  const snapshot = degraded.snapshot();
  assert.equal(snapshot.ungradedPercent, 33);
  assert.equal(snapshot.status, "DEGRADED");
  assert.deepEqual(snapshot.ungradedByReason, { TIMEOUT: 2 });

  const healthy = new GradingSignal({ configured: true, now: () => 1_000 });
  for (let index = 1; index <= 20; index += 1) healthy.record(logger, round(false, index));
  assert.equal(healthy.snapshot().status, "OK");
  assert.equal(healthy.snapshot().ungradedPercent, 0);
});

test("a missing credential is UNGRADED before a single round is graded", () => {
  // Known at boot and true of every round. Waiting for a window to fill would let
  // the first minutes of a lesson pass with nothing being graded and nothing said.
  const signal = new GradingSignal({ configured: false, now: () => 1_000 });
  const snapshot = signal.snapshot();
  assert.equal(snapshot.status, "UNGRADED");
  assert.equal(snapshot.configured, false);
  assert.equal(snapshot.roundsInWindow, 0);
});

test("the window forgets, so this morning's outage does not condemn this afternoon", () => {
  const { logger } = recorder();
  let now = 1_000;
  const signal = new GradingSignal({ configured: true, now: () => now });
  for (let index = 1; index <= 6; index += 1) signal.record(logger, round(true, index));
  assert.equal(signal.snapshot().status, "UNGRADED");
  now += 6 * 60 * 1000;
  const later = signal.snapshot();
  assert.equal(later.roundsInWindow, 0);
  assert.equal(later.status, "OK");
  // Since-boot totals persist, because "it happened at all" is a separate question.
  assert.equal(later.ungradedSinceBoot, 6);
  assert.equal(later.roundsSinceBoot, 6);
  assert.ok(later.lastUngradedAt !== null);
});

test("the escalation is loud once a minute rather than a hundred times", () => {
  const { lines, logger } = recorder();
  process.env.GRADING_FALLBACK_ALERT_PERCENT = "25";
  let now = 1_000;
  const signal = new GradingSignal({ configured: true, now: () => now });
  for (let index = 1; index <= 30; index += 1) {
    now += 1_000;
    signal.record(logger, round(true, index));
  }
  const escalations = lines.filter((line) => line.level === "error");
  // 30 rounds across 30 seconds, all ungraded: one escalation, not thirty.
  assert.equal(escalations.length, 1);
  now += 61 * 1000;
  signal.record(logger, round(true, 31));
  assert.equal(lines.filter((line) => line.level === "error").length, 2);
});

test("a threshold of zero silences the escalation and never the counting", () => {
  const { lines, logger } = recorder();
  const saved = process.env.GRADING_FALLBACK_ALERT_PERCENT;
  try {
    process.env.GRADING_FALLBACK_ALERT_PERCENT = "0";
    const signal = new GradingSignal({ configured: true, now: () => 1_000 });
    for (let index = 1; index <= 6; index += 1) signal.record(logger, round(true, index));
    assert.equal(lines.filter((line) => line.level === "error").length, 0);
    const snapshot = signal.snapshot();
    // Still counted, still reported, still UNGRADED. Silence is only about the log.
    assert.equal(snapshot.ungradedPercent, 100);
    assert.equal(snapshot.status, "UNGRADED");
    assert.equal(snapshot.ungradedInWindow, 6);
  } finally {
    if (saved === undefined) delete process.env.GRADING_FALLBACK_ALERT_PERCENT;
    else process.env.GRADING_FALLBACK_ALERT_PERCENT = saved;
  }
});

test("an out-of-range threshold falls back to the default rather than to zero", () => {
  const saved = process.env.GRADING_FALLBACK_ALERT_PERCENT;
  try {
    for (const value of ["-5", "1000", "not a number", ""]) {
      process.env.GRADING_FALLBACK_ALERT_PERCENT = value;
      assert.equal(
        new GradingSignal({ configured: true }).snapshot().alertPercent,
        25,
        `${value} must not disable the alert`,
      );
    }
  } finally {
    if (saved === undefined) delete process.env.GRADING_FALLBACK_ALERT_PERCENT;
    else process.env.GRADING_FALLBACK_ALERT_PERCENT = saved;
  }
});
