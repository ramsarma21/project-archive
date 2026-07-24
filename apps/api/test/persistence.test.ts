import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { PresenterEvent } from "@pa/contracts";
import { CHAPTER_ID, PACKAGE_ID } from "@pa/chapter-boston";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { csrfTokenForSession } from "../src/auth.js";
import { migrate, pool, query } from "../src/db.js";
import { expireRetainedResponses } from "../src/routes/assessments.js";

const accountId = crypto.randomUUID();
const profileId = crypto.randomUUID();
const otherAccountId = crypto.randomUUID();
const otherProfileId = crypto.randomUUID();
const sessionId = crypto.randomBytes(32).toString("base64url");
const seed = "55".repeat(32);
let app: FastifyInstance;

before(async () => {
  process.env.GRADING_ENABLED = "false";
  process.env.OPEN_RESPONSE_CONTENT_MODE = "AUTHOR_DRAFT_QA";
  process.env.GRADING_ENCRYPTION_KEY_BASE64 = crypto
    .randomBytes(32)
    .toString("base64");
  process.env.GRADING_ENCRYPTION_KEY_VERSION = "test-v1";
  process.env.CSRF_SECRET = "persistence-test-csrf";
  app = await buildApp();
  await query("insert into accounts(id) values ($1),($2)", [accountId, otherAccountId]);
  await query(
    `insert into profiles(id, account_id, display_name, variation_root_seed_hex)
     values ($1,$2,'AWS Test Runner',$3),($4,$5,'Other Runner',$3)`,
    [profileId, accountId, seed, otherProfileId, otherAccountId],
  );
  await query(
    `insert into access_sessions(id, profile_id, account_id, expires_at)
     values ($1,$2,$3,now() + interval '1 hour')`,
    [sessionId, profileId, accountId],
  );
});

after(async () => {
  await query("delete from accounts where id in ($1,$2)", [accountId, otherAccountId]);
  await app.close();
  await pool.end();
});

test("migrations are idempotent and checksummed", async () => {
  await migrate();
  await migrate();
  const rows = await query<{ count: string }>("select count(*)::text as count from schema_migrations");
  // 001 initial, 002 open responses, 003 content versions,
  // 004 presenter spatial snapshot (feel-audit-1 P0-11).
  assert.equal(rows.rows[0]?.count, "4");
});

