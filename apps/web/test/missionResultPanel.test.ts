import test from "node:test";
import assert from "node:assert/strict";
import module from "node:module";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import type { MissionResult } from "../src/mission/result.js";
import type { MissionDuelRoundReport } from "../src/mission/duelPort.js";

// react-test-renderer's `act` expects this flag; without it React logs an act-environment
// error that a strict runner can treat as a failure. Set before any render.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The panel imports its stylesheet (`missionResult.css`) so Vite bundles it. The
// `node --test` runner has no CSS loader (see pvpEntry.test.ts), so stub any
// `.css` module to an empty export before importing the component under test.
const cssStub = {
  load(url: string, context: unknown, nextLoad: (u: string, c: unknown) => unknown) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
};
const hooks = module as unknown as {
  registerHooks?: (h: typeof cssStub) => void;
  register: (specifier: string) => void;
};
if (typeof hooks.registerHooks === "function") {
  hooks.registerHooks(cssStub);
} else {
  hooks.register(
    "data:text/javascript," +
      encodeURIComponent(
        "export async function load(url, context, nextLoad) {" +
          "  if (url.endsWith('.css')) {" +
          "    return { format: 'module', source: 'export default {};', shortCircuit: true };" +
          "  }" +
          "  return nextLoad(url, context);" +
          "}",
      ),
  );
}

const { MissionResultPanel, classifyMissionFailure, humanizeMissionId } = await import(
  "../src/mission/MissionResultPanel.js"
);

// ---------------------------------------------------------------------------
// The result screen's job is to explain a failure truthfully: what happened,
// what to change, and what it cost — from the run's own figures and nothing
// else. These render the real panel and assert the copy a player reads, plus
// the absence of the two things this surface must never say — a direct retry
// and a payout on a failed attempt.
// ---------------------------------------------------------------------------

function rounds(pattern: readonly ("CORRECT" | "WRONG")[]): MissionDuelRoundReport[] {
  return pattern.map((verdict, index) => ({
    round: index + 1,
    itemId: `item.${index + 1}`,
    conceptId: `concept-${index + 1}`,
    verdict,
    bullets: verdict === "CORRECT" ? 14 : 7,
  }));
}

interface Scenario {
  outcome?: "CLEARED" | "FAILED";
  headline?: string;
  detail?: string;
  attemptOrdinal?: number;
  traversalCompleted?: boolean;
  duelReached?: boolean;
  duelWon?: boolean;
  detections?: number;
  throwsStruckBody?: number;
  objectiveIds?: readonly string[];
  roundVerdicts?: readonly ("CORRECT" | "WRONG")[];
  droppedSteps?: number;
  awardedXp?: number;
  attemptsRemaining?: number;
  missionSpentAfter?: boolean;
  advancesToNextMission?: boolean;
}

