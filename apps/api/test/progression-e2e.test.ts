import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import {
  BOSTON_ABILITY_MILESTONES,
  levelFor,
  missionAward,
  missionBaseXp,
} from "@pa/abilities";
import type { MissionAttempt, ProgressionSnapshot } from "@pa/contracts";
import { m1DuelId } from "@pa/mission-m1";
import { buildApp } from "../src/app.js";
import { csrfTokenForSession } from "../src/auth.js";
import { pool, query } from "../src/db.js";
import {
  BOSTON_RUNTIME_CHAPTER_ID,
  M1_MISSION_ID,
  M1_MODULE_ID,
  bostonProgressionContent,
} from "../src/progression/content.js";
import { postgresConceptRetrievalStore } from "../src/progression/retrievalStore.js";

// ===========================================================================
// Clearing Mission 1 pays XP, and the payout survives a reload.
//
// Every layer below the route is already covered without a database
// (progression.test.ts drives the service against an in-memory store). What
// this file exercises is the join those tests cannot see: the real routes, the
// real Postgres rows, the real request contract, and the authored content pack
// the server is actually constructed with. The bug it exists to catch is the
// one that made every commit answer PACKAGE_MISSING — a server wired to an
// empty pack, with a green unit suite either side of it.
//
// Nothing here asserts a magic number. The expected award and Level come from
// @pa/abilities, so this proves the server pays THE AUTHORED CURVE rather than
// proving it pays 120.
// ===========================================================================

const M1 = M1_MISSION_ID;
const M1_MODULE = M1_MODULE_ID;
// The deck and checks the runner acknowledges are the SERVER's own gate, not a
// fourth hand-copy of content/m1/module.json. content.ts is pinned to the authored
// file by module-deck-parity.test.ts, so deriving the request payload from it keeps
// this e2e a test of the HTTP/Postgres join rather than a place the deck can drift.
const CONTENT = bostonProgressionContent();
const M1_DECK = CONTENT.moduleDeckCueIds(M1_MODULE) ?? [];
/** The mastery checks the module gates the three concept cards behind. */
const M1_CHECKS = CONTENT.moduleRequiredCheckIds(M1_MODULE);

/** @pa/duel's log, which names a verdict on every round the server minted. */
const DUEL_LOG = [
  { type: "DUEL_STARTED", seed: 7, rounds: 6, mode: "BOSS" },
  { type: "VERDICT_COMMITTED", round: 1, side: "A", verdict: { kind: "CORRECT" } },
  { type: "VERDICT_COMMITTED", round: 2, side: "A", verdict: { kind: "WRONG" } },
];

const seed = "7c".repeat(32);
/** One account per runner: a profile is unique per account. Torn down after. */
const accountIds: string[] = [];
let app: FastifyInstance;

interface Runner {
  profileId: string;
  cookie: string;
  csrf: string;
}

/** A signed-in profile with nothing durable behind it yet. */
async function newRunner(name: string): Promise<Runner> {
  const accountId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const sessionId = crypto.randomBytes(32).toString("base64url");
  accountIds.push(accountId);
  await query("insert into accounts(id) values ($1)", [accountId]);
  await query(
    `insert into profiles(id, account_id, display_name, variation_root_seed_hex)
     values ($1,$2,$3,$4)`,
    [profileId, accountId, name, seed],
  );
  await query(
    `insert into access_sessions(id, profile_id, account_id, expires_at)
     values ($1,$2,$3,now() + interval '1 hour')`,
    [sessionId, profileId, accountId],
  );
  return {
    profileId,
    cookie: `pa_session=${sessionId}`,
    csrf: csrfTokenForSession(sessionId),
  };
}

function post(runner: Runner, path: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url: `/v1/profiles/${runner.profileId}/progression/${path}`,
    headers: {
      cookie: runner.cookie,
      "x-pa-csrf-token": runner.csrf,
      origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    },
    payload: payload as Record<string, unknown>,
  });
}

/** The read the hub does on load, and again on every reload. */
async function pull(runner: Runner): Promise<ProgressionSnapshot> {
  const response = await app.inject({
    method: "GET",
    url: `/v1/profiles/${runner.profileId}/progression`,
    headers: { cookie: runner.cookie },
  });
  assert.equal(response.statusCode, 200);
  return (response.json() as { progression: ProgressionSnapshot }).progression;
}

