// POST /v1/auth/local-session — a server session for a local development profile.
//
// The route is what makes a local build ranked and gradable instead of signed-out
// and unlimited. These tests hold its contract without a database, by injecting the
// profile resolver and the session minter (the same seam the PvP and duel routes
// use):
//
//   * it is ABSENT in production — a 404, no anonymous session door on a deployed
//     task;
//   * it validates a real UUID, a bounded non-blank name and a 64-hex seed;
//   * a relogin returns the STORED seed, never the one the second login submitted —
//     the first write is the authority, so a client cannot rotate its own seed; and
//   * a successful login mints the normal session shape and sets the cookie.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

process.env.CSRF_SECRET = "test-secret-for-local-session";

const { registerLocalSessionRoute } = await import("../src/routes/localSession.js");
import type { ProfileRow } from "../src/auth.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const SEED = "a".repeat(64);

/** A first-write-wins profile store, mirroring resolveLocalDevProfile's semantics. */
function fakeResolver() {
  const bySubject = new Map<string, ProfileRow>();
  const calls: { localProfileId: string; displayName: string; seedHex: string }[] = [];
  return {
    calls,
    resolveProfile: async (input: {
      localProfileId: string;
      displayName: string;
      seedHex: string;
    }): Promise<ProfileRow> => {
      calls.push(input);
      const existing = bySubject.get(input.localProfileId);
      if (existing) return existing; // stored authority: submitted name/seed ignored
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
    },
  };
}

async function harness(enabled: boolean) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const resolver = fakeResolver();
  let minted = 0;
  registerLocalSessionRoute(app, {
    enabled,
    resolveProfile: resolver.resolveProfile,
    createSession: async () => `session-${(minted += 1)}`,
  });
  await app.ready();
  return { app, resolver };
}

function login(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/local-session",
    headers: { "content-type": "application/json" },
    payload: body as object,
  });
}

test("the endpoint is absent (404) when disabled, as it is in production", async () => {
  const { app } = await harness(false);
  try {
    const res = await login(app, { profileId: UUID, displayName: "Ada", seedHex: SEED });
    assert.equal(res.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("a malformed local login is refused", async () => {
  const { app } = await harness(true);
  try {
    for (const body of [
      { profileId: "not-a-uuid", displayName: "Ada", seedHex: SEED },
      { profileId: UUID, displayName: "   ", seedHex: SEED },
      { profileId: UUID, displayName: "Ada", seedHex: "xyz" },
      { profileId: UUID, displayName: "Ada", seedHex: "A".repeat(64) }, // uppercase hex
      { profileId: UUID, displayName: "Ada", seedHex: SEED, role: "admin" }, // extra field
      { profileId: UUID, displayName: "x".repeat(81), seedHex: SEED },
    ]) {
      const res = await login(app, body);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.json().error, "BAD_REQUEST");
    }
  } finally {
    await app.close();
  }
});

test("a successful login mints the normal session shape and sets the cookie", async () => {
  const { app } = await harness(true);
  try {
    const res = await login(app, { profileId: UUID, displayName: "Ada", seedHex: SEED });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.authenticated, true);
    assert.equal(typeof body.csrfToken, "string");
    assert.equal(body.profile.profileId, UUID, "the profile keeps the browser's own id");
    assert.equal(body.profile.displayName, "Ada");
    assert.equal(body.profile.variationRootSeedHex, SEED);
    assert.ok(
      String(res.headers["set-cookie"] ?? "").includes("pa_session="),
      "the session cookie is set",
    );
  } finally {
    await app.close();
  }
});

test("a relogin returns the stored seed, never the one the second login submits", async () => {
  const { app, resolver } = await harness(true);
  try {
    const first = await login(app, { profileId: UUID, displayName: "Ada", seedHex: SEED });
    assert.equal(first.json().profile.variationRootSeedHex, SEED);

    // The same profile logs in again claiming a DIFFERENT seed and name.
    const otherSeed = "b".repeat(64);
    const second = await login(app, {
      profileId: UUID,
      displayName: "Impostor",
      seedHex: otherSeed,
    });
    assert.equal(second.statusCode, 200);
    assert.equal(
      second.json().profile.variationRootSeedHex,
      SEED,
      "the stored seed is authority; a resubmitted seed cannot replace it",
    );
    assert.equal(second.json().profile.displayName, "Ada", "and the stored name stands");
    assert.equal(resolver.calls.length, 2, "both logins reached the resolver");
  } finally {
    await app.close();
  }
});
