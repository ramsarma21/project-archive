// The dev-only mission reset: the service invariant and the endpoint's gates.
//
// The reset erases progression, so the tests that matter most are the ones that
// prove it CANNOT fire where it must not:
//
//   * it is a 404 when NODE_ENV === "production";
//   * it refuses an unauthenticated caller, and cannot be pointed at a profile
//     other than the session's own; and
//   * it refuses without a valid CSRF token.
//
// And the two behavioural invariants:
//
//   * the module gate (`learning_module_completions`) survives, and a fresh attempt
//     can still be opened afterwards — the trap that would otherwise lock a player
//     out of the run they reset to test; and
//   * attempts and progress genuinely return to UNSTARTED / 0.
//
// Driven through the in-memory store and an injected session resolver, so no
// database is needed — the same seam local-session.test.ts and the duel route
// tests use.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import {
  LEARNING_MODULE_SECONDS,
  type CampaignProgression,
  type ChapterProgression,
} from "@pa/contracts";

process.env.CSRF_SECRET = "test-secret-for-dev-reset";

const { ProgressionService } = await import("../src/progression/service.js");
const { registerDevResetRoute } = await import("../src/routes/devReset.js");
const { MemoryStore } = await import("./support/memoryProgressionStore.js");
const { csrfTokenForSession } = await import("../src/auth.js");
import type { ProgressionContent } from "../src/progression/content.js";

const CHAPTER = "boston-1765";
const MISSION = "PA.SEA01.CH02.BOSTON.MD01";
const MODULE = "MOD.M1.TEST";
const DECK = ["CUE.1", "CUE.2", "CUE.3"] as const;
const SEED = "a".repeat(64);

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function testContent(): ProgressionContent {
  return {
    initialChapterId: () => CHAPTER,
    xpCurve: () => ({
      curveId: "TEST.CURVE",
      version: "1",
      levelThresholds: Array.from({ length: 40 }, (_, i) => (i + 1) * 100),
    }),
    missionReward: (chapterId, missionId) =>
      missionId === MISSION
        ? { missionId: MISSION, chapterId, baseXp: 900, moduleId: MODULE, conceptIds: [] }
        : null,
    abilityMilestones: () => [],
    chapterConceptIds: () => [],
    assessmentId: () => null,
    assessmentModuleId: () => null,
    itemReserve: () => [],
    itemConcept: () => null,
    itemFormat: () => null,
    isCorrectOption: () => false,
    moduleDeckCueIds: () => [...DECK],
    moduleRequiredCheckIds: () => [],
    codexCardsForModule: () => [],
    codexCardsForConcept: () => [],
    conceptForCard: () => null,
  };
}

type Store = InstanceType<typeof MemoryStore>;
type Service = InstanceType<typeof ProgressionService>;

