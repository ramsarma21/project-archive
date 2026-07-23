import crypto from "node:crypto";
import type {
  ClassifierObservation,
  DeterministicResolution,
  OpenResponseReference,
} from "@pa/contracts";
import { resolveClassifierResult } from "@pa/runtime";
import type { openResponsePackage } from "@pa/chapter-boston";
import {
  decryptResponseText,
  encryptResponseText,
  responseEncryptionAad,
  type EncryptedResponse,
} from "../grading/envelopeEncryption.js";

type OpenResponsePackage = NonNullable<
  ReturnType<typeof openResponsePackage>
>;

export interface AssessmentActor {
  accountId: string;
  profileId: string;
  roles: readonly ("STUDENT" | "EDUCATOR" | "ADMIN")[];
}

export interface AssessmentResponseRecord {
  response: OpenResponseReference;
  profileId: string;
  promptHash: string;
  requestHash: string;
  idempotencyKey: string;
  encrypted: EncryptedResponse;
  retentionDeadline: string;
  observation: ClassifierObservation;
  resolution: DeterministicResolution;
  gradingStatus: "PENDING" | "CLASSIFIED" | "FALLBACK";
  challengeStatus: "NONE" | "CHALLENGED" | "CORRECTED" | "CLOSED";
  challengeNote?: string;
}

export interface AssessmentAuditRecord {
  responseId: string;
  profileId: string;
  actorAccountId?: string;
  action:
    | "CREATED"
    | "CLASSIFIED"
    | "FALLBACK"
    | "VIEWED"
    | "EXPORTED"
    | "DELETED"
    | "RETENTION_EXPIRED"
    | "CHALLENGED"
    | "CORRECTED";
  at: string;
}

