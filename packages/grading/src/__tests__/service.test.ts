import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { compilePool, ItemBank, type AuthoredPool } from "../rubric.js";
import { GradingService, UnknownItemError, projectVerdict } from "../service.js";
import { MemoryVerdictCache } from "../cache.js";
import { MemoryReviewLog } from "../reviewLog.js";
import { MemoryLowConfidenceLedger } from "../lowConfidence.js";
import {
  ProviderNotConfiguredError,
  ProviderRejectedError,
  ProviderUnreachableError,
  RetryableProviderError,
} from "../provider.js";
import type { ClassifierProvider, ProviderResult } from "../provider.js";
import { CIRCUIT_FAILURE_THRESHOLD } from "../tuning.js";

const POOL: AuthoredPool = {
  poolId: "POOL.T.v1",
  conceptId: "CONCEPT.T.v1",
  idPrefix: "T.DUEL",
  idSuffix: ".v1",
  items: [
    {
      id: "BOTH",
      ask: "Why did the tax arrive?",
      correct: "there was a debt and the colonies were to pay it",
      ideas: ["there was a debt", "the colonies were to pay it"],
      accept: ["debt, and we pay", "they owed money so we pay"],
      reject: ["the weather"],
    },
    {
      id: "EITHER",
      ask: "Name a cause.",
      correct: "the debt, or the need for revenue",
      ideas: ["the debt", "the need for revenue"],
      needs: 1,
      accept: ["debt", "they needed money"],
      reject: ["the weather"],
    },
  ],
};

const bank = new ItemBank([compilePool(POOL)]);
const BOTH = "T.DUEL.BOTH.v1";
const EITHER = "T.DUEL.EITHER.v1";

const request = (itemId: string, answer: string) => ({
  itemId,
  answer,
  profileId: "p1",
  attemptId: "a1",
  roundIndex: 2,
});

function stub(raw: unknown, onCall?: () => void): ClassifierProvider {
  return {
    classify: async (): Promise<ProviderResult> => {
      onCall?.();
      return { raw, model: "stub-model", promptTokens: 210, completionTokens: 12 };
    },
  };
}

function thrower(error: Error, onCall?: () => void): ClassifierProvider {
  return {
    classify: async () => {
      onCall?.();
      throw error;
    },
  };
}

const abortError = (): Error => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

describe("the author's line is applied by code, not by the model", () => {
  const item = bank.get(BOTH)!;
  const either = bank.get(EITHER)!;

  it("requires every idea when needs is all", () => {
    assert.equal(
      projectVerdict(item, {
        ideas: { i1: true, i2: false },
        answers: true,
        confidence: "HIGH",
      }).kind,
      "WRONG",
    );
    assert.equal(
      projectVerdict(item, {
        ideas: { i1: true, i2: true },
        answers: true,
        confidence: "HIGH",
      }).kind,
      "CORRECT",
    );
  });

  it("requires only the authored count when the line sits lower", () => {
    assert.equal(
      projectVerdict(either, {
        ideas: { i1: true, i2: false },
        answers: true,
        confidence: "HIGH",
      }).kind,
      "CORRECT",
    );
    assert.equal(
      projectVerdict(either, {
        ideas: { i1: false, i2: false },
        answers: true,
        confidence: "HIGH",
      }).kind,
      "WRONG",
    );
  });

  it("overrides the idea booleans when the text is not an answer at all", () => {
    const projected = projectVerdict(item, {
      ideas: { i1: true, i2: true },
      answers: false,
      confidence: "HIGH",
    });
    assert.equal(projected.kind, "WRONG");
    assert.deepEqual(projected.ideasPresent, []);
  });
});

