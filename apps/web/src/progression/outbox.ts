import type { CommitMissionOutcomeRequest } from "@pa/contracts";
import { postMissionOutcome, type ProgressionCallResult } from "../api.js";
import {
  dropOutcome,
  noteOutcomeAttempt,
  pendingOutcomes,
  queueMissionOutcome,
  type ProgressionOutboxEntry,
} from "../db.js";

// ---------------------------------------------------------------------------
// The offline answer.
//
// A student on a school network loses connectivity mid-mission. The two obvious
// responses are both wrong: losing the attempt punishes them for the network,
// and believing whatever the client says when it comes back hands the ladder to
// anyone with developer tools. The third answer is the one this file implements,
// and it works because of WHEN the server is consulted rather than how hard the
// client is trusted:
//
//   1. The attempt is AUTHORIZED ONLINE, before a frame is played. That round
//      trip writes the durable row carrying the attempt ordinal and the XP
//      fraction. Both are settled before the mission starts, and the row itself
//      is what spends the attempt — disconnecting mid-run cannot un-spend it,
//      and a unique index means there is never a second live attempt to farm.
//      No network at Deploy means no attempt is opened, which costs the student
//      nothing because they have not played anything yet.
//
//   2. The mission is PLAYED OFFLINE quite happily. Nothing in the run needs
//      the server; the level, the duel and the result are all local.
//
//   3. The outcome is COMMITTED LATER, from here. The commit carries one bit —
//      cleared or failed — against an attempt id the server already priced. A
//      commit that arrives an hour late is worth exactly what it would have been
//      worth on time, and a client that lies about the bit gains what a client
//      that lied about the bit online would have gained, which is the same
//      threat the design already accepts and no larger.
//
// So connectivity affects WHEN progression lands, never WHAT it is worth.
//
// The remaining subtlety is the answer that never arrives. A commit whose
// response is lost has still been applied server-side, and its retry answers
// ATTEMPT_CLOSED. That is a SUCCESS, not a failure, and treating it as one is
// what makes the retry safe to run forever.
// ---------------------------------------------------------------------------

/** What to do with a queued outcome after one delivery attempt. */
export type OutboxVerdict =
  /** The server holds this outcome. Forget it. */
  | "SETTLED"
  /** The server will never accept it and there is nothing left to preserve. */
  | "DISCARD"
  /** Unknown or not-yet. Keep it and try again. */
  | "RETAIN";

/**
 * Codes that mean the attempt has already been resolved server-side.
 *
 * `ATTEMPT_CLOSED` is the redelivery case above. It is the single most
 * important entry here: without it, every lost response becomes a queue entry
 * that retries forever against a row that will never accept it again.
 */
const ALREADY_SETTLED = new Set(["ATTEMPT_CLOSED"]);

/**
 * Refusals that are permanent AND leave nothing to salvage.
 *
 * `MISSION_SPENT` belongs here and is worth stating plainly: it means the
 * player's three attempts were already resolved, so this outcome was never
 * going to pay. That is the game rule working, not a save failing.
 *
 * `ATTEMPT_NOT_FOUND` means the row this message is addressed to does not
 * exist. There is no amount of waiting that conjures it.
 */
const PERMANENT_REFUSALS = new Set([
  "ATTEMPT_NOT_FOUND",
  "MISSION_SPENT",
  "BAD_REQUEST",
]);

/**
 * Classify one delivery attempt.
 *
 * Everything not named above is RETAINED, and the default matters more than the
 * lists do. Three cases it deliberately catches:
 *
 *   PACKAGE_MISSING — the server has no authored XP curve or mission reward for
 *     this chapter yet, so it refuses to price the clear. That is true today for
 *     every mission in the repository (`emptyProgressionContent`). Treating it
 *     as a refusal would quietly bin real play; retaining it means the queue
 *     drains and pays out the moment the content lands.
 *
 *   AUTH_REQUIRED / PROFILE_FORBIDDEN — this outcome belongs to a profile that
 *     is not the one currently signed in. Nothing is wrong with it; it is simply
 *     not this session's business, and it waits for its owner.
 *
 *   CSRF_INVALID — the token this device is holding has gone stale. A refreshed
 *     session fixes it.
 */
