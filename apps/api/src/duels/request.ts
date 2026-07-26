// What the duel client is allowed to send, and what it can never send.
//
// THE SHAPE IS THE CLIENT'S, NOT OURS. `apps/web/src/duel/duelGrading.ts` already
// posts `{ side, itemId, itemVersion, conceptId, answer }` to
// `/v1/duels/:duelId/rounds/:round/verdict`, and this file is that contract read
// back rather than a new one proposed. @pa/grading's own `parseGradeAnswerRequest`
// is the parser for `/v1/grading/answers`, whose body carries `attemptId` and
// `roundIndex` instead — it would refuse three of the five fields above, so it is
// the wrong parser here and reusing it would have meant changing a shipped client.
//
// The rule is an allowlist, for the reason @pa/grading states and this route
// inherits: a denylist for `verdict` and `bullets` is defeated by `kind`, `grade`,
// `ammo`, `score` or whatever the next field is called. Five fields; a sixth is a
// rejection rather than something quietly dropped.
//
// TWO CLASSES OF FIELD, TREATED DIFFERENTLY ON PURPOSE.
//
//   * `side`, `itemId` and `answer` are the client's to state and are validated.
//   * `itemVersion` and `conceptId` are CLAIMS about content the server already
//     holds. They are parsed, and then they are overridden: the compiled bank
//     decides an item's rubric version and its concept, and the verdict carries
//     the server's answer. A disagreement is logged, never refused — see the note
//     on refusals in ../routes/duels.ts, where a 4xx costs the student nothing and
//     hands them the full magazine, which is precisely why a strict server must be
//     strict only about the things that matter.
//
// Note also what is NOT in the body and cannot be: a bullet count, and a verdict.
// The duel's economy is derived from `kind` by a reducer in the client, and `kind`
// is minted here.

import { MAX_SUBMITTED_ANSWER_CHARS, DUEL_ROUND_CEILING } from "@pa/grading";

export { MAX_SUBMITTED_ANSWER_CHARS, DUEL_ROUND_CEILING };

export type DuelSide = "A" | "B";

export interface DuelVerdictRequest {
  readonly side: DuelSide;
  readonly itemId: string;
  /** The client's copy of the item version. A claim; the bank is the authority. */
  readonly itemVersion: string;
  /** The client's copy of the concept id. Also a claim. */
  readonly conceptId: string;
  /** The student's own words. This is the only place they exist on this path. */
  readonly answer: string;
}

const ALLOWED_KEYS = [
  "side",
  "itemId",
  "itemVersion",
  "conceptId",
  "answer",
] as const;

/**
 * Field names that would mean the client is trying to supply its own grade. The
 * allowlist above already refuses them; naming them turns a generic UNKNOWN_FIELD
 * into a signal worth alerting on, because a request carrying a verdict is not a
 * malformed request — it is an attempt to grade oneself, and the two should not be
 * indistinguishable in a log.
 *
 * `itemVersion` is absent from this set although @pa/grading's equivalent lists
 * it: on this wire it is part of the authored contract, and the allowlist is
 * consulted first.
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
  "source",
  "confidence",
  "ideas",
  "ideaspresent",
  "receipt",
  "rubricversion",
  "profileid",
]);

export type DuelRequestRejection =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_FIELD"
  | "VERDICT_NOT_ACCEPTED"
  | "MISSING_FIELD"
  | "BAD_FIELD_TYPE"
  | "UNKNOWN_SIDE"
  | "ANSWER_TOO_LONG";

export type DuelRequestParse =
  | { readonly ok: true; readonly value: DuelVerdictRequest }
  | {
      readonly ok: false;
      readonly code: DuelRequestRejection;
      readonly detail: string;
    };

export function parseDuelVerdictRequest(body: unknown): DuelRequestParse {
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
  for (const key of ALLOWED_KEYS) {
    if (!(key in record)) return { ok: false, code: "MISSING_FIELD", detail: key };
    if (typeof record[key] !== "string") {
      return { ok: false, code: "BAD_FIELD_TYPE", detail: key };
    }
  }
  const side = record["side"] as string;
  if (side !== "A" && side !== "B") {
    return { ok: false, code: "UNKNOWN_SIDE", detail: side };
  }
  const itemId = record["itemId"] as string;
  if (itemId.length === 0 || itemId.length > 200) {
    return { ok: false, code: "BAD_FIELD_TYPE", detail: "itemId" };
  }
  const answer = record["answer"] as string;
  // An empty answer is NOT refused. It is graded, and @pa/grading's pre-check
  // decides it deterministically as ABSTAINED/WRONG with no model call. A student
  // who writes nothing must get the wrong-answer magazine, and a 400 here would
  // instead hand them the full one through the client's own timeout path.
  if (answer.length > MAX_SUBMITTED_ANSWER_CHARS) {
    return { ok: false, code: "ANSWER_TOO_LONG", detail: String(answer.length) };
  }
  return {
    ok: true,
    value: {
      side,
      itemId,
      itemVersion: record["itemVersion"] as string,
      conceptId: record["conceptId"] as string,
      answer,
    },
  };
}

/**
 * The round, from the path.
 *
 * THE BOUND IS READ, NOT RESTATED. @pa/grading shipped for a day with its own
 * `DUEL_ROUNDS = 6` and refused every verdict from round seven on — a duel that
 * went long stopped being able to grade at exactly the point it mattered — so the
 * ceiling is imported. It comes through @pa/grading's deliberate re-export of
 * `@pa/duel/structure` rather than from `@pa/duel` directly, which is the same
 * constant without this service taking a dependency on the duel simulation.
 *
 * The window is `1 .. DUEL_ROUND_CEILING` and not `isLegalRoundIndex`'s
 * `0 .. DUEL_ROUND_CEILING - 1`, because the machine's `state.round` — the number
 * the client actually sends — is one-based: round 0 is the face-off and no
 * question is asked in it, and the last round the machine can open is the ceiling
 * itself. Using the zero-based helper verbatim would refuse the final round of the
 * longest duels, which is the same off-by-one the constant exists to prevent.
 */
export function parseDuelRound(
  raw: string | undefined,
): { readonly ok: true; readonly round: number } | { readonly ok: false } {
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return { ok: false };
  const round = Number(raw);
  if (!Number.isInteger(round) || round < 1 || round > DUEL_ROUND_CEILING) {
    return { ok: false };
  }
  return { ok: true, round };
}
