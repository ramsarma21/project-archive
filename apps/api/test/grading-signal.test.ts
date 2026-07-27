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
    fallbackDiagnosis: fallback ? ("DEADLINE_EXCEEDED" as const) : null,
  };
}

/** An empty answer, decided with no model call. Never evidence about grading. */
function preCheckRound(index: number) {
  return {
    profileId: "11111111-1111-4111-8111-111111111111",
    duelId: "PA.SEA01.CH02.BOSTON.MD01#duel@1",
    roundIndex: index,
    itemId: "BOS.ITEM.A.v1",
    path: "PRE_CHECK" as const,
    latencyMs: 0,
    fallbackReason: null,
    fallbackDiagnosis: null,
  };
}

/** A gateway with no route to it: the measured shape of the original defect. */
function unreachableRound(index: number) {
  return {
    profileId: "11111111-1111-4111-8111-111111111111",
    duelId: "PA.SEA01.CH02.BOSTON.MD01#duel@1",
    roundIndex: index,
    itemId: "BOS.ITEM.A.v1",
    path: "FALLBACK" as const,
    latencyMs: 3,
    fallbackReason: "PROVIDER_ERROR" as const,
    fallbackDiagnosis: "PROVIDER_UNREACHABLE" as const,
  };
}

const quiet = { announceToConsole: false } as const;

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
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
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
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  signal.record(logger, round(true, 1));
  const json = JSON.stringify(lines);
  for (const forbidden of ["answer", "bullets", "magazine", "kind"]) {
    assert.ok(!json.includes(forbidden), `the metric line must not carry ${forbidden}`);
  }
});

test("the rate is withheld until the window holds enough rounds to mean anything", () => {
  const { logger } = recorder();
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
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

  const dead = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  for (let index = 1; index <= 6; index += 1) dead.record(logger, round(true, index));
  assert.equal(dead.snapshot().ungradedPercent, 100);
  assert.equal(dead.snapshot().status, "UNGRADED");

  const degraded = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  for (let index = 1; index <= 6; index += 1) {
    degraded.record(logger, round(index <= 2, index));
  }
  const snapshot = degraded.snapshot();
  assert.equal(snapshot.ungradedPercent, 33);
  assert.equal(snapshot.status, "DEGRADED");
  assert.deepEqual(snapshot.ungradedByReason, { TIMEOUT: 2 });

  const healthy = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  for (let index = 1; index <= 20; index += 1) healthy.record(logger, round(false, index));
  assert.equal(healthy.snapshot().status, "OK");
  assert.equal(healthy.snapshot().ungradedPercent, 0);
});

test("a missing credential is UNGRADED before a single round is graded", () => {
  // Known at boot and true of every round. Waiting for a window to fill would let
  // the first minutes of a lesson pass with nothing being graded and nothing said.
  const signal = new GradingSignal({ ...quiet, configured: false, now: () => 1_000 });
  const snapshot = signal.snapshot();
  assert.equal(snapshot.status, "UNGRADED");
  assert.equal(snapshot.configured, false);
  assert.equal(snapshot.roundsInWindow, 0);
  // And it says what to do about it, in the same response as the word UNGRADED.
  assert.match(String(snapshot.advice), /TRUEFOUNDRY_GRADING_API_KEY/);
});

test("a pre-check is not evidence that grading works", () => {
  // THE MEASURED DEFECT. Seven rounds against a gateway with no route to it, one
  // of them an empty answer: six granted without grading, ZERO classifications,
  // and the endpoint said DEGRADED because 6/7 is 86% and UNGRADED was the
  // reading at 100%. DEGRADED means "some rounds are falling through". The truth
  // was "nothing is being graded and every student has a full magazine".
  const { logger } = recorder();
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  for (let index = 1; index <= 4; index += 1) {
    signal.record(logger, unreachableRound(index));
  }
  signal.record(logger, preCheckRound(5));
  for (let index = 6; index <= 7; index += 1) {
    signal.record(logger, unreachableRound(index));
  }

  const snapshot = signal.snapshot();
  assert.equal(snapshot.roundsInWindow, 7, "every round still logs, for the metric");
  assert.equal(snapshot.gradeableInWindow, 6, "the empty box needed no classifier");
  assert.equal(snapshot.classifiedInWindow, 0, "not one answer was read");
  assert.equal(snapshot.ungradedPercent, 100);
  assert.equal(snapshot.status, "UNGRADED");
  assert.deepEqual(snapshot.ungradedByDiagnosis, { PROVIDER_UNREACHABLE: 6 });
  assert.match(String(snapshot.advice), /could not be reached/);
});

