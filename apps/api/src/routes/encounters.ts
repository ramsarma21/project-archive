// The perspective-encounter grading authority. `POST /v1/encounters/:encounterId/verdict`
//
// This is the sibling of ./duels.ts, and it is built the same way and for the
// same reasons: the encounter a round asks is the SERVER's to decide, the answer
// text ends at the classifier, and the first verdict for a {profile, attempt,
// encounter} is final. The differences are only two, and both are content:
//
//   * the bank is `m1EncounterBank()` — the six authored perspective items — and
//     the grading is the same generalised @pa/grading service the duel uses,
//     with the same TrueFoundry classifier, the same generous timeout grant, and
//     the same HMAC receipt.
//   * there is one round per encounter, so the durable ledger is keyed by the
//     encounter's own canonical id at round 0. That id namespaces encounter
//     verdicts inside the SAME `duel_verdicts` store the boss duel uses — no new
//     table, no new migration — because "first answer is final, concurrency-safe,
//     repeats return the stored verdict verbatim" is exactly the property that
//     store already provides.
//
// EVERY REFUSAL IS THE GENEROUS OUTCOME, as in the duel route: the client treats
// a non-2xx as unreachable and grants the maximum, so a service outage or a
// misconfiguration cannot trap a player at a stop — it lets them through. That is
// deliberate; the encounter is REQUIRED for traversal, and a model outage must
// never soft-lock the route.
//
// THE BODY IS THE ENVELOPE AND NOTHING ELSE. A reference answer, an idea, an
// accept/reject example never crosses this wire. The five envelope keys and the
// provenance headers are the whole response, so a client cannot read the rubric
// off a verdict.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getSessionUser } from "../auth.js";
import { effectiveSessionId } from "../devSession.js";
import { validAssessmentMutationRequest } from "../assessment/requestPolicy.js";
import type { VerdictEnvelope } from "@pa/grading";
import { MAX_SUBMITTED_ANSWER_CHARS } from "@pa/grading";
import {
  M1_ENCOUNTERS,
  expectedEncounterItemId,
  type EncounterId,
} from "@pa/mission-m1";
import {
  createDuelGrading,
  type DuelGrading,
  type DuelGradingOptions,
} from "../duels/grading.js";
import { m1EncounterBank } from "@pa/grading";
import type { DuelVerdictStore } from "../duels/verdictStore.js";
import type { ConceptRetrievalStore } from "../progression/retrievalStore.js";

const SESSION_COOKIE = "pa_session";
const MAX_ID_CHARS = 200;

const ENCOUNTER_IDS = new Set<string>(M1_ENCOUNTERS.map((enc) => enc.id));

/** The open progression attempt the encounter is bound to. See ./duels.ts. */
export interface EncounterAttempt {
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly attemptSeedHex: string;
  readonly missionId: string;
  readonly chapterId: string;
}

export type EncounterAttemptResolver = (
  profileId: string,
) => Promise<EncounterAttempt | null>;

/**
 * The server's own answer to "which item does this encounter ask, and what id
 * does its verdict bind to", computed from the stored attempt by the same
 * @pa/mission-m1 helper the client runs — so the server grades the item the stop
 * actually asks and binds a receipt to a canonical id a client cannot forge.
 */
export interface EncounterQuestionAuthority {
  canonicalId(attempt: EncounterAttempt, encounterId: EncounterId): string;
  expectedItemId(attempt: EncounterAttempt, encounterId: EncounterId): string;
}

/** The default authority: canonical id and item id derived from the attempt. */
export function defaultEncounterQuestionAuthority(): EncounterQuestionAuthority {
  return {
    canonicalId: (attempt, encounterId) =>
      `${attempt.attemptId}#enc@${encounterId}`,
    expectedItemId: (attempt, encounterId) =>
      expectedEncounterItemId({
        encounterId,
        attemptSeedHex: attempt.attemptSeedHex,
        attemptOrdinal: attempt.attemptOrdinal,
      }),
  };
}

export interface EncounterRouteOptions extends DuelGradingOptions {
  readonly grading?: DuelGrading;
  readonly resolveAttempt?: EncounterAttemptResolver;
  readonly questionAuthority?: EncounterQuestionAuthority;
  readonly verdictStore?: DuelVerdictStore;
  /**
   * The formative retrieval ledger. Optional and off the grading path: a failure
   * to record is logged and swallowed so a stop can never soft-lock on it.
   */
  readonly retrieval?: ConceptRetrievalStore;
  readonly authenticate?: (
    sessionId: string | undefined,
  ) => Promise<{ profileId: string } | null>;
}

