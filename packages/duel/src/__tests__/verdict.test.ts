import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mintTimeoutVerdict,
  mintVerdict,
  parseVerdictEnvelope,
  verdictEnvelope,
  verdictNeedsGradingReview,
  VERDICT_ENVELOPE_KEYS,
  VERDICT_KINDS,
} from "../verdict.js";
import { bulletsForVerdict } from "../bullets.js";
import { BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG } from "../tuning.js";

const ITEM = { itemId: "BOS.M1.DUEL.REVENUE.01", itemVersion: "v1" } as const;

test("a duel verdict has exactly two states", () => {
  assert.deepEqual([...VERDICT_KINDS], ["CORRECT", "WRONG"]);
  assert.equal(bulletsForVerdict("CORRECT"), BULLETS_FOR_CORRECT);
  assert.equal(bulletsForVerdict("WRONG"), BULLETS_FOR_WRONG);
});

test("the wire boundary refuses a partial verdict by name", () => {
  for (const kind of ["PARTIAL", "PARTIAL_CONNECTION", "STRONG", "MISSING", "correct"]) {
    const parsed = parseVerdictEnvelope({
      kind,
      itemId: ITEM.itemId,
      itemVersion: ITEM.itemVersion,
      source: "CLASSIFIER",
    });
    assert.equal(parsed.ok, false, `${kind} must be refused`);
    if (!parsed.ok) {
      assert.equal(parsed.code, "NON_BINARY_VERDICT");
      assert.equal(parsed.detail, kind);
    }
  }
});

test("the 1.5-second grading cap grants the maximum and flags for review", () => {
  const verdict = mintTimeoutVerdict(ITEM.itemId, ITEM.itemVersion);
  assert.equal(verdict.kind, "CORRECT");
  assert.equal(verdict.source, "GRADING_TIMEOUT");
  assert.equal(bulletsForVerdict(verdict.kind), BULLETS_FOR_CORRECT);
  assert.equal(verdictNeedsGradingReview(verdict), true);
});

test("an abstention is wrong, and neither timeout nor abstention can be overridden", () => {
  const abstained = mintVerdict({
    kind: "CORRECT",
    ...ITEM,
    source: "ABSTAINED",
  });
  assert.equal(abstained.kind, "WRONG", "the source fixes the verdict");
  const timedOut = mintVerdict({ kind: "WRONG", ...ITEM, source: "GRADING_TIMEOUT" });
  assert.equal(timedOut.kind, "CORRECT");
  assert.equal(verdictNeedsGradingReview(abstained), false);
});

test("a verdict carries an opaque response reference, never text", () => {
  const verdict = mintVerdict({
    kind: "CORRECT",
    ...ITEM,
    source: "CLASSIFIER",
    responseRef: "resp_01H8XY",
  });
  const envelope = verdictEnvelope(verdict);
  assert.deepEqual(Object.keys(envelope).sort(), [...VERDICT_ENVELOPE_KEYS].sort());
  assert.equal(envelope.responseRef, "resp_01H8XY");
  assert.equal("rubricLabel" in envelope, false, "no label travels with a duel verdict");
});

test("the wire boundary rejects a smuggled bullet count", () => {
  const parsed = parseVerdictEnvelope({
    kind: "CORRECT",
    itemId: ITEM.itemId,
    itemVersion: ITEM.itemVersion,
    source: "CLASSIFIER",
    bullets: 12,
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.code, "UNKNOWN_FIELD");
    assert.equal(parsed.detail, "bullets");
  }
});

test("the wire boundary rejects smuggled answer text and rubric detail", () => {
  for (const field of ["answerText", "responseText", "answer", "prose", "rubricLabel"]) {
    const parsed = parseVerdictEnvelope({
      kind: "CORRECT",
      itemId: ITEM.itemId,
      itemVersion: ITEM.itemVersion,
      source: "CLASSIFIER",
      [field]: "the debt from the war came first",
    });
    assert.equal(parsed.ok, false, `${field} must be rejected`);
    if (!parsed.ok) assert.equal(parsed.code, "UNKNOWN_FIELD");
  }
});

test("the wire boundary rejects a verdict that contradicts its source", () => {
  const parsed = parseVerdictEnvelope({
    kind: "WRONG",
    itemId: ITEM.itemId,
    itemVersion: ITEM.itemVersion,
    source: "GRADING_TIMEOUT",
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.code, "KIND_CONTRADICTS_SOURCE");
});

test("the wire boundary rejects unknown sources and malformed shapes", () => {
  const base = {
    kind: "CORRECT",
    itemId: ITEM.itemId,
    itemVersion: ITEM.itemVersion,
    source: "CLASSIFIER",
  };
  assert.equal(parseVerdictEnvelope({ ...base, source: "CLIENT" }).ok, false);
  assert.equal(parseVerdictEnvelope(null).ok, false);
  assert.equal(parseVerdictEnvelope([base]).ok, false);
  assert.equal(parseVerdictEnvelope("CORRECT").ok, false);
  assert.equal(parseVerdictEnvelope({ ...base, responseRef: 12 }).ok, false);
  const missing = { ...base } as Record<string, unknown>;
  delete missing["itemId"];
  assert.equal(parseVerdictEnvelope(missing).ok, false);
});

test("a well-formed relayed verdict is accepted", () => {
  const parsed = parseVerdictEnvelope({
    kind: "WRONG",
    itemId: ITEM.itemId,
    itemVersion: ITEM.itemVersion,
    source: "OPPONENT_AUTHORITY",
    responseRef: null,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.verdict.kind, "WRONG");
    assert.equal(bulletsForVerdict(parsed.verdict.kind), BULLETS_FOR_WRONG);
  }
});