test("a pre-check contributes 0 to the metric denominator, not 1", () => {
  // The field CloudWatch sums for its denominator. If a pre-check emitted 1 here
  // the alarm would count a round no classifier ever saw, and its rate would be
  // lower than the one /v1/health reports for the same events.
  const { lines, logger } = recorder();
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  signal.record(logger, preCheckRound(1));
  signal.record(logger, round(true, 2));
  const metrics = lines.filter((line) => line.fields.paMetric === GRADING_METRIC_MARKER);
  assert.equal(metrics.length, 2, "a pre-check still logs, for the record");
  assert.deepEqual(
    metrics.map((line) => [line.fields.graded, line.fields.fallback]),
    [
      [0, 0],
      [1, 1],
    ],
    "the pre-check is graded=0 (out of the denominator), the fallback graded=1",
  );
});

test("/v1/health and the CloudWatch alarm compute one rate from one denominator", () => {
  // THE MEASURED DISAGREEMENT. A seven-round duel against an unreachable gateway
  // — six real answers granted without grading, one empty box — reads 100%
  // ungraded on /v1/health (6 ungraded of 6 gradeable) but read 86% on the alarm
  // (6 of 7 ROUNDS), because the alarm's denominator counted the pre-check the
  // endpoint's did not. Two readers of the identical event, two verdicts on
  // whether grading is down. They must divide by the same number.
  const { lines, logger } = recorder();
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  for (let index = 1; index <= 4; index += 1) signal.record(logger, unreachableRound(index));
  signal.record(logger, preCheckRound(5));
  for (let index = 6; index <= 7; index += 1) signal.record(logger, unreachableRound(index));

  // The alarm's arithmetic, replayed on the very lines the API emitted:
  // `IF(rounds >= 5, 100 * fallbacks / rounds, 0)` with rounds = Sum($.graded)
  // and fallbacks = Sum($.fallback). See infra/lib/project-archive-stack.ts.
  const metrics = lines.filter((line) => line.fields.paMetric === GRADING_METRIC_MARKER);
  const rounds = metrics.reduce((sum, line) => sum + Number(line.fields.graded), 0);
  const fallbacks = metrics.reduce((sum, line) => sum + Number(line.fields.fallback), 0);
  const cloudwatchPercent = rounds >= 5 ? Math.round((100 * fallbacks) / rounds) : 0;

  const health = signal.snapshot();
  assert.equal(health.gradeableInWindow, 6, "the empty box is not gradeable");
  assert.equal(rounds, 6, "and so is not in the alarm's denominator either");
  assert.equal(health.ungradedPercent, 100);
  assert.equal(
    cloudwatchPercent,
    health.ungradedPercent,
    "the alarm and the endpoint must read the same rate off the same rounds",
  );
});

test("a connectivity fault does not wait for a rate before saying UNGRADED", () => {
  // MEASURED. A four-round duel against a gateway with no route to it — three
  // real answers and an empty box — reported OK, because three ungraded rounds is
  // under the minimum sample a percentage needs. But an unreachable gateway
  // refuses the fourth round exactly as it refused the first; one is as
  // conclusive as a hundred, and the whole point of this file is that the
  // condition is never invisible.
  const { logger } = recorder();
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  signal.record(logger, unreachableRound(1));
  const first = signal.snapshot();
  assert.equal(first.status, "UNGRADED", "on the very first round");
  assert.equal(first.ungradedPercent, null, "and without inventing a rate");
  assert.match(String(first.advice), /could not be reached/);
});

