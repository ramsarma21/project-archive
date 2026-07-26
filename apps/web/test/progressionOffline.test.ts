import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommitMissionOutcomeRequest } from "@pa/contracts";
import type { ProgressionOutboxEntry } from "../src/db.js";
import { flushOutcomes, retryDelayMs, type OutboxQueue } from "../src/progression/outbox.js";
import type { ProgressionCallResult } from "../src/api.js";

// ===========================================================================
// The offline answer, exercised.
//
// The rule the design demands is that losing a school network mid-mission
// costs the student neither the attempt nor the honesty of the ladder. What
// makes that possible is the split enforced here: an attempt is AUTHORIZED
// online (so its ordinal and its price are fixed before play), and its outcome
// is DELIVERED whenever the network allows (so it can be late but never
// inflated).
//
// Everything below is about the delivery half. A queued outcome must survive a
// dead network, must not be delivered twice, must not be delivered under
// somebody else's session, and must not be silently thrown away because the
// server had a reason to say no that will stop being true.
// ===========================================================================

const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";
const CSRF = "csrf-token";

function entry(input: {
  profileId: string;
  attemptId: string;
  createdAt: string;
}): ProgressionOutboxEntry {
  const body: CommitMissionOutcomeRequest = {
    attemptId: input.attemptId,
    outcome: "CLEARED",
    committedEvents: [],
    baseRevision: 0,
  };
  return {
    key: `outcome:${input.attemptId}`,
    profileId: input.profileId,
    attemptId: input.attemptId,
    body,
    missionId: "PA.SEA01.CH02.BOSTON.MD01",
    createdAt: input.createdAt,
    attempts: 0,
    lastError: null,
  };
}

