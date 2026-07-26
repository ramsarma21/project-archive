// Duel grading, exposed to the client.
//
// The whole of this file's security argument is what it does NOT do:
//
//   * It never reads a verdict from the request. `parseGradeAnswerRequest` is an
//     allowlist of four fields and it names a verdict-shaped key as a distinct
//     rejection, so a client cannot supply, hint at, or influence its own grade.
//   * It never reads a bullet count, and there is no field in the response that
//     could carry one. The duel's reducer derives three or one from `kind`.
//   * It returns a signed receipt alongside the verdict. The verdict travels
//     through the browser to reach the duel, so whoever commits the six verdicts at
//     the end of the attempt verifies the receipt before any of them counts. A
//     modified client can change `kind` in the payload it holds; it cannot produce
//     the matching HMAC.
//   * It never returns the rubric. The read endpoint hands back the question and
//     nothing else — not the reference answer, not the required ideas, not the
//     examples — because all three are the answer key.
//
// One authority gap is left open deliberately and is reported rather than hidden:
// which item belongs to round N of an attempt is decided by the mission container's
// seeded selection, which lives in another package. Inject a `RoundItemAuthority`
// and this route enforces it; without one it grades the item it is given and says
// `itemBinding: "UNVERIFIED"` in the response so the gap is visible in a network
// log rather than only in a comment.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEFAULT_JUDGING_POLICY,
  GradingService,
  ItemBank,
  JsonLineReviewLog,
  MemoryLowConfidenceLedger,
  MemoryVerdictCache,
  MultiReviewLog,
  TrueFoundryClassifierProvider,
  gradingModel,
  m1GradingPolicy,
  m1ItemBank,
  mintVerdictReceipt,
  parseGradeAnswerRequest,
  providerConfigured,
  verdictEnvelope,
  verdictReceiptSecret,
  type AnswerRetention,
  type ReviewLog,
  type RoundItemAuthority,
} from "@pa/grading";
import { getSessionUser } from "../auth.js";
import { validAssessmentMutationRequest } from "../assessment/requestPolicy.js";

const SESSION_COOKIE = "pa_session";

export interface GradingRouteOptions {
  /** Defaults to the M1 bank. Later chapters extend this, not this file. */
  readonly bank?: ItemBank;
  /** Enforces which item belongs to a round. See the note above. */
  readonly roundItems?: RoundItemAuthority;
  /** Retains the answer for review and supplies its opaque reference. */
  readonly retention?: AnswerRetention;
  readonly reviewLog?: ReviewLog;
}

async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ profileId: string } | null> {
  const user = await getSessionUser(request.cookies[SESSION_COOKIE]);
  if (!user) {
    await reply.code(401).send({ error: "AUTH_REQUIRED" });
    return null;
  }
  return { profileId: user.profileId };
}

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

