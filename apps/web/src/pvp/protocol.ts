// The PvP wire, and the one place a fetch happens.
//
// TRANSPORT IS A SEAM, NOT A DESIGN. Every call below is HTTP polling against
// apps/api/src/routes/pvp.ts. That is adequate for two windows on one laptop and
// it is explicitly not what ships: `packages/netcode` is building server-
// authoritative transport with prediction and per-tick desync hashing, and this
// file is shaped so that swapping it in touches nothing else.
//
// What keeps the seam clean:
//
//   * The client sends INTENT FRAMES ONE AT A TIME, batched only for the trip.
//     The authority already ingests them singly, so a socket that delivers them
//     at 60 Hz changes the rate and no policy.
//   * Nothing here decides anything. There is no local simulation, no predicted
//     health, no client-side hit. What the screen draws is what the last snapshot
//     said, and a transport that delivers snapshots faster makes it smoother
//     without making it different.
//   * `PvpTransport` is an interface. A socket implementation satisfies it or the
//     compiler complains.
//
// The types below mirror @pa/pvp's `MatchSnapshot` rather than importing it,
// because @pa/web does not depend on @pa/pvp and an HTTP boundary is exactly the
// place a duplicated shape is honest: this is what the JSON looks like. The duel
// vocabulary itself (phase, side, vectors) IS imported from @pa/duel, so the words
// cannot drift from the simulation that produces them.

import type { CombatIntent, DuelPhase, DuelSide, Vec3 } from "@pa/duel";
import { withDevSessionHeader } from "../devSession.js";

/** Same-origin. Vite proxies /api to the API so the session cookie is first-party. */
const BASE = "";

// ---- what the server tells this client -------------------------------------

export interface SelfView {
  readonly side: DuelSide;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  readonly capsuleHeight: number;
  readonly health: number;
  readonly ammo: number;
  readonly dashing: boolean;
  readonly invulnerableUntilTick: number;
  readonly dodgeReadyAtTick: number;
  readonly abilityUsesRemaining: Readonly<Record<string, number>>;
}

/**
 * Deliberately partial: the opponent's position is only current while the server
 * can see a line of sight between the bodies. `visible: false` means this is the
 * last place they were legitimately seen, and the UI must draw it as stale rather
 * than as truth — an honest client and a cheating one are then looking at the same
 * bytes.
 */
export interface OpponentView {
  readonly side: DuelSide;
  readonly handle: string;
  readonly rank: number;
  readonly position: Vec3;
  /** Ground velocity, m/s. Frozen with the position when `visible` is false. */
  readonly velocity: { readonly x: number; readonly z: number };
  /** Aim yaw — snapshot-backed, so facing is never inferred. Frozen when unseen. */
  readonly aimYaw: number;
  /** Mid-dash flag — snapshot-backed; frozen when unseen. */
  readonly dashing: boolean;
  readonly capsuleHeight: number;
  readonly health: number;
  readonly ammo: number;
  readonly visible: boolean;
  readonly positionAtTick: number;
  readonly answering: boolean;
}

export interface ProjectileView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly shooter: DuelSide;
}

export interface MatchSnapshot {
  readonly matchId: string;
  readonly tick: number;
  readonly phase: DuelPhase;
  /**
   * Which round is being played. THERE IS NO TOTAL. A duel runs until a health
   * pool empties, so any denominator this client invented would be a guess
   * presented as a fact.
   */
  readonly round: number;
  readonly self: SelfView;
  readonly opponent: OpponentView;
  readonly projectiles: readonly ProjectileView[];
  /**
   * The authoritative post-answer countdown in whole seconds, or null. Mirrors
   * @pa/pvp's `MatchSnapshot.resumeCountdownSeconds`: non-null (3, 2, 1) only while
   * the server is in BULLETS_GRANTED, and never while a side still owes an answer.
   * There is no client clock behind it — it is read from the snapshot and shown.
   */
  readonly resumeCountdownSeconds: number | null;
}

