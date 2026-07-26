// Making a grading outage visible while it is happening.
//
// THE OPERATIONAL RISK THIS EXISTS FOR. Grading grants the MAXIMUM on timeout.
// That rule is right — Mission-Slate §1.7, a player is never punished for
// infrastructure, and freezing a student mid-gunfight on a model call is worse
// than being generous — and it has a consequence nobody designed for: an
// unreachable gateway is indistinguishable from a class of geniuses. A
// deliberately wrong answer comes back CORRECT with a full magazine, /v1/health
// stays green because the database and the API are fine, and the only trace is a
// review log line. Nobody reads a review log during a lesson.
//
// WHAT IS DELIBERATELY NOT THE ANSWER. Failing the health check. The ECS task
// health check and the load balancer both read /v1/health, so making it fail on a
// grading outage would kill the task and end the lesson — over a condition the
// design goes out of its way to degrade gracefully. Grading being down must never
// take the API down. A student mid-duel is better served by a generous grant than
// by a container restart.
//
// SO THE SIGNAL IS A RATE, IN FOUR PLACES, AIMED AT FOUR DIFFERENT READERS.
//
//   1. A COUNTED FIELD ON /v1/health, which needs no session and does not change
//      the status code. This is what a person can watch on a projector during a
//      lesson and what an uptime check can scrape. `status` is the one word that
//      matters: OK, DEGRADED, UNGRADED.
//   2. A STRUCTURED LOG LINE PER ROUND, one field of which is 1 when the round was
//      granted without being graded. `infra/lib/project-archive-stack.ts` turns
//      the pair into CloudWatch metrics by log metric filter and alarms on the
//      RATE — which is the reader who is not watching, and the one that matters at
//      08:40 on a Tuesday. A count alone cannot become a rate, which is why every
//      round logs and not only the failures.
//   3. AN ERROR-LEVEL ESCALATION when the rolling rate crosses the threshold,
//      rate-limited to once a minute so it stands out instead of drowning. This is
//      the reader who has the logs open and would otherwise see a hundred
//      identical warnings.
//   4. A CONSOLE ANNOUNCEMENT ON THE FIRST UNGRADED ROUND, outside production
//      only, written with `console.error` rather than through the logger. See
//      `announce` below: readers 1 to 3 are all invisible on a laptop, which is
//      why this condition survived a playtest.
//
// The window is in memory and per task. With one task that is the whole picture;
// with several it is a sample of it, and the CloudWatch metric — which sums across
// tasks — is the one to trust for the rate. Said here because a per-task number
// read as a fleet number is how somebody concludes grading is fine.
//
// THE DENOMINATOR IS ROUNDS THAT NEEDED THE CLASSIFIER, NOT ROUNDS.
//
// An empty answer is decided by `preCheckAnswer` with no model call: path
// PRE_CHECK, no fallback reason, correctly WRONG. Counting it as a graded round
// made it EVIDENCE THAT GRADING WORKS, which it is not — it is evidence that an
// empty box is still empty. With a completely unreachable gateway, a measured
// seven-round duel containing one empty answer came out at 86% rather than 100%,
// and because UNGRADED is the reading at 100% the endpoint said DEGRADED while
// zero answers had been classified. DEGRADED means "some rounds are falling
// through"; the truth was "nothing is being graded and every student has a full
// magazine". So `gradeable` excludes PRE_CHECK and `classified` counts the rounds
// that actually reached the classifier or its cache — because "how many rounds
// were graded" is the question, and it had no field.

import type { FastifyBaseLogger } from "fastify";
import {
  FALLBACK_DIAGNOSIS_ADVICE,
  type FallbackDiagnosis,
  type FallbackReason,
  type VerdictPath,
} from "@pa/grading";

/**
 * The marker field on the per-round log line.
 *
 * `infra/lib/project-archive-stack.ts` matches `{ $.paMetric = "..." }` and reads
 * `$.graded` and `$.fallback` as metric values. Those four names are the entire
 * join between this file and the alarm, and a rename here produces a metric that
 * is permanently zero — which reads exactly like healthy grading.
 * `apps/api/test/grading-signal.test.ts` asserts the stack still matches.
 */
export const GRADING_METRIC_MARKER = "duel_grading_round";

/** Five minutes, matching the CloudWatch alarm's period. */
const WINDOW_MS = 5 * 60 * 1000;

/**
 * Rounds the window needs before a percentage means anything. One student
 * mid-duel is four or five rounds; alarming on 100% of two would fire every time
 * a laptop lid closed.
 */
const MIN_ROUNDS_FOR_RATE = 5;

/** At most one escalation per minute, however bad it gets. */
const ESCALATION_INTERVAL_MS = 60 * 1000;

const DEFAULT_ALERT_PERCENT = 25;

/**
 * OK        — grading is grading.
 * DEGRADED  — the rolling rate is at or past the alert threshold, and at least
 *             one round in the window WAS graded. Some rounds are falling
 *             through, which is a bad afternoon rather than an outage.
 * UNGRADED  — nothing is being graded at all: no credential, or every round that
 *             needed the classifier fell back. Every student is being handed a
 *             full magazine for anything they type.
 */
