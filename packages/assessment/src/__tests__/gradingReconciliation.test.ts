// The reconciliation with @pa/grading, verified against the real service.
//
// `gradingAdapter.ts` mirrors grading's verdict shape structurally rather than
// importing it, for the reasons argued there. A structural mirror is only as good
// as its verification, so this file builds a REAL `GradingService` over a real
// authored `ItemBank` and drives its actual code paths — the not-configured
// fallback, the timeout fallback, the empty-answer pre-check, and a successful
// classification — through the adapter.
//
// That is stronger than asserting a copied interface compiles. It catches a
// change in grading's BEHAVIOUR, which is the thing that would actually hurt: if
// someone made low confidence grant, or added a sixth fallback reason, or renamed
// a source, this test fails rather than the mirror silently going stale.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GradingService,
  ItemBank as GradingItemBank,
  NoGrantLowConfidenceLedger,
  compilePool,
  type ClassifierProvider,
} from "@pa/grading";
import {
  ASSESSMENT_CONSUMES_TIMEOUT_GRANTS,
  ASSESSMENT_GRANTS_ON_LOW_CONFIDENCE,
  adaptGradedVerdict,
  assessmentGradingAuthority,
  assessmentGradingProvenance,
  verdictWasActuallyGraded,
} from "../index.js";

const POOL = {
  poolId: "TST.POOL.POSTWAR",
  conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
  idPrefix: "TST.POSTWAR",
  idSuffix: ".v1",
  items: [
    {
      id: "WHY_NOW",
      ask: "Why did Parliament start taxing the colonies in 1765?",
      correct:
        "The war with France ended in 1763 and left Britain carrying its debt, " +
        "so Parliament looked to the colonies for revenue against it.",
      ideas: ["the war left Britain in debt", "the colonies as the intended payer"],
      accept: ["britain owed money after the war so they taxed us"],
      reject: ["because the king was greedy"],
    },
  ],
} as const;

function service(
  provider: ClassifierProvider | null,
  options: { timeoutMs?: number; noLowConfidenceGrants?: boolean } = {},
): { svc: GradingService; itemId: string } {
  const bank = new GradingItemBank([compilePool(POOL)]);
  const itemId = bank.items[0]!.itemId;
  return {
    svc: new GradingService({
      bank,
      provider,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      // The assessment's setting. See the low-confidence tests below.
      ...(options.noLowConfidenceGrants
        ? { lowConfidence: new NoGrantLowConfidenceLedger() }
        : {}),
    }),
    itemId,
  };
}

/** The duel-shaped request grading takes. `roundIndex` is the mismatch, reported. */
function duelShapedRequest(itemId: string, answer: string) {
  return {
    itemId,
    answer,
    profileId: "11111111-2222-4333-8444-555555555555",
    attemptId: "00000000-0000-4000-8000-000000000001",
    roundIndex: 0,
  };
}

// ---------------------------------------------------------------------------
// The policy split
// ---------------------------------------------------------------------------

test("grading really does grant CORRECT when it is not configured", async () => {
  const { svc, itemId } = service(null);
  const graded = await svc.grade(duelShapedRequest(itemId, "something plausible"));

  // This is the duel's policy, working as designed. Recorded here so the split
  // is visible as a difference in behaviour rather than only as prose.
  assert.equal(graded.kind, "CORRECT");
  assert.equal(graded.source, "GRADING_TIMEOUT");
  assert.equal(graded.provenance.fallbackReason, "NOT_CONFIGURED");
  assert.equal(verdictWasActuallyGraded(graded), false);
});

test("the adapter refuses that grant instead of turning it into mastery", async () => {
  const { svc, itemId } = service(null);
  const graded = await svc.grade(duelShapedRequest(itemId, "something plausible"));

  const adapted = adaptGradedVerdict(graded);
  assert.equal(adapted.ok, false);
  assert.equal(adapted.ok === false && adapted.code, "GRADER_UNAVAILABLE");
  assert.match(
    adapted.ok === false ? adapted.detail : "",
    /NOT_CONFIGURED/,
    "the reason survives so an operator can see which failure it was",
  );
  assert.equal(ASSESSMENT_CONSUMES_TIMEOUT_GRANTS, false);
});

test("a real provider timeout is refused too", async () => {
  const slow: ClassifierProvider = {
    async classify() {
      await new Promise((resolve) => setTimeout(resolve, 60));
      throw new Error("should have been aborted");
    },
  };
  const { svc, itemId } = service(slow, { timeoutMs: 10 });
  const graded = await svc.grade(duelShapedRequest(itemId, "the war debt"));

  assert.equal(graded.kind, "CORRECT", "grading grants, as the duel needs");
  assert.ok(graded.provenance.fallbackReason);
  assert.equal(adaptGradedVerdict(graded).ok, false, "the capstone does not take it");
});

