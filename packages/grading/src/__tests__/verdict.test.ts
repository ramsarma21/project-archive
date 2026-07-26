import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  mintVerdictReceipt,
  verdictEnvelope,
  verifyVerdictReceipt,
  type GradedVerdict,
  type ReceiptBinding,
  type VerdictEnvelope,
} from "../verdict.js";
import {
  resetVerdictReceiptSecretCache,
  verdictReceiptSecret,
  ReceiptSecretMissingError,
} from "../receiptSecret.js";

const graded: GradedVerdict = {
  kind: "CORRECT",
  itemId: "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1",
  itemVersion: "r1-abc123",
  source: "CLASSIFIER",
  responseRef: "resp-1",
  provenance: {
    path: "MODEL",
    rubricVersion: "r1-abc123",
    conceptId: "CONCEPT",
    poolId: "POOL",
    ideasPresent: ["i1"],
    ideasRequired: 1,
    ideasTotal: 2,
    confidence: "HIGH",
    fallbackReason: null,
    latencyMs: 412,
    model: "test-model",
    promptTokens: 300,
    completionTokens: 20,
    cacheKey: "deadbeef",
    questionEcho: 0.1,
    needsReview: false,
  },
};

const binding: ReceiptBinding = {
  profileId: "profile-1",
  attemptId: "attempt-1",
  roundIndex: 3,
};

const SECRET = "test-secret-not-a-real-one";

describe("the wire projection", () => {
  it("carries exactly the five keys @pa/duel allows", () => {
    assert.deepEqual(Object.keys(verdictEnvelope(graded)).sort(), [
      "itemId",
      "itemVersion",
      "kind",
      "responseRef",
      "source",
    ]);
  });

  it("carries no bullet count, no confidence, no answer and no rubric detail", () => {
    const serialised = JSON.stringify(verdictEnvelope(graded));
    for (const forbidden of [
      "bullet",
      "ammo",
      "magazine",
      "confidence",
      "answer",
      "ideas",
      "latency",
      "model",
      "provenance",
      "token",
    ]) {
      assert.ok(
        !serialised.toLowerCase().includes(forbidden),
        `envelope leaked "${forbidden}": ${serialised}`,
      );
    }
  });

  it("names its five fields rather than spreading, so a new field cannot leak", () => {
    // A field added to GradedVerdict must be added to verdictEnvelope explicitly
    // to appear; this asserts the envelope is not derived from the input's keys.
    const withExtra = {
      ...graded,
      bullets: 3,
      rawModelOutput: "the student said...",
    } as unknown as GradedVerdict;
    const envelope = verdictEnvelope(withExtra) as Record<string, unknown>;
    assert.equal(envelope["bullets"], undefined);
    assert.equal(envelope["rawModelOutput"], undefined);
  });
});

describe("the receipt makes a relayed verdict unforgeable", () => {
  const envelope = verdictEnvelope(graded);

  it("verifies the verdict it was minted for", () => {
    const receipt = mintVerdictReceipt(envelope, binding, SECRET);
    assert.ok(verifyVerdictReceipt(envelope, binding, receipt, SECRET));
  });

  it("rejects a flipped kind, which is the whole point", () => {
    const receipt = mintVerdictReceipt(
      { ...envelope, kind: "WRONG" },
      binding,
      SECRET,
    );
    // A client that received WRONG and relays CORRECT presents the WRONG receipt.
    assert.equal(
      verifyVerdictReceipt({ ...envelope, kind: "CORRECT" }, binding, receipt, SECRET),
      false,
    );
  });

  it("rejects a receipt replayed into another round", () => {
    const receipt = mintVerdictReceipt(envelope, binding, SECRET);
    assert.equal(
      verifyVerdictReceipt(envelope, { ...binding, roundIndex: 5 }, receipt, SECRET),
      false,
    );
  });

  it("rejects a receipt replayed into another attempt, so a retry cannot reuse it", () => {
    const receipt = mintVerdictReceipt(envelope, binding, SECRET);
    assert.equal(
      verifyVerdictReceipt(
        envelope,
        { ...binding, attemptId: "attempt-2" },
        receipt,
        SECRET,
      ),
      false,
    );
  });

  it("rejects another student's receipt", () => {
    const receipt = mintVerdictReceipt(envelope, binding, SECRET);
    assert.equal(
      verifyVerdictReceipt(
        envelope,
        { ...binding, profileId: "profile-2" },
        receipt,
        SECRET,
      ),
      false,
    );
  });

  it("rejects a receipt for a different item, so a hard question cannot borrow an easy one's grade", () => {
    const receipt = mintVerdictReceipt(envelope, binding, SECRET);
    assert.equal(
      verifyVerdictReceipt(
        { ...envelope, itemId: "BOS.MD01.DUEL.STAMP.FROM_WHEN.v1" },
        binding,
        receipt,
        SECRET,
      ),
      false,
    );
  });

  it("rejects a receipt minted under a stale rubric version", () => {
    const receipt = mintVerdictReceipt(envelope, binding, SECRET);
    assert.equal(
      verifyVerdictReceipt(
        { ...envelope, itemVersion: "r1-000000" },
        binding,
        receipt,
        SECRET,
      ),
      false,
    );
  });

  it("rejects a receipt minted under another key", () => {
    const receipt = mintVerdictReceipt(envelope, binding, "some-other-secret");
    assert.equal(verifyVerdictReceipt(envelope, binding, receipt, SECRET), false);
  });

  it("cannot be forged by field concatenation across bindings", () => {
    // Fields are joined with NUL, so "a" + "bc" and "ab" + "c" cannot collide.
    const left: VerdictEnvelope = { ...envelope, itemId: "a", itemVersion: "bc" };
    const right: VerdictEnvelope = { ...envelope, itemId: "ab", itemVersion: "c" };
    assert.notEqual(
      mintVerdictReceipt(left, binding, SECRET),
      mintVerdictReceipt(right, binding, SECRET),
    );
  });

  it("survives a malformed receipt string without throwing", () => {
    assert.equal(verifyVerdictReceipt(envelope, binding, "", SECRET), false);
    assert.equal(verifyVerdictReceipt(envelope, binding, "!!!!", SECRET), false);
  });
});

describe("the receipt key", () => {
  it("prefers a dedicated secret", () => {
    resetVerdictReceiptSecretCache();
    process.env.GRADING_RECEIPT_SECRET = "dedicated";
    process.env.SESSION_SECRET = "session";
    assert.equal(verdictReceiptSecret(), "dedicated");
    delete process.env.GRADING_RECEIPT_SECRET;
    resetVerdictReceiptSecretCache();
  });

  it("derives from the session secret rather than reusing it", () => {
    resetVerdictReceiptSecretCache();
    delete process.env.GRADING_RECEIPT_SECRET;
    process.env.SESSION_SECRET = "session-secret-value";
    const derived = verdictReceiptSecret();
    assert.notEqual(derived, "session-secret-value");
    assert.ok(derived.length >= 32);
    resetVerdictReceiptSecretCache();
    assert.equal(verdictReceiptSecret(), derived, "derivation must be stable");
    resetVerdictReceiptSecretCache();
  });

  it("throws rather than falling back to a predictable key", () => {
    resetVerdictReceiptSecretCache();
    const saved = process.env.SESSION_SECRET;
    delete process.env.GRADING_RECEIPT_SECRET;
    delete process.env.SESSION_SECRET;
    assert.throws(() => verdictReceiptSecret(), ReceiptSecretMissingError);
    if (saved !== undefined) process.env.SESSION_SECRET = saved;
    resetVerdictReceiptSecretCache();
  });
});
