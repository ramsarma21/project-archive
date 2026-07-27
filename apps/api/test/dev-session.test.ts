// Per-tab local test identity: the dev-session header, its store, and its lock-out.
//
// These hold the security contract of the two-tab local testing seam without a
// database, by driving the pure resolver and the in-memory store directly and by
// injecting the store into the local-session route:
//
//   * a valid dev header outranks the shared cookie in development;
//   * a missing / malformed / expired handle is NEVER accepted as another profile —
//     it falls through to the cookie, so it can only ever be the tab's own identity
//     (or none), never someone else's;
//   * production ignores the header entirely and mints no tab credential; and
//   * two independently minted handles map to two distinct sessions, so two tabs
//     stay apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

process.env.CSRF_SECRET = "test-secret-for-dev-session";

const {
  createDevSessionStore,
  resolveEffectiveSessionId,
  googleCallbackSuccessRedirect,
  DEV_SESSION_HEADER,
  DEV_SESSION_FRAGMENT_KEY,
  DEV_SESSION_TTL_MS,
} = await import("../src/devSession.js");
const { registerLocalSessionRoute } = await import("../src/routes/localSession.js");
import type { ProfileRow } from "../src/auth.js";

// ---- the pure resolver ------------------------------------------------------

test("a valid dev header outranks the shared cookie in development", () => {
  const sid = resolveEffectiveSessionId({
    cookieSessionId: "cookie-session",
    devHeader: "handle-A",
    enabled: true,
    resolveHandle: (h) => (h === "handle-A" ? "header-session" : undefined),
  });
  assert.equal(sid, "header-session", "the header identity wins over the cookie");
});

test("a missing dev header falls back to the cookie", () => {
  const sid = resolveEffectiveSessionId({
    cookieSessionId: "cookie-session",
    devHeader: undefined,
    enabled: true,
    resolveHandle: () => "should-not-be-used",
  });
  assert.equal(sid, "cookie-session");
});

test("an invalid or expired handle is not accepted as another profile", () => {
  // The handle resolves to nothing (unknown or expired). The resolver must NOT
  // invent an identity; it falls back to the caller's own cookie.
  const withCookie = resolveEffectiveSessionId({
    cookieSessionId: "my-own-cookie",
    devHeader: "bogus-handle",
    enabled: true,
    resolveHandle: () => undefined,
  });
  assert.equal(withCookie, "my-own-cookie", "an invalid handle cannot borrow a profile");

  // With no cookie either, an invalid handle leaves the caller unauthenticated —
  // never standing in as some other session.
  const withoutCookie = resolveEffectiveSessionId({
    cookieSessionId: undefined,
    devHeader: "bogus-handle",
    enabled: true,
    resolveHandle: () => undefined,
  });
  assert.equal(withoutCookie, undefined);
});

test("a blank dev header is ignored", () => {
  const sid = resolveEffectiveSessionId({
    cookieSessionId: "cookie-session",
    devHeader: "   ",
    enabled: true,
    resolveHandle: () => "header-session",
  });
  assert.equal(sid, "cookie-session");
});

test("production ignores the dev header and never resolves it", () => {
  let resolveCalls = 0;
  const sid = resolveEffectiveSessionId({
    cookieSessionId: "cookie-session",
    devHeader: "handle-A",
    enabled: false, // production
    resolveHandle: () => {
      resolveCalls += 1;
      return "header-session";
    },
  });
  assert.equal(sid, "cookie-session", "production authenticates by cookie only");
  assert.equal(resolveCalls, 0, "the handle store is not even consulted in production");
});

// ---- the in-memory store ----------------------------------------------------

test("the store maps a fresh handle to its session and back", () => {
  const store = createDevSessionStore();
  const handle = store.mint("session-xyz");
  assert.equal(typeof handle, "string");
  assert.ok(handle.length >= 20, "the handle is a long random token, not a counter");
  assert.equal(store.resolve(handle), "session-xyz");
});

test("two mints yield two distinct handles for two distinct sessions", () => {
  const store = createDevSessionStore();
  const a = store.mint("session-A");
  const b = store.mint("session-B");
  assert.notEqual(a, b);
  assert.equal(store.resolve(a), "session-A");
  assert.equal(store.resolve(b), "session-B");
});