export type GradingSignalStatus = "OK" | "DEGRADED" | "UNGRADED";

export interface GradingSignalSnapshot {
  readonly status: GradingSignalStatus;
  /** False means no classifier credential, so 100% of rounds are granted. */
  readonly configured: boolean;
  readonly windowMinutes: number;
  readonly roundsInWindow: number;
  /**
   * Rounds in the window that needed the classifier at all, which is every round
   * except a deterministic pre-check. The denominator of `ungradedPercent`.
   */
  readonly gradeableInWindow: number;
  /** Rounds in the window a classification actually decided, model or cache. */
  readonly classifiedInWindow: number;
  readonly ungradedInWindow: number;
  /**
   * Ungraded as a percentage of GRADEABLE rounds. Null until the window holds
   * enough of them for the figure to mean anything.
   */
  readonly ungradedPercent: number | null;
  readonly alertPercent: number;
  readonly roundsSinceBoot: number;
  readonly classifiedSinceBoot: number;
  readonly ungradedSinceBoot: number;
  readonly lastUngradedAt: string | null;
  /** Which infrastructure conditions fired, since boot. */
  readonly ungradedByReason: Readonly<Record<string, number>>;
  /**
   * The precise causes, since boot, and the field to read first when `status` is
   * not OK. `ungradedByReason` above is the coarse class @pa/grading froze for
   * its consumers; this distinguishes a refused request from an unreachable
   * gateway, which that one cannot.
   */
  readonly ungradedByDiagnosis: Readonly<Record<string, number>>;
  /**
   * One sentence naming what is wrong and what to do, or null when nothing is.
   * Present so the answer to "why is this UNGRADED" is in the same response as
   * the word UNGRADED.
   */
  readonly advice: string | null;
}

/**
 * Percentage of rounds granted-without-grading past which the API escalates in
 * its own logs. 0 disables the escalation and never the counting: the numbers
 * still reach /v1/health and CloudWatch, because the point of this file is that
 * the condition is never invisible.
 */
function alertPercent(): number {
  // Blank is UNSET, not zero. `Number("")` is 0, so reading the variable without
  // this would let an empty value in a task definition silently disable the one
  // signal that says grading has stopped working.
  const configured = process.env.GRADING_FALLBACK_ALERT_PERCENT?.trim();
  if (configured === undefined || configured === "") return DEFAULT_ALERT_PERCENT;
  const raw = Number(configured);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100) return DEFAULT_ALERT_PERCENT;
  return raw;
}

export interface GradingSignalOptions {
  /** Whether a model call is possible at all. False pins the status to UNGRADED. */
  readonly configured: boolean;
  /** Injected so a test does not have to wait five minutes for a window to age. */
  readonly now?: () => number;
  /**
   * Whether to write the first-round announcement to the console. Defaults to
   * true outside production. A test sets it false to keep its output readable.
   */
  readonly announceToConsole?: boolean;
}

export class GradingSignal {
  private readonly now: () => number;
  private readonly configured: boolean;
  private readonly announceToConsole: boolean;
  /** Timestamps of rounds in the window, and of the ungraded subset. */
  private readonly rounds: number[] = [];
  /** Rounds that needed the classifier, and the subset it actually decided. */
  private readonly gradeable: number[] = [];
  private readonly classified: number[] = [];
  private readonly ungraded: number[] = [];
  private roundsSinceBoot = 0;
  private classifiedSinceBoot = 0;
  private ungradedSinceBoot = 0;
  private lastUngradedAt: number | null = null;
  /** null, not 0: the FIRST escalation must not wait out the interval. */
  private lastEscalationAt: number | null = null;
  private readonly byReason = new Map<string, number>();
  private readonly byDiagnosis = new Map<string, number>();
  /** Diagnoses already announced to the console. Each is said once. */
  private readonly announced = new Set<string>();

  constructor(options: GradingSignalOptions) {
    this.configured = options.configured;
    this.now = options.now ?? Date.now;
    this.announceToConsole =
      options.announceToConsole ?? process.env.NODE_ENV !== "production";
  }

