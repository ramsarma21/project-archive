// POST /v1/dev/reset-mission — a dev-only reset of the CALLER'S OWN mission attempts.
//
// WHY IT EXISTS. Replaying M1 for testing used to need hand-written SQL against the
// shared database. This gives the dev harness a first-class control instead, and the
// CLI script (`src/dev/resetMission.ts`) is its operator-side twin.
//
// SAFETY IS THE DESIGN, NOT A FOOTNOTE. This erases progression, so it is gated three
// ways and every gate is independent:
//
//   1. ENVIRONMENT. It refuses outright when NODE_ENV === "production". The gate is
//      read PER REQUEST (not only captured at registration), so a process that came
//      up non-production but is later told it is production still refuses. It answers
//      404, not 403 — the same posture as routes/localSession.ts and devSession.ts —
//      so the surface is simply absent on a deployed task rather than advertised.
//   2. IDENTITY. A real session is required, and the reset is scoped to THAT session's
//      own profile. The profile id is read from the session, never from the request:
//      the body schema is `.strict()` and has no profile field, so a smuggled
//      `profileId` is a 400, and there is no code path by which one player's session
//      can name another player's profile. Scoped exactly as the progression
//      mutations in routes/progression.ts are.
//   3. CSRF + SAME ORIGIN. Identical to every other progression mutation, because a
//      reset spends progression just as a commit does.
//
// PRESERVES THE MODULE GATE. The service method it calls never touches
// `learning_module_completions`; the duel needs that gate satisfied to grade a
// canonical attempt, so wiping it would lock the player out of what they are testing.
// The response returns the resulting progression so a caller can CONFIRM the reset
// rather than assume it.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSessionUser } from "../auth.js";
import { effectiveSessionId } from "../devSession.js";
import { validAssessmentMutationRequest } from "../assessment/requestPolicy.js";
import type { ResetMissionAttemptsResult } from "../progression/service.js";
import type { ProgressionSnapshot } from "@pa/contracts";

/**
 * The whole request, and everything it may NOT carry. Strict on purpose: the
 * caller may narrow the reset to a chapter/mission, but it can never name a
 * profile — that comes from the session and nothing else.
 */
export const DevResetRequestSchema = z
  .object({
    chapterId: z.string().min(1).max(120).optional(),
    missionId: z.string().min(1).max(120).optional(),
  })
  .strict();

/** The two methods the route uses. Narrowed so a test can inject a fake. */
export interface DevResetProgressionPort {
  resetMissionAttempts(
    profileId: string,
    request: { chapterId: string; missionId: string },
  ): Promise<
    | { ok: true; value: ResetMissionAttemptsResult }
    | { ok: false; error: string }
  >;
  snapshot(profileId: string): Promise<ProgressionSnapshot>;
}

export interface DevResetDeps {
  readonly service: DevResetProgressionPort;
  /**
   * Non-production only. When omitted, evaluated per request as
   * `NODE_ENV !== "production"`. Injected as `false` by a test to assert the
   * production lock-out, or `true` to exercise the route without touching NODE_ENV.
   */
  readonly enabled?: boolean;
  /**
   * The session resolver. Defaults to the real cookie-backed one; injected by
   * route tests so the scoping can be exercised without a database — exactly as
   * the duel and PvP routes take an `authenticate`.
   */
  readonly authenticate?: (
    sessionId: string | undefined,
  ) => Promise<{ profileId: string } | null>;
  /** The chapter a bare reset targets. */
  readonly defaultChapterId: string;
  /** The mission a bare reset targets (M1). */
  readonly defaultMissionId: string;
  /** The origin a mutation must come from. Defaults to WEB_ORIGIN. */
  readonly allowedOrigin?: string;
}

export function registerDevResetRoute(app: FastifyInstance, deps: DevResetDeps): void {
  const authenticate =
    deps.authenticate ??
    (async (sessionId) => {
      const user = await getSessionUser(sessionId);
      return user ? { profileId: user.profileId } : null;
    });
  const allowedOrigin =
    deps.allowedOrigin ?? process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const service = deps.service;

  app.post("/v1/dev/reset-mission", async (request, reply) => {
    // GATE 1 — ENVIRONMENT. Read here so a production process refuses even though
    // the route was registered. Absent (404) rather than forbidden (403).
    const enabled = deps.enabled ?? process.env.NODE_ENV !== "production";
    if (!enabled) return reply.code(404).send({ error: "NOT_FOUND" });

    // GATE 2 — IDENTITY. A real session, and the reset is that session's own.
    const user = await authenticate(effectiveSessionId(request));
    if (!user) return reply.code(401).send({ error: "AUTH_REQUIRED" });

    // GATE 3 — CSRF + same origin, exactly as every other progression mutation.
    const token = request.headers["x-pa-csrf-token"];
    if (
      !validAssessmentMutationRequest({
        sessionId: effectiveSessionId(request),
        csrfToken: typeof token === "string" ? token : undefined,
        origin: request.headers.origin,
        allowedOrigin,
      })
    ) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }

    // A profile id in the body is not merely ignored — it is a 400, because a
    // strict schema is how "the caller cannot name a profile" is enforced by
    // construction rather than by a reader remembering to skip it.
    const parsed = DevResetRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

    const chapterId = parsed.data.chapterId ?? deps.defaultChapterId;
    const missionId = parsed.data.missionId ?? deps.defaultMissionId;

    // The profile is ALWAYS the session's own. There is no other source.
    const result = await service.resetMissionAttempts(user.profileId, {
      chapterId,
      missionId,
    });
    if (!result.ok) {
      const status = result.error === "CHAPTER_NOT_ACTIVE" ? 409 : 400;
      return reply.code(status).send({ error: result.error });
    }

    // Return the resulting progression so a caller can confirm, not assume.
    const progression = await service.snapshot(user.profileId);
    return { ok: true, reset: result.value, progression };
  });
}