export interface MatchResultPayload {
  readonly matchId: string;
  readonly winner: DuelSide | null;
  readonly loser: DuelSide | null;
  readonly reason: string;
  readonly tiebreak: string;
  readonly healthA: number;
  readonly healthB: number;
  readonly standingApplies: boolean;
  readonly needsReview: boolean;
}

export interface QuestionPayload {
  readonly itemId: string;
  readonly question: string;
  /** 1 the first time this item is asked in the duel, 2 the second, and so on. */
  readonly appearance: number;
  /**
   * True when the bank has wrapped and this item has been asked before. A duel
   * runs until somebody is down, so it can outlast its questions; @pa/duel
   * discloses the repeat rather than hiding it, and so does the screen.
   */
  readonly recycled: boolean;
  /**
   * The Codex cards this question draws on — the RELEVANT ones. Server-derived, but
   * NO LONGER SHOWN during a question: naming them would hand the player the answer to
   * the evidence mechanic. Kept on the wire for diagnostics and the post-verdict
   * surface; the offered hand below is what the player interacts with.
   */
  readonly codexCardIds: readonly string[];
  /**
   * The offered evidence hand — the ids to deal, indistinguishable relevant cards and
   * decoys, in the server's deterministic order. IDENTICAL for both sides of a match.
   * Which of these are relevant is the server's secret; only this safe projection
   * crosses the wire, so nothing the client renders reveals the answer before grading.
   */
  readonly offeredCardIds: readonly string[];
  /** How many supporting cards a selection must place. Public; never which. */
  readonly minSupport: number;
  readonly maxSelectable: number;
}

export interface MatchRead {
  readonly snapshot: MatchSnapshot;
  /** Present only while this round is being asked. Never the whole bank. */
  readonly question: QuestionPayload | null;
  readonly result: MatchResultPayload | null;
}

export interface IntentAck {
  readonly snapshot: MatchSnapshot;
  /** Frames the authority refused, as `REASON:detail`. Surfaced, not swallowed. */
  readonly rejected: readonly string[];
  readonly result: MatchResultPayload | null;
}

export interface AnswerAck {
  readonly verdict: "CORRECT" | "WRONG";
  /**
   * Why the placed evidence fell short, if it did. A misconception class only
   * (TOO_FEW, INCOMPATIBLE, …) — never which cards were relevant — and returned only
   * to the answering side, so nothing leaks to the opponent.
   */
  readonly evidence?: string;
  readonly snapshot: MatchSnapshot;
}

export interface LobbyCreated {
  readonly code: string;
  readonly status: string;
  readonly handle: string;
  readonly gates: {
    readonly requireChapterComplete: boolean;
    readonly requirePvpLegalCards: boolean;
    readonly enforceRankBrackets: boolean;
  };
}

export interface LobbyRead {
  readonly code: string;
  readonly status: "OPEN" | "READY" | "STARTED" | "CANCELLED" | "EXPIRED";
  readonly matchId: string | null;
  readonly side: DuelSide;
}

export interface LobbyJoined {
  readonly matchId: string;
  readonly status: string;
  readonly side: DuelSide;
}

/**
 * What a reloaded window is currently committed to, from `GET /api/pvp/active`.
 *
 * A browser refreshed mid-duel loses the matchId it was polling. This is how the Hub
 * or the standalone page recovers it without opening a second lobby and being refused:
 * an active match (with the side to resume as), an open lobby (with its code), or
 * nothing. `NONE` is the honest terminal state — a resolved match swept past its
 * retention has nothing left to rejoin, and the result is already on the board.
 */