function makeResult(scenario: Scenario): MissionResult {
  const outcome = scenario.outcome ?? "FAILED";
  const roundReports = rounds(scenario.roundVerdicts ?? []);
  return {
    missionId: "M1",
    chapterId: "C1",
    attemptId: "att-1",
    attemptOrdinal: scenario.attemptOrdinal ?? 1,
    outcome,
    headline: scenario.headline ?? "The attempt is over.",
    detail: scenario.detail ?? "The operation did not resolve in your favour.",
    achievement: {
      traversalCompleted: scenario.traversalCompleted ?? false,
      objectiveIds: scenario.objectiveIds ?? [],
      detections: scenario.detections ?? 0,
      throwsStruckBody: scenario.throwsStruckBody ?? 0,
      duelReached: scenario.duelReached ?? scenario.traversalCompleted ?? false,
      duelWon: scenario.duelWon ?? false,
    },
    knowledge: {
      rounds: roundReports,
      correct: roundReports.filter((round) => round.verdict === "CORRECT").length,
      asked: roundReports.length,
      conceptIds: roundReports.map((round) => round.conceptId),
    },
    timing: {
      traversalBudgetS: 145,
      traversalSimulatedS: scenario.traversalCompleted ? 132 : 40,
      traversalWallS: 140,
      traversalOverBudgetS: scenario.traversalCompleted ? -13 : -105,
      droppedSteps: scenario.droppedSteps ?? 0,
      moduleObservedS: 60,
      duelEngagementS: scenario.duelReached ? 48 : 0,
      duelWallS: scenario.duelReached ? 90 : 0,
      attemptWallS: 210,
      isCompleteAttempt: (scenario.traversalCompleted ?? false) && roundReports.length > 0,
    },
    baseXp: 300,
    xpFraction: { numerator: 1, denominator: 1 },
    awardedXp: scenario.awardedXp ?? (outcome === "CLEARED" ? 300 : 0),
    tally: { missionId: "M1", attemptsUsed: 1, outcome: "IN_PROGRESS" },
    attemptsUsedAfter: 1,
    attemptsRemaining: scenario.attemptsRemaining ?? 2,
    outcomeAfter:
      outcome === "CLEARED"
        ? "CLEARED"
        : scenario.missionSpentAfter
          ? "FAILED_PERMANENT"
          : "IN_PROGRESS",
    missionSpentAfter: scenario.missionSpentAfter ?? false,
    advancesToNextMission:
      scenario.advancesToNextMission ?? (outcome === "CLEARED" || (scenario.missionSpentAfter ?? false)),
    resolvedAt: "2026-07-27T00:00:00.000Z",
    commit: {
      missionId: "M1",
      chapterId: "C1",
      attemptOrdinal: scenario.attemptOrdinal ?? 1,
      outcome,
      baseXp: 300,
      at: "2026-07-27T00:00:00.000Z",
    },
    committedEvents: [],
  };
}

function render(scenario: Scenario): string {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(MissionResultPanel, {
        title: "The Nailed Notice",
        result: makeResult(scenario),
        onReturn: () => {},
      }),
    );
  });
  const json = JSON.stringify(renderer.toJSON());
  act(() => renderer.unmount());
  return json;
}

// The two invariants that hold on every failed attempt, checked everywhere.
function assertNoMisleadingClaims(json: string): void {
  assert.ok(!/retry/i.test(json), "the panel must never offer a direct retry");
  assert.ok(!/play again/i.test(json), "the panel must never offer a replay");
  assert.ok(json.includes("Return to the Archive"), "the one CTA returns to the Archive");
}

// ---- unit: id humanising ---------------------------------------------------

test("an authored id is humanised, and a real sentence is left alone", () => {
  assert.equal(humanizeMissionId("reach-the-post"), "Reach The Post");
  assert.equal(humanizeMissionId("duel.boss"), "Duel Boss");
  assert.equal(humanizeMissionId("nailNotice"), "Nail Notice");
  // Already reads as prose: preserved verbatim, not re-cased.
  assert.equal(humanizeMissionId("Nail the notice to the post"), "Nail the notice to the post");
  assert.equal(humanizeMissionId(""), "");
});

// ---- unit: failure classification -----------------------------------------

test("failure kind is chosen only from figures the run reported", () => {
  assert.equal(
    classifyMissionFailure(makeResult({ traversalCompleted: false, detections: 0 })),
    "TRAVERSAL",
  );
  assert.equal(
    classifyMissionFailure(makeResult({ traversalCompleted: false, detections: 3 })),
    "DETECTION",
  );
  assert.equal(
    classifyMissionFailure(
      makeResult({ traversalCompleted: true, duelReached: true, duelWon: false }),
    ),
    "DUEL",
  );
});

// ---- render: early traversal failure ---------------------------------------

test("an early traversal failure explains the route without blaming a duel", () => {
  const json = render({
    headline: "The constable has closed the route to the post.",
    detail: "You never reached the arena.",
    traversalCompleted: false,
    detections: 0,
  });
  assert.ok(json.includes("Failed"), "the outcome header is unambiguous");
  assert.ok(json.includes("The constable has closed the route to the post."));
  assert.ok(json.includes("Did not reach the arena"), "the summary states the route ended early");
  assert.ok(json.includes("Try next time"), "guidance is offered");
  assert.ok(/did not reach the arena/i.test(json), "guidance is specific to the route");
  // A duel that never armed must not be described as lost.
  assert.ok(!json.includes("ended in the duel"), "no duel cause is invented");
  assert.ok(json.includes("A failed attempt pays no XP"), "the cost is honest");
  assertNoMisleadingClaims(json);
});

