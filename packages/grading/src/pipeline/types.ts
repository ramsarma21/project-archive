// The question pipeline's shared vocabulary.
//
// THE ARCHITECTURE THIS SERVES (the owner's, 28 Jul):
//   "offline generation with defined card + prose answers and just having to check
//    deterministically if cards are right and do a short prose comparison on runtime."
//
// So an item is produced OFFLINE — question, its bound Codex cards, a reference
// prose answer, and the compact set of required elements that answer must carry —
// and it is fully verified before it ships. At RUNTIME the two halves are checked
// cheaply and independently: the played evidence hand against the bound cards
// (deterministic, exact, no model), and the prose against the reference (a short
// comparison, deliberately smaller than today's full-rubric judgement).
//
// This file is the data those stages pass between them. The verification lives in
// ./gauntlet; the runtime prose comparison lives in ./prose. Nothing here calls a
// model, so it is safe to import from a test or the content verifier.

/**
 * One Codex card, as the gauntlet needs to see it: its id, the concept it belongs
 * to, and the single proposition it asserts. This is the same shape the content's
 * `codex-cards.json` carries; the CLI loads it from there.
 */
export interface CardRef {
  readonly cardId: string;
  readonly conceptId: string;
  readonly proposition: string;
  readonly title?: string;
}

/**
 * A candidate item, as generation produces it and the gauntlet checks it. It is a
 * superset of what ships: `requiredCore` is the compact generalising representation
 * that the runtime prose comparison uses (the analogue of today's `ideas`), and the
 * held-out `accept`/`reject` phrasings become both the deterministic fast-accept set
 * and the eval labels — the two things that keep the prose half generous and keep the
 * gates from covering a shrinking fraction of the bank.
 */
export interface CandidateItem {
  /** Short, local id. The pool namespaces it. `POSTWAR.WHICH_IS_FALSE`. */
  readonly id: string;
  readonly conceptId: string;
  readonly poolId: string;
  /** The 1–2 cards that answer this item. The runtime card half checks against exactly these. */
  readonly boundCardIds: readonly string[];
  /** The question, verbatim, in the asking character's voice. */
  readonly question: string;
  /** The reference prose answer, generated offline. Never shown before answering. */
  readonly referenceAnswer: string;
  /**
   * The compact, generalising elements a correct answer must carry — one entry per
   * load-bearing idea, phrased as meaning and not as words to match. This is what
   * makes the prose comparison generous: a single reference string would reject
   * "an almanac and a marriage licence"; a required element ("two things inside the
   * taxed paper/legal category") accepts it. Mirrors AuthoredItem.ideas.
   */
  readonly requiredCore: readonly string[];
  /** How many of `requiredCore` a correct answer must carry. Defaults to all. */
  readonly needs?: number | "all";
  /**
   * Held-out student-voice answers that MUST grade CORRECT. They feed both the
   * runtime deterministic fast-accept and the eval set. At least MIN_ACCEPT_LABELS.
   */
  readonly accept: readonly string[];
  /** Held-out student-voice answers that MUST grade WRONG. Feed the eval set. */
  readonly reject: readonly string[];
  /** A note to the next author. Never sent to a model, never shown to a student. */
  readonly note?: string;
}

export type FindingSeverity = "ERROR" | "WARN";

/**
 * One thing a check found. An ERROR rejects the item from the bank; a WARN is a
 * quality signal a human should look at but does not block. Every finding names the
 * check that produced it and states, in prose, what is wrong — a finding a reader
 * cannot act on is not a finding.
 */
export interface Finding {
  readonly check: string;
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly detail: string;
}

export interface GauntletReport {
  readonly itemId: string;
  readonly findings: readonly Finding[];
  /** True when no ERROR-severity finding was raised. WARNs do not block. */
  readonly passed: boolean;
  /** Whether the model-judgement checks (the discriminator) actually ran. */
  readonly modelChecksRan: boolean;
}

export function summarise(findings: readonly Finding[], modelChecksRan: boolean, itemId: string): GauntletReport {
  return {
    itemId,
    findings,
    passed: !findings.some((f) => f.severity === "ERROR"),
    modelChecksRan,
  };
}

// ---- label-coverage floors --------------------------------------------------
//
// These are the anti-erosion numbers. An item cannot pass the gauntlet without
// this many held-out labels, which is what stops a generated item from shipping
// with no eval coverage — the "gates cover a shrinking fraction" failure the owner
// named. They are at least as strict as the content schema's own minimums.

export const MIN_ACCEPT_LABELS = 3;
export const MIN_REJECT_LABELS = 3;
/** Four ideas is already a lot for a 1.5s runtime comparison to track. */
export const MAX_REQUIRED_CORE = 4;
/** One item binds to at most two cards — the owner's "1–2 evidences". */
export const MAX_BOUND_CARDS = 2;