  /**
   * Record one graded round and emit its metric line.
   *
   * Called for EVERY round, not only the failures. The line is the denominator as
   * well as the numerator, and a fallback count without a round count is a number
   * that cannot answer "is this a bad minute or a broken gateway".
   */
  record(
    logger: FastifyBaseLogger,
    round: {
      readonly profileId: string;
      readonly duelId: string;
      readonly roundIndex: number;
      readonly itemId: string;
      readonly path: VerdictPath;
      readonly latencyMs: number;
      /** Set when the round was granted without being graded. */
      readonly fallbackReason: FallbackReason | null;
      /** The precise cause, when there was a fallback. */
      readonly fallbackDiagnosis?: FallbackDiagnosis | null;
      /** The gateway's HTTP status, when it answered at all. */
      readonly fallbackStatus?: number | null;
    },
  ): void {
    const at = this.now();
    const ungraded = round.fallbackReason !== null;
    // A deterministic pre-check never asked the classifier anything, so it is
    // neither a graded round nor an ungraded one. See the note at the top.
    const gradeable = round.path !== "PRE_CHECK";
    const diagnosis = round.fallbackDiagnosis ?? null;
    this.prune(at);
    this.rounds.push(at);
    this.roundsSinceBoot += 1;
    if (gradeable) this.gradeable.push(at);
    if (gradeable && !ungraded) {
      this.classified.push(at);
      this.classifiedSinceBoot += 1;
    }
    if (ungraded) {
      this.ungraded.push(at);
      this.ungradedSinceBoot += 1;
      this.lastUngradedAt = at;
      this.byReason.set(
        round.fallbackReason as string,
        (this.byReason.get(round.fallbackReason as string) ?? 0) + 1,
      );
      if (diagnosis !== null) {
        this.byDiagnosis.set(
          diagnosis,
          (this.byDiagnosis.get(diagnosis) ?? 0) + 1,
        );
      }
    }

    const snapshot = this.snapshot();
    // The metric line. Emitted at info so it is not mistaken for a problem on its
    // own — one fallback is a slow model call, not an outage — and so a healthy
    // lesson still produces the denominator.
    logger.info(
      {
        paMetric: GRADING_METRIC_MARKER,
        graded: 1,
        fallback: ungraded ? 1 : 0,
        path: round.path,
        reason: round.fallbackReason,
        // The field that answers "why", beside the one that answers "how often".
        diagnosis,
        status: round.fallbackStatus ?? null,
        latencyMs: Math.round(round.latencyMs),
        duelId: round.duelId,
        round: round.roundIndex,
        itemId: round.itemId,
        // Not the answer, not the verdict, and not anything a student wrote. The
        // profile is here because a steady trickle from ONE profile is a person
        // who has noticed that a slow answer is a free correct one, and a burst
        // across MANY is an outage. Distinguishing them needs the id.
        profileId: round.profileId,
        ungradedPercent: snapshot.ungradedPercent,
      },
      ungraded
        ? "duel grading: granted the maximum without grading"
        : "duel grading: graded",
    );

    this.escalate(logger, snapshot, at);
  }

  snapshot(): GradingSignalSnapshot {
    const at = this.now();
    this.prune(at);
    const roundsInWindow = this.rounds.length;
    const ungradedInWindow = this.ungraded.length;
    const percent =
      roundsInWindow >= MIN_ROUNDS_FOR_RATE
        ? Math.round((ungradedInWindow / roundsInWindow) * 100)
        : null;
    const threshold = alertPercent();
    return {
      status: this.status(percent, threshold),
      configured: this.configured,
      windowMinutes: WINDOW_MS / 60_000,
      roundsInWindow,
      ungradedInWindow,
      ungradedPercent: percent,
      alertPercent: threshold,
      roundsSinceBoot: this.roundsSinceBoot,
      ungradedSinceBoot: this.ungradedSinceBoot,
      lastUngradedAt:
        this.lastUngradedAt === null
          ? null
          : new Date(this.lastUngradedAt).toISOString(),
      ungradedByReason: Object.fromEntries(this.byReason),
    };
  }

  private status(
    percent: number | null,
    threshold: number,
  ): GradingSignalStatus {
    // Known at boot and true of every round: no credential means no grading, and
    // this must not wait for a window to fill before saying so.
    if (!this.configured) return "UNGRADED";
    if (percent === null) return "OK";
    if (percent >= 100) return "UNGRADED";
    // A threshold of 0 disables the log escalation; it must not make every
    // healthy lesson read as DEGRADED.
    if (threshold > 0 && percent >= threshold) return "DEGRADED";
    return "OK";
  }

  private escalate(
    logger: FastifyBaseLogger,
    snapshot: GradingSignalSnapshot,
    at: number,
  ): void {
    if (snapshot.alertPercent === 0) return;
    if (snapshot.ungradedPercent === null) return;
    if (snapshot.ungradedPercent < snapshot.alertPercent) return;
    if (
      this.lastEscalationAt !== null &&
      at - this.lastEscalationAt < ESCALATION_INTERVAL_MS
    ) {
      return;
    }
    this.lastEscalationAt = at;
    logger.error(
      {
        ungradedPercent: snapshot.ungradedPercent,
        roundsInWindow: snapshot.roundsInWindow,
        ungradedInWindow: snapshot.ungradedInWindow,
        windowMinutes: snapshot.windowMinutes,
        reasons: snapshot.ungradedByReason,
      },
      "duel grading: answers are not being graded; students are receiving the " +
        "maximum for any answer. Check the classifier credential and the gateway.",
    );
  }

  private prune(at: number): void {
    const cutoff = at - WINDOW_MS;
    while (this.rounds.length > 0 && this.rounds[0]! < cutoff) this.rounds.shift();
    while (this.ungraded.length > 0 && this.ungraded[0]! < cutoff) {
      this.ungraded.shift();
    }
  }
}
