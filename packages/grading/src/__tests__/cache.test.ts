import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  MemoryVerdictCache,
  NullVerdictCache,
  verdictCacheKey,
  type CachedVerdict,
} from "../cache.js";

const value = (kind: "CORRECT" | "WRONG" = "CORRECT"): CachedVerdict => ({
  kind,
  ideasPresent: ["i1"],
  confidence: "HIGH",
  model: "m",
});

describe("the cache key", () => {
  it("folds answers that differ only in case and punctuation", () => {
    assert.equal(
      verdictCacheKey("item", "r1", "The debt!"),
      verdictCacheKey("item", "r1", "  the   debt  "),
    );
  });

  it("separates items", () => {
    assert.notEqual(verdictCacheKey("a", "r1", "x"), verdictCacheKey("b", "r1", "x"));
  });

  it("separates rubric versions, which is the whole invalidation strategy", () => {
    // An author edits a rubric, the derived version changes, and every key under
    // the old line becomes unreachable. There is no invalidation call to forget.
    assert.notEqual(verdictCacheKey("a", "r1", "x"), verdictCacheKey("a", "r2", "x"));
  });

  it("cannot be read back into the answer", () => {
    const key = verdictCacheKey("item", "r1", "the war debt and the colonies");
    assert.ok(!key.includes("debt"));
    assert.ok(/^[0-9a-f]{32}$/.test(key));
  });

  it("cannot be collided by moving text between the fields", () => {
    assert.notEqual(verdictCacheKey("a", "b", "c"), verdictCacheKey("ab", "", "c"));
  });
});

describe("the cache", () => {
  it("returns what it stored", () => {
    const cache = new MemoryVerdictCache();
    cache.set("k", value());
    assert.equal(cache.get("k")?.kind, "CORRECT");
    assert.deepEqual(cache.stats, { hits: 1, misses: 0 });
  });

  it("counts a miss", () => {
    const cache = new MemoryVerdictCache();
    assert.equal(cache.get("absent"), undefined);
    assert.deepEqual(cache.stats, { hits: 0, misses: 1 });
  });

  it("evicts least-recently-used past its cap", () => {
    const cache = new MemoryVerdictCache(2);
    cache.set("a", value());
    cache.set("b", value());
    cache.get("a");
    cache.set("c", value());
    assert.equal(cache.size, 2);
    assert.notEqual(cache.get("a"), undefined, "a was used most recently");
    assert.equal(cache.get("b"), undefined, "b was the least recently used");
    assert.notEqual(cache.get("c"), undefined);
  });

  it("expires on the TTL", () => {
    let clock = 1_000;
    const cache = new MemoryVerdictCache(10, 500, () => clock);
    cache.set("k", value());
    clock = 1_400;
    assert.notEqual(cache.get("k"), undefined);
    clock = 1_900;
    assert.equal(cache.get("k"), undefined);
    assert.equal(cache.size, 0, "an expired entry is dropped, not left to grow");
  });

  it("overwrites rather than duplicating on re-set", () => {
    const cache = new MemoryVerdictCache();
    cache.set("k", value("CORRECT"));
    cache.set("k", value("WRONG"));
    assert.equal(cache.size, 1);
    assert.equal(cache.get("k")?.kind, "WRONG");
  });
});

describe("the null cache", () => {
  it("never hits, so the eval harness measures the classifier", () => {
    const cache = new NullVerdictCache();
    cache.set("k", value());
    assert.equal(cache.get(), undefined);
    assert.equal(cache.size, 0);
    assert.equal(cache.stats.hits, 0);
  });
});
