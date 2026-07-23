import { validCsrfToken } from "../auth.js";

export function validAssessmentMutationRequest(input: {
  sessionId?: string;
  csrfToken?: string;
  origin?: string;
  allowedOrigin: string;
}): boolean {
  return (
    validCsrfToken(input.sessionId, input.csrfToken) &&
    (!input.origin || input.origin === input.allowedOrigin)
  );
}

export class SubmissionRateLimiter {
  private readonly windows = new Map<
    string,
    { startedAt: number; count: number }
  >();

  constructor(
    private readonly maxRequests = 12,
    private readonly windowMs = 60_000,
  ) {}

  allow(profileId: string, now = Date.now()): boolean {
    const current = this.windows.get(profileId);
    const window =
      current && now - current.startedAt < this.windowMs
        ? current
        : { startedAt: now, count: 0 };
    if (window.count >= this.maxRequests) {
      this.windows.set(profileId, window);
      return false;
    }
    window.count += 1;
    this.windows.set(profileId, window);
    return true;
  }
}

