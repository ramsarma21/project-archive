import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  clampAnswer,
  normalizeAnswer,
  preCheckAnswer,
  questionEchoRatio,
} from "../normalize.js";

describe("normalisation collapses what is certainly not semantic", () => {
  it("folds case, whitespace and trailing punctuation", () => {
    assert.equal(
      normalizeAnswer("  The   DEBT, obviously!  "),
      normalizeAnswer("the debt obviously"),
    );
  });

  it("folds smart quotes and dashes to their plain forms", () => {
    assert.equal(
      normalizeAnswer("they\u2019re broke \u2014 from the war"),
      normalizeAnswer("they're broke - from the war"),
    );
  });

  it("folds unicode composition, so an accent typed either way is one key", () => {
    assert.equal(normalizeAnswer("caf\u00e9"), normalizeAnswer("cafe\u0301"));
  });
});

describe("normalisation refuses to collapse what is semantic", () => {
  // Each of these pairs would share a cache entry under a stemming or
  // stopword-stripping normaliser, and each pair means opposite things.
  it("keeps yes and no apart", () => {
    assert.notEqual(normalizeAnswer("yes it is printed"), normalizeAnswer("no it is printed"));
  });

  it("keeps causal direction apart", () => {
    assert.notEqual(
      normalizeAnswer("the debt caused the tax"),
      normalizeAnswer("the tax caused the debt"),
    );
  });

  it("keeps negation apart", () => {
    assert.notEqual(
      normalizeAnswer("it does tax ordinary goods"),
      normalizeAnswer("it does not tax ordinary goods"),
    );
  });

  it("keeps different dates apart", () => {
    assert.notEqual(normalizeAnswer("1 november"), normalizeAnswer("1 december"));
  });
});

describe("the pre-check decides only what is certain", () => {
  it("abstains on an empty box", () => {
    assert.equal(preCheckAnswer(""), "EMPTY");
    assert.equal(preCheckAnswer("   \n\t"), "EMPTY");
    assert.equal(preCheckAnswer("\u00a0\u2003"), "EMPTY");
    assert.equal(preCheckAnswer("..."), "EMPTY");
  });

  it("does not abstain on a short but real answer", () => {
    // Several authored items legitimately grade a bare "no" as wrong. Wrong is a
    // grade; abstention is not, and confusing the two loses information.
    assert.equal(preCheckAnswer("no"), null);
    assert.equal(preCheckAnswer("debt"), null);
  });

  it("does not try to decide keyword salad, which is a judgement", () => {
    assert.equal(preCheckAnswer("debt colonies Parliament war France 1763"), null);
  });
});

describe("question echo is a signal, not a verdict", () => {
  it("scores a verbatim restatement near one", () => {
    const question = "Why is Parliament reaching into Boston for money now?";
    assert.ok(questionEchoRatio(question, question) > 0.9);
  });

  it("scores a real answer low", () => {
    assert.ok(
      questionEchoRatio(
        "Why is Parliament reaching into Boston for money now?",
        "they were broke after the war with france",
      ) < 0.3,
    );
  });

  it("does not punish an answer that must reuse the question's nouns", () => {
    // The item asks which came first, the debt or the tax; any answer names both.
    // A high score here would be a false positive if it decided anything.
    const ratio = questionEchoRatio(
      "Which came first, the debt or the tax? Say which, and what that ordering tells you.",
      "the debt came first and the tax was the response",
    );
    assert.ok(ratio > 0.3, `expected a high echo score, got ${ratio}`);
  });

  it("is zero for an empty answer", () => {
    assert.equal(questionEchoRatio("anything", ""), 0);
  });
});

describe("clamping", () => {
  it("leaves a normal answer alone", () => {
    assert.equal(clampAnswer("the debt from the war", 100), "the debt from the war");
  });

  it("truncates on a word boundary when one is near the limit", () => {
    assert.equal(clampAnswer("alpha beta gamma delta", 16), "alpha beta gamma");
  });

  it("hard-truncates when no boundary is near the limit", () => {
    assert.equal(clampAnswer("aaaaaaaaaaaaaaaaaaaa", 5).length, 5);
  });

  it("collapses interior whitespace so padding cannot inflate the prompt", () => {
    assert.equal(clampAnswer("the    debt\n\nfrom  the war", 100), "the debt from the war");
  });
});
