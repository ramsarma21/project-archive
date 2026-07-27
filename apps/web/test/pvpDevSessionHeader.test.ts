// Every PvP request must carry THIS tab's dev-session header.
//
// This is the transport-side half of the two-tab fix: a lobby created, listed, joined,
// polled or answered from tab B must resolve as tab B's profile, not the shared cookie
// tab A most recently overwrote. If any PvP call bypassed `withDevSessionHeader`, that
// call would silently fall back to the cookie and reintroduce "your own lobby". So we
// drive the real transport against a fetch spy and assert the header rides on ALL of
// them — reads, polls, and mutations alike.

import test from "node:test";
import assert from "node:assert/strict";
import { DEV_SESSION_HEADER } from "../src/devSession.js";
import { httpPvpTransport, setCsrfToken } from "../src/pvp/protocol.js";

type FetchFn = typeof fetch;

const HANDLE = "tab-b-handle-123";

/** A per-tab handle in a stubbed sessionStorage, so `withDevSessionHeader` attaches it. */
function withTabHandle(run: () => Promise<void>): Promise<void> {
  const g = globalThis as unknown as { sessionStorage?: unknown };
  const prior = g.sessionStorage;
  const store = new Map<string, string>([["pa.devSessionHandle", HANDLE]]);
  g.sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const restore = () => {
    if (prior === undefined) delete g.sessionStorage;
    else g.sessionStorage = prior;
  };
  return run().finally(restore);
}

function headerOf(init: RequestInit | undefined): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers[DEV_SESSION_HEADER];
}

test("every PvP transport call carries this tab's dev-session header", async () => {
  const seen: { url: string; header: string | undefined }[] = [];
  const g = globalThis as unknown as { fetch?: FetchFn };
  const priorFetch = g.fetch;
  g.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), header: headerOf(init) });
    // A body every reader below can parse without throwing.
    return Promise.resolve(
      new Response(JSON.stringify({ rows: [], authenticated: true, profile: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as FetchFn;

  try {
    await withTabHandle(async () => {
      setCsrfToken("csrf-token"); // mutations also carry the CSRF token; header must survive it
      await httpPvpTransport.identity();
      await httpPvpTransport.active();
      await httpPvpTransport.createLobby();
      await httpPvpTransport.readLobby("ABCD");
      await httpPvpTransport.cancelLobby("ABCD");
      await httpPvpTransport.joinLobby("ABCD");
      await httpPvpTransport.readMatch("pvp_1");
      await httpPvpTransport.sendIntents("pvp_1", []);
      await httpPvpTransport.answer("pvp_1", "Boston");
      await httpPvpTransport.forfeit("pvp_1");
      await httpPvpTransport.leaderboard();
    });
  } finally {
    if (priorFetch === undefined) delete g.fetch;
    else g.fetch = priorFetch;
    setCsrfToken(null);
  }

  assert.ok(seen.length >= 11, `expected every transport call to fetch, saw ${seen.length}`);
  for (const call of seen) {
    assert.equal(
      call.header,
      HANDLE,
      `PvP call to ${call.url} bypassed the per-tab dev-session header`,
    );
  }
});