describe("the hot path", () => {
  it("throws on an unknown item rather than granting anything", async () => {
    const service = new GradingService({ bank, provider: stub(null) });
    await assert.rejects(
      () => service.grade(request("NOPE", "answer")),
      UnknownItemError,
    );
  });

  it("abstains on an empty answer with no model call", async () => {
    let calls = 0;
    const service = new GradingService({
      bank,
      provider: stub(null, () => (calls += 1)),
    });
    const verdict = await service.grade(request(BOTH, "   \n "));
    assert.equal(verdict.kind, "WRONG");
    assert.equal(verdict.source, "ABSTAINED");
    assert.equal(verdict.provenance.path, "PRE_CHECK");
    assert.equal(calls, 0);
  });

  it("records provenance a reviewer can act on", async () => {
    const service = new GradingService({
      bank,
      provider: stub({
        ideas: { i1: true, i2: false },
        answers: true,
        confidence: "MEDIUM",
      }),
    });
    const verdict = await service.grade(request(BOTH, "there was a debt"));
    assert.equal(verdict.kind, "WRONG");
    assert.equal(verdict.itemVersion, bank.get(BOTH)!.rubricVersion);
    assert.equal(verdict.provenance.path, "MODEL");
    assert.deepEqual(verdict.provenance.ideasPresent, ["i1"]);
    assert.equal(verdict.provenance.ideasRequired, 2);
    assert.equal(verdict.provenance.ideasTotal, 2);
    assert.equal(verdict.provenance.model, "stub-model");
    assert.equal(verdict.provenance.promptTokens, 210);
    assert.ok(verdict.provenance.cacheKey.length > 0);
  });
});

describe("the cache", () => {
  it("serves the second identical answer without a model call", async () => {
    let calls = 0;
    const service = new GradingService({
      bank,
      provider: stub(
        { ideas: { i1: true, i2: true }, answers: true, confidence: "HIGH" },
        () => (calls += 1),
      ),
      cache: new MemoryVerdictCache(),
    });
    const first = await service.grade(request(BOTH, "debt, and we pay"));
    const second = await service.grade(request(BOTH, "DEBT,  and we pay!"));
    assert.equal(calls, 1, "the normalised answer should have hit the cache");
    assert.equal(first.provenance.path, "MODEL");
    assert.equal(second.provenance.path, "CACHE");
    assert.equal(second.kind, "CORRECT");
    assert.equal(service.cacheStats.hits, 1);
  });

  it("does not share entries across items", async () => {
    let calls = 0;
    const service = new GradingService({
      bank,
      provider: stub(
        { ideas: { i1: true, i2: true }, answers: true, confidence: "HIGH" },
        () => (calls += 1),
      ),
      cache: new MemoryVerdictCache(),
    });
    await service.grade(request(BOTH, "the debt"));
    await service.grade(request(EITHER, "the debt"));
    assert.equal(calls, 2);
  });

  it("does not cache a fallback, so an outage does not poison the day", async () => {
    const cache = new MemoryVerdictCache();
    const service = new GradingService({
      bank,
      provider: thrower(abortError()),
      cache,
    });
    await service.grade(request(BOTH, "a real answer"));
    assert.equal(cache.size, 0);
  });
});

describe("failing generous", () => {
  it("grants the maximum on timeout and marks it for review", async () => {
    const reviewLog = new MemoryReviewLog();
    const service = new GradingService({
      bank,
      provider: thrower(abortError()),
      reviewLog,
    });
    const verdict = await service.grade(request(BOTH, "an answer that never got graded"));
    assert.equal(verdict.kind, "CORRECT");
    assert.equal(verdict.source, "GRADING_TIMEOUT");
    assert.equal(verdict.provenance.fallbackReason, "TIMEOUT");
    assert.equal(verdict.provenance.fallbackDiagnosis, "DEADLINE_EXCEEDED");
    assert.equal(verdict.provenance.needsReview, true);
    assert.equal(reviewLog.countOf("TIMEOUT_GRANT"), 1);
    const entry = reviewLog.entries[0];
    assert.equal(entry?.profileId, "p1");
    assert.equal(entry?.roundIndex, 2);
    assert.ok(entry?.answerHash.length ?? 0 > 0);
    assert.equal(entry?.answerText, undefined, "no plaintext answer in the log");
  });

  it("honours the deadline in wall-clock time", async () => {
    const slow: ClassifierProvider = {
      classify: (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(abortError()));
        }),
    };
    const service = new GradingService({ bank, provider: slow, timeoutMs: 60 });
    const started = Date.now();
    const verdict = await service.grade(request(BOTH, "an answer"));
    const elapsed = Date.now() - started;
    assert.equal(verdict.kind, "CORRECT");
    assert.equal(verdict.provenance.fallbackReason, "TIMEOUT");
    assert.ok(elapsed < 1_000, `returned in ${elapsed}ms, should be near the 60ms cap`);
  });

  it("grants the maximum on malformed model output", async () => {
    const service = new GradingService({ bank, provider: stub({ nonsense: true }) });
    const verdict = await service.grade(request(BOTH, "an answer"));
    assert.equal(verdict.kind, "CORRECT");
    assert.equal(verdict.provenance.fallbackReason, "MALFORMED_OUTPUT");
  });

  it("grants the maximum with no provider configured", async () => {
    const service = new GradingService({ bank, provider: null });
    const verdict = await service.grade(request(BOTH, "an answer"));
    assert.equal(verdict.kind, "CORRECT");
    assert.equal(verdict.provenance.fallbackReason, "NOT_CONFIGURED");
    assert.equal(verdict.provenance.fallbackDiagnosis, "NO_CREDENTIAL");
  });

  it("retries once on a 429 within budget, then grants", async () => {
    let calls = 0;
    const service = new GradingService({
      bank,
      provider: thrower(new RetryableProviderError(429), () => (calls += 1)),
    });
    const verdict = await service.grade(request(BOTH, "an answer"));
    assert.equal(calls, 2, "one retry inside the 1.5s budget");
    assert.equal(verdict.provenance.fallbackReason, "PROVIDER_ERROR");
    assert.equal(verdict.provenance.fallbackDiagnosis, "PROVIDER_REJECTED");
    assert.equal(verdict.provenance.fallbackStatus, 429);
    assert.equal(verdict.kind, "CORRECT");
  });

  it("does not retry when the remaining budget is too small to matter", async () => {
    let calls = 0;
    const service = new GradingService({
      bank,
      provider: thrower(new RetryableProviderError(503), () => (calls += 1)),
      timeoutMs: 100,
    });
    await service.grade(request(BOTH, "an answer"));
    assert.equal(calls, 1);
  });
});

