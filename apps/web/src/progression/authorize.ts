import type { MissionAttempt, XpFraction } from "@pa/contracts";
import {
  postModuleCompletion,
  postOpenMissionAttempt,
  type ProgressionCallResult,
} from "../api.js";
import type { ModuleRunCompletion } from "../module/moduleGate.js";
import { moduleCompletionRequest } from "./commit.js";

// ---------------------------------------------------------------------------
// Attempt authorization: the only door into a graded mission.
//
// The exploit this closes is small to describe and total in effect. The module
// gate and the attempt tally used to live in client state, so a player who
// cleared their browser storage got three fresh attempts on a mission they had
// already burned — and "three attempts, then it is spent forever" is not a
// difficulty setting, it is the reason the game is allowed to be hard. A rule
// that a student can reset by pressing Clear Site Data is not a rule.
//
// So the count of attempts a student has spent does not live in the browser at
// all. It lives in `mission_progress.attempts_used`, it is incremented by the
// server when an attempt resolves, and the client's copy of it is a cache with
// no authority whatsoever. This function is where that becomes operative: an
// attempt exists because the SERVER wrote a row saying so, and the row carries
// the ordinal and the XP fraction. Nothing the client does afterwards can
// change what the run is worth, because the price was set before it started.
//
// Two properties fall out of doing it here rather than at payout time:
//
//   * The refusal arrives before the player has spent five minutes. Refusing a
//     spent mission at the commit is technically sufficient and pedagogically
//     awful.
//   * The attempt is spent by BEING OPENED. Pulling the network cable in the
//     middle of a losing run does not give it back.
// ---------------------------------------------------------------------------

export type AuthorizationRefusal =
  /** Nobody is signed in, so there is nothing durable to open an attempt on. */
  | "NO_PROFILE"
  /** The server could not be reached. Nothing was opened and nothing was spent. */
  | "OFFLINE"
  | "MISSION_SPENT"
  | "MODULE_REQUIRED"
  | "MISSION_LOCKED"
  /** The chapter has no authored reward or curve yet, so it cannot be priced. */
  | "CONTENT_MISSING"
  /**
   * A run left open by an earlier session is still open server-side. It is NOT
   * resumed into this fresh runtime — that was the unlimited-replay bug — so the
   * only way forward is to forfeit it, which spends the attempt honestly and lets
   * the next one open. The hub surfaces this from `snapshot.openAttempt`.
   */
  | "ATTEMPT_INTERRUPTED"
  | "REFUSED";

export interface AttemptAuthorization {
  readonly attemptId: string;
  /** Assigned by the server from attempts already resolved. 1, 2 or 3. */
  readonly attemptOrdinal: number;
  /** The server's per-attempt seed. The level's variation must follow this. */
  readonly attemptSeedHex: string;
  readonly moduleId: string;
  readonly moduleCompletedAt: string;
  /** Stamped at open time. Display only — the payout is recomputed anyway. */
  readonly xpFraction: XpFraction;
  /**
   * False when the container's locally-derived ordinal disagreed with the
   * server's. Always the server's that is used; this exists so a hub showing
   * "full XP" on what is really a retry can correct itself and say so.
   */
  readonly clientOrdinalMatched: boolean;
}

export type AuthorizationResult =
  | { readonly ok: true; readonly authorization: AttemptAuthorization }
  | {
      readonly ok: false;
      readonly reason: AuthorizationRefusal;
      readonly detail: string;
    };

const REFUSAL_BY_CODE: Readonly<Record<string, AuthorizationRefusal>> = {
  MISSION_SPENT: "MISSION_SPENT",
  MODULE_REQUIRED: "MODULE_REQUIRED",
  MISSION_LOCKED: "MISSION_LOCKED",
  CHAPTER_NOT_ACTIVE: "MISSION_LOCKED",
  PACKAGE_MISSING: "CONTENT_MISSING",
  AUTH_REQUIRED: "NO_PROFILE",
  PROFILE_FORBIDDEN: "NO_PROFILE",
};