test("a revoked handle no longer resolves", () => {
  const store = createDevSessionStore();
  const handle = store.mint("session-xyz");
  store.revoke(handle);
  assert.equal(store.resolve(handle), undefined);
});

test("an expired handle no longer resolves", () => {
  let now = 1_000_000;
  const store = createDevSessionStore(() => now);
  const handle = store.mint("session-xyz");
  assert.equal(store.resolve(handle), "session-xyz");
  now += DEV_SESSION_TTL_MS + 1;
  assert.equal(store.resolve(handle), undefined, "past its TTL a handle is gone");
});

// ---- the local-session route mints and returns a handle ---------------------

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const SEED = "a".repeat(64);

function fakeResolver() {
  const bySubject = new Map<string, ProfileRow>();
  return async (input: {
    localProfileId: string;
    displayName: string;
    seedHex: string;
  }): Promise<ProfileRow> => {
    const existing = bySubject.get(input.localProfileId);
    if (existing) return existing;
    const created: ProfileRow = {
      id: input.localProfileId,
      account_id: `acc-${input.localProfileId}`,
      display_name: input.displayName,
      variation_root_seed_hex: input.seedHex,
      onboarding_preferences: null,
      created_at: "2026-07-25T00:00:00.000Z",
    };
    bySubject.set(input.localProfileId, created);
    return created;
  };
}

async function harness(enabled: boolean) {
  const store = createDevSessionStore();
  let mints = 0;
  const app = Fastify({ logger: false });
  await app.register(cookie);
  registerLocalSessionRoute(app, {
    enabled,
    resolveProfile: fakeResolver(),
    createSession: async (profileId) => `sid-${profileId}`,
    mintDevSession: (sid) => {
      mints += 1;
      return store.mint(sid);
    },
  });
  await app.ready();
  return { app, store, mints: () => mints };
}

function login(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/local-session",
    headers: { "content-type": "application/json" },
    payload: body as object,
  });
}

test("a local login returns a dev-session handle mapped to its own session", async () => {
  const { app, store } = await harness(true);
  try {
    const res = await login(app, { profileId: UUID_A, displayName: "Ada", seedHex: SEED });
    assert.equal(res.statusCode, 200, res.body);
    const handle = res.json().devSession as string;
    assert.equal(typeof handle, "string");
    assert.equal(store.resolve(handle), `sid-${UUID_A}`, "the handle maps to this profile's session");
  } finally {
    await app.close();
  }
});

test("two local logins give two handles that resolve to two distinct profiles", async () => {
  const { app, store } = await harness(true);
  try {
    const a = (await login(app, { profileId: UUID_A, displayName: "Ada", seedHex: SEED })).json();
    const b = (await login(app, { profileId: UUID_B, displayName: "Bo", seedHex: SEED })).json();
    assert.notEqual(a.devSession, b.devSession, "each tab gets its own handle");

    // Simulate what each tab's request does: the header outranks a SHARED cookie
    // that (say) points at the other profile. Each tab still resolves to itself.
    const forA = resolveEffectiveSessionId({
      cookieSessionId: `sid-${UUID_B}`, // the shared cookie belongs to the other tab
      devHeader: a.devSession,
      enabled: true,
      resolveHandle: (h) => store.resolve(h),
    });
    const forB = resolveEffectiveSessionId({
      cookieSessionId: `sid-${UUID_A}`,
      devHeader: b.devSession,
      enabled: true,
      resolveHandle: (h) => store.resolve(h),
    });
    assert.equal(forA, `sid-${UUID_A}`, "tab A stays A despite a cookie for B");
    assert.equal(forB, `sid-${UUID_B}`, "tab B stays B despite a cookie for A");
  } finally {
    await app.close();
  }
});

test("production mints no handle and the route is absent", async () => {
  const { app, mints } = await harness(false);
  try {
    const res = await login(app, { profileId: UUID_A, displayName: "Ada", seedHex: SEED });
    assert.equal(res.statusCode, 404, "no anonymous session door in production");
    assert.equal(mints(), 0, "and no tab credential is ever minted");
  } finally {
    await app.close();
  }
});

