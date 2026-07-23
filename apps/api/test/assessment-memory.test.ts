import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { csrfTokenForSession } from "../src/auth.js";
import {
  SubmissionRateLimiter,
  validAssessmentMutationRequest,
} from "../src/assessment/requestPolicy.js";
import {
  AssessmentResponseService,
  type AssessmentActor,
  type AssessmentAuditRecord,
  type AssessmentResponseRecord,
  type AssessmentResponseRepository,
} from "../src/assessment/responseService.js";
import { openResponsePackage } from "@pa/chapter-boston";
import { SubmitOpenResponseRequestSchema } from "@pa/contracts";

process.env.GRADING_ENCRYPTION_KEY_BASE64 = crypto
  .randomBytes(32)
  .toString("base64");
process.env.GRADING_ENCRYPTION_KEY_VERSION = "memory-test-v1";
process.env.CSRF_SECRET = "memory-test-csrf";

class MemoryRepository implements AssessmentResponseRepository {
  records = new Map<string, AssessmentResponseRecord>();
  idempotency = new Map<string, string>();
  audits: AssessmentAuditRecord[] = [];
  grants = new Set<string>();

  async claim(record: AssessmentResponseRecord) {
    const key = `${record.profileId}:${record.response.attemptId}:${record.idempotencyKey}`;
    const existingId = this.idempotency.get(key);
    if (existingId) {
      return { created: false, record: this.records.get(existingId)! };
    }
    this.idempotency.set(key, record.response.responseId);
    this.records.set(record.response.responseId, structuredClone(record));
    return { created: true, record: this.records.get(record.response.responseId)! };
  }

  async compareAndSetResolution(
    responseId: string,
    observation: AssessmentResponseRecord["observation"],
    resolution: AssessmentResponseRecord["resolution"],
  ) {
    const record = this.records.get(responseId)!;
    if (record.gradingStatus === "PENDING") {
      record.observation = structuredClone(observation);
      record.resolution = structuredClone(resolution);
      record.gradingStatus =
        resolution.outcome === "UNCLASSIFIED" ? "FALLBACK" : "CLASSIFIED";
    }
    return structuredClone(record);
  }

  async get(profileId: string, responseId: string) {
    const record = this.records.get(responseId);
    return record?.profileId === profileId ? structuredClone(record) : null;
  }

  async list(profileId: string) {
    return [...this.records.values()]
      .filter((record) => record.profileId === profileId)
      .map((record) => structuredClone(record));
  }

  async delete(profileId: string, responseId: string) {
    const record = this.records.get(responseId);
    if (!record || record.profileId !== profileId) return false;
    this.records.delete(responseId);
    return true;
  }

  async updateChallenge(
    profileId: string,
    responseId: string,
    status: "CHALLENGED" | "CORRECTED",
    note: string,
  ) {
    const record = this.records.get(responseId);
    if (!record || record.profileId !== profileId) return false;
    record.challengeStatus = status;
    record.challengeNote = note;
    return true;
  }

  async appendAudit(record: AssessmentAuditRecord) {
    this.audits.push(structuredClone(record));
  }

  async listAudit(profileId: string) {
    return this.audits.filter(
      (record) => profileId === "*" || record.profileId === profileId,
    );
  }

  async educatorCanAccess(accountId: string, profileId: string) {
    return this.grants.has(`${accountId}:${profileId}`);
  }
}

const student: AssessmentActor = {
  accountId: "account-student",
  profileId: "profile-student",
  roles: ["STUDENT"],
};
const otherStudent: AssessmentActor = {
  accountId: "account-other",
  profileId: "profile-other",
  roles: ["STUDENT"],
};
const educator: AssessmentActor = {
  accountId: "account-educator",
  profileId: "profile-educator",
  roles: ["EDUCATOR"],
};
const content = openResponsePackage(
  "BOS.ACT01.PROMPT.REVENUE_VS_MARKET",
)!;

function classifiedObservation() {
  return {
    schemaVersion: "0.1.0-draft",
    itemId: content.item.itemId,
    itemVersion: content.item.itemVersion,
    topicality: "ON_TOPIC" as const,
    criteria: content.rubric.criteria.map((criterion) => ({
      criterionId: criterion.criterionId,
      level: "STRONG" as const,
    })),
    citedEvidenceIds: [
      "BOS.ACT01.SRC.REVENUE_PROCLAMATION.v1.EV.1",
      "BOS.ACT01.SRC.SARAH_MARKET.v1.EV.1",
    ],
    technical: { confidence: "HIGH" as const },
  };
}