/** The module, then the attempt. Exactly what `authorizeAttempt` does. */
async function authorize(
  runner: Runner,
  deck: readonly string[] = M1_DECK,
): Promise<MissionAttempt> {
  const module = await post(runner, "modules", {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    moduleId: M1_MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: M1,
    acknowledgedCueIds: [...deck],
    acknowledgedCheckIds: [...M1_CHECKS],
    observedSeconds: 174,
  });
  assert.equal(module.statusCode, 200, module.body);
  const opened = await post(runner, "mission-attempts", {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    missionId: M1,
  });
  assert.equal(opened.statusCode, 200, opened.body);
  return opened.json() as MissionAttempt;
}

before(async () => {
  process.env.CSRF_SECRET = "progression-e2e-csrf";
  // The duel's verdict-signing key. `buildApp` refuses to start without one, on
  // purpose: a deployed task that cannot sign a verdict was failing on a student's
  // first answer instead of failing the deploy. Set here rather than relied upon
  // from a `.env`, because CI has no `.env` and the point is that boot is strict.
  process.env.GRADING_RECEIPT_SECRET = "progression-e2e-verdict-receipt";
  app = await buildApp();
});

after(async () => {
  // Cascades through profiles, sessions and every progression row they own.
  if (accountIds.length > 0) {
    await query("delete from accounts where id = any($1::uuid[])", [accountIds]);
  }
  await app.close();
  await pool.end();
});

test("a new runner starts in Boston at Level 0, 0 XP, Rank 1", async () => {
  const runner = await newRunner("Fresh Runner");
  const snapshot = await pull(runner);
  assert.equal(snapshot.campaign.activeChapterId, BOSTON_RUNTIME_CHAPTER_ID);
  assert.equal(snapshot.campaign.rank, 1);
  assert.equal(snapshot.activeChapter.level, 0);
  assert.equal(snapshot.activeChapter.xp, 0);
  // The curve is authored now, so the hub has a real next-Level target to draw.
  assert.ok(
    snapshot.derived.xpToNextLevel !== null && snapshot.derived.xpToNextLevel > 0,
    "an unpriced chapter reports null here, which is what the empty pack did",
  );
});

test("clearing M1 pays the authored award, and it survives a reload", async () => {
  const runner = await newRunner("Clearing Runner");
  const attempt = await authorize(runner);
  assert.equal(attempt.attemptOrdinal, 1);
  assert.deepEqual(attempt.xpFraction, { numerator: 3, denominator: 3 });

  const committed = await post(runner, "mission-outcomes", {
    attemptId: attempt.attemptId,
    outcome: "CLEARED",
    // Carried with its verdicts. Before the contract exempted the log, this
    // body was rejected outright and the client dropped the log to save the
    // clear; a 400 here means the guard has closed over the server's own
    // telemetry again.
    committedEvents: DUEL_LOG,
    baseRevision: 0,
  });
  assert.equal(committed.statusCode, 200, committed.body);
  const paid = committed.json() as {
    awardedXp: number;
    levelsGained: number;
    unlockedAbilityIds: string[];
    chapter: { level: number; xp: number };
  };

  const expected = missionAward(1, 1);
  assert.equal(paid.awardedXp, expected, "the first mission's authored base award");
  assert.equal(paid.awardedXp, missionBaseXp(1), "paid in full on attempt 1");
  assert.equal(paid.chapter.xp, expected);
  assert.equal(paid.chapter.level, levelFor(expected), "the authored curve's Level");
  assert.equal(paid.levelsGained, levelFor(expected));

  // Reload. Nothing about this read is the client's memory of what happened.
  const reloaded = await pull(runner);
  assert.equal(reloaded.activeChapter.xp, expected);
  assert.equal(reloaded.activeChapter.level, levelFor(expected));
  assert.equal(reloaded.campaign.cumulativeLevels, levelFor(expected));
  assert.equal(reloaded.openAttempt, null, "the attempt closed with the commit");
  const mission = reloaded.missions.find((row) => row.missionId === M1);
  assert.equal(mission?.outcome, "CLEARED");
  assert.equal(mission?.awardedXp, expected);
  assert.equal(mission?.attemptsUsed, 1);
  // The module taught its Codex cards, learned and not yet PvP-legal.
  assert.ok(reloaded.codex.length > 0);
  assert.ok(reloaded.codex.every((card) => card.pvpLegalAt === null));
});

