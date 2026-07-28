// The hot path.
//
// One function matters here — `GradingService.grade` — and it is the thing a
// student is waiting on mid-gunfight, so the order of operations is the design:
//
//   1. Resolve the item from the bank. An unknown item is a caller bug, not a
//      grade; it throws rather than granting anything.
//   2. Pre-check. An empty answer is WRONG deterministically, with no model call
//      and no network latency. This is the only case decided without the model,
//      because it is the only one that is not a judgement.
//   3. Cache. Item + rubric version + normalised answer. A hit is a few
//      microseconds and no cost.
//   4. Classify under a 1.5-second deadline, and project the author's line onto
//      the result.
//   5. On any infrastructure failure — timeout, refused request, unreachable
//      gateway, malformed output, open breaker, no credential — grant CORRECT,
//      mark the source GRADING_TIMEOUT, and log it for review. The source is the
//      DUEL's word for "granted without a grade" and it is the same for all six;
//      which of the six it was is `provenance.fallbackDiagnosis`, and that
//      distinction is not cosmetic. A refused request fails in eight
//      milliseconds and a real timeout takes 1250, and for as long as both
//      reported the same three words the only way to tell a broken gateway from
//      a slow one was to measure the latency and guess.
//
// LOW CONFIDENCE IS RATE-LIMITED RATHER THAN DECIDED. Granting generously on
// infrastructure failure is safe because a student cannot cause an outage on
// demand. Granting on low classifier confidence is not the same thing — it is an
// exploit with a discoverable input — but refusing it outright turns the exploit
// into a false-negative machine aimed at exactly the students this service exists
// to protect. So a LOW-confidence WRONG grants the first two times in a session and
// is counted; past the allowance the classifier's reading stands and the account is
// flagged for a human. The exploit only pays if it repeats, so the repetition is
// what gets removed. The reasoning and the threshold's arithmetic are in
// ./lowConfidence.ts.

import { ItemBank, type CompiledItem } from "./rubric.js";
import {
  MAX_ANSWER_CHARS,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_OPEN_MS,
  GRADING_TIMEOUT_MS,
  MIN_BUDGET_FOR_RETRY_MS,
} from "./tuning.js";
import {
  clampAnswer,
  normalizeAnswer,
  preCheckAnswer,
  questionEchoRatio,
} from "./normalize.js";
import {
  MemoryVerdictCache,
  verdictCacheKey,
  type VerdictCache,
} from "./cache.js";
import {
  DEFAULT_JUDGING_POLICY,
  buildClassifierRequest,
  parseRawClassification,
  type JudgingPolicy,
  type RawClassification,
} from "./prompt.js";
import {
  MemoryLowConfidenceLedger,
  needsLowConfidencePolicy,
  type LowConfidenceLedger,
  type LowConfidenceOutcome,
} from "./lowConfidence.js";
import {
  ProviderNotConfiguredError,
  ProviderRejectedError,
  ProviderUnreachableError,
  RetryableProviderError,
  classifyWithDeadline,
  isAbortLike,
  type ClassifierProvider,
} from "./provider.js";
import { NullReviewLog, type ReviewLog } from "./reviewLog.js";
import { isTimeoutDiagnosis } from "./verdict.js";
import type {
  ClassifierConfidence,
  FallbackDiagnosis,
  FallbackReason,
  GradedVerdict,
  VerdictKind,
} from "./verdict.js";
import { createHash } from "node:crypto";

export interface GradeRequest {
  readonly itemId: string;
  /** The student's answer, raw. Never leaves this process except to the model. */
  readonly answer: string;
  readonly profileId: string;
  readonly attemptId: string;
  readonly roundIndex: number;
  /** Opaque reference to the retained answer record, when there is one. */
  readonly responseRef?: string | null;
  /**
   * Optional salt appended to the PROVIDER idempotency key only, never to the
   * verdict cache key. Production never sets it, so nothing about live grading or
   * caching changes. The eval harness sets a distinct value per repeat so a gateway
   * that de-duplicates identical in-flight requests cannot collapse a majority vote
   * into one cached answer — the repeats must be independent samples to be worth
   * taking.
   */
  readonly idempotencySalt?: string;
}

export interface GradingServiceOptions {
  readonly bank: ItemBank;
  readonly provider: ClassifierProvider | null;
  readonly cache?: VerdictCache;
  readonly reviewLog?: ReviewLog;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** The calibrated judging rules. Travels with the content bank. */
  readonly policy?: JudgingPolicy;
  readonly lowConfidence?: LowConfidenceLedger;
}

