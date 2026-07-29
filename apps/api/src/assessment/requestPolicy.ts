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

// Deliberately no submission rate limiter here: a limiter that answers 429 backfires
// on the grading wire (routes/duels.ts) — a 4xx there grants the client the full magazine.

