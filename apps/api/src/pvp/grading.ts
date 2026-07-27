// The two grading functions PvP's routes are constructed with.
//
// `registerPvpRoutes` takes grading as an injection rather than importing it, so
// that @pa/pvp holds no crypto and no secret. This file is the other half of that
// seam: it builds the SAME `GradingService` the duel's own route builds — the same
// authored M1 bank, the same calibrated judging policy, the same TrueFoundry
// classifier, the same verdict cache and review log — and binds the receipt to the
// server's secret.
//
// WHAT IS NOT HERE, DELIBERATELY. There is no keyword match, no string-similarity
// score and no "grade it locally if the model is down" branch. A duel's whole
// bullet economy hangs off `kind`, so a second, weaker grader would be a second,
// weaker answer to the only question that decides a ranked match. When the
// classifier cannot be reached, @pa/grading's own policy fires: the round is
// GRADING_TIMEOUT, the player is granted the generous verdict, and the review log
// records it. That is a decision the grading package already owns and it is not
// re-litigated here.
//
// Both PvE and PvP grade through one service instance per process, which is what
// makes the verdict cache worth having: two players answering the same authored
// item with the same words in the same match cost one model call, not two.

import type { FastifyBaseLogger } from "fastify";
import {
  DEFAULT_JUDGING_POLICY,
  GradingService,
  JsonLineReviewLog,
  MemoryLowConfidenceLedger,
  MemoryVerdictCache,
  TrueFoundryClassifierProvider,
  gradingModel,
  m1GradingPolicy,
  mintVerdictReceipt,
  providerConfigured,
  verdictEnvelope,
  verdictReceiptSecret,
  verifyVerdictReceipt,
  type VerdictEnvelope,
  type VerdictKind,
  type VerdictSource,
} from "@pa/grading";
import type { PvpRouteOptions } from "../routes/pvp.js";
import { pvpItemBank } from "./questionPool.js";
import { GradingSignal } from "../duels/gradingSignal.js";
import { combineWithEvidence } from "../duels/grading.js";

/**
 * @pa/duel's source vocabulary, restated as a runtime set.
 *
 * @pa/pvp declares the envelope's `kind` and `source` as strings because it takes
 * the verifier as an interface and must not depend on grading's build. Coming back
 * the other way the strings have to be narrowed, and an envelope carrying a word
 * outside the vocabulary is refused rather than coerced: a receipt that verifies
 * for a source the duel would reject is worse than one that fails here.
 */
const VERDICT_KINDS = new Set<string>(["CORRECT", "WRONG"]);
const VERDICT_SOURCES = new Set<string>([
  "CLASSIFIER",
  "GRADING_TIMEOUT",
  "ABSTAINED",
  "OPPONENT_AUTHORITY",
]);

interface WireEnvelope {
  readonly kind: string;
  readonly itemId: string;
  readonly itemVersion: string;
  readonly source: string;
  readonly responseRef: string | null;
}

function narrowEnvelope(envelope: WireEnvelope): VerdictEnvelope | null {
  if (!VERDICT_KINDS.has(envelope.kind)) return null;
  if (!VERDICT_SOURCES.has(envelope.source)) return null;
  return {
    kind: envelope.kind as VerdictKind,
    itemId: envelope.itemId,
    itemVersion: envelope.itemVersion,
    source: envelope.source as VerdictSource,
    responseRef: envelope.responseRef,
  };
}

export interface PvpGradingHealth {
  /** Whether a model call is possible at all. False means every round is granted. */
  readonly configured: boolean;
  readonly model: string | null;
  readonly policyId: string;
  readonly items: number;
}

/**
 * The grading half of `PvpRouteOptions`. Only the two functions this file is the
 * author of — `masteredConcepts` is progression's, and app.ts composes the whole.
 */
export interface PvpGrading
  extends Pick<PvpRouteOptions, "verifyReceipt" | "gradeAnswer"> {
  readonly health: PvpGradingHealth;
  /**
   * The rolling grading-fallback signal PvP rounds are recorded into, and the thing
   * that makes an outage in a ranked duel VISIBLE rather than a class of geniuses.
   * Every PvP round records into it, so /v1/health can report the fallback rate for
   * duels as well as boss fights. Shared with the duel's own signal when app.ts
   * injects it (see `createPvpGrading`'s `signal` option); its own otherwise.
   */
  readonly signal: GradingSignal;
}

