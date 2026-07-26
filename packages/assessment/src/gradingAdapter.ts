// The reconciliation with @pa/grading, which exists.
//
// The verdict shape is mirrored STRUCTURALLY below rather than imported, and there
// are two reasons, one of them temporary:
//
//   * Permanent: grading is a server module — `node:crypto`, `fetch`,
//     `AbortController`, `process.env` — and @pa/assessment runs in a browser too.
//     Even `import type` makes tsc pull the whole imported module graph into this
//     package's compile, which would force node and DOM libs into a package that
//     needs neither.
//   * Temporary: `@pa/grading` does not currently typecheck. Its barrel re-exports
//     `M1_POOLS` from `./items/m1.js`, which does not export it, so
//     `pnpm -r typecheck` is red on that one line today. Reported, not worked
//     around — it is a one-line fix in a file this agent does not own.
//
// A structural mirror is only as good as its verification, so
// `gradingReconciliation.test.ts` runs a REAL `GradingService` — real fallback
// paths, real classification path — through this adapter, which is stronger
// evidence than a type assertion against a copied interface.
//
// ============================================================================
// WHAT GRADING BUILT, AND THE ONE PLACE IT IS WRONG FOR AN ASSESSMENT
// ============================================================================
//
// Grading is a duel grader, and a good one. Authored rubrics with an explicit
// `needs` line so the author draws the binary rather than the model guessing it,
// a content-hash rubric version so a stale verdict is structurally unreachable, a
// verdict cache keyed on the normalised answer, held-out eval examples that are
// never prompted, and an HMAC receipt so a modified client cannot flip a CORRECT
// onto a WRONG envelope on the way through. All of that is reusable here as-is.
//
// One policy is not. `GradingService.grade` returns
// `finish("CORRECT", "GRADING_TIMEOUT", …)` on all five infrastructure failure
// paths — TIMEOUT, PROVIDER_ERROR, MALFORMED_OUTPUT, CIRCUIT_OPEN,
// NOT_CONFIGURED — and there is no parameter anywhere in `GradingServiceOptions`
// or `GradeRequest` through which a caller can ask for anything else.
//
// For the duel that is right, and the reasoning is sound: a player must not stand
// still in a gunfight waiting on an API, a student cannot cause an outage on
// demand, so granting the maximum is safe and the review log catches the pattern.
//
// For the capstone the identical behaviour hands out concept mastery, a chapter
// unlock, and a permanent PvP-legal Codex card for a response nobody graded. Same
// mechanism, opposite correctness, and the reason is the stake: the duel is
// spending bullets in one round of a game, this is writing the accountability
// record. There is also no clock here to protect the student from — the
// alternative to granting is not "the student is punished", it is "the student
// waits, or a human reads it".
//
// So this adapter REFUSES A GENEROUS GRANT rather than consuming one. A verdict
// carrying a `fallbackReason` becomes `GRADER_UNAVAILABLE`, the engine records the
// response with no verdict, and `submitAttempt` refuses with UNGRADED_RESPONSES
// until the item is graded for real.
//
// Doing it on this side is deliberate. It makes the correct behaviour true today,
// without waiting on a change in a package another agent owns, and it stays
// correct afterwards: even once grading grows a policy parameter, an assessment
// cannot be handed a timeout grant that counts. When that parameter lands, this
// file loses the `fallbackReason` branch and nothing else.
//
// ONE THING THIS DEPENDS ON, which is worth stating because it is not optional
// here the way it is for the duel. Deferring a grade only works if the answer
// survives long enough to be graded later, so `AnswerRetention.retain()` must
// have run BEFORE grading is called, and the `responseRef` it returns is what
// makes the deferred grade possible. A duel can treat retention as optional
// because a timeout resolves the round immediately and there is nothing to come
// back to. An assessment cannot.

import {
  mintAssessmentVerdict,
  type GradingAuthority,
  type GradingResult,
  type ItemSubmission,
} from "./grading.js";

/**
 * Grading's `GradedVerdict`, mirrored to the fields this adapter reads.
 *
 * A deliberate subset: grading's provenance also carries `poolId`, `ideasTotal`,
 * `model`, token counts, `cacheKey` and `questionEcho`, which are its cost and
 * cache concerns rather than this engine's. TypeScript is structural, so a real
 * `GradedVerdict` satisfies this without either side knowing about the other.
 */