test("a retry after a reload is ordinal 2 and pays two thirds", async () => {
  // The defect this pins is a client-side one with a server-side consequence.
  // The container used to count the ordinal in the tab, so a page reload put it
  // back to 1 and the result screen promised full XP. The client no longer
  // counts: it asks, and the answer below is what it is told.
  const runner = await newRunner("Retrying Runner");
  const first = await authorize(runner);
  const failed = await post(runner, "mission-outcomes", {
    attemptId: first.attemptId,
    outcome: "FAILED",
    committedEvents: [],
    baseRevision: 0,
  });
  assert.equal(failed.statusCode, 200, failed.body);
  assert.equal((failed.json() as { awardedXp: number }).awardedXp, 0);

  // The reload: a client with no memory at all asks for an attempt, exactly as
  // a freshly loaded hub does.
  const retry = await authorize(runner);
  assert.equal(retry.attemptOrdinal, 2, "the server remembers what the tab forgot");
  assert.deepEqual(retry.xpFraction, { numerator: 2, denominator: 3 });
  assert.notEqual(retry.attemptSeedHex, first.attemptSeedHex, "a retry is a new run");

  const cleared = await post(runner, "mission-outcomes", {
    attemptId: retry.attemptId,
    outcome: "CLEARED",
    committedEvents: DUEL_LOG,
    baseRevision: 0,
  });
  assert.equal(cleared.statusCode, 200, cleared.body);
  const paid = (cleared.json() as { awardedXp: number }).awardedXp;
  assert.equal(paid, missionAward(1, 2), "two thirds of the authored base");
  assert.ok(paid < missionBaseXp(1), "and strictly less than a first-attempt clear");

  const reloaded = await pull(runner);
  assert.equal(reloaded.activeChapter.xp, paid);
  assert.equal(reloaded.missions.find((row) => row.missionId === M1)?.attemptsUsed, 2);
});

test("the deck is the gate: a skipped card opens no attempt", async () => {
  const runner = await newRunner("Skimming Runner");
  const partial = await post(runner, "modules", {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    moduleId: M1_MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: M1,
    acknowledgedCueIds: M1_DECK.slice(0, 3),
    observedSeconds: 20,
  });
  assert.equal(partial.statusCode, 400);
  assert.equal(partial.json().error, "MODULE_REQUIRED");

  const opened = await post(runner, "mission-attempts", {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    missionId: M1,
  });
  assert.equal(opened.statusCode, 400);
  assert.equal(opened.json().error, "MODULE_REQUIRED");
  assert.equal((await pull(runner)).activeChapter.xp, 0);
});

test("a spent mission pays nothing more, however the client asks", async () => {
  const runner = await newRunner("Spent Runner");
  const attempt = await authorize(runner);
  await post(runner, "mission-outcomes", {
    attemptId: attempt.attemptId,
    outcome: "CLEARED",
    committedEvents: [],
    baseRevision: 0,
  });

  // Re-committing the same attempt.
  const replay = await post(runner, "mission-outcomes", {
    attemptId: attempt.attemptId,
    outcome: "CLEARED",
    committedEvents: [],
    baseRevision: 0,
  });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json().error, "ATTEMPT_CLOSED");

  // Re-running the module to arm a fourth attempt on a cleared mission.
  const again = await post(runner, "modules", {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    moduleId: M1_MODULE,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: M1,
    acknowledgedCueIds: [...M1_DECK],
    acknowledgedCheckIds: [...M1_CHECKS],
    observedSeconds: 174,
  });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error, "MISSION_SPENT");

  assert.equal((await pull(runner)).activeChapter.xp, missionBaseXp(1));
});

test("a client cannot name its own award, its own ordinal or its own verdict", async () => {
  const runner = await newRunner("Forging Runner");
  const attempt = await authorize(runner);

  for (const smuggled of [
    { awardedXp: 9999 },
    { attemptOrdinal: 1 },
    { verdict: "CORRECT" },
    { xpFraction: { numerator: 3, denominator: 3 } },
  ]) {
    const response = await post(runner, "mission-outcomes", {
      attemptId: attempt.attemptId,
      outcome: "CLEARED",
      committedEvents: [],
      baseRevision: 0,
      ...smuggled,
    });
    assert.equal(
      response.statusCode,
      400,
      `${Object.keys(smuggled)[0]} reached the server`,
    );
  }

  // …and the attempt is still open and still worth exactly what it was.
  const snapshot = await pull(runner);
  assert.equal(snapshot.openAttempt?.attemptId, attempt.attemptId);
  assert.equal(snapshot.activeChapter.xp, 0);
});

