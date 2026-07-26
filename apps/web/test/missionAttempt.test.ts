import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import type { DeployDecision } from "../src/module/moduleGate.js";
import {
  attemptChildSeed,
  attemptOpening,
  attemptSeed,
  attemptSeedHex,
  openAttempt,
} from "../src/mission/attempt.js";
import {
  clearMissionRegistry,
  missionDefinition,
  registerMission,
  registeredMissionIds,
} from "../src/mission/missionFormat.js";
import {
  TEST_CHAPTER,
  TEST_MISSION,
  testCompletion,
  testDefinition,
  testModule,
} from "./missionHarness.js";

// The ticket is the module gate made structural. These pin the three ways it can
// refuse, and the seed rules that make a retry a different run from attempt one.

const AT = "2026-07-25T12:00:00.000Z";

function enter(attemptOrdinal: number, completionOrdinal = attemptOrdinal): DeployDecision {
  return {
    kind: "ENTER_MISSION",
    missionId: TEST_MISSION,
    attemptOrdinal,
    completion: testCompletion(completionOrdinal),
  };
}

/**
 * A decision whose completion agrees with an out-of-range ordinal, so the ordinal
 * check is the only thing left to refuse it. The module player cannot mint one of
 * these — `completeModuleRun` refuses a non-positive ordinal — which is why it is
 * assembled by hand here rather than through the fixture.
 */
function enterUnchecked(attemptOrdinal: number): DeployDecision {
  return {
    kind: "ENTER_MISSION",
    missionId: TEST_MISSION,
    attemptOrdinal,
    completion: { ...testCompletion(1), attemptOrdinal },
  };
}

/** Unranked practice: nobody is signed in, so the client mints the identity. */
function open(decision: DeployDecision) {
  return openAttempt({
    decision,
    chapterId: TEST_CHAPTER,
    grant: { kind: "UNRANKED_PRACTICE", attemptId: "attempt-1" },
    at: AT,
    profileSeedHex: null,
  });
}

const SERVER_SEED_HEX = "9f3c1a70b2d84e6115c07a9e33d4b8f2";

/** A ranked attempt: the server opened the row and named all three facts. */
function openGranted(
  decision: DeployDecision,
  grant: Partial<{ attemptId: string; attemptOrdinal: number; attemptSeedHex: string }> = {},
) {
  return openAttempt({
    decision,
    chapterId: TEST_CHAPTER,
    grant: {
      kind: "SERVER",
      grant: {
        attemptId: grant.attemptId ?? "11111111-1111-4111-8111-111111111111",
        attemptOrdinal: grant.attemptOrdinal ?? 1,
        attemptSeedHex: grant.attemptSeedHex ?? SERVER_SEED_HEX,
      },
    },
    at: AT,
    profileSeedHex: null,
  });
}

test("only an ENTER_MISSION decision opens an attempt", () => {
  assert.equal(
    open({
      kind: "RUN_MODULE",
      definition: testModule(),
      attemptOrdinal: 1,
    }),
    null,
    "a module still to read is not permission to enter",
  );
  assert.equal(open({ kind: "BLOCKED", reason: "MISSION_SPENT" }), null);
  assert.ok(open(enter(1)), "and a satisfied gate does");
});

test("the completion has to gate the exact attempt being opened", () => {
  assert.equal(
    open(enter(2, 1)),
    null,
    "attempt one's module does not open attempt two",
  );
  assert.equal(open(enter(1, 2)), null, "nor the other way round");
  assert.ok(open(enter(2, 2)));
});

test("a completion for another mission opens nothing", () => {
  assert.equal(
    open({
      kind: "ENTER_MISSION",
      missionId: TEST_MISSION,
      attemptOrdinal: 1,
      completion: testCompletion(1, "m9"),
    }),
    null,
  );
});

