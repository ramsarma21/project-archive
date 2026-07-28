// Small text utilities shared by the pipeline checks and the runtime prose
// comparison. Deterministic and dependency-free, so they behave identically in a
// test, in the offline gauntlet, and on the runtime fast-accept path — which is the
// whole point of the deterministic tier: the same input grades the same way every
// replay, with no model in the loop.

/** Lower-cased, punctuation-stripped, whitespace-collapsed. For matching only. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "for", "is", "are", "was",
  "were", "it", "its", "they", "them", "their", "we", "our", "us", "you", "your",
  "he", "she", "his", "her", "that", "this", "these", "those", "so", "but", "or",
  "as", "at", "by", "be", "been", "with", "from", "not", "no", "do", "did", "does",
  "what", "which", "who", "why", "how", "when", "than", "then", "there", "here",
]);

/** Content words: normalised, split, stop-words dropped. */
export function contentWords(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/** Jaccard overlap of the two texts' content-word sets. 0..1. */
export function contentOverlap(a: string, b: string): number {
  const setA = new Set(contentWords(a));
  const setB = new Set(contentWords(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared += 1;
  return shared / (setA.size + setB.size - shared);
}

/** Sentence count by terminal punctuation. At least 1 for any non-empty string. */
export function sentenceCount(text: string): number {
  const parts = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  return Math.max(1, parts.length);
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