// ===========================================================================
// The formative retrieval ledger, against a real Postgres.
//
// The in-memory double (concept-retrieval.test.ts) proves the shape; these prove
// the SQL, the profile scoping under a real WHERE (the property the progression
// double lied about until it was unified), and the dev-reset's cross-table clear.
// ===========================================================================

/** A duel round posted through the real route, exactly as the client does. */
function postDuel(runner: Runner, duelId: string, round: number, answer: string) {
  return app.inject({
    method: "POST",
    url: `/v1/duels/${encodeURIComponent(duelId)}/rounds/${round}/verdict`,
    headers: {
      cookie: runner.cookie,
      "x-pa-csrf-token": runner.csrf,
      origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
      "content-type": "application/json",
    },
    // itemId/conceptId are client CLAIMS the server ignores; it grades and records
    // the item the round actually asks, computed from the stored attempt.
    payload: {
      side: "A",
      itemId: "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1",
      itemVersion: "v1",
      conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
      answer,
    },
  });
}

interface RetrievalRow {
  concept_id: string;
  item_id: string;
  source: string;
  correct: boolean;
  graded: boolean;
  recycled: boolean;
  appearance: number;
  mission_id: string;
  duel_id: string;
  round_index: number;
}

test("a graded duel round lands in the retrieval ledger, server-minted", async () => {
  const runner = await newRunner("Duelling Runner");
  const attempt = await authorize(runner);
  // A blank answer abstains → WRONG, graded deterministically (no classifier).
  const res = await postDuel(runner, m1DuelId(attempt.attemptOrdinal), 1, "");
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().kind, "WRONG");

  const rows = await query<RetrievalRow>(
    `select concept_id, item_id, source, correct, graded, recycled, appearance,
            mission_id, duel_id, round_index
       from concept_retrieval where profile_id=$1`,
    [runner.profileId],
  );
  assert.equal(rows.rowCount, 1, "exactly one row for one graded round");
  const row = rows.rows[0]!;
  assert.equal(row.source, "DUEL");
  assert.equal(row.mission_id, M1);
  assert.equal(row.duel_id, m1DuelId(attempt.attemptOrdinal));
  assert.equal(row.round_index, 1);
  assert.equal(row.correct, false, "a blank is WRONG");
  assert.equal(row.graded, true, "an abstention is a real grade");
  assert.equal(row.recycled, false);
  // The concept and item are the SERVER-selected round's, one of M1's three.
  assert.match(row.item_id, /^BOS\.MD01\.DUEL\./);
  assert.match(row.concept_id, /^BOS\.CONCEPT\./);

  // And the read rolls it up the way a report wants it.
  const [summary] = await postgresConceptRetrievalStore().byChapter(
    runner.profileId,
    BOSTON_RUNTIME_CHAPTER_ID,
  );
  assert.ok(summary);
  assert.equal(summary.asked, 1);
  assert.equal(summary.askedGraded, 1);
  assert.equal(summary.correct, 0);
  assert.equal(summary.distinctItems, 1);
  assert.equal(summary.distinctAttempts, 1);
});

