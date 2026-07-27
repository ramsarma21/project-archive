import { test } from "node:test";
import assert from "node:assert/strict";
import { LEARNING_MODULE_SECONDS, MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import {
  initialMissionSession,
  missionSessionIsForeground,
  reduceMission,
  type MissionCommand,
  type MissionEffect,
  type MissionSession,
  type MissionSessionEnv,
} from "../src/mission/session.js";
import type { AttemptGrant } from "../src/mission/attempt.js";
import type { MissionInstance } from "../src/mission/levelPort.js";
import type { MissionResult } from "../src/mission/result.js";
import type { LearningModuleDefinition } from "../src/module/moduleFormat.js";
import { completeModuleRun } from "../src/module/moduleGate.js";
import {
  TEST_BASE_XP,
  TEST_CHAPTER,
  TEST_MISSION,
  testCompletion,
  testDefinition,
  testDuelReport,
  testEnv,
  testInstance,
} from "./missionHarness.js";

// What this file pins is the loop's rules, not its presentation:
//
//   the module gate cannot be bypassed by a transition;
//   three attempts pay 3/3, 2/3, 1/3 and then the mission is spent forever;
//   a spent mission still advances the player; and
//   every exit path frees the level exactly once.

interface Drive {
  session: MissionSession;
  effects: MissionEffect[];
  results: MissionResult[];
}

function drive(session = initialMissionSession()): Drive {
  return { session, effects: [], results: [] };
}

/** Applies a command, asserting it was legal, and collects the effects. */
function send(
  drive: Drive,
  command: MissionCommand,
  env: MissionSessionEnv = testEnv(),
): Drive {
  const result = reduceMission(drive.session, command, env);
  assert.ok(result.ok, `${command.kind} was refused: ${JSON.stringify(result)}`);
  if (!result.ok) return drive;
  drive.session = result.session;
  drive.effects.push(...result.effects);
  for (const effect of result.effects) {
    if (effect.kind === "COMMIT_RESULT") drive.results.push(effect.result);
  }
  return drive;
}

function refused(
  session: MissionSession,
  command: MissionCommand,
  env: MissionSessionEnv = testEnv(),
): string {
  const result = reduceMission(session, command, env);
  assert.equal(result.ok, false, `${command.kind} was allowed and should not be`);
  return result.ok ? "" : result.rejection.code;
}

/** One whole attempt: deploy, module, load, run, duel, result, return. */
function runAttempt(
  state: Drive,
  input: { ordinal: number; clearTraversal: boolean; winDuel: boolean; env?: MissionSessionEnv },
): Drive {
  const env = input.env ?? testEnv();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  assert.equal(state.session.phase.phase, "MODULE");
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(input.ordinal) }, env);
  assert.equal(state.session.phase.phase, "LOADING");
  send(
    state,
    {
      kind: "INSTANCE_READY",
      instance: testInstance({ attemptOrdinal: input.ordinal }),
    },
    env,
  );
  assert.equal(state.session.phase.phase, "TRAVERSAL");

  if (!input.clearTraversal) {
    send(
      state,
      {
        kind: "TRAVERSAL_RESOLVED",
        outcome: {
          kind: "FAILED",
          failure: {
            code: "DETECTED",
            cueId: null,
            headline: "The constable has closed the route to the post.",
            detail: "Confrontation filled the final court.",
          },
          simulatedS: 96,
          droppedSteps: 0,
          objectiveIds: [],
          detections: 1,
          throwsStruckBody: 0,
        },
      },
      env,
    );
  } else {
    send(
      state,
      {
        kind: "TRAVERSAL_RESOLVED",
        outcome: {
          kind: "REACHED_DUEL",
          simulatedS: 152,
          droppedSteps: 0,
          objectiveIds: ["reach-post"],
          detections: 0,
          throwsStruckBody: 0,
        },
      },
      env,
    );
    assert.equal(state.session.phase.phase, "DUEL");
    send(state, { kind: "DUEL_RESOLVED", report: testDuelReport(input.winDuel) }, env);
  }

  assert.equal(state.session.phase.phase, "RESULT");
  send(state, { kind: "RETURN_TO_HUB" }, env);
  send(state, { kind: "RETURN_SETTLED" }, env);
  return state;
}

// ---- the gate -------------------------------------------------------------

