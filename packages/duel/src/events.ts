// The duel's event vocabulary, and the projection that decides which of those
// events are actually committed.
//
// The architecture decision this file implements (plan: "Replay is final-state
// only for missions; the duel commits its six verdicts") is that the duel emits a
// rich stream for the renderer, telemetry and tests, but persists almost none of
// it. `duelCommitLog` is the persisted subset: the verdicts, the bullet grants
// derived from them, and the terminal result.
//
// The commit log is also the integrity surface. It carries no raw answer text
// (there is no field for it) and no client-supplied bullet count (bullets are
// always the reducer's output). `commitLogContainsNoRawText` exists so a test can
// assert that against real gameplay rather than against a promise.

import type { BulletGrant } from "./bullets.js";
import type { DuelSide } from "./sides.js";
import { verdictEnvelope, type CommittedVerdict } from "./verdict.js";

export interface DuelQuestionRef {
  readonly itemId: string;
  readonly itemVersion: string;
  readonly conceptId: string;
}

/**
 * An item as it was actually asked, including whether the player had seen it
 * before in this duel.
 *
 * A duel now runs until somebody drops, so it can outlast its bank — M1 authors 18
 * items and an unbounded match can ask more than 18 questions. The answer is the
 * one the assessment engine already settled on: RECYCLE, AND SAY SO. `@pa/reporting`
 * carries mastery shown on a repeat as `evidenceStrength: "RECYCLED_ITEMS"` and
 * qualifies the claim with `MASTERY_ON_RECYCLED_ITEMS` rather than letting a repeat
 * look like fresh evidence, and this is the same disclosure one layer down.
 *
 * `appearance` is 1 the first time an item is asked in a duel, 2 the second, and so
 * on, so a consumer can decide for itself how much a repeat is worth instead of
 * being handed a boolean someone else's policy baked in. `recycled` is the boolean
 * the HUD wants.
 */
export interface AskedQuestion {
  readonly item: DuelQuestionRef;
  /** 1-based count of how many times this item has been asked in this duel. */
  readonly appearance: number;
  readonly recycled: boolean;
}

export type DuelOutcomeReason = "KNOCKOUT" | "ROUNDS_EXHAUSTED";
export type DuelTiebreak = "NONE" | "HEALTH" | "HITS_LANDED" | "DRAWN";

export interface DuelOutcome {
  /** null is a genuine draw: identical health and identical hits landed. */
  readonly winner: DuelSide | null;
  readonly reason: DuelOutcomeReason;
  readonly healthA: number;
  readonly healthB: number;
  readonly tiebreak: DuelTiebreak;
}

/**
 * WINNING ON POINTS CLEARS THE MISSION. Settled decision, recorded so nobody
 * relitigates it.
 *
 * A duel that goes the full six rounds is decided on damage dealt, and that
 * decision is a clear. The reasoning is the owner's design philosophy rather than
 * a combat argument: missions are optional-outcome fun, and the chapter assessment
 * is the mandatory learning spine. A player cannot progress through the curriculum
 * without demonstrating knowledge on the assessment, so a mission does not need to
 * be a knowledge gate as well. Mechanical skill is explicitly allowed to carry a
 * clumsy-but-improving player forward — a bad player is allowed to just get better
 * by playing.
 *
 * That is what makes the measured tuning correct rather than lenient: on the
 * wrong-answer path against the hardest boss, a skilled player wins most runs but
 * knocks him out rarely. Three bullets buys the knockout; one bullet buys a
 * decision.
 */
export const MISSION_CLEAR_REQUIRES_KNOCKOUT = false;

export function duelClearedMission(
  outcome: DuelOutcome,
  requireKnockout: boolean = MISSION_CLEAR_REQUIRES_KNOCKOUT,
): boolean {
  if (outcome.winner !== "A") return false;
  return requireKnockout ? outcome.reason === "KNOCKOUT" : true;
}