/** The durable queue, in memory. Same port, no browser. */
function memoryQueue(rows: ProgressionOutboxEntry[]): OutboxQueue & {
  readonly rows: ProgressionOutboxEntry[];
} {
  const store = [...rows];
  return {
    rows: store,
    async list(profileId) {
      return store
        .filter((row) => row.profileId === profileId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async drop(key) {
      const index = store.findIndex((row) => row.key === key);
      if (index >= 0) store.splice(index, 1);
    },
    async note(key, error) {
      const row = store.find((item) => item.key === key);
      if (row) {
        store.splice(store.indexOf(row), 1, {
          ...row,
          attempts: row.attempts + 1,
          lastError: error,
        });
      }
    },
  };
}

function sender(answers: ProgressionCallResult<unknown>[]) {
  const sent: { profileId: string; attemptId: string }[] = [];
  let index = 0;
  return {
    sent,
    send: async (
      profileId: string,
      body: CommitMissionOutcomeRequest,
    ): Promise<ProgressionCallResult<unknown>> => {
      sent.push({ profileId, attemptId: body.attemptId });
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      return answer ?? { status: "OK", value: null };
    },
  };
}

const ATTEMPT_1 = "aaaaaaaa-1111-4111-8111-111111111111";
const ATTEMPT_2 = "bbbbbbbb-2222-4222-8222-222222222222";

test("a dead network keeps the outcome and reports it unsynced", async () => {
  const queue = memoryQueue([
    entry({ profileId: PROFILE_A, attemptId: ATTEMPT_1, createdAt: "2026-07-25T10:00:00Z" }),
  ]);
  const { send, sent } = sender([{ status: "UNREACHABLE", detail: "Failed to fetch" }]);

  const flush = await flushOutcomes({ profileId: PROFILE_A, csrfToken: CSRF, send, queue });

  assert.equal(flush.settled, 0);
  assert.equal(flush.retained, 1);
  assert.equal(flush.pending, true);
  assert.equal(flush.lastError, "Failed to fetch");
  assert.equal(sent.length, 1);
  assert.equal(queue.rows.length, 1, "the attempt is still owed, not lost");
  assert.equal(queue.rows[0]?.attempts, 1);
});

test("the network comes back and the queue drains in the order it was earned", async () => {
  const queue = memoryQueue([
    entry({ profileId: PROFILE_A, attemptId: ATTEMPT_2, createdAt: "2026-07-25T11:00:00Z" }),
    entry({ profileId: PROFILE_A, attemptId: ATTEMPT_1, createdAt: "2026-07-25T10:00:00Z" }),
  ]);
  const { send, sent } = sender([{ status: "OK", value: null }]);

  const flush = await flushOutcomes({ profileId: PROFILE_A, csrfToken: CSRF, send, queue });

  assert.equal(flush.settled, 2);
  assert.equal(flush.pending, false);
  assert.deepEqual(
    sent.map((call) => call.attemptId),
    [ATTEMPT_1, ATTEMPT_2],
  );
  assert.equal(queue.rows.length, 0);
});

test("a response lost in transit settles on retry instead of committing twice", async () => {
  // The commit landed; the answer did not. The server's row is already closed,
  // so the redelivery answers ATTEMPT_CLOSED — which is this outcome's receipt.
  const queue = memoryQueue([
    entry({ profileId: PROFILE_A, attemptId: ATTEMPT_1, createdAt: "2026-07-25T10:00:00Z" }),
  ]);
  const { send } = sender([
    { status: "REFUSED", error: "ATTEMPT_CLOSED", httpStatus: 409 },
  ]);

  const flush = await flushOutcomes({ profileId: PROFILE_A, csrfToken: CSRF, send, queue });

  assert.equal(flush.settled, 1);
  assert.equal(flush.pending, false);
  assert.equal(queue.rows.length, 0);
});

test("an unpriced chapter keeps the clear queued until the content lands", async () => {
  const queue = memoryQueue([
    entry({ profileId: PROFILE_A, attemptId: ATTEMPT_1, createdAt: "2026-07-25T10:00:00Z" }),
  ]);
  const refuse = sender([
    { status: "REFUSED", error: "PACKAGE_MISSING", httpStatus: 400 },
  ]);
  const first = await flushOutcomes({
    profileId: PROFILE_A,
    csrfToken: CSRF,
    send: refuse.send,
    queue,
  });
  assert.equal(first.pending, true, "a real clear is not binned because the server cannot price it");

  // The XP curve is authored. The same queued outcome now pays out.
  const accept = sender([{ status: "OK", value: null }]);
  const second = await flushOutcomes({
    profileId: PROFILE_A,
    csrfToken: CSRF,
    send: accept.send,
    queue,
  });
  assert.equal(second.settled, 1);
  assert.equal(second.pending, false);
});

test("a spent mission discards the outcome: the rule worked, the save did not fail", async () => {
  const queue = memoryQueue([
    entry({ profileId: PROFILE_A, attemptId: ATTEMPT_1, createdAt: "2026-07-25T10:00:00Z" }),
  ]);
  const { send } = sender([
    { status: "REFUSED", error: "MISSION_SPENT", httpStatus: 409 },
  ]);
  const flush = await flushOutcomes({ profileId: PROFILE_A, csrfToken: CSRF, send, queue });
  assert.equal(flush.discarded, 1);
  assert.equal(flush.pending, false);
  assert.equal(queue.rows.length, 0);
});

test("one unreachable request stops the drain instead of hammering a dead network", async () => {
  const queue = memoryQueue([
    entry({ profileId: PROFILE_A, attemptId: ATTEMPT_1, createdAt: "2026-07-25T10:00:00Z" }),
    entry({ profileId: PROFILE_A, attemptId: ATTEMPT_2, createdAt: "2026-07-25T11:00:00Z" }),
  ]);
  const { send, sent } = sender([{ status: "UNREACHABLE", detail: "offline" }]);
  await flushOutcomes({ profileId: PROFILE_A, csrfToken: CSRF, send, queue });
  assert.equal(sent.length, 1, "a classroom of these must not become a flood");
  assert.equal(queue.rows.length, 2);
});

test("one account's session never delivers the other account's outcomes", async () => {
  // The case the owner will actually run tomorrow: two profiles, one machine.
  const queue = memoryQueue([
    entry({ profileId: PROFILE_A, attemptId: ATTEMPT_1, createdAt: "2026-07-25T10:00:00Z" }),
    entry({ profileId: PROFILE_B, attemptId: ATTEMPT_2, createdAt: "2026-07-25T10:30:00Z" }),
  ]);
  const { send, sent } = sender([{ status: "OK", value: null }]);

  const flush = await flushOutcomes({ profileId: PROFILE_B, csrfToken: CSRF, send, queue });

  assert.equal(flush.settled, 1);
  assert.deepEqual(sent, [{ profileId: PROFILE_B, attemptId: ATTEMPT_2 }]);
  // A's clear is untouched and still owed. It waits for A, it is not lost and
  // it is not pushed under B's session.
  assert.equal(queue.rows.length, 1);
  assert.equal(queue.rows[0]?.profileId, PROFILE_A);
  assert.equal(flush.pending, false, "B owes nothing; A's queue is not B's problem");
});

test("backoff grows and then stops growing", () => {
  assert.equal(retryDelayMs(0), 1_000);
  assert.equal(retryDelayMs(3), 8_000);
  assert.ok(retryDelayMs(20) <= 60_000);
  assert.equal(retryDelayMs(-5), 1_000);
});