export interface PvpGradingOptions {
  /**
   * A grading signal to record PvP rounds into, so PvP CONTRIBUTES TO THE SHARED
   * HEALTH DIAGNOSTICS instead of keeping a private count that /v1/health cannot see.
   *
   * THE EXACT app.ts WIRING THIS REQUIRES (integration owns app.ts; this is the
   * requirement stated precisely so it can be applied without guesswork):
   *
   *   const duelGrading = createDuelGrading(app.log);
   *   // …register duel routes as today…
   *   await registerPvpRoutes(app, {
   *     ...createPvpGrading(app.log, { signal: duelGrading.signal }),
   *     masteredConcepts,
   *   });
   *
   * Passing `duelGrading.signal` folds PvP rounds into the SAME rolling rate the boss
   * duel already reports on `/v1/health.grading`, so a grading outage during a ranked
   * PvP duel is visible on the endpoint the load balancer and the projector both
   * read. Left unset (as today), PvP builds its own signal and reports it on `signal`,
   * but that private signal is not surfaced on `/v1/health` until app.ts shares one.
   */
  readonly signal?: GradingSignal;
}

/**
 * Build the grading injection for `registerPvpRoutes`.
 *
 * The receipt binding is `{ profileId, attemptId: matchId, roundIndex }` on both
 * sides of the mint/verify pair, which is what stops a CORRECT from round one
 * being replayed at round six, lifted into another match, or used by the opponent.
 */
export function createPvpGrading(
  logger: FastifyBaseLogger,
  options: PvpGradingOptions = {},
): PvpGrading {
  // The PvP bank, not `m1ItemBank()`: an open-ended duel draws from a pool wider
  // than the six-round PvE rotation, and every item in that pool has to be
  // gradable. `eligiblePvpItems` intersects the draw with exactly this bank, so
  // the two cannot drift into serving a question nobody can grade.
  const bank = pvpItemBank();
  const authored = m1GradingPolicy();
  const configured = providerConfigured();
  if (!configured) {
    logger.warn(
      "pvp grading: no classifier credential; every duel round will grant the generous fallback",
    );
  }
  const service = new GradingService({
    bank,
    provider: configured ? new TrueFoundryClassifierProvider() : null,
    cache: new MemoryVerdictCache(),
    reviewLog: new JsonLineReviewLog((line) => logger.warn(line)),
    policy: {
      governingQuestion: DEFAULT_JUDGING_POLICY.governingQuestion,
      alwaysIgnore: authored.alwaysIgnore,
      neverSufficient: authored.neverSufficient,
    },
    lowConfidence: new MemoryLowConfidenceLedger(),
  });

  // Its own by default, the duel's when app.ts shares one. Either way every PvP
  // round is recorded, so a grading outage during a ranked duel shows up in the
  // same rate a boss fight's rounds do rather than being invisible.
  const signal = options.signal ?? new GradingSignal({ configured });

  return {
    verifyReceipt: (envelope, binding, receipt) => {
      const narrowed = narrowEnvelope(envelope);
      if (!narrowed) return false;
      return verifyVerdictReceipt(
        narrowed,
        binding,
        receipt,
        verdictReceiptSecret(),
      );
    },
    gradeAnswer: async (input) => {
      // The answer text ends here. It goes to the classifier and to nothing else:
      // it is not retained (PvP has no answer-review surface yet, so there is no
      // reader for it), never written to the match, and never projected.
      const verdict = await service.grade({
        itemId: input.itemId,
        answer: input.answerText,
        profileId: input.profileId,
        attemptId: input.matchId,
        roundIndex: input.roundIndex,
        responseRef: null,
      });
      // Recorded on every round, not just the failures: the denominator is what makes
      // "granted without grading" a rate rather than a count, and a fallback count
      // without a round count cannot tell a bad minute from a dead gateway.
      signal.record(logger, {
        profileId: input.profileId,
        duelId: input.matchId,
        roundIndex: input.roundIndex,
        itemId: input.itemId,
        path: verdict.provenance.path,
        latencyMs: verdict.provenance.latencyMs,
        fallbackReason: verdict.provenance.fallbackReason,
        fallbackDiagnosis: verdict.provenance.fallbackDiagnosis,
        fallbackStatus: verdict.provenance.fallbackStatus,
      });
      // Prose AND evidence, combined exactly as the boss duel does: a CLASSIFIER
      // CORRECT with unsatisfied evidence becomes WRONG before the receipt is minted;
      // a generous grant is never downgraded.
      const envelope = combineWithEvidence(
        verdictEnvelope(verdict),
        input.evidenceSatisfied,
      );
      return {
        envelope,
        receipt: mintVerdictReceipt(
          envelope,
          {
            profileId: input.profileId,
            attemptId: input.matchId,
            roundIndex: input.roundIndex,
          },
          verdictReceiptSecret(),
        ),
      };
    },
    signal,
    health: {
      configured,
      model: configured ? gradingModel() : null,
      policyId: authored.policyId,
      items: bank.size,
    },
  };
}
