// Card-backed PvP: the gate is live, and cards are server-derived.
//
// These prove the access policy and the route enforce the four things that make
// card-backed PvP real rather than decorative:
//
//   1. the policy resolver hands out exactly the nine M1 cards under PLAYTEST_ALL,
//      touching no progression state, and refuses/grants correctly under
//      ASSESSMENT_PASSED;
//   2. the live card gate bites — a caller the server grants no cards cannot open a
//      lobby;
//   3. a request body cannot smuggle its own cards in;
//   4. an asked question names only card ids the caller actually holds, and carries
//      no identity or answer text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

process.env.CSRF_SECRET = "test-secret-for-pvp-card-gate";

const { csrfTokenForSession } = await import("../src/auth.js");
const { registerPvpRoutes } = await import("../src/routes/pvp.js");
const { pvpCardResolver, M1_PVP_CARD_ACCESS } = await import("../src/pvp/cardAccess.js");
const { bostonProgressionContent, M1_MODULE_ID } = await import("../src/progression/content.js");
const { newStandingRecord } = await import("@pa/pvp");

const M1_CARDS = bostonProgressionContent().codexCardsForModule(M1_MODULE_ID);

// ---- the policy resolver, unit-level -----------------------------------------

test("the default access policy is the temporary PLAYTEST_ALL", () => {
  assert.equal(M1_PVP_CARD_ACCESS, "PLAYTEST_ALL");
});

test("there are nine M1 cards, and they are the ones referenced across the surfaces", () => {
  assert.equal(new Set(M1_CARDS).size, 9, `expected 9 M1 cards, got ${M1_CARDS.length}`);
});

test("the API progression card map is exactly the authored nine", () => {
  // The server's own card map must match the authored definitions, or a module
  // completion would learn a card no surface can render, or fail to learn one it
  // teaches. Read the authored file rather than re-listing the ids here.
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "../../../content/m1/codex-cards.json");
  const authored = JSON.parse(readFileSync(path, "utf8")) as {
    cards?: { cardId: string }[];
  };
  const authoredIds = new Set((authored.cards ?? []).map((card) => card.cardId));
  assert.equal(authoredIds.size, 9);
  assert.deepEqual([...M1_CARDS].sort(), [...authoredIds].sort());
});

test("PLAYTEST_ALL returns exactly the nine M1 cards and never reads progression", async () => {
  let readProgression = false;
  const resolve = pvpCardResolver({
    m1CardIds: M1_CARDS,
    policy: "PLAYTEST_ALL",
    assessmentPassed: async () => {
      readProgression = true; // must never run under PLAYTEST_ALL
      return true;
    },
  });
  const cards = await resolve("any-profile");
  assert.deepEqual([...cards].sort(), [...M1_CARDS].sort());
  assert.equal(readProgression, false, "PLAYTEST_ALL must not mutate or even read progression");
});

test("ASSESSMENT_PASSED refuses before the assessment and grants the nine after it", async () => {
  let passed = false;
  const resolve = pvpCardResolver({
    m1CardIds: M1_CARDS,
    policy: "ASSESSMENT_PASSED",
    assessmentPassed: async () => passed,
  });
  assert.deepEqual([...(await resolve("p"))], [], "no cards before the assessment is passed");
  passed = true;
  assert.deepEqual([...(await resolve("p"))].sort(), [...M1_CARDS].sort(), "all nine after");
});

test("ASSESSMENT_PASSED fails closed when the snapshot cannot be read", async () => {
  const resolve = pvpCardResolver({
    m1CardIds: M1_CARDS,
    policy: "ASSESSMENT_PASSED",
    assessmentPassed: async () => {
      throw new Error("db down");
    },
    log: { warn: () => {} },
  });
  assert.deepEqual([...(await resolve("p"))], [], "an unreadable snapshot grants nothing");
});

// ---- the route ----------------------------------------------------------------

interface HarnessOptions {
  /** Server-derived cards per caller. Defaults to the full M1 set (PLAYTEST_ALL). */
  readonly resolvePvpCardIds?: (profileId: string) => Promise<readonly string[]>;
}

interface Harness {
  readonly app: FastifyInstance;
  readonly clock: { t: number };
}

