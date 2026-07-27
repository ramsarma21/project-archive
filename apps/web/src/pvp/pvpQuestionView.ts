import type { MatchSnapshot, QuestionPayload } from "./protocol.js";

// What the centered PvP overlay should show right now — decided once, as data, so the
// one rule that is easy to get wrong is testable without a DOM: a countdown appears
// ONLY when the server is actually counting down (both answers in, BULLETS_GRANTED),
// never while this player waits on the opponent, and the whole overlay disappears the
// instant combat resumes.

export type PvpOverlayMode = "HIDDEN" | "QUESTION" | "WAITING" | "COUNTDOWN";

export type PvpOverlayView =
  | { readonly mode: "HIDDEN" }
  | { readonly mode: "QUESTION"; readonly round: number; readonly question: QuestionPayload }
  | {
      readonly mode: "WAITING";
      readonly round: number;
      readonly verdict: "CORRECT" | "WRONG" | null;
      readonly opponentAnswering: boolean;
    }
  | {
      readonly mode: "COUNTDOWN";
      readonly round: number;
      readonly verdict: "CORRECT" | "WRONG" | null;
      /** Whole seconds from the authoritative snapshot: 3, then 2, then 1. */
      readonly seconds: number;
    };

/** The only phases the overlay is shown in. Anything else hides it. */
const OVERLAY_PHASES: ReadonlySet<string> = new Set([
  "QUESTION_PENDING",
  "VERDICT_COMMITTED",
  "BULLETS_GRANTED",
]);

export function pvpOverlayView(input: {
  readonly snapshot: MatchSnapshot;
  readonly question: QuestionPayload | null;
  readonly lastVerdict: "CORRECT" | "WRONG" | null;
}): PvpOverlayView {
  const { snapshot, question, lastVerdict } = input;
  // Combat is live (or the fight is over): no overlay. This is what makes it vanish
  // the moment engagement resumes rather than lingering as a stale panel.
  if (!OVERLAY_PHASES.has(snapshot.phase)) return { mode: "HIDDEN" };

  // This player still owes an answer: show the question.
  if (question) return { mode: "QUESTION", round: snapshot.round, question };

  // The authoritative countdown is non-null ONLY in BULLETS_GRANTED, i.e. once both
  // verdicts have landed. So a countdown here is never a false one — if only this
  // player has answered, the server is still QUESTION_PENDING and this is null.
  const seconds = snapshot.resumeCountdownSeconds;
  if (seconds !== null && seconds !== undefined) {
    return { mode: "COUNTDOWN", round: snapshot.round, verdict: lastVerdict, seconds };
  }

  // Answered, but the round has not resolved: waiting on the opponent (or on the
  // instant verdict→grant transition). No countdown is shown.
  return {
    mode: "WAITING",
    round: snapshot.round,
    verdict: lastVerdict,
    opponentAnswering: snapshot.opponent.answering,
  };
}