/**
 * The author's line, applied. This is the only place a binary is produced from a
 * classification, and it contains no model output beyond the booleans.
 */
export function projectVerdict(
  item: CompiledItem,
  classification: RawClassification,
): { readonly kind: VerdictKind; readonly ideasPresent: readonly string[] } {
  const ideasPresent = item.ideas
    .filter((idea) => classification.ideas[idea.key] === true)
    .map((idea) => idea.key);
  // Not an attempt at the question at all: no ideas can be carried by text that
  // is not an answer, whatever the per-idea booleans claim.
  if (!classification.answers) return { kind: "WRONG", ideasPresent: [] };
  return {
    kind: ideasPresent.length >= item.needs ? "CORRECT" : "WRONG",
    ideasPresent,
  };
}

export class UnknownItemError extends Error {
  constructor(itemId: string) {
    super(`no authored item ${itemId}`);
    this.name = "UnknownItemError";
  }
}

/**
 * A thrown classifier error, classified. Returns the arguments to `fallback`.
 *
 * The default is `PROVIDER_FAILED` rather than a guess. A provider a test or a
 * future integration supplies can throw anything, and calling an unrecognised
 * throw "unreachable" would put a wrong cause in front of whoever is debugging
 * it — which is the whole failure this function exists to end.
 */
function diagnose(
  error: unknown,
): [FallbackDiagnosis, { fallbackStatus?: number | null }] {
  if (error instanceof ProviderRejectedError) {
    // RetryableProviderError extends this, so a 429 or 5xx that survived the
    // retry budget lands here with its status intact.
    return ["PROVIDER_REJECTED", { fallbackStatus: error.status }];
  }
  if (error instanceof ProviderUnreachableError) {
    return ["PROVIDER_UNREACHABLE", {}];
  }
  if (error instanceof ProviderNotConfiguredError) {
    // Reachable even when the service was built with a provider: the credential
    // and the base URL are read per call, so a value that disappears after boot
    // arrives here rather than at construction.
    return ["NO_CREDENTIAL", {}];
  }
  return ["PROVIDER_FAILED", {}];
}

export class GradingService {
  private readonly bank: ItemBank;
  private readonly provider: ClassifierProvider | null;
  private readonly cache: VerdictCache;
  private readonly reviewLog: ReviewLog;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly policy: JudgingPolicy;
  private readonly lowConfidence: LowConfidenceLedger;

  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(options: GradingServiceOptions) {
    this.bank = options.bank;
    this.provider = options.provider;
    this.cache = options.cache ?? new MemoryVerdictCache();
    this.reviewLog = options.reviewLog ?? new NullReviewLog();
    this.timeoutMs = options.timeoutMs ?? GRADING_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.policy = options.policy ?? DEFAULT_JUDGING_POLICY;
    this.lowConfidence = options.lowConfidence ?? new MemoryLowConfidenceLedger();
  }

  get cacheStats(): { readonly hits: number; readonly misses: number } {
    return this.cache.stats;
  }

  /** Profiles currently flagged for repeated low-confidence grading. */
  get flaggedProfiles(): readonly string[] {
    return this.lowConfidence.flaggedProfiles;
  }

