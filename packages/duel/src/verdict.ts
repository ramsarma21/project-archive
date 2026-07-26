// The verdict is the committed event, and it is the only thing the bullet
// economy is allowed to read.
//
// A DUEL VERDICT IS BINARY. Correct grants 3 bullets, wrong grants 1, and there
// is no third state. This is a decided matter of principle, not a policy with a
// flag, so there is deliberately nothing here to configure:
//
//   - A half-right answer worth exactly as much as a right one breaks the
//     knowledge-to-resources premise the whole duel rests on, and rounding it
//     down instead would only relocate the unfairness.
//   - Forcing the rubric author to draw the line explicitly is better than the
//     system silently rounding either way.
//   - A three-valued STRONG/PARTIAL/MISSING taxonomy is inherited from the
//     deleted formative design. A rubric may keep richer internal labels for
//     teacher reporting; what the duel consumes is a binary, and the wire
//     boundary below refuses anything else by name.
//
// Two further rules from the brief are made structural rather than merely
// checked:
//
//   1. A bullet count never crosses the wire. There is no field anywhere in
//      CommittedVerdict, in the command union (machine.ts), or in the wire
//      envelope that can carry one. A forged verdict is still only a verdict,
//      and the reducer derives 3 or 1 from it (bullets.ts).
//   2. Raw answer text never enters the event log. `mintVerdict` has no
//      parameter for it — the grading authority holds the text, classifies it,
//      and hands the duel a binary plus an opaque server-side reference.
//
// Verdicts are branded so an ordinary object literal cannot pass for one. That
// does not stop a determined cast; it stops an accident, and it documents at
// every call site that a verdict has an authority behind it.

export type VerdictKind = "CORRECT" | "WRONG";

export const VERDICT_KINDS: readonly VerdictKind[] = ["CORRECT", "WRONG"];

/**
 * Where a verdict came from. All four are authority-side; none of them is the
 * client. GRADING_TIMEOUT exists because Mission-Slate §1.7 fixes a hard
 * 1.5-second cap: a slow classifier grants the maximum and logs for review,
 * because a player is never punished for infrastructure.
 */
export type VerdictSource =
  | "CLASSIFIER"
  | "GRADING_TIMEOUT"
  | "ABSTAINED"
  | "OPPONENT_AUTHORITY";

declare const VERDICT_BRAND: unique symbol;

export interface CommittedVerdict {
  readonly [VERDICT_BRAND]: "MINTED_BY_GRADING_AUTHORITY";
  readonly kind: VerdictKind;
  /** The authored item that was asked. Content identity, not content. */
  readonly itemId: string;
  readonly itemVersion: string;
  readonly source: VerdictSource;
  /**
   * Opaque reference to the encrypted server-side response record
   * (OpenResponseReference.responseId), or null when nothing was submitted.
   * Never the text, never a transform of the text.
   */
  readonly responseRef: string | null;
}

/**
 * Sources that fix the verdict regardless of what the caller passes. These are
 * the only derivations left in the duel now that the grading authority hands over
 * a binary: a timeout grants the maximum, and an abstention is wrong.
 */
const SOURCE_FIXED_KIND: Partial<Record<VerdictSource, VerdictKind>> = {
  GRADING_TIMEOUT: "CORRECT",
  ABSTAINED: "WRONG",
};

export interface MintVerdictInput {
  readonly kind: VerdictKind;
  readonly itemId: string;
  readonly itemVersion: string;
  readonly source: VerdictSource;
  readonly responseRef?: string | null;
}

/**
 * The grading authority's only constructor. Note what is absent: no answer text
 * parameter, and no bullet parameter.
 */
export function mintVerdict(input: MintVerdictInput): CommittedVerdict {
  return {
    kind: SOURCE_FIXED_KIND[input.source] ?? input.kind,
    itemId: input.itemId,
    itemVersion: input.itemVersion,
    source: input.source,
    responseRef: input.responseRef ?? null,
  } as CommittedVerdict;
}

/** The 1.5-second grading cap, as a verdict. Grants the maximum, logs for review. */
export function mintTimeoutVerdict(
  itemId: string,
  itemVersion: string,
  responseRef: string | null = null,
): CommittedVerdict {
  return mintVerdict({
    kind: "CORRECT",
    itemId,
    itemVersion,
    source: "GRADING_TIMEOUT",
    responseRef,
  });
}

/** Verdicts minted under a timeout are the ones a human should look at later. */
export function verdictNeedsGradingReview(verdict: CommittedVerdict): boolean {
  return verdict.source === "GRADING_TIMEOUT";
}

// ---- the wire boundary -----------------------------------------------------

/**
 * The shape a verdict is allowed to have when it arrives as JSON — from the
 * grading service, or relayed from a PvP opponent's authority. Every other key
 * is rejected rather than ignored, which is what stops a client from smuggling
 * `bullets`, `ammo` or `answerText` through a field the duel happens not to read.
 */
export const VERDICT_ENVELOPE_KEYS = [
  "kind",
  "itemId",
  "itemVersion",
  "source",
  "responseRef",
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
  | { readonly ok: true; readonly verdict: CommittedVerdict }
  | {
      readonly ok: false;
      readonly code: VerdictRejectionCode;
      readonly detail: string;
    };

const VERDICT_SOURCES: readonly VerdictSource[] = [
  "CLASSIFIER",
  "GRADING_TIMEOUT",
  "ABSTAINED",
  "OPPONENT_AUTHORITY",
];

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
    if (!(key in record)) return { ok: false, code: "MISSING_FIELD", detail: key };
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
  const kind = record["kind"] as string;
  if (!(VERDICT_KINDS as readonly string[]).includes(kind)) {
    // Named separately from a generic bad value because this is the one a grading
    // service is most likely to get wrong: a duel verdict has no partial state,
    // and a rubric's richer internal labels must be projected before they arrive.
    return { ok: false, code: "NON_BINARY_VERDICT", detail: kind };
  }
  const source = record["source"] as string;
  if (!(VERDICT_SOURCES as readonly string[]).includes(source)) {
    return { ok: false, code: "UNKNOWN_SOURCE", detail: source };
  }
  const fixed = SOURCE_FIXED_KIND[source as VerdictSource];
  if (fixed !== undefined && fixed !== kind) {
    // A timeout that claims to be wrong, or an abstention that claims to be
    // correct, means the sender is running a different rule. That is a defect
    // worth surfacing rather than silently overriding.
    return {
      ok: false,
      code: "KIND_CONTRADICTS_SOURCE",
      detail: `${kind} for ${source}`,
    };
  }
  return {
    ok: true,
    verdict: mintVerdict({
      kind: kind as VerdictKind,
      itemId: record["itemId"] as string,
      itemVersion: record["itemVersion"] as string,
      source: source as VerdictSource,
      responseRef: (responseRef as string | null | undefined) ?? null,
    }),
  };
}

/** Serialisable projection of a verdict, for the event log and the wire. */
export function verdictEnvelope(
  verdict: CommittedVerdict,
): Record<(typeof VERDICT_ENVELOPE_KEYS)[number], string | null> {
  return {
    kind: verdict.kind,
    itemId: verdict.itemId,
    itemVersion: verdict.itemVersion,
    source: verdict.source,
    responseRef: verdict.responseRef,
  };
}