test("only the three real ordinals open an attempt", () => {
  for (const ordinal of [0, -1, MAX_MISSION_ATTEMPTS + 1, 1.5, Number.NaN]) {
    assert.equal(open(enterUnchecked(ordinal)), null, `ordinal ${ordinal}`);
  }
  for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
    assert.ok(open(enter(ordinal)), `ordinal ${ordinal}`);
  }
});

test("each attempt gets its own seed, so a retry is not a replay", () => {
  const seeds = [1, 2, 3].map((attemptOrdinal) =>
    attemptSeed({
      chapterId: TEST_CHAPTER,
      missionId: TEST_MISSION,
      attemptOrdinal,
      profileSeedHex: null,
    }),
  );
  assert.equal(new Set(seeds).size, 3, "three attempts, three seeds");

  // And it is stable: the same attempt seeds the same run every time it is asked.
  assert.equal(
    seeds[0],
    attemptSeed({
      chapterId: TEST_CHAPTER,
      missionId: TEST_MISSION,
      attemptOrdinal: 1,
      profileSeedHex: null,
    }),
  );
});

test("different missions and different profiles seed differently", () => {
  const base = { chapterId: TEST_CHAPTER, attemptOrdinal: 1, profileSeedHex: null };
  assert.notEqual(
    attemptSeed({ ...base, missionId: "m1" }),
    attemptSeed({ ...base, missionId: "m2" }),
  );
  assert.notEqual(
    attemptSeed({ ...base, missionId: "m1" }),
    attemptSeed({ ...base, missionId: "m1", profileSeedHex: "a".repeat(64) }),
  );
});

test("the stored seed hex is the same fact in the width the row wants", () => {
  const hex = attemptSeedHex({
    chapterId: TEST_CHAPTER,
    missionId: TEST_MISSION,
    attemptOrdinal: 1,
    profileSeedHex: null,
  });
  assert.match(hex, /^[0-9a-f]{32}$/, "matches MissionAttemptSchema's SeedHex");
  assert.equal(
    hex,
    attemptSeedHex({
      chapterId: TEST_CHAPTER,
      missionId: TEST_MISSION,
      attemptOrdinal: 1,
      profileSeedHex: null,
    }),
  );
});

test("a sub-system seed is derived from the attempt, never drawn fresh", () => {
  const ticket = open(enter(1));
  assert.ok(ticket);
  const duel = attemptChildSeed(ticket, "duel");
  assert.equal(duel, attemptChildSeed(ticket, "duel"), "stable");
  assert.notEqual(duel, attemptChildSeed(ticket, "post-job"), "and distinct per purpose");

  const second = open(enter(2));
  assert.ok(second);
  assert.notEqual(
    duel,
    attemptChildSeed(second, "duel"),
    "so a retry's duel is not the first attempt's duel",
  );
});

test("what the client may say about an opened attempt excludes every reward", () => {
  const ticket = open(enter(2));
  assert.ok(ticket);
  const opening = attemptOpening(ticket);
  assert.deepEqual(Object.keys(opening).sort(), [
    "attemptId",
    "attemptOrdinal",
    "attemptSeedHex",
    "chapterId",
    "missionId",
    "moduleCompletedAt",
    "moduleId",
    "startedAt",
  ]);
  assert.equal(opening.attemptOrdinal, 2);
  assert.equal(opening.moduleCompletedAt, testCompletion(2).completedAt);
});

test("a ticket carries the receipt that opened it", () => {
  const ticket = open(enter(3));
  assert.ok(ticket);
  assert.equal(ticket.moduleCompletion.attemptOrdinal, 3);
  assert.equal(ticket.moduleCompletion.awardedXp, 0, "a module pays nothing, ever");
});

// ---- the server's grant ---------------------------------------------------

