import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AbandonChapterAssessmentRequestSchema,
  AnswerAssessmentItemRequestSchema,
  CommitMissionOutcomeRequestSchema,
  CompleteLearningModuleRequestSchema,
  OpenChapterAssessmentRequestSchema,
  OpenMissionAttemptRequestSchema,
  SubmitChapterAssessmentRequestSchema,
} from "@pa/contracts";
import type { ReceiptBinding, VerdictEnvelope } from "@pa/grading";
import { getSessionUser } from "../auth.js";
import { effectiveSessionId } from "../devSession.js";
import { query } from "../db.js";
import { validAssessmentMutationRequest } from "../assessment/requestPolicy.js";
import {
  EMPTY_VERDICT_AUDIT,
  auditCommittedVerdicts,
  duelIdCandidates,
  receiptEnforcement,
  receiptRefusal,
  type CommittedVerdictAudit,
} from "../duels/commitReceipts.js";
import type { ServiceResult } from "../progression/service.js";
import { ProgressionService } from "../progression/service.js";

const SESSION_COOKIE = "pa_session";

/**
 * The forfeit request, and everything it is NOT allowed to carry.
 *
 * A forfeit names the attempt id (the server-projected open attempt) and nothing
 * else. The ordinal, the reward, the chapter and the mission are all read from the
 * stored row, which the service scopes to the owning profile — so this cannot close
 * another profile's run and cannot spend a second attempt. Strict, so a client
 * cannot smuggle an `attemptOrdinal` or an `awardedXp` in beside the id, the same
 * discipline the commit schema enforces because a forfeit spends an attempt just as
 * a commit does.
 */
const AbandonMissionAttemptRequestSchema = z
  .object({
    attemptId: z.string().uuid(),
  })
  .strict();

// A progression mutation is refused for one of these reasons and never
// silently downgraded, so a client cannot probe its way to a payout.
const CONFLICT_ERRORS = new Set([
  "MISSION_SPENT",
  "ATTEMPT_ALREADY_OPEN",
  "ATTEMPT_CLOSED",
  "PROGRESSION_CONFLICT",
]);

async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  profileId: string,
): Promise<{ profileId: string } | null> {
  // A tab's dev-session header outranks the shared cookie in non-production, so a
  // second local tab writes its OWN progression rather than the first tab's.
  const user = await getSessionUser(effectiveSessionId(request));
  if (!user) {
    await reply.code(401).send({ error: "AUTH_REQUIRED" });
    return null;
  }
  // Progression is written only by its owner. An educator may read reports
  // through the mastery surface; nobody may move another profile's Rank.
  if (user.profileId !== profileId) {
    await reply.code(403).send({ error: "PROFILE_FORBIDDEN" });
    return null;
  }
  return { profileId };
}