test("an unregistered mission is refused rather than launched empty", () => {
  const state = drive();
  send(
    state,
    { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION },
    testEnv({ definition: undefined }),
  );
  assert.deepEqual(state.session.phase, {
    phase: "BLOCKED",
    missionId: TEST_MISSION,
    reason: "MISSION_NOT_REGISTERED",
  });
});

test("a locked mission and a mission with no module both fail closed", () => {
  const locked = drive();
  send(
    locked,
    { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION },
    testEnv({ unlocked: false }),
  );
  assert.equal(
    locked.session.phase.phase === "BLOCKED" && locked.session.phase.reason,
    "MISSION_LOCKED",
  );

  const unwritten = drive();
  send(
    unwritten,
    { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION },
    testEnv({ module: undefined }),
  );
  assert.equal(
    unwritten.session.phase.phase === "BLOCKED" && unwritten.session.phase.reason,
    "MODULE_MISSING",
  );
});

test("Deploy runs the module first and only then opens the attempt", () => {
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  assert.equal(state.session.phase.phase, "MODULE");
  assert.equal(
    state.session.phase.phase === "MODULE" && state.session.phase.attemptOrdinal,
    1,
  );
  assert.equal(state.effects.length, 0, "nothing is loaded before the deck is read");

  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) });
  assert.equal(state.session.phase.phase, "LOADING");
  const loaded = state.effects.find((effect) => effect.kind === "LOAD_INSTANCE");
  assert.ok(loaded, "completing the module is what asks for the level");
  assert.equal(
    state.session.phase.phase === "LOADING" &&
      state.session.phase.ticket.attemptOrdinal,
    1,
  );
});

test("no transition reaches a mission phase without the gate having run", () => {
  const idle = initialMissionSession();

  // The two commands that would otherwise walk into a mission.
  assert.equal(
    refused(idle, { kind: "BRIEFING_ACKNOWLEDGED" }),
    "COMMAND_NOT_LEGAL_IN_PHASE",
  );
  assert.equal(
    refused(idle, {
      kind: "TRAVERSAL_RESOLVED",
      outcome: {
        kind: "REACHED_DUEL",
        simulatedS: 1,
        droppedSteps: 0,
        objectiveIds: [],
        detections: 0,
        throwsStruckBody: 0,
      },
    }),
    "COMMAND_NOT_LEGAL_IN_PHASE",
  );

  // A level that arrives with nothing waiting for it is disposed of, not entered.
  let freed = 0;
  const orphan = testInstance({ onDispose: () => (freed += 1) });
  const result = reduceMission(idle, { kind: "INSTANCE_READY", instance: orphan }, testEnv());
  assert.ok(result.ok);
  assert.equal(result.ok && result.session.phase.phase, "IDLE");
  assert.deepEqual(
    result.ok && result.effects.map((effect) => effect.kind),
    ["DISPOSE_INSTANCE"],
  );
  assert.equal(freed, 0, "the machine emits the effect; the caller performs it");
});

test("a module completion arms exactly one attempt on exactly one mission", () => {
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  assert.equal(
    refused(state.session, { kind: "MODULE_COMPLETED", completion: testCompletion(2) }),
    "COMPLETION_DOES_NOT_MATCH_BRIEFING",
  );
  assert.equal(
    refused(state.session, {
      kind: "MODULE_COMPLETED",
      completion: testCompletion(1, "m7"),
    }),
    "COMPLETION_DOES_NOT_MATCH_BRIEFING",
  );
});

test("abandoning the module leaves the attempt unopened and the gate shut", () => {
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  send(state, { kind: "ABANDON_MODULE" });
  assert.equal(state.session.phase.phase, "IDLE");

  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  assert.equal(
    state.session.phase.phase === "MODULE" && state.session.phase.attemptOrdinal,
    1,
    "the ordinal did not move, so the module is still attempt one's",
  );
});

test("a retry has to redo the module", () => {
  const state = drive();
  runAttempt(state, { ordinal: 1, clearTraversal: true, winDuel: false });

  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  assert.equal(state.session.phase.phase, "MODULE");
  assert.equal(
    state.session.phase.phase === "MODULE" && state.session.phase.attemptOrdinal,
    2,
    "attempt two finds no completion for attempt two",
  );
});

// ---- XP decay and the three-attempt schedule -------------------------------

