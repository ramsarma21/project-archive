import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  JsonLineReviewLog,
  MemoryReviewLog,
  MultiReviewLog,
  NullReviewLog,
  type ReviewLogEntry,
} from "../reviewLog.js";

const entry = (overrides: Partial<ReviewLogEntry> = {}): ReviewLogEntry => ({
  reason: "TIMEOUT_GRANT",
  at: "2026-07-25T00:00:00.000Z",
  profileId: "p1",
  attemptId: "a1",
  roundIndex: 4,
  itemId: "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1",
  rubricVersion: "r1-abc",
  conceptId: "CONCEPT",
  kind: "CORRECT",
  fallbackReason: "TIMEOUT",
  confidence: null,
  ideasPresent: [],
  ideasRequired: 1,
  ideasTotal: 2,
  latencyMs: 1_502,
  answerHash: "0123456789abcdef",
  answerLength: 42,
  questionEcho: 0.1,
  ...overrides,
});

describe("the JSON line sink", () => {
  it("emits one queryable line per entry", () => {
    const lines: string[] = [];
    new JsonLineReviewLog((line) => lines.push(line)).record(entry());
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(parsed["event"], "grading.review");
    assert.equal(parsed["reason"], "TIMEOUT_GRANT");
    assert.equal(parsed["profileId"], "p1");
    assert.equal(parsed["fallbackReason"], "TIMEOUT");
  });

  it("strips answer text even when the caller supplies it", () => {
    const lines: string[] = [];
    new JsonLineReviewLog((line) => lines.push(line)).record(
      entry({ answerText: "the war left them in debt" }),
    );
    assert.ok(!lines[0]!.includes("the war left them in debt"));
    assert.equal(JSON.parse(lines[0]!)["answerText"], undefined);
  });

  it("keeps the hash, so repeats correlate without storing writing", () => {
    const lines: string[] = [];
    new JsonLineReviewLog((line) => lines.push(line)).record(entry());
    assert.equal(JSON.parse(lines[0]!)["answerHash"], "0123456789abcdef");
  });
});

describe("the memory sink", () => {
  it("counts by reason, which is how the abuse signal is read", () => {
    const log = new MemoryReviewLog();
    log.record(entry());
    log.record(entry());
    log.record(entry({ reason: "LOW_CONFIDENCE", fallbackReason: null }));
    assert.equal(log.countOf("TIMEOUT_GRANT"), 2);
    assert.equal(log.countOf("LOW_CONFIDENCE"), 1);
    assert.equal(log.countOf("FALSE_NEGATIVE_RISK"), 0);
    log.clear();
    assert.equal(log.entries.length, 0);
  });
});

describe("fan-out and discard", () => {
  it("delivers to every sink", () => {
    const a = new MemoryReviewLog();
    const b = new MemoryReviewLog();
    new MultiReviewLog([a, b]).record(entry());
    assert.equal(a.entries.length, 1);
    assert.equal(b.entries.length, 1);
  });

  it("discards without throwing", () => {
    assert.doesNotThrow(() => new NullReviewLog().record());
  });
});