function csrfOk(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = request.headers["x-pa-csrf-token"];
  if (
    !validAssessmentMutationRequest({
      // Validate against the tab's effective session — the one its CSRF token was
      // minted for — so the dev-header path is not falsely rejected as forged.
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

function sendResult<T>(reply: FastifyReply, result: ServiceResult<T>): unknown {
  if (result.ok) return result.value;
  if (result.error === "BAD_REQUEST") return reply.code(400).send({ error: "BAD_REQUEST" });
  // An ungraded open response is a service condition, not the client's fault.
  if (result.error === "VERDICT_UNAVAILABLE") {
    return reply.code(503).send({ error: "VERDICT_UNAVAILABLE" });
  }
  if (result.error === "PACKAGE_MISSING") {
    return reply.code(400).send({
      error: "PACKAGE_MISSING",
      message: "no authored progression content for this chapter yet",
    });
  }
  return reply
    .code(CONFLICT_ERRORS.has(result.error) ? 409 : 400)
    .send({ error: result.error });
}

export interface ProgressionRouteOptions {
  /**
   * @pa/grading's `verifyVerdictReceipt`, bound to the server's signing key.
   *
   * Injected rather than imported so this file does not decide which secret signs
   * a verdict — `apps/api/src/duels/grading.ts` owns that, and passing its own
   * `verifyReceipt` is what guarantees the commit checks the same key the mint
   * used. Optional because a test can build the progression routes without a
   * grading service; when it is absent every verdict entry counts as unsigned,
   * exactly as one with no receipt does.
   */
  readonly verifyVerdictReceipt?: (
    envelope: VerdictEnvelope,
    binding: ReceiptBinding,
    receipt: string,
  ) => boolean;
}

/**
 * Audit the duel verdicts in one commit's log against their receipts.
 *
 * The binding needs the DUEL id and the request names an ATTEMPT, so the attempt
 * row is read for the mission and ordinal the duel id is composed from. A row that
 * cannot be read is not an error here — the service is about to answer
 * ATTEMPT_NOT_FOUND with the same information — so it yields an empty audit and
 * lets the real refusal happen where it belongs.
 */
async function auditCommitLog(
  input: {
    readonly profileId: string;
    readonly attemptId: string;
    readonly committedEvents: readonly unknown[];
    readonly verify: ProgressionRouteOptions["verifyVerdictReceipt"];
  },
): Promise<CommittedVerdictAudit> {
  if (input.committedEvents.length === 0) return EMPTY_VERDICT_AUDIT;
  const rows = await query<{ mission_id: string; attempt_ordinal: number }>(
    "select mission_id, attempt_ordinal from mission_attempts where id=$1 and profile_id=$2",
    [input.attemptId, input.profileId],
  );
  const row = rows.rows[0];
  if (!row) return EMPTY_VERDICT_AUDIT;
  return auditCommittedVerdicts({
    profileId: input.profileId,
    events: input.committedEvents,
    duelIdCandidates: duelIdCandidates({
      missionId: row.mission_id,
      attemptOrdinal: row.attempt_ordinal,
    }),
    // No verifier wired means nothing can be authenticated, which is the same
    // state as a missing receipt rather than a passing one.
    verify: input.verify ?? (() => false),
  });
}

export async function registerProgressionRoutes(
  app: FastifyInstance,
  service: ProgressionService,
  options: ProgressionRouteOptions = {},
): Promise<void> {
  // Read: safe for a client to hold, impossible for it to author.
  app.get<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/progression",
    async (request, reply) => {
      const owner = await requireOwner(request, reply, request.params.profileId);
      if (!owner) return reply;
      return { progression: await service.snapshot(owner.profileId) };
    },
  );

  app.post<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/progression/modules",
    async (request, reply) => {
      const owner = await requireOwner(request, reply, request.params.profileId);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;
      const parsed = CompleteLearningModuleRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
      return sendResult(
        reply,
        await service.completeLearningModule(owner.profileId, parsed.data),
      );
    },
  );

  app.post<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/progression/mission-attempts",
    async (request, reply) => {
      const owner = await requireOwner(request, reply, request.params.profileId);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;
      const parsed = OpenMissionAttemptRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
      // The variation seed comes from the profile row, never from the client.
      const rows = await query<{ variation_root_seed_hex: string }>(
        "select variation_root_seed_hex from profiles where id=$1",
        [owner.profileId],
      );
      const seed = rows.rows[0]?.variation_root_seed_hex;
      if (!seed) return reply.code(403).send({ error: "PROFILE_FORBIDDEN" });
      return sendResult(
        reply,
        await service.openMissionAttempt(owner.profileId, parsed.data, seed),
      );
    },
  );

  app.post<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/progression/mission-outcomes",
    async (request, reply) => {
      const owner = await requireOwner(request, reply, request.params.profileId);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;
      const parsed = CommitMissionOutcomeRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });

      // THE VERDICT RECEIPT IS CHECKED HERE, BEFORE THE COMMIT.
      //
      // The duel's verdicts were minted by the server and relayed through a
      // browser, and this is where their durable record arrives. A receipt that is
      // present and does not hold is a verdict this server can prove it did not
      // mint, and it refuses. A verdict with no receipt is COUNTED and let through
      // while enforcement is AUDIT, because no client carries the header yet and
      // refusing first would cost every student their clear for a change that has
      // not shipped. See ../duels/commitReceipts.ts.
      const enforcement = receiptEnforcement();
      const audit = await auditCommitLog({
        profileId: owner.profileId,
        attemptId: parsed.data.attemptId,
        committedEvents: parsed.data.committedEvents,
        verify: options.verifyVerdictReceipt,
      });
      const refusal = receiptRefusal(audit, enforcement);
      if (refusal !== null) {
        request.log.error(
          {
            profileId: owner.profileId,
            attemptId: parsed.data.attemptId,
            enforcement,
            reason: refusal,
            audit,
          },
          "progression: refused a commit whose duel verdicts could not be authenticated",
        );
        return reply.code(409).send({ error: refusal });
      }
      if (audit.claims > 0 && audit.verified < audit.claims) {
        // Not an error and not silent. The number that matters is how many
        // verdicts we can authenticate; while that is zero, the anti-cheat
        // backbone of the ranked ladder is not load-bearing and somebody should be
        // able to see it without reading this file.
        request.log.warn(
          {
            profileId: owner.profileId,
            attemptId: parsed.data.attemptId,
            enforcement,
            audit,
          },
          "progression: committed duel verdicts that carried no verifiable receipt",
        );
      }

      const result = await service.commitMissionOutcome(owner.profileId, parsed.data);
      if (!result.ok) return sendResult(reply, result);
      return {
        ...result.value,
        // Reported on the response so the gap is visible in a network log rather
        // than only in a server log nobody has open. Purely informational: nothing
        // the client can do with it changes a number, and the client is not asked
        // to act on it.
        verdictReceipts: {
          enforcement,
          claims: audit.claims,
          verified: audit.verified,
          unsigned: audit.unsigned,
          unbound: audit.unbound,
          malformed: audit.malformed,
        },
      };
    },
  );

  // Forfeit an interrupted mission attempt. Same auth and CSRF as every other
  // progression write, because it spends an attempt: closing the profile's open
  // run as FAILED is exactly as consequential as committing one.
  app.post<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/progression/mission-abandonments",
    async (request, reply) => {
      const owner = await requireOwner(request, reply, request.params.profileId);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;
      const parsed = AbandonMissionAttemptRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
      return sendResult(
        reply,
        await service.abandonMissionAttempt(owner.profileId, parsed.data),
      );
    },
  );

  app.post<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/progression/assessment-attempts",
    async (request, reply) => {
      const owner = await requireOwner(request, reply, request.params.profileId);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;
      const parsed = OpenChapterAssessmentRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
      return sendResult(
        reply,
        await service.openChapterAssessment(owner.profileId, parsed.data),
      );
    },
  );

  app.post<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/progression/assessment-answers",
    async (request, reply) => {
      const owner = await requireOwner(request, reply, request.params.profileId);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;
      const parsed = AnswerAssessmentItemRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
      return sendResult(
        reply,
        await service.answerAssessmentItem(owner.profileId, parsed.data),
      );
    },
  );

  app.post<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/progression/assessment-abandonments",
    async (request, reply) => {
      const owner = await requireOwner(request, reply, request.params.profileId);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;
      const parsed = AbandonChapterAssessmentRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
      return sendResult(
        reply,
        await service.abandonChapterAssessment(owner.profileId, parsed.data),
      );
    },
  );

  app.post<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/progression/assessment-submissions",
    async (request, reply) => {
      const owner = await requireOwner(request, reply, request.params.profileId);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;
      const parsed = SubmitChapterAssessmentRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "BAD_REQUEST" });
      return sendResult(
        reply,
        await service.submitChapterAssessment(owner.profileId, parsed.data.attemptId),
      );
    },
  );
}
