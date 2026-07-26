// The grading authority port.
//
// STATUS: RECONCILED against `@pa/grading`, which exists. This file stays as the
// engine's own currency and `gradingAdapter.ts` is the translation, because the two
// vocabularies genuinely differ and the difference is a policy decision rather
// than a naming accident — see the argued mapping there. The shapes mirror
// `packages/duel/src/verdict.ts` for the same reason grading's do: a duel verdict
// and a capstone verdict come out of one service, both binary, both minted
// server-side, both carrying an opaque reference instead of answer text.
//
// ONE GAP REMAINS AND IT IS GRADING'S TO FILL: there is no selected-response path.
// `GradingService.grade` takes `answer: string` and routes everything to the
// classifier, so it grades prose and nothing else. Most of a capstone form is
// multiple choice, and the answer key for it cannot live in this package (see
// below) — so `keyOnlyGradingAuthority` is still the stand-in for that half, and
// still marked for deletion.
//
// THIS PACKAGE CANNOT GRADE, AND THE REASON IS STRUCTURAL RATHER THAN A RULE
// SOMEBODY MIGHT FORGET.
//
// The obvious version of a multiple-choice capstone compares a submitted option
// id against the item's `correctOptionId` and needs no service at all. That is
// exactly what this package refuses to be able to do:
//
//   1. `AssessmentItemDescriptor` in items.ts has no answer-key field. Not an
//      optional one, not a private one — there is no key anywhere in this
//      package's types, so there is no code path here that could decide
//      correctness, and no bundle built from this package can leak a key to a
//      student who opens devtools.
//   2. Selected-response and open-response therefore take the same route. The
//      authority answers both; it just answers the first from a key table and
//      the second from a classifier against a pre-authored rubric.
//   3. `AssessmentVerdict` is branded and its only constructor is
//      `mintAssessmentVerdict`. A verdict arriving as JSON goes through
//      `parseVerdictEnvelope`, which rejects unknown keys by name rather than
//      ignoring them, so a client cannot smuggle `correct: true` through a field
//      the engine happens not to read.
//
// The capstone is the assessment of record. A student who can grant themselves a
// verdict can unlock the next chapter and mint PvP-legal cards without learning
// anything, which is the one failure that would make the educational claim false
// rather than merely optimistic.

/** Binary, exactly as in the duel. There is no partial credit anywhere. */
export type AssessmentVerdictKind = "CORRECT" | "INCORRECT";

export const ASSESSMENT_VERDICT_KINDS: readonly AssessmentVerdictKind[] = [
  "CORRECT",
  "INCORRECT",
];

/**
 * Where a verdict came from. Every one of these is authority-side; none is the
 * client.
 *
 * ANSWER_KEY      — a selected-response item matched against the authority's
 *                   key table. Deterministic and replayable.
 * CLASSIFIER      — an open-response item classified against a pre-authored
 *                   rubric. The model picks a bucket; it never writes the
 *                   question and never invents an acceptable answer.
 * RUBRIC_EXACT    — an open response matched an authored acceptable answer
 *                   without needing the model at all.
 * UNANSWERED      — the form was submitted with this item left blank. Wrong,
 *                   because skipping must never be cheaper than answering.
 * HUMAN_REVIEW    — a teacher or scorer overrode a verdict after the fact. The
 *                   override is a new committed event, never an edit.
 *
 * Note what is missing relative to the duel: `GRADING_TIMEOUT`. The duel grants
 * the maximum on a slow classifier because a player must never be punished for
 * infrastructure inside a 20-second round. The capstone has no such clock, and a
 * timeout that granted CORRECT here would hand out mastery, a chapter unlock and
 * a PvP-legal card for a response nobody graded. A slow grade on the capstone
 * waits; see `GradingUnavailable`.
 */
export type AssessmentVerdictSource =
  | "ANSWER_KEY"
  | "CLASSIFIER"
  | "RUBRIC_EXACT"
  | "UNANSWERED"
  | "HUMAN_REVIEW";

const ASSESSMENT_VERDICT_SOURCES: readonly AssessmentVerdictSource[] = [
  "ANSWER_KEY",
  "CLASSIFIER",
  "RUBRIC_EXACT",
  "UNANSWERED",
  "HUMAN_REVIEW",
];

/** Sources whose verdict is fixed regardless of what the caller passes. */
const SOURCE_FIXED_KIND: Partial<
  Record<AssessmentVerdictSource, AssessmentVerdictKind>
> = {
  UNANSWERED: "INCORRECT",
};

declare const VERDICT_BRAND: unique symbol;

