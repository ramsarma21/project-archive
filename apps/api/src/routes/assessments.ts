import crypto from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import {
  SubmitOpenResponseRequestSchema,
  type ClassifierObservation,
  type DeterministicResolution,
  type OpenResponseReference,
} from "@pa/contracts";
import { resolveClassifierResult } from "@pa/runtime";
import {
  ACT1_CLASSIFIER_SCHEMA_ID,
  ACT1_CLASSIFIER_SCHEMA_VERSION,
  ACT1_OPEN_RESPONSE_PACKAGE_HASH,
  ACT1_OPEN_RESPONSE_PACKAGE_ID,
  ACT1_OPEN_RESPONSE_PACKAGE_VERSION,
  openResponsePackage,
} from "@pa/chapter-boston";
import { getSessionUser, type SessionUser } from "../auth.js";
import { query, transaction } from "../db.js";
import {
  decryptResponseText,
  encryptResponseText,
  responseEncryptionAad,
  type EncryptedResponse,
} from "../grading/envelopeEncryption.js";
import { gradeFormativeResponse } from "../grading/service.js";
import {
  SubmissionRateLimiter,
  validAssessmentMutationRequest,
} from "../assessment/requestPolicy.js";

const SESSION_COOKIE = "pa_session";
const STABLE_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const submissionRateLimiter = new SubmissionRateLimiter();

interface ResponseRow {
  id: string;
  profile_id: string;
  attempt_id: string;
  prompt_id: string;
  prompt_version: string;
  ciphertext: Buffer;
  ciphertext_iv: Buffer;
  ciphertext_tag: Buffer;
  wrapped_key: Buffer;
  wrapped_key_iv: Buffer;
  wrapped_key_tag: Buffer;
  key_version: string;
  request_hash: string;
  classifier_observation: ClassifierObservation;
  deterministic_resolution: DeterministicResolution;
  grading_status: "PENDING" | "CLASSIFIED" | "FALLBACK";
  challenge_status: string;
  retention_deadline: string;
  created_at: string;
  graded_at: string | null;
}

function responseReference(row: ResponseRow): OpenResponseReference {
  return {
    responseId: row.id,
    attemptId: row.attempt_id,
    promptId: row.prompt_id,
    promptVersion: row.prompt_version,
    submittedAt: row.created_at,
    storage: "ENCRYPTED_SERVER",
  };
}

async function sessionUser(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SessionUser | null> {
  const user = await getSessionUser(request.cookies[SESSION_COOKIE]);
  if (!user) {
    await reply.code(401).send({ error: "AUTH_REQUIRED" });
    return null;
  }
  return user;
}

function requireCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
  const token = request.headers["x-pa-csrf-token"];
  if (
    !validAssessmentMutationRequest({
      sessionId: request.cookies[SESSION_COOKIE],
      csrfToken: typeof token === "string" ? token : undefined,
      origin: request.headers.origin,
      allowedOrigin:
        process.env.WEB_ORIGIN ?? "http://localhost:5173",
    })
  ) {
    void reply.code(403).send({ error: "CSRF_INVALID" });
    return false;
  }
  return true;
}

async function isEducatorFor(
  user: SessionUser,
  profileId: string,
): Promise<boolean> {
  const rows = await query(
    `select 1
       from account_roles roles
       join educator_profile_access access
         on access.educator_account_id=roles.account_id
      where roles.account_id=$1
        and roles.role in ('EDUCATOR','ADMIN')
        and access.profile_id=$2`,
    [user.accountId, profileId],
  );
  return Boolean(rows.rowCount);
}

async function requireProfileAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  profileId: string,
  educatorOnly = false,
): Promise<SessionUser | null> {
  const user = await sessionUser(request, reply);
  if (!user) return null;
  if (!educatorOnly && user.profileId === profileId) return user;
  if (await isEducatorFor(user, profileId)) return user;
  await reply.code(403).send({ error: "RESPONSE_FORBIDDEN" });
  return null;
}

