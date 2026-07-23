import {
  ClassifierObservationSchema,
  type ClassifierObservation,
} from "@pa/contracts";
import { envFlag } from "../config.js";
import { TrueFoundryGradingProvider } from "./openAiCompatible.js";
import {
  RetryableProviderError,
  type GradingInput,
  type GradingProvider,
  type GradingResult,
} from "./types.js";

interface UsageBucket {
  minuteStartedAt: number;
  minuteRequests: number;
  day: string;
  dayTokens: number;
}

const usage = new Map<string, UsageBucket>();
let active = 0;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function unclassified(
  reason: Extract<ClassifierObservation, { status: "UNCLASSIFIED" }>["reason"],
  providerCalled: boolean,
): GradingResult {
  return { observation: { status: "UNCLASSIFIED", reason }, providerCalled };
}

function consumeBudget(profileId: string, estimatedTokens: number): boolean {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const current = usage.get(profileId);
  const bucket: UsageBucket =
    current && current.day === day
      ? current
      : {
          minuteStartedAt: now,
          minuteRequests: 0,
          day,
          dayTokens: 0,
        };
  if (now - bucket.minuteStartedAt >= 60_000) {
    bucket.minuteStartedAt = now;
    bucket.minuteRequests = 0;
  }
  const minuteLimit = Number(process.env.GRADING_REQUESTS_PER_MINUTE ?? 6);
  const tokenLimit = Number(process.env.GRADING_DAILY_TOKEN_LIMIT ?? 50_000);
  if (
    bucket.minuteRequests >= minuteLimit ||
    bucket.dayTokens + estimatedTokens > tokenLimit
  ) {
    usage.set(profileId, bucket);
    return false;
  }
  bucket.minuteRequests += 1;
  bucket.dayTokens += estimatedTokens;
  usage.set(profileId, bucket);
  return true;
}

async function callWithTimeout(
  provider: GradingProvider,
  input: GradingInput,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let rejectTimeout: ((error: Error) => void) | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    const error = new Error("provider grading timed out");
    error.name = "AbortError";
    rejectTimeout?.(error);
  }, timeoutMs);
  timer.unref();
  try {
    return await Promise.race([
      provider.classify(input, controller.signal),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function gradeFormativeResponse(
  profileId: string,
  input: GradingInput,
  provider: GradingProvider = new TrueFoundryGradingProvider(),
): Promise<GradingResult> {
  if (!envFlag("GRADING_ENABLED")) {
    return unclassified("DISABLED", false);
  }
  if (Date.now() < circuitOpenUntil) {
    return unclassified("PROVIDER", false);
  }
  const maxConcurrency = Math.max(
    1,
    Number(process.env.GRADING_MAX_CONCURRENCY ?? 3),
  );
  if (active >= maxConcurrency) {
    return unclassified("RATE_LIMIT", false);
  }
  const estimatedTokens =
    Math.ceil(input.responseText.length / 4) +
    Math.ceil(JSON.stringify(input.sourceTexts).length / 4) +
    400;
  if (!consumeBudget(profileId, estimatedTokens)) {
    return unclassified("RATE_LIMIT", false);
  }

  active += 1;
  let providerCalled = false;
  const hardTimeoutMs = Math.max(
    1_000,
    Math.min(
      6_000,
      Number(process.env.TRUEFOUNDRY_GRADING_TIMEOUT_MS ?? 5_500),
    ),
  );
  const deadline = Date.now() + hardTimeoutMs;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const remainingMs = deadline - Date.now();
        if (remainingMs < 350) {
          return unclassified("TIMEOUT", providerCalled);
        }
        providerCalled = true;
        const raw = await callWithTimeout(provider, input, remainingMs);
        const parsed = ClassifierObservationSchema.safeParse(raw);
        consecutiveFailures = 0;
        return parsed.success
          ? { observation: parsed.data, providerCalled }
          : unclassified("MALFORMED", providerCalled);
      } catch (error) {
        const aborted =
          error instanceof Error &&
          (error.name === "AbortError" || error.message.includes("aborted"));
        if (aborted) {
          consecutiveFailures += 1;
          return unclassified("TIMEOUT", providerCalled);
        }
        if (
          error instanceof RetryableProviderError &&
          attempt === 0 &&
          deadline - Date.now() >= 500
        ) {
          continue;
        }
        consecutiveFailures += 1;
        if (consecutiveFailures >= 4) {
          circuitOpenUntil = Date.now() + 60_000;
        }
        return unclassified(
          error instanceof RetryableProviderError && error.status === 429
            ? "RATE_LIMIT"
            : "PROVIDER",
          providerCalled,
        );
      }
    }
    return unclassified("PROVIDER", providerCalled);
  } finally {
    active -= 1;
  }
}

export function resetGradingGuardsForTests(): void {
  usage.clear();
  active = 0;
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

