// The low-confidence policy: grant, count, and stop granting if it repeats.
//
// THE PROBLEM. Two positions on a low-confidence classification are each wrong in
// opposite directions.
//
//   * "Grant CORRECT when unsure" is an exploit with a discoverable input. An
//     infrastructure timeout is safe to grant on because a student cannot cause one
//     on demand; deliberately confusing prose is entirely within a student's
//     control, and a student who works out that gibberish earns three bullets has
//     found a repeatable cheat that wins ranked matches.
//   * "Grade it as read when unsure" converts that exploit into a false-negative
//     machine, and correct-but-unusually-worded is the exact population this whole
//     service is written to protect. TEA gave full credit to "stamp act put texes on
//     paper and other stuff"; a classifier reading that may well rate itself LOW,
//     and failing it is the outcome that makes a student stop trusting the game.
//
// THE RESOLUTION. The exploit only pays if it is repeatable, so remove the
// repetition rather than the generosity. A low-confidence classification grants
// CORRECT the first few times in a session and is counted. Past the allowance the
// behaviour flips: the verdict stands as the classifier read it, and the account is
// flagged. A genuinely odd correct answer happens once or twice in a duel; a student
// farming the grader has to do it every round, and the second round is where they
// stop being paid.
//
// THE THRESHOLD IS TWO GRANTS PER SESSION, and here is the arithmetic behind it.
// A duel runs until a health bar empties — typically five to nine rounds — and a
// round is worth 14 balls answered correctly against 7 answered wrong. At two
// grants a farming student converts at most two rounds of six or so, buying 14
// balls out of the ~50 a wrong-answer duel already hands them, which is less than
// answering two questions honestly would give them: the strategy is strictly worse
// than learning the material. Meanwhile a student who writes one strange but
// correct answer per duel is inside the allowance every time, and a rubric so badly
// worded that it produces three low-confidence readings in one session is a content
// defect that should surface loudly rather than be absorbed silently. One grant
// would be too tight: a duel has half a dozen independent chances to phrase
// something oddly, and a single allowance means the second oddity in an otherwise
// honest duel costs a round. Three or more starts to pay as a strategy against a
// boss with limited health.
//
// The allowance is deliberately a COUNT rather than a fraction of the duel. With no
// round count there is no fraction to take, and a per-round allowance would scale
// the exploit with the length of the fight, which is backwards: a long duel is the
// one a farming student most wants to keep paying.
//
// WHY PER SESSION AND NOT PER DUEL. The counter is keyed on the profile and the
// session window rather than the attempt, because a student farming across three
// consecutive attempts of the same mission is the same behaviour as farming inside
// one, and an attempt-scoped counter resets for them every two minutes.

import type { ClassifierConfidence, VerdictKind } from "./verdict.js";

/**
 * Low-confidence grants allowed per profile per session window. See the reasoning
 * above; this number is an argument, not a default.
 */
export const LOW_CONFIDENCE_GRANT_ALLOWANCE = 2;

/**
 * The window the allowance is counted over. A class period is fifty minutes and a
 * session is a sitting rather than a school day, so an hour covers a sitting
 * without carrying yesterday's count into today.
 */
export const LOW_CONFIDENCE_WINDOW_MS = 60 * 60 * 1_000;

export type LowConfidenceOutcome =
  /** Inside the allowance: grant CORRECT, log it. */
  | "GRANTED"
  /** Allowance spent: the classifier's reading stands, and the account is flagged. */
  | "WITHHELD_AND_FLAGGED";

export interface LowConfidenceDecision {
  readonly outcome: LowConfidenceOutcome;
  /** How many grants this profile has had in the window, including this one. */
  readonly grantsInWindow: number;
  readonly allowance: number;
  /** True once the allowance is spent. Surfaces on the account, not just in a log. */
  readonly flagged: boolean;
}

interface WindowState {
  grants: number;
  windowStartedAt: number;
  flagged: boolean;
}