export interface PvpActiveState {
  /**
   * MATCH  — a still-live match to resume (`matchId`, `side`).
   * RESULT — a resolved match still in its retention window (`matchId`, `side`,
   *          `result`), so a reload lands on the result screen.
   * LOBBY  — an open lobby this profile hosts (`code`, `handle`).
   * NONE   — nothing to restore.
   */
  readonly kind: "MATCH" | "RESULT" | "LOBBY" | "NONE";
  readonly matchId?: string;
  readonly side?: DuelSide;
  readonly code?: string;
  readonly status?: string;
  readonly handle?: string;
  readonly result?: MatchResultPayload | null;
}

/**
 * Who this window is signed in as.
 *
 * PvP needs this for a reason the rest of the app does not: the second account
 * lives in a second browser profile, and that window arrives with no session at
 * all. Without an identity check the duelling ground would answer every action
 * with AUTH_REQUIRED and offer no way out of it.
 */
export interface PvpIdentity {
  readonly authenticated: boolean;
  readonly displayName: string | null;
  readonly profileId: string | null;
  /**
   * The session's CSRF token, minted by the API. Every PvP mutation carries it in
   * `x-pa-csrf-token`, matching the assessment and grading routes.
   */
  readonly csrfToken: string | null;
}

/** Where a window with no session goes to get one. Same-origin, so the cookie sticks. */
export const GOOGLE_SIGN_IN_URL = "/v1/auth/google/start";

export interface LeaderboardRow {
  readonly position: number;
  readonly handle: string;
  readonly rank: number;
  readonly points: number;
  readonly wins: number;
  readonly losses: number;
}

// ---- what this client is allowed to say ------------------------------------

/**
 * One sampled frame of input. Exactly @pa/pvp's `ClientIntentFrame`: a direction,
 * some modifiers, an aim vector and an ability id. There is no field here for a
 * position, a hit, a health value or a bullet count, which is the anti-cheat model
 * in one sentence — a client that cannot describe state cannot lie about it.
 */
export interface IntentFrame {
  readonly seq: number;
  readonly tick: number;
  readonly moveX: number;
  readonly moveZ: number;
  readonly sprint: boolean;
  readonly crouch: boolean;
  readonly jump: boolean;
  readonly dodge: boolean;
  readonly fire: boolean;
  readonly aimX: number;
  readonly aimZ: number;
  readonly abilityId: string | null;
}

/** Project the duel view's own intent onto the wire frame. Adds only a stamp. */
export function frameFrom(
  intent: CombatIntent,
  seq: number,
  tick: number,
): IntentFrame {
  return {
    seq,
    tick,
    moveX: intent.moveX,
    moveZ: intent.moveZ,
    sprint: intent.sprint,
    crouch: intent.crouch,
    jump: intent.jump,
    dodge: intent.dodge,
    fire: intent.fire,
    aimX: intent.aimX,
    aimZ: intent.aimZ,
    abilityId: intent.abilityId,
  };
}

// ---- failures ---------------------------------------------------------------

/**
 * Three outcomes, kept apart on purpose.
 *
 * REFUSED is a fact about the match — the lobby is gone, it is your own lobby,
 * you are not in this match — and repeating the call produces the same answer.
 * UNREACHABLE says nothing at all, which matters most for the poll loop: a
 * dropped packet must not read as "the match ended".
 */
export type PvpCall<T> =
  | { readonly status: "OK"; readonly value: T }
  | {
      readonly status: "REFUSED";
      readonly error: string;
      readonly message?: string;
      readonly httpStatus: number;
    }
  | { readonly status: "UNREACHABLE"; readonly detail: string };

// The session's CSRF token, held here rather than threaded through every call
// site, so `PvpTransport`'s signatures stay free of it and a socket transport
// inherits the same one-line arrangement. Set once the identity read answers.
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Mutations only. A read needs no token and the poll loop must not carry one. */
function mutationHeaders(): Record<string, string> {
  return csrfToken === null ? {} : { "x-pa-csrf-token": csrfToken };
}