test("memory repository covers encryption, idempotency, RBAC, audit, challenge, correction, export and deletion", async () => {
  const repository = new MemoryRepository();
  repository.grants.add(`${educator.accountId}:${student.profileId}`);
  const service = new AssessmentResponseService(repository);
  let providerCalls = 0;
  const submit = () =>
    service.submit({
      actor: student,
      profileId: student.profileId,
      attemptId: "attempt-1",
      idempotencyKey: "idem-1",
      responseText:
        "The proclamation gives the Crown's reason, while Sarah shows a thinner market and lost trade in Boston.",
      retentionDays: 30,
      content,
      classify: async () => {
        providerCalls += 1;
        return classifiedObservation();
      },
    });
  const first = await submit();
  const second = await submit();
  assert.equal(first.response.responseId, second.response.responseId);
  assert.equal(providerCalls, 1);
  assert.equal(first.resolution.outcome, "STRONG_RESPONSE");
  assert.equal(
    first.encrypted.ciphertext.includes(
      Buffer.from("proclamation gives"),
    ),
    false,
  );
  await assert.rejects(
    () =>
      service.review(
        otherStudent,
        student.profileId,
        first.response.responseId,
      ),
    /RESPONSE_FORBIDDEN/,
  );
  const reviewed = await service.review(
    educator,
    student.profileId,
    first.response.responseId,
    "EXPORTED",
  );
  assert.match(reviewed.responseText, /Sarah/);
  await service.challenge(
    student,
    student.profileId,
    first.response.responseId,
    "Please review the evidence mapping.",
  );
  await service.correct(
    educator,
    student.profileId,
    first.response.responseId,
    "Educator correction recorded.",
  );
  assert.deepEqual(
    repository.audits.map((entry) => entry.action),
    [
      "CREATED",
      "CLASSIFIED",
      "EXPORTED",
      "CHALLENGED",
      "CORRECTED",
    ],
  );
  await service.delete(
    student,
    student.profileId,
    first.response.responseId,
  );
  assert.equal(repository.records.size, 0);
  assert.equal(repository.audits.at(-1)?.action, "DELETED");
});

test("timeout commits fallback once and ignores a late provider result", async () => {
  const repository = new MemoryRepository();
  const service = new AssessmentResponseService(repository);
  let resolveLate!: (value: ReturnType<typeof classifiedObservation>) => void;
  const late = new Promise<ReturnType<typeof classifiedObservation>>(
    (resolve) => {
      resolveLate = resolve;
    },
  );
  const record = await service.submit({
    actor: student,
    profileId: student.profileId,
    attemptId: "attempt-timeout",
    idempotencyKey: "idem-timeout",
    responseText:
      "This response is retained, but provider timing must never revise gameplay after fallback.",
    retentionDays: 1,
    content,
    classify: async () => late,
    timeoutMs: 10,
  });
  assert.equal(record.resolution.outcome, "UNCLASSIFIED");
  resolveLate(classifiedObservation());
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(
    repository.records.get(record.response.responseId)?.resolution.outcome,
    "UNCLASSIFIED",
  );
});

test("retention expiry deletes ciphertext and audits TTL", async () => {
  const repository = new MemoryRepository();
  let now = new Date("2026-07-22T20:00:00.000Z");
  const service = new AssessmentResponseService(repository, () => now);
  await service.submit({
    actor: student,
    profileId: student.profileId,
    attemptId: "attempt-ttl",
    idempotencyKey: "idem-ttl",
    responseText:
      "A retained response used only to verify deterministic expiry and deletion.",
    retentionDays: 1,
    content,
    classify: async () => ({
      status: "UNCLASSIFIED",
      reason: "DISABLED",
    }),
  });
  now = new Date("2026-07-24T20:00:00.000Z");
  assert.equal(await service.expire(), 1);
  assert.equal(repository.records.size, 0);
  assert.equal(repository.audits.at(-1)?.action, "RETENTION_EXPIRED");
});

test("CSRF, origin, and rate policy fail closed in memory", () => {
  const sessionId = "session-memory";
  const csrfToken = csrfTokenForSession(sessionId);
  assert.equal(
    validAssessmentMutationRequest({
      sessionId,
      csrfToken,
      origin: "http://localhost:5173",
      allowedOrigin: "http://localhost:5173",
    }),
    true,
  );
  assert.equal(
    validAssessmentMutationRequest({
      sessionId,
      csrfToken,
      origin: "https://attacker.invalid",
      allowedOrigin: "http://localhost:5173",
    }),
    false,
  );
  const limiter = new SubmissionRateLimiter(2, 60_000);
  assert.equal(limiter.allow(student.profileId, 0), true);
  assert.equal(limiter.allow(student.profileId, 1), true);
  assert.equal(limiter.allow(student.profileId, 2), false);
  assert.equal(limiter.allow(student.profileId, 60_001), true);
  assert.equal(
    SubmitOpenResponseRequestSchema.safeParse({
      promptId: content.prompt.promptId,
      promptVersion: content.prompt.version,
      responseText: "x".repeat(4_001),
      idempotencyKey: "body-limit",
      consent: {
        granted: true,
        policyVersion: "PA.FORMATIVE.PRIVACY.v1",
        retainedForEducatorReview: true,
        retentionDays: 30,
      },
    }).success,
    false,
  );
});