test("a first-attempt clear pays the full award", () => {
  const state = drive();
  runAttempt(state, { ordinal: 1, clearTraversal: true, winDuel: true });
  const result = state.results[0];
  assert.ok(result);
  assert.equal(result.outcome, "CLEARED");
  assert.equal(result.awardedXp, TEST_BASE_XP);
  assert.deepEqual(result.xpFraction, { numerator: 3, denominator: 3 });
  assert.equal(result.advancesToNextMission, true);
});

test("the three attempts pay three thirds, two thirds, one third", () => {
  const awards: number[] = [];
  for (const ordinal of [1, 2, 3]) {
    const state = drive();
    for (let earlier = 1; earlier < ordinal; earlier += 1) {
      runAttempt(state, { ordinal: earlier, clearTraversal: true, winDuel: false });
    }
    runAttempt(state, { ordinal, clearTraversal: true, winDuel: true });
    const result = state.results.at(-1);
    assert.ok(result);
    assert.equal(result.attemptOrdinal, ordinal);
    awards.push(result.awardedXp);
  }
  assert.deepEqual(awards, [100, 66, 33]);
  assert.ok(
    awards[1]! < awards[0]! && awards[2]! < awards[1]!,
    "the schedule is strictly decreasing, so a retry is never worth more",
  );
});

test("every failure pays zero, including the one that spends the mission", () => {
  const state = drive();
  for (const ordinal of [1, 2, 3]) {
    runAttempt(state, { ordinal, clearTraversal: false, winDuel: false });
  }
  assert.deepEqual(
    state.results.map((result) => result.awardedXp),
    [0, 0, 0],
  );
  const last = state.results.at(-1);
  assert.ok(last);
  assert.equal(last.outcomeAfter, "FAILED_PERMANENT");
  assert.equal(last.attemptsUsedAfter, MAX_MISSION_ATTEMPTS);
  assert.equal(last.attemptsRemaining, 0);
  assert.equal(last.missionSpentAfter, true);
  assert.equal(
    last.advancesToNextMission,
    true,
    "a permanently failed mission still lets the player move on",
  );
});

test("a spent mission cannot be deployed to again, cleared or failed", () => {
  for (const winDuel of [true, false]) {
    const state = drive();
    const attempts = winDuel ? [1] : [1, 2, 3];
    for (const ordinal of attempts) {
      runAttempt(state, { ordinal, clearTraversal: true, winDuel });
    }
    send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
    assert.equal(
      state.session.phase.phase === "BLOCKED" && state.session.phase.reason,
      "MISSION_SPENT",
      winDuel ? "a clear pays once" : "three failures is the end of it",
    );
  }
});

test("reaching the arena is not clearing the mission", () => {
  const state = drive();
  runAttempt(state, { ordinal: 1, clearTraversal: true, winDuel: false });
  const result = state.results[0];
  assert.ok(result);
  assert.equal(result.achievement.traversalCompleted, true);
  assert.equal(result.achievement.duelReached, true);
  assert.equal(result.achievement.duelWon, false);
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.awardedXp, 0);
});

test("the duel's verdicts are reported and pay nothing of their own", () => {
  const state = drive();
  runAttempt(state, { ordinal: 1, clearTraversal: true, winDuel: true });
  const result = state.results[0];
  assert.ok(result);
  assert.equal(result.knowledge.asked, 2);
  assert.equal(result.knowledge.correct, 1);
  assert.equal(
    result.awardedXp,
    TEST_BASE_XP,
    "a missed question costs bullets in the fight, never XP at the end of it",
  );
});

// ---- abandoning, failing to load, and teardown ----------------------------

test("walking out of a live run spends the attempt", () => {
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) });
  send(state, { kind: "INSTANCE_READY", instance: testInstance() });
  send(state, { kind: "ABANDON_ATTEMPT", reason: "left during traversal" });

  const result = state.results[0];
  assert.ok(result);
  assert.equal(result.outcome, "FAILED");
  assert.equal(result.awardedXp, 0);
  assert.equal(result.attemptsUsedAfter, 1);
});

test("a level that fails to assemble does not spend the attempt", () => {
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) });
  send(state, { kind: "INSTANCE_FAILED", detail: "asset 404" });
  assert.equal(
    state.session.phase.phase === "BLOCKED" && state.session.phase.reason,
    "INSTANCE_UNAVAILABLE",
  );
  assert.equal(state.results.length, 0);

  // The completion still gates attempt one, so Deploy re-enters it rather than
  // making the player read the deck again for a failure that was not theirs.
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  assert.equal(state.session.phase.phase, "LOADING");
});