export interface AssessmentResponseRepository {
  claim(record: AssessmentResponseRecord): Promise<{
    created: boolean;
    record: AssessmentResponseRecord;
  }>;
  compareAndSetResolution(
    responseId: string,
    observation: ClassifierObservation,
    resolution: DeterministicResolution,
  ): Promise<AssessmentResponseRecord>;
  get(
    profileId: string,
    responseId: string,
  ): Promise<AssessmentResponseRecord | null>;
  list(profileId: string): Promise<AssessmentResponseRecord[]>;
  delete(profileId: string, responseId: string): Promise<boolean>;
  updateChallenge(
    profileId: string,
    responseId: string,
    status: "CHALLENGED" | "CORRECTED",
    note: string,
  ): Promise<boolean>;
  appendAudit(record: AssessmentAuditRecord): Promise<void>;
  listAudit(profileId: string): Promise<AssessmentAuditRecord[]>;
  educatorCanAccess(
    educatorAccountId: string,
    profileId: string,
  ): Promise<boolean>;
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

export class AssessmentResponseService {
  constructor(
    private readonly repository: AssessmentResponseRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async canEducatorAccess(
    actor: AssessmentActor,
    profileId: string,
  ): Promise<boolean> {
    return (
      (actor.roles.includes("EDUCATOR") ||
        actor.roles.includes("ADMIN")) &&
      (await this.repository.educatorCanAccess(
        actor.accountId,
        profileId,
      ))
    );
  }

  async submit(input: {
    actor: AssessmentActor;
    profileId: string;
    attemptId: string;
    idempotencyKey: string;
    responseText: string;
    retentionDays: number;
    content: OpenResponsePackage;
    classify: (signal: AbortSignal) => Promise<ClassifierObservation>;
    timeoutMs?: number;
  }): Promise<AssessmentResponseRecord> {
    if (input.actor.profileId !== input.profileId) {
      throw new Error("RESPONSE_FORBIDDEN");
    }
    const hash = requestHash({
      profileId: input.profileId,
      attemptId: input.attemptId,
      promptId: input.content.prompt.promptId,
      promptVersion: input.content.prompt.version,
      responseText: input.responseText,
    });
    const aad = responseEncryptionAad({
      profileId: input.profileId,
      attemptId: input.attemptId,
      promptId: input.content.prompt.promptId,
    });
    const fallbackObservation: ClassifierObservation = {
      status: "UNCLASSIFIED",
      reason: "PROVIDER",
    };
    const fallback = resolveClassifierResult(
      input.content.rubric,
      fallbackObservation,
    );
    const submittedAt = this.now();
    const claimed = await this.repository.claim({
      response: {
        responseId: crypto.randomUUID(),
        attemptId: input.attemptId,
        promptId: input.content.prompt.promptId,
        promptVersion: input.content.prompt.version,
        submittedAt: submittedAt.toISOString(),
        storage: "ENCRYPTED_SERVER",
      },
      profileId: input.profileId,
      promptHash: input.content.prompt.hash,
      requestHash: hash,
      idempotencyKey: input.idempotencyKey,
      encrypted: encryptResponseText(input.responseText, aad),
      retentionDeadline: new Date(
        submittedAt.getTime() +
          input.retentionDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
      observation: fallbackObservation,
      resolution: fallback,
      gradingStatus: "PENDING",
      challengeStatus: "NONE",
    });
    if (claimed.record.requestHash !== hash) {
      throw new Error("IDEMPOTENCY_CONFLICT");
    }
    if (!claimed.created) return claimed.record;
    await this.repository.appendAudit({
      responseId: claimed.record.response.responseId,
      profileId: input.profileId,
      actorAccountId: input.actor.accountId,
      action: "CREATED",
      at: submittedAt.toISOString(),
    });

    const controller = new AbortController();
    let rejectTimeout: ((error: Error) => void) | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timeout = setTimeout(
      () => {
        controller.abort();
        const error = new Error("provider grading timed out");
        error.name = "AbortError";
        rejectTimeout?.(error);
      },
      input.timeoutMs ?? 5_500,
    );
    timeout.unref();
    let observation: ClassifierObservation;
    try {
      observation = await Promise.race([
        input.classify(controller.signal),
        timeoutPromise,
      ]);
    } catch (error) {
      observation = {
        status: "UNCLASSIFIED",
        reason:
          error instanceof Error && error.name === "AbortError"
            ? "TIMEOUT"
            : "PROVIDER",
      };
    } finally {
      clearTimeout(timeout);
    }
    const resolution = resolveClassifierResult(
      input.content.rubric,
      observation,
      {
        itemId: input.content.item.itemId,
        itemVersion: input.content.item.itemVersion,
        allowedEvidenceIds: new Set(
          input.content.sourcePackets.flatMap((packet) =>
            packet.evidence.map((entry) => entry.evidenceId),
          ),
        ),
      },
    );
    const updated = await this.repository.compareAndSetResolution(
      claimed.record.response.responseId,
      observation,
      resolution,
    );
    await this.repository.appendAudit({
      responseId: updated.response.responseId,
      profileId: input.profileId,
      actorAccountId: input.actor.accountId,
      action:
        resolution.outcome === "UNCLASSIFIED"
          ? "FALLBACK"
          : "CLASSIFIED",
      at: this.now().toISOString(),
    });
    return updated;
  }

  async review(
    actor: AssessmentActor,
    profileId: string,
    responseId: string,
    action: "VIEWED" | "EXPORTED" = "VIEWED",
  ): Promise<{ record: AssessmentResponseRecord; responseText: string }> {
    if (!(await this.canEducatorAccess(actor, profileId))) {
      throw new Error("RESPONSE_FORBIDDEN");
    }
    const record = await this.repository.get(profileId, responseId);
    if (!record) throw new Error("RESPONSE_NOT_FOUND");
    const responseText = decryptResponseText(
      record.encrypted,
      responseEncryptionAad({
        profileId,
        attemptId: record.response.attemptId,
        promptId: record.response.promptId,
      }),
    );
    await this.repository.appendAudit({
      responseId,
      profileId,
      actorAccountId: actor.accountId,
      action,
      at: this.now().toISOString(),
    });
    return { record, responseText };
  }

  async delete(
    actor: AssessmentActor,
    profileId: string,
    responseId: string,
  ): Promise<void> {
    if (
      actor.profileId !== profileId &&
      !(await this.canEducatorAccess(actor, profileId))
    ) {
      throw new Error("RESPONSE_FORBIDDEN");
    }
    if (!(await this.repository.delete(profileId, responseId))) {
      throw new Error("RESPONSE_NOT_FOUND");
    }
    await this.repository.appendAudit({
      responseId,
      profileId,
      actorAccountId: actor.accountId,
      action: "DELETED",
      at: this.now().toISOString(),
    });
  }

  async expire(): Promise<number> {
    let expired = 0;
    const now = this.now();
    const profileIds = new Set<string>();
    // Repositories expose profile-scoped lists; audit records provide the
    // bounded profile index needed by the in-memory and PostgreSQL adapters.
    for (const audit of await this.repository.listAudit("*")) {
      profileIds.add(audit.profileId);
    }
    for (const profileId of profileIds) {
      for (const record of await this.repository.list(profileId)) {
        if (new Date(record.retentionDeadline) > now) continue;
        if (await this.repository.delete(profileId, record.response.responseId)) {
          expired += 1;
          await this.repository.appendAudit({
            responseId: record.response.responseId,
            profileId,
            action: "RETENTION_EXPIRED",
            at: now.toISOString(),
          });
        }
      }
    }
    return expired;
  }

  async challenge(
    actor: AssessmentActor,
    profileId: string,
    responseId: string,
    note: string,
  ): Promise<void> {
    if (actor.profileId !== profileId) throw new Error("RESPONSE_FORBIDDEN");
    if (
      !(await this.repository.updateChallenge(
        profileId,
        responseId,
        "CHALLENGED",
        note,
      ))
    ) {
      throw new Error("RESPONSE_NOT_FOUND");
    }
    await this.repository.appendAudit({
      responseId,
      profileId,
      actorAccountId: actor.accountId,
      action: "CHALLENGED",
      at: this.now().toISOString(),
    });
  }

  async correct(
    actor: AssessmentActor,
    profileId: string,
    responseId: string,
    note: string,
  ): Promise<void> {
    if (!(await this.canEducatorAccess(actor, profileId))) {
      throw new Error("RESPONSE_FORBIDDEN");
    }
    if (
      !(await this.repository.updateChallenge(
        profileId,
        responseId,
        "CORRECTED",
        note,
      ))
    ) {
      throw new Error("RESPONSE_NOT_FOUND");
    }
    await this.repository.appendAudit({
      responseId,
      profileId,
      actorAccountId: actor.accountId,
      action: "CORRECTED",
      at: this.now().toISOString(),
    });
  }
}

