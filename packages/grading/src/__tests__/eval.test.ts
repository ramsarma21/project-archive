// The offline half of the ship gate.
//
// The gate itself calls a real model and lives behind `pnpm grading:eval`. What
// runs in CI is everything about the gate that can be wrong without a model: an
// eval case pointing at an item that no longer exists, a category that quietly
// emptied out, a set that drifted to all-correct so a broken grader would pass,
// and the harness's own arithmetic.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { m1ItemBank } from "../items/m1.js";
import {
  HAND_LABELLED_CASES,
  TOLERATED_FALSE_POSITIVES,
  isToleratedFalsePositive,
  type EvalCase,
} from "../eval/cases.js";
import {
  authoredLabelledCases,
  authoredLabelledCounts,
} from "../eval/contentCases.js";
import { authoredCases, buildEvalSet, runEval } from "../eval/harness.js";
import {
  EVAL_MAX_FALSE_NEGATIVE_RATE,
  EVAL_MAX_FALSE_POSITIVE_RATE,
  EVAL_PASS_THRESHOLD,
} from "../tuning.js";
import type { ClassifierProvider, ProviderResult } from "../provider.js";
import type { CompiledItem } from "../rubric.js";

const bank = m1ItemBank();
const set = buildEvalSet(bank);

describe("the evaluation set", () => {
  it("is assembled from three sources and deduplicated", () => {
    const sources =
      authoredCases(bank).length +
      authoredLabelledCases().length +
      HAND_LABELLED_CASES.length;
    assert.ok(set.length <= sources, "dedupe should never add cases");
    // Reported so a shrinking set is visible in a diff rather than silent.
    assert.ok(set.length >= 250, `only ${set.length} cases`);
  });

  it("includes the content pass's labelled answers in full", () => {
    const counts = authoredLabelledCounts();
    assert.equal(authoredLabelledCases().length, counts.total);
    assert.equal(counts.total, 81);
    const byId = new Map(set.map((c) => [`${c.itemId}\u0000${c.answer}`, c]));
    for (const testCase of authoredLabelledCases()) {
      assert.ok(
        byId.has(`${testCase.itemId}\u0000${testCase.answer}`),
        `dropped a calibrated case: ${testCase.answer}`,
      );
    }
  });

  it("points every case at an item that exists", () => {
    for (const testCase of set) {
      assert.ok(
        bank.get(testCase.itemId) !== undefined,
        `case references unknown item ${testCase.itemId}`,
      );
    }
  });

  it("labels every case and explains why it exists", () => {
    for (const testCase of set) {
      assert.ok(testCase.expect === "CORRECT" || testCase.expect === "WRONG");
      assert.ok(testCase.why.length > 10, `thin rationale on ${testCase.itemId}`);
    }
  });

  it("is not so lopsided that marking everything correct would pass", () => {
    const correct = set.filter((testCase) => testCase.expect === "CORRECT").length;
    const share = correct / set.length;
    // A grader that always says CORRECT scores exactly `share`. Keeping that below
    // the accuracy floor is what stops the gate passing a broken grader.
    assert.ok(
      share < EVAL_PASS_THRESHOLD,
      `${(share * 100).toFixed(1)}% of cases expect CORRECT, at or above the ${(EVAL_PASS_THRESHOLD * 100).toFixed(0)}% gate`,
    );
    assert.ok(share > 0.25, `only ${(share * 100).toFixed(1)}% expect CORRECT`);
  });

  it("would also fail a grader that always says WRONG", () => {
    const wrong = set.filter((testCase) => testCase.expect === "WRONG").length;
    assert.ok(wrong / set.length < EVAL_PASS_THRESHOLD);
  });

  it("covers every named adversarial shape from the brief", () => {
    const categories = new Set(set.map((testCase) => testCase.category));
    for (const required of [
      "UNUSUAL_PHRASING",
      "FORMAL_REGISTER",
      "RESTATES_QUESTION",
      "EMPTY",
      "KEYWORD_SALAD",
      "CONFIDENT_BUT_WRONG",
      "PROMPT_INJECTION",
      "NEAR_MISS",
      "AUTHORED_ACCEPT",
      "AUTHORED_REJECT",
    ]) {
      assert.ok(categories.has(required as never), `no ${required} cases`);
    }
  });

  it("weights correct-but-oddly-phrased heaviest, because that is the toxic failure", () => {
    const unusual = set.filter(
      (testCase) =>
        testCase.category === "UNUSUAL_PHRASING" ||
        testCase.category === "FORMAL_REGISTER",
    );
    assert.ok(unusual.length >= 20, `only ${unusual.length} phrasing cases`);
    for (const testCase of unusual) {
      assert.equal(
        testCase.expect,
        "CORRECT",
        `phrasing case expecting WRONG: ${testCase.answer}`,
      );
    }
  });

  it("touches every one of the eighteen items", () => {
    const covered = new Set(set.map((testCase) => testCase.itemId));
    for (const item of bank.items) {
      assert.ok(covered.has(item.itemId), `${item.itemId} has no eval case`);
    }
  });

  it("has no duplicate case", () => {
    const seen = new Set<string>();
    for (const testCase of set) {
      const key = `${testCase.itemId}\u0000${testCase.answer.trim().toLowerCase()}`;
      assert.ok(!seen.has(key), `duplicate case: ${key}`);
      seen.add(key);
    }
  });

  it("does not contradict itself on the same answer to the same item", () => {
    const labels = new Map<string, string>();
    for (const testCase of set) {
      const key = `${testCase.itemId}\u0000${testCase.answer.trim().toLowerCase()}`;
      const previous = labels.get(key);
      assert.ok(
        previous === undefined || previous === testCase.expect,
        `${key} is labelled both ways`,
      );
      labels.set(key, testCase.expect);
    }
  });
});

