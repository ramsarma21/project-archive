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
import { effectiveSessionId } from "../devSession.js";
import { validAssessmentMutationRequest } from "../assessment/requestPolicy.js";
import type { VerdictEnvelope } from "@pa/grading";
import {
  createDuelGrading,
  type DuelGrading,
  type DuelGradingOptions,
} from "../duels/grading.js";
import { parseDuelRound, parseDuelVerdictRequest } from "../duels/request.js";
import { receiptEnforcement } from "../duels/commitReceipts.js";
import type { DuelVerdictStore } from "../duels/verdictStore.js";
import type { ConceptRetrievalStore } from "../progression/retrievalStore.js";
import { evaluateEvidence, m1EvidencePolicyFor } from "../duels/evidence.js";
import { M1_CODEX_CARD_IDS } from "@pa/mission-m1";

const SESSION_COOKIE = "pa_session";

/**
 * The open progression attempt a duel is bound to, as the route needs it.
 *
 * Resolved from the authenticated profile's own progression, never from the
 * request: the duel id, the round's item and the receipt binding are all derived
 * from THIS, so a client cannot name a different attempt to be graded against.
 */
export interface DuelAttempt {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly attemptSeedHex: string;
  readonly missionId: string;
  readonly chapterId: string;
}

export type DuelAttemptResolver = (
  profileId: string,
) => Promise<DuelAttempt | null>;

/**
 * The server's own answer to "which duel is this attempt, and what does round N
 * ask". Both are computed from the stored attempt seed and ordinal by the same
 * algorithm the client runs (see @pa/mission-m1), so the server can grade the item
 * the round actually asks and refuse a duel id that is not the attempt's own.
 */
export interface DuelQuestionAuthority {
  duelId(attempt: DuelAttempt): string;
  expectedItemId(attempt: DuelAttempt, round: number): string;
  /**
   * The duel lane's repeat marker for this round, for the retrieval ledger.
   *
   * When the bank is exhausted the duel recycles items and marks the repeat
   * (`@pa/duel`'s `askQuestion`). Optional so an older wiring keeps working; a
   * missing implementation records the round as a fresh first appearance.
   */
  roundAppearance?(
    attempt: DuelAttempt,
    round: number,
  ): { recycled: boolean; appearance: number };
}

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
  /** The authenticated profile's current open progression attempt. */
  readonly resolveAttempt?: DuelAttemptResolver;
  /** The server's canonical duel id and per-round item for that attempt. */
  readonly questionAuthority?: DuelQuestionAuthority;
  /** The first-answer ledger. A key grades once and is returned verbatim after. */
  readonly verdictStore?: DuelVerdictStore;
  /**
   * The formative retrieval ledger. Optional and never on the grading path: a
   * failure to record is logged and swallowed, because a teacher-report ledger
   * must never be able to fail a student's round.
   */
  readonly retrieval?: ConceptRetrievalStore;
  /**
   * The Codex cards the boss-duel player is entitled to place as evidence. Defaults
   * to the full nine-card M1 deck: the boss is the mission capstone, so a player who
   * has reached it holds them all, and the offered hand is drawn from exactly this
   * deck. Injected so a test can restrict it and exercise the UNAUTHORIZED path.
   */
  readonly evidenceAuthorizedCardIds?: readonly string[];
  /**
   * The session resolver. Defaults to the real cookie-backed one; injected by
   * route tests so the attempt/verdict authority can be exercised without a DB —
   * exactly as the PvP routes take an `authenticate`.
   */
  readonly authenticate?: (
    sessionId: string | undefined,
  ) => Promise<{ profileId: string } | null>;
}

function makeRequireOwner(
  authenticate: NonNullable<DuelRouteOptions["authenticate"]>,
) {
  return async function requireOwner(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ profileId: string } | null> {
    // Non-production: the tab's dev-session header outranks the shared cookie.
    const user = await authenticate(effectiveSessionId(request));
    if (!user) {
      await reply.code(401).send({ error: "AUTH_REQUIRED" });
      return null;
    }
    return { profileId: user.profileId };
  };
}