// ---- render: duel loss -----------------------------------------------------

test("a duel loss credits the route and points at the fight and the answers", () => {
  const json = render({
    headline: "The duel is lost.",
    detail: "Losing the duel is losing the duel.",
    traversalCompleted: true,
    duelReached: true,
    duelWon: false,
    detections: 0,
    roundVerdicts: ["CORRECT", "WRONG", "WRONG"],
  });
  assert.ok(json.includes("Reached the arena"), "the route is credited");
  assert.ok(json.includes("ended in the duel"), "the failure is placed at the duel");
  // Low knowledge shows up as ammunition advice, never as a second failure axis.
  assert.ok(/loads a bigger magazine/i.test(json), "answers are framed as ammunition");
  assert.ok(json.includes("Duel questions"), "the per-round evidence is shown");
  assert.ok(json.includes("A failed attempt pays no XP"));
  assertNoMisleadingClaims(json);
});

// ---- render: detection-heavy failure ---------------------------------------

test("a detection failure names the watcher and gives stealth guidance", () => {
  const json = render({
    headline: "You were seen.",
    detail: "The watch closed the crossing.",
    traversalCompleted: false,
    detections: 2,
  });
  assert.ok(json.includes("Spotted 2 times"), "the summary reports the sightings");
  assert.ok(/read you 2 times/i.test(json), "guidance is specific to detection");
  assert.ok(/break line of sight/i.test(json));
  assertNoMisleadingClaims(json);
});

// ---- render: exhausted final attempt ---------------------------------------

test("the third and final failure says the mission is spent and advancement still happens", () => {
  const json = render({
    outcome: "FAILED",
    headline: "The attempt is over.",
    detail: "That was the third attempt.",
    attemptOrdinal: 3,
    traversalCompleted: false,
    missionSpentAfter: true,
    advancesToNextMission: true,
    attemptsRemaining: 0,
  });
  assert.ok(json.includes("Spent — closed for good"), "the standing is stated plainly");
  assert.ok(/advance to the next operation regardless/i.test(json), "advancement despite loss");
  assert.ok(json.includes("Unlocked"), "the next mission is shown as reachable");
  // No misleading promise of more tries on the spent mission.
  assert.ok(!/attempts remain/i.test(json), "a spent mission promises no more tries");
  assert.ok(json.includes("A failed attempt pays no XP"));
  assertNoMisleadingClaims(json);
});

// ---- render: frame-stall note ----------------------------------------------

test("dropped steps become a neutral frame-stall note, never player-blaming jargon", () => {
  const json = render({
    traversalCompleted: false,
    detections: 0,
    droppedSteps: 42,
  });
  assert.ok(/frame stalls/i.test(json), "the stall is disclosed in plain language");
  assert.ok(/not you/i.test(json), "the note does not blame the player");
  // The raw internals must not leak as jargon.
  assert.ok(!/dropped steps/i.test(json));
  assert.ok(!/simulation steps/i.test(json));
});

test("a clean run shows no frame-stall note", () => {
  const json = render({ traversalCompleted: false, droppedSteps: 0 });
  assert.ok(!/frame stalls/i.test(json));
});

// ---- render: cleared -------------------------------------------------------

test("a cleared mission reads as a win, pays out, and offers no failure guidance", () => {
  const json = render({
    outcome: "CLEARED",
    headline: "Operation complete.",
    detail: "The route held and the boss went down.",
    traversalCompleted: true,
    duelReached: true,
    duelWon: true,
    detections: 0,
    roundVerdicts: ["CORRECT", "CORRECT", "CORRECT"],
    awardedXp: 300,
    advancesToNextMission: true,
  });
  assert.ok(json.includes("Cleared"), "the outcome header celebrates the clear");
  assert.ok(json.includes("Operation complete."));
  assert.ok(json.includes("Won"), "the duel result is shown");
  assert.ok(json.includes("300"), "the awarded XP is shown");
  assert.ok(json.includes("of 300 for attempt 1"), "the fraction is explained");
  // A clear is not a failure: no failure copy leaks in.
  assert.ok(!json.includes("Try next time"), "no failure guidance on a clear");
  assert.ok(!/pays no XP/i.test(json), "a clear does not deny payment");
  assertNoMisleadingClaims(json);
});