/**
 * What a duel outcome does to PvP standing.
 *
 * A true draw — identical health fraction AND identical hits landed — changes
 * nothing and is logged for review. Settled decision: inventing sudden death for
 * an outcome this rare means building and balancing an extra mode for an edge
 * case. `DUEL_RESOLVED` already commits `tiebreak: "DRAWN"`, so the review surface
 * is a query over the commit log rather than a new event. If telemetry ever shows
 * draws at a real rate, revisit with data.
 */
export type StandingEffect = "WINNER_TAKES" | "NO_CHANGE_LOGGED_FOR_REVIEW";

export function standingEffect(outcome: DuelOutcome): StandingEffect {
  return outcome.winner === null ? "NO_CHANGE_LOGGED_FOR_REVIEW" : "WINNER_TAKES";
}

export function duelNeedsStandingReview(outcome: DuelOutcome): boolean {
  return standingEffect(outcome) === "NO_CHANGE_LOGGED_FOR_REVIEW";
}

export interface RoundSummary {
  readonly round: number;
  readonly healthA: number;
  readonly healthB: number;
  readonly unspentA: number;
  readonly unspentB: number;
}

export type DuelEvent =
  // ---- committed ----------------------------------------------------------
  | {
      readonly type: "DUEL_STARTED";
      readonly seed: number;
      /** The termination backstop, not a length. A duel ends on health. */
      readonly roundCeiling: number;
      /** Authored items available. Rounds beyond this recycle, and say so. */
      readonly bankSize: number;
      readonly mode: "BOSS" | "PVP";
      readonly opponentId: string;
    }
  | {
      readonly type: "VERDICT_COMMITTED";
      readonly round: number;
      readonly side: DuelSide;
      readonly verdict: CommittedVerdict;
      /**
       * How many times this item had been asked in this match when it was graded,
       * and whether that makes this a repeat. Carried on the COMMITTED record — not
       * just the transient `QUESTION_OPENED` — so the fact survives to grade time and
       * into the persisted commit log, where a per-concept retrieval ledger can read
       * it and decide what a repeat is worth.
       *
       * WHY IT RIDES THE RECORD RATHER THAN THE GRADING REQUEST. The verdict-request
       * wire (`apps/api/src/duels/request.ts`) is a strict allowlist that refuses an
       * unknown field, and a 4xx there pays the client the full magazine — so a new
       * request field would be both out-of-lane and dangerous. The commit-log ingest
       * (`readCommittedVerdicts`) reads named keys and ignores extras, and the receipt
       * HMAC is over the verdict envelope only, so carrying it here is safe. In PvP the
       * authority also has it live on `state.asked` at commit time; this is the durable
       * copy for the record. Reuse-is-a-stopgap: see the header of questions.ts.
       */
      readonly appearance: number;
      readonly recycled: boolean;
    }
  | {
      readonly type: "BULLETS_GRANTED";
      readonly round: number;
      readonly side: DuelSide;
      readonly grant: BulletGrant;
    }
  | { readonly type: "DUEL_RESOLVED"; readonly outcome: DuelOutcome }
  // ---- transient (renderer, telemetry, tests) -----------------------------
  | { readonly type: "FACE_OFF_COMPLETED"; readonly tick: number }
  | {
      readonly type: "QUESTION_OPENED";
      readonly round: number;
      readonly item: DuelQuestionRef;
      /** 1 the first time this item is asked in this duel, 2 the second, … */
      readonly appearance: number;
      /** Disclosed rather than hidden, following the assessment's precedent. */
      readonly recycled: boolean;
      readonly awaiting: readonly DuelSide[];
    }
  | { readonly type: "ENGAGEMENT_OPENED"; readonly round: number; readonly tick: number }
  | {
      readonly type: "SHOT_FIRED";
      readonly round: number;
      readonly tick: number;
      readonly side: DuelSide;
      readonly projectileId: number;
      readonly ammoRemaining: number;
    }
  | {
      readonly type: "SHOT_ABSORBED_BY_COVER";
      readonly tick: number;
      readonly projectileId: number;
      readonly coverId: string;
    }
  | {
      readonly type: "SHOT_EVADED";
      readonly tick: number;
      readonly projectileId: number;
      readonly side: DuelSide;
      readonly by: "DODGE_IFRAME" | "ABILITY";
    }
  | {
      readonly type: "HIT_LANDED";
      readonly tick: number;
      readonly projectileId: number;
      readonly shooter: DuelSide;
      readonly target: DuelSide;
      readonly damage: number;
      readonly targetHealthAfter: number;
    }
  | { readonly type: "SHOT_EXPIRED"; readonly tick: number; readonly projectileId: number }
  | {
      readonly type: "DODGE_STARTED";
      readonly tick: number;
      readonly side: DuelSide;
      readonly dirX: number;
      readonly dirZ: number;
    }
  | {
      readonly type: "ABILITY_INVOKED";
      readonly tick: number;
      readonly side: DuelSide;
      readonly abilityId: string;
      readonly usesRemaining: number;
    }
  | {
      readonly type: "ABILITY_REFUSED";
      readonly tick: number;
      readonly side: DuelSide;
      readonly abilityId: string;
      readonly reason: string;
    }
  | { readonly type: "KNOCKOUT"; readonly tick: number; readonly downed: DuelSide }
  | {
      readonly type: "LINE_OF_SIGHT_BROKEN";
      readonly round: number;
      readonly tick: number;
      readonly unspentA: number;
      readonly unspentB: number;
    }
  | {
      // Emitted once, when a cover-taking boss reaches a valid cover position and
      // its line of sight to the player is actually blocked — the authoritative
      // signal the question overlay is gated on, and the renderer's cue that the
      // officer is down behind cover. Only a boss with `takesCoverBeforeQuestion`
      // produces it.
      readonly type: "BOSS_TOOK_COVER";
      readonly round: number;
      readonly tick: number;
      readonly coverId: string;
    }
  | { readonly type: "ROUND_RESOLVED"; readonly summary: RoundSummary };

