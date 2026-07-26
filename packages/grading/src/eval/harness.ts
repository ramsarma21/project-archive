// The evaluation harness, and the gate.
//
// The set is assembled from two sources. Every `accept` and `reject` example on
// every authored item becomes a case automatically — which is the reason the
// rubric format asks for them and the reason `validateAuthoredPool` warns when an
// item has fewer than two. An author writing the next mission's eighteen items
// grows the evaluation set as a side effect of authoring, rather than as a second
// job nobody has time for. On top of that sit the hand-labelled cases in
// ./cases.ts, which cover the failure shapes an author does not naturally write.
//
// THREE NUMBERS, NOT ONE.
//
//   * Accuracy is the headline, and on its own it is not a gate. A grader that
//     marks everything correct scores well on a set that is mostly correct
//     answers, and it is also completely broken.
//   * The false-negative rate — a correct answer marked wrong — is the number that
//     decides whether this ships. §1.7 is explicit that this is the toxic
//     direction, and its ceiling is much tighter than the accuracy floor.
//   * The false-positive rate is reported and not gated as hard, because a handed
//     out bullet is a bad round and a false negative is a lost ranked duel. It is
//     still watched: a false-positive rate near 1.0 means the grader has stopped
//     discriminating.
//
// Cases that fell back to the generous grant are excluded from all three and
// counted separately. A timeout that grants CORRECT on a case expecting CORRECT is
// not a correct classification, and letting it count as one would let an outage
// look like a passing eval — which is precisely the failure a ship gate exists to
// catch.

import { ItemBank } from "../rubric.js";
import { NullVerdictCache } from "../cache.js";
import { GradingService } from "../service.js";
import { MemoryReviewLog } from "../reviewLog.js";
import { NoGrantLowConfidenceLedger } from "../lowConfidence.js";
import type { ClassifierProvider } from "../provider.js";
import { buildSystemPrompt, type JudgingPolicy } from "../prompt.js";
import {
  EVAL_MAX_FALSE_NEGATIVE_RATE,
  EVAL_PASS_THRESHOLD,
} from "../tuning.js";
import { HAND_LABELLED_CASES, type EvalCase, type EvalCategory } from "./cases.js";
import { authoredLabelledCases } from "./contentCases.js";

export type { EvalCase, EvalCategory };

/**
 * An example is only a measurement if the model was not shown it.
 *
 * Almost every authored example is held out by construction — the prompt gets the
 * required core and the described wrong classes, never the example text. A few
 * collide anyway, because on some items the answer and the proposition are the same
 * words: WHAT_RIGHT's core ends "— no taxation without representation", and that
 * slogan is also one of its accept examples, deliberately, because the content's own
 * line says the slogan is the answer for that item.
 *
 * Such a case tests whether the classifier can match a string to itself, so it is
 * dropped rather than counted. Dropping is better than forbidding: the collision is
 * correct authoring, and a rule that failed the build over it would push an author
 * to reword a good rubric to satisfy a test. Short examples are kept — a one- or
 * two-word answer necessarily shares words with a rubric that names the same thing.
 */
export function isContaminatedExample(prompt: string, example: string): boolean {
  const needle = example.trim().toLowerCase();
  return needle.split(/\s+/).length >= 3 && prompt.toLowerCase().includes(needle);
}

/**
 * Every held-out authored example, as cases. This is the half of the set that
 * grows for free when someone authors a mission.
 */
export function authoredCases(bank: ItemBank): readonly EvalCase[] {
  const cases: EvalCase[] = [];
  for (const item of bank.items) {
    const prompt = buildSystemPrompt(item);
    const add = (
      answer: string,
      expect: "CORRECT" | "WRONG",
      category: EvalCategory,
      why: string,
    ): void => {
      if (isContaminatedExample(prompt, answer)) return;
      cases.push({ itemId: item.itemId, answer, expect, category, why });
    };
    for (const answer of item.heldOutExamples.correct) {
      add(answer, "CORRECT", "AUTHORED_ACCEPT", "authored accept example, held out of the prompt");
    }
    for (const answer of item.heldOutExamples.wrong) {
      add(answer, "WRONG", "AUTHORED_REJECT", "authored reject example, held out of the prompt");
    }
  }
  return cases;
}

/**
 * The whole set, from three sources:
 *
 *   1. Every held-out accept/reject example on every authored item, which grows for
 *      free when someone authors a mission.
 *   2. The content pass's own labelled answers — 75 rows in
 *      content/m1/eval/duel-answers.labeled.json, deliberately absent from the
 *      rubrics they test, and calibrated against the TEA-scored responses.
 *   3. The structural adversarial cases in ./cases.ts: empty submissions, prompt
 *      injection, keyword salad and question restatement. These are shapes rather
 *      than history, which is why they live in code beside the parser they exercise.
 */
