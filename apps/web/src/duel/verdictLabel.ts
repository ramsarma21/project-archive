// What the verdict beat says, and how it reads — as data, so the one rule that is
// easy to get wrong is testable without a DOM.
//
// THE RULE THIS PINS: a round the grader never judged must NOT be shown as "Correct".
// When the classifier is unreachable — no credential, a dead gateway, or an overrun —
// the round is granted the maximum by design (Mission-Slate §1.7: a student is never
// punished for infrastructure), and the verdict's `kind` is a generous `CORRECT`.
// Labelling that "Correct" tells the player their WRONG answer was judged right, which
// is exactly the "I'm getting it wrong and still getting the right answer" the
// boss-fight owner reported when he played with no grading credential set. Every such
// verdict arrives sourced `GRADING_TIMEOUT` — the one wire word for "granted without a
// grade", whichever way the grade failed to happen — so that source, not the kind, is
// what decides whether a verdict may be reported as a judgement. The grant does not
// change; only what it is CALLED. A graded verdict (`source: CLASSIFIER`) reads
// "Correct"/"Wrong" exactly as before.

export type VerdictTone = "GRADED_CORRECT" | "GRADED_WRONG" | "UNGRADED" | "PENDING";

export function verdictBeatTone(
  verdict: { readonly kind: string; readonly source: string } | null | undefined,
): { tone: VerdictTone; label: string; cssModifier: string } {
  if (!verdict) return { tone: "PENDING", label: "Verdict in", cssModifier: "" };
  if (verdict.source === "GRADING_TIMEOUT") {
    return { tone: "UNGRADED", label: "Not graded", cssModifier: " is-ungraded" };
  }
  return verdict.kind === "CORRECT"
    ? { tone: "GRADED_CORRECT", label: "Correct", cssModifier: " is-correct" }
    : { tone: "GRADED_WRONG", label: "Wrong", cssModifier: " is-wrong" };
}
