// The verdict cache.
//
// At classroom scale the answer distribution has a very short head. Thirty
// students asked why Parliament is suddenly taxing Boston produce a handful of
// distinct normalised strings — "war debt", "they were broke from the war",
// "to pay for the war" — and the first of each costs a model call while the rest
// cost a map lookup. That is the difference between paying for 540 classifications a session
// and paying for a few dozen.
//
// The key includes the rubric version, which is a content hash of the rubric
// (see ./rubric.ts). That is what makes the cache safe to keep for a school day:
// an author who edits a rubric changes its version, which changes every key
// derived from it, so there is no such thing as a verdict cached under an older
// line. No invalidation call to forget, because there is no invalidation.
//
// What is cached is the verdict and its idea vector — never the answer text. The
// key is a hash, so the cache cannot be read back into student writing either.

import { createHash } from "node:crypto";
import { CACHE_MAX_ENTRIES, CACHE_TTL_MS } from "./tuning.js";
import { normalizeAnswer } from "./normalize.js";
import type { ClassifierConfidence, VerdictKind } from "./verdict.js";

export interface CachedVerdict {
  readonly kind: VerdictKind;
  readonly ideasPresent: readonly string[];
  readonly confidence: ClassifierConfidence;
  readonly model: string | null;
}

export interface VerdictCache {
  get(key: string): CachedVerdict | undefined;
  set(key: string, value: CachedVerdict): void;
  readonly size: number;
  readonly stats: { readonly hits: number; readonly misses: number };
}

/**
 * Cache key: item identity, rubric identity, normalised answer. All three are
 * required — the same words are a different question under a different item, and
 * a different line under a different rubric version.
 */
export function verdictCacheKey(
  itemId: string,
  rubricVersion: string,
  answer: string,
): string {
  return createHash("sha256")
    .update(`${itemId}\u0000${rubricVersion}\u0000${normalizeAnswer(answer)}`)
    .digest("hex")
    .slice(0, 32);
}

interface Entry {
  readonly value: CachedVerdict;
  readonly expiresAt: number;
}

/**
 * LRU with a TTL, on a plain Map. Map preserves insertion order, so re-inserting
 * on read moves an entry to the back and the oldest key is always the first one
 * the iterator yields — an LRU in about ten lines and no dependency. The repo has
 * no cache utility to reuse and `lru-cache` is only present transitively through
 * Babel, so adding a dependency for this would be the larger change.
 */
export class MemoryVerdictCache implements VerdictCache {
  private readonly entries = new Map<string, Entry>();
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly maxEntries: number = CACHE_MAX_ENTRIES,
    private readonly ttlMs: number = CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): CachedVerdict | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: CachedVerdict): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get stats(): { readonly hits: number; readonly misses: number } {
    return { hits: this.hits, misses: this.misses };
  }
}

/** Disables caching without branching the hot path. Used by the eval harness. */
export class NullVerdictCache implements VerdictCache {
  private misses = 0;

  get(): undefined {
    this.misses += 1;
    return undefined;
  }

  set(): void {}

  get size(): number {
    return 0;
  }

  get stats(): { readonly hits: number; readonly misses: number } {
    return { hits: 0, misses: this.misses };
  }
}
