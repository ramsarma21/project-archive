// PvP routes: lobbies by code, the authoritative match loop, and the board.
//
// SHAPE. @pa/pvp is pure policy; this file is the only place with a clock, a socket-
// shaped surface and state. The authority for every live match runs HERE, in the API
// process, at engine-world's fixed 60 Hz, and clients send intents and read snapshots.
// A browser never simulates anything that counts.
//
// TRANSPORT, STATED HONESTLY. This is HTTP polling, because adding a WebSocket needs a
// plugin registration in app.ts and that file belongs to another agent this week. It is
// entirely adequate for two sessions on one machine — the owner's test tomorrow — and
// it is NOT what should ship for real 1v1 over a school network. The declared upgrade is
// one `@fastify/websocket` registration plus swapping `pvpPoll` for a socket handler;
// no policy in @pa/pvp changes, because the authority already ingests intent frames one
// at a time and emits snapshots on demand.
//
// PERSISTENCE. Lobbies and live matches are in memory and stay there: losing a lobby
// to a restart costs a six-character code, and losing a live match costs one fight.
// STANDING IS DURABLE, in `pvp_standing` (migration 007), because a leaderboard that
// evaporates is worse than no leaderboard — students believed it. The store owns every
// read and write of it and Postgres is the source of truth, not a cache; see
// ../pvp/standingStore.ts for why there is deliberately no in-memory copy.

import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import {
  advanceMatch,
  askableItems,
  assertPvpEligible,
  cancelLobby,
  createLobby,
  createPvpMatch,
  forfeitMatch,
  ingestIntent,
  joinLobby,
  lobbySides,
  markLobbyStarted,
  matchResult,
  normaliseMatchCode,
  parseCosmeticLoadout,
  parseIntentFrame,
  silentSides,
  snapshotsFor,
  submitVerdict,
  DEFAULT_COSMETIC_LOADOUT,
  FIELD_DT,
  PVP_GATES,
  referenceArena,
  type DuelSide,
  type Lobby,
  type LobbyMember,
  type PvpAuthority,
  type PvpVerdictEnvelope,
} from "@pa/pvp";
import { getSessionUser } from "../auth.js";
import { validAssessmentMutationRequest } from "../assessment/requestPolicy.js";
import { eligiblePvpItems, pvpQuestionBank } from "../pvp/questionPool.js";
import {
  postgresPvpStandingStore,
  type BankedVerdict,
  type PvpStandingStore,
} from "../pvp/standingStore.js";

const SESSION_COOKIE = "pa_session";

// ---- in-memory state (see the schema at the bottom) ------------------------

interface LiveMatch {
  authority: PvpAuthority;
  /** Wall clock of the last authoritative advance, for fixed-step catch-up. */
  lastAdvanceMs: number;
  /** Question text by round, kept server-side and handed out one round at a time. */
  questions: readonly { itemId: string; question: string }[];
  /** The lobby code this match came from. Kept because the banked row records it. */
  code: string;
}

const lobbiesByCode = new Map<string, Lobby>();
const matchesById = new Map<string, LiveMatch>();
const matchIdByProfile = new Map<string, string>();

/**
 * The composed PvP pool: the PvE items, the PvP-only hardening items, and the nine
 * shared in from the capstone. Built in ../pvp/questionPool.ts, which also owns the
 * mastery guard and the rule that PvP may only ask what the grader can grade. A
 * parse failure is loud: PvP without a question bank is not PvP.
 */
const bank = pvpQuestionBank;

// ---- identity --------------------------------------------------------------

interface Caller {
  readonly profileId: string;
  readonly handle: string;
  readonly rank: number;
}

/**
 * Resolve the caller, and give them a durable standing row if they have none.
 *
 * The handle is GENERATED from the profile's own id and never accepted from the client;
 * the store applies `parseHandle` even to our own output, so the only strings that can
 * ever reach a leaderboard are ones this system could have produced. It is read back
 * from the row rather than regenerated on each request, which is what makes a handle a
 * stable public identity across a restart.
 */