export interface GradedVerdictLike {
  readonly kind: "CORRECT" | "WRONG";
  readonly itemId: string;
  readonly itemVersion: string;
  /** @pa/duel's source vocabulary, verbatim, because grading must satisfy it. */
  readonly source:
    | "CLASSIFIER"
    | "GRADING_TIMEOUT"
    | "ABSTAINED"
    | "OPPONENT_AUTHORITY";
  readonly responseRef: string | null;
  readonly provenance: {
    readonly path: "CACHE" | "MODEL" | "FALLBACK" | "PRE_CHECK";
    readonly rubricVersion: string;
    readonly conceptId: string;
    readonly ideasPresent: readonly string[];
    readonly ideasRequired: number;
    readonly confidence: "LOW" | "MEDIUM" | "HIGH" | null;
    /** Non-null means an infrastructure fallback fired and the grade is a grant. */
    readonly fallbackReason:
      | "TIMEOUT"
      | "PROVIDER_ERROR"
      | "MALFORMED_OUTPUT"
      | "CIRCUIT_OPEN"
      | "NOT_CONFIGURED"
      | null;
    readonly latencyMs: number;
    readonly needsReview: boolean;
  };
}

/**
 * Settled: the capstone does not consume a generous grant.
 *
 * Named rather than implicit so the alternative is visible, and so a reviewer can
 * find the one line that would have to change to reintroduce the duel's policy.
 */
export const ASSESSMENT_CONSUMES_TIMEOUT_GRANTS = false;

/**
 * Settled: a LOW-confidence classification stands as graded.
 *
 * Grading's current behaviour, and it is right for the capstone. The owner's newer
 * duel ruling — grant on low confidence, then rate-limit per player per session —
 * must NOT reach here, for three reasons that are independent of each other:
 *
 *   1. A rate limit bounds the RATE of an exploit whose EFFECT is permanent.
 *      Mastery is sticky in the reducer and mints a Codex card that never
 *      expires, so even a tight limit still mints unearned permanent standing;
 *      it just mints it more slowly. In the duel the payoff is three bullets in
 *      one twenty-second round, which the limit genuinely bounds.
 *   2. There is no clock here, so the generosity has nothing to buy. The duel
 *      grants because the alternative is a player frozen mid-gunfight. The
 *      alternative here is a queue.
 *   3. A rate limit is per-session mutable state, and a verdict that depended on
 *      how many grants a student had already spent this session could not be
 *      reproduced from the committed log. That would put hidden state inside the
 *      one record that has to be exactly replayable.
 *
 * The goal the ruling is chasing — a genuinely odd correct answer still earns
 * credit — is met here by a better mechanism: the verdict stands, `needsReview`
 * carries it to a human, and a `VERDICT_OVERRIDDEN` event repairs it. A person
 * reads the answer, which is more accurate than granting on principle, and on
 * attempt 1 the correction moves the reported score.
 */
export const ASSESSMENT_GRANTS_ON_LOW_CONFIDENCE = false;

/**
 * Grading's own fallback reasons, restated so this file can name them in a
 * rejection detail without importing a value from the package.
 */
export type GradingFallbackReason = NonNullable<
  GradedVerdictLike["provenance"]["fallbackReason"]
>;

/**
 * Translate one of grading's verdicts into this engine's currency, applying the
 * assessment's policy.
 *
 * The vocabularies differ because grading's `source` is @pa/duel's, verbatim, and
 * @pa/duel refuses an unknown source by name. The mapping:
 *
 * | grading           | assessment       | why                                  |
 * |-------------------|------------------|--------------------------------------|
 * | CLASSIFIER        | CLASSIFIER       | same thing                           |
 * | ABSTAINED         | UNANSWERED       | same thing, different word; both wrong |
 * | GRADING_TIMEOUT   | *refused*        | the policy split above               |
 * | OPPONENT_AUTHORITY| *refused*        | PvP relay; meaningless on a capstone  |
 *
 * A cached verdict is accepted. Grading only writes the cache on the successful
 * model path — a fallback grant returns without caching — so a generous grant
 * cannot re-enter later wearing a clean CLASSIFIER source. That is a real safety
 * property of grading's design and this adapter relies on it.
 */
