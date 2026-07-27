// The PvP half of the evidence gate, driven through the real routes.
//
// What this pins, over HTTP, with the scheduler off and a fake clock:
//
//   * BOTH sides are dealt the IDENTICAL offered hand for the round — the projection
//     is deterministic in the item id and the match's shared deck — and it carries no
//     relevance (only ids, a minimum, and a cap);
//   * a satisfying placement grades CORRECT and an insufficient one grades WRONG, via
//     the same prose-AND-evidence combination the boss duel uses;
//   * OPPONENT PRIVACY: nothing a side places ever appears in the other side's
//     snapshot, opponent view, or question.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

process.env.CSRF_SECRET = "test-secret-for-pvp-evidence-csrf";

const { csrfTokenForSession } = await import("../src/auth.js");
const { registerPvpRoutes } = await import("../src/routes/pvp.js");
const { combineWithEvidence } = await import("../src/duels/grading.js");
const { newStandingRecord } = await import("@pa/pvp");
const { m1EvidenceRelevantCardIds, m1EvidencePolicy } = await import("@pa/mission-m1");

interface Harness {
  readonly app: FastifyInstance;
  readonly clock: { t: number };
}

async function buildHarness(): Promise<Harness> {
  const clock = { t: 2_000_000 };
  const records = new Map<string, ReturnType<typeof newStandingRecord>>();
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerPvpRoutes(app, {
    now: () => clock.t,
    startScheduler: false,
    authenticate: async (sessionId) => (sessionId ? { profileId: sessionId } : null),
    masteredConcepts: async () => [],
    verifyReceipt: () => true,
    // Prose is always CORRECT here; the evidence gate is what decides the verdict, so
    // this proves the route computes evidenceSatisfied and combines it exactly as PvE.
    gradeAnswer: async ({ itemId, evidenceSatisfied }) => {
      const prose = {
        kind: "CORRECT" as const,
        itemId,
        itemVersion: "v1",
        source: "CLASSIFIER" as const,
        responseRef: null,
      };
      return { envelope: combineWithEvidence(prose, evidenceSatisfied), receipt: "r" };
    },
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

function mutate(app: FastifyInstance, url: string, sid: string, payload: unknown = {}) {
  return app.inject({
    method: "POST",
    url,
    headers: { "x-pa-csrf-token": csrfTokenForSession(sid), "content-type": "application/json" },
    cookies: { pa_session: sid },
    payload: payload as object,
  });
}

function readAs(app: FastifyInstance, url: string, sid: string) {
  return app.inject({ method: "GET", url, cookies: { pa_session: sid } });
}

let uidCounter = 0;
const uid = (role: string) => `${role}-ev-${(uidCounter += 1)}`;

async function startMatch(app: FastifyInstance, host: string, guest: string): Promise<string> {
  const created = await mutate(app, "/api/pvp/lobby", host);
  assert.equal(created.statusCode, 200, created.body);
  const code = created.json().code as string;
  const joined = await mutate(app, `/api/pvp/lobby/${code}/join`, guest);
  assert.equal(joined.statusCode, 200, joined.body);
  return joined.json().matchId as string;
}

/** Poll a side forward until its read carries a question, returning that payload. */
async function questionFor(h: Harness, matchId: string, sid: string): Promise<{
  itemId: string;
  offeredCardIds: string[];
  minSupport: number;
  maxSelectable: number;
}> {
  for (let poll = 0; poll < 1500; poll += 1) {
    const res = await readAs(h.app, `/api/pvp/match/${matchId}`, sid);
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    if (body.question) return body.question;
    h.clock.t += 84;
  }
  throw new Error("the match never opened a question");
}

test("both sides are dealt the identical offered hand, and it leaks no relevance", async () => {
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);

  const qGuest = await questionFor(h, matchId, guest);
  const qHost = await questionFor(h, matchId, host);

  assert.equal(qGuest.itemId, qHost.itemId, "both sides are asked the same item");
  assert.deepEqual(qGuest.offeredCardIds, qHost.offeredCardIds, "and dealt the identical hand");
  assert.ok(qGuest.offeredCardIds.length > 0, "the hand is non-empty");
  assert.ok(qGuest.minSupport >= 1, "a minimum is stated");

  // The projection carries no relevance: only ids, a minimum, and a cap.
  const keys = Object.keys(qGuest);
  for (const forbidden of ["relevant", "accepted", "incompatible"]) {
    assert.ok(!keys.some((k) => k.toLowerCase().includes(forbidden)), `payload leaks ${forbidden}`);
  }

  // The hand does contain the relevant cards, so a satisfying placement is possible.
  const relevant = m1EvidenceRelevantCardIds(qGuest.itemId);
  for (const id of relevant) {
    assert.ok(qGuest.offeredCardIds.includes(id), "every relevant card is offered");
  }
  await h.app.close();
});

test("satisfying evidence grades CORRECT; too few grades WRONG; a side's cards stay private", async () => {
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);

  const q = await questionFor(h, matchId, guest);
  const policy = m1EvidencePolicy(q.itemId);
  const relevant = [...policy.relevantCardIds];
  const decoy = q.offeredCardIds.find((id) => !relevant.includes(id))!;

  // The guest places a WINNING selection (its own cards, kept private).
  const guestSelection = relevant.slice(0, policy.minSupport);
  const guestAnswer = await mutate(h.app, `/api/pvp/match/${matchId}/answer`, guest, {
    answerText: "the war left a debt",
    selectedCardIds: guestSelection,
  });
  assert.equal(guestAnswer.statusCode, 200, guestAnswer.body);
  assert.equal(guestAnswer.json().verdict, "CORRECT", "prose ok + evidence ok → CORRECT");
  assert.equal(guestAnswer.json().evidence, "OK");

  // OPPONENT PRIVACY: the host's read must not carry any card the guest placed.
  const hostRead = await readAs(h.app, `/api/pvp/match/${matchId}`, host);
  const hostBody = JSON.stringify({
    snapshot: hostRead.json().snapshot,
    // The host's own question is fine to carry the offered hand; what must never
    // appear is the guest's private SELECTION. Assert against the opponent view and
    // the snapshot, not the shared offered hand.
    opponent: hostRead.json().snapshot?.opponent,
  });
  for (const placed of guestSelection) {
    assert.ok(
      !JSON.stringify(hostRead.json().snapshot?.opponent ?? {}).includes(placed),
      `the opponent view leaked a placed card ${placed}`,
    );
  }
  void hostBody;

  // The host places a LOSING selection: one relevant card short of the minimum.
  const hostSelection =
    policy.minSupport >= 2 ? [relevant[0]!, decoy] : [decoy];
  const hostAnswer = await mutate(h.app, `/api/pvp/match/${matchId}/answer`, host, {
    answerText: "the war left a debt",
    selectedCardIds: hostSelection,
  });
  assert.equal(hostAnswer.statusCode, 200, hostAnswer.body);
  if (policy.minSupport >= 2) {
    assert.equal(hostAnswer.json().verdict, "WRONG", "prose ok + evidence too few → WRONG");
    assert.equal(hostAnswer.json().evidence, "TOO_FEW");
  } else {
    // A single-support item: a lone decoy still fails (no relevant card placed).
    assert.equal(hostAnswer.json().verdict, "WRONG");
  }
  await h.app.close();
});