test("cancelling a load spends nothing", () => {
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) });
  send(state, { kind: "ABANDON_ATTEMPT", reason: "left the hub" });
  assert.equal(state.session.phase.phase, "IDLE");
  assert.equal(state.results.length, 0);
});

test("every exit path frees the level exactly once", () => {
  function disposals(exit: (state: Drive, instance: MissionInstance) => void): number {
    const state = drive();
    const instance = testInstance();
    send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
    send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) });
    send(state, { kind: "INSTANCE_READY", instance });
    exit(state, instance);
    return state.effects.filter(
      (effect) => effect.kind === "DISPOSE_INSTANCE" && effect.instance === instance,
    ).length;
  }

  assert.equal(
    disposals((state) => {
      send(state, {
        kind: "TRAVERSAL_RESOLVED",
        outcome: {
          kind: "REACHED_DUEL",
          simulatedS: 150,
          droppedSteps: 0,
          objectiveIds: [],
          detections: 0,
          throwsStruckBody: 0,
        },
      });
      send(state, { kind: "DUEL_RESOLVED", report: testDuelReport(true) });
      send(state, { kind: "RETURN_TO_HUB" });
    }),
    1,
    "a clean clear",
  );

  assert.equal(
    disposals((state) => {
      send(state, { kind: "ABANDON_ATTEMPT", reason: "quit" });
      send(state, { kind: "RETURN_TO_HUB" });
    }),
    1,
    "an abandoned run",
  );

  assert.equal(
    disposals((state) => {
      send(state, {
        kind: "TRAVERSAL_RESOLVED",
        outcome: {
          kind: "FAILED",
          failure: { code: "X", cueId: null, headline: "h", detail: "d" },
          simulatedS: 12,
          droppedSteps: 0,
          objectiveIds: [],
          detections: 1,
          throwsStruckBody: 0,
        },
      });
      send(state, { kind: "RETURN_TO_HUB" });
    }),
    1,
    "a failed floor",
  );
});

test("a briefing is skipped when the level has none", () => {
  const withBriefing = drive();
  send(withBriefing, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  send(withBriefing, { kind: "MODULE_COMPLETED", completion: testCompletion(1) });
  send(withBriefing, {
    kind: "INSTANCE_READY",
    instance: testInstance({
      briefing: {
        cueId: "CUE.INSERT",
        headline: "Carry it to the post.",
        lines: ["Before the constable replaces the board."],
        targetSeconds: 10,
      },
    }),
  });
  assert.equal(withBriefing.session.phase.phase, "BRIEFING");
  send(withBriefing, { kind: "BRIEFING_ACKNOWLEDGED" });
  assert.equal(withBriefing.session.phase.phase, "TRAVERSAL");

  const without = drive();
  send(without, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  send(without, { kind: "MODULE_COMPLETED", completion: testCompletion(1) });
  send(without, { kind: "INSTANCE_READY", instance: testInstance() });
  assert.equal(without.session.phase.phase, "TRAVERSAL");
});

test("a defective instance is refused before the player is put inside it", () => {
  function refusedInstance(instance: MissionInstance): Drive {
    const state = drive();
    send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
    send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) });
    send(state, { kind: "INSTANCE_READY", instance });
    assert.equal(
      state.session.phase.phase === "BLOCKED" && state.session.phase.reason,
      "INSTANCE_UNAVAILABLE",
    );
    assert.equal(
      state.effects.filter((effect) => effect.kind === "DISPOSE_INSTANCE").length,
      1,
      "and it is freed on the way out",
    );
    return state;
  }

  refusedInstance(testInstance({ attemptOrdinal: 3 }));
  // The load-bearing one: with no required objective, "every required objective
  // is met" would be vacuously true and the floor would clear on its first tick.
  refusedInstance(testInstance({ objectives: [] }));
  assert.equal(refusedInstance(testInstance({ objectives: [] })).results.length, 0);
});