describe("failing generous, but saying which failure it was", () => {
  // WHY THIS BLOCK EXISTS. Every fallback below grants CORRECT and reports
  // `source: "GRADING_TIMEOUT"`, and that is correct and must stay: a student
  // never loses a mission to infrastructure, and the duel derives fourteen
  // bullets from that one word. What was NOT correct is that it was the only word
  // available. A duel run against a gateway with no route to it returned
  // GRADING_TIMEOUT in eight milliseconds and a review-log entry that said
  // TIMEOUT_GRANT, so a broken gateway, a wrong model name, a missing credential
  // and a genuinely slow model were one indistinguishable condition. The elapsed
  // time was the only thing that told them apart, and reading latency to discover
  // that nothing is being graded is not a diagnostic.
  const cases: readonly [string, Error, string, number | null][] = [
    [
      "an unreachable gateway",
      new ProviderUnreachableError(new Error("fetch failed")),
      "PROVIDER_UNREACHABLE",
      null,
    ],
    ["a refused request", new ProviderRejectedError(403), "PROVIDER_REJECTED", 403],
    [
      "a credential that vanished after boot",
      new ProviderNotConfiguredError("no key"),
      "NO_CREDENTIAL",
      null,
    ],
  ];

  for (const [label, error, diagnosis, status] of cases) {
    it(`names ${label} as ${diagnosis} without calling it a timeout`, async () => {
      const reviewLog = new MemoryReviewLog();
      const service = new GradingService({ bank, provider: thrower(error), reviewLog });
      const verdict = await service.grade(request(BOTH, "an answer"));

      assert.equal(verdict.kind, "CORRECT", "the generous grant is unchanged");
      assert.equal(verdict.source, "GRADING_TIMEOUT", "the wire vocabulary is unchanged");
      assert.equal(verdict.provenance.fallbackDiagnosis, diagnosis);
      assert.equal(verdict.provenance.fallbackStatus, status);
      // The review log is the evidence for the grant. It must not call this a
      // timeout either.
      assert.equal(reviewLog.countOf("TIMEOUT_GRANT"), 0);
      assert.equal(reviewLog.countOf("UNGRADED_GRANT"), 1);
      assert.equal(reviewLog.entries[0]?.fallbackDiagnosis, diagnosis);
      assert.equal(reviewLog.entries[0]?.fallbackStatus, status);
    });
  }

  it("keeps the coarse reason a caller outside this package may be reading", async () => {
    // `packages/assessment` mirrors `FallbackReason` structurally and refuses any
    // verdict carrying one. Those five values are frozen; the diagnosis is the
    // field that got finer.
    for (const [error, reason] of [
      [new ProviderUnreachableError(new Error("x")), "PROVIDER_ERROR"],
      [new ProviderRejectedError(404), "PROVIDER_ERROR"],
      [new Error("something nobody classified"), "PROVIDER_ERROR"],
    ] as const) {
      const service = new GradingService({ bank, provider: thrower(error) });
      const verdict = await service.grade(request(BOTH, "an answer"));
      assert.equal(verdict.provenance.fallbackReason, reason);
    }
  });

  it("does not guess a cause for an error it cannot classify", async () => {
    const service = new GradingService({
      bank,
      provider: thrower(new Error("upstream exploded")),
    });
    const verdict = await service.grade(request(BOTH, "an answer"));
    // Naming this UNREACHABLE would put a wrong cause in front of whoever is
    // debugging it, which is the failure this whole change is about.
    assert.equal(verdict.provenance.fallbackDiagnosis, "PROVIDER_FAILED");
  });

  it("still calls a real deadline overrun a timeout", async () => {
    const reviewLog = new MemoryReviewLog();
    const never: ClassifierProvider = {
      classify: (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(abortError()));
        }),
    };
    const service = new GradingService({
      bank,
      provider: never,
      reviewLog,
      timeoutMs: 40,
    });
    const verdict = await service.grade(request(BOTH, "an answer"));
    assert.equal(verdict.provenance.fallbackDiagnosis, "DEADLINE_EXCEEDED");
    assert.equal(reviewLog.countOf("TIMEOUT_GRANT"), 1, "the one honest timeout");
    assert.equal(reviewLog.countOf("UNGRADED_GRANT"), 0);
  });

  it("names an open breaker rather than reporting the round it short-circuited", async () => {
    const service = new GradingService({
      bank,
      provider: thrower(new ProviderRejectedError(401)),
    });
    for (let call = 0; call < CIRCUIT_FAILURE_THRESHOLD; call += 1) {
      await service.grade(request(BOTH, `answer ${call}`));
    }
    const open = await service.grade(request(BOTH, "one more"));
    assert.equal(open.provenance.fallbackDiagnosis, "CIRCUIT_OPEN");
    assert.equal(open.provenance.fallbackReason, "CIRCUIT_OPEN");
  });
});

