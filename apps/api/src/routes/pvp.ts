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
  allAskableCardIds,
  askableItems,
  assertPvpEligible,
  awaitingVerdicts,
  cancelLobby,
  createLobby,
  createPvpMatch,
  decayHeldIntents,
  forfeitMatch,
  ingestIntent,
  joinLobby,
  lobbyExpired,
  lobbySides,
  markLobbyStarted,
  markSeen,
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
  type PvpMatchResult,
  type PvpVerdictEnvelope,
} from "@pa/pvp";
import { getSessionUser } from "../auth.js";
import { effectiveSessionId } from "../devSession.js";
import { validAssessmentMutationRequest } from "../assessment/requestPolicy.js";
import { eligiblePvpItems, pvpQuestionBank } from "../pvp/questionPool.js";
import {
  evaluateEvidence,
  m1EvidencePolicyFor,
  m1EvidenceProjectionFor,
  parseSelectedCardIds,
} from "../duels/evidence.js";
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
  questions: readonly {
    itemId: string;
    question: string;
    /** The card ids this item draws on. Titles may be shown; propositions never. */
    codexCardIds: readonly string[];
  }[];
  /** The lobby code this match came from. Kept because the banked row records it. */
  code: string;
  /**
   * The card universe the evidence hand is dealt from — the INTERSECTION of both
   * players' PvP-legal cards, computed once at match creation. Both sides derive the
   * same deterministic hand from it, and every offered card is one both players are
   * entitled to place, so a side is never dealt a decoy it cannot legally select.
   */
  evidenceDeck: readonly string[];
  /**
   * Wall clock the match first reached a terminal phase, or null while it is live.
   * A resolved match is kept a short while so both clients can poll the result out,
   * then swept — see `RESOLVED_RETENTION_MS` and `sweep`.
   */
  resolvedAtMs: number | null;
}

const lobbiesByCode = new Map<string, Lobby>();
const matchesById = new Map<string, LiveMatch>();
const matchIdByProfile = new Map<string, string>();
/**
 * The open lobby a profile is hosting, if any. One per profile: a student cannot
 * sit on two codes at once, and a stale entry is cleaned by `sweep` rather than
 * left to accumulate.
 */
const lobbyCodeByProfile = new Map<string, string>();

/**
 * How long a resolved or forfeited match is kept before it is swept.
 *
 * Both clients keep polling a finished match to learn how it ended, so it cannot be
 * deleted the instant it resolves — the poll would get MATCH_NOT_FOUND and read as
 * "the match vanished" rather than "you lost". A minute is comfortably longer than
 * the result-screen poll and short enough that memory does not grow across a lesson.
 * After it, the honest terminal answer to a poll is MATCH_NOT_FOUND, and a reloaded
 * client recovers its state from `GET /api/pvp/active` instead.
 */
const RESOLVED_RETENTION_MS = 60_000;

