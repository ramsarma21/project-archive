// The verdict this service mints, and its projection onto the duel's wire.
//
// Two shapes live here and the difference between them is the whole security
// model:
//
//   * `GradedVerdict` is rich. It carries provenance — which item, which rubric
//     version, cache or model or fallback, which ideas the classifier found, how
//     long it took. It is what the review log and the teacher report read, and it
//     stays server-side.
//   * `verdictEnvelope()` is the five fields @pa/duel's `parseVerdictEnvelope`
//     accepts, and nothing else. No bullet count, no confidence, no answer text,
//     no rubric detail. The duel derives 3 or 1 from `kind` alone.
//
// The vocabulary of `kind` and `source` is not ours to extend: @pa/duel rejects
// an unknown source and rejects a non-binary kind by name. Our richer reasons
// live in `provenance.fallbackReason`, beside the wire vocabulary rather than
// inside it, so a new infrastructure failure mode never needs a change on the
// duel's side of the boundary.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { LowConfidenceOutcome } from "./lowConfidence.js";

/** Binary. There is no third value and nothing here to configure. */
export type VerdictKind = "CORRECT" | "WRONG";

/**
 * The duel's source vocabulary, verbatim. All four are authority-side; none of
 * them is the client.
 */
export type VerdictSource =
  | "CLASSIFIER"
  | "GRADING_TIMEOUT"
  | "ABSTAINED"
  | "OPPONENT_AUTHORITY";

/** Where the answer to this round came from, for cost and cache reporting. */
export type VerdictPath = "CACHE" | "MODEL" | "FALLBACK" | "PRE_CHECK";

/**
 * Why a generous fallback fired. Every one of these is an infrastructure
 * condition a student cannot trigger on demand, which is the reason granting the
 * maximum for them is safe. All of them ride the wire as `GRADING_TIMEOUT`.
 *
 * THIS IS THE COARSE CLASS AND IT IS FROZEN AT FIVE MEMBERS.
 * `packages/assessment/src/gradingAdapter.ts` mirrors this union structurally —
 * deliberately, for the reasons argued there — and a real `GradedVerdict` is
 * assigned to that mirror in its tests, so a sixth member here is a typecheck
 * failure in a package this file cannot reach. The DIAGNOSIS therefore lives in
 * `FallbackDiagnosis` below, as a field of its own beside this one.
 */
export type FallbackReason =
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "MALFORMED_OUTPUT"
  | "CIRCUIT_OPEN"
  | "NOT_CONFIGURED";

/**
 * What actually happened, at the resolution an operator needs.
 *
 * WHY THIS EXISTS SEPARATELY FROM `FallbackReason`. A duel round that granted the
 * maximum because the gateway refused a bad model name in 8ms and a duel round
 * that granted the maximum because a real model call overran 1.25 seconds were
 * reported identically: `source: "GRADING_TIMEOUT"`, `fallbackReason:
 * "PROVIDER_ERROR"`, and a review-log entry whose reason field read
 * `TIMEOUT_GRANT`. The only thing that distinguished them anywhere was the
 * elapsed milliseconds, and reading latency to discover that nothing is being
 * graded is not a diagnostic — it is an archaeology dig. So the four conditions
 * the API can genuinely be in are named:
 *
 *   * NO_CREDENTIAL        — nothing to authenticate with. Configuration.
 *   * PROVIDER_REJECTED    — the gateway answered and refused. Credential, model
 *                            name, or quota; `fallbackStatus` says which.
 *   * PROVIDER_UNREACHABLE — no HTTP response at all. Network, DNS, egress.
 *   * DEADLINE_EXCEEDED    — a real call that genuinely ran out of budget. The
 *                            ONLY one of these that is honestly a timeout.
 *   * MALFORMED_OUTPUT     — the model answered and ignored the schema.
 *   * CIRCUIT_OPEN         — an earlier failure is still being short-circuited;
 *                            look at what tripped it, not at this round.
 *   * PROVIDER_FAILED      — a provider threw something unclassifiable. The
 *                            honest bucket, not a default dressed as a cause.
 *
 * WHAT THIS IS NOT. It is not on the wire and must not go there:
 * `verdictEnvelope()` is five fields and @pa/duel rejects a sixth by name. A
 * verdict's `source` stays `GRADING_TIMEOUT` because that is the DUEL's word for
 * "granted without a grade" and the bullet derivation is keyed to it. This is the
 * server-side answer to "why", which is a different question from "what does the
 * reducer do with it".
 */