/** The five keys the client parser accepts. Named one at a time; never spread. */
export function encounterVerdictBody(
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

/** Field names that would mean a client is grading itself. Refused, not dropped. */
const VERDICT_SHAPED_KEYS = new Set([
  "verdict",
  "kind",
  "grade",
  "graded",
  "correct",
  "result",
  "outcome",
  "score",
  "bullets",
  "source",
  "confidence",
  "ideas",
  "receipt",
]);

type EncounterRequestParse =
  | { readonly ok: true; readonly answer: string; readonly itemId: string | null }
  | { readonly ok: false; readonly code: string; readonly detail: string };

/**
 * The encounter body: an answer, and an optional itemId CLAIM used only for a
 * diagnostic. A verdict-shaped key is a refusal, never a silent drop.
 */
export function parseEncounterRequest(body: unknown): EncounterRequestParse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "NOT_AN_OBJECT", detail: typeof body };
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set(["answer", "itemId"]);
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    if (VERDICT_SHAPED_KEYS.has(key.toLowerCase())) {
      return { ok: false, code: "VERDICT_NOT_ACCEPTED", detail: key };
    }
    return { ok: false, code: "UNKNOWN_FIELD", detail: key };
  }
  if (!("answer" in record) || typeof record["answer"] !== "string") {
    return { ok: false, code: "MISSING_FIELD", detail: "answer" };
  }
  const answer = record["answer"] as string;
  if (answer.length > MAX_SUBMITTED_ANSWER_CHARS) {
    return { ok: false, code: "ANSWER_TOO_LONG", detail: String(answer.length) };
  }
  let itemId: string | null = null;
  if ("itemId" in record) {
    if (typeof record["itemId"] !== "string") {
      return { ok: false, code: "BAD_FIELD_TYPE", detail: "itemId" };
    }
    itemId = record["itemId"] as string;
  }
  return { ok: true, answer, itemId };
}