/** How long a stale in-memory lobby lingers before `sweep` removes it. */
const LOBBY_SWEEP_GRACE_MS = 60_000;

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
function callerResolver(
  store: PvpStandingStore,
  authenticate: (sessionId: string | undefined) => Promise<{ profileId: string } | null>,
) {
  return async function requireCaller(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Caller | null> {
    // effectiveSessionId lets a tab's dev-session header outrank the shared cookie
    // in non-production, so two windows can duel as two independent local profiles.
    const user = await authenticate(effectiveSessionId(request));
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

/**
 * Ability fields a client is not allowed to send yet.
 *
 * ABILITIES ARE DEFERRED, so a client that names an unlocked ability, a selected
 * loadout or a raw loadout is either ahead of the server or trying to grant itself
 * a power the server has not defined. Either way the honest answer is to REFUSE the
 * request rather than silently drop the field — a dropped field is a lie the next
 * reader inherits, and a duel that quietly ignored a loadout the player thought they
 * equipped is worse than one that told them the loadout is not a thing yet. The
 * server assigns the empty pool itself; it never reads one off the wire.
 */
const REJECTED_ABILITY_FIELDS = [
  "unlockedAbilityIds",
  "selectedAbilityIds",
  "loadout",
  "abilities",
  "abilityIds",
] as const;

/**
 * Card fields a client is not allowed to send, EVER.
 *
 * The PvP-legal card set decides which questions a match may ask, so a client that
 * could name its own cards could grant itself questions its opponent cannot be asked
 * — the exact unfairness the intersection rule exists to prevent. The server derives
 * the caller's cards from an access policy and the authoritative snapshot (see
 * `resolvePvpCardIds`); a body that carries any of these is refused rather than
 * silently ignored, because a dropped field is a lie the next reader inherits.
 */
const REJECTED_CARD_FIELDS = [
  "pvpLegalCardIds",
  "codexCardIds",
  "cardIds",
  "cards",
] as const;

function memberFor(
  caller: Caller,
  body: unknown,
  pvpLegalCardIds: readonly string[],
): LobbyMember | { error: string } {
  const record = (body ?? {}) as Record<string, unknown>;

  // Refuse any client-supplied ability or loadout field. Presence is enough: the
  // gate is open and the pool is empty, so there is no legitimate value for these.
  for (const field of REJECTED_ABILITY_FIELDS) {
    if (record[field] !== undefined) {
      return { error: "ABILITIES_NOT_ACCEPTED" };
    }
  }

  // Refuse any client-supplied card field. Cards are server-derived; a body that
  // names them is trying to choose its own questions.
  for (const field of REJECTED_CARD_FIELDS) {
    if (record[field] !== undefined) {
      return { error: "CARDS_NOT_ACCEPTED" };
    }
  }

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

  return {
    profileId: caller.profileId,
    handle: caller.handle,
    // From the standing row, which starts everybody at Rank 1 while the unlock gate is
    // open: nobody has earned a Level.
    rank: caller.rank,
    // Assigned by the server, never read from the client: abilities are deferred, so
    // the pool is empty and there is no selected loadout.
    unlockedAbilityIds: [],
    cosmetics: cosmetics.loadout,
    // SERVER-DERIVED, never off the wire — resolved from the access policy and, when
    // it demands it, the authoritative snapshot. The card gate is live now, so these
    // are load-bearing: `askableItems` asks only what both players' cards allow.
    pvpLegalCardIds,
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
  readonly codexCardIds: readonly string[];
  /** The offered evidence hand, deterministic in the item id and the match deck. */
  readonly offeredCardIds: readonly string[];
  /** How many supporting cards a selection must place. Public; never which. */
  readonly minSupport: number;
  readonly maxSelectable: number;
} | null {
  const state = live.authority.state;
  if (state.phase !== "QUESTION_PENDING") return null;
  const text = live.questions.find((entry) => entry.itemId === state.item.itemId);
  if (!text) return null;
  // The safe public projection of the evidence policy: the offered hand and the
  // minimum, both sides identical because the deck is the match's shared one. Never
  // the relevant/accepted/incompatible cards — those stay in the policy on the
  // server and are re-derived to grade the submission.
  const projection = m1EvidenceProjectionFor(text.itemId, live.evidenceDeck);
  return {
    itemId: text.itemId,
    question: text.question,
    appearance: state.asked.appearance,
    recycled: state.asked.recycled,
    // Card ids only — never the card propositions, which usually contain the answer.
    // These are a subset of the cards the caller holds by construction: the item is
    // askable only because both sides hold every card it names.
    codexCardIds: text.codexCardIds,
    offeredCardIds: projection.offeredCardIds,
    minSupport: projection.minSupport,
    maxSelectable: projection.maxSelectable,
  };
}

// ---- the authoritative loop ------------------------------------------------

/**
 * The most wall time a single advance pass may consume, in seconds.
 *
 * This is the catch-up bound. One `pump` — whether from a poll or from the scheduler
 * — advances at most this much, so a poll that arrives after a long gap runs five
 * engine ticks and no more, rather than replaying the whole gap in one request. The
 * remaining gap is caught up over subsequent passes, and a genuinely disconnected
 * side is forfeited on the real-time silence check regardless of how far the sim has
 * caught up.
 */
const CATCH_UP_STEP_S = FIELD_DT * 5;

/**
 * How often the server-side scheduler takes a pass at every live match.
 *
 * Comfortably shorter than the catch-up bound (~83 ms) so the sim tracks real time
 * pass to pass rather than falling steadily behind.
 */
const SCHEDULER_INTERVAL_MS = 50;

/**
 * @pa/duel phases whose clock is FROZEN — the reducer advances them with zero ticks:
 * QUESTION_PENDING is genuinely untimed (a player thinking about a question), and
 * VERDICT_COMMITTED / ROUND_RESOLVED are instant transitions (grant bullets, open the
 * next round) that consume no duel time. Wall time spent in any of these must NOT be
 * fed to the sim, or the seconds a slow grading call takes would be replayed into the
 * resume countdown and the fight — see `pump`.
 */
const UNTIMED_DUEL_PHASES = new Set<string>([
  "QUESTION_PENDING",
  "VERDICT_COMMITTED",
  "ROUND_RESOLVED",
]);

/**
 * Advance a match by at most one catch-up bound, then hand it back.
 *
 * BOUNDED, not a loop: the previous version drained the whole elapsed gap in slices
 * inside one call, which is the unbounded catch-up the audit rejected. Now each pass
 * advances `min(elapsed, CATCH_UP_STEP_S)` and moves `lastAdvanceMs` forward by only
 * what it consumed, so a large gap is caught up across passes.
 *
 * TIME IS DISCARDED WHILE UNTIMED. When the duel's clock is frozen — a question is
 * open, or a verdict/round transition is pending — the wall time that elapsed is
 * thrown away: `lastAdvanceMs` jumps straight to `nowMs`. Otherwise the seconds (or
 * minutes) a grading call is in flight, during which the match queue is held and no
 * pass runs, would sit as a backlog that the first timed pass replays — fast-
 * forwarding the fresh 3-second resume countdown and the combat after it. Discarding
 * it means the countdown that begins after both answers lands runs its FULL duration
 * in real time from a clean clock.
 */
function pump(live: LiveMatch, nowMs: number): LiveMatch {
  // A side gone quiet for seconds has its held intent zeroed before the fight is
  // advanced, so a disconnect does not keep walking a body into a wall for the whole
  // grace window. Decay first, forfeit later — see `INTENT_DECAY_MS`.
  let authority = decayHeldIntents(live.authority, nowMs);

  let lastAdvanceMs: number;
  if (authority.phase === "LIVE" && UNTIMED_DUEL_PHASES.has(authority.state.phase)) {
    // Frozen phase: run only the instant transition (zero duel time), and DISCARD the
    // elapsed wall time so it cannot replay into the next timed phase.
    authority = advanceMatch(authority, 0).authority;
    lastAdvanceMs = nowMs;
  } else {
    const elapsedS = Math.min(
      Math.max(0, (nowMs - live.lastAdvanceMs) / 1000),
      CATCH_UP_STEP_S,
    );
    if (elapsedS > 0 && authority.phase === "LIVE") {
      authority = advanceMatch(authority, elapsedS).authority;
    }
    // Advance the clock by ONLY what was consumed, so a capped pass leaves the rest of
    // the gap for the next one instead of skipping it.
    lastAdvanceMs = live.lastAdvanceMs + elapsedS * 1000;
  }

  // The silence check reads REAL time, not sim time, so a long disconnect forfeits on
  // the first pass even though the sim is only a bound further along.
  const silent = silentSides(authority, nowMs);
  if (silent.length === 1) {
    authority = forfeitMatch(authority, silent[0]!, "DISCONNECTED");
  }
  // Stamp the moment the match first became terminal, so `sweep` can retire it once
  // both clients have had time to read the result.
  const resolvedAtMs =
    live.resolvedAtMs ?? (authority.phase === "LIVE" ? null : nowMs);
  return { ...live, authority, lastAdvanceMs, resolvedAtMs };
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

/** Match ids with a scheduled advancement pass pending or running, coalesced to one. */
const scheduledMatches = new Set<string>();

/**
 * Terminal matches whose standing bank has not yet committed, with the wall clock of
 * the next allowed retry and how many attempts have been made. This is what stops a
 * failed bank from being lost when the clients stop polling: the scheduler retries it.
 */
const settleRetry = new Map<string, { nextAttemptMs: number; attempts: number }>();
/** Terminal matches with a settle-retry pass pending or running, coalesced to one. */
const retryingMatches = new Set<string>();
/** First retry after `SETTLE_RETRY_BASE_MS`, doubling, capped — never a hot loop. */
const SETTLE_RETRY_BASE_MS = 500;
const SETTLE_RETRY_MAX_MS = 30_000;

/**
 * Chain `work` after the current tail for `key` in `queues`, and — this is the part
 * the audit called out — remove the queue's identity ONLY once the exact tail this
 * call installed has drained and nothing newer chained after it.
 *
 * The bug being fixed: `sweep` used to `map.delete(key)` while work might still be
 * queued, so the next caller created a FRESH queue starting from `Promise.resolve()`
 * and ran concurrently with the still-pending work — the serialization silently
 * broke exactly when it was under load. Here nobody deletes a live queue: the tail
 * self-cleans, and only if it is still the tail (`get(key) === tail`), so a call that
 * chained after it keeps the queue alive.
 */
function chainQueue<T>(
  queues: Map<string, Promise<void>>,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const queued = (queues.get(key) ?? Promise.resolve()).then(work, work);
  const tail = queued.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  // Retire the tail only after it drains, and only if it is still the tail.
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return queued;
}

function serialiseOnMatch<T>(matchId: string, work: () => Promise<T>): Promise<T> {
  return chainQueue(matchQueues, matchId, work);
}

/**
 * Profile-scoped serialization for the lobby lifecycle: create, join, cancel and the
 * match assignment inside a join.
 *
 * WHY PROFILE-SCOPED, AND WHY MULTI-KEY. The commitment being protected is per
 * PROFILE — a student may hold at most one open lobby or one live match — and the
 * races that violate it all reduce to two operations touching the same profile at
 * once: two creates, a create racing a join, a guest joining two lobbies, two guests
 * joining one lobby (both need the HOST's lock), a cancel racing a join (both need
 * the host's lock). Serializing on the profile(s) each operation commits closes all
 * of them, so there is no separate per-lobby queue to keep in step. Create locks the
 * caller; cancel locks the host (the caller); join locks BOTH host and guest.
 *
 * Deadlock-free because the keys are acquired as one set: a call snapshots every
 * key's current tail, waits for all of them together, then runs — it never holds one
 * profile's lock while waiting to acquire another's in a different order.
 *
 * INVARIANT — a `serialiseOnProfiles` callback MUST NOT recursively reacquire a
 * profile it already holds. The lock is a promise chain, not a re-entrant mutex: a
 * nested `serialiseOnProfiles([sameProfile], …)` inside the callback would chain
 * AFTER the very tail it is running as, and wait for itself forever. Do all work for a
 * profile in one pass; never call create/join/cancel (or any helper that locks the
 * same profile) from inside another's callback.
 */
const profileQueues = new Map<string, Promise<void>>();

function serialiseOnProfiles<T>(
  profileIds: readonly string[],
  work: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(profileIds)].sort();
  const prior = keys.map((key) => profileQueues.get(key) ?? Promise.resolve());
  const run = Promise.allSettled(prior).then(work);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  for (const key of keys) profileQueues.set(key, tail);
  // Self-clean each key once this tail drains, unless a newer call chained after it.
  void tail.then(() => {
    for (const key of keys) if (profileQueues.get(key) === tail) profileQueues.delete(key);
  });
  return run;
}

/**
 * Retire state that has served its purpose.
 *
 * Nothing here runs on a timer of its own — the scheduler drives it — so it is also
 * swept lazily at the head of every lobby and match request. Cheap: the maps hold at
 * most a class's worth of entries. What it removes:
 *
 *   - Cancelled or expired lobbies, and OPEN lobbies past their expiry, plus the
 *     host's `lobbyCodeByProfile` entry so a new lobby is allowed.
 *   - STARTED lobbies whose match has already been swept.
 *   - Resolved matches PAST THE RETENTION WINDOW that have ALREADY BANKED — retired
 *     through the match queue by `retireMatch`, never synchronously here, so cleanup
 *     cannot race an in-flight settle. Within the window, or before a successful
 *     bank, the terminal record and profile mappings are KEPT so `GET /api/pvp/active`
 *     can answer RESULT and a failed bank can retry.
 *
 * It never deletes a queue identity. `matchQueues` self-clean when their tail drains
 * (see `chainQueue`), so removing them here — while a request might be queued — is
 * exactly the race the audit rejected.
 */
function sweep(nowMs: number): void {
  for (const [code, lobby] of lobbiesByCode) {
    const stale =
      lobby.status === "CANCELLED" ||
      lobby.status === "EXPIRED" ||
      lobbyExpired(lobby, nowMs) ||
      (lobby.status === "STARTED" && lobby.matchId !== null && !matchesById.has(lobby.matchId));
    // A live OPEN or READY lobby is kept; a stale one lingers only through the grace
    // so a client mid-poll gets a status before the code disappears under it.
    if (stale && nowMs - lobby.createdAtMs > LOBBY_SWEEP_GRACE_MS) {
      lobbiesByCode.delete(code);
      if (lobbyCodeByProfile.get(lobby.host.profileId) === code) {
        lobbyCodeByProfile.delete(lobby.host.profileId);
      }
    }
  }
  for (const [matchId, live] of matchesById) {
    if (matchRetired(live, nowMs)) retireMatch(matchId, nowMs);
  }
}

/**
 * Is this match past retention AND safely retirable?
 *
 * SAFELY means the standing has already banked (`settledMatchIds.has`). A resolved
 * match whose bank has not committed — because it failed, or is still in flight — is
 * NOT retired: its state stays recoverable so the next settle can retry it. Readers
 * treat a retired match as already gone (404 / not reported) so the answer is correct
 * the instant retention passes, while the physical delete happens on the queue.
 */
function matchRetired(live: LiveMatch, nowMs: number): boolean {
  return (
    live.resolvedAtMs !== null &&
    nowMs - live.resolvedAtMs > RESOLVED_RETENTION_MS &&
    settledMatchIds.has(live.authority.identity.matchId)
  );
}

/** Match ids with a retirement pass pending or running, so it is enqueued at most once. */
const retiringMatches = new Set<string>();

/**
 * Retire a match THROUGH ITS OWN QUEUE, so the delete lands after any in-flight
 * settle or read and cannot lose a bank or resurrect a record.
 *
 * The record, both profile mappings and the `settledMatchIds` mark are removed
 * together, only after re-checking under the queue that the match is still resolved,
 * still banked and still past retention. Because a reader that starts after this runs
 * sees the record gone (and does not write it back), nothing re-adds `settledMatchIds`
 * afterwards — the mark cannot leak or reappear.
 */
function retireMatch(matchId: string, nowMs: number): void {
  if (retiringMatches.has(matchId)) return;
  retiringMatches.add(matchId);
  void serialiseOnMatch(matchId, async () => {
    const live = matchesById.get(matchId);
    if (!live || live.resolvedAtMs === null) return;
    if (!settledMatchIds.has(matchId)) return; // bank not (yet) committed — keep for retry
    if (nowMs - live.resolvedAtMs <= RESOLVED_RETENTION_MS) return;
    matchesById.delete(matchId);
    settledMatchIds.delete(matchId);
    settleRetry.delete(matchId); // scheduled retry state goes with the match
    for (const side of ["A", "B"] as const) {
      const profileId = live.authority.participants[side].profileId;
      if (matchIdByProfile.get(profileId) === matchId) matchIdByProfile.delete(profileId);
    }
  }).finally(() => retiringMatches.delete(matchId));
}

/**
 * The match a profile is CURRENTLY FIGHTING, if any — a live one, not a resolved one
 * being kept for `/active` to report. This is the "active match" the one-commitment
 * rule blocks a new lobby or join on: a profile whose last match has resolved is free
 * to start another even while its terminal record lingers through retention.
 */
function activeMatchFor(profileId: string): string | null {
  const matchId = matchIdByProfile.get(profileId);
  if (!matchId) return null;
  const live = matchesById.get(matchId);
  if (!live) return null;
  return live.authority.phase === "LIVE" ? matchId : null;
}

/** The open lobby a profile is still hosting, if the entry is live and OPEN/READY. */
function openLobbyFor(profileId: string): Lobby | null {
  const code = lobbyCodeByProfile.get(profileId);
  if (!code) return null;
  const lobby = lobbiesByCode.get(code);
  if (!lobby || (lobby.status !== "OPEN" && lobby.status !== "READY")) return null;
  return lobby;
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

/**
 * The result the authority actually stands behind — the ONE value both the client
 * projection and the bank read, so a player is never shown a ranked outcome that was
 * banked as practice.
 *
 * A GRADING OUTAGE MUST NOT SILENTLY DECIDE A RANKED MATCH. When the classifier is
 * unreachable, grading grants the generous verdict and labels its source anything but
 * CLASSIFIER (GRADING_TIMEOUT, ABSTAINED…). A match decided with any such verdict was
 * not decided by knowledge, so BEFORE projection and banking its result becomes
 * `standingApplies: false, needsReview: true` — a practice/review result. Points move
 * nowhere (a student is never punished for infrastructure, and never rewarded by it
 * either), and the same result is what the client sees and what the durable row holds.
 */
function authoritativeResult(live: LiveMatch): PvpMatchResult | null {
  const result = matchResult(live.authority);
  if (!result) return null;
  const outageGraded = bankedVerdicts(live).some(
    (verdict) => verdict.source !== "CLASSIFIER",
  );
  if (!outageGraded) return result;
  return { ...result, standingApplies: false, needsReview: true };
}

async function settle(
  live: LiveMatch,
  store: PvpStandingStore,
  log: FastifyBaseLogger,
  nowMs: number,
): Promise<void> {
  const result = authoritativeResult(live);
  if (!result) return;
  const matchId = live.authority.identity.matchId;
  if (settledMatchIds.has(matchId)) return;
  const a = live.authority.participants.A;
  const b = live.authority.participants.B;
  try {
    const wasBanked = await store.bank({
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
    settleRetry.delete(matchId); // committed — no retry is owed
    if (wasBanked) {
      log.info(
        { matchId, winner: result.winner, needsReview: result.needsReview },
        "pvp: standing banked",
      );
    }
  } catch (cause) {
    // Left unmarked so the scheduler retries it. THE RETRY IS NOT DUE IMMEDIATELY:
    // this seeds the backoff so the first retry waits `SETTLE_RETRY_BASE_MS`, and each
    // subsequent failure doubles the wait (capped) — a bank that keeps failing does
    // not spin. `attempts` counts this failed attempt, so the next backoff is derived
    // from it; `settle` is the single owner of this bookkeeping (attempt/backoff live
    // here, not in the scheduler).
    const attempts = (settleRetry.get(matchId)?.attempts ?? 0) + 1;
    const backoff = Math.min(
      SETTLE_RETRY_BASE_MS * 2 ** (attempts - 1),
      SETTLE_RETRY_MAX_MS,
    );
    settleRetry.set(matchId, { nextAttemptMs: nowMs + backoff, attempts });
    log.error(
      { cause, matchId, attempts, retryInMs: backoff },
      "pvp: banking the result failed; scheduled for retry",
    );
    return;
  }
  // The profile→match mappings are DELIBERATELY LEFT IN PLACE. They are how `/active`
  // answers RESULT to a client that reloaded onto a just-finished match; `sweep`
  // retires them, and the match record, once the retention window elapses. A profile
  // is not blocked from a new match meanwhile — `activeMatchFor` treats a resolved
  // match as no longer active.
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
    /**
     * The evidence gate's result for this round. A CLASSIFIER-graded CORRECT with
     * `false` here is downgraded to WRONG before the envelope is minted, so the
     * receipt signs the combined prose-and-evidence verdict. Omitted or `true`
     * leaves grading unchanged, and a generous grant is never downgraded.
     */
    evidenceSatisfied?: boolean;
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
   * The PvP-legal Codex card ids the SERVER attributes to a caller. This is the one
   * input the now-live card gate needs, and it is resolved here rather than accepted
   * from a request body — a card set off the wire is a self-granted power. `memberFor`
   * receives exactly this, so the intersection `askableItems` enforces is decided by
   * server-derived cards on both sides.
   *
   * Injected because the access policy and the progression snapshot are the API's,
   * not this file's, and defaulted to the full M1 set derived from the bank so the
   * route is playable — and its concurrency tests keep working — without app.ts having
   * to know PvP has a card policy.
   */
  readonly resolvePvpCardIds?: (profileId: string) => Promise<readonly string[]>;
  /**
   * Durable standing. Injected so a test can hand over a fake without a database,
   * and defaulted so app.ts does not have to know PvP has one.
   */
  readonly standings?: PvpStandingStore;
  /**
   * Resolve the caller from the session cookie. Defaults to `getSessionUser`, which
   * reads the sessions table — the ONE database coupling in this file. It is injected
   * so a Fastify-level concurrency test can drive the routes with a fake session
   * resolver instead of a copied fake of the whole route, which is the seam the
   * serialization and retention behaviour actually needs to be exercised through.
   */
  readonly authenticate?: (
    sessionId: string | undefined,
  ) => Promise<{ profileId: string } | null>;
  /**
   * The clock. Defaults to `Date.now`. Injected so a test can advance wall time past
   * the retention window and assert terminal cleanup without sleeping a minute.
   */
  readonly now?: () => number;
  /**
   * Whether to start the server-side advancement scheduler. Defaults to true. A test
   * sets it false and drives advancement through polls against the injected clock, so
   * no real timer fires inside a unit test.
   */
  readonly startScheduler?: boolean;
  /**
   * Called once each time a scheduled advancement pass actually EXECUTES for a match.
   * Test-only observability, defaulted off. It exists so a behavioural test can prove
   * coalescing: while a slow grade holds a match's queue, at most one pass is pending,
   * so only one pass runs when the queue drains rather than a backlog burst.
   */
  readonly onSchedulerPass?: (matchId: string) => void;
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
      // The CSRF token is minted for the tab's effective session, so it must be
      // validated against the same one the dev header resolves to.
      sessionId: effectiveSessionId(request),
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
  const authenticate = options.authenticate ?? getSessionUser;
  const requireCaller = callerResolver(standings, authenticate);
  const now = options.now ?? Date.now;

  // The server-side resolver for a caller's PvP-legal cards. The default is the full
  // M1 set derived from the bank — PLAYTEST_ALL, and the same set the real resolver
  // grants today — so an unconfigured route (a concurrency test) still starts matches.
  const resolvePvpCardIds =
    options.resolvePvpCardIds ?? (async () => allAskableCardIds(bank()));

  // ---- the server clock ----------------------------------------------------
  //
  // A BOUNDED SCHEDULER, NOT UNBOUNDED CATCH-UP ON A POLL. `pump` advances at most
  // one catch-up bound per call now (see `CATCH_UP_STEP_S`), so a poll that arrives
  // after a long gap no longer replays the whole gap in one request. What keeps a
  // match moving between polls — and advances a match nobody is polling, so a silent
  // disconnect is still forfeited — is this scheduler: every `SCHEDULER_INTERVAL_MS`
  // it takes one bounded pass at each live match THROUGH THAT MATCH'S QUEUE, so it
  // orders against answers, forfeits and reads exactly as a poll does. The poll
  // remains a read that also advances a little; it is no longer the sole clock.
  //
  // COALESCED so slow grading cannot build a backlog. At most ONE advancement pass is
  // pending or running per match: `scheduledMatches` holds a match from the moment a
  // pass is enqueued until it completes, and a tick that finds it already there does
  // nothing. Without this, a grade that holds a match's queue for a second lets the
  // interval enqueue twenty passes behind it, which then all run at once and fast-
  // forward the fight the instant the grade lands. Each pass still advances at most
  // one catch-up bound and accounts the elapsed time exactly once (see `pump`).
  //
  // Registered here and torn down on Fastify `onClose`, and the interval is `unref`ed
  // so it never holds the process open — a scheduler that leaked a timer would keep a
  // test runner (or a shut-down server) alive.
  //
  // A TERMINAL MATCH WHOSE BANK FAILED IS RETRIED HERE, with bounded backoff. Its
  // standing is durable and must not be lost just because the clients stopped polling
  // the moment it ended, and a resolved match is never retired until it has banked —
  // so without a retry it would leak forever. `attemptSettleRetry` re-runs the settle
  // on the match's own queue, coalesced to one pending attempt, and only once the
  // backoff has elapsed so a persistently failing bank does not spin.
  const attemptSettleRetry = (matchId: string, nowMs: number): void => {
    if (retryingMatches.has(matchId)) return;
    // A retry is owed only once `settle` has seeded the backoff (on the initial
    // failure) AND that backoff has elapsed. No seed, or not yet due, means nothing to
    // do — the first retry cannot fire before `nextAttemptMs`. `settle` owns updating
    // the schedule; this only gates and runs it.
    const state = settleRetry.get(matchId);
    if (!state || nowMs < state.nextAttemptMs) return;
    retryingMatches.add(matchId);
    void serialiseOnMatch(matchId, async () => {
      const current = matchesById.get(matchId);
      if (!current || current.resolvedAtMs === null) return;
      if (settledMatchIds.has(matchId)) return;
      await settle(current, standings, app.log, now());
    }).finally(() => retryingMatches.delete(matchId));
  };

  if (options.startScheduler !== false) {
    const timer = setInterval(() => {
      const nowMs = now();
      sweep(nowMs);
      for (const [matchId, live] of matchesById) {
        if (live.authority.phase === "LIVE") {
          if (scheduledMatches.has(matchId)) continue; // one pass pending/running at a time
          scheduledMatches.add(matchId);
          void serialiseOnMatch(matchId, async () => {
            options.onSchedulerPass?.(matchId);
            const current = matchesById.get(matchId);
            if (!current || current.authority.phase !== "LIVE") return;
            const pumped = pump(current, now());
            matchesById.set(matchId, pumped);
            await settle(pumped, standings, app.log, now());
          }).finally(() => scheduledMatches.delete(matchId));
        } else if (live.resolvedAtMs !== null && !settledMatchIds.has(matchId)) {
          // Terminal but not banked — retry the settle with backoff.
          attemptSettleRetry(matchId, nowMs);
        }
      }
    }, SCHEDULER_INTERVAL_MS);
    timer.unref?.();
    app.addHook("onClose", async () => clearInterval(timer));
  }

  // ---- lobbies -------------------------------------------------------------

  app.post("/api/pvp/lobby", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    if (!csrfOk(request, reply)) return;
    // The caller's PvP-legal cards, server-derived. The card gate is live, so a
    // caller who holds nothing cannot open a lobby (NO_PVP_LEGAL_CARDS) — which under
    // ASSESSMENT_PASSED is exactly what closes access until the assessment is passed.
    const cardIds = await resolvePvpCardIds(caller.profileId);
    const eligible = assertPvpEligible({
      profileId: caller.profileId,
      completedChapterIds: [],
      pvpLegalCardIds: cardIds,
    });
    if (!eligible.ok) {
      return reply.code(403).send({ error: eligible.reason, message: eligible.detail });
    }
    const member = memberFor(caller, request.body, cardIds);
    if ("error" in member) return reply.code(400).send({ error: member.error });

    // Serialised on the caller's profile, alongside join and cancel, so two creates
    // (or a create racing a join) for the same profile cannot both commit. The
    // check-and-create is atomic under the lock.
    return serialiseOnProfiles([caller.profileId], async () => {
      const nowMs = now();
      sweep(nowMs);
      // ONE COMMITMENT PER PROFILE. A profile already in a live match cannot open a
      // lobby, and a profile already hosting an open one cannot open a second — the
      // duelling ground would otherwise fill with abandoned codes and a student could
      // be in two fights at once. A stale entry was already cleared by `sweep`.
      if (activeMatchFor(caller.profileId)) {
        return reply.code(409).send({ error: "ACTIVE_MATCH_EXISTS" });
      }
      const existing = openLobbyFor(caller.profileId);
      if (existing) {
        return reply.code(409).send({ error: "LOBBY_ALREADY_OPEN", message: existing.code });
      }

      const lobby = createLobby(member, nowMs);
      lobbiesByCode.set(lobby.code, lobby);
      lobbyCodeByProfile.set(caller.profileId, lobby.code);
      return {
        code: lobby.code,
        status: lobby.status,
        // The host's own handle only. A lobby reveals nothing about who may join.
        handle: caller.handle,
        gates: PVP_GATES,
      };
    });
  });

  app.post("/api/pvp/lobby/:code/join", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    if (!csrfOk(request, reply)) return;
    const code = normaliseMatchCode((request.params as { code?: string }).code);
    if (!code) return reply.code(400).send({ error: "MATCH_CODE_INVALID" });

    // The guest's cards are resolved server-side too — never from the join body — so
    // both sides of the intersection `askableItems` computes are server-derived.
    const cardIds = await resolvePvpCardIds(caller.profileId);
    const member = memberFor(caller, request.body, cardIds);
    if ("error" in member) return reply.code(400).send({ error: member.error });

    // The host is read optimistically to know which profile locks to take; a code
    // maps to one host deterministically, so this is stable even if the lobby state
    // changes under us — the revalidation inside the lock is what actually decides.
    const hostId = lobbiesByCode.get(code)?.host.profileId;
    const lockProfiles = hostId ? [caller.profileId, hostId] : [caller.profileId];

    // Serialised on BOTH the guest and the host profile. Two guests racing the same
    // lobby both take the host's lock; a guest racing two lobbies takes its own lock
    // in both; a cancel racing this join takes the host's lock. So every join that
    // could over-commit a profile is ordered against the operation it races.
    return serialiseOnProfiles(lockProfiles, async () => {
      const nowMs = now();
      sweep(nowMs);
      const lobby = lobbiesByCode.get(code);
      if (!lobby) return reply.code(404).send({ error: "LOBBY_NOT_FOUND" });

      const joined = joinLobby(lobby, member, nowMs);
      if (!joined.ok) return reply.code(409).send({ error: joined.reason });

      const sides = lobbySides(joined.lobby);
      if (!sides) return reply.code(500).send({ error: "LOBBY_INCONSISTENT" });

      // IMMEDIATELY BEFORE CREATING THE MATCH, revalidate the one-commitment rule for
      // BOTH players under the lock: neither may be in another live match, and the
      // guest may not be hosting a separate open lobby. Any of these means the world
      // moved since the guest hit join, and the match must not be assigned.
      if (activeMatchFor(sides.A.profileId) || activeMatchFor(sides.B.profileId)) {
        return reply.code(409).send({ error: "ACTIVE_MATCH_EXISTS" });
      }
      const guestLobby = openLobbyFor(sides.B.profileId);
      if (guestLobby && guestLobby.code !== code) {
        return reply.code(409).send({ error: "LOBBY_ALREADY_OPEN", message: guestLobby.code });
      }

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
      const startedNow = now();
      const created = createPvpMatch({
        identity: { matchId, seed: joined.lobby.seed, startedAtMs: startedNow },
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

      // The evidence hand is dealt from what BOTH players hold. Under PLAYTEST_ALL
      // this is the full nine-card M1 deck for everyone; under a real gate it is the
      // intersection, so a side is never offered a decoy it could not legally place.
      const bLegal = new Set(sides.B.pvpLegalCardIds);
      const evidenceDeck = sides.A.pvpLegalCardIds.filter((id) => bLegal.has(id));
      matchesById.set(matchId, {
        authority: created.authority,
        lastAdvanceMs: startedNow,
        questions: questions.map((item) => ({
          itemId: item.itemId,
          question: item.question,
          codexCardIds: item.codexCardIds,
        })),
        code,
        evidenceDeck,
        resolvedAtMs: null,
      });
      matchIdByProfile.set(sides.A.profileId, matchId);
      matchIdByProfile.set(sides.B.profileId, matchId);
      lobbiesByCode.set(code, markLobbyStarted(joined.lobby, matchId));
      // Both players' open-lobby slots are spent on this match now.
      lobbyCodeByProfile.delete(sides.A.profileId);
      lobbyCodeByProfile.delete(sides.B.profileId);

      return { matchId, status: "STARTED", side: "B" };
    });
  });

  app.delete("/api/pvp/lobby/:code", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    if (!csrfOk(request, reply)) return;
    const code = normaliseMatchCode((request.params as { code?: string }).code);
    if (!code) return reply.code(404).send({ error: "LOBBY_NOT_FOUND" });

    // Serialised on the caller's profile — the SAME queue join takes the host lock on
    // — so a cancel racing a join for this lobby is ordered against it rather than
    // both mutating the lobby at once. Re-read inside the lock.
    return serialiseOnProfiles([caller.profileId], async () => {
      const lobby = lobbiesByCode.get(code);
      if (!lobby) return reply.code(404).send({ error: "LOBBY_NOT_FOUND" });
      if (lobby.host.profileId !== caller.profileId) {
        return reply.code(403).send({ error: "NOT_LOBBY_HOST" });
      }
      // If a join already flipped it to STARTED, the cancel loses the race honestly.
      if (lobby.status === "STARTED") {
        return reply.code(409).send({ error: "LOBBY_NOT_OPEN" });
      }
      lobbiesByCode.set(code, cancelLobby(lobby));
      // The slot is free again immediately, so the host can open a fresh lobby without
      // waiting for the sweep to retire the cancelled one.
      if (lobbyCodeByProfile.get(caller.profileId) === code) {
        lobbyCodeByProfile.delete(caller.profileId);
      }
      return { code, status: "CANCELLED" };
    });
  });

  /** Where the host learns that somebody joined, and which side it is. */
  app.get("/api/pvp/lobby/:code", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    sweep(now());
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

    // Serialised on the match, same queue as the answer and the forfeit, so an intent
    // batch cannot interleave with a grading write in flight — the read-derive-write
    // here would otherwise clobber a verdict committed between its own read and write.
    return serialiseOnMatch(matchId, async () => {
      const current = matchesById.get(matchId);
      if (!current) return reply.code(404).send({ error: "MATCH_NOT_FOUND" });
      const nowMs = now();
      // Contact is contact even if every frame in the batch is later rejected: the
      // request itself proves the side is present. Stamp before the pump's silence
      // check so an empty or fully-rejected batch still counts as liveness.
      let pumped = pump(
        { ...current, authority: markSeen(current.authority, side, nowMs) },
        nowMs,
      );
      const rejected: string[] = [];
      for (const raw of frames.slice(0, 32)) {
        const parsed = parseIntentFrame(raw);
        if (!parsed.ok) {
          rejected.push(`${parsed.reason}:${parsed.detail}`);
          continue;
        }
        const ingested = ingestIntent(pumped.authority, side, parsed.frame, nowMs);
        pumped = { ...pumped, authority: ingested.authority };
        if (!ingested.ok) rejected.push(`${ingested.reason}:${ingested.detail}`);
      }
      matchesById.set(matchId, pumped);
      await settle(pumped, standings, request.log, nowMs);
      return {
        snapshot: snapshotsFor(pumped.authority)[side],
        rejected,
        result: authoritativeResult(pumped),
      };
    });
  });

  /** Read-only poll, for the countdown and the question phases. */
  app.get("/api/pvp/match/:matchId", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    // Swept on the poll both clients are already making, so a resolved match is
    // retired on schedule even between scheduler passes.
    const nowMs = now();
    sweep(nowMs);
    const matchId = (request.params as { matchId?: string }).matchId ?? "";
    const live = matchesById.get(matchId);
    // A match past retention is already gone as far as a caller is concerned, even in
    // the window before its queued retirement physically removes it.
    if (!live || matchRetired(live, nowMs)) {
      return reply.code(404).send({ error: "MATCH_NOT_FOUND" });
    }
    const side = sideOf(live.authority, caller.profileId);
    if (!side) return reply.code(403).send({ error: "NOT_IN_MATCH" });

    // Serialised on the match: the advance-on-read WRITES the pumped state back, so a
    // poll racing a verdict or a forfeit would otherwise clobber it with a state
    // derived before the write. On the shared queue every mutation of a match — read,
    // intent, answer, forfeit, scheduler pass — is ordered, so none can lose another's
    // work.
    return serialiseOnMatch(matchId, async () => {
      const current = matchesById.get(matchId);
      if (!current) return reply.code(404).send({ error: "MATCH_NOT_FOUND" });
      // This poll IS proof the caller is present. Stamp it before the pump runs the
      // silence check, so a client that reads the match — including all the way
      // through an untimed question, where it sends no intent frames — is never
      // forfeited as DISCONNECTED while it is plainly still talking to the server.
      const seen: LiveMatch = {
        ...current,
        authority: markSeen(current.authority, side, now()),
      };
      const pumped = pump(seen, now());
      matchesById.set(matchId, pumped);
      await settle(pumped, standings, request.log, now());
      const snapshot = snapshotsFor(pumped.authority)[side];
      // The question is handed to a side ONLY WHILE THAT SIDE STILL OWES A VERDICT.
      // Once this player has answered, the round stays open waiting on the opponent,
      // and the authority correctly refuses a second commit — but re-sending the
      // question text would prompt the client to ask again and read the refusal as an
      // error. So the answered side is handed `null` and its UI holds on "waiting for
      // your opponent" rather than re-presenting a question it has already answered.
      const owed = awaitingVerdicts(pumped.authority);
      const question = owed.includes(side) ? askedItem(pumped) : null;
      return {
        snapshot,
        // The question text is handed out one round at a time, and only while that
        // round is being asked. A client cannot fetch a later round's item during this
        // one. `recycled` is passed through rather than hidden: a duel that outlasts
        // its bank repeats, and telling the player is better than letting them wonder.
        question,
        result: authoritativeResult(pumped),
      };
    });
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

    const body = (request.body ?? {}) as {
      answerText?: unknown;
      selectedCardIds?: unknown;
    };
    if (typeof body.answerText !== "string" || body.answerText.length === 0) {
      return reply.code(400).send({ error: "ANSWER_REQUIRED" });
    }
    if (body.answerText.length > 4000) {
      return reply.code(400).send({ error: "ANSWER_TOO_LONG" });
    }
    const answerText = body.answerText;
    // The placed evidence, parsed LENIENTLY: a malformed value is no evidence placed,
    // never a refusal — the server grades it against its own re-derived hand.
    const selectedCardIds = parseSelectedCardIds(body.selectedCardIds);

    // Grading is a network call, so the read and the write are seconds apart. Queued
    // per match: see `serialiseOnMatch` for the verdict this used to lose.
    return serialiseOnMatch(matchId, async () => {
      // Re-read INSIDE the queue. The authority captured above may already be a
      // generation behind — it is, whenever the opponent answered first.
      const current = matchesById.get(matchId);
      if (!current) return reply.code(404).send({ error: "MATCH_NOT_FOUND" });

      const pumped = pump(
        { ...current, authority: markSeen(current.authority, side, now()) },
        now(),
      );
      const round = pumped.authority.state.round;
      const item = askedItem(pumped);
      if (!item) return reply.code(409).send({ error: "NO_QUESTION_THIS_ROUND" });

      // THE EVIDENCE GATE, against the match's own shared hand for the asked item.
      // The policy is re-derived from the item id and the match deck, so the offered
      // hand and which cards are relevant are the server's, identical for both sides.
      // The deck IS the authorised set: it is the intersection of both players' legal
      // cards, so every offered card is one this caller holds. An illegal or
      // insufficient selection grades as unsatisfied and folds into WRONG.
      const evidencePolicy = m1EvidencePolicyFor(item.itemId, current.evidenceDeck);
      const evidence = evaluateEvidence(
        evidencePolicy,
        selectedCardIds,
        current.evidenceDeck,
      );

      const graded = await options.gradeAnswer({
        profileId: caller.profileId,
        matchId,
        roundIndex: round,
        itemId: item.itemId,
        answerText,
        evidenceSatisfied: evidence.satisfied,
      });
      // Pumped again after grading: the fight does not stop for a classifier, and the
      // state the verdict is committed against should be the one that exists now.
      // Re-stamp presence at COMPLETION: a grade can take a while, and the client held
      // the connection open the whole time — so it is present now, not only when the
      // request first arrived. Without this, an answer that took longer than the
      // disconnect grace would let the opponent's next poll forfeit the answerer.
      const advanced = pump(
        { ...pumped, authority: markSeen(pumped.authority, side, now()) },
        now(),
      );
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
        // …and why their evidence fell short, if it did. A misconception class only
        // (TOO_FEW, INCOMPATIBLE, …) — never which cards were relevant, and returned
        // only to the answering side, so nothing leaks to the opponent.
        evidence: evidence.feedback,
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

    // Serialised on the match: a forfeit that raced a grading call in flight used to
    // be silently reverted, because the answer path wrote an authority derived from
    // the pre-forfeit state. On the shared queue the forfeit either lands before the
    // grade (which then sees a non-live match and commits nothing) or after it, but
    // never underneath it — a settled result cannot be revived by a stale grade.
    return serialiseOnMatch(matchId, async () => {
      const current = matchesById.get(matchId);
      if (!current) return reply.code(404).send({ error: "MATCH_NOT_FOUND" });
      const authority = forfeitMatch(current.authority, side, "ABANDONED");
      const forfeited: LiveMatch = {
        ...current,
        authority,
        resolvedAtMs:
          current.resolvedAtMs ?? (authority.phase === "LIVE" ? null : now()),
      };
      matchesById.set(matchId, forfeited);
      await settle(forfeited, standings, request.log, now());
      return { result: authoritativeResult(forfeited) };
    });
  });

  /**
   * Where a reloaded client finds itself again.
   *
   * A browser refreshed mid-duel loses the matchId it was polling. Rather than
   * strand it on the lobby screen — or worse, let it open a second lobby while the
   * first match is still live and be refused ACTIVE_MATCH_EXISTS with no way to see
   * why — this reports the caller's current commitment in a STRICT PRIORITY:
   *
   *   1. MATCH   a still-live match, with the side to resume as. Nothing outranks a
   *              fight in progress.
   *   2. LOBBY   an open lobby this profile hosts (code + handle), so the hosting
   *              screen is recovered — and, crucially, a NEW lobby opened after a
   *              previous match resolved is recovered ahead of that stale result.
   *   3. RESULT  the retained terminal result of the last match, if it resolved and is
   *              still inside its retention window and the profile has not moved on to
   *              a new lobby.
   *   4. NONE    nothing — the honest terminal state once retention has elapsed.
   *
   * No profile ids cross; a caller learns only about itself.
   */
  app.get("/api/pvp/active", async (request, reply) => {
    const caller = await requireCaller(request, reply);
    if (!caller) return;
    const nowMs = now();
    sweep(nowMs);

    // 1) A live match outranks everything.
    const liveId = activeMatchFor(caller.profileId);
    if (liveId) {
      const live = matchesById.get(liveId)!;
      const side = sideOf(live.authority, caller.profileId)!;
      return { kind: "MATCH", matchId: liveId, side, result: null };
    }
    // 2) An open lobby is recovered ahead of any stale result: a player who opened a
    //    new lobby after their last match resolved must land on it, not the old result.
    const lobby = openLobbyFor(caller.profileId);
    if (lobby) {
      return { kind: "LOBBY", code: lobby.code, status: lobby.status, handle: caller.handle };
    }
    // 3) Otherwise, a retained terminal result — only while it is still in retention.
    const matchId = matchIdByProfile.get(caller.profileId);
    if (matchId) {
      const live = matchesById.get(matchId);
      const side = live ? sideOf(live.authority, caller.profileId) : null;
      if (live && side && !matchRetired(live, nowMs)) {
        const result = authoritativeResult(live);
        if (result) return { kind: "RESULT", matchId, side, result };
      }
    }
    return { kind: "NONE" };
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
