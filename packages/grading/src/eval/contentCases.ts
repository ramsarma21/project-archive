// The content pass's labelled answers, as eval cases.
//
// `content/m1/eval/duel-answers.labeled.json` holds 75 answers across the eighteen
// items, every one of them deliberately absent from the rubric it tests, so passing
// them means the rubric generalised rather than that the classifier reproduced its
// own answer key. They are labelled against the four rules read off the TEA-scored
// responses in content/staar/eval, which makes them the closest thing in this
// repository to ground truth about where a human authority draws this line.
//
// Their categories are assigned here rather than authored there, because the content
// file labels each row with a prose reason and not a taxonomy. The mapping reads the
// reason and the expected verdict: this is for reporting only — it groups failures
// so a regression is attributable — and no label depends on it.

import { readContentFile, M1_LABELLED_ANSWERS_PATH } from "../items/m1.js";
import type { EvalCase, EvalCategory } from "./cases.js";

interface ContentLabelledAnswer {
  readonly itemId: string;
  readonly answer: string;
  readonly expected: "CORRECT" | "WRONG";
  readonly why: string;
}

interface ContentLabelledSet {
  readonly datasetId: string;
  readonly counts: { readonly total: number; readonly CORRECT: number; readonly WRONG: number };
  readonly answers: readonly ContentLabelledAnswer[];
}

/**
 * Reporting buckets, inferred from the author's stated reason. The correct rows are
 * split so the phrasing cases — the ones that matter most — stay visible as their
 * own number rather than being averaged into the whole.
 */
function categorise(answer: ContentLabelledAnswer): EvalCategory {
  const why = answer.why.toLowerCase();
  if (answer.expected === "CORRECT") {
    if (/formal|academic|textbook|register/.test(why)) return "FORMAL_REGISTER";
    return "UNUSUAL_PHRASING";
  }
  if (/restat|question's own words|gives the question back/.test(why)) {
    return "RESTATES_QUESTION";
  }
  if (/keyword|word list|no proposition|era words/.test(why)) return "KEYWORD_SALAD";
  if (/feeling|vague|affect|angry|mad|unfair|not fair|fluent/.test(why)) {
    return "CONFIDENT_BUT_WRONG";
  }
  if (/inject|instruction|ignore the/.test(why)) return "PROMPT_INJECTION";
  return "NEAR_MISS";
}

let cached: readonly EvalCase[] | null = null;

export function authoredLabelledCases(): readonly EvalCase[] {
  if (cached !== null) return cached;
  const set = readContentFile<ContentLabelledSet>(M1_LABELLED_ANSWERS_PATH);
  cached = set.answers.map(
    (answer): EvalCase => ({
      itemId: answer.itemId,
      answer: answer.answer,
      expect: answer.expected,
      category: categorise(answer),
      why: `${answer.why} [${set.datasetId}]`,
    }),
  );
  return cached;
}

/** The counts the content file declares, for the drift test to check against. */
export function authoredLabelledCounts(): ContentLabelledSet["counts"] {
  return readContentFile<ContentLabelledSet>(M1_LABELLED_ANSWERS_PATH).counts;
}