describe("low confidence grants, counts, and then stops", () => {
  const lowWrong = () =>
    stub({ ideas: { i1: false, i2: false }, answers: true, confidence: "LOW" });

  it("grants inside the session allowance", async () => {
    const reviewLog = new MemoryReviewLog();
    const service = new GradingService({
      bank,
      provider: lowWrong(),
      reviewLog,
      lowConfidence: new MemoryLowConfidenceLedger(2),
    });
    const verdict = await service.grade(request(BOTH, "something confusing"));
    // Unusual-but-correct is the population being protected. A first strange answer
    // gets its bullets.
    assert.equal(verdict.kind, "CORRECT");
    assert.equal(verdict.source, "CLASSIFIER");
    assert.equal(verdict.provenance.lowConfidenceOutcome, "GRANTED");
    assert.equal(verdict.provenance.lowConfidenceGrants, 1);
    assert.equal(reviewLog.countOf("LOW_CONFIDENCE"), 1);
  });

  it("stops granting past the allowance and flags the account", async () => {
    const reviewLog = new MemoryReviewLog();
    const ledger = new MemoryLowConfidenceLedger(2);
    const service = new GradingService({
      bank,
      provider: lowWrong(),
      reviewLog,
      lowConfidence: ledger,
    });
    const kinds: string[] = [];
    for (let round = 0; round < 4; round += 1) {
      const verdict = await service.grade({
        ...request(BOTH, `confusing answer ${round}`),
        roundIndex: round,
      });
      kinds.push(verdict.kind);
    }
    // The exploit only pays if it repeats, so the repetition is what is removed.
    assert.deepEqual(kinds, ["CORRECT", "CORRECT", "WRONG", "WRONG"]);
    assert.deepEqual(ledger.flaggedProfiles, ["p1"]);
    assert.equal(reviewLog.countOf("LOW_CONFIDENCE"), 2);
    assert.equal(reviewLog.countOf("LOW_CONFIDENCE_LIMIT"), 2);
  });

  it("counts the allowance per profile, so one student cannot spend another's", async () => {
    const ledger = new MemoryLowConfidenceLedger(1);
    const service = new GradingService({
      bank,
      provider: lowWrong(),
      lowConfidence: ledger,
    });
    const first = await service.grade({ ...request(BOTH, "odd one"), profileId: "a" });
    const second = await service.grade({ ...request(BOTH, "odd two"), profileId: "a" });
    const other = await service.grade({ ...request(BOTH, "odd three"), profileId: "b" });
    assert.equal(first.kind, "CORRECT");
    assert.equal(second.kind, "WRONG");
    assert.equal(other.kind, "CORRECT", "a second student has their own allowance");
  });

  it("does not spend the allowance on a LOW-confidence CORRECT", async () => {
    // Nothing to grant and nothing to farm. Spending the allowance here would let a
    // student exhaust their own protection on answers that were already right.
    const ledger = new MemoryLowConfidenceLedger(1);
    const service = new GradingService({
      bank,
      provider: stub({
        ideas: { i1: true, i2: true },
        answers: true,
        confidence: "LOW",
      }),
      lowConfidence: ledger,
    });
    const verdict = await service.grade(request(BOTH, "odd but right"));
    assert.equal(verdict.kind, "CORRECT");
    assert.equal(verdict.provenance.lowConfidenceOutcome, null);
    assert.deepEqual(ledger.flaggedProfiles, []);
  });

  it("consults the allowance on a cache hit too, so a grant cannot be replayed", async () => {
    // The cache holds the classifier's reading, not the granted verdict. Otherwise
    // one lucky grant would return CORRECT free of charge for the rest of the day,
    // which is an unlimited version of the exploit the allowance exists to close.
    const cache = new MemoryVerdictCache();
    const service = new GradingService({
      bank,
      provider: lowWrong(),
      cache,
      lowConfidence: new MemoryLowConfidenceLedger(1),
    });
    const first = await service.grade(request(BOTH, "same confusing answer"));
    const second = await service.grade(request(BOTH, "same confusing answer"));
    assert.equal(first.provenance.path, "MODEL");
    assert.equal(second.provenance.path, "CACHE");
    assert.equal(first.kind, "CORRECT");
    assert.equal(second.kind, "WRONG", "the cache must not replay the grant");
  });

  it("resets the count on a new window but keeps the flag", async () => {
    let clock = 1_000_000;
    const ledger = new MemoryLowConfidenceLedger(1, 60_000, () => clock);
    const service = new GradingService({
      bank,
      provider: lowWrong(),
      lowConfidence: ledger,
    });
    await service.grade(request(BOTH, "one"));
    const spent = await service.grade(request(BOTH, "two"));
    assert.equal(spent.kind, "WRONG");
    assert.ok(ledger.isFlagged("p1"));
    clock += 61_000;
    const fresh = await service.grade(request(BOTH, "three"));
    assert.equal(fresh.kind, "CORRECT", "a new sitting is not punished for the last one");
    assert.ok(ledger.isFlagged("p1"), "the flag waits for a human, not for a clock");
  });

  it("flags a partial-idea WRONG as false-negative risk", async () => {
    const reviewLog = new MemoryReviewLog();
    const service = new GradingService({
      bank,
      provider: stub({
        ideas: { i1: true, i2: false },
        answers: true,
        confidence: "HIGH",
      }),
      reviewLog,
    });
    await service.grade(request(BOTH, "there was a debt"));
    assert.equal(reviewLog.countOf("FALSE_NEGATIVE_RISK"), 1);
  });

  it("does not flag a clean CORRECT", async () => {
    const reviewLog = new MemoryReviewLog();
    const service = new GradingService({
      bank,
      provider: stub({
        ideas: { i1: true, i2: true },
        answers: true,
        confidence: "HIGH",
      }),
      reviewLog,
    });
    const verdict = await service.grade(request(BOTH, "debt and we pay"));
    assert.equal(verdict.provenance.needsReview, false);
    assert.equal(reviewLog.entries.length, 0);
  });
});

describe("the circuit breaker", () => {
  it("stops spending the budget once the provider is clearly down", async () => {
    let calls = 0;
    const service = new GradingService({
      bank,
      provider: thrower(abortError(), () => (calls += 1)),
    });
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      await service.grade(request(BOTH, `answer ${i}`));
    }
    const callsBefore = calls;
    const verdict = await service.grade(request(BOTH, "answer after the breaker opened"));
    assert.equal(calls, callsBefore, "no further provider calls while open");
    assert.equal(verdict.kind, "CORRECT");
    assert.equal(verdict.provenance.fallbackReason, "CIRCUIT_OPEN");
  });
});
