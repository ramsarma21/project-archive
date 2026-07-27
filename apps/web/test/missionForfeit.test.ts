// The interrupted-attempt flow, client side.
//
// Two properties, both new. First: authorization no longer RESUMES an open
// attempt. A run left open server-side used to be handed straight back to a fresh
// runtime, which is unlimited replay of a losing run — reload, get it back, again.
// Now the open attempt is a refusal (`ATTEMPT_INTERRUPTED`) and the only way past
// it is to forfeit it. Second: the hub's Deploy gate stays closed on a mission
// that has an open attempt, so a player cannot start a fresh run over one.

import test from "node:test";
import assert from "node:assert/strict";

import type { ModuleRunCompletion } from "../src/module/moduleGate.js";
import { authorizeAttempt } from "../src/progression/authorize.js";
import { deployStanding } from "../src/progression/gate.js";
import { newRunnerView } from "../src/progression/projection.js";
import type { MissionAttempt } from "@pa/contracts";

const MISSION = "PA.SEA01.CH02.BOSTON.MD01";
const CHAPTER = "boston-1765";

const completion: ModuleRunCompletion = {
  moduleId: "BOS.MD01.MODULE.v1",
  missionId: MISSION,
  attemptOrdinal: 1,
  acknowledgedCueIds: ["BOS.MD01.CUE.HANDOFF.v1"],
  acknowledgedCheckIds: [],
  observedSeconds: 200,
  completedAt: "2026-07-25T00:00:00.000Z",
  awardedXp: 0,
};

type FetchResult = { status: number; body: unknown };

/** Route the two progression posts authorize makes to scripted responses. */
function stubFetch(byPath: (path: string) => FetchResult): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const result = byPath(url);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body,
    } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("an open attempt is refused, never resumed into a fresh runtime", async () => {
  // The module records, then the open is refused ATTEMPT_ALREADY_OPEN — the reload
  // case. Authorization must NOT pull the open row and hand it back.
  const restore = stubFetch((path) => {
    if (path.endsWith("/modules")) return { status: 200, body: { ok: true } };
    if (path.endsWith("/mission-attempts")) {
      return { status: 409, body: { error: "ATTEMPT_ALREADY_OPEN" } };
    }
    throw new Error(`unexpected fetch to ${path}`);
  });
  try {
    const result = await authorizeAttempt({
      profileId: "p1",
      csrfToken: "csrf",
      chapterId: CHAPTER,
      completion,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "ATTEMPT_INTERRUPTED");
    // No `resumed: true` authorization exists any more, at all.
    assert.ok(!("authorization" in result));
  } finally {
    restore();
  }
});

test("a clean open still authorizes a fresh attempt", async () => {
  const attempt: MissionAttempt = {
    attemptId: "att-1",
    profileId: "p1",
    chapterId: CHAPTER,
    missionId: MISSION,
    attemptOrdinal: 1,
    attemptSeedHex: "a".repeat(32),
    moduleId: completion.moduleId,
    moduleCompletedAt: completion.completedAt,
    status: "IN_PROGRESS",
    xpFraction: { numerator: 3, denominator: 3 },
    awardedXp: 0,
    revision: 0,
    startedAt: completion.completedAt,
    completedAt: null,
    updatedAt: completion.completedAt,
  };
  const restore = stubFetch((path) => {
    if (path.endsWith("/modules")) return { status: 200, body: { ok: true } };
    if (path.endsWith("/mission-attempts")) return { status: 200, body: attempt };
    throw new Error(`unexpected fetch to ${path}`);
  });
  try {
    const result = await authorizeAttempt({
      profileId: "p1",
      csrfToken: "csrf",
      chapterId: CHAPTER,
      completion,
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.authorization.attemptId, "att-1");
    assert.equal(result.authorization.attemptOrdinal, 1);
    // The `resumed` flag is gone from the shape entirely.
    assert.ok(!("resumed" in result.authorization));
  } finally {
    restore();
  }
});

test("Deploy stays closed on a mission with an open attempt", () => {
  const base = newRunnerView(CHAPTER, "p1");
  const openAttempt = {
    attemptId: "att-open",
    missionId: MISSION,
    chapterId: CHAPTER,
    attemptOrdinal: 1,
    status: "IN_PROGRESS" as const,
  } as unknown as MissionAttempt;
  const view = { ...base, openAttempt };

  const blocked = deployStanding({
    view,
    missionId: MISSION,
    routeOpen: true,
    known: true,
    unranked: false,
  });
  assert.deepEqual(blocked, { deployable: false, reason: "INTERRUPTED" });

  // ONE open attempt per profile: every OTHER mission is blocked too, not just the
  // one with the open run — you cannot start a second run on a different route.
  const other = deployStanding({
    view,
    missionId: "PA.SEA01.CH02.BOSTON.MD02",
    routeOpen: true,
    known: true,
    unranked: false,
  });
  assert.deepEqual(other, { deployable: false, reason: "INTERRUPTED" });

  // And with nothing open, the same mission deploys normally.
  const clear = deployStanding({
    view: base,
    missionId: MISSION,
    routeOpen: true,
    known: true,
    unranked: false,
  });
  assert.equal(clear.deployable, true);
});

test("signed out cannot deploy (SIGN_IN_REQUIRED) but a known signed-in profile can", () => {
  const base = newRunnerView(CHAPTER, "p1");
  // The preview / signed-out hub: renders, but Deploy is refused — no unlimited
  // practice, play is ranked and durable only.
  const signedOut = deployStanding({
    view: base,
    missionId: MISSION,
    routeOpen: true,
    known: true,
    unranked: true,
  });
  assert.deepEqual(signedOut, { deployable: false, reason: "SIGN_IN_REQUIRED" });

  // A server-backed local or Google profile (known, ranked, nothing open) deploys.
  const signedIn = deployStanding({
    view: base,
    missionId: MISSION,
    routeOpen: true,
    known: true,
    unranked: false,
  });
  assert.equal(signedIn.deployable, true);
  assert.equal(signedIn.reason, "OPEN");
});
