import test from "node:test";
import assert from "node:assert/strict";
import { ANSWER_TIMEOUT_MS, httpPvpTransport, REQUEST_TIMEOUT_MS } from "../src/pvp/protocol.js";

// The production request timeout (bug 5).
//
// The poll loop is recursive: a request that HANGS would stall it and freeze the fight.
// Every PvP fetch is therefore bounded by a shared timeout, aborted via AbortController,
// and a timeout is reported as UNREACHABLE — indistinguishable from a dropped packet, so
// the loop keeps polling and an in-flight edge receipt is never acknowledged (it stays
// pending for the next poll). A completed request must clear its timer and never abort
// late. The same `REQUEST_TIMEOUT_MS` is the contract the latency model is tested at.

type FetchFn = typeof fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch that resolves after `ms`, or rejects (AbortError) the moment it is aborted. */
function delayedFetch(ms: number, body: unknown): FetchFn {
  return ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse(body)), ms);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    })) as FetchFn;
}

async function withFetch<T>(mock: FetchFn, run: () => Promise<T>): Promise<T> {
  const original = (globalThis as { fetch?: FetchFn }).fetch;
  (globalThis as { fetch?: FetchFn }).fetch = mock;
  try {
    return await run();
  } finally {
    (globalThis as { fetch?: FetchFn }).fetch = original;
  }
}

test("a hung request aborts at the shared timeout and reads as UNREACHABLE", async () => {
  let aborted = false;
  const start = Date.now();
  const call = await withFetch(
    ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      })) as FetchFn,
    () => httpPvpTransport.readMatch("pvp_1"),
  );
  const elapsed = Date.now() - start;

  assert.equal(call.status, "UNREACHABLE");
  assert.ok(call.status === "UNREACHABLE" && call.detail.includes("TIMEOUT"), `detail ${JSON.stringify(call)}`);
  assert.ok(aborted, "the hung request was never aborted");
  assert.ok(
    elapsed >= REQUEST_TIMEOUT_MS - 25 && elapsed < REQUEST_TIMEOUT_MS + 250,
    `aborted after ${elapsed}ms, expected ~${REQUEST_TIMEOUT_MS}ms`,
  );
});

test("a completed request returns OK, clears its timer, and never aborts late", async () => {
  let aborted = false;
  const call = await withFetch(
    ((_url: string | URL | Request, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return Promise.resolve(jsonResponse({ rows: [] }));
    }) as FetchFn,
    () => httpPvpTransport.leaderboard(),
  );
  // Wait well past the timeout: a cleared timer must not fire a late abort.
  await new Promise((resolve) => setTimeout(resolve, REQUEST_TIMEOUT_MS + 60));

  assert.equal(call.status, "OK");
  assert.ok(!aborted, "a completed request left its abort timer armed");
});

test("a timeout is retryable: the very next request can succeed", async () => {
  let attempt = 0;
  const results: string[] = [];
  await withFetch(
    ((_url: string | URL | Request, init?: RequestInit) => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(jsonResponse({ rows: [] }));
    }) as FetchFn,
    async () => {
      results.push((await httpPvpTransport.leaderboard()).status);
      results.push((await httpPvpTransport.leaderboard()).status);
    },
  );
  assert.deepEqual(results, ["UNREACHABLE", "OK"], "a timeout must not poison the next request");
});

// ---- route-specific budgets: grading gets the longer one --------------------

test("answer grading succeeds within the longer budget: a ~650ms grade returns OK", async () => {
  const call = await withFetch(
    delayedFetch(650, { verdict: "CORRECT", snapshot: {} }),
    () => httpPvpTransport.answer("pvp_1", "Boston"),
  );
  assert.equal(call.status, "OK", "a healthy 650ms grade was aborted by too tight a budget");
});

test("answer grading still bounds a hung grade at ANSWER_TIMEOUT_MS, with cleanup", async () => {
  let aborted = false;
  const start = Date.now();
  const call = await withFetch(
    ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      })) as FetchFn,
    () => httpPvpTransport.answer("pvp_1", "Boston"),
  );
  const elapsed = Date.now() - start;

  assert.equal(call.status, "UNREACHABLE");
  assert.ok(
    call.status === "UNREACHABLE" && call.detail.includes(`TIMEOUT_${ANSWER_TIMEOUT_MS}`),
    `detail ${JSON.stringify(call)}`,
  );
  assert.ok(aborted, "the hung grade was never aborted");
  assert.ok(
    elapsed >= ANSWER_TIMEOUT_MS - 50 && elapsed < ANSWER_TIMEOUT_MS + 400,
    `aborted after ${elapsed}ms, expected ~${ANSWER_TIMEOUT_MS}ms`,
  );
});

test("the SAME slow response times out on a poll but succeeds on an answer", async () => {
  // A 650ms response: past the 200ms poll budget, within the 1500ms grading budget.
  const poll = await withFetch(
    delayedFetch(650, { snapshot: {}, question: null, result: null }),
    () => httpPvpTransport.readMatch("pvp_1"),
  );
  assert.equal(poll.status, "UNREACHABLE", "a 650ms poll should have timed out at 200ms");

  const grade = await withFetch(
    delayedFetch(650, { verdict: "WRONG", snapshot: {} }),
    () => httpPvpTransport.answer("pvp_1", "Boston"),
  );
  assert.equal(grade.status, "OK", "a 650ms grade should have been within the 1500ms budget");
});
