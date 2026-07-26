// The grading half of the PvE duel route, and the receipt that signs it.
//
// This is the sibling of ../pvp/grading.ts and it is deliberately built the same
// way: the same authored bank, the same calibrated judging policy, the same
// TrueFoundry classifier, the same verdict cache and review log, and the same
// HMAC receipt bound to one profile, one duel and one round. The two differ in
// exactly two places, and both are content rather than policy:
//
//   * the bank is `m1ItemBank()` — the eighteen authored PvE duel items. PvP
//     grades against a wider pool because it draws from one; a boss duel asks
//     only what the mission authored.
//   * the deadline is shorter than @pa/grading's own. See BUDGET below.
//
// WHAT IS NOT HERE, FOR THE SAME REASON IT IS NOT THERE. No keyword match, no
// similarity score, no local "grade it ourselves if the model is down" branch. A
// second, weaker grader would be a second answer to the only question the bullet
// economy reads. When the classifier cannot be reached, @pa/grading's own policy
// fires: the round is granted the maximum, the source is GRADING_TIMEOUT, and the
// review log records it.
//
// THERE IS NO TABLE OF MINTED VERDICTS, and that is the same call @pa/grading's
// own verdict.ts already argued: a server-side ledger would be stronger, it needs
// a migration, and the HMAC already gets the property that matters — a client
// cannot author a verdict. What the binding buys is that it cannot move one
// either: a CORRECT minted for round two of this player's duel verifies for
// nothing else.

import type { FastifyBaseLogger } from "fastify";
import {
  DEFAULT_JUDGING_POLICY,
  GRADING_TIMEOUT_MS,
  GradingService,
  ItemBank,
  JsonLineReviewLog,
  MemoryLowConfidenceLedger,
  MemoryVerdictCache,
  MultiReviewLog,
  TrueFoundryClassifierProvider,
  gradingModel,
  m1GradingPolicy,
  m1ItemBank,
  mintVerdictReceipt,
  providerConfigured,
  verdictEnvelope,
  verdictReceiptSecret,
  verifyVerdictReceipt,
  type GradedVerdict,
  type ReceiptBinding,
  type ReviewLog,
  type VerdictEnvelope,
} from "@pa/grading";
import { GradingSignal } from "./gradingSignal.js";

/**
 * How much of the 1.5-second cap is reserved for everything that is not the
 * model, and why the server does not simply spend the whole thing.
 *
 * Mission-Slate §1.7 gives the PLAYER 1.5 seconds, and the duel client enforces
 * that with its own `AbortController` — started before it fetches the CSRF token,
 * so the round trip and a session read are already inside the budget by the time
 * the request arrives here. A server that also grades for a full 1.5 seconds
 * therefore always loses the race: the browser aborts first and mints its own
 * timeout verdict, the player is granted the maximum exactly as designed, and
 * NOTHING IS LOGGED. The generous grant is only defensible because somebody can
 * count it, so the server's deadline sits under the client's by enough for a
 * local round trip and the grant is recorded here instead.
 *
 * 250ms is generous for a same-host request and cheap against the measured
 * median of 622ms — a model call slower than 1.25s was going to be granted on
 * either side of the wire.
 */
const CLIENT_ROUND_TRIP_ALLOWANCE_MS = 250;

export const DUEL_GRADING_BUDGET_MS =
  GRADING_TIMEOUT_MS - CLIENT_ROUND_TRIP_ALLOWANCE_MS;

export interface DuelGradingHealth {
  /** Whether a model call is possible at all. False means every round is granted. */
  readonly configured: boolean;
  readonly model: string | null;
  readonly policyId: string;
  readonly items: number;
  readonly budgetMs: number;
}

/** Everything the route needs to grade one round, and nothing else. */
export interface DuelRoundGrade {
  /** Exactly the five keys @pa/duel's `parseVerdictEnvelope` accepts. */
  readonly envelope: VerdictEnvelope;
  /** HMAC over the envelope and its binding. Proof the server minted it. */
  readonly receipt: string;
  /** Server-side provenance. Never projected onto the wire's body. */
  readonly provenance: GradedVerdict["provenance"];
}

export interface DuelGrading {
  /**
   * Grade one round's answer and sign the result.
   *
   * `answer` is the only place the student's words exist on this path. They go to
   * the classifier and to nothing else: not to the event log, not to the verdict,
   * not to the review log, which records a hash.
   */
  grade(input: {
    readonly profileId: string;
    readonly duelId: string;
    readonly roundIndex: number;
    readonly itemId: string;
    readonly answer: string;
  }): Promise<DuelRoundGrade>;
  /**
   * @pa/grading's `verifyVerdictReceipt`, bound to the server's secret.
   *
   * Exported rather than kept private because the route is not the last reader: a
   * verdict travels through the browser, and whoever commits the duel's verdicts
   * at the end of the attempt has to be able to ask this question. Binding a
   * receipt to `{profileId, attemptId: duelId, roundIndex}` is only worth
   * anything if the check is available where the verdict is spent.
   */
  verifyReceipt(
    envelope: VerdictEnvelope,
    binding: ReceiptBinding,
    receipt: string,
  ): boolean;
  readonly bank: ItemBank;
  readonly health: DuelGradingHealth;
  /**
   * The rolling fallback rate, and the thing that makes the generous grant
   * defensible.
   *
   * `grade` records into it on every round, so the count cannot drift from the
   * grades that produced it, and both health reads project it. See
   * ./gradingSignal.ts for why this is a rate on an endpoint and a metric rather
   * than a failing health check.
   */
  readonly signal: GradingSignal;
  /** Live cache and flag counters, for the health read. */
  readonly stats: () => {
    cache: { hits: number; misses: number };
    flaggedProfiles: number;
  };
}

