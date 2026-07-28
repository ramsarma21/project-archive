// "No AI tells": the check that a generated question does not read as generated.
//
// WHAT IS CHEAP AND RELIABLE, AND WHAT IS NOT. Three mechanisms were on the table:
//
//   1. A banned-construction lexical check. Cheap (a set of regexes, no model),
//      reliable (the tells are a finite, known set), and HIGH PRECISION when the
//      list is kept tight to constructions that never occur in the asking
//      character's voice. This is the primary gate and it is the ERROR half below.
//   2. A style-similarity comparison against the hand-authored corpus. Cheap (a few
//      summary statistics), but NOISY — a legitimately short or long question is an
//      outlier without being machine-written. So it is a WARN, never a block: it
//      points a human at an item, it does not reject one.
//   3. An adversarial "does this read as machine-written?" model pass. Expensive
//      (a model call per item) and the least reliable of the three, because a model
//      is a poor detector of its own register. Not built as a gate; if it is ever
//      wanted it belongs beside the discriminator as an optional advisory, not here.
//
// The load-bearing decision is that the ERROR list contains ONLY constructions that
// do not appear in a Boston constable's spoken question. The authored corpus is run
// through this exact gate in the test suite and must pass clean, which is what keeps
// the check from rejecting the good items it is modelled on.

import type { CandidateItem, Finding } from "./types.js";
import { sentenceCount, wordCount } from "./text.js";

interface BannedConstruction {
  readonly code: string;
  readonly pattern: RegExp;
  readonly detail: string;
}

// ERROR: none of these occurs in a spoken, period-voice question. A hit is a tell.
const BANNED: readonly BannedConstruction[] = [
  {
    code: "EM_EN_DASH",
    pattern: /[\u2014\u2013]/,
    detail: "an em/en dash used as prose punctuation — rewrite it as speech (content/m1/verify.mjs already fails shipping questions on this)",
  },
  {
    code: "TYPOGRAPHIC_QUOTES",
    pattern: /[\u2018\u2019\u201C\u201D]/,
    detail: "curly/typographic quotes; a person typing a question uses straight quotes",
  },
  {
    code: "MARKDOWN_ARTIFACT",
    pattern: /(\*\*|__|^\s{0,3}#{1,6}\s|^\s*[-*]\s+|\]\([^)]+\))/m,
    detail: "markdown formatting (bold, heading, bullet, link) in a spoken question",
  },
  {
    code: "LLM_LEXICON",
    pattern:
      /\b(delv(e|ing)|tapestry|nestled|testament to|multifaceted|myriad|realm of|ever-evolving|it['\u2019]?s worth noting|it is worth noting|plays? a (crucial|vital|key|pivotal|significant) role|at its core|when it comes to|navigat(e|ing) the|leverage|utili[sz]e)\b/i,
    detail: "a phrase from the standard LLM register that a constable would never say",
  },
  {
    code: "ASSISTANT_ARTIFACT",
    pattern:
      /\b(as an ai|i cannot (help|assist|provide|comply|fulfil|fulfill|do that)|i['\u2019]?m sorry,|certainly[!,]|sure[,!]? here|in conclusion|to summari[sz]e|let['\u2019]?s (explore|dive)|feel free to|here['\u2019]?s (a|the|your) (answer|list|breakdown|example|question)|dive into)\b/i,
    detail: "an assistant-turn artifact leaking into the question text",
  },
];

// WARN: legitimate in careful prose but out of place in a terse spoken question, and
// classic AI connective tissue. Flagged for a human, never blocked.
const SOFT: readonly BannedConstruction[] = [
  {
    code: "FORMAL_CONNECTIVE",
    pattern: /\b(furthermore|moreover|additionally|consequently|notably|thus|hence)\b/i,
    detail: "a formal connective; the constable speaks in short declaratives, not essay transitions",
  },
  {
    code: "HEDGE",
    pattern: /\b(arguably|it could be argued|one might (say|argue)|it is important to)\b/i,
    detail: "an essayistic hedge",
  },
];

export interface CorpusStyle {
  readonly meanWordsPerSentence: number;
  readonly stdWordsPerSentence: number;
  readonly meanWords: number;
  readonly stdWords: number;
}

/** Summarise the authored questions so a candidate can be measured against them. */
export function corpusStyle(questions: readonly string[]): CorpusStyle {
  const wps = questions.map((q) => wordCount(q) / sentenceCount(q));
  const words = questions.map((q) => wordCount(q));
  const stats = (xs: readonly number[]): { mean: number; std: number } => {
    if (xs.length === 0) return { mean: 0, std: 0 };
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
    return { mean, std: Math.sqrt(variance) };
  };
  const s1 = stats(wps);
  const s2 = stats(words);
  return {
    meanWordsPerSentence: s1.mean,
    stdWordsPerSentence: s1.std,
    meanWords: s2.mean,
    stdWords: s2.std,
  };
}

/**
 * The AI-tell gate. `corpus` is the hand-authored question set; when supplied, a
 * candidate more than three standard deviations off the corpus on sentence length
 * or overall length gets a style WARN. The lexical checks need no corpus.
 */
export function checkAiTells(
  item: CandidateItem,
  corpus?: CorpusStyle,
): readonly Finding[] {
  const findings: Finding[] = [];
  const q = item.question;
  for (const rule of BANNED) {
    if (rule.pattern.test(q)) {
      findings.push({ check: "ai-tells", code: rule.code, severity: "ERROR", detail: rule.detail });
    }
  }
  for (const rule of SOFT) {
    if (rule.pattern.test(q)) {
      findings.push({ check: "ai-tells", code: rule.code, severity: "WARN", detail: rule.detail });
    }
  }
  if (corpus && corpus.stdWordsPerSentence > 0 && corpus.stdWords > 0) {
    const wps = wordCount(q) / sentenceCount(q);
    const zSentence = Math.abs(wps - corpus.meanWordsPerSentence) / corpus.stdWordsPerSentence;
    const zWords = Math.abs(wordCount(q) - corpus.meanWords) / corpus.stdWords;
    if (zSentence > 3) {
      findings.push({
        check: "ai-tells",
        code: "STYLE_OUTLIER_SENTENCE",
        severity: "WARN",
        detail: `${wps.toFixed(0)} words/sentence is ${zSentence.toFixed(1)}σ off the authored corpus`,
      });
    }
    if (zWords > 3) {
      findings.push({
        check: "ai-tells",
        code: "STYLE_OUTLIER_LENGTH",
        severity: "WARN",
        detail: `${wordCount(q)} words is ${zWords.toFixed(1)}σ off the authored corpus`,
      });
    }
  }
  return findings;
}
