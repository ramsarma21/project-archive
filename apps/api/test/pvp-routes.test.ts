// Fastify route-level concurrency and lifecycle tests for the PvP routes.
//
// The routes reach the database in exactly ONE place: `getSessionUser`. The route now
// takes an `authenticate` injection precisely so this file can drive it with a fake
// session resolver instead of a copied fake of the whole route — the audit's
// "minimally extract a testable route state/service." Everything else the route needs
// is already injectable: a fake standing store, a stub grader, a controllable clock,
// and the scheduler switched off so no real timer fires inside a unit test. What is
// exercised here is the behaviour under CONCURRENCY, which is the part a per-function
// unit test cannot reach: two operations racing on one profile, a grade racing a
// forfeit, retention cleanup, and the outage standing rule end to end over HTTP.

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";

process.env.CSRF_SECRET = "test-secret-for-pvp-route-csrf";

const { csrfTokenForSession } = await import("../src/auth.js");
const { registerPvpRoutes } = await import("../src/routes/pvp.js");
const { applyMatchResult, newStandingRecord, DISCONNECT_GRACE_MS } = await import("@pa/pvp");
const { BULLETS_FOR_WRONG, PLAYER_MAX_HEALTH } = await import("@pa/duel");

type VerdictSource = "CLASSIFIER" | "GRADING_TIMEOUT";

interface BankCall {
  readonly matchId: string;
  readonly standingApplies: boolean;
  readonly needsReview: boolean;
}

interface Harness {
  readonly app: FastifyInstance;
  readonly clock: { t: number };
  readonly banks: BankCall[];
  /** Count of scheduler advancement passes that have actually executed (all matches). */
  readonly passes: { count: number };
  /** Passes that executed for one specific match id — see the note in the harness. */
  passesFor(matchId: string): number;
  /** Count of every bank ATTEMPT, including ones that threw. */
  readonly bankCalls: { count: number };
  /** Count of grade calls ENTERED (before awaiting the grader gate). */
  readonly gradeEntries: { count: number };
  setSource(source: VerdictSource): void;
  /** Set the verdict kind the stub grader returns. Defaults to CORRECT. */
  setVerdict(kind: "CORRECT" | "WRONG"): void;
  /** Gate the grader (answer path). */
  gate(promise: Promise<void>): void;
  /** Gate the store bank (settlement path). */
  bankGate(promise: Promise<void>): void;
  /** Make the next `n` bank attempts throw, to exercise retry. */
  failBanks(n: number): void;
  /**
   * Run exactly one scheduler pass at `nowMs` (defaulting to the current fake clock)
   * and resolve only once the work it enqueues — a retry settle, a retirement delete —
   * has completed. Deterministic: no real timer, no wall-clock sleep. Requires the
   * harness to have been built with `driveScheduler: true`.
   */
  tick(nowMs?: number): Promise<void>;
  /** Drive one scheduler pass WITHOUT awaiting the work — for coalescing tests. */
  pass(nowMs?: number): void;
  /** Await every per-match queue, so the passes' effects have landed. */
  drain(): Promise<void>;
}

interface HarnessOptions {
  readonly startScheduler?: boolean;
  /** Use the real wall clock so the scheduler advances the match in real time. */
  readonly realClock?: boolean;
  /**
   * Expose the deterministic scheduler driver as `h.tick(...)`. Pair with the default
   * `startScheduler: false` so the only advancement is the one the test drives.
   */
  readonly driveScheduler?: boolean;
}

const RETENTION_MS = 60_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll a state predicate until it holds, or throw after a generous bound. Waits on a
 * CONDITION, never on elapsed time, so it is robust under load: the bound only guards
 * against a genuine hang, it is not the thing being measured.
 */
