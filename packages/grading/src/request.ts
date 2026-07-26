// What a client is allowed to send, and what it can never send.
//
// This lives in the package rather than in the route so it can be tested against
// every shape an attacker would try, and so the route stays thin enough to read
// in one screen.
//
// The rule is an allowlist, not a denylist: four fields, and any fifth key is a
// rejection rather than something quietly dropped. That matters more than it
// looks. A denylist for `verdict` and `bullets` would be defeated by `kind`,
// `grade`, `ammo`, `magazine`, `score`, `correct`, or whatever the next field is
// called — and by a nested object. An allowlist is defeated by nothing, and it
// stays correct when someone adds a field to the service later.
//
// Named rejection codes exist because a request carrying a verdict is not a
// malformed request, it is an attempt to grade oneself, and the two should not be
// indistinguishable in a log. VERDICT_NOT_ACCEPTED is a 400 the same as any other,
// and it is separately countable.
//
// THE ROUND BOUND IS IMPORTED, NEVER RESTATED. This file used to declare its own
// `DUEL_ROUNDS = 6` and refuse any round index at or above it. The duel dropped
// its fixed round count hours before — duels now run until a health bar empties,
// measured at 5 to 9 rounds against a structural ceiling of 24 — so every verdict
// from round 7 on was refused, and a duel that went long stopped being able to
// grade answers at exactly the moment it mattered most. A copied constant is how
// that happened, so the bound is read from `@pa/duel/structure`, which is the
// module the machine itself bounds its rounds with.
//
// The import is the leaf subpath rather than the package root on purpose: this
// service must stay importable by the API without dragging the duel simulation,
// and through it the engine, into the server. `@pa/duel/structure` has no imports
// at all.

import { DUEL_ROUND_CEILING, isLegalRoundIndex } from "@pa/duel/structure";

/** Answers are capped at the wire so a paste cannot become a cost attack. */
export const MAX_SUBMITTED_ANSWER_CHARS = 4_000;

/**
 * Re-exported so a caller can name the bound it was refused by without taking its
 * own dependency on the duel. Read it; do not copy it.
 */
export { DUEL_ROUND_CEILING };

export interface GradeAnswerRequest {
  readonly itemId: string;
  readonly attemptId: string;
  readonly roundIndex: number;
  readonly answer: string;
}

const ALLOWED_KEYS = ["itemId", "attemptId", "roundIndex", "answer"] as const;

/**
 * Field names that would mean the client is trying to supply its own grade.
 * They are already rejected by the allowlist; naming them turns a generic
 * UNKNOWN_FIELD into a signal worth alerting on.
 */
const VERDICT_SHAPED_KEYS = new Set([
  "verdict",
  "kind",
  "grade",
  "graded",
  "correct",
  "iscorrect",
  "result",
  "outcome",
  "score",
  "label",
  "bullets",
  "bulletcount",
  "ammo",
  "magazine",
  "rounds",
  "source",
  "confidence",
  "ideas",
  "ideaspresent",
  "receipt",
  "itemversion",
  "rubricversion",
  "profileid",
]);

export type RequestRejection =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_FIELD"
  | "VERDICT_NOT_ACCEPTED"
  | "MISSING_FIELD"
  | "BAD_FIELD_TYPE"
  | "ROUND_OUT_OF_RANGE"
  | "ANSWER_TOO_LONG";

export type ParseResult =
  | { readonly ok: true; readonly value: GradeAnswerRequest }
  | {
      readonly ok: false;
      readonly code: RequestRejection;
      readonly detail: string;
    };

export function parseGradeAnswerRequest(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "NOT_AN_OBJECT", detail: typeof body };
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set<string>(ALLOWED_KEYS);
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    if (VERDICT_SHAPED_KEYS.has(key.toLowerCase())) {
      return { ok: false, code: "VERDICT_NOT_ACCEPTED", detail: key };
    }
    return { ok: false, code: "UNKNOWN_FIELD", detail: key };
  }
  for (const key of ["itemId", "attemptId", "answer"] as const) {
    if (!(key in record)) return { ok: false, code: "MISSING_FIELD", detail: key };
    if (typeof record[key] !== "string") {
      return { ok: false, code: "BAD_FIELD_TYPE", detail: key };
    }
  }
  const roundIndex = record["roundIndex"];
  if (roundIndex === undefined) {
    return { ok: false, code: "MISSING_FIELD", detail: "roundIndex" };
  }
  if (typeof roundIndex !== "number" || !Number.isInteger(roundIndex)) {
    return { ok: false, code: "BAD_FIELD_TYPE", detail: "roundIndex" };
  }
  // The machine cannot reach a round at or above the ceiling, so a round index
  // there names no round of any duel. Anything below it can and must be graded.
  if (!isLegalRoundIndex(roundIndex)) {
    return { ok: false, code: "ROUND_OUT_OF_RANGE", detail: String(roundIndex) };
  }
  const answer = record["answer"] as string;
  if (answer.length > MAX_SUBMITTED_ANSWER_CHARS) {
    return { ok: false, code: "ANSWER_TOO_LONG", detail: String(answer.length) };
  }
  const itemId = record["itemId"] as string;
  const attemptId = record["attemptId"] as string;
  if (itemId.length === 0 || itemId.length > 200) {
    return { ok: false, code: "BAD_FIELD_TYPE", detail: "itemId" };
  }
  if (attemptId.length === 0 || attemptId.length > 200) {
    return { ok: false, code: "BAD_FIELD_TYPE", detail: "attemptId" };
  }
  return { ok: true, value: { itemId, attemptId, roundIndex, answer } };
}

/**
 * The one piece of server authority this package cannot supply on its own.
 *
 * Grading is authoritative about the verdict, but a client still names the item it
 * is answering, and a client that can choose its item can choose the easiest one
 * in the pool every round. Which item belongs to round N of an attempt is decided by
 * the seeded selection in the mission container — another package's data and
 * another agent's territory this week — so it is injected rather than guessed.
 *
 * Return the item the server believes this round is, or null when the attempt is
 * not known. Absent an implementation the route grades what it is asked and says
 * so in its response, which is honest about the gap rather than hiding it.
 */
export interface RoundItemAuthority {
  expectedItemId(
    profileId: string,
    attemptId: string,
    roundIndex: number,
  ): Promise<string | null>;
}

/**
 * Retains the answer server-side and returns an opaque reference for the verdict's
 * provenance. Also injected: the encrypted-at-rest columns for student writing are
 * created by a migration this package does not own.
 */
export interface AnswerRetention {
  retain(input: {
    profileId: string;
    attemptId: string;
    roundIndex: number;
    itemId: string;
    answer: string;
  }): Promise<string | null>;
}
