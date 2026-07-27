// Establishing a server session for a LOCAL profile, client side.
//
// This is the decision App branches on: only a { ok: true } lets a local profile
// enter the hub, so a network failure or a non-2xx must come back { ok: false } and
// App surfaces an error rather than dropping the player into an unlimited practice
// run. The App itself pulls in Dexie and three.js and cannot mount under
// `node --test`, so the seam it depends on is exercised directly with fetch faked.

import test from "node:test";
import assert from "node:assert/strict";

import { establishLocalSession } from "../src/api.js";

const PROFILE = {
  profileId: "11111111-1111-4111-8111-111111111111",
  displayName: "Ada",
  seedHex: "a".repeat(64),
};

function stubFetch(handler: (url: string, init: RequestInit) => { status: number }): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: unknown) => {
    const { status } = handler(String(input), (init ?? {}) as RequestInit);
    return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("a 200 establishes the session and posts the profile's own fields", async () => {
  let seen: { url: string; body: unknown } | null = null;
  const restore = stubFetch((url, init) => {
    seen = { url, body: JSON.parse(String(init.body)) };
    return { status: 200 };
  });
  try {
    const result = await establishLocalSession(PROFILE);
    assert.deepEqual(result, { ok: true });
    assert.equal(seen!.url, "/v1/auth/local-session");
    assert.deepEqual(seen!.body, PROFILE);
  } finally {
    restore();
  }
});

test("a non-2xx (e.g. 404 in production) is a failure App can surface", async () => {
  const restore = stubFetch(() => ({ status: 404 }));
  try {
    const result = await establishLocalSession(PROFILE);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "HTTP_404");
  } finally {
    restore();
  }
});

test("a network error is a failure, never a silent success", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  try {
    const result = await establishLocalSession(PROFILE);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.reason, "offline");
  } finally {
    globalThis.fetch = original;
  }
});
