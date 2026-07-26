// The review log.
//
// The generous fallback is only defensible if somebody looks at what it granted.
// "Grant three bullets on timeout" without a log is an unmonitored hole: a
// student who works out that a slow request is a free correct answer has found a
// cheat, and the only thing standing between that and a corrupted ranked ladder
// is that every grant of this kind is counted and attributable.
//
// Three things land here:
//
//   * TIMEOUT_GRANT — the 1.5-second cap fired on a real model call and the
//     maximum was granted. The rate is the health metric; a per-profile spike is
//     the abuse signal. THIS NAME NOW MEANS ONLY WHAT IT SAYS: it used to cover
//     every infrastructure fallback, so a gateway refusing a bad model name in
//     eight milliseconds was recorded here as a timeout, in the log that exists
//     to be the evidence for the grant.
//   * UNGRADED_GRANT — the maximum was granted and it was NOT a timeout: no
//     credential, a refused request, an unreachable gateway, malformed output, an
//     open breaker. `fallbackDiagnosis` says which, and unlike a timeout most of
//     these are somebody's configuration rather than a slow afternoon.
//   * LOW_CONFIDENCE — the classifier rated itself unreliable and the session
//     allowance granted the round anyway. These are the rubrics that need
//     rewording, and they are where the next false negative is going to come from.
//   * LOW_CONFIDENCE_LIMIT — the same, past the allowance: the grade stood as read
//     and the account is flagged. Two readings of one of these. Either a student is
//     farming the grader, or a rubric is so badly worded that an honest player trips
//     it three times in an hour. Both want a human, and the second is the more
//     likely, which is why the entry names the item and the rubric version.
//   * FALSE_NEGATIVE_RISK — the classifier marked an answer wrong while finding
//     some but not all required ideas. Under a binary that is correctly wrong,
//     and it is also exactly the shape of the mistake that costs a student a
//     ranked duel, so it is worth sampling by hand.
//
// ANSWER TEXT. Entries carry the answer's hash, not the answer. A reviewer needs
// the text to judge whether a grant was a real miss, so the sink accepts it and
// the default sink drops it: the encrypted-at-rest path for student writing in
// this repo is `apps/api/src/grading/envelopeEncryption.ts` writing to columns
// created by a migration, and migrations are another agent's territory this week.
// Until that lands, the honest position is that the log records the case, the
// item, the rubric version and the profile — enough to find the answer if it was
// retained elsewhere, and not itself a new place plaintext student writing
// accumulates.

import type {
  ClassifierConfidence,
  FallbackDiagnosis,
  FallbackReason,
  VerdictKind,
} from "./verdict.js";
import type { LowConfidenceOutcome } from "./lowConfidence.js";

export type ReviewReason =
  | "TIMEOUT_GRANT"
  | "UNGRADED_GRANT"
  | "LOW_CONFIDENCE"
  | "LOW_CONFIDENCE_LIMIT"
  | "FALSE_NEGATIVE_RISK";

/** Both of the grant-without-a-grade reasons, for a caller counting them. */
export const GRANT_WITHOUT_GRADE_REASONS: readonly ReviewReason[] = [
  "TIMEOUT_GRANT",
  "UNGRADED_GRANT",
];

export interface ReviewLogEntry {
  readonly reason: ReviewReason;
  readonly at: string;
  readonly profileId: string;
  readonly attemptId: string;
  readonly roundIndex: number;
  readonly itemId: string;
  readonly rubricVersion: string;
  readonly conceptId: string;
  readonly kind: VerdictKind;
  readonly fallbackReason: FallbackReason | null;
  /** The precise cause. Present whenever `fallbackReason` is. */
  readonly fallbackDiagnosis?: FallbackDiagnosis | null;
  /** The gateway's HTTP status, when it answered at all. */
  readonly fallbackStatus?: number | null;
  readonly confidence: ClassifierConfidence | null;
  readonly lowConfidenceOutcome?: LowConfidenceOutcome | null;
  readonly lowConfidenceGrants?: number | null;
  /** True once this profile has spent its low-confidence allowance. */
  readonly profileFlagged?: boolean;
  readonly ideasPresent: readonly string[];
  readonly ideasRequired: number;
  readonly ideasTotal: number;
  readonly latencyMs: number;
  /** Hash of the normalised answer. Correlates repeats; reveals no writing. */
  readonly answerHash: string;
  readonly answerLength: number;
  readonly questionEcho: number;
  /**
   * Present only when the caller both supplies it and opts in. The default sink
   * drops it; see the note at the top of this file.
   */
  readonly answerText?: string;
}

export interface ReviewLog {
  record(entry: ReviewLogEntry): void;
}

/** Keeps entries in memory. The eval harness and the tests read this. */
export class MemoryReviewLog implements ReviewLog {
  readonly entries: ReviewLogEntry[] = [];

  record(entry: ReviewLogEntry): void {
    this.entries.push(entry);
  }

  countOf(reason: ReviewReason): number {
    return this.entries.filter((entry) => entry.reason === reason).length;
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/**
 * One structured JSON line per entry, answer text stripped. Fastify's logger and
 * every log shipper in front of it read this without configuration, and the shape
 * is queryable: counting timeout grants per profile per day is a filter on two
 * fields.
 */
export class JsonLineReviewLog implements ReviewLog {
  constructor(private readonly write: (line: string) => void = console.warn) {}

  record(entry: ReviewLogEntry): void {
    const { answerText: _dropped, ...safe } = entry;
    this.write(JSON.stringify({ event: "grading.review", ...safe }));
  }
}

/** Fans one entry out to several sinks. */
export class MultiReviewLog implements ReviewLog {
  constructor(private readonly sinks: readonly ReviewLog[]) {}

  record(entry: ReviewLogEntry): void {
    for (const sink of this.sinks) sink.record(entry);
  }
}

/** Discards everything. The default when a caller supplies no log. */
export class NullReviewLog implements ReviewLog {
  record(): void {}
}