// A provider that answers from the labels, so the harness's own arithmetic can be
// checked without a model. `accuracy` controls how often it lies.
function oracle(bank_: ReturnType<typeof m1ItemBank>, lieOn: Set<string>): ClassifierProvider {
  const byAsk = new Map<string, CompiledItem>();
  for (const item of bank_.items) byAsk.set(item.ask, item);
  return {
    classify: async (request): Promise<ProviderResult> => {
      const answer = /<student_answer>\n([\s\S]*)\n<\/student_answer>/.exec(request.user)?.[1] ?? "";
      const item = [...byAsk.values()].find((candidate) =>
        request.system.includes(`QUESTION ASKED: ${JSON.stringify(candidate.ask)}`),
      );
      if (item === undefined) throw new Error("oracle could not identify the item");
      const expected = set.find(
        (testCase) =>
          testCase.itemId === item.itemId &&
          testCase.answer.replace(/\s+/g, " ").trim() === answer.trim(),
      );
      const wantCorrect = expected?.expect === "CORRECT";
      const lie = lieOn.has(`${item.itemId}\u0000${answer.trim()}`);
      const sayCorrect = lie ? !wantCorrect : wantCorrect;
      const ideas: Record<string, boolean> = {};
      item.ideas.forEach((idea, index) => {
        ideas[idea.key] = sayCorrect ? true : index < item.needs - 1;
      });
      return {
        raw: { ideas, answers: true, confidence: "HIGH" },
        model: "oracle",
        promptTokens: 200,
        completionTokens: 10,
      };
    },
  };
}

describe("the harness arithmetic", () => {
  it("scores a perfect grader at 100% and passes the gate", async () => {
    const report = await runEval({
      bank,
      provider: oracle(bank, new Set()),
      model: "oracle",
      concurrency: 8,
    });
    // Empty answers never reach the provider; they are decided by the pre-check.
    assert.equal(report.falseNegatives, 0);
    assert.equal(report.falsePositives, 0);
    assert.equal(report.accuracy, 1);
    assert.equal(report.gate.pass, true);
    assert.equal(report.ungradedCases, 0);
  });

  it("fails the gate on false negatives even when accuracy looks acceptable", async () => {
    // Flip a handful of correct answers to wrong. Accuracy stays high; the
    // false-negative ceiling is what catches it, which is the design.
    const lies = new Set(
      set
        .filter((testCase) => testCase.expect === "CORRECT")
        .slice(0, 4)
        .map((testCase) => `${testCase.itemId}\u0000${testCase.answer.trim()}`),
    );
    const report = await runEval({
      bank,
      provider: oracle(bank, lies),
      model: "oracle",
      concurrency: 8,
    });
    assert.equal(report.falseNegatives, 4);
    assert.ok(report.falseNegativeRate > EVAL_MAX_FALSE_NEGATIVE_RATE);
    assert.equal(report.gate.pass, false);
    assert.ok(
      report.gate.reasons.some((reason) => reason.includes("false-negative")),
      `reasons: ${report.gate.reasons.join("; ")}`,
    );
  });

  it("refuses to call an outage a pass", async () => {
    const abort = (): Error => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return error;
    };
    const report = await runEval({
      bank,
      provider: {
        classify: async () => {
          throw abort();
        },
      },
      model: "down",
      concurrency: 8,
    });
    // Every fallback grants CORRECT, which would score well on the correct cases.
    // They are excluded from accuracy and the gate fails on coverage instead.
    assert.ok(report.ungradedCases > 100, `${report.ungradedCases} ungraded`);
    assert.equal(report.gate.pass, false);
    assert.ok(
      report.gate.reasons.some((reason) => reason.includes("fell back")),
      `reasons: ${report.gate.reasons.join("; ")}`,
    );
  });

  it("reports per-category pass rates so a regression is attributable", async () => {
    const report = await runEval({
      bank,
      provider: oracle(bank, new Set()),
      model: "oracle",
      concurrency: 8,
    });
    const phrasing = report.byCategory.find(
      (category) => category.category === "UNUSUAL_PHRASING",
    );
    assert.ok(phrasing !== undefined);
    assert.ok(phrasing.total >= 20);
    assert.equal(phrasing.passRate, 1);
  });
});

