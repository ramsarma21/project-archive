// The runtime prose half, and how the two halves combine.
//
// THE OWNER'S ARCHITECTURE: the card half is checked deterministically against the
// bound cards (that logic is the PvP authority's, and already exists as the relevant-
// set check); the prose half is "a short comparison" against the reference, smaller
// than today's full-rubric judgement. This file is the in-lane part of that: the
// deterministic fast-accept tier, and the pure function that folds the two half-
// results into a verdict plus a teaching signal.
//
// HOW THE PROSE HALF STAYS GENEROUS WITHOUT A FULL RUBRIC — the recommendation, with
// the false-negative reasoning, because FN is gated at 0.00% and is the whole risk:
//
//   A single reference string, compared literally, is a false-negative machine: it
//   would reject "an almanac and a marriage licence" for NAME_TWO because the string
//   is different, even though the answer is right. So the comparison is NOT against a
//   string. It is a two-tier check whose basis is the compact REQUIRED CORE — the
//   same representation today's grader already gets FN 0.00% on:
//
//     TIER 1  deterministic fast-ACCEPT. If the answer strongly matches one of the
//             held-out accept phrasings, grant immediately: no model, replayable,
//             zero latency. This tier can ONLY accept — a miss escalates — so it can
//             never introduce a false negative. It exists to make the common case
//             free and deterministic (which the hashed-replay/PvP world wants).
//     TIER 2  model COMPARISON on escalation. "Does this answer carry the required
//             core, given this reference?" — reporting core-element presence, exactly
//             as the shipped grader does. This is a genuinely easier task than open
//             rubric judgement at the same token cost, so it is a reliability gain,
//             not a regression, and it is where the generosity lives (paraphrase,
//             example, fragment all pass because the core is stated as meaning).
//
// So "compare against a reference" is honoured — the comparison basis is the
// reference's required elements, not its wording — and generosity is preserved
// because the basis is the thing that already generalises. Generating SEVERAL
// reference phrasings offline (candidate #1) feeds Tier 1; the required-core
// elements (candidate #2) are Tier 2; the model-comparison framing (candidate #3)
// is Tier 2's task; the two tiers together are the escalation design (candidate #4).
// All four of the briefed candidates end up in the same mechanism, each doing the
// job it is actually good at.

import { contentOverlap, normalise } from "./text.js";

/** Above this content-overlap with an accept phrasing, the fast tier grants. */
export const FAST_ACCEPT_OVERLAP = 0.8;

/**
 * Tier 1: the deterministic fast-accept. Returns true only on a strong match to a
 * held-out accept phrasing (normalised equality, or content-word overlap at or above
 * the threshold). NEVER returns a rejection — a false here means "escalate to the
 * model", so this path is structurally incapable of a false negative.
 */
export function deterministicProseAccept(
  answer: string,
  acceptPhrasings: readonly string[],
): boolean {
  const a = normalise(answer);
  if (a.length === 0) return false;
  for (const phrase of acceptPhrasings) {
    const p = normalise(phrase);
    if (p.length === 0) continue;
    if (a === p) return true;
    if (contentOverlap(answer, phrase) >= FAST_ACCEPT_OVERLAP) return true;
  }
  return false;
}

/** Whether the prose half was satisfied, and by which tier (for provenance). */
export interface ProseHalf {
  readonly satisfied: boolean;
  readonly tier: "FAST_ACCEPT" | "MODEL_COMPARISON";
}

/** The verdict and the teaching signal, from the two independently-graded halves. */
export type TeachingSignal =
  | "MASTERED"
  | "EVIDENCE_RIGHT_REASONING_WEAK"
  | "REASONING_RIGHT_EVIDENCE_WRONG"
  | "MISSED";

export interface CombinedVerdict {
  /** The binary the duel wire needs. CORRECT only when both halves hold. */
  readonly verdict: "CORRECT" | "WRONG";
  /** The richer signal, for the wrong-answer feedback surface. Never on the duel wire. */
  readonly signal: TeachingSignal;
}

/**
 * Fold the two halves. Because the card half is now deterministic, the two are known
 * independently — which today's single verdict cannot express — and that is exactly
 * what the wrong-answer feedback the owner asked for wants: "your evidence was right,
 * your reasoning missed" is a far more useful thing to tell a student than "wrong".
 *
 * The wire verdict stays binary (the duel rejects a non-binary verdict by name), so
 * the signal rides the feedback channel, not the verdict. CORRECT requires BOTH
 * halves: the mechanic's whole premise is that a right answer is evidence plus the
 * reasoning that rests on it, and crediting one without the other teaches the half
 * the student was missing.
 */
export function combineHalves(cardHalf: boolean, proseHalf: boolean): CombinedVerdict {
  if (cardHalf && proseHalf) return { verdict: "CORRECT", signal: "MASTERED" };
  if (cardHalf && !proseHalf) {
    return { verdict: "WRONG", signal: "EVIDENCE_RIGHT_REASONING_WEAK" };
  }
  if (!cardHalf && proseHalf) {
    return { verdict: "WRONG", signal: "REASONING_RIGHT_EVIDENCE_WRONG" };
  }
  return { verdict: "WRONG", signal: "MISSED" };
}
