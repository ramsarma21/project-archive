// The boss duel's grading endpoint. `POST /v1/duels/:duelId/rounds/:round/verdict`
//
// WHAT WAS BROKEN. `apps/web/src/duel/duelGrading.ts` has been posting to this
// path since the duel landed, and nothing in this app answered it. Every answer
// therefore took the client's 1.5-second abort path, and that path is not an
// error: Mission-Slate §1.7 says a player is never punished for infrastructure, so
// the client minted `GRADING_TIMEOUT`, the reducer read CORRECT, and the student
// was granted the full magazine. A blank box and a perfect answer bought the same
// fourteen balls, with a plausible pause in between. This file is the authority
// that was missing.
//
// THE RESPONSE BODY IS THE ENVELOPE, WITH NOTHING WRAPPED AROUND IT. The client
// hands `await response.json()` straight to @pa/duel's `parseVerdictEnvelope`,
// which rejects unknown fields BY NAME rather than ignoring them. A `receipt`,
// a `meta` or a `bullets` key would not be quietly dropped; it would fail the
// whole verdict and send the round back down the grant-everything path. So the
// body is exactly `kind`, `itemId`, `itemVersion`, `source`, `responseRef`, and
// everything else this route knows travels in headers where it cannot poison the
// parse. `/v1/grading/answers` returns `{verdict, receipt, meta}` because nothing
// parses it that strictly; this wire is not that wire.
//
// A BULLET COUNT NEVER CROSSES THIS WIRE, in either direction. The client derives
// fourteen or seven from `kind` alone. A client that can be told "fourteen" can
// tell itself "fourteen", so it is never told.
//
// EVERY REFUSAL IS A FULL MAGAZINE. This is the fact that shapes the whole file.
// The client treats any non-2xx as unreachable and grants the maximum, so a 400 is
// not a punishment — it is the most generous outcome available. Two consequences,
// both deliberate:
//
//   * Refuse only what genuinely cannot be graded. A stale `itemVersion` or a
//     disagreeing `conceptId` is logged and overridden, never refused, because the
//     server holds the authority for both and refusing would pay the client for
//     being wrong.
//   * There is NO RATE LIMIT here, and one must not be added naively. A limiter
//     that answers 429 is a switch a cheating client can throw on purpose: trip it
//     once and every remaining round of the duel is granted the maximum. Any
//     throttle worth having has to degrade to a graded outcome rather than to the
//     client's fallback, and that needs a change on the other side of the wire.
//
// THE ANSWER TEXT ENDS HERE. It exists in the request body, is handed to the
// classifier, and is never written to an event, a commit log, a response, or a log
// line. The review log records a hash and a length. Nothing the opponent can read
// ever contains it, which is the rule that keeps PvP from being an unmoderated
// chat channel between two students.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSessionUser } from "../auth.js";
import { validAssessmentMutationRequest } from "../assessment/requestPolicy.js";
import type { VerdictEnvelope } from "@pa/grading";
import {
  createDuelGrading,
  type DuelGrading,
  type DuelGradingOptions,
} from "../duels/grading.js";
import { parseDuelRound, parseDuelVerdictRequest } from "../duels/request.js";
import { receiptEnforcement } from "../duels/commitReceipts.js";

const SESSION_COOKIE = "pa_session";

/** A duel id is an HMAC input and a log field. Bounded like every other id. */
const MAX_DUEL_ID_CHARS = 200;

/**
 * The whole response body, built by naming the five keys one at a time rather
 * than by spreading, so a field added to the envelope upstream cannot arrive here
 * by omission and fail the client's parse.
 *
 * Exported because it is the contract: a test can assert this function's output
 * against @pa/duel's `VERDICT_ENVELOPE_KEYS` without needing a database or a
 * session, and the route has exactly one `return` and it is this.
 */
export function duelVerdictBody(
  envelope: VerdictEnvelope,
): Record<string, string | null> {
  return {
    kind: envelope.kind,
    itemId: envelope.itemId,
    itemVersion: envelope.itemVersion,
    source: envelope.source,
    responseRef: envelope.responseRef,
  };
}

