// Conformance against the real boundary.
//
// This package must stay importable by the API without dragging the duel
// simulation, and through it the engine, into the server. That is why the ONE
// thing shipped code takes from @pa/duel is the leaf `@pa/duel/structure`, which
// has no imports; see the note in request.ts. A test is under no such constraint,
// and the strongest available check that our envelope is acceptable is to hand it
// to the actual function that accepts it, so this file imports the real
// `parseVerdictEnvelope` from the package root and round-trips every verdict shape
// this service can produce through it.
//
// The rejection codes asserted below are @pa/duel's own names. NON_BINARY_VERDICT
// is the one the brief warns about, and the point of the last block is that this
// package cannot produce it — not that it handles it.

// The bullet counts are imported rather than written as 3 and 1. They were 3 and
// 1 when this file was first written, the duel moved them to 14 and 7, and three
// assertions here went red for a reason that had nothing to do with grading.
// Asserting against the duel's own constants keeps the check — that a verdict this
// service mints converts into SOME magazine, and that CORRECT is the larger one —
// while making the economy free to move without a false alarm here.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  parseVerdictEnvelope,
  bulletsForVerdict,
} from "@pa/duel";
import { m1ItemBank } from "../items/m1.js";
import { GradingService } from "../service.js";
import { verdictEnvelope, type VerdictSource } from "../verdict.js";
import { MemoryVerdictCache } from "../cache.js";
import type { ClassifierProvider, ProviderResult } from "../provider.js";

const bank = m1ItemBank();
// A single-core item, which is seventeen of the eighteen in the production bank.
const ITEM = "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1";
const CARRIED = { ideas: { i1: true }, answers: true, confidence: "HIGH" };
const MISSED = { ideas: { i1: false }, answers: true, confidence: "HIGH" };

const stub = (raw: unknown): ClassifierProvider => ({
  classify: async (): Promise<ProviderResult> => ({
    raw,
    model: "stub",
    promptTokens: 100,
    completionTokens: 10,
  }),
});

const failing = (error: Error): ClassifierProvider => ({
  classify: async () => {
    throw error;
  },
});

async function gradeWith(
  provider: ClassifierProvider | null,
  answer: string,
): Promise<ReturnType<typeof verdictEnvelope>> {
  const service = new GradingService({
    bank,
    provider,
    cache: new MemoryVerdictCache(),
  });
  return verdictEnvelope(
    await service.grade({
      itemId: ITEM,
      answer,
      profileId: "p",
      attemptId: "a",
      roundIndex: 0,
    }),
  );
}

describe("every envelope this service mints is accepted by @pa/duel", () => {
  it("accepts a classified CORRECT", async () => {
    const envelope = await gradeWith(
      stub(CARRIED),
      "they were broke from the war and came to us",
    );
    const parsed = parseVerdictEnvelope(envelope);
    assert.ok(parsed.ok, `rejected: ${JSON.stringify(parsed)}`);
    assert.equal(parsed.verdict.kind, "CORRECT");
    assert.equal(bulletsForVerdict(parsed.verdict.kind), BULLETS_FOR_CORRECT);
  });

  it("accepts a classified WRONG", async () => {
    const envelope = await gradeWith(stub(MISSED), "because of the weather");
    const parsed = parseVerdictEnvelope(envelope);
    assert.ok(parsed.ok);
    assert.equal(parsed.verdict.kind, "WRONG");
    assert.equal(bulletsForVerdict(parsed.verdict.kind), BULLETS_FOR_WRONG);
  });

  it("accepts the generous timeout grant, and the duel agrees it is CORRECT", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const envelope = await gradeWith(failing(abort), "a real answer");
    assert.equal(envelope.source, "GRADING_TIMEOUT");
    const parsed = parseVerdictEnvelope(envelope);
    // @pa/duel independently fixes GRADING_TIMEOUT to CORRECT and rejects a
    // timeout that claims otherwise, so this also proves the two agree.
    assert.ok(parsed.ok, `rejected: ${JSON.stringify(parsed)}`);
    assert.equal(parsed.verdict.kind, "CORRECT");
    assert.equal(bulletsForVerdict(parsed.verdict.kind), BULLETS_FOR_CORRECT);
  });

  it("accepts the abstention for an empty answer, and the duel agrees it is WRONG", async () => {
    const envelope = await gradeWith(stub(null), "   ");
    assert.equal(envelope.source, "ABSTAINED");
    const parsed = parseVerdictEnvelope(envelope);
    assert.ok(parsed.ok);
    assert.equal(parsed.verdict.kind, "WRONG");
  });

  it("accepts a cached verdict", async () => {
    const service = new GradingService({
      bank,
      provider: stub({ ideas: { i1: true }, answers: true, confidence: "MEDIUM" }),
      cache: new MemoryVerdictCache(),
    });
    const request = {
      itemId: ITEM,
      answer: "war debt",
      profileId: "p",
      attemptId: "a",
      roundIndex: 0,
    };
    await service.grade(request);
    const second = await service.grade(request);
    assert.equal(second.provenance.path, "CACHE");
    const parsed = parseVerdictEnvelope(verdictEnvelope(second));
    assert.ok(parsed.ok);
    assert.equal(parsed.verdict.kind, "CORRECT");
  });
});

describe("the boundary rejects what this service structurally cannot mint", () => {
  const base = {
    kind: "CORRECT",
    itemId: ITEM,
    itemVersion: "r1-x",
    source: "CLASSIFIER" as VerdictSource,
    responseRef: null,
  };

  it("rejects a non-binary verdict by name", () => {
    const parsed = parseVerdictEnvelope({ ...base, kind: "PARTIAL" });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.code, "NON_BINARY_VERDICT");
  });

  it("rejects a smuggled bullet count", () => {
    const parsed = parseVerdictEnvelope({ ...base, bullets: 3 });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.code, "UNKNOWN_FIELD");
  });

  it("rejects smuggled answer text", () => {
    const parsed = parseVerdictEnvelope({ ...base, answerText: "the war debt" });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.code, "UNKNOWN_FIELD");
  });

  it("rejects a client-authored source", () => {
    const parsed = parseVerdictEnvelope({ ...base, source: "CLIENT" });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.code, "UNKNOWN_SOURCE");
  });

  it("rejects a timeout claiming to be wrong", () => {
    const parsed = parseVerdictEnvelope({
      ...base,
      kind: "WRONG",
      source: "GRADING_TIMEOUT",
    });
    assert.equal(parsed.ok, false);
    assert.equal(parsed.ok === false && parsed.code, "KIND_CONTRADICTS_SOURCE");
  });
});

describe("the model's output vocabulary cannot express a third outcome", () => {
  it("has no non-binary value to return, whatever the classifier says", async () => {
    // Even a provider returning nonsense in the confidence field cannot produce a
    // kind outside CORRECT/WRONG, because the kind is computed from booleans.
    for (const raw of [
      { ideas: { i1: true }, answers: true, confidence: "PARTIAL" },
      { ideas: { i1: "yes" }, answers: true, confidence: "HIGH" },
      { kind: "PARTIAL", ideas: { i1: true }, answers: true, confidence: "HIGH" },
      { ideas: {}, answers: true, confidence: "HIGH" },
      "PARTIAL",
      42,
      null,
    ]) {
      const envelope = await gradeWith(stub(raw), "some answer");
      assert.ok(
        envelope.kind === "CORRECT" || envelope.kind === "WRONG",
        `minted ${envelope.kind}`,
      );
      assert.ok(parseVerdictEnvelope(envelope).ok);
    }
  });
});