  async grade(request: GradeRequest): Promise<GradedVerdict> {
    const startedAt = this.now();
    const item = this.bank.get(request.itemId);
    if (item === undefined) throw new UnknownItemError(request.itemId);

    const responseRef = request.responseRef ?? null;
    const normalized = normalizeAnswer(request.answer);
    const cacheKey = verdictCacheKey(
      item.itemId,
      item.rubricVersion,
      request.answer,
    );
    const echo = questionEchoRatio(item.ask, request.answer);

    const finish = (
      kind: VerdictKind,
      source: GradedVerdict["source"],
      path: GradedVerdict["provenance"]["path"],
      extra: {
        ideasPresent?: readonly string[];
        confidence?: ClassifierConfidence | null;
        fallbackReason?: FallbackReason | null;
        fallbackDiagnosis?: FallbackDiagnosis | null;
        fallbackStatus?: number | null;
        model?: string | null;
        promptTokens?: number | null;
        completionTokens?: number | null;
        lowConfidenceOutcome?: LowConfidenceOutcome | null;
        lowConfidenceGrants?: number | null;
      },
    ): GradedVerdict => {
      const fallbackReason = extra.fallbackReason ?? null;
      const confidence = extra.confidence ?? null;
      const ideasPresent = extra.ideasPresent ?? [];
      const lowConfidenceOutcome = extra.lowConfidenceOutcome ?? null;
      const needsReview =
        fallbackReason !== null ||
        confidence === "LOW" ||
        // A wrong answer that carried some of the ideas is the shape a false
        // negative takes. Sampling these by hand is how the eval set grows.
        (kind === "WRONG" &&
          path === "MODEL" &&
          ideasPresent.length > 0 &&
          ideasPresent.length < item.needs);
      const verdict: GradedVerdict = {
        kind,
        itemId: item.itemId,
        itemVersion: item.rubricVersion,
        source,
        responseRef,
        provenance: {
          path,
          rubricVersion: item.rubricVersion,
          conceptId: item.conceptId,
          poolId: item.poolId,
          ideasPresent,
          ideasRequired: item.needs,
          ideasTotal: item.ideas.length,
          confidence,
          fallbackReason,
          fallbackDiagnosis: extra.fallbackDiagnosis ?? null,
          fallbackStatus: extra.fallbackStatus ?? null,
          lowConfidenceOutcome,
          lowConfidenceGrants: extra.lowConfidenceGrants ?? null,
          latencyMs: this.now() - startedAt,
          model: extra.model ?? null,
          promptTokens: extra.promptTokens ?? null,
          completionTokens: extra.completionTokens ?? null,
          cacheKey,
          questionEcho: echo,
          needsReview,
        },
      };
      const diagnosis = extra.fallbackDiagnosis ?? null;
      if (needsReview) {
        this.reviewLog.record({
          // TIMEOUT_GRANT is reserved for the condition it names. It used to
          // cover all five fallbacks, so a 403 from the gateway arrived in the
          // review log labelled as a timeout — the same conflation as the wire,
          // one layer down, in the log that is supposed to be the evidence.
          reason:
            fallbackReason !== null
              ? isTimeoutDiagnosis(diagnosis)
                ? "TIMEOUT_GRANT"
                : "UNGRADED_GRANT"
              : lowConfidenceOutcome === "WITHHELD_AND_FLAGGED"
                ? "LOW_CONFIDENCE_LIMIT"
                : confidence === "LOW"
                  ? "LOW_CONFIDENCE"
                  : "FALSE_NEGATIVE_RISK",
          at: new Date(this.now()).toISOString(),
          profileId: request.profileId,
          attemptId: request.attemptId,
          roundIndex: request.roundIndex,
          itemId: item.itemId,
          rubricVersion: item.rubricVersion,
          conceptId: item.conceptId,
          kind,
          fallbackReason,
          fallbackDiagnosis: diagnosis,
          fallbackStatus: extra.fallbackStatus ?? null,
          confidence,
          lowConfidenceOutcome,
          lowConfidenceGrants: extra.lowConfidenceGrants ?? null,
          profileFlagged: this.lowConfidence.isFlagged(request.profileId),
          ideasPresent,
          ideasRequired: item.needs,
          ideasTotal: item.ideas.length,
          latencyMs: verdict.provenance.latencyMs,
          answerHash: createHash("sha256").update(normalized).digest("hex").slice(0, 16),
          answerLength: normalized.length,
          questionEcho: echo,
        });
      }
      return verdict;
    };

    /**
     * The low-confidence policy, applied to a classification from either the model
     * or the cache.
     *
     * It runs on the cache path too, and that is load-bearing. What the cache holds
     * is the classifier's reading — WRONG at LOW confidence — not the granted
     * verdict, so a student cannot replay one lucky grant for free all session: the
     * allowance is consulted on every round, and the cache only saves the model
     * call. Caching the granted CORRECT instead would hand back an unlimited
     * version of exactly the exploit the allowance exists to close.
     */
    const applyLowConfidence = (
      kind: VerdictKind,
      confidence: ClassifierConfidence,
    ): {
      kind: VerdictKind;
      outcome: LowConfidenceOutcome | null;
      grants: number | null;
    } => {
      if (!needsLowConfidencePolicy(confidence, kind)) {
        return { kind, outcome: null, grants: null };
      }
      const decision = this.lowConfidence.record(request.profileId);
      return {
        kind: decision.outcome === "GRANTED" ? "CORRECT" : kind,
        outcome: decision.outcome,
        grants: decision.grantsInWindow,
      };
    };

    /**
     * The generous grant, named by what actually went wrong.
     *
     * The coarse `FallbackReason` is derived here rather than passed in, so a
     * call site cannot claim a diagnosis and a contradicting reason, and so the
     * one-way mapping onto the five frozen coarse values lives in exactly one
     * place. `PROVIDER_ERROR` is the image of three different diagnoses, which is
     * precisely why the diagnosis had to stop being optional.
     */
    const fallback = (
      diagnosis: FallbackDiagnosis,
      extra: {
        fallbackStatus?: number | null;
        model?: string | null;
        promptTokens?: number | null;
        completionTokens?: number | null;
      } = {},
    ): GradedVerdict => {
      const reason: FallbackReason =
        diagnosis === "NO_CREDENTIAL"
          ? "NOT_CONFIGURED"
          : diagnosis === "CIRCUIT_OPEN"
            ? "CIRCUIT_OPEN"
            : diagnosis === "DEADLINE_EXCEEDED"
              ? "TIMEOUT"
              : diagnosis === "MALFORMED_OUTPUT"
                ? "MALFORMED_OUTPUT"
                : "PROVIDER_ERROR";
      return finish("CORRECT", "GRADING_TIMEOUT", "FALLBACK", {
        ...extra,
        fallbackReason: reason,
        fallbackDiagnosis: diagnosis,
      });
    };

    // 2. Deterministic pre-check. An empty box abstains, and the duel's own rule
    // for ABSTAINED is WRONG, so this agrees with the duel by construction.
    if (preCheckAnswer(request.answer) === "EMPTY") {
      return finish("WRONG", "ABSTAINED", "PRE_CHECK", {});
    }

    // 3. Cache.
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      const decided = applyLowConfidence(cached.kind, cached.confidence);
      return finish(decided.kind, "CLASSIFIER", "CACHE", {
        ideasPresent: cached.ideasPresent,
        confidence: cached.confidence,
        model: cached.model,
        lowConfidenceOutcome: decided.outcome,
        lowConfidenceGrants: decided.grants,
      });
    }