export interface DuelRouteOptions extends DuelGradingOptions {
  /** Prebuilt grading, for tests and for sharing one service across routes. */
  readonly grading?: DuelGrading;
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

/** The session cookie plus the CSRF header, exactly as its sibling routes do it. */
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

export async function registerDuelRoutes(
  app: FastifyInstance,
  options: DuelRouteOptions = {},
): Promise<void> {
  const grading = options.grading ?? createDuelGrading(app.log, options);

  app.post<{ Params: { duelId: string; round: string } }>(
    "/v1/duels/:duelId/rounds/:round/verdict",
    async (request, reply) => {
      const owner = await requireOwner(request, reply);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;

      const duelId = request.params.duelId;
      if (duelId.length === 0 || duelId.length > MAX_DUEL_ID_CHARS) {
        return reply.code(400).send({ error: "BAD_REQUEST", reason: "DUEL_ID" });
      }
      const round = parseDuelRound(request.params.round);
      if (!round.ok) {
        // Not a round any duel can reach. Named separately from a bad body so the
        // one failure mode this route already had — a bound copied instead of
        // imported, refusing every long duel's later rounds — is visible if it
        // ever comes back.
        request.log.warn(
          { profileId: owner.profileId, duelId, round: request.params.round },
          "duel grading: refused a round outside the duel's structure",
        );
        return reply
          .code(400)
          .send({ error: "BAD_REQUEST", reason: "ROUND_OUT_OF_RANGE" });
      }

      const parsed = parseDuelVerdictRequest(request.body);
      if (!parsed.ok) {
        if (parsed.code === "VERDICT_NOT_ACCEPTED") {
          // A client trying to grade itself. Counted separately from a typo.
          request.log.warn(
            { profileId: owner.profileId, duelId, field: parsed.detail },
            "duel grading: rejected a client-supplied verdict field",
          );
          return reply.code(400).send({
            error: "VERDICT_NOT_ACCEPTED",
            message:
              "the server mints verdicts; a client may submit only an answer",
          });
        }
        request.log.warn(
          { profileId: owner.profileId, duelId, reason: parsed.code, detail: parsed.detail },
          "duel grading: refused a malformed submission",
        );
        return reply.code(400).send({ error: "BAD_REQUEST", reason: parsed.code });
      }
      const submission = parsed.value;

      const item = grading.bank.get(submission.itemId);
      if (item === undefined) {
        // The bank and the client's question source have drifted. Loud, because
        // the student is about to be handed a free magazine for a question nobody
        // can grade, and because it means a mission is serving unauthored content.
        request.log.error(
          { profileId: owner.profileId, duelId, itemId: submission.itemId },
          "duel grading: asked to grade an item that is not in the bank",
        );
        return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
      }
      if (
        submission.itemVersion !== item.rubricVersion ||
        submission.conceptId !== item.conceptId
      ) {
        // Overridden, not refused. The compiled bank derives a rubric version from
        // the content hash and the client carries a placeholder, so this fires on
        // every round today; it is logged at debug because the day it means
        // something is the day the client starts sending a real version.
        request.log.debug(
          {
            itemId: item.itemId,
            claimedVersion: submission.itemVersion,
            serverVersion: item.rubricVersion,
            claimedConcept: submission.conceptId,
            serverConcept: item.conceptId,
          },
          "duel grading: client item metadata disagrees with the bank; using the bank's",
        );
      }

      const graded = await grading.grade({
        profileId: owner.profileId,
        duelId,
        roundIndex: round.round,
        itemId: item.itemId,
        answer: submission.answer,
      });
      const { provenance } = graded;

      // The grant-maximum path is counted rather than merely logged, and it is
      // counted inside `grading.grade` — one line per round, whatever the
      // outcome, because a fallback COUNT without a round count cannot become a
      // RATE and a rate is the only form of this an operator can act on. See
      // ../duels/gradingSignal.ts: the numbers reach /v1/health, a CloudWatch
      // alarm, and an error-level escalation once a minute while it lasts. The
      // warning that used to live here said the same thing once per round and
      // nothing added it up.

      // Headers, because the body cannot carry a sixth key.
      //
      // The receipt is the one that matters: the verdict travels through a browser
      // to reach the duel's reducer, and whoever commits the attempt's verdicts has
      // to be able to prove the server minted this one for THIS player, THIS duel
      // and THIS round. Nothing on the client reads it yet — the commit path is
      // another file's — and it is emitted now so that when it does, the value it
      // needs was already on the wire rather than needing a second round trip.
      // `app.ts` now lists `x-pa-verdict-receipt` in the CORS `exposedHeaders`, so
      // `fetch` can read it cross-origin as well as through Vite's same-origin
      // proxy — the proxy is why nobody noticed it could not. What remains is the
      // client half: `apps/web/src/duel/duelGrading.ts` has to read the header and
      // carry it onto the round's `VERDICT_COMMITTED` entry, and
      // ../duels/commitReceipts.ts verifies it at the commit. Until it does, every
      // verdict commits as `unsigned` and the commit response says so.
      reply.header("x-pa-verdict-receipt", graded.receipt);
      reply.header("x-pa-grading-path", provenance.path);
      reply.header("x-pa-grading-latency-ms", String(Math.round(provenance.latencyMs)));
      // A verdict is per-request and per-player. Nothing between here and the
      // browser may keep one.
      reply.header("cache-control", "no-store");

      // Exactly the five keys @pa/duel's `parseVerdictEnvelope` accepts.
      return duelVerdictBody(graded.envelope);
    },
  );

  // Operational read: is grading actually grading? A green /v1/health while the
  // classifier has been unreachable for an hour is a silent outage in which every
  // student is being handed fourteen balls for anything they type.
  //
  // Session-gated, because `flaggedProfiles` is a count of people. The rate itself
  // is also on /v1/health, which needs no session, so a monitor or a teacher can
  // watch the number that matters without one.
  app.get("/v1/duels/grading/health", async (request, reply) => {
    const owner = await requireOwner(request, reply);
    if (!owner) return reply;
    const stats = grading.stats();
    return {
      ...grading.health,
      grading: grading.signal.snapshot(),
      receiptEnforcement: receiptEnforcement(),
      cache: stats.cache,
      // A profile listed here has spent its low-confidence allowance: either a
      // student leaning on the grader or a rubric bad enough to trip an honest one
      // repeatedly. Both want a human.
      flaggedProfiles: stats.flaggedProfiles,
    };
  });
}