test("a provider error is refused", async () => {
  const broken: ClassifierProvider = {
    async classify() {
      throw new Error("upstream exploded");
    },
  };
  const { svc, itemId } = service(broken);
  const graded = await svc.grade(duelShapedRequest(itemId, "the war debt"));

  assert.equal(graded.provenance.fallbackReason, "PROVIDER_ERROR");
  assert.equal(adaptGradedVerdict(graded).ok, false);
});

test("malformed model output is refused rather than granted", async () => {
  const nonsense: ClassifierProvider = {
    async classify(): Promise<{ raw: unknown; model: string }> {
      return { raw: { ideas: { nope: 1 }, answers: "yes" }, model: "test" };
    },
  };
  const { svc, itemId } = service(nonsense);
  const graded = await svc.grade(duelShapedRequest(itemId, "the war debt"));

  assert.equal(graded.provenance.fallbackReason, "MALFORMED_OUTPUT");
  assert.equal(adaptGradedVerdict(graded).ok, false);
});

// ---------------------------------------------------------------------------
// The paths the adapter does accept
// ---------------------------------------------------------------------------

function classifierReturning(
  ideas: Record<string, boolean>,
  confidence: "LOW" | "MEDIUM" | "HIGH",
  answers = true,
): ClassifierProvider {
  return {
    // `raw` is the already-parsed object, not a JSON string: grading's provider
    // contract puts the JSON decode on the provider's side of the boundary.
    async classify(): Promise<{ raw: unknown; model: string }> {
      return { raw: { answers, ideas, confidence }, model: "test-model" };
    },
  };
}

test("a real correct classification becomes a CORRECT assessment verdict", async () => {
  const { svc, itemId } = service(
    classifierReturning({ i1: true, i2: true }, "HIGH"),
  );
  const graded = await svc.grade(
    duelShapedRequest(itemId, "britain owed money after the war so they taxed us"),
  );

  assert.equal(graded.kind, "CORRECT");
  assert.equal(graded.source, "CLASSIFIER");
  assert.equal(verdictWasActuallyGraded(graded), true);

  const adapted = adaptGradedVerdict(graded);
  assert.equal(adapted.ok, true);
  assert.equal(adapted.ok && adapted.verdict.kind, "CORRECT");
  assert.equal(adapted.ok && adapted.verdict.source, "CLASSIFIER");
});

test("a wrong classification becomes INCORRECT, not a refusal", async () => {
  const { svc, itemId } = service(classifierReturning({ i1: false, i2: false }, "HIGH"));
  const graded = await svc.grade(duelShapedRequest(itemId, "because the king was greedy"));

  const adapted = adaptGradedVerdict(graded);
  assert.equal(adapted.ok, true);
  assert.equal(adapted.ok && adapted.verdict.kind, "INCORRECT");
});

test("grading's ABSTAINED becomes the assessment's UNANSWERED, still wrong", async () => {
  const { svc, itemId } = service(classifierReturning({ i1: true, i2: true }, "HIGH"));
  const graded = await svc.grade(duelShapedRequest(itemId, "   "));

  assert.equal(graded.source, "ABSTAINED", "grading's pre-check, no model call");
  const adapted = adaptGradedVerdict(graded);
  assert.equal(adapted.ok, true);
  assert.equal(adapted.ok && adapted.verdict.source, "UNANSWERED");
  assert.equal(adapted.ok && adapted.verdict.kind, "INCORRECT");
});

// ---------------------------------------------------------------------------
// Low confidence
// ---------------------------------------------------------------------------

test("grading's DEFAULT low-confidence policy grants, which is the duel's ruling", async () => {
  const { svc, itemId } = service(classifierReturning({ i1: false, i2: false }, "LOW"));
  const graded = await svc.grade(duelShapedRequest(itemId, "something odd"));

  // The classifier read this as WRONG. The default ledger grants anyway, up to
  // two per profile per session window, so a genuinely odd correct answer still
  // earns its bullets. Correct for a duel; recorded here because it is exactly
  // what must not reach a capstone.
  assert.equal(graded.kind, "CORRECT");
  assert.equal(graded.provenance.confidence, "LOW");
  assert.equal(graded.provenance.needsReview, true);
});

test("the assessment turns that grant off, and the classifier's reading stands", async () => {
  const { svc, itemId } = service(
    classifierReturning({ i1: false, i2: false }, "LOW"),
    { noLowConfidenceGrants: true },
  );
  const graded = await svc.grade(duelShapedRequest(itemId, "something odd"));

  assert.equal(
    graded.kind,
    "WRONG",
    "no grant: mastery and a permanent PvP card are not handed out on a maybe",
  );
  assert.equal(graded.provenance.needsReview, true);

  const adapted = adaptGradedVerdict(graded);
  assert.equal(adapted.ok, true, "the verdict is not withheld pending a queue");
  assert.equal(adapted.ok && adapted.verdict.kind, "INCORRECT");
  assert.equal(
    adapted.ok && adapted.verdict.needsReview,
    true,
    "it flags instead, and a VERDICT_OVERRIDDEN repairs it after a human reads it",
  );
  assert.equal(ASSESSMENT_GRANTS_ON_LOW_CONFIDENCE, false);
});