async function buildHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const clock = { t: 1_000_000 };
  const records = new Map<string, ReturnType<typeof newStandingRecord>>();
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerPvpRoutes(app, {
    now: () => clock.t,
    startScheduler: false,
    authenticate: async (sessionId) => (sessionId ? { profileId: sessionId } : null),
    masteredConcepts: async () => [],
    verifyReceipt: () => true,
    gradeAnswer: async ({ itemId }) => ({
      envelope: { kind: "CORRECT", itemId, itemVersion: "v1", source: "CLASSIFIER", responseRef: null },
      receipt: "receipt",
    }),
    ...(opts.resolvePvpCardIds ? { resolvePvpCardIds: opts.resolvePvpCardIds } : {}),
    standings: {
      async ensure(profileId) {
        const existing = records.get(profileId);
        if (existing) return existing;
        const fresh = newStandingRecord(profileId, `Quiet-${profileId}`, 1);
        records.set(profileId, fresh);
        return fresh;
      },
      async board() {
        return [];
      },
      async bank() {
        return true;
      },
    },
  });
  await app.ready();
  return { app, clock };
}

let uidCounter = 0;
const uid = (role: string): string => `${role}-cardgate-${(uidCounter += 1)}`;

function mutate(
  app: FastifyInstance,
  method: "POST" | "DELETE",
  url: string,
  sid: string,
  payload: unknown = {},
) {
  return app.inject({
    method,
    url,
    headers: { "x-pa-csrf-token": csrfTokenForSession(sid), "content-type": "application/json" },
    cookies: { pa_session: sid },
    payload: payload as object,
  });
}

const readAs = (app: FastifyInstance, url: string, sid: string) =>
  app.inject({ method: "GET", url, cookies: { pa_session: sid } });

test("the live card gate bites: a caller the server grants no cards cannot open a lobby", async () => {
  const { app } = await buildHarness({ resolvePvpCardIds: async () => [] });
  const res = await mutate(app, "POST", "/api/pvp/lobby", uid("host"));
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, "NO_PVP_LEGAL_CARDS");
  await app.close();
});

test("a caller the server grants the M1 cards can open a lobby", async () => {
  const { app } = await buildHarness(); // default resolver = full M1 set
  const res = await mutate(app, "POST", "/api/pvp/lobby", uid("host"));
  assert.equal(res.statusCode, 200, res.body);
  await app.close();
});

test("a request body cannot supply its own PvP cards", async () => {
  const { app } = await buildHarness();
  for (const field of ["pvpLegalCardIds", "codexCardIds", "cardIds", "cards"]) {
    const res = await mutate(app, "POST", "/api/pvp/lobby", uid("host"), {
      [field]: ["BOS.MD01.CARD.WAR_DEBT.v1"],
    });
    assert.equal(res.statusCode, 400, `${field}: ${res.body}`);
    assert.equal(res.json().error, "CARDS_NOT_ACCEPTED");
  }
  await app.close();
});

test("an asked question names only cards the caller holds, and no identity or answer text", async () => {
  const { app, clock } = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const create = await mutate(app, "POST", "/api/pvp/lobby", host);
  assert.equal(create.statusCode, 200, create.body);
  const code = create.json().code as string;
  const joined = await mutate(app, "POST", `/api/pvp/lobby/${code}/join`, guest);
  assert.equal(joined.statusCode, 200, joined.body);
  const matchId = joined.json().matchId as string;

  // Poll to the first question. The scheduler is off, so a poll both advances and reads.
  let question: { itemId: string; codexCardIds: string[] } | null = null;
  for (let poll = 0; poll < 1500 && !question; poll += 1) {
    const res = await readAs(app, `/api/pvp/match/${matchId}`, guest);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    if (body.question) question = body.question;
    clock.t += 84;
  }
  assert.ok(question, "the match opened a question");

  const held = new Set(M1_CARDS);
  assert.ok(question!.codexCardIds.length > 0, "the item carries the cards it draws on");
  for (const card of question!.codexCardIds) {
    assert.ok(held.has(card), `question names a card the caller does not hold: ${card}`);
  }
  // No identity and no answer text ride along with a question.
  const json = JSON.stringify(question);
  assert.equal(json.includes("profileId"), false);
  assert.equal(json.includes(guest), false);
  assert.equal(json.includes("proposition"), false);
  await app.close();
});
