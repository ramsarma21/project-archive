import {
  ProgressionSnapshotSchema,
  type AnswerAssessmentItemRequest,
  type ChapterAssessmentAttempt,
  type CommitMissionOutcomeRequest,
  type CompleteLearningModuleRequest,
  type LearningModuleCompletion,
  type MissionAttempt,
  type OnboardingPreferences,
  type OpenChapterAssessmentRequest,
  type OpenMissionAttemptRequest,
  type ProgressionSnapshot,
  type SessionResponse,
  type SubmitChapterAssessmentRequest,
} from "@pa/contracts";
import { snapshotBelongsTo } from "./progression/identity.js";

// Same-origin: Vite proxies /v1 -> API so session cookies are first-party.
const BASE = "";

// Thin API client. All game logic stays in the runtime worker; the API only
// handles identity and durable cloud saves. If the API is unreachable, the app
// still runs fully on local profiles.
export async function apiStatus(): Promise<{ up: boolean; google: boolean }> {
  try {
    const r = await fetch(`${BASE}/v1/health`, { credentials: "include" });
    if (!r.ok) return { up: false, google: false };
    const j = (await r.json()) as { ok?: boolean; google?: boolean };
    return { up: Boolean(j.ok), google: Boolean(j.google) };
  } catch {
    return { up: false, google: false };
  }
}

export async function getSession(): Promise<SessionResponse | null> {
  try {
    const r = await fetch(`${BASE}/v1/session`, { credentials: "include" });
    if (!r.ok) return null;
    return (await r.json()) as SessionResponse;
  } catch {
    return null;
  }
}

export function googleLoginUrl(): string {
  return `${BASE}/v1/auth/google/start`;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE}/v1/logout`, { method: "POST", credentials: "include" });
  } catch {
    /* offline logout is local-only */
  }
}

export async function saveOnboardingPreferences(
  profileId: string,
  preferences: OnboardingPreferences,
): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/v1/profiles/${profileId}/preferences`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(preferences),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ===========================================================================
// Progression transport
//
// Every call below is a thin, typed wrapper over a route in
// apps/api/src/routes/progression.ts. There is no arithmetic here and there is
// nothing optimistic here: this module moves bytes and classifies answers.
//
// The classification is the part that matters. A progression mutation ends in
// exactly one of three states and they are not interchangeable:
//
//   OK          the server processed it and its answer is the new truth.
//   REFUSED     the server processed it and said no. A refusal is a FACT about
//               the player's progression — the mission is spent, the attempt is
//               already closed — and re-sending it will produce the same no.
//   UNREACHABLE nobody answered, or the answer was unusable. This says nothing
//               at all about the player's progression, which is precisely why
//               it must never be treated as a refusal: a dropped packet on a
//               school network would otherwise read as "your mission is spent".
//
// The whole offline story rests on keeping those two failures apart.
// ===========================================================================

export type ProgressionCallResult<T> =
  | { readonly status: "OK"; readonly value: T }
  | {
      readonly status: "REFUSED";
      /** The server's own error code: MISSION_SPENT, MODULE_REQUIRED, … */
      readonly error: string;
      readonly httpStatus: number;
    }
  | { readonly status: "UNREACHABLE"; readonly detail: string };

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : `HTTP_${response.status}`;
  } catch {
    return `HTTP_${response.status}`;
  }
}

/**
 * POST one progression mutation.
 *
 * 5xx is deliberately UNREACHABLE rather than REFUSED. A crashed handler may
 * have committed its transaction before it died, so the only safe reading is
 * "unknown" — and every mutation on this surface is idempotent under retry
 * (an attempt that already committed answers ATTEMPT_CLOSED, which the caller
 * treats as success), so retrying an unknown is the correct move.
 */