test("the ledger reads are profile-scoped: one student's asks never enter another's report", async () => {
  // The mutation-proof guard. The progression double returned every profile's rows
  // behind a comment promising otherwise; this asserts the real SQL does not. Break
  // the `where profile_id=$1` in postgresConceptRetrievalStore.byChapter and this
  // fails, which is the whole point — a ledger that reports the wrong student's
  // learning is worse than none.
  const store = postgresConceptRetrievalStore();
  const alice = await newRunner("Ledger Alice");
  const bob = await newRunner("Ledger Bob");
  const base = {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    missionId: M1,
    attemptId: crypto.randomUUID(),
    conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
    itemId: "BOS.MD01.DUEL.STAMP.NAME_TWO.v1",
    source: "DUEL" as const,
    correct: true,
    graded: true,
    recycled: false,
    appearance: 1,
    seenAt: new Date().toISOString(),
  };
  // Alice: one correct ask. Bob: two, both wrong. Same concept and chapter.
  await store.record({ ...base, profileId: alice.profileId, duelId: "A#duel@1", roundIndex: 1, correct: true });
  await store.record({ ...base, profileId: bob.profileId, duelId: "B#duel@1", roundIndex: 1, correct: false });
  await store.record({ ...base, profileId: bob.profileId, duelId: "B#duel@1", roundIndex: 2, correct: false });

  const aSummary = await store.byChapter(alice.profileId, BOSTON_RUNTIME_CHAPTER_ID);
  const bSummary = await store.byChapter(bob.profileId, BOSTON_RUNTIME_CHAPTER_ID);
  assert.equal(aSummary.length, 1);
  assert.equal(aSummary[0]!.asked, 1, "Alice sees only her one ask, not Bob's three");
  assert.equal(aSummary[0]!.correct, 1);
  assert.equal(bSummary[0]!.asked, 2, "Bob sees only his two");
  assert.equal(bSummary[0]!.correct, 0);
});

test("a dev-reset clears the mission's retrieval ledger AND its stale duel verdicts", async () => {
  const runner = await newRunner("Resetting Runner");
  const attempt = await authorize(runner);
  const duelId = m1DuelId(attempt.attemptOrdinal);
  const graded = await postDuel(runner, duelId, 1, "");
  assert.equal(graded.statusCode, 200, graded.body);

  // Both tables now hold a row for this round.
  const before = await query(
    "select 1 from concept_retrieval where profile_id=$1",
    [runner.profileId],
  );
  const beforeVerdicts = await query(
    "select 1 from duel_verdicts where profile_id=$1 and duel_id=$2 and round_index=1",
    [runner.profileId, duelId],
  );
  assert.equal(before.rowCount, 1);
  assert.equal(beforeVerdicts.rowCount, 1);

  // The reset endpoint the dev harness uses. It clears the mission's retrieval and
  // its verdicts so a replay re-grades rather than replaying the prior run.
  const reset = await app.inject({
    method: "POST",
    url: "/v1/dev/reset-mission",
    headers: {
      cookie: runner.cookie,
      "x-pa-csrf-token": runner.csrf,
      origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
      "content-type": "application/json",
    },
    payload: { chapterId: BOSTON_RUNTIME_CHAPTER_ID, missionId: M1 },
  });
  assert.equal(reset.statusCode, 200, reset.body);
  const body = reset.json() as {
    reset: { moduleGateOrdinalsPreserved: number[] };
    retrieval: { retrievalRowsCleared: number; verdictsCleared: number };
  };
  assert.equal(body.retrieval.retrievalRowsCleared, 1);
  assert.equal(body.retrieval.verdictsCleared, 1, "the stale verdict is gone so a replay re-grades");
  // The module gate — durable, not run-state — survives, exactly as before.
  assert.ok(body.reset.moduleGateOrdinalsPreserved.includes(1));

  const afterRetrieval = await query(
    "select 1 from concept_retrieval where profile_id=$1",
    [runner.profileId],
  );
  const afterVerdicts = await query(
    "select 1 from duel_verdicts where profile_id=$1 and duel_id=$2",
    [runner.profileId, duelId],
  );
  assert.equal(afterRetrieval.rowCount, 0, "the mission's retrieval history is cleared");
  assert.equal(afterVerdicts.rowCount, 0, "and its verdicts, so the replay is fresh");
});

test("the milestones the server holds are the authored schedule", async () => {
  // Boston's first unlock is above what one mission pays, so no e2e clear can
  // observe one. What is checkable is that the ids and Levels the server would
  // mint are @pa/abilities' own, re-keyed onto the runtime chapter.
  const { bostonProgressionContent } = await import("../src/progression/content.js");
  const milestones = bostonProgressionContent().abilityMilestones(
    BOSTON_RUNTIME_CHAPTER_ID,
  );
  assert.deepEqual(
    milestones.map((row) => [row.abilityId, row.level]),
    BOSTON_ABILITY_MILESTONES.map((row) => [row.abilityId, row.level]),
  );
  assert.ok(milestones.every((row) => row.chapterId === BOSTON_RUNTIME_CHAPTER_ID));
});
