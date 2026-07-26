import { test } from "node:test";
import assert from "node:assert/strict";
import { duelSurfaceMode } from "../src/mission/duelPort.js";
import { deriveMissionResult } from "../src/mission/result.js";
import type { MissionTraversalObservation } from "../src/mission/result.js";
import { openAttempt, type MissionAttemptTicket } from "../src/mission/attempt.js";
import {
  TEST_BASE_XP,
  TEST_CHAPTER,
  TEST_MISSION,
  testCompletion,
  testDuelReport,
} from "./missionHarness.js";
import { newMissionTally } from "../src/module/moduleGate.js";

// Pacing evidence. None of this gates anything — the point is that the chapter is
// costed at fourteen missions of roughly five minutes and the only figure anyone
// has is an estimate, so every attempt has to report what it actually took beside
// what it was authored against. A claim nobody measures is a claim that breaks
// quietly.

const MODULE_AT = "2026-07-25T12:00:00.000Z";

function ticketFor(attemptOrdinal: number): MissionAttemptTicket {
  const ticket = openAttempt({
    decision: {
      kind: "ENTER_MISSION",
      missionId: TEST_MISSION,
      attemptOrdinal,
      completion: testCompletion(attemptOrdinal),
    },
    chapterId: TEST_CHAPTER,
    grant: { kind: "UNRANKED_PRACTICE", attemptId: "attempt-1" },
    at: "2026-07-25T12:05:00.000Z",
    profileSeedHex: null,
  });
  if (!ticket) throw new Error("the fixture gate refused a legitimate attempt");
  return ticket;
}

function observation(
  overrides: Partial<MissionTraversalObservation> = {},
): MissionTraversalObservation {
  return {
    simulatedS: 152,
    droppedSteps: 0,
    objectiveIds: ["reach-post"],
    detections: 0,
    throwsStruckBody: 0,
    ...overrides,
  };
}

test("a cleared attempt reports every leg against the authored budget", () => {
  const result = deriveMissionResult({
    ticket: ticketFor(1),
    baseXp: TEST_BASE_XP,
    tallyBefore: newMissionTally(TEST_MISSION),
    traversal: { kind: "REACHED_DUEL", ...observation() },
    observation: null,
    duel: testDuelReport(true),
    abandoned: null,
    traversalBudgetS: 180,
    clock: {
      traversalStartedAt: "2026-07-25T12:05:10.000Z",
      duelStartedAt: "2026-07-25T12:07:45.000Z",
    },
    at: "2026-07-25T12:11:25.000Z",
  });

  const timing = result.timing;
  assert.equal(timing.traversalBudgetS, 180);
  assert.equal(timing.traversalSimulatedS, 152);
  assert.equal(timing.traversalOverBudgetS, -28, "the run came in under budget");
  assert.equal(timing.traversalWallS, 375, "12:05:10 to 12:11:25");
  assert.equal(timing.moduleObservedS, testCompletion(1).observedSeconds);
  assert.equal(timing.duelEngagementS, 120, "the design's fight clock");
  assert.equal(timing.duelWallS, 220, "and the duel's real wall clock, with pauses");
  assert.equal(timing.attemptWallS, 385, "module clear through result");
  assert.equal(timing.isCompleteAttempt, true);
});

test("running past the pacing budget is reported and costs nothing", () => {
  const result = deriveMissionResult({
    ticket: ticketFor(1),
    baseXp: TEST_BASE_XP,
    tallyBefore: newMissionTally(TEST_MISSION),
    // Eight minutes on a route costed at three: exactly the case that would break
    // the twenty-to-thirty-hour claim without anyone noticing.
    traversal: { kind: "REACHED_DUEL", ...observation({ simulatedS: 480 }) },
    observation: null,
    duel: testDuelReport(true),
    abandoned: null,
    traversalBudgetS: 180,
    clock: { traversalStartedAt: null, duelStartedAt: null },
    at: MODULE_AT,
  });

  assert.equal(result.timing.traversalOverBudgetS, 300);
  assert.equal(result.outcome, "CLEARED", "the clock is not a fail condition");
  assert.equal(result.awardedXp, TEST_BASE_XP, "and it does not touch the award");
});

