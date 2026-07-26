// Grading dials. Every number here is a decision the brief or Mission-Slate
// already made, so they live in one file where a reviewer can check them against
// the source rather than hunting through the hot path.

/**
 * The hard cap from Mission-Slate §1.7. A player never stands still in a
 * gunfight waiting on an API, so grading gets 1.5 seconds wall-clock and then
 * the maximum is granted.
 */
export const GRADING_TIMEOUT_MS = 1_500;

/**
 * A retry is only worth attempting when the first attempt failed fast (a 429 or
 * a 5xx that came back in milliseconds). Below this much remaining budget a
 * second call would just burn the deadline and arrive after the fallback has
 * already fired, so we stop and grant.
 */
export const MIN_BUDGET_FOR_RETRY_MS = 600;

/**
 * Consecutive provider failures that trip the breaker, and how long it stays
 * open. While open, every call short-circuits straight to the generous grant
 * instead of spending 1.5 seconds per round discovering the outage again — six
 * rounds times thirty students is a lot of dead waiting otherwise.
 */
export const CIRCUIT_FAILURE_THRESHOLD = 4;
export const CIRCUIT_OPEN_MS = 60_000;

/**
 * Verdict cache. Keyed on item + rubric version + normalised answer, so at
 * classroom scale the answers a whole class converges on are graded once.
 * Sized for a school day rather than for a process lifetime: 20k entries is a
 * few megabytes and covers every distinct answer thirty students produce across
 * a session many times over.
 */
export const CACHE_MAX_ENTRIES = 20_000;
export const CACHE_TTL_MS = 12 * 60 * 60 * 1_000;

/**
 * An answer shorter than this cannot carry a historical proposition, so it is
 * refused before a model call rather than after. Two characters admits "no" —
 * which several authored items legitimately reject as a coin flip but which is
 * still an answer and must be graded, not abstained. Only genuinely empty
 * submissions abstain.
 */
export const MIN_GRADEABLE_CHARS = 1;

/**
 * Answers longer than this are truncated before they reach the model. A duel
 * answer is one or two sentences; anything past this is either a paste or an
 * attempt to push the authored rubric out of the context window.
 */
export const MAX_ANSWER_CHARS = 1_200;

/**
 * The ship gate. The evaluation set must pass at or above this rate overall,
 * and the false-negative rate — a correct answer marked wrong — must stay at or
 * below its own, much tighter, ceiling. The asymmetry is the whole point:
 * §1.7 makes a false negative the toxic failure, because a student who knew the
 * material and lost a ranked duel to a grader will not come back.
 */
export const EVAL_PASS_THRESHOLD = 0.95;
export const EVAL_MAX_FALSE_NEGATIVE_RATE = 0.02;
