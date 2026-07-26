// The classification call.
//
// The gateway, the credential and the request shape are not invented here. The
// repo already talks to models in exactly one way — an OpenAI-compatible
// TrueFoundry gateway at TRUEFOUNDRY_BASE_URL with a bearer token, which is how
// the image pipeline in assets/pipeline/gen_concept_image.mjs authenticates and
// how apps/api/src/grading/openAiCompatible.ts classifies — and this follows it.
// There is no OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY anywhere in the
// repo or in .env, and no provider SDK in the lockfile; adding one would be a new
// integration to operate rather than a pattern to follow.
//
// Env names match the ones .env.example already documents for grading
// (TRUEFOUNDRY_GRADING_API_KEY / _BASE_URL / _MODEL / _STRUCTURED_OUTPUT), so this
// package runs on the configuration the deployment already knows about, including
// the ECS secret wiring in infra/. The generic TRUEFOUNDRY_API_KEY is accepted as
// a fallback outside production only, which is the existing rule and the reason
// this works on a laptop today without new secrets.

import { GRADING_TIMEOUT_MS } from "./tuning.js";
import type { ClassifierRequest } from "./prompt.js";

export interface ProviderResult {
  readonly raw: unknown;
  readonly model: string;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
}

export interface ClassifierProvider {
  /**
   * Classify one answer. Must respect `signal` — the 1.5-second cap is enforced
   * by the caller aborting, and a provider that ignores the signal leaves a
   * request in flight after the fallback has already been granted.
   */
  classify(
    request: ClassifierRequest,
    signal: AbortSignal,
    idempotencyKey: string,
  ): Promise<ProviderResult>;
}

/**
 * The gateway answered and refused. Carries the status because 401, 403, 404 and
 * 429 are four different jobs for whoever is holding the pager: a bad credential,
 * a credential without access to this model, a model name that does not exist,
 * and a quota. Throwing all four as one anonymous `Error` — which is what this
 * did — is how a wrong model string spent an afternoon looking like a timeout.
 */
export class ProviderRejectedError extends Error {
  constructor(readonly status: number) {
    super(`provider rejected request (${status})`);
    this.name = "ProviderRejectedError";
  }
}

/** A 429 or a 5xx. Worth one retry if the budget allows; nothing else is. */
export class RetryableProviderError extends ProviderRejectedError {
  constructor(status: number) {
    super(status);
    this.name = "RetryableProviderError";
    this.message = `retryable provider status ${status}`;
  }
}

/**
 * No HTTP response at all — DNS, connect, TLS, a socket that hung up. Distinct
 * from a rejection because it is a DIFFERENT PROBLEM WITH A DIFFERENT OWNER: a
 * rejection means the credential or the model is wrong, this means the gateway
 * cannot be reached from where the server is running. It is also the one that
 * fails in single-digit milliseconds, so it is the one that most looks like a
 * timeout and is least like one.
 */