/**
 * The production request timeout, shared by every PvP fetch AND the latency test model.
 *
 * The poll loop is recursive: it sends, awaits the response, then schedules the next
 * request. A request that HANGS would stall the whole loop — the fight would freeze and
 * no further intent frame would ever be sent. So every fetch is bounded: after this many
 * milliseconds it is aborted and reported as UNREACHABLE, exactly like a dropped packet.
 * UNREACHABLE says nothing about the match, so the loop keeps polling and — crucially —
 * an in-flight edge receipt is never acknowledged on a timeout, so the press stays
 * pending and rides the next poll. 200ms is the contract the latency model is tested at.
 */
export const REQUEST_TIMEOUT_MS = 200;

/**
 * The grading timeout, for the answer POST alone.
 *
 * Answer grading runs a classifier server-side and legitimately takes far longer than a
 * position poll — measured at roughly 600–850ms — so the 200ms high-frequency budget
 * would abort a healthy grade and read it as a network failure. 1500ms clears the
 * observed range with generous margin while still bounding a genuinely hung grade so the
 * screen does not wait forever. Every OTHER path (poll/read/intent/active/lobby/forfeit)
 * keeps the tight 200ms budget, since a hung one of those would stall the recursive loop.
 */
export const ANSWER_TIMEOUT_MS = 1500;

async function callJson<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<PvpCall<T>> {
  // AbortController + a timer, cleaned up in `finally`, so a hung request cannot block the
  // recursive loop and a completed one leaves no dangling timer.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      credentials: "include",
      ...init,
      // This tab's dev-session handle rides on EVERY PvP call — reads, polls and
      // mutations alike — so two windows create/join/poll as two independent local
      // profiles rather than as one shared cookie identity.
      headers: withDevSessionHeader(init.headers as Record<string, string> | undefined),
      signal: controller.signal,
    });
    if (response.status >= 500) {
      return { status: "UNREACHABLE", detail: `HTTP_${response.status}` };
    }
    if (!response.ok) {
      let error = `HTTP_${response.status}`;
      let message: string | undefined;
      try {
        const body = (await response.json()) as {
          error?: unknown;
          message?: unknown;
        };
        if (typeof body.error === "string") error = body.error;
        if (typeof body.message === "string") message = body.message;
      } catch {
        /* a body-less refusal is still a refusal */
      }
      return {
        status: "REFUSED",
        error,
        ...(message === undefined ? {} : { message }),
        httpStatus: response.status,
      };
    }
    return { status: "OK", value: (await response.json()) as T };
  } catch (cause) {
    // A TIMEOUT and a network error are both UNREACHABLE — neither is a statement about
    // the match, and both must leave any pending edge receipt unacknowledged.
    const detail = controller.signal.aborted
      ? `TIMEOUT_${timeoutMs}`
      : cause instanceof Error
        ? cause.message
        : String(cause);
    return { status: "UNREACHABLE", detail };
  } finally {
    clearTimeout(timer);
  }
}

function post<T>(
  path: string,
  body?: unknown,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<PvpCall<T>> {
  return callJson<T>(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...mutationHeaders() },
      body: JSON.stringify(body ?? {}),
    },
    timeoutMs,
  );
}

/**
 * Everything the client can do to a match.
 *
 * Named as an interface so the netcode agent's transport can implement it and the
 * screens below do not change. Nothing in the UI imports `fetch`.
 */
export interface PvpTransport {
  identity(): Promise<PvpCall<PvpIdentity>>;
  /** What this window is already committed to — an in-progress match, a lobby, or nothing. */
  active(): Promise<PvpCall<PvpActiveState>>;
  createLobby(): Promise<PvpCall<LobbyCreated>>;
  readLobby(code: string): Promise<PvpCall<LobbyRead>>;
  cancelLobby(code: string): Promise<PvpCall<{ code: string; status: string }>>;
  joinLobby(code: string): Promise<PvpCall<LobbyJoined>>;
  readMatch(matchId: string): Promise<PvpCall<MatchRead>>;
  sendIntents(
    matchId: string,
    frames: readonly IntentFrame[],
  ): Promise<PvpCall<IntentAck>>;
  answer(
    matchId: string,
    answerText: string,
    selectedCardIds: readonly string[],
  ): Promise<PvpCall<AnswerAck>>;
  forfeit(
    matchId: string,
  ): Promise<PvpCall<{ result: MatchResultPayload | null }>>;
  leaderboard(): Promise<PvpCall<{ rows: readonly LeaderboardRow[] }>>;
}