function refusalFor(result: ProgressionCallResult<unknown>): AuthorizationResult {
  if (result.status === "UNREACHABLE") {
    return { ok: false, reason: "OFFLINE", detail: result.detail };
  }
  if (result.status === "REFUSED") {
    return {
      ok: false,
      reason: REFUSAL_BY_CODE[result.error] ?? "REFUSED",
      detail: result.error,
    };
  }
  return { ok: false, reason: "REFUSED", detail: "UNEXPECTED_OK" };
}

function authorizationFrom(input: {
  attempt: MissionAttempt;
  expectedOrdinal: number;
}): AttemptAuthorization {
  return {
    attemptId: input.attempt.attemptId,
    attemptOrdinal: input.attempt.attemptOrdinal,
    attemptSeedHex: input.attempt.attemptSeedHex,
    moduleId: input.attempt.moduleId,
    moduleCompletedAt: input.attempt.moduleCompletedAt,
    xpFraction: input.attempt.xpFraction,
    clientOrdinalMatched: input.attempt.attemptOrdinal === input.expectedOrdinal,
  };
}

export interface AuthorizeAttemptInput {
  readonly profileId: string | null;
  readonly csrfToken: string | null;
  readonly chapterId: string;
  /** The completed module run. Its cue ids are what the server checks. */
  readonly completion: ModuleRunCompletion;
}

/**
 * Record the module and open the attempt, in that order, online.
 *
 * Online-only, deliberately, and it is the one place in this layer that refuses
 * to work offline. A module completion cannot be queued: the server binds it to
 * whichever attempt ordinal is next AT THE MOMENT IT ARRIVES, so a completion
 * recorded during attempt 1 and delivered after attempt 1 resolved would arm
 * attempt 2 with a module the student never re-ran — the retry gate, quietly
 * bypassed by a bad wifi moment. Failing closed at Deploy costs a student a
 * retry of a button press. Failing open costs the teaching.
 */
export async function authorizeAttempt(
  input: AuthorizeAttemptInput,
): Promise<AuthorizationResult> {
  const { profileId, csrfToken, chapterId, completion } = input;
  if (!profileId || !csrfToken) {
    return {
      ok: false,
      reason: "NO_PROFILE",
      detail: "no signed-in profile to record progression against",
    };
  }

  const payload = moduleCompletionRequest({ chapterId, completion });
  if (!payload.ok) {
    return { ok: false, reason: "REFUSED", detail: payload.reason };
  }

  const recorded = await postModuleCompletion(profileId, payload.body, csrfToken);
  if (recorded.status !== "OK") {
    // MISSION_SPENT surfaces here as well as at the open, because the server
    // will not record a module for an attempt that can never exist.
    return refusalFor(recorded);
  }

  const opened = await postOpenMissionAttempt(
    profileId,
    { chapterId, missionId: completion.missionId },
    csrfToken,
  );
  if (opened.status === "OK") {
    return {
      ok: true,
      authorization: authorizationFrom({
        attempt: opened.value,
        expectedOrdinal: completion.attemptOrdinal,
      }),
    };
  }

  // A run this profile never finished is still open — the tab was closed mid
  // mission, or the network died and the page was reloaded. It is NOT resumed
  // into this fresh runtime: the runtime restarts from the top while the durable
  // attempt keeps its progress, so handing the row back to a new runtime is the
  // unlimited-replay bug (reload, get the losing attempt back, forever). One live
  // run at a time, and the only way past an interrupted one is to forfeit it —
  // which the hub offers off `snapshot.openAttempt`, spending the attempt honestly.
  if (opened.status === "REFUSED" && opened.error === "ATTEMPT_ALREADY_OPEN") {
    return {
      ok: false,
      reason: "ATTEMPT_INTERRUPTED",
      detail: "an attempt is still open; forfeit it to retry",
    };
  }

  return refusalFor(opened);
}