function makeRequireOwner(
  authenticate: NonNullable<EncounterRouteOptions["authenticate"]>,
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

export async function registerEncounterRoutes(
  app: FastifyInstance,
  options: EncounterRouteOptions = {},
): Promise<void> {
  const grading =
    options.grading ?? createDuelGrading(app.log, { ...options, bank: m1EncounterBank() });
  const authenticate =
    options.authenticate ??
    (async (sessionId) => {
      const user = await getSessionUser(sessionId);
      return user ? { profileId: user.profileId } : null;
    });
  const requireOwner = makeRequireOwner(authenticate);
  const questionAuthority =
    options.questionAuthority ?? defaultEncounterQuestionAuthority();
  const { resolveAttempt, verdictStore, retrieval } = options;

  app.post<{ Params: { encounterId: string } }>(
    "/v1/encounters/:encounterId/verdict",
    async (request, reply) => {
      const owner = await requireOwner(request, reply);
      if (!owner) return reply;
      if (!csrfOk(request, reply)) return reply;

      const encounterId = request.params.encounterId;
      if (encounterId.length === 0 || encounterId.length > MAX_ID_CHARS) {
        return reply.code(400).send({ error: "BAD_REQUEST", reason: "ENCOUNTER_ID" });
      }
      if (!ENCOUNTER_IDS.has(encounterId)) {
        // Not a stop this mission authors. Refused (the generous outcome), never
        // graded against a made-up id.
        request.log.warn(
          { profileId: owner.profileId, encounterId },
          "encounter grading: refused an unknown encounter id",
        );
        return reply.code(404).send({ error: "ENCOUNTER_NOT_FOUND" });
      }

      const parsed = parseEncounterRequest(request.body);
      if (!parsed.ok) {
        if (parsed.code === "VERDICT_NOT_ACCEPTED") {
          request.log.warn(
            { profileId: owner.profileId, encounterId, field: parsed.detail },
            "encounter grading: rejected a client-supplied verdict field",
          );
          return reply.code(400).send({
            error: "VERDICT_NOT_ACCEPTED",
            message: "the server mints verdicts; a client may submit only an answer",
          });
        }
        return reply.code(400).send({ error: "BAD_REQUEST", reason: parsed.code });
      }

      if (!resolveAttempt || !verdictStore) {
        request.log.error(
          { profileId: owner.profileId, encounterId },
          "encounter grading: attempt/verdict authority not wired; refusing",
        );
        return reply.code(400).send({ error: "ENCOUNTER_AUTHORITY_UNAVAILABLE" });
      }

      const attempt = await resolveAttempt(owner.profileId);
      if (!attempt) {
        request.log.warn(
          { profileId: owner.profileId, encounterId },
          "encounter grading: no open attempt for this profile; refusing",
        );
        return reply.code(409).send({ error: "NO_OPEN_ATTEMPT" });
      }

      const canonicalId = questionAuthority.canonicalId(
        attempt,
        encounterId as EncounterId,
      );
      const expectedItemId = questionAuthority.expectedItemId(
        attempt,
        encounterId as EncounterId,
      );
      const item = grading.bank.get(expectedItemId);
      if (item === undefined) {
        request.log.error(
          { profileId: owner.profileId, encounterId, expectedItemId },
          "encounter grading: the server-selected item is not in the bank (content drift)",
        );
        return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
      }
      if (parsed.itemId && parsed.itemId !== expectedItemId) {
        request.log.warn(
          {
            profileId: owner.profileId,
            encounterId,
            claimedItemId: parsed.itemId,
            expectedItemId,
          },
          "encounter grading: client claimed a different item than the stop asks; grading the server's",
        );
      }

      // First answer is final. The store grades this key once; a repeat — a
      // changed answer, a reload, a double-fire, a racer — returns the first
      // stored envelope and receipt and never re-grades. One round per encounter,
      // so the round index is 0.
      const { record, firstMinted } = await verdictStore.resolve(
        { profileId: owner.profileId, duelId: canonicalId, round: 0 },
        async () => {
          const graded = await grading.grade({
            profileId: owner.profileId,
            duelId: canonicalId,
            roundIndex: 0,
            itemId: item.itemId,
            answer: parsed.answer,
          });
          return {
            envelope: graded.envelope,
            receipt: graded.receipt,
            gradingPath: graded.provenance.path,
            gradingLatencyMs: graded.provenance.latencyMs,
            fallbackDiagnosis: graded.provenance.fallbackDiagnosis,
            // An encounter is prose only — no evidence hand — so nothing is placed.
            selectedCardIds: [],
          };
        },
      );

      // Fold the graded stop into the formative retrieval ledger, once, on the
      // first mint. An encounter is asked once per attempt, so it is always a fresh
      // first appearance (never a recycled repeat). Off the grading path: a failure
      // is logged and swallowed so a model outage cannot soft-lock the stop.
      if (firstMinted && retrieval) {
        try {
          await retrieval.record({
            profileId: owner.profileId,
            chapterId: attempt.chapterId,
            missionId: attempt.missionId,
            attemptId: attempt.attemptId,
            conceptId: item.conceptId,
            itemId: item.itemId,
            source: "ENCOUNTER",
            duelId: canonicalId,
            roundIndex: 0,
            correct: record.envelope.kind === "CORRECT",
            graded: record.envelope.source !== "GRADING_TIMEOUT",
            recycled: false,
            appearance: 1,
            seenAt: new Date().toISOString(),
          });
        } catch (cause) {
          request.log.warn(
            { cause, profileId: owner.profileId, encounterId, canonicalId },
            "retrieval ledger: failed to record a graded encounter",
          );
        }
      }

      reply.header("x-pa-verdict-receipt", record.receipt);
      reply.header("x-pa-grading-path", record.gradingPath);
      reply.header(
        "x-pa-grading-latency-ms",
        String(Math.round(record.gradingLatencyMs)),
      );
      if (record.fallbackDiagnosis !== null) {
        reply.header("x-pa-grading-fallback", record.fallbackDiagnosis);
      }
      // The grant status: true when the verdict was the generous infrastructure
      // grant rather than a graded one. `GRADING_TIMEOUT` is @pa/grading's single
      // word for every infrastructure fallback (no credential, timeout, provider
      // error). The client maps this to a GRANTED reprieve so an outage lets the
      // player through the stop rather than trapping them.
      reply.header(
        "x-pa-encounter-granted",
        String(record.envelope.source === "GRADING_TIMEOUT"),
      );
      reply.header("cache-control", "no-store");

      return encounterVerdictBody(record.envelope);
    },
  );
}