/** /v1 rather than /api: identity belongs to the whole app, not to PvP. */
async function readIdentity(): Promise<PvpCall<PvpIdentity>> {
  const call = await callJson<{
    authenticated?: boolean;
    csrfToken?: string;
    profile?: { profileId?: string; displayName?: string } | null;
  }>("/v1/session");
  if (call.status !== "OK") return call;
  const token = call.value.csrfToken ?? null;
  // Armed here, at the one place the token is legitimately learned, so no screen
  // and no caller has to remember to attach it.
  setCsrfToken(token);
  return {
    status: "OK",
    value: {
      authenticated: Boolean(call.value.authenticated),
      displayName: call.value.profile?.displayName ?? null,
      profileId: call.value.profile?.profileId ?? null,
      csrfToken: token,
    },
  };
}

export const httpPvpTransport: PvpTransport = {
  identity: readIdentity,
  active: () => callJson<PvpActiveState>("/api/pvp/active"),
  createLobby: () => post<LobbyCreated>("/api/pvp/lobby"),
  readLobby: (code) => callJson<LobbyRead>(`/api/pvp/lobby/${encodeURIComponent(code)}`),
  cancelLobby: (code) =>
    callJson<{ code: string; status: string }>(
      `/api/pvp/lobby/${encodeURIComponent(code)}`,
      { method: "DELETE", headers: mutationHeaders() },
    ),
  joinLobby: (code) =>
    post<LobbyJoined>(`/api/pvp/lobby/${encodeURIComponent(code)}/join`),
  readMatch: (matchId) =>
    callJson<MatchRead>(`/api/pvp/match/${encodeURIComponent(matchId)}`),
  sendIntents: (matchId, frames) =>
    post<IntentAck>(`/api/pvp/match/${encodeURIComponent(matchId)}/intents`, {
      frames,
    }),
  answer: (matchId, answerText, selectedCardIds) =>
    post<AnswerAck>(
      `/api/pvp/match/${encodeURIComponent(matchId)}/answer`,
      { answerText, selectedCardIds },
      // Grading is slow; give it the longer budget so a healthy grade is not aborted.
      ANSWER_TIMEOUT_MS,
    ),
  forfeit: (matchId) =>
    post<{ result: MatchResultPayload | null }>(
      `/api/pvp/match/${encodeURIComponent(matchId)}/forfeit`,
    ),
  leaderboard: () =>
    callJson<{ rows: readonly LeaderboardRow[] }>("/api/pvp/leaderboard"),
};

// ---- how often to talk ------------------------------------------------------
//
// Two rates, because the two phases want different things. While a question is
// open nothing moves and the only news is "the other side answered", so a slow
// poll is correct and a fast one is a waste of a school network. While the fight
// is live the snapshot IS the picture, so it is polled as fast as HTTP sensibly
// allows. Neither number is a simulation rate: the authority advances on its own
// fixed step and a late poll does not fast-forward the fight.

export const POLL_MS_QUESTION = 700;
export const POLL_MS_LIVE = 90;
export const POLL_MS_LOBBY = 900;

export function pollIntervalFor(phase: DuelPhase | null): number {
  if (phase === null) return POLL_MS_LOBBY;
  return phase === "QUESTION_PENDING" || phase === "VERDICT_COMMITTED"
    ? POLL_MS_QUESTION
    : POLL_MS_LIVE;
}