test("dropped simulation steps are surfaced, because they invalidate the figure", () => {
  const result = deriveMissionResult({
    ticket: ticketFor(1),
    baseXp: TEST_BASE_XP,
    tallyBefore: newMissionTally(TEST_MISSION),
    traversal: { kind: "REACHED_DUEL", ...observation({ droppedSteps: 412 }) },
    observation: null,
    duel: testDuelReport(true),
    abandoned: null,
    traversalBudgetS: 180,
    clock: {
      traversalStartedAt: "2026-07-25T12:05:00.000Z",
      duelStartedAt: null,
    },
    at: "2026-07-25T12:09:00.000Z",
  });

  assert.equal(result.timing.droppedSteps, 412);
  assert.ok(
    result.timing.traversalWallS > result.timing.traversalSimulatedS,
    "a school Chromebook that drops steps makes the simulated figure an undercount",
  );
});

test("a quit attempt still reports its seconds", () => {
  const result = deriveMissionResult({
    ticket: ticketFor(2),
    baseXp: TEST_BASE_XP,
    tallyBefore: { missionId: TEST_MISSION, attemptsUsed: 1, outcome: "IN_PROGRESS" },
    traversal: null,
    observation: observation({ simulatedS: 64, objectiveIds: [], detections: 2 }),
    duel: null,
    abandoned: { reason: "left during traversal" },
    traversalBudgetS: 180,
    clock: { traversalStartedAt: "2026-07-25T12:05:00.000Z", duelStartedAt: null },
    at: "2026-07-25T12:06:20.000Z",
  });

  assert.equal(result.outcome, "FAILED");
  assert.equal(result.timing.traversalSimulatedS, 64);
  assert.equal(result.timing.traversalWallS, 80);
  assert.equal(result.achievement.detections, 2, "and what it observed on the way");
  assert.equal(
    result.timing.isCompleteAttempt,
    false,
    "so an average over attempts can filter it out",
  );
});

test("a failed run is marked incomplete, because its seconds are not the route's", () => {
  const result = deriveMissionResult({
    ticket: ticketFor(1),
    baseXp: TEST_BASE_XP,
    tallyBefore: newMissionTally(TEST_MISSION),
    traversal: {
      kind: "FAILED",
      failure: {
        code: "DETECTED",
        cueId: "BOS.MD01.CUE.FAIL_DETECTED.v1",
        headline: "The constable has closed the route to the post.",
        detail: "Confrontation filled the final court.",
      },
      ...observation({ simulatedS: 88, objectiveIds: [] }),
    },
    observation: null,
    duel: null,
    abandoned: null,
    traversalBudgetS: 180,
    clock: { traversalStartedAt: null, duelStartedAt: null },
    at: MODULE_AT,
  });

  assert.equal(result.timing.traversalSimulatedS, 88);
  assert.equal(result.timing.isCompleteAttempt, false);
  assert.equal(result.timing.duelWallS, 0, "a duel that never happened took no time");
});

test("throws that struck a body are reported as achievement, not as failure", () => {
  const result = deriveMissionResult({
    ticket: ticketFor(1),
    baseXp: TEST_BASE_XP,
    tallyBefore: newMissionTally(TEST_MISSION),
    traversal: { kind: "REACHED_DUEL", ...observation({ throwsStruckBody: 2 }) },
    observation: null,
    duel: testDuelReport(true),
    abandoned: null,
    traversalBudgetS: 180,
    clock: { traversalStartedAt: null, duelStartedAt: null },
    at: MODULE_AT,
  });

  assert.equal(result.achievement.throwsStruckBody, 2);
  assert.equal(result.outcome, "CLEARED", "a wasted throw is a lesson, not a loss");
});

// ---- the dev harness ------------------------------------------------------

test("a registered duel view makes the dev win path unreachable", () => {
  // The audit that matters is not "did anyone remember to delete the flag" but
  // "is a duel view registered", which is a property of the build. With one
  // registered there is no combination of flags that reaches the harness.
  for (const isDevBuild of [true, false]) {
    for (const harnessRequested of [true, false]) {
      assert.equal(
        duelSurfaceMode({ hasView: true, isDevBuild, harnessRequested }),
        "VIEW",
        `dev=${isDevBuild} flag=${harnessRequested}`,
      );
    }
  }
});

test("without a view, the harness needs both a dev build and the explicit flag", () => {
  assert.equal(
    duelSurfaceMode({ hasView: false, isDevBuild: false, harnessRequested: true }),
    "PENDING",
    "a production build never offers it, flag or no flag",
  );
  assert.equal(
    duelSurfaceMode({ hasView: false, isDevBuild: true, harnessRequested: false }),
    "PENDING",
  );
  assert.equal(
    duelSurfaceMode({ hasView: false, isDevBuild: true, harnessRequested: true }),
    "PENDING_WITH_DEV_WIN",
  );
});
