// Answer normalisation, for the cache key and for the checks that run before a
// model is ever called.
//
// The normaliser is deliberately conservative. Its job is to collapse the
// differences that are certainly not semantic — case, unicode form, smart
// quotes, punctuation, whitespace — and to stop there. It does not stem, does
// not drop stopwords, and does not reorder tokens, because every one of those
// merges answers that mean different things. "no, it isn't printed" and "yes it
// is printed" must not share a cache entry, and a stopword-stripping normaliser
// would collapse "the debt caused the tax" into "the tax caused the debt".

/**
 * The canonical form used as the cache key and as the emptiness test. Stable
 * across platforms: NFKC first so composed and decomposed accents agree, then
 * case, then punctuation to spaces, then whitespace runs to one space.
 */
export function normalizeAnswer(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    // Punctuation becomes a separator rather than vanishing, so "debt,tax" and
    // "debt tax" agree while "cant" and "can't" stay distinct words either way.
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word tokens of the normalised form. Used by the adversarial pre-checks. */
export function tokens(normalized: string): readonly string[] {
  return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * Why an answer was refused without spending a model call. These are the cases
 * that are decidable with certainty, and only those: an empty box is not a
 * judgement call, whereas "keyword salad" is, and so keyword salad goes to the
 * classifier where it belongs.
 */
export type PreCheckRefusal = "EMPTY";

export function preCheckAnswer(raw: string): PreCheckRefusal | null {
  return normalizeAnswer(raw).length === 0 ? "EMPTY" : null;
}

/**
 * Clamp before the model sees it. Truncation is by codepoint on a word boundary
 * where one is available, so a clipped answer still parses as language.
 */
export function clampAnswer(raw: string, maxChars: number): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  const characters = [...collapsed];
  const hard = characters.slice(0, maxChars).join("");
  // The cut already fell between words; keep the whole last word.
  if (characters[maxChars] === " ") return hard;
  const lastSpace = hard.lastIndexOf(" ");
  return lastSpace > maxChars * 0.6 ? hard.slice(0, lastSpace) : hard;
}

/**
 * How much of the question the answer simply gives back. Restating the question
 * is one of the named adversarial cases, and it is worth measuring here rather
 * than only asking the model, because it is the single most common way a
 * plausible-looking answer contains no assertion at all.
 *
 * Returns the fraction of the answer's distinct content words that also appear
 * in the question. It is reported to the classifier as a hint and recorded in
 * provenance; it never decides the verdict on its own, because a legitimate
 * answer to "Which came first, the debt or the tax?" necessarily reuses both
 * nouns.
 */
export function questionEchoRatio(question: string, answer: string): number {
  const answerWords = new Set(
    tokens(normalizeAnswer(answer)).filter((word) => word.length > 3),
  );
  if (answerWords.size === 0) return 0;
  const questionWords = new Set(
    tokens(normalizeAnswer(question)).filter((word) => word.length > 3),
  );
  let shared = 0;
  for (const word of answerWords) if (questionWords.has(word)) shared += 1;
  return shared / answerWords.size;
}