export type DuelEventType = DuelEvent["type"];

/**
 * The events that are persisted. Everything else is presentation.
 *
 * Deliberately excluded: every tick-level combat event. Persisting shots and
 * positions would make the duel a tick-replay system, which the architecture
 * explicitly rejected for anything but the assessment.
 */
export const COMMITTED_EVENT_TYPES: readonly DuelEventType[] = [
  "DUEL_STARTED",
  "VERDICT_COMMITTED",
  "BULLETS_GRANTED",
  "DUEL_RESOLVED",
];

export function duelCommitLog(
  events: readonly DuelEvent[],
): readonly DuelEvent[] {
  return events.filter((event) => COMMITTED_EVENT_TYPES.includes(event.type));
}

/** Serialisable form of the commit log; verdicts collapse to their envelope. */
export function serialiseCommitLog(
  events: readonly DuelEvent[],
): readonly Record<string, unknown>[] {
  return duelCommitLog(events).map((event) =>
    event.type === "VERDICT_COMMITTED"
      ? {
          type: event.type,
          round: event.round,
          side: event.side,
          verdict: verdictEnvelope(event.verdict),
          // Carried into the persisted record so a repeat stays identifiable at and
          // after grade time. `verdict` remains the HMAC input untouched; these sit
          // beside it exactly as `receipt`/`duelId` do (attachVerdictReceipts).
          appearance: event.appearance,
          recycled: event.recycled,
        }
      : ({ ...event } as Record<string, unknown>),
  );
}

/**
 * True when no needle appears anywhere in the serialised commit log. Tests feed
 * real answer text through the grading path and assert it never lands here.
 */
export function commitLogContainsNoRawText(
  events: readonly DuelEvent[],
  needles: readonly string[],
): boolean {
  const json = JSON.stringify(serialiseCommitLog(events));
  return needles.every((needle) => !json.includes(needle));
}