/**
 * Per-profile counters over a sliding window.
 *
 * Process-local, which is a real limitation and a stated one: behind more than one
 * API instance a student gets the allowance per instance. Closing that needs a
 * shared counter, and the natural home is the same durable store the review log
 * should be writing to — a migration this package does not own. The counter is
 * behind an interface so that swap is a constructor argument rather than a rewrite,
 * and until then the flag is what catches the residue, because the flag persists in
 * the review log even when the count resets.
 */
export interface LowConfidenceLedger {
  /** Record one low-confidence classification and say what to do about it. */
  record(profileId: string): LowConfidenceDecision;
  /** Whether this profile is currently flagged. Read by the review surface. */
  isFlagged(profileId: string): boolean;
  readonly flaggedProfiles: readonly string[];
}

export class MemoryLowConfidenceLedger implements LowConfidenceLedger {
  private readonly windows = new Map<string, WindowState>();

  constructor(
    private readonly allowance: number = LOW_CONFIDENCE_GRANT_ALLOWANCE,
    private readonly windowMs: number = LOW_CONFIDENCE_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  record(profileId: string): LowConfidenceDecision {
    const at = this.now();
    const existing = this.windows.get(profileId);
    // A new window resets the count so nobody is punished tomorrow for today, but
    // it carries the flag forward: the flag is cleared by a human who has looked at
    // the case, not by an hour passing.
    const state: WindowState =
      existing === undefined || at - existing.windowStartedAt >= this.windowMs
        ? { grants: 0, windowStartedAt: at, flagged: existing?.flagged ?? false }
        : existing;
    this.windows.set(profileId, state);

    if (state.grants < this.allowance) {
      state.grants += 1;
      return {
        outcome: "GRANTED",
        grantsInWindow: state.grants,
        allowance: this.allowance,
        flagged: state.flagged,
      };
    }
    // Allowance spent. Count the occurrence so the review surface can show how
    // hard someone is leaning on it, but stop paying for it.
    state.grants += 1;
    state.flagged = true;
    return {
      outcome: "WITHHELD_AND_FLAGGED",
      grantsInWindow: state.grants,
      allowance: this.allowance,
      flagged: true,
    };
  }

  isFlagged(profileId: string): boolean {
    const state = this.windows.get(profileId);
    if (state === undefined) return false;
    // The flag outlives the window deliberately: the count resets so a student is
    // not punished tomorrow for today, and the flag stays until a human clears it.
    return state.flagged;
  }

  get flaggedProfiles(): readonly string[] {
    return [...this.windows.entries()]
      .filter(([, state]) => state.flagged)
      .map(([profileId]) => profileId);
  }

  clearFlag(profileId: string): void {
    const state = this.windows.get(profileId);
    if (state !== undefined) state.flagged = false;
  }
}

/** Disables the policy: every low-confidence reading stands as graded. */
export class NoGrantLowConfidenceLedger implements LowConfidenceLedger {
  record(): LowConfidenceDecision {
    return {
      outcome: "WITHHELD_AND_FLAGGED",
      grantsInWindow: 0,
      allowance: 0,
      flagged: false,
    };
  }

  isFlagged(): boolean {
    return false;
  }

  get flaggedProfiles(): readonly string[] {
    return [];
  }
}

/**
 * Whether a classification needs the low-confidence policy applied at all.
 *
 * Only a LOW-confidence WRONG does. A LOW-confidence CORRECT already went the
 * student's way, so there is nothing to grant and nothing to farm — it is logged
 * for review and otherwise left alone. Spending the allowance on it would let a
 * student exhaust their own allowance on answers that were already correct, which
 * is a way of turning the protection into a trap.
 */
export function needsLowConfidencePolicy(
  confidence: ClassifierConfidence | null,
  kind: VerdictKind,
): boolean {
  return confidence === "LOW" && kind === "WRONG";
}