export function classifyDelivery(result: ProgressionCallResult<unknown>): OutboxVerdict {
  if (result.status === "OK") return "SETTLED";
  if (result.status === "UNREACHABLE") return "RETAIN";
  if (ALREADY_SETTLED.has(result.error)) return "SETTLED";
  if (PERMANENT_REFUSALS.has(result.error)) return "DISCARD";
  return "RETAIN";
}

/** Capped exponential backoff. Bounded so a long queue still drains promptly. */
export function retryDelayMs(attempts: number): number {
  const step = Math.min(Math.max(0, Math.floor(attempts)), 6);
  return Math.min(60_000, 1_000 * 2 ** step);
}

export interface OutboxFlush {
  readonly settled: number;
  readonly discarded: number;
  readonly retained: number;
  /** True while anything is still owed. The hub shows an unsynced marker. */
  readonly pending: boolean;
  readonly lastError: string | null;
}

/**
 * The durable store, as a port.
 *
 * A port rather than a direct Dexie call so the delivery policy — which is the
 * part with the security argument in it — can be exercised without a browser.
 * The default is IndexedDB and nothing else implements it in production.
 */
export interface OutboxQueue {
  list(profileId: string): Promise<ProgressionOutboxEntry[]>;
  drop(key: string): Promise<void>;
  note(key: string, error: string): Promise<void>;
}

const INDEXED_DB_QUEUE: OutboxQueue = {
  list: pendingOutcomes,
  drop: dropOutcome,
  note: noteOutcomeAttempt,
};

/** Record a resolved attempt for delivery. Idempotent per attempt id. */
export async function enqueueOutcome(input: {
  profileId: string;
  missionId: string;
  body: CommitMissionOutcomeRequest;
  at: string;
}): Promise<void> {
  await queueMissionOutcome({
    profileId: input.profileId,
    attemptId: input.body.attemptId,
    missionId: input.missionId,
    body: input.body,
    createdAt: input.at,
  });
}

export async function outstandingOutcomes(
  profileId: string,
): Promise<ProgressionOutboxEntry[]> {
  return pendingOutcomes(profileId);
}

/**
 * Deliver everything owed for one profile, oldest first.
 *
 * Scoped to a profile rather than draining the whole table on purpose: two
 * accounts share this database on a shared machine, and B's session must never
 * be used to push A's outcomes. A's stay queued until A signs back in.
 */
export async function flushOutcomes(input: {
  profileId: string;
  csrfToken: string;
  send?: (
    profileId: string,
    body: CommitMissionOutcomeRequest,
    csrfToken: string,
  ) => Promise<ProgressionCallResult<unknown>>;
  queue?: OutboxQueue;
}): Promise<OutboxFlush> {
  const send = input.send ?? postMissionOutcome;
  const queue = input.queue ?? INDEXED_DB_QUEUE;
  const queued = await queue.list(input.profileId);
  let settled = 0;
  let discarded = 0;
  let retained = 0;
  let lastError: string | null = null;

  for (const entry of queued) {
    // Belt and braces on the profile scope. `list` is already scoped, and this
    // refuses an entry that somehow arrived for a different account rather than
    // pushing it under whichever session happens to be open.
    if (entry.profileId !== input.profileId) continue;
    const result = await send(input.profileId, entry.body, input.csrfToken);
    const verdict = classifyDelivery(result);
    if (verdict === "SETTLED" || verdict === "DISCARD") {
      await queue.drop(entry.key);
      if (verdict === "SETTLED") settled += 1;
      else {
        discarded += 1;
        lastError = result.status === "REFUSED" ? result.error : lastError;
      }
      continue;
    }
    retained += 1;
    lastError =
      result.status === "REFUSED"
        ? result.error
        : result.status === "UNREACHABLE"
          ? result.detail
          : lastError;
    await queue.note(entry.key, lastError ?? "UNKNOWN");
    // One unreachable server means the rest of the queue is unreachable too.
    // Stopping here keeps a dead network to one failed request per flush.
    if (result.status === "UNREACHABLE") break;
  }

  const stillPending = await queue.list(input.profileId);
  return {
    settled,
    discarded,
    retained,
    pending: stillPending.length > 0,
    lastError,
  };
}