test("owned saves materialize mastery atomically and reject conflicts", async () => {
  const cookie = `pa_session=${sessionId}`;
  const firstEvent: PresenterEvent = { type: "CONTINUE" };
  const record = {
    saveId: profileId,
    profileId,
    chapterId: CHAPTER_ID,
    packageId: PACKAGE_ID,
    variationRootSeedHex: seed,
    flowVersion: 5,
    committedEvents: [firstEvent],
    revision: 1,
    status: "IN_PROGRESS" as const,
    updatedAt: new Date().toISOString(),
    // Presenter spatial snapshot (feel-audit-1 P0-11): optional, replay-inert.
    presenterSpatial: {
      pos: [-140, 0, 4] as [number, number, number],
      yaw: 1.25,
      interiorId: null,
      locationId: "BOSTON_STREET",
    },
  };

  const saved = await app.inject({
    method: "PUT",
    url: `/v1/profiles/${profileId}/save`,
    headers: { cookie },
    payload: { baseRevision: 0, record },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const savedBody = saved.json();
  assert.equal(savedBody.revision, 1);
  assert.equal(savedBody.mastery.integrity.committedEventCount, 1);

  // The spatial snapshot round-trips through GET for cross-device resumes.
  const pulled = await app.inject({
    method: "GET",
    url: `/v1/profiles/${profileId}/save`,
    headers: { cookie },
  });
  assert.equal(pulled.statusCode, 200, pulled.body);
  assert.deepEqual(pulled.json().save.presenterSpatial, record.presenterSpatial);

  const mastery = await app.inject({
    method: "GET",
    url: `/v1/profiles/${profileId}/mastery`,
    headers: { cookie },
  });
  assert.equal(mastery.statusCode, 200, mastery.body);
  assert.equal(mastery.json().saveRevision, 1);
  assert.equal(mastery.json().mastery.profileId, profileId);

  const conflict = await app.inject({
    method: "PUT",
    url: `/v1/profiles/${profileId}/save`,
    headers: { cookie },
    payload: { baseRevision: 0, record },
  });
  assert.equal(conflict.statusCode, 409, conflict.body);

  const forbidden = await app.inject({
    method: "GET",
    url: `/v1/profiles/${otherProfileId}/save`,
    headers: { cookie },
  });
  assert.equal(forbidden.statusCode, 403, forbidden.body);
});

test("save identity, seed, and revision invariants are server-owned", async () => {
  const response = await app.inject({
    method: "PUT",
    url: `/v1/profiles/${profileId}/save`,
    headers: { cookie: `pa_session=${sessionId}` },
    payload: {
      baseRevision: 1,
      record: {
        saveId: profileId,
        profileId,
        chapterId: CHAPTER_ID,
        packageId: PACKAGE_ID,
        variationRootSeedHex: "aa".repeat(32),
        flowVersion: 5,
        committedEvents: [{ type: "CONTINUE" }],
        revision: 2,
        status: "IN_PROGRESS",
        updatedAt: new Date().toISOString(),
      },
    },
  });
  assert.equal(response.statusCode, 400, response.body);
});

test("an unregistered chapterId is a clean 400 from the chapter registry", async () => {
  const response = await app.inject({
    method: "PUT",
    url: `/v1/profiles/${profileId}/save`,
    headers: { cookie: `pa_session=${sessionId}` },
    payload: {
      baseRevision: 1,
      record: {
        saveId: profileId,
        profileId,
        chapterId: "PA.SEA01.CH99.PHILADELPHIA.v1",
        packageId: PACKAGE_ID,
        variationRootSeedHex: seed,
        flowVersion: 5,
        committedEvents: [{ type: "CONTINUE" }],
        revision: 2,
        status: "IN_PROGRESS",
        updatedAt: new Date().toISOString(),
      },
    },
  });
  assert.equal(response.statusCode, 400, response.body);
  assert.equal(JSON.parse(response.body).error, "SAVE_INVALID");
});

test("open responses are encrypted, CSRF-protected, idempotent, and profile-scoped", async () => {
  const cookie = `pa_session=${sessionId}`;
  const csrf = csrfTokenForSession(sessionId);
  const attemptId = `BOS.ACT01.${profileId}`;
  const payload = {
    promptId: "BOS.ACT01.PROMPT.REVENUE_VS_MARKET",
    promptVersion: "v1",
    responseText:
      "The proclamation states the Crown's revenue purpose, while Thomas shows that harbor delays raise shop prices and cost workers wages. One gives the official reason and the other gives a local economic effect.",
    composition: {
      claimId: "CLAIM.COMPARE.COST",
      evidenceIds: ["SRC.CROWN_PROCLAMATION", "SRC.THOMAS_TRADE"],
      learnerLine:
        "The proclamation states the Crown's revenue purpose, while Thomas shows that harbor delays raise shop prices and cost workers wages. One gives the official reason and the other gives a local economic effect.",
    },
    idempotencyKey: "assessment-idempotency-1",
    consent: {
      granted: true,
      policyVersion: "PA.FORMATIVE.PRIVACY.v1",
      retainedForEducatorReview: true,
      retentionDays: 30,
    },
  };

  const noCsrf = await app.inject({
    method: "POST",
    url: `/v1/profiles/${profileId}/assessments/${attemptId}/responses`,
    headers: { cookie },
    payload,
  });
  assert.equal(noCsrf.statusCode, 403);

  const first = await app.inject({
    method: "POST",
    url: `/v1/profiles/${profileId}/assessments/${attemptId}/responses`,
    headers: { cookie, "x-pa-csrf-token": csrf },
    payload,
  });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().resolution.status, "AUTHORED_FALLBACK");

  const replay = await app.inject({
    method: "POST",
    url: `/v1/profiles/${profileId}/assessments/${attemptId}/responses`,
    headers: { cookie, "x-pa-csrf-token": csrf },
    payload,
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(
    replay.json().response.responseId,
    first.json().response.responseId,
  );
  const stored = await query<{
    count: string;
    plaintext_found: boolean;
  }>(
    `select count(*)::text as count,
            bool_or(encode(ciphertext, 'escape') like '%proclamation%') as plaintext_found
       from open_responses
      where profile_id=$1`,
    [profileId],
  );
  assert.equal(stored.rows[0]?.count, "1");
  assert.equal(stored.rows[0]?.plaintext_found, false);

  const forbidden = await app.inject({
    method: "GET",
    url: `/v1/profiles/${otherProfileId}/formative-evidence`,
    headers: { cookie },
  });
  assert.equal(forbidden.statusCode, 403);

  await query(
    "update open_responses set retention_deadline=now() - interval '1 second' where id=$1",
    [first.json().response.responseId],
  );
  assert.equal(await expireRetainedResponses(), 1);
  const remaining = await query<{ count: string }>(
    "select count(*)::text as count from open_responses where profile_id=$1",
    [profileId],
  );
  assert.equal(remaining.rows[0]?.count, "0");
});