export function buildEvalSet(bank: ItemBank): readonly EvalCase[] {
  const seen = new Set<string>();
  const deduped: EvalCase[] = [];
  for (const testCase of [
    ...authoredCases(bank),
    ...authoredLabelledCases(),
    ...HAND_LABELLED_CASES,
  ]) {
    const key = `${testCase.itemId}\u0000${testCase.answer.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(testCase);
  }
  return deduped;
}

export interface CaseResult {
  readonly testCase: EvalCase;
  readonly actual: "CORRECT" | "WRONG";
  readonly pass: boolean;
  /** True when a fallback produced the verdict, so it is not a classification. */
  readonly ungraded: boolean;
  readonly latencyMs: number;
  readonly path: string;
  readonly confidence: string | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
}

export interface CategoryReport {
  readonly category: EvalCategory;
  readonly total: number;
  readonly graded: number;
  readonly passed: number;
  readonly passRate: number;
}

export interface EvalReport {
  readonly model: string;
  readonly totalCases: number;
  readonly gradedCases: number;
  readonly ungradedCases: number;
  readonly passed: number;
  readonly accuracy: number;
  /** Expected CORRECT, graded WRONG. The toxic direction. */
  readonly falseNegatives: number;
  readonly falseNegativeRate: number;
  /** Expected WRONG, graded CORRECT. */
  readonly falsePositives: number;
  readonly falsePositiveRate: number;
  readonly byCategory: readonly CategoryReport[];
  readonly failures: readonly CaseResult[];
  readonly latency: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
  };
  readonly tokens: {
    readonly prompt: number;
    readonly completion: number;
    readonly calls: number;
  };
  readonly lowConfidence: number;
  readonly gate: {
    readonly accuracyThreshold: number;
    readonly falseNegativeCeiling: number;
    readonly pass: boolean;
    readonly reasons: readonly string[];
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

export interface RunEvalOptions {
  readonly bank: ItemBank;
  readonly provider: ClassifierProvider;
  readonly model: string;
  readonly cases?: readonly EvalCase[];
  /** Parallel in-flight classifications. Kept modest to stay off the rate limit. */
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly policy?: JudgingPolicy;
  readonly onProgress?: (done: number, total: number) => void;
}

export async function runEval(options: RunEvalOptions): Promise<EvalReport> {
  const cases = options.cases ?? buildEvalSet(options.bank);
  const reviewLog = new MemoryReviewLog();
  const service = new GradingService({
    bank: options.bank,
    provider: options.provider,
    // Every case must reach the classifier: a cache hit measures the cache, and
    // several cases normalise to the same key on purpose.
    cache: new NullVerdictCache(),
    reviewLog,
    // The eval measures the classifier, so the session allowance is switched off:
    // every LOW-confidence WRONG stands as read. Leaving it on would let the
    // allowance mask false negatives in the first two cases of every run and make
    // the number depend on case ordering.
    lowConfidence: new NoGrantLowConfidenceLedger(),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  const results: CaseResult[] = new Array(cases.length);
  let cursor = 0;
  let done = 0;
  const concurrency = Math.max(1, options.concurrency ?? 6);

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= cases.length) return;
      const testCase = cases[index];
      if (testCase === undefined) return;
      const verdict = await service.grade({
        itemId: testCase.itemId,
        answer: testCase.answer,
        profileId: "eval",
        attemptId: `eval-${index}`,
        roundIndex: index % 6,
      });
      const ungraded = verdict.provenance.fallbackReason !== null;
      results[index] = {
        testCase,
        actual: verdict.kind,
        pass: verdict.kind === testCase.expect,
        ungraded,
        latencyMs: verdict.provenance.latencyMs,
        path: verdict.provenance.path,
        confidence: verdict.provenance.confidence,
        promptTokens: verdict.provenance.promptTokens,
        completionTokens: verdict.provenance.completionTokens,
      };
      done += 1;
      options.onProgress?.(done, cases.length);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  const all = results.filter((result): result is CaseResult => result !== undefined);
  const graded = all.filter((result) => !result.ungraded);
  const passed = graded.filter((result) => result.pass).length;
  const expectedCorrect = graded.filter((r) => r.testCase.expect === "CORRECT");
  const expectedWrong = graded.filter((r) => r.testCase.expect === "WRONG");
  const falseNegatives = expectedCorrect.filter((r) => r.actual === "WRONG").length;
  const falsePositives = expectedWrong.filter((r) => r.actual === "CORRECT").length;

  const categories = new Map<EvalCategory, CategoryReport>();
  for (const result of all) {
    const key = result.testCase.category;
    const previous = categories.get(key) ?? {
      category: key,
      total: 0,
      graded: 0,
      passed: 0,
      passRate: 0,
    };
    const next = {
      category: key,
      total: previous.total + 1,
      graded: previous.graded + (result.ungraded ? 0 : 1),
      passed: previous.passed + (result.pass && !result.ungraded ? 1 : 0),
      passRate: 0,
    };
    categories.set(key, { ...next, passRate: next.graded === 0 ? 0 : next.passed / next.graded });
  }

  const latencies = [...all.map((result) => result.latencyMs)].sort((a, b) => a - b);
  const accuracy = graded.length === 0 ? 0 : passed / graded.length;
  const falseNegativeRate =
    expectedCorrect.length === 0 ? 0 : falseNegatives / expectedCorrect.length;
  const falsePositiveRate =
    expectedWrong.length === 0 ? 0 : falsePositives / expectedWrong.length;

  const reasons: string[] = [];
  if (accuracy < EVAL_PASS_THRESHOLD) {
    reasons.push(
      `accuracy ${(accuracy * 100).toFixed(1)}% is below the ${(EVAL_PASS_THRESHOLD * 100).toFixed(0)}% floor`,
    );
  }
  if (falseNegativeRate > EVAL_MAX_FALSE_NEGATIVE_RATE) {
    reasons.push(
      `false-negative rate ${(falseNegativeRate * 100).toFixed(1)}% exceeds the ${(EVAL_MAX_FALSE_NEGATIVE_RATE * 100).toFixed(0)}% ceiling — correct answers are being marked wrong`,
    );
  }
  if (graded.length < all.length * 0.9) {
    reasons.push(
      `only ${graded.length} of ${all.length} cases were actually classified; the rest fell back, so this run does not measure the grader`,
    );
  }

  return {
    model: options.model,
    totalCases: all.length,
    gradedCases: graded.length,
    ungradedCases: all.length - graded.length,
    passed,
    accuracy,
    falseNegatives,
    falseNegativeRate,
    falsePositives,
    falsePositiveRate,
    byCategory: [...categories.values()].sort((a, b) =>
      a.category < b.category ? -1 : 1,
    ),
    failures: graded.filter((result) => !result.pass),
    latency: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.length === 0 ? 0 : (latencies[latencies.length - 1] ?? 0),
    },
    tokens: {
      prompt: all.reduce((sum, r) => sum + (r.promptTokens ?? 0), 0),
      completion: all.reduce((sum, r) => sum + (r.completionTokens ?? 0), 0),
      calls: all.filter((r) => r.promptTokens !== null).length,
    },
    lowConfidence:
      reviewLog.countOf("LOW_CONFIDENCE") +
      reviewLog.countOf("LOW_CONFIDENCE_LIMIT"),
    gate: {
      accuracyThreshold: EVAL_PASS_THRESHOLD,
      falseNegativeCeiling: EVAL_MAX_FALSE_NEGATIVE_RATE,
      pass: reasons.length === 0,
      reasons,
    },
  };
}

export function formatEvalReport(report: EvalReport): string {
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const lines = [
    `model                ${report.model}`,
    `cases                ${report.totalCases} (${report.gradedCases} classified, ${report.ungradedCases} fell back)`,
    `accuracy             ${pct(report.accuracy)}  (${report.passed}/${report.gradedCases})`,
    `false negatives      ${report.falseNegatives}  ${pct(report.falseNegativeRate)}  <- the one that matters`,
    `false positives      ${report.falsePositives}  ${pct(report.falsePositiveRate)}`,
    `low confidence       ${report.lowConfidence}`,
    `latency ms           p50 ${report.latency.p50.toFixed(0)}  p95 ${report.latency.p95.toFixed(0)}  p99 ${report.latency.p99.toFixed(0)}  max ${report.latency.max.toFixed(0)}`,
    `tokens               ${report.tokens.prompt} prompt + ${report.tokens.completion} completion over ${report.tokens.calls} calls`,
    "",
    "by category",
  ];
  for (const category of report.byCategory) {
    lines.push(
      `  ${category.category.padEnd(20)} ${String(category.passed).padStart(3)}/${String(category.graded).padEnd(3)} ${pct(category.passRate)}`,
    );
  }
  if (report.failures.length > 0) {
    lines.push("", `failures (${report.failures.length})`);
    for (const failure of report.failures) {
      lines.push(
        `  [${failure.testCase.category}] ${failure.testCase.itemId}`,
        `    answer   ${JSON.stringify(failure.testCase.answer)}`,
        `    expected ${failure.testCase.expect}, got ${failure.actual} (confidence ${failure.confidence ?? "n/a"})`,
        `    why      ${failure.testCase.why}`,
      );
    }
  }
  lines.push(
    "",
    report.gate.pass
      ? `GATE PASS  accuracy >= ${pct(report.gate.accuracyThreshold)} and false negatives <= ${pct(report.gate.falseNegativeCeiling)}`
      : `GATE FAIL  ${report.gate.reasons.join("; ")}`,
  );
  return lines.join("\n");
}