export type FallbackDiagnosis =
  | "NO_CREDENTIAL"
  | "PROVIDER_REJECTED"
  | "PROVIDER_UNREACHABLE"
  | "DEADLINE_EXCEEDED"
  | "MALFORMED_OUTPUT"
  | "CIRCUIT_OPEN"
  | "PROVIDER_FAILED";

/**
 * One line a person can act on, per diagnosis. Kept beside the type so a new
 * member cannot be added without saying what a reader should do about it.
 */
export const FALLBACK_DIAGNOSIS_ADVICE: Readonly<
  Record<FallbackDiagnosis, string>
> = {
  NO_CREDENTIAL:
    "no classifier credential is resolvable. Set TRUEFOUNDRY_GRADING_API_KEY " +
    "(or, outside production, TRUEFOUNDRY_API_KEY) in the repository .env.",
  PROVIDER_REJECTED:
    "the gateway answered and refused the request. Check the credential, its " +
    "access to TRUEFOUNDRY_GRADING_MODEL, and the quota on it.",
  PROVIDER_UNREACHABLE:
    "the gateway could not be reached at all. Check TRUEFOUNDRY_GRADING_BASE_URL " +
    "and whether this process has outbound network access to it.",
  DEADLINE_EXCEEDED:
    "the model was reached but did not answer inside the grading budget. This is " +
    "the one condition the generous grant was designed for.",
  MALFORMED_OUTPUT:
    "the model answered and ignored the response schema. Check the model name and " +
    "TRUEFOUNDRY_GRADING_STRUCTURED_OUTPUT.",
  CIRCUIT_OPEN:
    "an earlier run of failures is still being short-circuited; the cause is " +
    "whatever tripped the breaker, not this round.",
  PROVIDER_FAILED:
    "the classifier threw an error that could not be classified. The API log " +
    "carries it.",
};

/** True only for the one condition that is honestly a timeout. */
export function isTimeoutDiagnosis(
  diagnosis: FallbackDiagnosis | null,
): boolean {
  return diagnosis === "DEADLINE_EXCEEDED";
}

export type ClassifierConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface VerdictProvenance {
  readonly path: VerdictPath;
  readonly rubricVersion: string;
  readonly conceptId: string;
  readonly poolId: string;
  /** Which authored ideas the classifier reported present, by key. */
  readonly ideasPresent: readonly string[];
  readonly ideasRequired: number;
  readonly ideasTotal: number;
  readonly confidence: ClassifierConfidence | null;
  readonly fallbackReason: FallbackReason | null;
  /**
   * The precise cause, non-null exactly when `fallbackReason` is. Read this
   * rather than `fallbackReason` when the question is "what is wrong": four of
   * the five coarse reasons map one-to-one, and `PROVIDER_ERROR` is the one that
   * hid a refused request and an unreachable gateway behind one word.
   */
  readonly fallbackDiagnosis: FallbackDiagnosis | null;
  /** The HTTP status, when the gateway answered at all. Else null. */
  readonly fallbackStatus: number | null;
  /**
   * Set when the low-confidence policy was consulted, which happens only for a
   * LOW-confidence WRONG. GRANTED means the verdict below was flipped to CORRECT
   * inside the session allowance; WITHHELD_AND_FLAGGED means the allowance was
   * spent and the classifier's reading stands.
   */
  readonly lowConfidenceOutcome: LowConfidenceOutcome | null;
  /** Low-confidence grants this profile has used in the window, including this one. */
  readonly lowConfidenceGrants: number | null;
  /** Wall-clock milliseconds the grade took, including the cache lookup. */
  readonly latencyMs: number;
  /** Model identifier when a model was called, else null. */
  readonly model: string | null;
  /** Provider-reported token usage when available. Cost reporting only. */
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  /** Cache key. A hash; never a transform an answer can be recovered from. */
  readonly cacheKey: string;
  /** Fraction of the answer's content words that echo the question. */
  readonly questionEcho: number;
  /** True when this verdict belongs in front of a human. */
  readonly needsReview: boolean;
}

