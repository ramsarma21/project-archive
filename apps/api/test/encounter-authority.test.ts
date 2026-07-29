// The perspective-encounter route is bound to the player's OWN open attempt, the
// server picks the item, and the first answer is final.
//
// Sibling of duel-attempt-authority.test.ts, driven with an injected session,
// attempt resolver and verdict store — no database. It asserts the properties
// the design requires of a required, forced encounter:
//
//   * auth and CSRF are enforced, and an unknown encounter id is refused;
//   * the graded item is the SERVER's (recomputed from the stored attempt),
//     never the client's claim, and the rubric never rides the response;
//   * a {profile, attempt, encounter} grades exactly once — a changed second
//     answer and a racer both get the first stored verdict and receipt back;
//   * an infrastructure grant is reported so a client can treat it as a reprieve
//     rather than a trap.
//
// Offline by design: with no classifier, a non-blank answer is granted (CORRECT,
// source GRADING_TIMEOUT) and a blank abstains (WRONG), which is enough to make
// the authority testable without a model credential.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance, type FastifyBaseLogger } from "fastify";
import cookie from "@fastify/cookie";
import { resetVerdictReceiptSecretCache, m1EncounterBank } from "@pa/grading";
import { expectedEncounterItemId } from "@pa/mission-m1";

await import("../src/config.js");
delete process.env.TRUEFOUNDRY_API_KEY;
delete process.env.TRUEFOUNDRY_BASE_URL;
delete process.env.TRUEFOUNDRY_GRADING_API_KEY;
delete process.env.TRUEFOUNDRY_GRADING_BASE_URL;
process.env.GRADING_RECEIPT_SECRET = "test-secret-for-encounter-authority";
process.env.CSRF_SECRET = "test-secret-for-encounter-csrf";
resetVerdictReceiptSecretCache();

const { createDuelGrading } = await import("../src/duels/grading.js");
const { GradingSignal } = await import("../src/duels/gradingSignal.js");
const { registerEncounterRoutes, defaultEncounterQuestionAuthority } = await import(
  "../src/routes/encounters.js"
);
const { inMemoryDuelVerdictStore } = await import("../src/duels/verdictStore.js");
const { csrfTokenForSession } = await import("../src/auth.js");

const silent = {
  warn: () => undefined,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as FastifyBaseLogger;

const SEED_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const ALICE = "alice";
const NOBODY = "nobody";

const attempts: Record<
  string,
  {
    attemptId: string;
    attemptOrdinal: number;
    attemptSeedHex: string;
    missionId: string;
    chapterId: string;
  } | null
> = {
  [ALICE]: {
    attemptId: "att-alice",
    attemptOrdinal: 1,
    attemptSeedHex: SEED_HEX,
    missionId: "PA.SEA01.CH02.BOSTON.MD01",
    chapterId: "boston-1765",
  },
  [NOBODY]: null,
};

const EXPECTED_SHAMBLES = expectedEncounterItemId({
  encounterId: "SHAMBLES_STOP",
  attemptSeedHex: SEED_HEX,
  attemptOrdinal: 1,
});

async function harness() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const grading = createDuelGrading(silent, { bank: m1EncounterBank() });
  await registerEncounterRoutes(app, {
    grading,
    authenticate: async (sid) => (sid ? { profileId: sid } : null),
    resolveAttempt: async (profileId) => attempts[profileId] ?? null,
    questionAuthority: defaultEncounterQuestionAuthority(),
    verdictStore: inMemoryDuelVerdictStore(),
  });
  await app.ready();
  return { app };
}

function post(
  app: FastifyInstance,
  sid: string | null,
  encounterId: string,
  body: Record<string, unknown>,
  opts: { csrf?: boolean } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.csrf !== false && sid) headers["x-pa-csrf-token"] = csrfTokenForSession(sid);
  return app.inject({
    method: "POST",
    url: `/v1/encounters/${encodeURIComponent(encounterId)}/verdict`,
    headers,
    cookies: sid ? { pa_session: sid } : {},
    payload: body,
  });
}

test("auth and CSRF are enforced", async () => {
  const { app } = await harness();
  try {
    const noSession = await post(app, null, "SHAMBLES_STOP", { answer: "x" });
    assert.equal(noSession.statusCode, 401);
    const badCsrf = await post(app, ALICE, "SHAMBLES_STOP", { answer: "x" }, { csrf: false });
    assert.equal(badCsrf.statusCode, 403);
  } finally {
    await app.close();
  }
});