    if (this.provider === null) return fallback("NO_CREDENTIAL");
    if (this.now() < this.circuitOpenUntil) return fallback("CIRCUIT_OPEN");

    // 4. Classify. The deadline is measured from the top of `grade`, not from the
    // start of the call, so the cache lookup and the normalisation are inside the
    // student's 1.5 seconds rather than added to it.
    const deadlineAt = startedAt + this.timeoutMs;
    const clamped = clampAnswer(request.answer, MAX_ANSWER_CHARS);
    const classifierRequest = buildClassifierRequest(item, clamped, this.policy);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remaining = deadlineAt - this.now();
      if (remaining <= 0) {
        this.consecutiveFailures += 1;
        return fallback("DEADLINE_EXCEEDED");
      }
      try {
        const result = await classifyWithDeadline(
          this.provider,
          classifierRequest,
          // The verdict cache key stays `cacheKey`; only the provider idempotency
          // key is salted, and only when a caller asks (the eval's repeats).
          request.idempotencySalt ? `${cacheKey}#${request.idempotencySalt}` : cacheKey,
          remaining,
        );
        const classification = parseRawClassification(result.raw, item);
        if (classification === null) {
          this.noteFailure();
          return fallback("MALFORMED_OUTPUT", {
            model: result.model,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          });
        }
        this.consecutiveFailures = 0;
        const projected = projectVerdict(item, classification);
        // The classifier's reading is what is cached, never the granted verdict.
        this.cache.set(cacheKey, {
          kind: projected.kind,
          ideasPresent: projected.ideasPresent,
          confidence: classification.confidence,
          model: result.model,
        });
        const decided = applyLowConfidence(
          projected.kind,
          classification.confidence,
        );
        return finish(decided.kind, "CLASSIFIER", "MODEL", {
          ideasPresent: projected.ideasPresent,
          confidence: classification.confidence,
          model: result.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          lowConfidenceOutcome: decided.outcome,
          lowConfidenceGrants: decided.grants,
        });
      } catch (error) {
        if (isAbortLike(error)) {
          this.noteFailure();
          return fallback("DEADLINE_EXCEEDED");
        }
        const retryable = error instanceof RetryableProviderError;
        if (
          retryable &&
          attempt === 0 &&
          deadlineAt - this.now() >= MIN_BUDGET_FOR_RETRY_MS
        ) {
          continue;
        }
        this.noteFailure();
        return fallback(...diagnose(error));
      }
    }
    this.noteFailure();
    return fallback("PROVIDER_FAILED");
  }

  private noteFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitOpenUntil = this.now() + CIRCUIT_OPEN_MS;
      this.consecutiveFailures = 0;
    }
  }
}