/** The session cookie plus the CSRF header, exactly as its sibling routes do it. */
function csrfOk(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = request.headers["x-pa-csrf-token"];
  if (
    !validAssessmentMutationRequest({
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

export async function registerDuelRoutes(
  app: FastifyInstance,
  options: DuelRouteOptions = {},
): Promise<void> {
  const grading = options.grading ?? createDuelGrading(app.log, options);
  const authenticate =
    options.authenticate ??
    (async (sessionId) => {
      const user = await getSessionUser(sessionId);
      return user ? { profileId: user.profileId } : null;
    });
  const requireOwner = makeRequireOwner(authenticate);
  const { resolveAttempt, questionAuthority, verdictStore, retrieval } = options;
  const evidenceAuthorized = options.evidenceAuthorizedCardIds ?? M1_CODEX_CARD_IDS;

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

      // A refusal here reaches an AUTHENTICATED player who is about to be granted the
      // maximum by the client's own non-2xx fallback, silently. Recording it into the
      // grading signal is what stops that from leaving /v1/health reading OK while
      // every round is granted — the observability hole the client-side fallback
      // opened. It never fails the health check; it only makes the condition sayable.
      const noteUngraded = (
        reason: string,
        httpStatus: number,
        advice: string,
        itemId: string,
      ): void => {
        grading.signal.recordUngradedRefusal(request.log, {
          profileId: owner.profileId,
          duelId,
          roundIndex: round.round,
          itemId,
          reason,
          httpStatus,
          advice,
        });
      };

      if (!resolveAttempt || !questionAuthority || !verdictStore) {
        // A misconfigured server, never a request the client can cause. Refused
        // rather than graded, because grading without an attempt to bind to would
        // mint an unbindable verdict — exactly what this route now exists to stop.
        request.log.error(
          { profileId: owner.profileId, duelId },
          "duel grading: attempt/verdict authority not wired; refusing",
        );
        noteUngraded(
          "DUEL_AUTHORITY_UNAVAILABLE",
          400,
          "the duel route's attempt/verdict authority is not wired; check app.ts.",
          submission.itemId,
        );
        return reply.code(400).send({ error: "DUEL_AUTHORITY_UNAVAILABLE" });
      }

      // THE ATTEMPT IS THE SERVER'S, NOT THE REQUEST'S. Everything authoritative —
      // which duel this is, what the round asks, who the receipt is for — comes
      // from the profile's own open progression attempt. A request that names a
      // duel the profile is not in gets a refusal it cannot turn into a usable,
      // attempt-bound verdict.
      const attempt = await resolveAttempt(owner.profileId);
      if (!attempt) {
        request.log.warn(
          { profileId: owner.profileId, duelId },
          "duel grading: no open attempt for this profile; refusing",
        );
        noteUngraded(
          "NO_OPEN_ATTEMPT",
          409,
          "an authenticated player reached a graded round with no open progression " +
            "attempt, so the client granted the maximum ungraded. Ensure a mission " +
            "attempt is opened before the duel posts a verdict.",
          submission.itemId,
        );
        return reply.code(409).send({ error: "NO_OPEN_ATTEMPT" });
      }

      const canonicalDuelId = questionAuthority.duelId(attempt);
      if (duelId !== canonicalDuelId) {
        // The posted duel id is not this attempt's own. Refused, not graded: a
        // verdict here would bind to a duel the profile is not playing.
        request.log.warn(
          {
            profileId: owner.profileId,
            postedDuelId: duelId,
            attemptOrdinal: attempt.attemptOrdinal,
          },
          "duel grading: refused a duel id that is not the open attempt's own",
        );
        noteUngraded(
          "DUEL_NOT_CANONICAL",
          409,
          "the posted duel id is not the open attempt's canonical one, so the client " +
            "granted the maximum ungraded. The client must post m1DuelId(attemptOrdinal).",
          submission.itemId,
        );
        return reply.code(409).send({ error: "DUEL_NOT_CANONICAL" });
      }

      // The item the round ACTUALLY asks, computed by the server from the stored
      // attempt. The client's itemId/itemVersion/conceptId are claims and are used
      // for nothing but a diagnostic — choosing a different (easier) bank item
      // cannot change what is graded.
      const expectedItemId = questionAuthority.expectedItemId(attempt, round.round);
      const item = grading.bank.get(expectedItemId);
      if (item === undefined) {
        request.log.error(
          { profileId: owner.profileId, duelId: canonicalDuelId, expectedItemId },
          "duel grading: the server-selected item is not in the bank (content drift)",
        );
        noteUngraded(
          "ITEM_NOT_FOUND",
          404,
          "the server-selected item drifted out of the grading bank, so the round " +
            "could not be graded and the client granted the maximum. Re-sync the bank.",
          expectedItemId,
        );
        return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
      }
      if (submission.itemId !== expectedItemId) {
        // A forged or stale claim. Logged and ignored: the server grades the item
        // the round asks, so this can never move a verdict.
        request.log.warn(
          {
            profileId: owner.profileId,
            duelId: canonicalDuelId,
            round: round.round,
            claimedItemId: submission.itemId,
            expectedItemId,
          },
          "duel grading: client claimed a different item than the round asks; grading the server's",
        );
      }

      // THE EVIDENCE GATE, against the server's own hand for the server's own item.
      // The policy is re-derived from the round's expected item id — never from the
      // client — so the offered hand and which cards are relevant are the server's.
      // An illegal or insufficient selection is graded as UNSATISFIED (folded into a
      // WRONG below), never refused: a 4xx on this wire pays the client the full
      // magazine. The feedback code is a misconception class, never the answer.
      const evidencePolicy = m1EvidencePolicyFor(item.itemId);
      const evidence = evaluateEvidence(
        evidencePolicy,
        submission.selectedCardIds,
        evidenceAuthorized,
      );

      // FIRST ANSWER IS FINAL. The store grades this key exactly once; a repeat
      // submission — a changed answer, a reload, a double-fire, or a concurrent
      // racer — returns the first stored envelope, receipt and evidence and never
      // re-grades, so a second submission cannot change the cards either.
      const { record, firstMinted } = await verdictStore.resolve(
        {
          profileId: owner.profileId,
          duelId: canonicalDuelId,
          round: round.round,
        },
        async () => {
          const graded = await grading.grade({
            profileId: owner.profileId,
            // Bound to the attempt's own canonical duel id, so the receipt the
            // commit path verifies is for this fight and no other.
            duelId: canonicalDuelId,
            roundIndex: round.round,
            // The server-selected item, never the client's claim.
            itemId: item.itemId,
            answer: submission.answer,
            // Prose AND evidence: a CORRECT with unsatisfied evidence is minted as
            // WRONG whatever the prose source, because the card half is deterministic
            // and an outage is no reason to excuse it. An outage still grants the
            // prose half (source stays GRADING_TIMEOUT), so right cards still pass.
            evidenceSatisfied: evidence.satisfied,
          });
          return {
            envelope: graded.envelope,
            receipt: graded.receipt,
            gradingPath: graded.provenance.path,
            gradingLatencyMs: graded.provenance.latencyMs,
            fallbackDiagnosis: graded.provenance.fallbackDiagnosis,
            // The cards the first answer actually placed, as graded. Final with the
            // verdict — a replay or a second submission returns exactly these.
            selectedCardIds: evidence.selected,
          };
        },
      );

      // Fold the graded round into the formative retrieval ledger — once, on the
      // first mint, because that is the moment the server knows the concept, the
      // verdict and the repeat marker together. A repeat submission returns the
      // stored verdict (firstMinted false) and records nothing new, exactly as the
      // verdict store's "first answer is final" already guarantees. This is a
      // teacher-report ledger, never a gate, so a failure here is logged and
      // swallowed and can never fail the student's round.
      if (firstMinted && retrieval) {
        const appearance = questionAuthority.roundAppearance?.(attempt, round.round) ?? {
          recycled: false,
          appearance: 1,
        };
        try {
          await retrieval.record({
            profileId: owner.profileId,
            chapterId: attempt.chapterId,
            missionId: attempt.missionId,
            attemptId: attempt.attemptId,
            // The server-selected item's concept, never the client's claim.
            conceptId: item.conceptId,
            itemId: item.itemId,
            source: "DUEL",
            duelId: canonicalDuelId,
            roundIndex: round.round,
            correct: record.envelope.kind === "CORRECT",
            // A generous infrastructure grant is not evidence of retrieval.
            graded: record.envelope.source !== "GRADING_TIMEOUT",
            recycled: appearance.recycled,
            appearance: appearance.appearance,
            seenAt: new Date().toISOString(),
          });
        } catch (cause) {
          request.log.warn(
            { cause, profileId: owner.profileId, duelId: canonicalDuelId, round: round.round },
            "retrieval ledger: failed to record a graded duel round",
          );
        }
      }

      // Headers carry the receipt and the provenance; the body carries exactly the
      // five envelope keys the duel's parser accepts and nothing else. A repeat
      // submission emits the SAME receipt the first mint did, because the store
      // handed back the stored record rather than grading again.
      reply.header("x-pa-verdict-receipt", record.receipt);
      reply.header("x-pa-grading-path", record.gradingPath);
      reply.header(
        "x-pa-grading-latency-ms",
        String(Math.round(record.gradingLatencyMs)),
      );
      if (record.fallbackDiagnosis !== null) {
        reply.header("x-pa-grading-fallback", record.fallbackDiagnosis);
      }
      // The evidence feedback for the answering player, derived from the STORED
      // selection so a repeat submission reports the same class as the first. A
      // misconception class only (TOO_FEW, INCOMPATIBLE, …) — never which cards were
      // relevant, so it cannot become the answer before the verdict is shown.
      reply.header(
        "x-pa-evidence",
        evaluateEvidence(evidencePolicy, record.selectedCardIds, evidenceAuthorized)
          .feedback,
      );
      reply.header("cache-control", "no-store");

      return duelVerdictBody(record.envelope);
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