async function waitUntil(
  predicate: () => boolean,
  message: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitUntil timed out: ${message}`);
    await delay(2);
  }
}

async function buildHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const clock = { t: 1_000_000 };
  const passes = { count: 0 };
  const passesByMatch = new Map<string, number>();
  const bankCalls = { count: 0 };
  const gradeEntries = { count: 0 };
  let bankFailsRemaining = 0;
  const banks: BankCall[] = [];
  const bankedIds = new Set<string>();
  const records = new Map<
    string,
    ReturnType<typeof newStandingRecord>
  >();
  const recordFor = (profileId: string) =>
    records.get(profileId) ?? newStandingRecord(profileId, `Quiet-${profileId}`, 1);

  let source: VerdictSource = "CLASSIFIER";
  let verdictKind: "CORRECT" | "WRONG" = "CORRECT";
  let gate: Promise<void> = Promise.resolve();
  let bankGatePromise: Promise<void> = Promise.resolve();

  let driver:
    | { pass: (nowMs?: number) => void; drain: () => Promise<void> }
    | null = null;

  const app = Fastify({ logger: false });
  await app.register(cookie);
  await registerPvpRoutes(app, {
    now: opts.realClock ? Date.now : () => clock.t,
    startScheduler: opts.startScheduler ?? false,
    provideSchedulerDriver: opts.driveScheduler
      ? (d) => {
          driver = d;
        }
      : undefined,
    onSchedulerPass: (mid) => {
      // Counted per match id, because `matchesById` is module-global and accumulates
      // live matches across every test in this file — a driven (or real) pass pumps
      // ALL of them, so a global counter would fold sibling tests' matches into this
      // one's. A per-match count is the only honest measure of THIS match's passes.
      passes.count += 1;
      passesByMatch.set(mid, (passesByMatch.get(mid) ?? 0) + 1);
    },
    authenticate: async (sessionId) =>
      sessionId ? { profileId: sessionId } : null,
    masteredConcepts: async () => [],
    verifyReceipt: () => true,
    gradeAnswer: async ({ itemId }) => {
      // Counted BEFORE awaiting, so a test can wait until a grade is actually holding
      // the match queue rather than sleeping and hoping it has.
      gradeEntries.count += 1;
      await gate;
      return {
        envelope: {
          kind: verdictKind,
          itemId,
          itemVersion: "v1",
          source,
          responseRef: null,
        },
        receipt: "receipt",
      };
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
      async bank(input) {
        bankCalls.count += 1;
        // A failing bank throws before claiming anything, exactly as a transaction
        // that could not commit would — leaving the result unbanked and recoverable.
        if (bankFailsRemaining > 0) {
          bankFailsRemaining -= 1;
          throw new Error("bank failed (test)");
        }
        if (bankedIds.has(input.result.matchId)) return false;
        // Await the gate BEFORE claiming the id, so a settle held here has not yet
        // marked the match settled — exactly the window a retention sweep must not
        // retire it in.
        await bankGatePromise;
        if (bankedIds.has(input.result.matchId)) return false;
        bankedIds.add(input.result.matchId);
        banks.push({
          matchId: input.result.matchId,
          standingApplies: input.result.standingApplies,
          needsReview: input.result.needsReview,
        });
        const update = applyMatchResult(input.result, {
          A: recordFor(input.participants.A.profileId),
          B: recordFor(input.participants.B.profileId),
        });
        for (const record of update.records) records.set(record.profileId, record);
        return true;
      },
    },
  });
  await app.ready();
  return {
    app,
    clock,
    banks,
    passes,
    passesFor: (matchId) => passesByMatch.get(matchId) ?? 0,
    bankCalls,
    gradeEntries,
    setSource: (next) => {
      source = next;
    },
    setVerdict: (kind) => {
      verdictKind = kind;
    },
    gate: (promise) => {
      gate = promise;
    },
    bankGate: (promise) => {
      bankGatePromise = promise;
    },
    failBanks: (n) => {
      bankFailsRemaining = n;
    },
    pass: (nowMs) => {
      if (!driver) throw new Error("harness was not built with { driveScheduler: true }");
      driver.pass(nowMs);
    },
    drain: async () => {
      if (!driver) throw new Error("harness was not built with { driveScheduler: true }");
      await driver.drain();
    },
    tick: async (nowMs) => {
      if (!driver) throw new Error("harness was not built with { driveScheduler: true }");
      driver.pass(nowMs);
      await driver.drain();
    },
  };
}

/**
 * Advance the fake clock by `totalMs` in ≤-bound steps, pumping each step via a read.
 *
 * Reads as EVERY side each step, because the read is now also the liveness signal the
 * disconnect check measures (see `markSeen` in the route): a side that is never polled
 * while the clock runs past the grace is — correctly — a disconnect. Both real clients
 * poll throughout, so a test that advances the clock must poll both or it fabricates a
 * disconnect that production would not have.
 */
async function feedClock(
  h: Harness,
  matchId: string,
  sids: string | readonly string[],
  totalMs: number,
  stepMs = 80,
): Promise<string | null> {
  const present = typeof sids === "string" ? [sids] : sids;
  let fed = 0;
  let phase: string | null = null;
  while (fed < totalMs) {
    h.clock.t += stepMs;
    fed += stepMs;
    for (const sid of present) {
      const res = await readAs(h.app, `/api/pvp/match/${matchId}`, sid);
      if (res.statusCode === 200) phase = res.json().snapshot?.phase ?? phase;
    }
  }
  return phase;
}


function mutate(
  app: FastifyInstance,
  method: "POST" | "DELETE",
  url: string,
  sid: string,
  payload: unknown = {},
) {
  return app.inject({
    method,
    url,
    headers: {
      "x-pa-csrf-token": csrfTokenForSession(sid),
      "content-type": "application/json",
    },
    cookies: { pa_session: sid },
    payload: payload as object,
  });
}

function readAs(app: FastifyInstance, url: string, sid: string) {
  return app.inject({ method: "GET", url, cookies: { pa_session: sid } });
}

/**
 * Send one intent frame for `sid`, stamped near the server's current tick so the
 * authority accepts it. This is what makes a side "moving" — the signal that, on the
 * intent clock alone, would leave a merely-polling opponent looking silent.
 */
async function sendIntent(
  app: FastifyInstance,
  matchId: string,
  sid: string,
  seq: number,
): Promise<void> {
  const read = await readAs(app, `/api/pvp/match/${matchId}`, sid);
  const tick = read.statusCode === 200 ? (read.json().snapshot?.tick ?? 0) : 0;
  await mutate(app, "POST", `/api/pvp/match/${matchId}/intents`, sid, {
    frames: [
      {
        seq,
        tick: tick + 4,
        moveX: 0,
        moveZ: 0,
        sprint: false,
        crouch: false,
        jump: false,
        dodge: false,
        fire: false,
        aimX: 0,
        aimZ: 1,
        abilityId: null,
      },
    ],
  });
}

// The route keeps its lobby/match state in module-level maps that persist across test
// cases in one process, so every test uses FRESH profile ids to stay isolated —
// reusing "host" would collide with a lobby a previous test left behind.
let uidCounter = 0;
function uid(role: string): string {
  uidCounter += 1;
  return `${role}-${uidCounter}`;
}

async function createLobby(app: FastifyInstance, sid: string): Promise<string> {
  const res = await mutate(app, "POST", "/api/pvp/lobby", sid);
  assert.equal(res.statusCode, 200, `create for ${sid}: ${res.body}`);
  return res.json().code as string;
}

async function startMatch(
  app: FastifyInstance,
  hostSid: string,
  guestSid: string,
): Promise<string> {
  const code = await createLobby(app, hostSid);
  const joined = await mutate(app, "POST", `/api/pvp/lobby/${code}/join`, guestSid);
  assert.equal(joined.statusCode, 200, `join: ${joined.body}`);
  return joined.json().matchId as string;
}

/** Poll the match forward (scheduler is off) until the round opens a question. */
async function advanceToQuestion(
  harness: Harness,
  matchId: string,
  sid: string,
): Promise<void> {
  for (let poll = 0; poll < 1500; poll += 1) {
    const res = await readAs(harness.app, `/api/pvp/match/${matchId}`, sid);
    if (res.statusCode !== 200) throw new Error(`poll failed: ${res.statusCode} ${res.body}`);
    const body = res.json();
    if (body.question || body.result) return;
    if (body.snapshot?.phase === "QUESTION_PENDING") return;
    harness.clock.t += 84; // one catch-up bound per poll
  }
  throw new Error("the match never opened a question");
}

test("concurrent creates for one profile yield exactly one lobby", async () => {
  const h = await buildHarness();
  const host = uid("host");
  const [a, b] = await Promise.all([
    mutate(h.app, "POST", "/api/pvp/lobby", host),
    mutate(h.app, "POST", "/api/pvp/lobby", host),
  ]);
  const codes = [a.statusCode, b.statusCode].sort();
  assert.deepEqual(codes, [200, 409], `${a.statusCode}/${b.statusCode}`);
  const refused = a.statusCode === 409 ? a : b;
  assert.equal(refused.json().error, "LOBBY_ALREADY_OPEN");
  await h.app.close();
});

test("one guest joining two lobbies at once ends up in exactly one match", async () => {
  const h = await buildHarness();
  const guest = uid("guest");
  const code1 = await createLobby(h.app, uid("host"));
  const code2 = await createLobby(h.app, uid("host"));
  const [j1, j2] = await Promise.all([
    mutate(h.app, "POST", `/api/pvp/lobby/${code1}/join`, guest),
    mutate(h.app, "POST", `/api/pvp/lobby/${code2}/join`, guest),
  ]);
  const statuses = [j1.statusCode, j2.statusCode].sort();
  assert.deepEqual(statuses, [200, 409], `${j1.statusCode}/${j2.statusCode}`);
  const refused = j1.statusCode === 409 ? j1 : j2;
  assert.equal(refused.json().error, "ACTIVE_MATCH_EXISTS");
  await h.app.close();
});

test("a cancel racing a join yields one outcome, never both", async () => {
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const code = await createLobby(h.app, host);
  const [cancel, join] = await Promise.all([
    mutate(h.app, "DELETE", `/api/pvp/lobby/${code}`, host),
    mutate(h.app, "POST", `/api/pvp/lobby/${code}/join`, guest),
  ]);
  // Exactly one of the two commits: either the lobby is cancelled and the join is
  // refused, or the join starts a match and the cancel is refused.
  const cancelled = cancel.statusCode === 200;
  const joined = join.statusCode === 200;
  assert.notEqual(cancelled, joined, `cancel=${cancel.statusCode} join=${join.statusCode}`);
  if (joined) {
    assert.equal(cancel.statusCode, 409);
    // The guest is now in a match; /active confirms one commitment.
    const active = await readAs(h.app, "/api/pvp/active", guest);
    assert.equal(active.json().kind, "MATCH");
  } else {
    assert.equal(join.statusCode, 409);
  }
  await h.app.close();
});

test("/active recovers a live match, then the terminal result", async () => {
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);

  const hostActive = await readAs(h.app, "/api/pvp/active", host);
  assert.equal(hostActive.json().kind, "MATCH");
  assert.equal(hostActive.json().side, "A");
  const guestActive = await readAs(h.app, "/api/pvp/active", guest);
  assert.equal(guestActive.json().kind, "MATCH");
  assert.equal(guestActive.json().side, "B");

  const forfeit = await mutate(h.app, "POST", `/api/pvp/match/${matchId}/forfeit`, guest);
  assert.equal(forfeit.statusCode, 200);

  const afterForfeit = await readAs(h.app, "/api/pvp/active", guest);
  assert.equal(afterForfeit.json().kind, "RESULT", "a reload lands on the result");
  assert.equal(afterForfeit.json().result.reason, "FORFEIT");
  await h.app.close();
});

test("a resolved match is cleaned after the retention window", async () => {
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);
  await mutate(h.app, "POST", `/api/pvp/match/${matchId}/forfeit`, guest);

  // Within retention: RESULT is still recoverable.
  assert.equal((await readAs(h.app, "/api/pvp/active", host)).json().kind, "RESULT");

  // Past it: the terminal record, the profile mappings and the match are all gone.
  h.clock.t += RETENTION_MS + 1;
  const active = await readAs(h.app, "/api/pvp/active", host);
  assert.equal(active.json().kind, "NONE", "nothing left to rejoin");
  const gone = await readAs(h.app, `/api/pvp/match/${matchId}`, host);
  assert.equal(gone.statusCode, 404, "the match record was swept");
  await h.app.close();
});

test("a forfeit racing a grade in flight resolves once and is not revived", async () => {
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);
  await advanceToQuestion(h, matchId, guest);

  // Hold grading open so the answer is genuinely in flight when the forfeit arrives.
  let release!: () => void;
  h.gate(new Promise<void>((resolve) => (release = resolve)));

  const answer = mutate(h.app, "POST", `/api/pvp/match/${matchId}/answer`, guest, {
    answerText: "an answer held mid-grade",
  });
  // Let the answer enter the queue and reach the awaited grade.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const forfeit = mutate(h.app, "POST", `/api/pvp/match/${matchId}/forfeit`, host);
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();

  const [answerRes, forfeitRes] = await Promise.all([answer, forfeit]);
  // Whatever the interleaving, the match ends FORFEITED and the standing is banked
  // exactly once — the grade cannot revive or double-bank a settled match.
  assert.equal(forfeitRes.statusCode, 200);
  assert.equal(forfeitRes.json().result.reason, "FORFEIT");
  void answerRes;
  assert.equal(h.banks.length, 1, `banked ${h.banks.length} times`);

  const active = await readAs(h.app, "/api/pvp/active", host);
  assert.equal(active.json().result.reason, "FORFEIT", "still forfeited, not revived");
  await h.app.close();
});

test("an outage-graded result is banked as practice and moves no standing", async () => {
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  h.setSource("GRADING_TIMEOUT"); // the classifier is unreachable; the round is granted
  const matchId = await startMatch(h.app, host, guest);
  await advanceToQuestion(h, matchId, guest);

  const answer = await mutate(h.app, "POST", `/api/pvp/match/${matchId}/answer`, guest, {
    answerText: "granted on the outage fallback",
  });
  assert.equal(answer.statusCode, 200);

  // End the match; the committed verdict's source is non-CLASSIFIER, so the result
  // both the client sees and the store banks must be practice/review.
  const forfeit = await mutate(h.app, "POST", `/api/pvp/match/${matchId}/forfeit`, host);
  const result = forfeit.json().result;
  assert.equal(result.standingApplies, false, "an outage result is not ranked");
  assert.equal(result.needsReview, true, "and it is flagged for review");
  assert.equal(h.banks.length, 1);
  assert.equal(h.banks[0]?.standingApplies, false, "banked as the same practice result");
  assert.equal(h.banks[0]?.needsReview, true);
  await h.app.close();
});

// ---- scheduler-enabled behavioural tests -----------------------------------

test("slow dual grading advances through countdown and combat without a scheduler burst", async () => {
  // DETERMINISTIC, not timed. The coalescing property — while one pass is pending
  // behind a held grade, every subsequent tick is skipped — was previously asserted
  // by letting the REAL 50 ms interval run for `delay(260)` and hoping it enqueued
  // "about five" ticks that collapsed to one. Under parallel load the interval fired
  // an unpredictable number of times around the release, so the burst wandered above
  // the tolerance. Here the scheduler is OFF and passes are driven explicitly: the
  // grade genuinely holds the match queue, N driven passes coalesce to exactly one,
  // and the count is a fact rather than a race.
  const h = await buildHarness({ startScheduler: false, driveScheduler: true });
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);
  await advanceToQuestion(h, matchId, guest);

  // Hold grading open. The answer handler grades INSIDE the match queue, so a held
  // grade holds the queue — exactly what a slow round does in production.
  let release!: () => void;
  h.gate(new Promise<void>((resolve) => (release = resolve)));
  const answerGuest = mutate(h.app, "POST", `/api/pvp/match/${matchId}/answer`, guest, {
    answerText: "guest answer held mid-grade",
  });
  const answerHost = mutate(h.app, "POST", `/api/pvp/match/${matchId}/answer`, host, {
    answerText: "host answer held mid-grade",
  });
  // Wait until a grade is actually holding the queue — a condition, not a sleep.
  await waitUntil(() => h.gradeEntries.count >= 1, "a grade to hold the match queue");
  const beforeRelease = h.passesFor(matchId);

  // Drive a burst of scheduler passes while the queue is held. The first enqueues
  // behind the held grade; the rest are coalesced away (`scheduledMatches`). None can
  // execute yet, because the pass they enqueued is stuck behind the grade.
  for (let tick = 0; tick < 5; tick += 1) h.pass();
  assert.equal(
    h.passesFor(matchId),
    beforeRelease,
    "no pass can execute for this match while the grade holds its queue",
  );

  release();
  await Promise.all([answerGuest, answerHost]);
  await h.drain();
  const burst = h.passesFor(matchId) - beforeRelease;
  // Exactly one: the single coalesced pass for THIS match. A backlog would be five —
  // one per driven tick — dumped at once. The old tolerance was `<= 2`; measuring this
  // match's own passes deterministically lets us pin exactly 1.
  assert.equal(burst, 1, `expected one coalesced pass, saw ${burst}`);

  // And the fight moved on rather than stalling at the question.
  const after = await readAs(h.app, `/api/pvp/match/${matchId}`, guest);
  assert.equal(after.statusCode, 200);
  assert.notEqual(after.json().snapshot.phase, "QUESTION_PENDING");
  await h.app.close();
});

test("closing the app clears the scheduler timer and does not hang", async () => {
  // This one legitimately exercises the REAL interval — its whole subject is that
  // `onClose` calls `clearInterval`. So it keeps the real timer and the real clock,
  // but waits on a CONDITION (a pass has run) rather than a fixed sleep, so a loaded
  // machine that is slow to fire the first tick does not fail it spuriously.
  const h = await buildHarness({ startScheduler: true, realClock: true });
  await startMatch(h.app, uid("host"), uid("guest"));
  await waitUntil(() => h.passes.count > 0, "the scheduler to run at least one pass");
  const before = h.passes.count;

  await h.app.close(); // must resolve, not hang, because onClose clears the interval
  // After the interval is cleared no NEW pass can be scheduled. Give real time for a
  // stray tick to have fired if the clear had failed, then assert the count is stable.
  await delay(160);
  assert.equal(h.passes.count, before, "no passes fire after close: the timer was cleared");
});

test("a retention sweep during slow banking cannot delete, revive, or leak", async () => {
  // DETERMINISTIC. The property is about ORDERING — a match past retention whose bank
  // has not committed must be kept, and retired only once it has — not about elapsed
  // time. Driven passes make the ordering exact instead of relying on a real interval
  // sweeping within a `delay()`.
  const h = await buildHarness({ startScheduler: false, driveScheduler: true });
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);

  // Hold the bank open so settlement is genuinely in flight and holds the match queue.
  let releaseBank!: () => void;
  h.bankGate(new Promise<void>((resolve) => (releaseBank = resolve)));
  const forfeit = mutate(h.app, "POST", `/api/pvp/match/${matchId}/forfeit`, guest);
  // Wait until the bank is actually entered (holding the queue) — a condition, not a sleep.
  await waitUntil(() => h.bankCalls.count >= 1, "the forfeit's bank to be in flight");

  // Jump past retention WHILE banking is unfinished, and drive sweep passes.
  h.clock.t += RETENTION_MS + 1;
  for (let tick = 0; tick < 3; tick += 1) h.pass();
  // The match is NOT retired: its bank has not committed, so its state stays
  // recoverable. `/active` does not touch the match queue, so it answers without
  // blocking behind the in-flight settlement.
  const during = await readAs(h.app, "/api/pvp/active", host);
  assert.equal(during.json().kind, "RESULT", "an unsettled match past retention is kept");
  assert.equal(h.banks.length, 0, "not banked yet");

  // Commit the bank; settlement completes exactly once.
  releaseBank();
  await forfeit;
  assert.equal(h.banks.length, 1, "banked exactly once");

  // Now — and only now — retirement is allowed, and a driven sweep retires it.
  await h.tick();
  const gone = await readAs(h.app, `/api/pvp/match/${matchId}`, host);
  assert.equal(gone.statusCode, 404, "retired after settlement committed");
  assert.equal((await readAs(h.app, "/api/pvp/active", host)).json().kind, "NONE");

  // No revive, no leak: banking is never attempted a second time after cleanup.
  await h.tick();
  assert.equal(h.banks.length, 1, "no second bank after cleanup");
  await h.app.close();
});

test("a resolved match plus a new lobby returns HOSTING, not the stale result", async () => {
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);
  await mutate(h.app, "POST", `/api/pvp/match/${matchId}/forfeit`, guest);
  // Before opening anything new, the guest's reload lands on the terminal result.
  assert.equal((await readAs(h.app, "/api/pvp/active", guest)).json().kind, "RESULT");

  // The guest opens a NEW lobby; /active must recover that, not the old result.
  const created = await mutate(h.app, "POST", "/api/pvp/lobby", guest);
  assert.equal(created.statusCode, 200);
  const active = await readAs(h.app, "/api/pvp/active", guest);
  assert.equal(active.json().kind, "LOBBY", "the new lobby outranks the stale result");
  assert.equal(active.json().code, created.json().code);
  await h.app.close();
});

test("two distinct guests racing the same lobby yield exactly one join winner", async () => {
  const h = await buildHarness();
  const code = await createLobby(h.app, uid("host"));
  const [j1, j2] = await Promise.all([
    mutate(h.app, "POST", `/api/pvp/lobby/${code}/join`, uid("guestA")),
    mutate(h.app, "POST", `/api/pvp/lobby/${code}/join`, uid("guestB")),
  ]);
  const statuses = [j1.statusCode, j2.statusCode].sort();
  assert.deepEqual(statuses, [200, 409], `${j1.statusCode}/${j2.statusCode}`);
  const refused = j1.statusCode === 409 ? j1 : j2;
  assert.equal(refused.json().error, "LOBBY_NOT_OPEN");
  await h.app.close();
});

test("time spent grading is discarded; the resume countdown runs its full duration", async () => {
  // Scheduler OFF and advancement driven purely by reads, so the only wall time the
  // sim ever sees is what `feedClock` hands it. BOTH sides are polled throughout: a
  // read is now the liveness signal, and a real duel has both clients polling the
  // whole time, so a one-sided drive would fabricate a disconnect the fix correctly
  // acts on. What this still isolates is the time-discarding: a 30s grading gap must
  // not be replayed into the fresh countdown.
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);
  await advanceToQuestion(h, matchId, guest);

  // Block BOTH grading calls, then let a LONG stretch of wall time pass while blocked.
  let release!: () => void;
  h.gate(new Promise<void>((resolve) => (release = resolve)));
  const answerGuest = mutate(h.app, "POST", `/api/pvp/match/${matchId}/answer`, guest, {
    answerText: "guest answer",
  });
  const answerHost = mutate(h.app, "POST", `/api/pvp/match/${matchId}/answer`, host, {
    answerText: "host answer",
  });
  await delay(20);
  h.clock.t += 30_000; // 30 seconds elapse during grading — this must be discarded
  release();
  await Promise.all([answerGuest, answerHost]);

  // Transition VERDICT_COMMITTED -> BULLETS_GRANTED via a read of both sides. The fake
  // clock is frozen, so the timed countdown cannot advance without wall time — and the
  // discarded 30s must not have been replayed into it.
  await readAs(h.app, `/api/pvp/match/${matchId}`, host);
  const stalled = await readAs(h.app, `/api/pvp/match/${matchId}`, guest);
  assert.notEqual(
    stalled.json().snapshot.phase,
    "ENGAGEMENT_LIVE",
    "the 30s grading gap must not have been replayed into the countdown",
  );

  // Feed clearly LESS than the 3-second countdown: still not live.
  const partial = await feedClock(h, matchId, [host, guest], 2_000);
  assert.notEqual(partial, "ENGAGEMENT_LIVE", "the full countdown has not elapsed yet");

  // Feed past 3 seconds total: now — and only now — combat begins.
  const done = await feedClock(h, matchId, [host, guest], 2_500);
  assert.equal(done, "ENGAGEMENT_LIVE", "combat begins after the full fresh countdown");
  await h.app.close();
});

test("a wrong answer is not a forfeit: a side that keeps polling is never disconnected", async () => {
  // THE LIVE BUG, END TO END. Both sides answer WRONG and the match must continue:
  // the wrong-answer penalty (the reduced magazine) is applied, the 3-second resume
  // countdown runs, and combat begins — with BOTH players still at full health.
  //
  // The regression it pins: liveness used to be measured on intent frames alone.
  // While a question is open neither side sends intents, so both intent-clocks go
  // stale; when combat resumes the MOVING side refreshes its clock while a side that
  // is only polling does not — exactly one "silent" side, and the poller was
  // forfeited as DISCONNECTED despite never leaving. Here the guest only ever polls
  // and the host also moves, across well past the disconnect grace, and the guest
  // must NOT be forfeited.
  const h = await buildHarness();
  h.setVerdict("WRONG");
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);
  await advanceToQuestion(h, matchId, guest);

  assert.equal(
    (await mutate(h.app, "POST", `/api/pvp/match/${matchId}/answer`, guest, {
      answerText: "a wrong answer",
    })).json().verdict,
    "WRONG",
  );
  assert.equal(
    (await mutate(h.app, "POST", `/api/pvp/match/${matchId}/answer`, host, {
      answerText: "also a wrong answer",
    })).json().verdict,
    "WRONG",
  );

  // Drive well past the disconnect grace. Each step: the host MOVES (intent) and the
  // guest ONLY POLLS. A single wrong answer must never end the match this way.
  const steps = Math.ceil((DISCONNECT_GRACE_MS * 2) / 500) + 6;
  let sawCountdown = false;
  let sawEngagement = false;
  for (let i = 0; i < steps; i += 1) {
    h.clock.t += 500;
    await sendIntent(h.app, matchId, host, i + 1); // host moves
    const g = await readAs(h.app, `/api/pvp/match/${matchId}`, guest); // guest only polls
    assert.equal(g.statusCode, 200, `guest poll ${i}: ${g.body}`);
    const body = g.json();
    assert.equal(body.result, null, `match ended with ${JSON.stringify(body.result)} at step ${i}`);
    if (body.snapshot?.resumeCountdownSeconds !== null) sawCountdown = true;
    if (body.snapshot?.phase === "ENGAGEMENT_LIVE") sawEngagement = true;
  }

  assert.ok(sawCountdown, "the 3-second post-answer countdown was shown");
  assert.ok(sawEngagement, "combat resumed after the countdown");

  const final = await readAs(h.app, `/api/pvp/match/${matchId}`, guest);
  const snap = final.json().snapshot;
  assert.equal(final.json().result, null, "the match is still live, not a forfeit");
  assert.equal(snap.self.health, PLAYER_MAX_HEALTH, "both players remain at full health");
  assert.equal(snap.opponent.health, PLAYER_MAX_HEALTH);
  // The configured wrong-answer penalty is the reduced magazine, and it was applied.
  assert.equal(snap.self.ammo, BULLETS_FOR_WRONG, "the wrong-answer magazine was granted");
  await h.app.close();
});

test("a side that stops all contact past the grace is still forfeited (disconnect preserved)", async () => {
  // The other half of the invariant: a genuine disconnect must still end the match.
  // The guest makes NO request at all; the host keeps polling. Once the guest has
  // been silent past the grace, it is forfeited — and this is labelled FORFEIT, the
  // distinct terminal reason, with the guest as the loser.
  const h = await buildHarness();
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);

  let result: { reason: string; loser: string | null } | null = null;
  const steps = Math.ceil((DISCONNECT_GRACE_MS * 2) / 1000) + 4;
  for (let i = 0; i < steps; i += 1) {
    h.clock.t += 1000;
    const r = await readAs(h.app, `/api/pvp/match/${matchId}`, host); // only the host is present
    if (r.statusCode === 200 && r.json().result) {
      result = r.json().result;
      break;
    }
  }
  assert.ok(result, "a genuinely silent side is eventually forfeited");
  assert.equal(result!.reason, "FORFEIT", "and it is labelled as a forfeit, distinctly");
  assert.equal(result!.loser, "B", "the side that vanished is the loser");
  await h.app.close();
});

test("a failed bank retries after the backoff, not before, then banks once and cleans up", async () => {
  // DETERMINISTIC, not timed. The retry is gated on the injected clock crossing
  // `nextAttemptMs`; the pass that fires it is driven by `h.tick(...)`, which resolves
  // only once the retry's settle (or the retirement delete) has actually run. So every
  // assertion below observes a completed effect, never a wall-clock guess that a real
  // 50 ms interval fired the right number of times — the guess that lost the race under
  // parallel load and made this case flaky. No real timer, no `delay()`.
  const h = await buildHarness({ startScheduler: false, driveScheduler: true });
  const host = uid("host");
  const guest = uid("guest");
  const matchId = await startMatch(h.app, host, guest);
  const resolvedAt = h.clock.t; // the forfeit resolves at the current (fixed) fake time

  // The first settlement attempt (in the forfeit handler) throws.
  h.failBanks(1);
  const forfeit = await mutate(h.app, "POST", `/api/pvp/match/${matchId}/forfeit`, guest);
  assert.equal(forfeit.statusCode, 200, "the forfeit still returns its result");
  assert.equal(h.bankCalls.count, 1, "one attempt was made, and it failed");
  assert.equal(h.banks.length, 0, "nothing banked yet");

  // Drive passes at the resolved instant: the retry is NOT due until +SETTLE_RETRY_BASE_MS,
  // so however many passes run, no second bank is attempted.
  for (let i = 0; i < 6; i += 1) await h.tick(resolvedAt);
  assert.equal(h.bankCalls.count, 1, "no retry at the resolved instant");

  // Just before the backoff elapses (+499 ms): still not due, across repeated passes.
  for (let i = 0; i < 4; i += 1) await h.tick(resolvedAt + 499);
  assert.equal(h.bankCalls.count, 1, "no retry before +500 ms");

  // At the backoff boundary (+500 ms): one driven pass fires exactly one retry, and it
  // succeeds. Further passes at the same instant must not re-bank a settled match.
  h.clock.t = resolvedAt + 500;
  await h.tick();
  assert.equal(h.bankCalls.count, 2, "exactly one retry at/after +500 ms");
  assert.equal(h.banks.length, 1, "banked exactly once on eventual success");
  await h.tick();
  await h.tick();
  assert.equal(h.bankCalls.count, 2, "no further attempts once banked");

  // Recoverable until retention, then retired cleanly (match, mapping, scheduled state).
  assert.equal((await readAs(h.app, "/api/pvp/active", guest)).json().kind, "RESULT");
  h.clock.t = resolvedAt + RETENTION_MS + 1;
  await h.tick();
  assert.equal((await readAs(h.app, "/api/pvp/active", guest)).json().kind, "NONE");
  assert.equal(
    (await readAs(h.app, `/api/pvp/match/${matchId}`, guest)).statusCode,
    404,
    "the match record was retired after successful settlement",
  );
  // No further bank attempts after cleanup: no leak, no spin.
  const callsAtCleanup = h.bankCalls.count;
  await h.tick();
  assert.equal(h.banks.length, 1, "still exactly one successful bank");
  assert.equal(h.bankCalls.count, callsAtCleanup, "no bank attempts after cleanup");
  await h.app.close();
});