test("a low-confidence CORRECT is left alone either way, and still flagged", async () => {
  for (const noLowConfidenceGrants of [false, true]) {
    const { svc, itemId } = service(
      classifierReturning({ i1: true, i2: true }, "LOW"),
      { noLowConfidenceGrants },
    );
    const graded = await svc.grade(duelShapedRequest(itemId, "war debt, colonies pay"));

    const adapted = adaptGradedVerdict(graded);
    assert.equal(adapted.ok && adapted.verdict.kind, "CORRECT");
    assert.equal(adapted.ok && adapted.verdict.needsReview, true);
  }
});

test("the grant is rate-limited, which is why it cannot be the assessment's answer", async () => {
  // Three low-confidence wrongs in one session, default ledger. The first two are
  // granted and the third is not — so the SAME input produces a different verdict
  // depending on hidden per-session state. In a duel that is the point. On the
  // capstone it would mean a replay of the committed log could not reproduce the
  // grade, which is disqualifying for the assessment of record.
  const { svc, itemId } = service(classifierReturning({ i1: false, i2: false }, "LOW"));
  const kinds: string[] = [];
  for (const answer of ["odd one", "odd two", "odd three"]) {
    kinds.push((await svc.grade(duelShapedRequest(itemId, answer))).kind);
  }

  assert.deepEqual(kinds, ["CORRECT", "CORRECT", "WRONG"]);
  assert.deepEqual(
    [...svc.flaggedProfiles],
    ["11111111-2222-4333-8444-555555555555"],
  );
});

// ---------------------------------------------------------------------------
// Properties the adapter relies on
// ---------------------------------------------------------------------------

test("a generous grant is never cached, so it cannot reappear as a clean grade", async () => {
  const { svc, itemId } = service(null);
  const answer = "an answer that will be granted on the fallback path";
  const first = await svc.grade(duelShapedRequest(itemId, answer));
  assert.equal(first.provenance.fallbackReason, "NOT_CONFIGURED");

  const second = await svc.grade(duelShapedRequest(itemId, answer));
  assert.notEqual(
    second.provenance.path,
    "CACHE",
    "if grants were cached, a later assessment would read one as a CLASSIFIER grade",
  );
  assert.equal(adaptGradedVerdict(second).ok, false);
});

test("a real grade IS cached, and the cached form is still accepted", async () => {
  const { svc, itemId } = service(classifierReturning({ i1: true, i2: true }, "HIGH"));
  const answer = "the war with france left debt and the colonies were to pay it";
  await svc.grade(duelShapedRequest(itemId, answer));
  const second = await svc.grade(duelShapedRequest(itemId, answer));

  assert.equal(second.provenance.path, "CACHE");
  const adapted = adaptGradedVerdict(second);
  assert.equal(adapted.ok, true, "a memoised real classification is still a real one");
  assert.equal(adapted.ok && adapted.verdict.kind, "CORRECT");
});

test("the authority wrapper refuses a verdict minted for a different item", async () => {
  const authority = assessmentGradingAuthority({
    async grade() {
      const { svc, itemId } = service(
        classifierReturning({ i1: true, i2: true }, "HIGH"),
      );
      return svc.grade(duelShapedRequest(itemId, "the war debt and the colonies"));
    },
  });

  const result = await authority.grade({
    kind: "OPEN_RESPONSE",
    itemId: "TST.SOME.OTHER.ITEM",
    itemVersion: "v1",
    responseRef: "resp-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "GRADER_UNAVAILABLE");
  assert.match(result.ok === false ? result.detail : "", /asked for/);
});

test("an unknown item is a content defect, not an outage", async () => {
  const { svc } = service(classifierReturning({ i1: true }, "HIGH"));
  const authority = assessmentGradingAuthority({
    async grade(submission) {
      return svc.grade(duelShapedRequest(submission.itemId, "anything"));
    },
  });

  const result = await authority.grade({
    kind: "OPEN_RESPONSE",
    itemId: "TST.NOT.IN.THE.BANK",
    itemVersion: "v1",
    responseRef: "resp-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "NO_KEY_FOR_ITEM");
});

test("grading provenance projects the fields a review queue needs", async () => {
  const { svc, itemId } = service(classifierReturning({ i1: true, i2: false }, "MEDIUM"));
  const graded = await svc.grade(duelShapedRequest(itemId, "just the debt half"));
  const provenance = assessmentGradingProvenance(graded);

  assert.equal(provenance.itemId, itemId);
  assert.equal(provenance.conceptId, "BOS.CONCEPT.POSTWAR_REVENUE.v1");
  assert.equal(provenance.ideasRequired, 2);
  assert.deepEqual([...provenance.ideasPresent], ["i1"]);
  assert.equal(provenance.path, "MODEL");
  assert.equal(
    provenance.needsReview,
    true,
    "a wrong answer carrying some ideas is the shape a false negative takes",
  );
});