test("the hub knows when the container owns the screen", () => {
  const state = drive();
  assert.equal(missionSessionIsForeground(state.session), false);
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION });
  assert.equal(missionSessionIsForeground(state.session), true, "the module is foreground");
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) });
  assert.equal(missionSessionIsForeground(state.session), true);
  send(state, { kind: "INSTANCE_READY", instance: testInstance() });
  assert.equal(missionSessionIsForeground(state.session), true);
  send(state, { kind: "ABANDON_ATTEMPT", reason: "quit" });
  send(state, { kind: "RETURN_TO_HUB" });
  send(state, { kind: "RETURN_SETTLED" });
  assert.equal(missionSessionIsForeground(state.session), false, "back at the hub");
});

test("base XP comes from the registered mission, not from the run", () => {
  const state = drive();
  const env = testEnv({ definition: testDefinition({ baseXp: 250 }) });
  runAttempt(state, { ordinal: 1, clearTraversal: true, winDuel: true, env });
  assert.equal(state.results[0]?.awardedXp, 250);
  assert.equal(state.results[0]?.baseXp, 250);
});

// ---- the server opens the attempt -----------------------------------------

const GRANT_SEED_HEX = "9f3c1a70b2d84e6115c07a9e33d4b8f2";

function serverGrant(attemptOrdinal: number): AttemptGrant {
  return {
    kind: "SERVER",
    grant: {
      attemptId: `00000000-0000-4000-8000-00000000000${attemptOrdinal}`,
      attemptOrdinal,
      attemptSeedHex: GRANT_SEED_HEX,
    },
  };
}

test("a ranked deploy waits on the server between the module and the level", () => {
  const env = testEnv({ ranked: true });
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) }, env);

  assert.equal(state.session.phase.phase, "AUTHORIZING");
  assert.deepEqual(
    state.effects.map((effect) => effect.kind),
    ["AUTHORIZE_ATTEMPT"],
    "the deck asks for an attempt; it does not load a level on its own",
  );

  send(state, { kind: "ATTEMPT_AUTHORIZED", grant: serverGrant(1) }, env);
  assert.equal(state.session.phase.phase, "LOADING");
  assert.ok(state.effects.some((effect) => effect.kind === "LOAD_INSTANCE"));
});

test("the ordinal on screen is the server's, not the one this tab counted", () => {
  // The reload case, exactly: nothing in this session's tallies, so the gate
  // offers attempt 1 — and the server, which remembers, opens attempt 2.
  const env = testEnv({ ranked: true });
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  assert.equal(
    state.session.phase.phase === "MODULE" && state.session.phase.attemptOrdinal,
    1,
  );
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) }, env);
  send(state, { kind: "ATTEMPT_AUTHORIZED", grant: serverGrant(2) }, env);

  const phase = state.session.phase;
  assert.equal(phase.phase, "LOADING");
  assert.equal(phase.phase === "LOADING" && phase.ticket.attemptOrdinal, 2);
  assert.equal(phase.phase === "LOADING" && phase.ticket.seedHex, GRANT_SEED_HEX);

  // And the result screen prices the run off the server's ordinal too.
  send(
    state,
    { kind: "INSTANCE_READY", instance: testInstance({ attemptOrdinal: 2 }) },
    env,
  );
  send(
    state,
    {
      kind: "TRAVERSAL_RESOLVED",
      outcome: {
        kind: "REACHED_DUEL",
        simulatedS: 140,
        droppedSteps: 0,
        objectiveIds: [],
        detections: 0,
        throwsStruckBody: 0,
      },
    },
    env,
  );
  send(state, { kind: "DUEL_RESOLVED", report: testDuelReport(true) }, env);
  const result = state.results.at(-1);
  assert.ok(result);
  assert.deepEqual(result.xpFraction, { numerator: 2, denominator: 3 });
  assert.equal(result.awardedXp, Math.floor((TEST_BASE_XP * 2) / 3));
});

test("the server's tally is what a fresh page load counts attempts from", () => {
  // Nothing in this session resolved anything; the count came from the snapshot.
  const env = testEnv({
    ranked: true,
    serverTallies: {
      [TEST_MISSION]: { missionId: TEST_MISSION, attemptsUsed: 2, outcome: "IN_PROGRESS" },
    },
  });
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  assert.equal(
    state.session.phase.phase === "MODULE" && state.session.phase.attemptOrdinal,
    3,
    "two burned attempts, so the deck arms the third",
  );

  const spent = drive();
  send(
    spent,
    { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION },
    testEnv({
      ranked: true,
      serverTallies: {
        [TEST_MISSION]: {
          missionId: TEST_MISSION,
          attemptsUsed: 3,
          outcome: "FAILED_PERMANENT",
        },
      },
    }),
  );
  assert.equal(
    spent.session.phase.phase === "BLOCKED" && spent.session.phase.reason,
    "MISSION_SPENT",
    "and clearing browser storage does not hand the attempts back",
  );
});