export async function registerGradingRoutes(
  app: FastifyInstance,
  options: GradingRouteOptions = {},
): Promise<void> {
  const bank = options.bank ?? m1ItemBank();
  const configured = providerConfigured();
  if (!configured) {
    // Said once at boot rather than per request. Every round will grant the
    // maximum and log a review entry, which is loud enough on its own.
    app.log.warn(
      "grading: no classifier credential; every duel round will grant the generous fallback",
    );
  }
  const reviewLog: ReviewLog = new MultiReviewLog([
    new JsonLineReviewLog((line) => app.log.warn(line)),
    ...(options.reviewLog ? [options.reviewLog] : []),
  ]);
  // The judging rules are calibration read off TEA-scored student responses, and
  // they travel with the content bank rather than being written here.
  const authored = m1GradingPolicy();
  const lowConfidence = new MemoryLowConfidenceLedger();
  const service = new GradingService({
    bank,
    provider: configured ? new TrueFoundryClassifierProvider() : null,
    cache: new MemoryVerdictCache(),
    reviewLog,
    policy: {
      governingQuestion: DEFAULT_JUDGING_POLICY.governingQuestion,
      alwaysIgnore: authored.alwaysIgnore,
      neverSufficient: authored.neverSufficient,
    },
    lowConfidence,
  });

  // The question for a round. Authored content the player is about to be shown,
  // and deliberately not the rubric that grades it.
  app.get<{ Params: { itemId: string } }>(
    "/v1/grading/items/:itemId",
    async (request, reply) => {
      const owner = await requireOwner(request, reply);
      if (!owner) return reply;
      const item = bank.get(request.params.itemId);
      if (item === undefined) {
        return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
      }
      return {
        item: {
          itemId: item.itemId,
          itemVersion: item.rubricVersion,
          conceptId: item.conceptId,
          poolId: item.poolId,
          ask: item.ask,
        },
      };
    },
  );

  // Submit an answer, receive a verdict. The only way a verdict comes into being.
  app.post("/v1/grading/answers", async (request, reply) => {
    const owner = await requireOwner(request, reply);
    if (!owner) return reply;
    if (!csrfOk(request, reply)) return reply;

    const parsed = parseGradeAnswerRequest(request.body);
    if (!parsed.ok) {
      if (parsed.code === "VERDICT_NOT_ACCEPTED") {
        // A client trying to grade itself. Counted separately from a typo.
        request.log.warn(
          { profileId: owner.profileId, field: parsed.detail },
          "grading: rejected a client-supplied verdict field",
        );
        return reply.code(400).send({
          error: "VERDICT_NOT_ACCEPTED",
          message:
            "the server mints verdicts; a client may submit only an answer",
        });
      }
      return reply.code(400).send({ error: "BAD_REQUEST", reason: parsed.code });
    }
    const { itemId, attemptId, roundIndex, answer } = parsed.value;

    if (bank.get(itemId) === undefined) {
      return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    }

    let itemBinding: "ENFORCED" | "UNVERIFIED" = "UNVERIFIED";
    if (options.roundItems !== undefined) {
      const expected = await options.roundItems.expectedItemId(
        owner.profileId,
        attemptId,
        roundIndex,
      );
      if (expected === null) {
        return reply.code(409).send({ error: "ATTEMPT_UNKNOWN" });
      }
      if (expected !== itemId) {
        // Answering a different item than the one this round drew: either a stale
        // client or a search for the easiest question in the pool.
        return reply.code(409).send({ error: "ITEM_NOT_FOR_ROUND" });
      }
      itemBinding = "ENFORCED";
    }

    const responseRef =
      (await options.retention?.retain({
        profileId: owner.profileId,
        attemptId,
        roundIndex,
        itemId,
        answer,
      })) ?? null;

    const verdict = await service.grade({
      itemId,
      answer,
      profileId: owner.profileId,
      attemptId,
      roundIndex,
      responseRef,
    });

    const envelope = verdictEnvelope(verdict);
    return {
      // Exactly the five fields @pa/duel's parseVerdictEnvelope accepts.
      verdict: envelope,
      // Proof the server minted it. Verify before the verdict counts.
      receipt: mintVerdictReceipt(
        envelope,
        {
          profileId: owner.profileId,
          attemptId,
          roundIndex,
        },
        verdictReceiptSecret(),
      ),
      // Presentation and telemetry only. Nothing here changes a bullet count, and
      // the review flag is what the duel UI uses to tell a player their round was
      // granted rather than graded.
      meta: {
        path: verdict.provenance.path,
        latencyMs: Math.round(verdict.provenance.latencyMs),
        granted:
          verdict.source === "GRADING_TIMEOUT" ||
          verdict.provenance.lowConfidenceOutcome === "GRANTED",
        itemBinding,
      },
    };
  });

  // Operational read: is grading actually grading? A green /v1/health with a
  // grading provider that has been failing for an hour is a silent outage in which
  // every student gets three bullets for anything.
  app.get("/v1/grading/health", async (request, reply) => {
    const owner = await requireOwner(request, reply);
    if (!owner) return reply;
    return {
      configured,
      model: configured ? gradingModel() : null,
      policy: authored.policyId,
      items: bank.size,
      cache: service.cacheStats,
      // Where the low-confidence flag surfaces. A profile listed here has spent its
      // session allowance, which is either a student leaning on the grader or a
      // rubric bad enough to trip an honest one three times in an hour.
      flaggedProfiles: service.flaggedProfiles.length,
    };
  });
}