async function audit(input: {
  responseId?: string;
  profileId: string;
  actorAccountId?: string;
  action: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `insert into open_response_audit(
       response_id, profile_id, actor_account_id, action, metadata
     ) values ($1,$2,$3,$4,$5::jsonb)`,
    [
      input.responseId ?? null,
      input.profileId,
      input.actorAccountId ?? null,
      input.action,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function expireRetainedResponses(): Promise<number> {
  return transaction(async (client) => {
    const expired = await client.query<{ id: string; profile_id: string }>(
      `select id, profile_id
         from open_responses
        where deleted_at is null and retention_deadline <= now()
        for update`,
    );
    for (const row of expired.rows) {
      await client.query(
        `insert into open_response_audit(
           response_id, profile_id, action, metadata
         ) values ($1,$2,'RETENTION_EXPIRED','{}'::jsonb)`,
        [row.id, row.profile_id],
      );
      await client.query("delete from open_responses where id=$1", [row.id]);
    }
    return expired.rowCount ?? 0;
  });
}

function encryptedFromRow(row: ResponseRow): EncryptedResponse {
  return {
    ciphertext: row.ciphertext,
    ciphertextIv: row.ciphertext_iv,
    ciphertextTag: row.ciphertext_tag,
    wrappedKey: row.wrapped_key,
    wrappedKeyIv: row.wrapped_key_iv,
    wrappedKeyTag: row.wrapped_key_tag,
    keyVersion: row.key_version,
  };
}

function requestHash(input: {
  profileId: string;
  attemptId: string;
  promptId: string;
  promptVersion: string;
  responseText: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        input.profileId,
        input.attemptId,
        input.promptId,
        input.promptVersion,
        crypto.createHash("sha256").update(input.responseText).digest("hex"),
      ].join("\u0000"),
    )
    .digest("hex");
}

export async function registerAssessmentRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post<{
    Params: { profileId: string; attemptId: string };
  }>(
    "/v1/profiles/:profileId/assessments/:attemptId/responses",
    { bodyLimit: 12 * 1024 },
    async (request, reply) => {
      const { profileId, attemptId } = request.params;
      if (!STABLE_ID.test(attemptId)) {
        return reply.code(400).send({ error: "BAD_REQUEST" });
      }
      const user = await requireProfileAccess(request, reply, profileId);
      if (!user) return reply;
      if (user.profileId !== profileId) {
        return reply.code(403).send({ error: "RESPONSE_FORBIDDEN" });
      }
      if (!requireCsrf(request, reply)) return reply;
      if (!submissionRateLimiter.allow(profileId)) {
        return reply.code(429).send({ error: "RATE_LIMITED" });
      }
      const parsed = SubmitOpenResponseRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "CONSENT_REQUIRED" });
      }
      const body = parsed.data;
      const content = openResponsePackage(body.promptId, {
        allowAuthorDraft:
          process.env.NODE_ENV !== "production" &&
          process.env.OPEN_RESPONSE_CONTENT_MODE === "AUTHOR_DRAFT_QA",
      });
      if (
        !content ||
        body.promptVersion !== content.prompt.version ||
        body.responseText.length < content.prompt.responseChars.min ||
        body.responseText.length > content.prompt.responseChars.max
      ) {
        return reply.code(400).send({ error: "BAD_REQUEST" });
      }

      const hash = requestHash({
        profileId,
        attemptId,
        promptId: body.promptId,
        promptVersion: body.promptVersion,
        responseText: body.responseText,
      });
      const aad = responseEncryptionAad({
        profileId,
        attemptId,
        promptId: body.promptId,
      });
      let encrypted: EncryptedResponse;
      try {
        encrypted = encryptResponseText(body.responseText, aad);
      } catch {
        return reply.code(503).send({ error: "GRADING_UNAVAILABLE" });
      }
      const initialObservation: ClassifierObservation = {
        status: "UNCLASSIFIED",
        reason: "PROVIDER",
      };
      const initialResolution = resolveClassifierResult(
        content.rubric,
        initialObservation,
      );
      const retentionDeadline = new Date(
        Date.now() + body.consent.retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString();

      const inserted = await transaction(async (client) => {
        await client.query(
          `insert into assessment_attempts(id, profile_id, chapter_id)
           values ($1,$2,'BOS.D1')
           on conflict (id) do nothing`,
          [attemptId, profileId],
        );
        const attempt = await client.query(
          "select 1 from assessment_attempts where id=$1 and profile_id=$2",
          [attemptId, profileId],
        );
        if (!attempt.rowCount) return { kind: "forbidden" as const };
        const created = await client.query<ResponseRow>(
          `insert into open_responses(
             profile_id, attempt_id, prompt_id, prompt_version, prompt_hash,
             rubric_id, rubric_version, rubric_hash,
             source_packet_id, source_packet_version, source_packet_hash,
             content_package_id, content_package_version, content_package_hash,
             classifier_schema_id, classifier_schema_version,
             ciphertext, ciphertext_iv, ciphertext_tag,
             wrapped_key, wrapped_key_iv, wrapped_key_tag, key_version,
             consent_snapshot, policy_snapshot, retention_deadline,
             request_hash, idempotency_key,
             classifier_observation, deterministic_resolution, grading_status
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             $12,$13,$14,$15,$16,
             $17,$18,$19,$20,$21,$22,$23,
             $24::jsonb,$25::jsonb,$26,$27,$28,$29::jsonb,$30::jsonb,'PENDING'
           )
           on conflict (profile_id, attempt_id, idempotency_key) do nothing
           returning *`,
          [
            profileId,
            attemptId,
            content.prompt.promptId,
            content.prompt.version,
            content.prompt.hash,
            content.rubric.rubricId,
            content.rubric.version,
            content.rubric.hash,
            content.prompt.sourcePacket.sourcePacketId,
            content.prompt.sourcePacket.version,
            content.prompt.sourcePacket.hash,
            ACT1_OPEN_RESPONSE_PACKAGE_ID,
            ACT1_OPEN_RESPONSE_PACKAGE_VERSION,
            ACT1_OPEN_RESPONSE_PACKAGE_HASH,
            ACT1_CLASSIFIER_SCHEMA_ID,
            ACT1_CLASSIFIER_SCHEMA_VERSION,
            encrypted.ciphertext,
            encrypted.ciphertextIv,
            encrypted.ciphertextTag,
            encrypted.wrappedKey,
            encrypted.wrappedKeyIv,
            encrypted.wrappedKeyTag,
            encrypted.keyVersion,
            JSON.stringify(body.consent),
            JSON.stringify({
              version: body.consent.policyVersion,
              purpose: "FORMATIVE",
              providerMayClassify: true,
            }),
            retentionDeadline,
            hash,
            body.idempotencyKey,
            JSON.stringify(initialObservation),
            JSON.stringify(initialResolution),
          ],
        );
        if (created.rows[0]) {
          await client.query(
            `insert into open_response_audit(
               response_id, profile_id, actor_account_id, action, metadata
             ) values ($1,$2,$3,'CREATED',$4::jsonb)`,
            [
              created.rows[0].id,
              profileId,
              user.accountId,
              JSON.stringify({
                promptId: content.prompt.promptId,
                policyVersion: body.consent.policyVersion,
              }),
            ],
          );
          return { kind: "created" as const, row: created.rows[0] };
        }
        const existing = await client.query<ResponseRow>(
          `select * from open_responses
            where profile_id=$1 and attempt_id=$2 and idempotency_key=$3`,
          [profileId, attemptId, body.idempotencyKey],
        );
        return { kind: "existing" as const, row: existing.rows[0]! };
      });
      if (inserted.kind === "forbidden") {
        return reply.code(403).send({ error: "RESPONSE_FORBIDDEN" });
      }
      if (inserted.row.request_hash !== hash) {
        return reply.code(409).send({ error: "BAD_REQUEST" });
      }
      if (inserted.kind === "existing") {
        return {
          response: responseReference(inserted.row),
          observation: inserted.row.classifier_observation,
          resolution: inserted.row.deterministic_resolution,
        };
      }

      const graded = await gradeFormativeResponse(profileId, {
        responseText: body.responseText,
        prompt: content.prompt,
        rubric: content.rubric,
        sourceTexts: content.sourceTexts,
        itemId: content.item.itemId,
        itemVersion: content.item.itemVersion,
        allowedEvidenceIds: content.sourcePackets.flatMap((packet) =>
          packet.evidence.map((entry) => entry.evidenceId),
        ),
        requestHash: hash,
      });
      const resolution = resolveClassifierResult(
        content.rubric,
        graded.observation,
        {
          itemId: content.item.itemId,
          itemVersion: content.item.itemVersion,
          allowedEvidenceIds: new Set(
            content.sourcePackets.flatMap((packet) =>
              packet.evidence.map((entry) => entry.evidenceId),
            ),
          ),
        },
      );
      const gradingStatus =
        resolution.status === "FORMATIVE_CLASSIFIED"
          ? "CLASSIFIED"
          : "FALLBACK";
      const updated = await query<ResponseRow>(
        `update open_responses
            set classifier_observation=$1::jsonb,
                deterministic_resolution=$2::jsonb,
                grading_status=$3,
                graded_at=now(),
                updated_at=now()
          where id=$4 and grading_status='PENDING'
          returning *`,
        [
          JSON.stringify(graded.observation),
          JSON.stringify(resolution),
          gradingStatus,
          inserted.row.id,
        ],
      );
      const row = updated.rows[0] ?? inserted.row;
      await audit({
        responseId: row.id,
        profileId,
        actorAccountId: user.accountId,
        action: gradingStatus,
        metadata: {
          promptId: content.prompt.promptId,
          providerCalled: graded.providerCalled,
        },
      });
      return {
        response: responseReference(row),
        observation: graded.observation,
        resolution,
      };
    },
  );

  app.get<{ Params: { profileId: string } }>(
    "/v1/profiles/:profileId/formative-evidence",
    async (request, reply) => {
      const user = await requireProfileAccess(
        request,
        reply,
        request.params.profileId,
      );
      if (!user) return reply;
      await expireRetainedResponses();
      const rows = await query<ResponseRow>(
        `select * from open_responses
          where profile_id=$1 and deleted_at is null
          order by created_at`,
        [request.params.profileId],
      );
      return {
        purpose: "FORMATIVE",
        officialAssessment: false,
        evidence: rows.rows.map((row) => ({
          response: responseReference(row),
          resolution: row.deterministic_resolution,
          challengeStatus: row.challenge_status,
        })),
      };
    },
  );

  app.get<{
    Params: { profileId: string; responseId: string };
  }>(
    "/v1/educator/profiles/:profileId/responses/:responseId",
    async (request, reply) => {
      const user = await requireProfileAccess(
        request,
        reply,
        request.params.profileId,
        true,
      );
      if (!user) return reply;
      await expireRetainedResponses();
      const rows = await query<ResponseRow>(
        `select * from open_responses
          where id=$1 and profile_id=$2 and deleted_at is null`,
        [request.params.responseId, request.params.profileId],
      );
      const row = rows.rows[0];
      if (!row) return reply.code(404).send({ error: "RESPONSE_NOT_FOUND" });
      let responseText: string;
      try {
        responseText = decryptResponseText(
          encryptedFromRow(row),
          responseEncryptionAad({
            profileId: row.profile_id,
            attemptId: row.attempt_id,
            promptId: row.prompt_id,
          }),
        );
      } catch {
        return reply.code(503).send({ error: "GRADING_UNAVAILABLE" });
      }
      await audit({
        responseId: row.id,
        profileId: row.profile_id,
        actorAccountId: user.accountId,
        action: "VIEWED",
      });
      return {
        response: responseReference(row),
        responseText,
        purpose: "FORMATIVE",
        officialAssessment: false,
        observation: row.classifier_observation,
        resolution: row.deterministic_resolution,
        challengeStatus: row.challenge_status,
      };
    },
  );

  app.get<{
    Params: { profileId: string; responseId: string };
  }>(
    "/v1/educator/profiles/:profileId/responses/:responseId/export",
    async (request, reply) => {
      const user = await requireProfileAccess(
        request,
        reply,
        request.params.profileId,
        true,
      );
      if (!user) return reply;
      const rows = await query<ResponseRow>(
        "select * from open_responses where id=$1 and profile_id=$2",
        [request.params.responseId, request.params.profileId],
      );
      const row = rows.rows[0];
      if (!row) return reply.code(404).send({ error: "RESPONSE_NOT_FOUND" });
      const responseText = decryptResponseText(
        encryptedFromRow(row),
        responseEncryptionAad({
          profileId: row.profile_id,
          attemptId: row.attempt_id,
          promptId: row.prompt_id,
        }),
      );
      await audit({
        responseId: row.id,
        profileId: row.profile_id,
        actorAccountId: user.accountId,
        action: "EXPORTED",
      });
      reply.header(
        "content-disposition",
        `attachment; filename="formative-response-${row.id}.json"`,
      );
      return {
        response: responseReference(row),
        responseText,
        purpose: "FORMATIVE",
        officialAssessment: false,
        resolution: row.deterministic_resolution,
      };
    },
  );

  app.delete<{
    Params: { profileId: string; responseId: string };
  }>(
    "/v1/profiles/:profileId/responses/:responseId",
    async (request, reply) => {
      const user = await requireProfileAccess(
        request,
        reply,
        request.params.profileId,
      );
      if (!user) return reply;
      if (!requireCsrf(request, reply)) return reply;
      const deleted = await transaction(async (client) => {
        const rows = await client.query<{ id: string }>(
          "select id from open_responses where id=$1 and profile_id=$2 for update",
          [request.params.responseId, request.params.profileId],
        );
        if (!rows.rowCount) return false;
        await client.query(
          `insert into open_response_audit(
             response_id, profile_id, actor_account_id, action, metadata
           ) values ($1,$2,$3,'DELETED','{}'::jsonb)`,
          [
            request.params.responseId,
            request.params.profileId,
            user.accountId,
          ],
        );
        await client.query("delete from open_responses where id=$1", [
          request.params.responseId,
        ]);
        return true;
      });
      return deleted
        ? { ok: true }
        : reply.code(404).send({ error: "RESPONSE_NOT_FOUND" });
    },
  );

  app.post<{
    Params: { profileId: string; responseId: string };
  }>(
    "/v1/profiles/:profileId/responses/:responseId/challenge",
    { bodyLimit: 2048 },
    async (request, reply) => {
      const user = await requireProfileAccess(
        request,
        reply,
        request.params.profileId,
      );
      if (!user) return reply;
      if (user.profileId !== request.params.profileId) {
        return reply.code(403).send({ error: "RESPONSE_FORBIDDEN" });
      }
      if (!requireCsrf(request, reply)) return reply;
      const note =
        typeof (request.body as { note?: unknown } | null)?.note === "string"
          ? (request.body as { note: string }).note.trim().slice(0, 1000)
          : "";
      const updated = await query(
        `update open_responses
            set challenge_status='CHALLENGED',
                challenge_note=$1,
                updated_at=now()
          where id=$2 and profile_id=$3`,
        [note || null, request.params.responseId, request.params.profileId],
      );
      if (!updated.rowCount) {
        return reply.code(404).send({ error: "RESPONSE_NOT_FOUND" });
      }
      await audit({
        responseId: request.params.responseId,
        profileId: request.params.profileId,
        actorAccountId: user.accountId,
        action: "CHALLENGED",
      });
      return { ok: true, challengeStatus: "CHALLENGED" };
    },
  );

  app.get<{ Params: { profileId: string } }>(
    "/v1/educator/profiles/:profileId/response-audit",
    async (request, reply) => {
      const user = await requireProfileAccess(
        request,
        reply,
        request.params.profileId,
        true,
      );
      if (!user) return reply;
      const rows = await query(
        `select response_id, action, metadata, created_at
           from open_response_audit
          where profile_id=$1
          order by created_at desc
          limit 500`,
        [request.params.profileId],
      );
      return { audit: rows.rows };
    },
  );

  app.post<{
    Params: { profileId: string; responseId: string };
  }>(
    "/v1/educator/profiles/:profileId/responses/:responseId/correction",
    { bodyLimit: 2048 },
    async (request, reply) => {
      const user = await requireProfileAccess(
        request,
        reply,
        request.params.profileId,
        true,
      );
      if (!user) return reply;
      if (!requireCsrf(request, reply)) return reply;
      const note =
        typeof (request.body as { note?: unknown } | null)?.note === "string"
          ? (request.body as { note: string }).note.trim().slice(0, 1000)
          : "";
      if (!note) return reply.code(400).send({ error: "BAD_REQUEST" });
      const updated = await query(
        `update open_responses
            set challenge_status='CORRECTED',
                challenge_note=$1,
                updated_at=now()
          where id=$2 and profile_id=$3`,
        [note, request.params.responseId, request.params.profileId],
      );
      if (!updated.rowCount) {
        return reply.code(404).send({ error: "RESPONSE_NOT_FOUND" });
      }
      await audit({
        responseId: request.params.responseId,
        profileId: request.params.profileId,
        actorAccountId: user.accountId,
        action: "CORRECTED",
      });
      return { ok: true, challengeStatus: "CORRECTED" };
    },
  );
}