function build(): { store: Store; service: Service } {
  const store = new MemoryStore();
  let ids = 0;
  let clock = Date.parse("2026-07-28T00:00:00.000Z");
  const service = new ProgressionService(
    store,
    testContent(),
    () => new Date((clock += 1000)),
    () => {
      ids += 1;
      return `00000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
    },
  );
  return { store, service };
}

/** Play one attempt to a FAILED close: module → open → commit FAILED. */
async function playFailedAttempt(service: Service, profileId: string): Promise<void> {
  const module = await service.completeLearningModule(profileId, {
    chapterId: CHAPTER,
    moduleId: MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: MISSION,
    acknowledgedCueIds: [...DECK],
    observedSeconds: LEARNING_MODULE_SECONDS,
  });
  assert.equal(module.ok, true, "module gate recorded");
  const opened = await service.openMissionAttempt(
    profileId,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.equal(opened.ok, true, "attempt opened");
  if (!opened.ok) throw new Error("attempt did not open");
  const committed = await service.commitMissionOutcome(profileId, {
    attemptId: opened.value.attemptId,
    outcome: "FAILED",
    committedEvents: [],
    baseRevision: 0,
  });
  assert.equal(committed.ok, true, "attempt committed FAILED");
}

/** Burn all three attempts so the mission is FAILED_PERMANENT, attempts_used=3. */
async function spendMission(service: Service, profileId: string): Promise<void> {
  await playFailedAttempt(service, profileId);
  await playFailedAttempt(service, profileId);
  await playFailedAttempt(service, profileId);
}

// ---------------------------------------------------------------------------
// Service invariants
// ---------------------------------------------------------------------------

test("reset returns the mission to UNSTARTED / 0 and removes the attempt rows", async () => {
  const { store, service } = build();
  await spendMission(service, ALICE);

  // Precondition: spent.
  const before = store.missions.get(`${ALICE}:${CHAPTER}:${MISSION}`);
  assert.equal(before?.attemptsUsed, 3);
  assert.equal(before?.outcome, "FAILED_PERMANENT");
  assert.equal(
    [...store.missionAttempts.values()].filter((a) => a.profileId === ALICE).length,
    3,
  );

  const result = await service.resetMissionAttempts(ALICE, {
    chapterId: CHAPTER,
    missionId: MISSION,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("reset failed");
  assert.equal(result.value.mission.attemptsUsed, 0);
  assert.equal(result.value.mission.outcome, "UNSTARTED");
  assert.equal(result.value.mission.awardedXp, 0);
  assert.equal(result.value.deletedAttempts, 3);

  const after = store.missions.get(`${ALICE}:${CHAPTER}:${MISSION}`);
  assert.equal(after?.attemptsUsed, 0);
  assert.equal(after?.outcome, "UNSTARTED");
  assert.equal(after?.failedAt, null);
  assert.equal(
    [...store.missionAttempts.values()].filter((a) => a.profileId === ALICE).length,
    0,
    "every attempt row for the mission is gone",
  );
});

test("reset PRESERVES the module gate, and a fresh attempt opens without re-running it", async () => {
  const { store, service } = build();
  await spendMission(service, ALICE);

  // The gate rows exist for ordinals 1..3 before the reset.
  const gateKeys = () =>
    [...store.modules.keys()].filter((k) =>
      k.startsWith(`${ALICE}:${CHAPTER}:MISSION_ATTEMPT:${MISSION}:`),
    );
  assert.equal(gateKeys().length, 3, "three module completions before reset");

  const result = await service.resetMissionAttempts(ALICE, {
    chapterId: CHAPTER,
    missionId: MISSION,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("reset failed");
  // The invariant, asserted from the reported ordinals AND from the store.
  assert.deepEqual(result.value.moduleGateOrdinalsPreserved, [1, 2, 3]);
  assert.equal(gateKeys().length, 3, "the module gate survived the reset");

  // The whole point: attempt one opens again WITHOUT recording the module again,
  // because the ordinal-1 completion the duel's canonical requirement needs is
  // still there. If the gate had been wiped this would be MODULE_REQUIRED.
  const opened = await service.openMissionAttempt(
    ALICE,
    { chapterId: CHAPTER, missionId: MISSION },
    SEED,
  );
  assert.equal(opened.ok, true, "a fresh attempt opens on the preserved gate");
  if (!opened.ok) throw new Error("attempt did not open");
  assert.equal(opened.value.attemptOrdinal, 1, "and it is a clean attempt one");
});

test("reset refuses an unknown mission and leaves state untouched", async () => {
  const { service } = build();
  await spendMission(service, ALICE);
  const result = await service.resetMissionAttempts(ALICE, {
    chapterId: CHAPTER,
    missionId: "PA.SEA01.CH02.BOSTON.MD99",
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected refusal");
  assert.equal(result.error, "PACKAGE_MISSING");
});

// ---------------------------------------------------------------------------
// Endpoint gates
// ---------------------------------------------------------------------------

interface HarnessOptions {
  enabled?: boolean;
  /** cookie session id -> profile id. */
  sessions?: Record<string, string>;
}

async function routeHarness(service: Service, options: HarnessOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const sessions = options.sessions ?? {};
  registerDevResetRoute(app, {
    service,
    enabled: options.enabled,
    authenticate: async (sid) => (sid && sessions[sid] ? { profileId: sessions[sid] } : null),
    defaultChapterId: CHAPTER,
    defaultMissionId: MISSION,
    allowedOrigin: "http://localhost:5173",
  });
  await app.ready();
  return app;
}

function post(
  app: FastifyInstance,
  opts: { sid?: string; csrf?: string; body?: unknown; origin?: string },
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.csrf !== undefined) headers["x-pa-csrf-token"] = opts.csrf;
  if (opts.origin !== undefined) headers.origin = opts.origin;
  return app.inject({
    method: "POST",
    url: "/v1/dev/reset-mission",
    headers,
    cookies: opts.sid ? { pa_session: opts.sid } : {},
    payload: (opts.body ?? {}) as object,
  });
}

test("SECURITY: the endpoint is a 404 when NODE_ENV === 'production'", async () => {
  const { service } = build();
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    // enabled omitted, so the route reads NODE_ENV — and refuses outright.
    const app = await routeHarness(service, { sessions: { s1: ALICE } });
    try {
      const res = await post(app, { sid: "s1", csrf: csrfTokenForSession("s1") });
      assert.equal(res.statusCode, 404, res.body);
      assert.equal(res.json().error, "NOT_FOUND");
    } finally {
      await app.close();
    }
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
});

test("SECURITY: an unauthenticated caller is refused (401)", async () => {
  const { service } = build();
  const app = await routeHarness(service, { enabled: true, sessions: {} });
  try {
    const res = await post(app, { sid: "no-such-session", csrf: "whatever" });
    assert.equal(res.statusCode, 401, res.body);
    assert.equal(res.json().error, "AUTH_REQUIRED");
  } finally {
    await app.close();
  }
});

test("SECURITY: a caller cannot name a profile other than the session's own", async () => {
  const { store, service } = build();
  await spendMission(service, ALICE);
  await spendMission(service, BOB);
  const app = await routeHarness(service, {
    enabled: true,
    sessions: { alice: ALICE },
  });
  try {
    // A smuggled profileId is not merely ignored — the strict schema makes it a 400.
    const smuggled = await post(app, {
      sid: "alice",
      csrf: csrfTokenForSession("alice"),
      body: { profileId: BOB },
    });
    assert.equal(smuggled.statusCode, 400, smuggled.body);
    assert.equal(smuggled.json().error, "BAD_REQUEST");

    // And behaviourally: Alice's own reset never reaches into Bob's progression.
    const own = await post(app, { sid: "alice", csrf: csrfTokenForSession("alice") });
    assert.equal(own.statusCode, 200, own.body);
    assert.equal(store.missions.get(`${ALICE}:${CHAPTER}:${MISSION}`)?.attemptsUsed, 0);
    assert.equal(
      store.missions.get(`${BOB}:${CHAPTER}:${MISSION}`)?.attemptsUsed,
      3,
      "Bob's progression is untouched by Alice's reset",
    );
    assert.equal(store.missions.get(`${BOB}:${CHAPTER}:${MISSION}`)?.outcome, "FAILED_PERMANENT");
  } finally {
    await app.close();
  }
});

test("SECURITY: a missing or invalid CSRF token is refused (403)", async () => {
  const { service } = build();
  await spendMission(service, ALICE);
  const app = await routeHarness(service, {
    enabled: true,
    sessions: { alice: ALICE },
  });
  try {
    const missing = await post(app, { sid: "alice" });
    assert.equal(missing.statusCode, 403, missing.body);
    assert.equal(missing.json().error, "CSRF_INVALID");

    // A token minted for a DIFFERENT session does not authorise this one.
    const wrong = await post(app, { sid: "alice", csrf: csrfTokenForSession("someone-else") });
    assert.equal(wrong.statusCode, 403, wrong.body);
  } finally {
    await app.close();
  }
});

test("SECURITY: a cross-origin request is refused even with a valid CSRF token (same-origin gate)", async () => {
  // GATE 3 is CSRF *and same origin*. The CSRF-token half is covered above; this
  // pins the same-origin half, which nothing else in CI exercised — dropping the
  // origin comparison in `validAssessmentMutationRequest` left the whole suite green.
  // A foreign Origin header with an otherwise-valid token must still be a 403, so a
  // page on another origin cannot drive a reset by replaying a token it should not
  // have but the check must not depend on it having failed to.
  const { store, service } = build();
  await spendMission(service, ALICE);
  const app = await routeHarness(service, { enabled: true, sessions: { alice: ALICE } });
  try {
    const foreign = await post(app, {
      sid: "alice",
      csrf: csrfTokenForSession("alice"),
      origin: "http://evil.example",
    });
    assert.equal(foreign.statusCode, 403, foreign.body);
    assert.equal(foreign.json().error, "CSRF_INVALID");
    // The reset did not fire: Alice's spent mission is untouched.
    assert.equal(store.missions.get(`${ALICE}:${CHAPTER}:${MISSION}`)?.attemptsUsed, 3);

    // And the allowed origin, with the same token, is accepted — so the gate is a
    // real discriminator on origin, not a blanket refusal that would pass vacuously.
    const same = await post(app, {
      sid: "alice",
      csrf: csrfTokenForSession("alice"),
      origin: "http://localhost:5173",
    });
    assert.equal(same.statusCode, 200, same.body);
  } finally {
    await app.close();
  }
});

test("the happy path resets and returns the resulting progression to confirm", async () => {
  const { service } = build();
  await spendMission(service, ALICE);
  const app = await routeHarness(service, {
    enabled: true,
    sessions: { alice: ALICE },
  });
  try {
    const res = await post(app, { sid: "alice", csrf: csrfTokenForSession("alice") });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.reset.deletedAttempts, 3);
    assert.deepEqual(body.reset.moduleGateOrdinalsPreserved, [1, 2, 3]);
    // The returned snapshot lets the caller CONFIRM rather than assume.
    const m1 = body.progression.missions.find((m: { missionId: string }) => m.missionId === MISSION);
    assert.equal(m1.attemptsUsed, 0);
    assert.equal(m1.outcome, "UNSTARTED");
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// The double's snapshot scoping — pinned directly against the leak
// ---------------------------------------------------------------------------
//
// The dev-reset tests above lean on MemoryStore being multi-profile safe. That
// safety is only as good as `snapshot()`'s scoping, and four collections — codex,
// the PvP loadout, chapter abilities and concept mastery — once returned EVERY
// profile's and EVERY chapter's rows regardless of the argument. Postgres scopes
// codex and the PvP loadout by profile, and chapter abilities and concept mastery
// by profile AND the active chapter; these tests pin the double to match, so a
// future two-profile test cannot pass on data it never wrote.

const SNAP_ACTIVE = "CH.ONE";
const SNAP_OTHER = "CH.TWO";
const SNAP_AT = "2026-07-28T00:00:00.000Z";

function snapCampaign(profileId: string): CampaignProgression {
  return {
    profileId,
    modelVersion: 1,
    rank: 1,
    cumulativeLevels: 0,
    activeChapterId: SNAP_ACTIVE,
    revision: 0,
    createdAt: SNAP_AT,
    updatedAt: SNAP_AT,
  };
}

function snapChapter(profileId: string, chapterId: string): ChapterProgression {
  return {
    profileId,
    chapterId,
    level: 0,
    xp: 0,
    levelsAtChapterStart: 0,
    status: "ACTIVE",
    assessmentPassedAt: null,
    startedAt: SNAP_AT,
    completedAt: null,
    updatedAt: SNAP_AT,
  };
}

// Seed one profile with rows in BOTH the active chapter and another chapter, so
// snapshot must discriminate on chapter as well as on profile.
async function seedForSnapshot(store: Store, profileId: string, tag: string): Promise<void> {
  await store.transact(profileId, async (tx) => {
    await tx.putCampaign(snapCampaign(profileId));
    await tx.putChapter(snapChapter(profileId, SNAP_ACTIVE));
    await tx.putChapter(snapChapter(profileId, SNAP_OTHER));

    await tx.learnCodexCard({
      profileId,
      cardId: `CARD.${tag}`,
      conceptId: `C.${tag}`,
      learnedChapterId: SNAP_ACTIVE,
      learnedAt: SNAP_AT,
    });

    await tx.unlockChapterAbility({
      profileId,
      chapterId: SNAP_ACTIVE,
      abilityId: `AB.${tag}.ACTIVE`,
      unlockedAtLevel: 1,
      unlockedAt: SNAP_AT,
    });
    await tx.unlockChapterAbility({
      profileId,
      chapterId: SNAP_OTHER,
      abilityId: `AB.${tag}.OTHER`,
      unlockedAtLevel: 1,
      unlockedAt: SNAP_AT,
    });

    await tx.unlockPvpAbility({
      profileId,
      abilityId: `PVP.${tag}`,
      firstUnlockedChapterId: SNAP_ACTIVE,
      firstUnlockedAtLevel: 1,
      firstUnlockedAt: SNAP_AT,
    });

    const mastery = (chapterId: string, conceptId: string) => ({
      profileId,
      chapterId,
      conceptId,
      itemsServed: 6,
      itemsCorrect: 6,
      firstAttemptServed: 6,
      firstAttemptCorrect: 6,
      masteredAt: SNAP_AT,
      updatedAt: SNAP_AT,
    });
    await tx.putConceptMastery(mastery(SNAP_ACTIVE, `C.${tag}.ACTIVE`), {
      masteredOnAttempt: 1,
      masteredWithRecycledItems: false,
    });
    await tx.putConceptMastery(mastery(SNAP_OTHER, `C.${tag}.OTHER`), {
      masteredOnAttempt: 1,
      masteredWithRecycledItems: false,
    });
  });
}

test("SCOPING: snapshot scopes codex and the PvP loadout by profile — never another profile's", async () => {
  const store = new MemoryStore();
  await seedForSnapshot(store, ALICE, "A");
  await seedForSnapshot(store, BOB, "B");

  const snap = await store.snapshot(ALICE);
  assert.ok(snap, "Alice has a snapshot");
  if (!snap) throw new Error("no snapshot");

  assert.deepEqual(
    snap.codex.map((c) => c.cardId),
    ["CARD.A"],
    "codex is Alice's alone; Bob's card must not leak in",
  );
  assert.deepEqual(
    snap.pvpAbilities.map((p) => p.abilityId),
    ["PVP.A"],
    "the PvP loadout is Alice's alone",
  );
  for (const card of snap.codex) assert.equal(card.profileId, ALICE);
  for (const ability of snap.pvpAbilities) assert.equal(ability.profileId, ALICE);
});

test("SCOPING: snapshot scopes chapter abilities and concept mastery by profile AND active chapter", async () => {
  const store = new MemoryStore();
  await seedForSnapshot(store, ALICE, "A");
  await seedForSnapshot(store, BOB, "B");

  const snap = await store.snapshot(ALICE);
  assert.ok(snap, "Alice has a snapshot");
  if (!snap) throw new Error("no snapshot");

  // Only Alice's rows, and only for the active chapter — the OTHER chapter's
  // rows, though Alice's own, are not part of the active snapshot.
  assert.deepEqual(
    snap.chapterAbilities.map((a) => a.abilityId),
    ["AB.A.ACTIVE"],
    "chapter abilities exclude the other chapter and the other profile",
  );
  assert.deepEqual(
    snap.conceptMastery.map((m) => m.conceptId),
    ["C.A.ACTIVE"],
    "concept mastery excludes the other chapter and the other profile",
  );
  for (const ability of snap.chapterAbilities) {
    assert.equal(ability.profileId, ALICE);
    assert.equal(ability.chapterId, SNAP_ACTIVE);
  }
  for (const mastery of snap.conceptMastery) {
    assert.equal(mastery.profileId, ALICE);
    assert.equal(mastery.chapterId, SNAP_ACTIVE);
  }
});

test("SCOPING: each profile's snapshot is symmetric — Bob sees only Bob", async () => {
  const store = new MemoryStore();
  await seedForSnapshot(store, ALICE, "A");
  await seedForSnapshot(store, BOB, "B");

  const snap = await store.snapshot(BOB);
  assert.ok(snap, "Bob has a snapshot");
  if (!snap) throw new Error("no snapshot");

  assert.deepEqual(snap.codex.map((c) => c.cardId), ["CARD.B"]);
  assert.deepEqual(snap.pvpAbilities.map((p) => p.abilityId), ["PVP.B"]);
  assert.deepEqual(snap.chapterAbilities.map((a) => a.abilityId), ["AB.B.ACTIVE"]);
  assert.deepEqual(snap.conceptMastery.map((m) => m.conceptId), ["C.B.ACTIVE"]);
});