export interface AssessmentVerdict {
  readonly [VERDICT_BRAND]: "MINTED_BY_GRADING_AUTHORITY";
  readonly kind: AssessmentVerdictKind;
  /** Content identity of what was asked, never the content. */
  readonly itemId: string;
  readonly itemVersion: string;
  readonly source: AssessmentVerdictSource;
  /**
   * Opaque handle on the encrypted server-side response record — the
   * `responseId` of contracts' `OpenResponseReference`. Never the text and never
   * a transform of the text. Null when nothing was submitted.
   */
  readonly responseRef: string | null;
  /**
   * True when a human should look at this verdict before it is reported. Set by
   * the authority for a low-confidence classification. It does not change the
   * verdict — an assessment that quietly withheld a grade pending review would
   * block the chapter on a queue — it flags it.
   */
  readonly needsReview: boolean;
}

export interface MintAssessmentVerdictInput {
  readonly kind: AssessmentVerdictKind;
  readonly itemId: string;
  readonly itemVersion: string;
  readonly source: AssessmentVerdictSource;
  readonly responseRef?: string | null;
  readonly needsReview?: boolean;
}

/**
 * The grading authority's only constructor. Note the absent parameters: no
 * answer text, no option key, and no score.
 */
export function mintAssessmentVerdict(
  input: MintAssessmentVerdictInput,
): AssessmentVerdict {
  return {
    kind: SOURCE_FIXED_KIND[input.source] ?? input.kind,
    itemId: input.itemId,
    itemVersion: input.itemVersion,
    source: input.source,
    responseRef: input.responseRef ?? null,
    needsReview: input.needsReview ?? false,
  } as AssessmentVerdict;
}

/** An item left blank at submission. Wrong, and recorded as such. */
export function mintUnansweredVerdict(
  itemId: string,
  itemVersion: string,
): AssessmentVerdict {
  return mintAssessmentVerdict({
    kind: "INCORRECT",
    itemId,
    itemVersion,
    source: "UNANSWERED",
  });
}

export function verdictIsCorrect(verdict: AssessmentVerdict): boolean {
  return verdict.kind === "CORRECT";
}

// ---------------------------------------------------------------------------
// What the authority is asked
// ---------------------------------------------------------------------------

/**
 * A selected-response submission. The option id is the student's own answer and
 * is committed to the log, because which distractor a student chose is the most
 * useful diagnostic the capstone produces. It is not a secret; the key is.
 */
export interface SelectedResponseSubmission {
  readonly kind: "SELECTED_RESPONSE";
  readonly itemId: string;
  readonly itemVersion: string;
  readonly selectedOptionId: string;
}

/**
 * An open-response submission. The text is NOT here: the client submits it to
 * the grading service directly, the service stores it encrypted, and this engine
 * is handed only the `responseRef`. There is therefore no point in the capstone
 * pipeline at which raw student prose is in this package's memory.
 */
export interface OpenResponseSubmission {
  readonly kind: "OPEN_RESPONSE";
  readonly itemId: string;
  readonly itemVersion: string;
  readonly responseRef: string;
}

export type ItemSubmission =
  | SelectedResponseSubmission
  | OpenResponseSubmission;

export type GradingFailureCode =
  /** The authority holds no key or rubric for this item. A content defect. */
  | "NO_KEY_FOR_ITEM"
  /** The classifier could not be reached or did not answer in time. */
  | "GRADER_UNAVAILABLE"
  /** The submission names an option the item does not offer. */
  | "UNKNOWN_OPTION";

/**
 * Grading did not produce a verdict.
 *
 * The engine's response is to leave the item ungraded and refuse to submit the
 * form, never to guess. A capstone that inferred a verdict when the grader was
 * down would be inventing the assessment of record.
 */
export interface GradingUnavailable {
  readonly ok: false;
  readonly code: GradingFailureCode;
  readonly detail: string;
}

export type GradingResult =
  | { readonly ok: true; readonly verdict: AssessmentVerdict }
  | GradingUnavailable;

/**
 * The service `packages/grading` must provide.
 *
 * Async on purpose even for selected response, so that the key table can live
 * behind a network boundary rather than in any client bundle.
 */
export interface GradingAuthority {
  grade(submission: ItemSubmission): Promise<GradingResult>;
}

// ---------------------------------------------------------------------------
// The wire boundary
// ---------------------------------------------------------------------------

/**
 * The only keys a verdict may carry when it arrives as JSON. Anything else is
 * rejected by name rather than ignored, which is what stops a client from
 * smuggling `correct`, `score`, `mastered` or `pvpLegal` through a field the
 * engine happens not to read.
 */
export const VERDICT_ENVELOPE_KEYS = [
  "kind",
  "itemId",
  "itemVersion",
  "source",
  "responseRef",
  "needsReview",
] as const;

export type VerdictRejectionCode =
  | "NOT_AN_OBJECT"
  | "UNKNOWN_FIELD"
  | "MISSING_FIELD"
  | "BAD_FIELD_TYPE"
  | "NON_BINARY_VERDICT"
  | "UNKNOWN_SOURCE"
  | "KIND_CONTRADICTS_SOURCE";