export interface DuelGradingOptions {
  /** Defaults to the M1 bank. Later chapters extend this, not this file. */
  readonly bank?: ItemBank;
  /** A second review sink beside the log line. Tests read it. */
  readonly reviewLog?: ReviewLog;
  /** Overridden only by tests that must not wait 1.25 seconds for a fallback. */
  readonly budgetMs?: number;
}

export function createDuelGrading(
  logger: FastifyBaseLogger,
  options: DuelGradingOptions = {},
): DuelGrading {
  const bank = options.bank ?? m1ItemBank();
  const authored = m1GradingPolicy();
  const configured = providerConfigured();
  if (!configured) {
    // Said once at boot rather than once per round. Every answer will be granted
    // the maximum and logged for review, which is loud enough on its own.
    logger.warn(
      "duel grading: no classifier credential; every duel round will grant the generous fallback",
    );
  }
  const budgetMs = options.budgetMs ?? DUEL_GRADING_BUDGET_MS;
  const reviewLog: ReviewLog = new MultiReviewLog([
    new JsonLineReviewLog((line) => logger.warn(line)),
    ...(options.reviewLog ? [options.reviewLog] : []),
  ]);
  const service = new GradingService({
    bank,
    provider: configured ? new TrueFoundryClassifierProvider() : null,
    cache: new MemoryVerdictCache(),
    reviewLog,
    timeoutMs: budgetMs,
    // The judging rules are calibration read off TEA-scored student responses.
    // They travel with the content bank rather than being written here.
    policy: {
      governingQuestion: DEFAULT_JUDGING_POLICY.governingQuestion,
      alwaysIgnore: authored.alwaysIgnore,
      neverSufficient: authored.neverSufficient,
    },
    lowConfidence: new MemoryLowConfidenceLedger(),
  });

  // THE SIGNING KEY IS PROVED AT BOOT, NOT AT THE FIRST ROUND.
  //
  // `verdictReceiptSecret()` throws when neither GRADING_RECEIPT_SECRET nor
  // SESSION_SECRET is set, and for months neither was on a deployed task — so the
  // failure was going to arrive as a 500 to a student mid-gunfight, on a task that
  // had passed every health check. Asking the question here instead means a
  // deployment without the key cannot come up at all: the ECS circuit breaker
  // rolls the deploy back, which is the loud, recoverable version of the same
  // problem. The value is cached inside @pa/grading, so this costs one HKDF.
  try {
    verdictReceiptSecret();
  } catch (cause) {
    throw new Error(
      "duel grading cannot sign verdicts: GRADING_RECEIPT_SECRET is unset and " +
        "SESSION_SECRET is not available to derive from. Deployed tasks take it " +
        "from the project-archive/verdict-receipt secret; see infra/README.md. " +
        "Refusing to start rather than failing on a student's first answer.",
      { cause },
    );
  }

  const verify = (
    envelope: VerdictEnvelope,
    binding: ReceiptBinding,
    receipt: string,
  ): boolean =>
    verifyVerdictReceipt(envelope, binding, receipt, verdictReceiptSecret());

  const signal = new GradingSignal({ configured });

  return {
    grade: async (input) => {
      const binding: ReceiptBinding = {
        profileId: input.profileId,
        // The duel IS the attempt here. PvE duel ids are attempt-scoped
        // (`...#duel@3`), so binding to one is binding to a single fight.
        attemptId: input.duelId,
        roundIndex: input.roundIndex,
      };
      const verdict = await service.grade({
        itemId: input.itemId,
        answer: input.answer,
        profileId: input.profileId,
        attemptId: input.duelId,
        roundIndex: input.roundIndex,
        // No opaque reference yet: retaining the answer needs the encrypted
        // columns a migration owns, and inventing an id that points at nothing
        // would be worse than saying null.
        responseRef: null,
      });
      const envelope = verdictEnvelope(verdict);
      const receipt = mintVerdictReceipt(
        envelope,
        binding,
        verdictReceiptSecret(),
      );
      // Mint, then verify what was minted, before the verdict is allowed out.
      // It is a self-check rather than an authorisation — it can only fail if the
      // signing key changed underneath us — and it is here because the failure it
      // catches is silent otherwise: a verdict nobody can later authenticate is
      // indistinguishable from a good one until the moment it is spent.
      if (!verify(envelope, binding, receipt)) {
        throw new Error("duel grading minted a receipt it cannot verify");
      }
      // Counted here rather than in the route, so the rate cannot drift from the
      // grades that produced it: there is exactly one place a duel round is
      // graded and this is it.
      signal.record(logger, {
        profileId: input.profileId,
        duelId: input.duelId,
        roundIndex: input.roundIndex,
        itemId: input.itemId,
        path: verdict.provenance.path,
        latencyMs: verdict.provenance.latencyMs,
        fallbackReason: verdict.provenance.fallbackReason,
      });
      return { envelope, receipt, provenance: verdict.provenance };
    },
    verifyReceipt: verify,
    signal,
    bank,
    health: {
      configured,
      model: configured ? gradingModel() : null,
      policyId: authored.policyId,
      items: bank.size,
      budgetMs,
    },
    stats: () => ({
      cache: service.cacheStats,
      flaggedProfiles: service.flaggedProfiles.length,
    }),
  };
}