test("an unknown encounter id is refused", async () => {
  const { app } = await harness();
  try {
    const res = await post(app, ALICE, "NOT_A_STOP", { answer: "x" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error, "ENCOUNTER_NOT_FOUND");
    assert.equal(res.headers["x-pa-verdict-receipt"], undefined);
  } finally {
    await app.close();
  }
});

test("no open attempt is refused with no receipt to spend", async () => {
  const { app } = await harness();
  try {
    const res = await post(app, NOBODY, "SHAMBLES_STOP", { answer: "x" });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, "NO_OPEN_ATTEMPT");
    assert.equal(res.headers["x-pa-verdict-receipt"], undefined);
  } finally {
    await app.close();
  }
});

test("a client-supplied verdict field is rejected", async () => {
  const { app } = await harness();
  try {
    const res = await post(app, ALICE, "SHAMBLES_STOP", { answer: "x", kind: "CORRECT" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "VERDICT_NOT_ACCEPTED");
  } finally {
    await app.close();
  }
});

test("a forged item claim cannot change the item that is graded", async () => {
  const { app } = await harness();
  try {
    const res = await post(app, ALICE, "SHAMBLES_STOP", {
      answer: "Parliament rules the empire and the colonies should pay the war's debt.",
      itemId: "BOS.MD01.ENC.ROPEWALK.WHY_CARE.v1", // a real but wrong item
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().itemId, EXPECTED_SHAMBLES);
    // The response body carries only the five envelope keys — no rubric.
    assert.deepEqual(
      Object.keys(res.json()).sort(),
      ["itemId", "itemVersion", "kind", "responseRef", "source"],
    );
    // A non-blank answer offline is the generous grant, reported for the client.
    assert.equal(res.json().kind, "CORRECT");
    assert.equal(res.headers["x-pa-encounter-granted"], "true");
    assert.ok(res.headers["x-pa-verdict-receipt"]);
  } finally {
    await app.close();
  }
});

test("first answer is final: a changed second answer cannot re-grade", async () => {
  const { app } = await harness();
  try {
    const first = await post(app, ALICE, "SHAMBLES_STOP", { answer: "" });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().kind, "WRONG");
    const receipt = first.headers["x-pa-verdict-receipt"];
    assert.ok(receipt);

    const second = await post(app, ALICE, "SHAMBLES_STOP", {
      answer: "The colonies were defended in the war and should share the debt.",
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().kind, "WRONG", "the first verdict stands");
    assert.deepEqual(second.json(), first.json());
    assert.equal(second.headers["x-pa-verdict-receipt"], receipt);
  } finally {
    await app.close();
  }
});

test("concurrent submissions converge on one stored verdict and receipt", async () => {
  const { app } = await harness();
  try {
    const [a, b] = await Promise.all([
      post(app, ALICE, "ROPEWALK_STOP", { answer: "no stamped clearance means no sailing and no wage" }),
      post(app, ALICE, "ROPEWALK_STOP", { answer: "" }),
    ]);
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    assert.deepEqual(a.json(), b.json());
    assert.equal(
      a.headers["x-pa-verdict-receipt"],
      b.headers["x-pa-verdict-receipt"],
    );
  } finally {
    await app.close();
  }
});

test("encounter grading records into a SHARED signal, so an outage is visible on /v1/health", async () => {
  // The gap Task 2 closes: the encounter route builds its OWN createDuelGrading (its
  // bank differs), and a private signal is one /v1/health never reads — so a real
  // encounter-grading outage read as healthy on the one endpoint meant to report it.
  // app.ts now passes duelGrading.signal here so encounter rounds fold into the same
  // rolling rate the boss duel reports. This pins that seam: a round graded through
  // the encounter route must show up on the signal app.ts shares.
  const shared = new GradingSignal({ configured: false, announceToConsole: false });
  const before = shared.snapshot().ungradedSinceBoot;

  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerEncounterRoutes(app, {
    // The signal app.ts injects via duelGrading.signal. The route builds its own
    // encounter-bank grading around it, exactly as production does.
    signal: shared,
    authenticate: async (sid) => (sid ? { profileId: sid } : null),
    resolveAttempt: async (profileId) => attempts[profileId] ?? null,
    questionAuthority: defaultEncounterQuestionAuthority(),
    verdictStore: inMemoryDuelVerdictStore(),
  });
  await app.ready();
  try {
    // Offline (no credential): a non-blank answer takes the generous grant, which is
    // an ungraded round — the exact condition the signal exists to surface.
    const res = await post(app, ALICE, "SHAMBLES_STOP", {
      answer: "the colonies were defended and should share the war's cost",
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers["x-pa-encounter-granted"], "true");

    const after = shared.snapshot();
    assert.equal(
      after.ungradedSinceBoot,
      before + 1,
      "the encounter round reached the shared signal /v1/health reads",
    );
    assert.equal(after.status, "UNGRADED", "no credential pins the shared signal UNGRADED");
  } finally {
    await app.close();
  }
});