export class ProviderUnreachableError extends Error {
  constructor(cause: unknown) {
    super(
      `provider unreachable: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
    this.name = "ProviderUnreachableError";
  }
}

export class ProviderNotConfiguredError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ProviderNotConfiguredError";
  }
}

/** True for the deadline's own abort and for a caller cancelling. */
export function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Chosen by measurement, not by price list. The repo's earlier benchmark picked
 * `aws-bedrock/us.amazon.nova-micro-v1-0` for the deleted formative grader, and on
 * this eval set it fails the gate badly: 87.1% accuracy with a 15.0% false-negative
 * rate, marking correct answers wrong twenty-two times — including a student who
 * wrote "we do, over here" and one whose only error was a wrong year on a date the
 * item does not ask for. That is the toxic direction, so it is not shippable however
 * cheap it is.
 *
 * Flash Lite passes at 98.7% with 0.7% false negatives, and it is also the fastest
 * and the cheapest of the five candidates measured: 622ms median serially against
 * Nova Micro's 757ms, and 885 prompt tokens against 1380. Claude Haiku 4.5 and
 * Ministral 3 8B were rejected on tail latency — 8.1s and 4.2s worst of six samples
 * against a 1.5-second cap.
 *
 * Overridable, because the eval harness is what should decide this and it can be
 * re-run against any model on the gateway with `grading:eval --model`.
 */
export const DEFAULT_GRADING_MODEL = "gemini-group/gemini-3.5-flash-lite";

function baseUrl(): string {
  const base = (
    process.env.TRUEFOUNDRY_GRADING_BASE_URL ?? process.env.TRUEFOUNDRY_BASE_URL
  )?.trim();
  if (!base) {
    throw new ProviderNotConfiguredError(
      "TRUEFOUNDRY_GRADING_BASE_URL or TRUEFOUNDRY_BASE_URL is required",
    );
  }
  return base.replace(/\/+$/, "");
}

function credential(): string {
  const dedicated = process.env.TRUEFOUNDRY_GRADING_API_KEY?.trim();
  if (dedicated) return dedicated;
  // The generic key is a development convenience only. In production a grading
  // credential is its own secret so it can be rotated and budgeted separately.
  if (process.env.NODE_ENV !== "production") {
    const shared = process.env.TRUEFOUNDRY_API_KEY?.trim();
    if (shared) return shared;
  }
  throw new ProviderNotConfiguredError(
    "TRUEFOUNDRY_GRADING_API_KEY is required to grade",
  );
}

export function gradingModel(): string {
  return process.env.TRUEFOUNDRY_GRADING_MODEL?.trim() || DEFAULT_GRADING_MODEL;
}

/** True when a model call is possible at all. Read once at construction. */
export function providerConfigured(): boolean {
  try {
    baseUrl();
    credential();
    return true;
  } catch {
    return false;
  }
}

export class TrueFoundryClassifierProvider implements ClassifierProvider {
  constructor(private readonly model: string = gradingModel()) {}

  async classify(
    request: ClassifierRequest,
    signal: AbortSignal,
    idempotencyKey: string,
  ): Promise<ProviderResult> {
    const useNativeSchema =
      process.env.TRUEFOUNDRY_GRADING_STRUCTURED_OUTPUT !== "false";
    const init: RequestInit = {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${credential()}`,
        "content-type": "application/json",
        // The same answer to the same item is the same request. The gateway can
        // collapse a duplicate in flight, which matters on a retry inside a
        // 1.5-second budget.
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        // The output is a fixed-size object of booleans. Anything past this is a
        // model ignoring the schema, and capping it keeps a runaway generation
        // from eating the whole latency budget.
        max_tokens: 96,
        response_format: useNativeSchema
          ? {
              type: "json_schema",
              json_schema: {
                name: request.schemaName,
                strict: true,
                schema: request.schema,
              },
            }
          : { type: "json_object" },
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      }),
    };

    // `fetch` throws for two unrelated situations and the caller has to tell them
    // apart: the deadline aborted us, or there is no gateway there. The abort is
    // re-thrown untouched so `classifyWithDeadline`'s race still reads as a
    // timeout; everything else becomes UNREACHABLE, which is what it is.
    let response: Response;
    try {
      response = await fetch(`${baseUrl()}/chat/completions`, init);
    } catch (cause) {
      if (isAbortLike(cause) || signal.aborted) throw cause;
      throw new ProviderUnreachableError(cause);
    }

    if (response.status === 429 || response.status >= 500) {
      throw new RetryableProviderError(response.status);
    }
    if (!response.ok) {
      throw new ProviderRejectedError(response.status);
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string; refusal?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const message = body.choices?.[0]?.message;
    const usage = {
      model: body.model ?? this.model,
      promptTokens: body.usage?.prompt_tokens ?? null,
      completionTokens: body.usage?.completion_tokens ?? null,
    };
    if (!message?.content || message.refusal) {
      // A refusal is not a wrong answer. It returns as unparseable so the caller
      // treats it as infrastructure and grants generously.
      return { raw: null, ...usage };
    }
    try {
      return { raw: JSON.parse(message.content), ...usage };
    } catch {
      return { raw: null, ...usage };
    }
  }
}

/**
 * Runs `classify` under a hard deadline. The timer aborts the request so the
 * socket is not left open behind a fallback that has already been granted, and
 * the race means the caller returns on the deadline rather than whenever the
 * provider eventually gives up.
 */
export async function classifyWithDeadline(
  provider: ClassifierProvider,
  request: ClassifierRequest,
  idempotencyKey: string,
  timeoutMs: number = GRADING_TIMEOUT_MS,
): Promise<ProviderResult> {
  const controller = new AbortController();
  let onTimeout: ((error: Error) => void) | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    onTimeout = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    const error = new Error("grading deadline exceeded");
    error.name = "AbortError";
    onTimeout?.(error);
  }, timeoutMs);
  // Never let grading hold the process open.
  timer.unref?.();
  try {
    return await Promise.race([
      provider.classify(request, controller.signal, idempotencyKey),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