test("a refused authorization blocks, spends nothing, and keeps the deck read", () => {
  const env = testEnv({ ranked: true });
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) }, env);
  send(state, { kind: "ATTEMPT_REFUSED", reason: "OFFLINE" }, env);

  assert.deepEqual(state.session.phase, {
    phase: "BLOCKED",
    missionId: TEST_MISSION,
    reason: "OFFLINE",
  });
  assert.equal(state.results.length, 0, "nothing resolved, so nothing was spent");

  // Deploying again goes straight back to the server: the completion is still
  // on the ledger, so a network failure does not cost six cards of reading.
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  assert.equal(state.session.phase.phase, "AUTHORIZING");
});

test("a grant that arrives after the player left does not put them in a mission", () => {
  const env = testEnv({ ranked: true });
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) }, env);
  send(state, { kind: "ABANDON_ATTEMPT", reason: "closed the deck" }, env);
  assert.equal(state.session.phase.phase, "IDLE");
  assert.equal(state.results.length, 0, "the attempt was never entered");

  assert.equal(
    refused(state.session, { kind: "ATTEMPT_AUTHORIZED", grant: serverGrant(1) }, env),
    "COMMAND_NOT_LEGAL_IN_PHASE",
  );
});

test("no ranked mission is reachable without the server having opened it", () => {
  const env = testEnv({ ranked: true });
  const state = drive();
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  send(state, { kind: "MODULE_COMPLETED", completion: testCompletion(1) }, env);

  // AUTHORIZING carries no ticket, and every in-mission phase requires one, so
  // there is no transition from here into a level. The two commands that would
  // otherwise try are refused outright.
  assert.equal(
    refused(state.session, { kind: "BRIEFING_ACKNOWLEDGED" }, env),
    "COMMAND_NOT_LEGAL_IN_PHASE",
  );
  const instance = testInstance();
  const stray = reduceMission(
    state.session,
    { kind: "INSTANCE_READY", instance },
    env,
  );
  assert.ok(stray.ok);
  assert.equal(stray.ok && stray.session.phase.phase, "AUTHORIZING");
  assert.deepEqual(
    stray.ok && stray.effects.map((effect) => effect.kind),
    ["DISPOSE_INSTANCE"],
    "a level that arrives before the grant is freed, not entered",
  );
});

// ---- the retry deck -------------------------------------------------------
//
// What is pinned here is the deck a PLAYER is handed, read off the MODULE
// phase, rather than `retryOrderedModule` in isolation — moduleOrder.test.ts
// already covers the ordering itself, and it passed for months while nothing
// called the function.

/** A frame, three teaching cards and a synthesis: the shape M1's deck has. */
function orderableModule(): LearningModuleDefinition {
  const card = (
    id: string,
    throughSeconds: number,
    conceptIds: readonly string[],
  ) => ({
    id,
    cueId: `CUE.${id}`,
    throughSeconds,
    kicker: id,
    body: [id],
    conceptIds,
    codexCardIds: [],
    advanceLabel: "Next",
  });
  return {
    moduleId: `${TEST_MISSION}.MODULE`,
    chapterId: TEST_CHAPTER,
    missionId: TEST_MISSION,
    title: "Orderable",
    subtitle: "The authored subtitle.",
    cards: [
      card("OPEN", 20, []),
      card("A", 60, ["CONCEPT.A"]),
      card("B", 110, ["CONCEPT.B"]),
      card("SYNTHESIS", 160, ["CONCEPT.A", "CONCEPT.B"]),
      card("CLOSE", LEARNING_MODULE_SECONDS, []),
    ],
  };
}

