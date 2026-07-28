// The model seam for the pipeline's two judgement checks (the discriminator, and
// any future adversarial style pass).
//
// It is a SEAM, not a design: the interface is one structured-output call, so the
// checks are written against a fake model in the tests and against the real gateway
// in the CLI. Nothing in the pipeline hot path calls this — these are OFFLINE
// checks, run once per item before it ships, which is the whole reason a model is
// affordable here and not at runtime.
//
// The gateway, credential and request shape are the classifier's, reused verbatim
// via ./provider so the pipeline talks to the same TrueFoundry endpoint the grader
// does, with no second integration to operate.

import { GRADING_TIMEOUT_MS } from "../tuning.js";
import { gatewayBaseUrl, gatewayCredential, gradingModel } from "../provider.js";

export interface PipelineJudgeRequest {
  readonly system: string;
  readonly user: string;
  readonly schema: Record<string, unknown>;
  readonly schemaName: string;
}

export interface PipelineModel {
  /** One structured-output call. Returns the parsed object, or null on any failure. */
  judge(request: PipelineJudgeRequest): Promise<unknown>;
}

/**
 * The real model, on the same OpenAI-compatible TrueFoundry gateway as the grader.
 * Offline tool: a longer budget than the 1.5s play cap is fine, because nothing is
 * waiting on it in a duel. A failure returns null and the caller reports that the
 * model check could not run, rather than passing an unverified item.
 */
export class TrueFoundryPipelineModel implements PipelineModel {
  constructor(
    private readonly model: string = gradingModel(),
    private readonly timeoutMs: number = 30_000,
  ) {}

  async judge(request: PipelineJudgeRequest): Promise<unknown> {
    void GRADING_TIMEOUT_MS; // documented cross-reference; the offline budget is our own.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${gatewayBaseUrl()}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${gatewayCredential()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 400,
          response_format: {
            type: "json_schema",
            json_schema: { name: request.schemaName, strict: true, schema: request.schema },
          },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        choices?: { message?: { content?: string; refusal?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) return null;
      try {
        return JSON.parse(content) as unknown;
      } catch {
        return null;
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