async function postProgression<T>(
  profileId: string,
  path: string,
  body: unknown,
  csrfToken: string,
): Promise<ProgressionCallResult<T>> {
  try {
    const response = await fetch(
      `${BASE}/v1/profiles/${profileId}/progression/${path}`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-pa-csrf-token": csrfToken,
        },
        body: JSON.stringify(body),
      },
    );
    if (response.status >= 500) {
      return { status: "UNREACHABLE", detail: `HTTP_${response.status}` };
    }
    if (!response.ok) {
      return {
        status: "REFUSED",
        error: await readError(response),
        httpStatus: response.status,
      };
    }
    return { status: "OK", value: (await response.json()) as T };
  } catch (cause) {
    return {
      status: "UNREACHABLE",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * The full progression read.
 *
 * A snapshot that fails its own schema is reported UNREACHABLE, not refused:
 * for a read the two are the same situation — we did not obtain usable truth,
 * so fall back to the cache and show the player they are looking at a stale
 * figure. Parsing it here rather than casting means a server mid-migration
 * degrades to "stale" instead of to a hub drawing undefined.
 */
export async function pullProgression(
  profileId: string,
): Promise<ProgressionCallResult<ProgressionSnapshot>> {
  try {
    const response = await fetch(`${BASE}/v1/profiles/${profileId}/progression`, {
      credentials: "include",
    });
    if (response.status >= 500) {
      return { status: "UNREACHABLE", detail: `HTTP_${response.status}` };
    }
    if (!response.ok) {
      return {
        status: "REFUSED",
        error: await readError(response),
        httpStatus: response.status,
      };
    }
    const body = (await response.json()) as { progression?: unknown };
    const parsed = ProgressionSnapshotSchema.safeParse(body.progression);
    if (!parsed.success) {
      return { status: "UNREACHABLE", detail: "PROGRESSION_UNREADABLE" };
    }
    // Addressed to somebody else: a proxy or a cache has crossed two sessions,
    // and displaying it would be worse than showing nothing.
    if (!snapshotBelongsTo(parsed.data, profileId)) {
      return { status: "UNREACHABLE", detail: "PROGRESSION_WRONG_PROFILE" };
    }
    return { status: "OK", value: parsed.data };
  } catch (cause) {
    return {
      status: "UNREACHABLE",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Record the mandatory module. The request cannot name the attempt it opens —
 * the server reads attempts already resolved and decides — so this is also the
 * call that fixes which ordinal the next mission run will be.
 */
export function postModuleCompletion(
  profileId: string,
  body: CompleteLearningModuleRequest,
  csrfToken: string,
): Promise<ProgressionCallResult<LearningModuleCompletion>> {
  return postProgression(profileId, "modules", body, csrfToken);
}

/**
 * Open an attempt. This is the authorization, and the reason it exists as a
 * separate round trip: the row the server writes here carries the ordinal and
 * the XP fraction, so both are settled before a single frame of the mission
 * has been played and neither can be argued about afterwards.
 */
export function postOpenMissionAttempt(
  profileId: string,
  body: OpenMissionAttemptRequest,
  csrfToken: string,
): Promise<ProgressionCallResult<MissionAttempt>> {
  return postProgression(profileId, "mission-attempts", body, csrfToken);
}

/**
 * Commit the terminal outcome. The client asserts one bit — cleared or failed —
 * and the server recomputes the award, the Level, and the Rank from the ordinal
 * it stamped at open time.
 */
export function postMissionOutcome(
  profileId: string,
  body: CommitMissionOutcomeRequest,
  csrfToken: string,
): Promise<ProgressionCallResult<unknown>> {
  return postProgression(profileId, "mission-outcomes", body, csrfToken);
}

export function postOpenChapterAssessment(
  profileId: string,
  body: OpenChapterAssessmentRequest,
  csrfToken: string,
): Promise<ProgressionCallResult<ChapterAssessmentAttempt>> {
  return postProgression(profileId, "assessment-attempts", body, csrfToken);
}

export function postAssessmentAnswer(
  profileId: string,
  body: AnswerAssessmentItemRequest,
  csrfToken: string,
): Promise<ProgressionCallResult<{ answered: number; served: number }>> {
  return postProgression(profileId, "assessment-answers", body, csrfToken);
}

export function postAssessmentSubmission(
  profileId: string,
  body: SubmitChapterAssessmentRequest,
  csrfToken: string,
): Promise<ProgressionCallResult<unknown>> {
  return postProgression(profileId, "assessment-submissions", body, csrfToken);
}