function callerResolver(store: PvpStandingStore) {
  return async function requireCaller(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Caller | null> {
    const user = await getSessionUser(request.cookies[SESSION_COOKIE]);
    if (!user) {
      await reply.code(401).send({ error: "AUTH_REQUIRED" });
      return null;
    }
    try {
      const standing = await store.ensure(user.profileId);
      return {
        profileId: user.profileId,
        handle: standing.handle,
        rank: standing.rank,
      };
    } catch (cause) {
      request.log.error({ cause, profileId: user.profileId }, "pvp: standing unavailable");
      await reply.code(503).send({ error: "STANDING_UNAVAILABLE" });
      return null;
    }
  };
}

function memberFor(caller: Caller, body: unknown): LobbyMember | { error: string } {
  const record = (body ?? {}) as Record<string, unknown>;
  // Cosmetics are the one client-supplied field, and they are parsed against a
  // catalogue rather than trusted. Ownership is a progression question; for the
  // playtest the catalogue is the default pair.
  const cosmetics =
    record.cosmetics === undefined
      ? { ok: true as const, loadout: DEFAULT_COSMETIC_LOADOUT }
      : parseCosmeticLoadout(record.cosmetics, {
          skinIds: [DEFAULT_COSMETIC_LOADOUT.skinId],
          weaponIds: [DEFAULT_COSMETIC_LOADOUT.weaponId],
        });
  if (!cosmetics.ok) return { error: `COSMETICS_${cosmetics.reason}` };

  const selected = Array.isArray(record.selectedAbilityIds)
    ? (record.selectedAbilityIds as unknown[]).filter(
        (id): id is string => typeof id === "string",
      )
    : undefined;

  return {
    profileId: caller.profileId,
    handle: caller.handle,
    // From the standing row, which starts everybody at Rank 1 while the unlock gate is
    // open: nobody has earned a Level.
    rank: caller.rank,
    unlockedAbilityIds: Array.isArray(record.unlockedAbilityIds)
      ? (record.unlockedAbilityIds as unknown[]).filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    ...(selected ? { selectedAbilityIds: selected } : {}),
    cosmetics: cosmetics.loadout,
    // Empty while the card gate is open. The path is live; the requirement is not.
    pvpLegalCardIds: [],
  };
}

function sideOf(authority: PvpAuthority, profileId: string): DuelSide | null {
  if (authority.participants.A.profileId === profileId) return "A";
  if (authority.participants.B.profileId === profileId) return "B";
  return null;
}

/**
 * The item the AUTHORITY says this round is asking, paired with its text.
 *
 * Deliberately NOT `questions[round - 1]`. A duel runs until a health pool empties,
 * so it can outlast its bank, and @pa/duel therefore chooses each round's item by a
 * seeded policy that recycles with disclosure rather than by an index. Indexing here
 * would hand the player one question and grade a different one — which `submitVerdict`
 * correctly refuses as WRONG_ITEM, so the whole match would stall at round one.
 *
 * Asking the state is also the only version of this that stays right: the policy is
 * the duel's to change, and this reads its answer rather than reimplementing it.
 */
function askedItem(live: LiveMatch): {
  readonly itemId: string;
  readonly question: string;
  readonly appearance: number;
  readonly recycled: boolean;
} | null {
  const state = live.authority.state;
  if (state.phase !== "QUESTION_PENDING") return null;
  const text = live.questions.find((entry) => entry.itemId === state.item.itemId);
  if (!text) return null;
  return {
    itemId: text.itemId,
    question: text.question,
    appearance: state.asked.appearance,
    recycled: state.asked.recycled,
  };
}

// ---- the authoritative loop ------------------------------------------------

/**
 * Bring a match up to now, then hand back the caller's snapshot.
 *
 * Advancing on read rather than on a timer keeps this file free of an interval that
 * would keep running after a match ended, and it is exact rather than approximate
 * because @pa/duel's clock is a fixed-step accumulator: the elapsed wall time decides
 * how many 60 Hz steps to run, and dropping frames is bounded by the engine's own
 * catch-up limit. A poll that arrives late does not fast-forward the fight.
 */
function pump(live: LiveMatch, nowMs: number): LiveMatch {
  const elapsedS = Math.max(0, (nowMs - live.lastAdvanceMs) / 1000);
  let authority = live.authority;
  let remaining = elapsedS;
  // Advance in engine-sized slices so one long gap cannot be handed to the reducer as
  // a single enormous delta.
  while (remaining > 0 && authority.phase === "LIVE") {
    const slice = Math.min(remaining, FIELD_DT * 5);
    authority = advanceMatch(authority, slice).authority;
    remaining -= slice;
  }
  const silent = silentSides(authority, nowMs);
  if (silent.length === 1) {
    authority = forfeitMatch(authority, silent[0]!, "DISCONNECTED");
  }
  return { ...live, authority, lastAdvanceMs: nowMs };
}

/**
 * One match, one writer at a time.
 *
 * WHY THIS IS NEEDED AND WHERE IT BITES. Every handler here reads the live match out
 * of a Map, derives a new authority from it, and writes it back. That is safe as long
 * as nothing happens in between — and in the answer route something very slow happens
 * in between: the answer goes to a classifier over the network and takes seconds.
 *
 * Two players answering at the same moment therefore both read the same authority,
 * both wait for grading, and both write; the second write is derived from a state that
 * never saw the first verdict, so ONE VERDICT IS SILENTLY LOST. The round then waits
 * forever for a side that has already answered, which presents as a duel that reaches
 * round one and stops — no error anywhere, on either client.
 *
 * Simultaneous answers are not a corner case: it is two thirteen-year-olds racing each
 * other. So the answer path is serialised per match. The queue is per match id rather
 * than global, so one slow classifier call cannot hold up another duel, and it is a
 * promise chain rather than a lock because there is nothing to time out — the work
 * either finishes or the request fails, and either way the next in line runs.
 */
const matchQueues = new Map<string, Promise<void>>();

function serialiseOnMatch<T>(matchId: string, work: () => Promise<T>): Promise<T> {
  const queued = (matchQueues.get(matchId) ?? Promise.resolve()).then(work, work);
  // Settled either way: a failed answer must not wedge the match's queue.
  matchQueues.set(
    matchId,
    queued.then(
      () => undefined,
      () => undefined,
    ),
  );
  return queued;
}

/**
 * Match ids this process has already banked. A fast path, NOT the guard.
 *
 * `settle` runs on EVERY read and every intent post, and a resolved match keeps
 * answering both while the two clients poll to discover the result. Unguarded, the
 * winner banks the delta once per poll and the loser floors at zero within a second or
 * two of the fight ending — the leaderboard is destroyed by the first completed duel,
 * and it looks like a scoring design fault rather than a missing idempotence check.
 *
 * This set stops those polls reaching the database at all. What actually makes the
 * write happen once is the primary key on `pvp_match`: a set in one process is not a
 * guarantee across a restart, and a restart in the seconds between a knockout and the
 * clients noticing is exactly when this would be tested.
 */
const settledMatchIds = new Set<string>();

/** The committed verdicts, off the authority's own log. Labels only, never text. */
function bankedVerdicts(live: LiveMatch): readonly BankedVerdict[] {
  return live.authority.log.flatMap((event) =>
    event.type === "VERDICT_COMMITTED"
      ? [
          {
            side: event.side,
            roundIndex: event.round,
            itemId: event.verdict.itemId,
            itemVersion: event.verdict.itemVersion,
            kind: event.verdict.kind,
            source: event.verdict.source,
            responseRef: event.verdict.responseRef,
          },
        ]
      : [],
  );
}

async function settle(
  live: LiveMatch,
  store: PvpStandingStore,
  log: FastifyBaseLogger,
): Promise<void> {
  const result = matchResult(live.authority);
  if (!result) return;
  const matchId = live.authority.identity.matchId;
  if (settledMatchIds.has(matchId)) return;
  const a = live.authority.participants.A;
  const b = live.authority.participants.B;
  try {
    const banked = await store.bank({
      result,
      code: live.code,
      seed: live.authority.identity.seed,
      startedAtMs: live.authority.identity.startedAtMs,
      participants: {
        A: { profileId: a.profileId, handle: a.handle, rank: a.rank },
        B: { profileId: b.profileId, handle: b.handle, rank: b.rank },
      },
      verdicts: bankedVerdicts(live),
    });
    // Marked only once the write has committed. Marking first and failing would lose
    // the result silently, which is the one outcome worse than banking it twice.
    settledMatchIds.add(matchId);
    if (banked) log.info({ matchId, winner: result.winner }, "pvp: standing banked");
  } catch (cause) {
    // Left unmarked on purpose: the next poll tries again, and both clients are
    // polling. A result that could not be written is not a result that did not happen.
    log.error({ cause, matchId }, "pvp: banking the result failed; will retry on the next poll");
    return;
  }
  matchIdByProfile.delete(a.profileId);
  matchIdByProfile.delete(b.profileId);
}

// ---- routes ----------------------------------------------------------------

export interface PvpRouteOptions {
  /**
   * @pa/grading's `verifyVerdictReceipt`, bound to the server's secret. Injected so
   * this file holds no crypto and no secret of its own.
   */
  readonly verifyReceipt: (
    envelope: PvpVerdictEnvelope,
    binding: { profileId: string; attemptId: string; roundIndex: number },
    receipt: string,
  ) => boolean;
  /** Grades an answer server-side and returns the signed envelope. */
  readonly gradeAnswer: (input: {
    profileId: string;
    matchId: string;
    roundIndex: number;
    itemId: string;
    answerText: string;
  }) => Promise<{ envelope: PvpVerdictEnvelope; receipt: string }>;
  /**
   * Concepts this profile has mastered, for `PVP.GUARD.CAPSTONE_ALREADY_MASTERED`.
   * Injected because the progression store is the API's, not this file's, and
   * because the safe default is knowable: a profile whose mastery cannot be read is
   * treated as having mastered nothing, which withholds capstone items rather than
   * leaking them.
   */
  readonly masteredConcepts: (profileId: string) => Promise<readonly string[]>;
  /**
   * Durable standing. Injected so a test can hand over a fake without a database,
   * and defaulted so app.ts does not have to know PvP has one.
   */
  readonly standings?: PvpStandingStore;
}

/**
 * CSRF for every PvP mutation, matching the assessment and grading routes exactly.
 *
 * PvP had none while its siblings did, and an inconsistent posture is worse than a
 * uniformly weak one: the exception is invisible to the next reader, who reasonably
 * assumes the pattern holds. A duel mutation moves standing points and spends a
 * question, so it is a state change worth the same protection as an assessment
 * answer.
 */
function csrfOk(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = request.headers["x-pa-csrf-token"];
  if (
    !validAssessmentMutationRequest({
      sessionId: request.cookies[SESSION_COOKIE],
      csrfToken: typeof token === "string" ? token : undefined,
      origin: request.headers.origin,
      allowedOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    })
  ) {
    void reply.code(403).send({ error: "CSRF_INVALID" });
    return false;
  }
  return true;
}

export async function registerPvpRoutes(
  app: FastifyInstance,
  options: PvpRouteOptions,
): Promise<void> {
  const standings = options.standings ?? postgresPvpStandingStore();
  const requireCaller = callerResolver(standings);

  // ---- lobbies -------------------------------------------------------------

  app.post("/api/pvp/lobby", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    if (!csrfOk(request, reply)) return;
    const eligible = assertPvpEligible({
      profileId: caller.profileId,
      completedChapterIds: [],
      pvpLegalCardIds: [],
    });
    if (!eligible.ok) {
      return reply.code(403).send({ error: eligible.reason, message: eligible.detail });
    }
    const member = memberFor(caller, request.body);
    if ("error" in member) return reply.code(400).send({ error: member.error });

    const lobby = createLobby(member, Date.now());
    lobbiesByCode.set(lobby.code, lobby);
    return {
      code: lobby.code,
      status: lobby.status,
      // The host's own handle only. A lobby reveals nothing about who may join.
      handle: caller.handle,
      gates: PVP_GATES,
    };
  });

  app.post("/api/pvp/lobby/:code/join", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    if (!csrfOk(request, reply)) return;
    const code = normaliseMatchCode((request.params as { code?: string }).code);
    if (!code) return reply.code(400).send({ error: "MATCH_CODE_INVALID" });
    const lobby = lobbiesByCode.get(code);
    if (!lobby) return reply.code(404).send({ error: "LOBBY_NOT_FOUND" });

    const member = memberFor(caller, request.body);
    if ("error" in member) return reply.code(400).send({ error: member.error });
    const joined = joinLobby(lobby, member, Date.now());
    if (!joined.ok) return reply.code(409).send({ error: joined.reason });

    const sides = lobbySides(joined.lobby);
    if (!sides) return reply.code(500).send({ error: "LOBBY_INCONSISTENT" });

    const arena = referenceArena();
    const legal = { A: sides.A.pvpLegalCardIds, B: sides.B.pvpLegalCardIds };
    // Two gates, then the WHOLE remaining pool goes to the duel. `askableItems` is
    // the PvP-legal card rule; `eligiblePvpItems` is the capstone mastery guard and
    // the grader's coverage. Nothing here draws six: a duel runs until a health pool
    // empties, and @pa/duel's `askQuestion` owns which item each round asks. Handing
    // it a six-item slice was what made an open-ended match start repeating at round
    // seven, and no `rounds` is passed so DUEL_ROUND_CEILING stays the ceiling.
    const mastered = {
      A: await options.masteredConcepts(sides.A.profileId),
      B: await options.masteredConcepts(sides.B.profileId),
    };
    const questions = eligiblePvpItems({
      askable: askableItems(bank(), legal),
      mastered,
    });
    if (questions.length === 0) {
      return reply.code(409).send({
        error: "NO_QUESTIONS",
        message: "no item is both askable by these two players and gradable",
      });
    }

    const matchId = `pvp_${joined.lobby.code}_${joined.lobby.createdAtMs}`;
    const created = createPvpMatch({
      identity: { matchId, seed: joined.lobby.seed, startedAtMs: Date.now() },
      participants: {
        A: { ...sides.A },
        B: { ...sides.B },
      },
      world: arena.world,
      questions,
      placement: arena.placement,
    });
    if (!created.ok) {
      return reply.code(409).send({ error: "MATCH_NOT_STARTED", message: created.reason });
    }

    matchesById.set(matchId, {
      authority: created.authority,
      lastAdvanceMs: Date.now(),
      questions: questions.map((item) => ({
        itemId: item.itemId,
        question: item.question,
      })),
      code,
    });
    matchIdByProfile.set(sides.A.profileId, matchId);
    matchIdByProfile.set(sides.B.profileId, matchId);
    lobbiesByCode.set(code, markLobbyStarted(joined.lobby, matchId));

    return { matchId, status: "STARTED", side: "B" };
  });

  app.delete("/api/pvp/lobby/:code", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    if (!csrfOk(request, reply)) return;
    const code = normaliseMatchCode((request.params as { code?: string }).code);
    const lobby = code ? lobbiesByCode.get(code) : undefined;
    if (!code || !lobby) return reply.code(404).send({ error: "LOBBY_NOT_FOUND" });
    if (lobby.host.profileId !== caller.profileId) {
      return reply.code(403).send({ error: "NOT_LOBBY_HOST" });
    }
    lobbiesByCode.set(code, cancelLobby(lobby));
    return { code, status: "CANCELLED" };
  });

  /** Where the host learns that somebody joined, and which side it is. */
  app.get("/api/pvp/lobby/:code", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    const code = normaliseMatchCode((request.params as { code?: string }).code);
    const lobby = code ? lobbiesByCode.get(code) : undefined;
    if (!code || !lobby) return reply.code(404).send({ error: "LOBBY_NOT_FOUND" });
    const side =
      lobby.host.profileId === caller.profileId
        ? "A"
        : lobby.guest?.profileId === caller.profileId
          ? "B"
          : null;
    if (!side) return reply.code(403).send({ error: "NOT_IN_LOBBY" });
    return { code, status: lobby.status, matchId: lobby.matchId, side };
  });

  // ---- the live match ------------------------------------------------------

  /**
   * Submit intent frames and read back the caller's snapshot. One request carries a
   * batch, because a 60 Hz HTTP round trip is not a thing; the authority still accepts
   * them one at a time, so the acceptance policy is identical under a socket.
   */
  app.post("/api/pvp/match/:matchId/intents", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    if (!csrfOk(request, reply)) return;
    const matchId = (request.params as { matchId?: string }).matchId ?? "";
    const live = matchesById.get(matchId);
    if (!live) return reply.code(404).send({ error: "MATCH_NOT_FOUND" });
    const side = sideOf(live.authority, caller.profileId);
    if (!side) return reply.code(403).send({ error: "NOT_IN_MATCH" });

    const body = (request.body ?? {}) as { frames?: unknown };
    const frames = Array.isArray(body.frames) ? body.frames : [];
    const now = Date.now();
    let pumped = pump(live, now);
    const rejected: string[] = [];
    for (const raw of frames.slice(0, 32)) {
      const parsed = parseIntentFrame(raw);
      if (!parsed.ok) {
        rejected.push(`${parsed.reason}:${parsed.detail}`);
        continue;
      }
      const ingested = ingestIntent(pumped.authority, side, parsed.frame, now);
      pumped = { ...pumped, authority: ingested.authority };
      if (!ingested.ok) rejected.push(`${ingested.reason}:${ingested.detail}`);
    }
    matchesById.set(matchId, pumped);
    await settle(pumped, standings, request.log);
    return {
      snapshot: snapshotsFor(pumped.authority)[side],
      rejected,
      result: matchResult(pumped.authority),
    };
  });

  /** Read-only poll, for the countdown and the question phases. */
  app.get("/api/pvp/match/:matchId", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    const matchId = (request.params as { matchId?: string }).matchId ?? "";
    const live = matchesById.get(matchId);
    if (!live) return reply.code(404).send({ error: "MATCH_NOT_FOUND" });
    const side = sideOf(live.authority, caller.profileId);
    if (!side) return reply.code(403).send({ error: "NOT_IN_MATCH" });

    const pumped = pump(live, Date.now());
    matchesById.set(matchId, pumped);
    await settle(pumped, standings, request.log);
    const snapshot = snapshotsFor(pumped.authority)[side];
    const question = askedItem(pumped);
    return {
      snapshot,
      // The question text is handed out one round at a time, and only while that round
      // is being asked. A client cannot fetch a later round's item during this one.
      // `recycled` is passed through rather than hidden: a duel that outlasts its bank
      // repeats, and telling the player is better than letting them wonder.
      question,
      result: matchResult(pumped.authority),
    };
  });

  /**
   * Answer the round's question.
   *
   * THE ANSWER TEXT ENDS HERE. It is graded server-side and the verdict is committed
   * by the authority; the text is never stored on the match, never included in a
   * snapshot, and never sent to the opponent in any form — not as text, not as a
   * length, not as a hash. What the opponent sees is that this side has answered, and
   * afterwards the bullet count the verdict produced.
   */
  app.post("/api/pvp/match/:matchId/answer", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    if (!csrfOk(request, reply)) return;
    const matchId = (request.params as { matchId?: string }).matchId ?? "";
    const live = matchesById.get(matchId);
    if (!live) return reply.code(404).send({ error: "MATCH_NOT_FOUND" });
    const side = sideOf(live.authority, caller.profileId);
    if (!side) return reply.code(403).send({ error: "NOT_IN_MATCH" });

    const body = (request.body ?? {}) as { answerText?: unknown };
    if (typeof body.answerText !== "string" || body.answerText.length === 0) {
      return reply.code(400).send({ error: "ANSWER_REQUIRED" });
    }
    if (body.answerText.length > 4000) {
      return reply.code(400).send({ error: "ANSWER_TOO_LONG" });
    }
    const answerText = body.answerText;

    // Grading is a network call, so the read and the write are seconds apart. Queued
    // per match: see `serialiseOnMatch` for the verdict this used to lose.
    return serialiseOnMatch(matchId, async () => {
      // Re-read INSIDE the queue. The authority captured above may already be a
      // generation behind — it is, whenever the opponent answered first.
      const current = matchesById.get(matchId);
      if (!current) return reply.code(404).send({ error: "MATCH_NOT_FOUND" });

      const pumped = pump(current, Date.now());
      const round = pumped.authority.state.round;
      const item = askedItem(pumped);
      if (!item) return reply.code(409).send({ error: "NO_QUESTION_THIS_ROUND" });

      const graded = await options.gradeAnswer({
        profileId: caller.profileId,
        matchId,
        roundIndex: round,
        itemId: item.itemId,
        answerText,
      });
      // Pumped again after grading: the fight does not stop for a classifier, and the
      // state the verdict is committed against should be the one that exists now.
      const advanced = pump(pumped, Date.now());
      const committed = submitVerdict(
        advanced.authority,
        side,
        graded.envelope,
        graded.receipt,
        options.verifyReceipt,
      );
      matchesById.set(matchId, { ...advanced, authority: committed.authority });
      if (!committed.ok) {
        return reply.code(409).send({ error: committed.reason, message: committed.detail });
      }
      return {
        // The player learns their own verdict, because their bullet count depends on it.
        verdict: graded.envelope.kind,
        snapshot: snapshotsFor(committed.authority)[side],
      };
    });
  });

  app.post("/api/pvp/match/:matchId/forfeit", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    if (!csrfOk(request, reply)) return;
    const matchId = (request.params as { matchId?: string }).matchId ?? "";
    const live = matchesById.get(matchId);
    if (!live) return reply.code(404).send({ error: "MATCH_NOT_FOUND" });
    const side = sideOf(live.authority, caller.profileId);
    if (!side) return reply.code(403).send({ error: "NOT_IN_MATCH" });
    const forfeited = { ...live, authority: forfeitMatch(live.authority, side, "ABANDONED") };
    matchesById.set(matchId, forfeited);
    await settle(forfeited, standings, request.log);
    return { result: matchResult(forfeited.authority) };
  });

  // ---- the board -----------------------------------------------------------

  /** Handles, Ranks and points. No profile ids, no names, no class or school. */
  app.get("/api/pvp/leaderboard", async (request, reply) => {
    try {
      return { rows: await standings.board() };
    } catch (cause) {
      // A board that cannot be read is not an empty board. Saying "nobody has played"
      // when the truth is "the database did not answer" is the kind of quiet lie that
      // gets shipped, so this is a 503 and the client shows it as one.
      request.log.error({ cause }, "pvp: the leaderboard could not be read");
      return reply.code(503).send({ error: "LEADERBOARD_UNAVAILABLE" });
    }
  });
}

// ---------------------------------------------------------------------------
// WHAT LANDED, AND THE ONE THING THAT DELIBERATELY DID NOT
// ---------------------------------------------------------------------------
//
// The registration this file used to ask for is in app.ts, and the schema it wrote out
// is migration 007_pvp_standing.sql: pvp_standing, pvp_match and pvp_match_verdict,
// with two corrections to what was sketched here — the profile table is `profiles` and
// its key is a uuid, and both match references cascade on delete so removing a profile
// is not blocked by a duel it played.
//
// pvp_match_intent_log is NOT created, and that is a decision rather than an omission.
// It would make a disputed result re-derivable, which is worth having: @pa/duel is
// replay-exact, so a seed plus the accepted intent stream recomputes an outcome for an
// auditor who trusts neither client. But the authority holds only the LATEST accepted
// intent per side and never retains the stream, so the table would have nothing to
// write to it. Shipping an empty table that looks like an audit trail is worse than
// naming the gap. Re-derivability is a change to what the authority keeps, and the
// table belongs with that change.