test("the header carries the agreed name so the client and server agree", () => {
  assert.equal(DEV_SESSION_HEADER, "x-pa-dev-session");
});

// ---- the Google callback's dev/prod redirect split -------------------------
//
// The remaining flaw the two-tab flow hit: a Google sign-in only set the shared
// cookie, so a SECOND Google tab (or a Google tab beside a local one) fell back to
// whatever session was written last and read as "your own lobby". Outside production
// the callback now also mints a tab handle and delivers it in the URL FRAGMENT;
// production stays exactly cookie-only.

const ORIGIN = "http://localhost:5173";

test("dev callback mints a handle and delivers it in the URL fragment, tied to the session", () => {
  const store = createDevSessionStore();
  const url = googleCallbackSuccessRedirect({
    webOrigin: ORIGIN,
    sessionId: "google-session-1",
    mintDevSession: (sid) => store.mint(sid),
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, `${ORIGIN}/`);
  assert.equal(parsed.searchParams.get("auth"), "success");
  // The handle rides in the FRAGMENT, never the query — a fragment is not sent to a
  // server and not logged.
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  const handle = fragment.get(DEV_SESSION_FRAGMENT_KEY);
  assert.equal(typeof handle, "string");
  assert.ok((handle ?? "").length >= 20, "the fragment carries a long random handle");
  assert.equal(parsed.searchParams.get(DEV_SESSION_FRAGMENT_KEY), null, "never in the query");
  // And it resolves to THIS Google session, so the tab can carry its own identity.
  assert.equal(store.resolve(handle!), "google-session-1");
  // The handle is not the session id itself.
  assert.notEqual(handle, "google-session-1");
});

test("production callback stays cookie-only: no handle, no fragment, nothing minted", () => {
  const store = createDevSessionStore();
  let mints = 0;
  const url = googleCallbackSuccessRedirect({
    webOrigin: ORIGIN,
    sessionId: "google-session-prod",
    // Production passes no minter.
    mintDevSession: undefined,
  });
  assert.equal(url, `${ORIGIN}/?auth=success`, "exactly the cookie-only redirect");
  assert.equal(url.includes("#"), false, "no fragment is ever appended in production");
  // The store is untouched (no minter was even called).
  void store;
  assert.equal(mints, 0);
});

test("a dev callback handle outranks a shared cookie another Google tab overwrote", () => {
  // Two Google tabs: each callback mints its own handle. Even though the shared cookie
  // is whatever the LAST sign-in wrote, each tab's header resolves to its own session.
  const store = createDevSessionStore();
  const urlA = googleCallbackSuccessRedirect({
    webOrigin: ORIGIN,
    sessionId: "session-A",
    mintDevSession: (sid) => store.mint(sid),
  });
  const urlB = googleCallbackSuccessRedirect({
    webOrigin: ORIGIN,
    sessionId: "session-B",
    mintDevSession: (sid) => store.mint(sid),
  });
  const handleA = new URLSearchParams(new URL(urlA).hash.slice(1)).get(DEV_SESSION_FRAGMENT_KEY)!;
  const handleB = new URLSearchParams(new URL(urlB).hash.slice(1)).get(DEV_SESSION_FRAGMENT_KEY)!;
  assert.notEqual(handleA, handleB);

  // Tab A's request: shared cookie points at B (the most recent sign-in), header is A.
  const forA = resolveEffectiveSessionId({
    cookieSessionId: "session-B",
    devHeader: handleA,
    enabled: true,
    resolveHandle: (h) => store.resolve(h),
  });
  assert.equal(forA, "session-A", "tab A stays A despite a cookie for B");

  // An invalid/expired handle can never alias another profile: it falls to the cookie.
  const bogus = resolveEffectiveSessionId({
    cookieSessionId: "session-B",
    devHeader: "not-a-real-handle",
    enabled: true,
    resolveHandle: (h) => store.resolve(h),
  });
  assert.equal(bogus, "session-B", "a bogus handle borrows nothing; it is only the cookie");
});