/** Reads the deck out of the MODULE phase and completes it, as the player does. */
function readDeckAndEnter(
  state: Drive,
  ordinal: number,
  env: MissionSessionEnv,
): readonly string[] {
  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  assert.equal(state.session.phase.phase, "MODULE");
  const phase = state.session.phase as Extract<
    typeof state.session.phase,
    { phase: "MODULE" }
  >;
  const deck = phase.definition;
  const completion = completeModuleRun({
    definition: deck,
    attemptOrdinal: ordinal,
    acknowledgedCueIds: deck.cards.map((entry) => entry.cueId),
    observedSeconds: 180,
    at: env.now,
  });
  assert.ok(completion, "the deck the gate offered did not complete");
  send(state, { kind: "MODULE_COMPLETED", completion }, env);
  return deck.cards.map((entry) => entry.id);
}

/** Loses the duel with the named concepts answered wrong, and returns to the hub. */
function loseOn(state: Drive, ordinal: number, wrong: readonly string[], env: MissionSessionEnv) {
  send(state, { kind: "INSTANCE_READY", instance: testInstance({ attemptOrdinal: ordinal }) }, env);
  send(
    state,
    {
      kind: "TRAVERSAL_RESOLVED",
      outcome: {
        kind: "REACHED_DUEL",
        simulatedS: 150,
        droppedSteps: 0,
        objectiveIds: ["reach-post"],
        detections: 0,
        throwsStruckBody: 0,
      },
    },
    env,
  );
  send(
    state,
    {
      kind: "DUEL_RESOLVED",
      report: {
        ...testDuelReport(false),
        rounds: ["CONCEPT.A", "CONCEPT.B"].map((conceptId, at) => ({
          round: at + 1,
          itemId: `i${at + 1}`,
          conceptId,
          verdict: wrong.includes(conceptId) ? ("WRONG" as const) : ("CORRECT" as const),
          bullets: 1,
        })),
      },
    },
    env,
  );
  send(state, { kind: "RETURN_TO_HUB" }, env);
  send(state, { kind: "RETURN_SETTLED" }, env);
}

test("a retry opens on the concept the last attempt got wrong", () => {
  const env = testEnv({ module: orderableModule() });
  const state = drive();

  const first = readDeckAndEnter(state, 1, env);
  assert.deepEqual(first, ["OPEN", "A", "B", "SYNTHESIS", "CLOSE"], "authored order");
  loseOn(state, 1, ["CONCEPT.B"], env);

  const second = readDeckAndEnter(state, 2, env);
  assert.deepEqual(
    second,
    ["OPEN", "B", "A", "SYNTHESIS", "CLOSE"],
    "the missed concept leads; the frames and the synthesis do not move",
  );
  loseOn(state, 2, ["CONCEPT.A"], env);

  const third = readDeckAndEnter(state, 3, env);
  assert.deepEqual(
    third,
    ["OPEN", "A", "B", "SYNTHESIS", "CLOSE"],
    "the third deck follows the SECOND attempt's evidence, not the first's",
  );
});

test("the retry deck is still three minutes and still coverable", () => {
  const env = testEnv({ module: orderableModule() });
  const state = drive();
  readDeckAndEnter(state, 1, env);
  loseOn(state, 1, ["CONCEPT.B"], env);

  send(state, { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION }, env);
  const phase = state.session.phase;
  assert.equal(phase.phase, "MODULE");
  if (phase.phase !== "MODULE") return;
  const deck = phase.definition;

  assert.equal(
    deck.cards.at(-1)?.throughSeconds,
    LEARNING_MODULE_SECONDS,
    "a reorder is presentation: the deck still totals the authored duration",
  );
  assert.deepEqual(
    [...deck.cards.map((card) => card.cueId)].sort(),
    [...orderableModule().cards.map((card) => card.cueId)].sort(),
    "the cue set is untouched, so the server's coverage rule cannot tell the difference",
  );
  assert.equal(deck.moduleId, orderableModule().moduleId, "still the authored module row");
  assert.notEqual(deck.subtitle, orderableModule().subtitle, "the retry says so in its own voice");
});

test("a clean loss on mechanics is not handed a shuffled deck", () => {
  const env = testEnv({ module: orderableModule() });
  const state = drive();
  readDeckAndEnter(state, 1, env);
  loseOn(state, 1, [], env);

  const second = readDeckAndEnter(state, 2, env);
  assert.deepEqual(
    second,
    ["OPEN", "A", "B", "SYNTHESIS", "CLOSE"],
    "every question landed, so there is nothing to reorder toward",
  );
});