export type VerdictParseResult =
  | { readonly ok: true; readonly verdict: AssessmentVerdict }
  | {
      readonly ok: false;
      readonly code: VerdictRejectionCode;
      readonly detail: string;
    };

export function parseVerdictEnvelope(input: unknown): VerdictParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, code: "NOT_AN_OBJECT", detail: typeof input };
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set<string>(VERDICT_ENVELOPE_KEYS);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return { ok: false, code: "UNKNOWN_FIELD", detail: key };
    }
  }
  for (const key of ["kind", "itemId", "itemVersion", "source"]) {
    if (!(key in record)) {
      return { ok: false, code: "MISSING_FIELD", detail: key };
    }
    if (typeof record[key] !== "string") {
      return { ok: false, code: "BAD_FIELD_TYPE", detail: key };
    }
  }
  const responseRef = record["responseRef"];
  if (
    responseRef !== undefined &&
    responseRef !== null &&
    typeof responseRef !== "string"
  ) {
    return { ok: false, code: "BAD_FIELD_TYPE", detail: "responseRef" };
  }
  const needsReview = record["needsReview"];
  if (needsReview !== undefined && typeof needsReview !== "boolean") {
    return { ok: false, code: "BAD_FIELD_TYPE", detail: "needsReview" };
  }
  const kind = record["kind"] as string;
  if (!(ASSESSMENT_VERDICT_KINDS as readonly string[]).includes(kind)) {
    // Named separately because it is the mistake a grading service is most
    // likely to make: a rubric may keep STRONG/PARTIAL/MISSING labels
    // internally for teacher feedback, but the capstone consumes a binary and
    // the projection has to happen before the boundary, explicitly.
    return { ok: false, code: "NON_BINARY_VERDICT", detail: kind };
  }
  const source = record["source"] as string;
  if (!(ASSESSMENT_VERDICT_SOURCES as readonly string[]).includes(source)) {
    return { ok: false, code: "UNKNOWN_SOURCE", detail: source };
  }
  const fixed = SOURCE_FIXED_KIND[source as AssessmentVerdictSource];
  if (fixed !== undefined && fixed !== kind) {
    return {
      ok: false,
      code: "KIND_CONTRADICTS_SOURCE",
      detail: `${kind} for ${source}`,
    };
  }
  return {
    ok: true,
    verdict: mintAssessmentVerdict({
      kind: kind as AssessmentVerdictKind,
      itemId: record["itemId"] as string,
      itemVersion: record["itemVersion"] as string,
      source: source as AssessmentVerdictSource,
      responseRef: (responseRef as string | null | undefined) ?? null,
      needsReview: (needsReview as boolean | undefined) ?? false,
    }),
  };
}

/** Serialisable projection, for the event log and the wire. */
export function verdictEnvelope(verdict: AssessmentVerdict): {
  kind: AssessmentVerdictKind;
  itemId: string;
  itemVersion: string;
  source: AssessmentVerdictSource;
  responseRef: string | null;
  needsReview: boolean;
} {
  return {
    kind: verdict.kind,
    itemId: verdict.itemId,
    itemVersion: verdict.itemVersion,
    source: verdict.source,
    responseRef: verdict.responseRef,
    needsReview: verdict.needsReview,
  };
}

// ---------------------------------------------------------------------------
// A stand-in authority, for tests and for local development only
// ---------------------------------------------------------------------------

/**
 * DELETE WITH UPSTREAM: replace with the real `packages/grading` client.
 *
 * A key-table authority. It grades selected response from an explicit key map
 * and refuses open response outright, because classifying prose is the part this
 * package must never contain even in a stub. The key map is a constructor
 * argument rather than item data, which keeps the "no key in an item descriptor"
 * rule true even in the fixture.
 */
export function keyOnlyGradingAuthority(
  answerKey: ReadonlyMap<string, string>,
): GradingAuthority {
  return {
    async grade(submission: ItemSubmission): Promise<GradingResult> {
      if (submission.kind === "OPEN_RESPONSE") {
        return {
          ok: false,
          code: "NO_KEY_FOR_ITEM",
          detail:
            "open response requires the classifier in packages/grading; this " +
            "stand-in deliberately cannot grade prose",
        };
      }
      const expected = answerKey.get(submission.itemId);
      if (expected === undefined) {
        return {
          ok: false,
          code: "NO_KEY_FOR_ITEM",
          detail: submission.itemId,
        };
      }
      return {
        ok: true,
        verdict: mintAssessmentVerdict({
          kind:
            submission.selectedOptionId === expected ? "CORRECT" : "INCORRECT",
          itemId: submission.itemId,
          itemVersion: submission.itemVersion,
          source: "ANSWER_KEY",
        }),
      };
    },
  };
}