export function adaptGradedVerdict(graded: GradedVerdictLike): GradingResult {
  const fallbackReason = graded.provenance.fallbackReason;

  // Checked before the source switch, and both are checked rather than just one,
  // because these two should always agree and an assessment is the wrong place to
  // trust that they do.
  if (fallbackReason !== null || graded.source === "GRADING_TIMEOUT") {
    return {
      ok: false,
      code: "GRADER_UNAVAILABLE",
      detail:
        `grading fell back (${fallbackReason ?? "unspecified"}); the capstone ` +
        `does not consume a generous grant — the item stays ungraded`,
    };
  }

  switch (graded.source) {
    case "CLASSIFIER":
      return {
        ok: true,
        verdict: mintAssessmentVerdict({
          kind: graded.kind === "CORRECT" ? "CORRECT" : "INCORRECT",
          itemId: graded.itemId,
          itemVersion: graded.itemVersion,
          source: "CLASSIFIER",
          responseRef: graded.responseRef,
          // Carries LOW confidence and the false-negative shape grading already
          // detects. It flags; it does not withhold.
          needsReview: graded.provenance.needsReview,
        }),
      };
    case "ABSTAINED":
      return {
        ok: true,
        verdict: mintAssessmentVerdict({
          // `mintAssessmentVerdict` fixes UNANSWERED to INCORRECT regardless of
          // what is passed, so this cannot be talked out of being wrong.
          kind: "INCORRECT",
          itemId: graded.itemId,
          itemVersion: graded.itemVersion,
          source: "UNANSWERED",
          responseRef: graded.responseRef,
          needsReview: graded.provenance.needsReview,
        }),
      };
    default:
      return {
        ok: false,
        code: "GRADER_UNAVAILABLE",
        detail: `source ${graded.source} is not an assessment authority`,
      };
  }
}

/**
 * What the API route must supply: a function that grades one submission and
 * returns grading's verdict.
 *
 * The route implements it, because it is the only layer that holds all three
 * pieces — the retained answer text, grading's `GradingService`, and the item
 * version. This engine never sees the text.
 *
 * Deliberately NOT typed as grading's `GradeRequest`. That shape requires
 * `roundIndex: number`, which is duel geometry: a capstone form is sixty-four
 * items, not six rounds, and `parseGradeAnswerRequest` range-checks the field to
 * 0..5 so grading's own HTTP boundary would reject an assessment outright. Rather
 * than smuggle an item ordinal through a field named for something else, the
 * shape stops at this seam and the mismatch is reported for grading to fix.
 */
export interface GradedVerdictSource {
  grade(submission: ItemSubmission): Promise<GradedVerdictLike>;
}

/**
 * Wrap grading as a `GradingAuthority` this engine can use.
 *
 * Every policy decision is in `adaptGradedVerdict`, so there is one place to read
 * and one place to change when grading grows its policy parameter.
 */
export function assessmentGradingAuthority(
  source: GradedVerdictSource,
): GradingAuthority {
  return {
    async grade(submission: ItemSubmission): Promise<GradingResult> {
      let graded: GradedVerdictLike;
      try {
        graded = await source.grade(submission);
      } catch (error) {
        // An UnknownItemError from grading means the item is not in its authored
        // bank, which is a content defect rather than an outage.
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          code: message.includes("no authored item")
            ? "NO_KEY_FOR_ITEM"
            : "GRADER_UNAVAILABLE",
          detail: message,
        };
      }
      if (graded.itemId !== submission.itemId) {
        // The authority graded something other than what was asked. Refused
        // rather than recorded: a verdict attached to the wrong item would score
        // the wrong concept.
        return {
          ok: false,
          code: "GRADER_UNAVAILABLE",
          detail: `asked for ${submission.itemId}, got ${graded.itemId}`,
        };
      }
      return adaptGradedVerdict(graded);
    },
  };
}

/**
 * True when a verdict was minted by a real grade rather than a fallback.
 *
 * Exposed so the API route can log the refusal rate: a capstone sitting where a
 * quarter of the items came back ungraded is an operational problem, and it is
 * invisible if the only signal is that submission failed.
 */
export function verdictWasActuallyGraded(graded: GradedVerdictLike): boolean {
  return (
    graded.provenance.fallbackReason === null &&
    graded.source !== "GRADING_TIMEOUT"
  );
}

/**
 * A projection of grading's provenance worth keeping beside a capstone verdict.
 *
 * Not committed to the event log — the log holds the binary and the opaque
 * response handle, and nothing that could reconstruct an answer. This is for the
 * review queue and the cost report, which are server-side surfaces.
 */
export interface AssessmentGradingProvenance {
  readonly itemId: string;
  readonly rubricVersion: string;
  readonly conceptId: string;
  readonly path: GradedVerdictLike["provenance"]["path"];
  readonly confidence: GradedVerdictLike["provenance"]["confidence"];
  readonly ideasPresent: readonly string[];
  readonly ideasRequired: number;
  readonly latencyMs: number;
  readonly needsReview: boolean;
}

export function assessmentGradingProvenance(
  graded: GradedVerdictLike,
): AssessmentGradingProvenance {
  const provenance = graded.provenance;
  return {
    itemId: graded.itemId,
    rubricVersion: provenance.rubricVersion,
    conceptId: provenance.conceptId,
    path: provenance.path,
    confidence: provenance.confidence,
    ideasPresent: provenance.ideasPresent,
    ideasRequired: provenance.ideasRequired,
    latencyMs: provenance.latencyMs,
    needsReview: provenance.needsReview,
  };
}