// ---------------------------------------------------------------------------
// The false-positive gate: a ceiling for gross drift, plus a named-exception list
// that fails on any un-tolerated over-credit. And majority mode, which the gate
// run uses so one temperature-zero flip cannot decide it.
// ---------------------------------------------------------------------------

/** A provider whose verdict depends on the repeat index carried in the idempotency
 * key, so a test can prove majority voting and that the repeats are distinct calls. */
function perRepeatProvider(
  bank_: ReturnType<typeof m1ItemBank>,
  sayCorrectOnRepeats: ReadonlySet<number>,
): ClassifierProvider {
  return {
    classify: async (request, _signal, idempotencyKey): Promise<ProviderResult> => {
      const item = bank_.items.find((candidate) =>
        request.system.includes(`QUESTION ASKED: ${JSON.stringify(candidate.ask)}`),
      );
      if (item === undefined) throw new Error("provider could not identify the item");
      const repeat = Number(idempotencyKey.split("#").pop());
      const sayCorrect = sayCorrectOnRepeats.has(repeat);
      const ideas: Record<string, boolean> = {};
      for (const idea of item.ideas) ideas[idea.key] = sayCorrect;
      return { raw: { ideas, answers: true, confidence: "HIGH" }, model: "per-repeat", promptTokens: 10, completionTokens: 2 };
    },
  };
}

function wrongCase(): EvalCase {
  const found = set.find((testCase) => testCase.expect === "WRONG");
  assert.ok(found, "the set must contain a WRONG-expected case");
  return found;
}

describe("the false-positive gate", () => {
  it("carries the ceiling and the exception-list size in the report", async () => {
    const report = await runEval({
      bank,
      provider: oracle(bank, new Set()),
      model: "oracle",
      concurrency: 8,
    });
    assert.equal(report.gate.falsePositiveCeiling, EVAL_MAX_FALSE_POSITIVE_RATE);
    assert.equal(report.gate.toleratedFalsePositives, TOLERATED_FALSE_POSITIVES.length);
    assert.equal(report.gate.untoleratedFalsePositives, 0);
    assert.equal(report.gate.pass, true);
  });

  it("fails on a single un-tolerated false positive even below the ceiling", async () => {
    // Flip exactly one WRONG-expected case to CORRECT: one over-credit out of the
    // whole set is well under any percentage ceiling, and it must still fail —
    // that is the half of the gate the ceiling cannot provide.
    const target = wrongCase();
    const lies = new Set([`${target.itemId}\u0000${target.answer.trim()}`]);
    const report = await runEval({
      bank,
      provider: oracle(bank, lies),
      model: "oracle",
      concurrency: 8,
    });
    assert.equal(report.falseNegatives, 0);
    assert.ok(report.falsePositives >= 1);
    assert.ok(report.falsePositiveRate < EVAL_MAX_FALSE_POSITIVE_RATE, "one FP is under the ceiling");
    assert.equal(report.gate.untoleratedFalsePositives >= 1, true);
    assert.equal(report.gate.pass, false);
    assert.ok(
      report.gate.reasons.some((reason) => reason.includes("not on the tolerated list")),
      `reasons: ${report.gate.reasons.join("; ")}`,
    );
  });

  it("ships an empty exception list, and the matcher is exact", () => {
    assert.equal(TOLERATED_FALSE_POSITIVES.length, 0);
    assert.equal(isToleratedFalsePositive("any.item", "any answer"), false);
    // Every entry, if any are ever added, must carry a non-blank reason.
    for (const entry of TOLERATED_FALSE_POSITIVES) {
      assert.ok(entry.reason.trim().length > 0, `${entry.itemId} tolerated with no reason`);
    }
  });
});

describe("majority mode", () => {
  it("takes the majority verdict across repeats, and the repeats are distinct calls", async () => {
    const target = wrongCase();
    // CORRECT on 2 of 3 repeats -> majority CORRECT -> an over-credit the gate sees.
    const majorityCorrect = await runEval({
      bank,
      provider: perRepeatProvider(bank, new Set([0, 1])),
      model: "per-repeat",
      cases: [target],
      repeats: 3,
      concurrency: 1,
    });
    assert.equal(majorityCorrect.falsePositives, 1, "2-of-3 CORRECT is a majority CORRECT");

    // CORRECT on only 1 of 3 -> majority WRONG -> correctly rejected. If the gateway
    // had collapsed the three identical requests this could not differ from above,
    // so this also proves the per-repeat idempotency salt makes them distinct.
    const majorityWrong = await runEval({
      bank,
      provider: perRepeatProvider(bank, new Set([0])),
      model: "per-repeat",
      cases: [target],
      repeats: 3,
      concurrency: 1,
    });
    assert.equal(majorityWrong.falsePositives, 0, "1-of-3 CORRECT is a majority WRONG");
  });
});