test("a slow model call is still a rate question and not an outage", () => {
  // The counterpart, and the reason the clause above is written on the DIAGNOSIS
  // rather than on the count. One round that overran the budget is a slow model
  // or a closed laptop lid. It must not read as an outage.
  const { logger } = recorder();
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  signal.record(logger, round(true, 1));
  signal.record(logger, round(true, 2));
  assert.equal(signal.snapshot().status, "OK");
});

test("nothing classified is UNGRADED even when the rate is not yet 100%", () => {
  // Belt and braces on the same defect: any mix of pre-checks and fallbacks that
  // holds the rate under 100 must still not read as DEGRADED while the
  // classifier has decided nothing.
  const { logger } = recorder();
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  for (let index = 1; index <= 5; index += 1) {
    signal.record(logger, unreachableRound(index));
  }
  for (let index = 6; index <= 9; index += 1) signal.record(logger, preCheckRound(index));
  const snapshot = signal.snapshot();
  assert.equal(snapshot.classifiedInWindow, 0);
  assert.equal(snapshot.status, "UNGRADED");
});

test("the console announcement fires on the FIRST ungraded round, once per cause", () => {
  // Every other signal in this file goes through the Fastify logger, which
  // `app.ts` disables outside production. On a laptop this is the only one that
  // speaks, so it must not wait for a window to fill the way the escalation does.
  const { logger } = recorder();
  const said: string[] = [];
  const realError = console.error;
  console.error = (line: unknown) => said.push(String(line));
  try {
    const signal = new GradingSignal({
      announceToConsole: true,
      configured: true,
      now: () => 1_000,
    });
    signal.record(logger, unreachableRound(1));
    assert.equal(said.length, 1, "said on round one, not on round five");
    assert.match(said[0]!, /NOT GRADING/);
    assert.match(said[0]!, /PROVIDER_UNREACHABLE/);
    signal.record(logger, unreachableRound(2));
    signal.record(logger, unreachableRound(3));
    assert.equal(said.length, 1, "the same cause is said once, not once a round");
    // A different cause is a different thing to fix, so it gets its own line.
    signal.record(logger, round(true, 4));
    assert.equal(said.length, 2);
    assert.match(said[1]!, /DEADLINE_EXCEEDED/);
  } finally {
    console.error = realError;
  }
});

test("a graded round says nothing on the console", () => {
  const { logger } = recorder();
  const said: string[] = [];
  const realError = console.error;
  console.error = (line: unknown) => said.push(String(line));
  try {
    const signal = new GradingSignal({
      announceToConsole: true,
      configured: true,
      now: () => 1_000,
    });
    for (let index = 1; index <= 6; index += 1) signal.record(logger, round(false, index));
    assert.deepEqual(said, [], "a working grader is silent");
    assert.equal(signal.snapshot().status, "OK");
    assert.equal(signal.snapshot().advice, null);
  } finally {
    console.error = realError;
  }
});

test("the per-round metric line carries the diagnosis and the status", () => {
  const { lines, logger } = recorder();
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
  signal.record(logger, {
    ...unreachableRound(1),
    fallbackDiagnosis: "PROVIDER_REJECTED",
    fallbackStatus: 403,
  });
  const metric = lines.find((line) => line.fields.paMetric === GRADING_METRIC_MARKER);
  // A 403 and a 1250ms overrun were the same log line before this. The status is
  // the difference between "the model name is wrong" and "the model is slow".
  assert.equal(metric?.fields.diagnosis, "PROVIDER_REJECTED");
  assert.equal(metric?.fields.status, 403);
});

test("the window forgets, so this morning's outage does not condemn this afternoon", () => {
  const { logger } = recorder();
  let now = 1_000;
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => now });
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
  const signal = new GradingSignal({ ...quiet, configured: true, now: () => now });
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
    const signal = new GradingSignal({ ...quiet, configured: true, now: () => 1_000 });
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
        new GradingSignal({ ...quiet, configured: true }).snapshot().alertPercent,
        25,
        `${value} must not disable the alert`,
      );
    }
  } finally {
    if (saved === undefined) delete process.env.GRADING_FALLBACK_ALERT_PERCENT;
    else process.env.GRADING_FALLBACK_ALERT_PERCENT = saved;
  }
});