test("a granted attempt takes the server's ordinal, id and seed", () => {
  // The failure this pins is the one a reload produces: this browser has
  // forgotten attempt 1, so the gate says "attempt 1, full XP" while the server
  // is opening attempt 2 and paying two thirds. The grant settles it.
  const ticket = openGranted(enter(1), { attemptOrdinal: 2 });
  assert.ok(ticket);
  assert.equal(ticket.attemptOrdinal, 2, "the server's, not the browser's");
  assert.equal(ticket.ranked, true);
  assert.equal(ticket.attemptId, "11111111-1111-4111-8111-111111111111");
  assert.equal(ticket.seedHex, SERVER_SEED_HEX, "the level runs the row's variation");
  assert.notEqual(
    ticket.seedHex,
    open(enter(1))?.seedHex,
    "and it is not the locally derived one",
  );
});

test("a malformed grant opens nothing", () => {
  assert.equal(openGranted(enter(1), { attemptSeedHex: "not-hex" }), null);
  assert.equal(openGranted(enter(1), { attemptSeedHex: "abc" }), null);
  assert.equal(openGranted(enter(1), { attemptId: "  " }), null);
  assert.equal(openGranted(enter(1), { attemptOrdinal: 0 }), null);
  assert.equal(openGranted(enter(1), { attemptOrdinal: 4 }), null);
  assert.equal(openGranted(enter(1), { attemptOrdinal: 1.5 }), null);
});

test("a grant is not a way past the gate", () => {
  // The decision is still required, and it is still the only source of the
  // module receipt. A grant on top of a blocked or unread gate opens nothing.
  assert.equal(openGranted({ kind: "BLOCKED", reason: "MISSION_SPENT" }), null);
  assert.equal(
    openGranted({ kind: "RUN_MODULE", definition: testModule(), attemptOrdinal: 1 }),
    null,
  );
  assert.equal(
    openGranted({
      kind: "ENTER_MISSION",
      missionId: TEST_MISSION,
      attemptOrdinal: 1,
      completion: testCompletion(1, "m9"),
    }),
    null,
    "and the receipt still has to be this mission's",
  );
});

test("a granted retry's module receipt is the server's business, not this tab's", () => {
  // The server refuses to open an ordinal that has no completion bound to it,
  // so a grant IS the module check for a ranked run. The local ordinal
  // comparison is dropped here precisely because the browser's copy of the
  // ordinal is the thing that was wrong.
  const ticket = openGranted(enter(1), { attemptOrdinal: 2 });
  assert.ok(ticket, "a receipt filed under attempt 1 still opens the server's 2");
  assert.equal(ticket.moduleCompletion.attemptOrdinal, 1);
  // Unranked has no such backstop, so it keeps the strict local check.
  assert.equal(open(enter(2, 1)), null);
});

test("the duel's seed follows the server's attempt, so a retry is a fresh fight", () => {
  const first = openGranted(enter(1), { attemptOrdinal: 1 });
  const second = openGranted(enter(1), {
    attemptOrdinal: 2,
    attemptSeedHex: "0123456789abcdef0123456789abcdef",
  });
  assert.ok(first && second);
  assert.notEqual(attemptChildSeed(first, "duel"), attemptChildSeed(second, "duel"));
});

// ---- the registry ---------------------------------------------------------

test("a defective mission is refused at registration rather than at play", () => {
  clearMissionRegistry();
  assert.throws(() => registerMission(testDefinition({ baseXp: -5 })), /baseXp/);
  assert.throws(
    () => registerMission({ ...testDefinition(), moduleId: "" }),
    /gating module/,
  );
  assert.throws(
    () => registerMission({ ...testDefinition(), conceptIds: [] }),
    /no concepts/,
  );
  assert.deepEqual(registeredMissionIds(), []);
});

test("registering a mission is all it takes to make it deployable", () => {
  clearMissionRegistry();
  assert.equal(missionDefinition(TEST_MISSION), undefined);
  registerMission(testDefinition());
  assert.equal(missionDefinition(TEST_MISSION)?.title, "Nailed to the Post");
  // A later registration replaces the earlier one rather than joining it.
  registerMission(testDefinition({ baseXp: 400 }));
  assert.equal(missionDefinition(TEST_MISSION)?.baseXp, 400);
  assert.deepEqual(registeredMissionIds(), [TEST_MISSION]);
  clearMissionRegistry();
});