export interface GradedVerdict {
  readonly kind: VerdictKind;
  readonly itemId: string;
  readonly itemVersion: string;
  readonly source: VerdictSource;
  /** Opaque server-side reference to the retained answer, or null. */
  readonly responseRef: string | null;
  readonly provenance: VerdictProvenance;
}

/** Exactly the keys @pa/duel's `VERDICT_ENVELOPE_KEYS` allows. */
export interface VerdictEnvelope {
  readonly kind: VerdictKind;
  readonly itemId: string;
  readonly itemVersion: string;
  readonly source: VerdictSource;
  readonly responseRef: string | null;
}

/**
 * The projection onto the duel's wire. Built by naming the five fields rather
 * than by spreading and deleting, so a field added to `GradedVerdict` cannot
 * leak into the envelope by omission.
 */
export function verdictEnvelope(verdict: GradedVerdict): VerdictEnvelope {
  return {
    kind: verdict.kind,
    itemId: verdict.itemId,
    itemVersion: verdict.itemVersion,
    source: verdict.source,
    responseRef: verdict.responseRef,
  };
}

// ---- the receipt ------------------------------------------------------------
//
// The remaining hole in "server-authoritative" is the relay. The server mints a
// verdict and hands it to a browser, the browser's reducer derives bullets from
// it, and the duel's verdicts — one per round, however many rounds it runs — are
// committed at the end of the attempt. A
// modified client can flip CORRECT onto a WRONG envelope in between, and no
// amount of care inside the duel package can see that, because by then the
// verdict looks exactly like one the server sent.
//
// So the server signs what it minted. The receipt is an HMAC over the envelope
// plus the identity of the round it was minted for, and whoever commits the duel
// result verifies it before the verdict counts. A flipped `kind` fails
// verification; so does a receipt lifted from another round, another attempt, or
// another student, because all three are inside the signed message.
//
// This is stateless on purpose. A server-side table of minted verdicts would be
// stronger still, but it needs a migration, and the migrations are another
// agent's territory this week. The HMAC gets the same property — the client
// cannot author a verdict — without one.

const RECEIPT_INFO = "project-archive:duel-verdict-receipt:v1";

export interface ReceiptBinding {
  /** Whose duel. Stops one student's receipt working for another. */
  readonly profileId: string;
  /** Which attempt. Stops a receipt surviving into a retry. */
  readonly attemptId: string;
  /** Which round. Stops a round-1 CORRECT being replayed at round 6. */
  readonly roundIndex: number;
}

function receiptMessage(
  envelope: VerdictEnvelope,
  binding: ReceiptBinding,
): string {
  // Field-separated with a byte that cannot occur in any of the parts, so no two
  // different bindings can produce the same message by concatenation.
  return [
    RECEIPT_INFO,
    binding.profileId,
    binding.attemptId,
    String(binding.roundIndex),
    envelope.itemId,
    envelope.itemVersion,
    envelope.kind,
    envelope.source,
    envelope.responseRef ?? "",
  ].join("\u0000");
}

export function mintVerdictReceipt(
  envelope: VerdictEnvelope,
  binding: ReceiptBinding,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(receiptMessage(envelope, binding))
    .digest("base64url");
}

/**
 * Verify a relayed verdict against its receipt. Called by whoever commits the
 * duel result — the verdict does not count until this returns true.
 */
export function verifyVerdictReceipt(
  envelope: VerdictEnvelope,
  binding: ReceiptBinding,
  receipt: string,
  secret: string,
): boolean {
  const expected = mintVerdictReceipt(envelope, binding, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(receipt, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
