// The gauntlet, proven to reject the three deliberately-bad shapes the owner named
// — trivial/recall, AI-tell-laden, and overlapping — and proven NOT to reject the
// hand-authored corpus it is modelled on. This is the "checks before generation"
// evidence: it exists and passes before any generator does.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readContentFile, M1_DUEL_BANK_PATH } from "../items/m1.js";
import {
  runStaticGauntlet,
  runGauntlet,
  checkAiTells,
  combineHalves,
  deterministicProseAccept,
  type CandidateItem,
  type CardRef,
  type PipelineModel,
} from "../pipeline/index.js";

const M1_CODEX_PATH = "content/m1/codex-cards.json";

const cards: readonly CardRef[] = readContentFile<{
  cards: readonly { cardId: string; conceptId: string; proposition: string; title?: string }[];
}>(M1_CODEX_PATH).cards.map((c) => ({
  cardId: c.cardId,
  conceptId: c.conceptId,
  proposition: c.proposition,
}));

const ACTS = "BOS.CONCEPT.INTOLERABLE_ACTS.v1";
const ACTS_POOL = "BOS.MD01.POOL.DUEL_INTOLERABLE_ACTS.v1";
const LAWFUL_CARD = "BOS.MD01.CARD.PAPER_IS_LAWFUL.v1";
const FOUR_CARD = "BOS.MD01.CARD.FOUR_ACTS.v1";

function candidate(overrides: Partial<CandidateItem>): CandidateItem {
  return {
    id: "ACTS.TEST",
    conceptId: ACTS,
    poolId: ACTS_POOL,
    boundCardIds: [LAWFUL_CARD],
    question:
      "You are about to carry a printed handbill through the occupied town. Do any of the four Acts forbid it, and what puts printing on the safe side of them?",
    referenceAnswer:
      "No. None of the four Acts reaches printing or carrying paper; they shut the port, moved trials, quartered troops and ended the town meeting, and a handbill is none of those.",
    requiredCore: [
      "Carrying a printed handbill breaks none of the four Acts, because the Acts reach trade, trials, troops and the town meeting, not printing",
    ],
    needs: "all",
    accept: [
      "no, none of them ban printing, they shut the port and the meetings not the press",
      "printing paper is still lawful, the acts dont touch it",
      "no act stops a handbill, they closed trade and trials not the press",
    ],
    reject: [
      "yes the port act bans printing",
      "the government act makes handbills illegal",
      "no because the king forbids it",
    ],
    ...overrides,
  };
}

function codes(findings: readonly { code: string; severity: string }[], severity?: string): string[] {
  return findings
    .filter((f) => severity === undefined || f.severity === severity)
    .map((f) => f.code);
}

// ---- a well-formed item clears the static gauntlet --------------------------

test("a well-formed candidate raises no ERROR in the static gauntlet", () => {
  const findings = runStaticGauntlet({ candidate: candidate({}), cards });
  assert.equal(
    findings.some((f) => f.severity === "ERROR"),
    false,
    `unexpected errors: ${JSON.stringify(findings.filter((f) => f.severity === "ERROR"))}`,
  );
});

// ---- deliberately trivial / recall -----------------------------------------

test("a bare-recall item (date stem, bare-year answer, no decision) is rejected", () => {
  const trivial = candidate({
    id: "ACTS.WHAT_YEAR",
    question: "In what year did Parliament pass the Coercive Acts?",
    referenceAnswer: "1774.",
    requiredCore: ["the year the Acts passed, 1774"],
    boundCardIds: ["BOS.MD01.CARD.PORT_CLOSED_TO_PUNISH.v1"],
    conceptId: "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    poolId: "BOS.MD01.POOL.DUEL_INTOLERABLE_ACTS.v1",
    accept: ["1774", "the acts passed in 1774", "1774, after the tea party"],
    reject: ["1765", "1773", "1776"],
  });
  const findings = runStaticGauntlet({ candidate: trivial, cards });
  assert.ok(codes(findings, "ERROR").includes("RECALL_NOT_REASONING"), JSON.stringify(findings));
});

// ---- deliberately AI-tell-laden --------------------------------------------

test("AI tells in the question are rejected (em dash + LLM lexicon)", () => {
  const laden = candidate({
    question:
      "Let's delve into why Parliament \u2014 facing its debts \u2014 chose to tax the colonies. Which side of the stamp is the almanac on?",
  });
  const aiFindings = checkAiTells(laden);
  const errorCodes = codes(aiFindings, "ERROR");
  assert.ok(errorCodes.includes("EM_EN_DASH"), JSON.stringify(aiFindings));
  assert.ok(errorCodes.includes("LLM_LEXICON"), JSON.stringify(aiFindings));
  // And the whole static gauntlet rejects it.
  assert.equal(runStaticGauntlet({ candidate: laden, cards }).some((f) => f.severity === "ERROR"), true);
});

test("typographic quotes and markdown are rejected", () => {
  const smart = candidate({ question: "Which one does the stamp \u201Ctouch\u201D? Decide and say why." });
  assert.ok(codes(checkAiTells(smart), "ERROR").includes("TYPOGRAPHIC_QUOTES"));
  const md = candidate({ question: "**Which** one does the stamp touch, and why does it fall on that one?" });
  assert.ok(codes(checkAiTells(md), "ERROR").includes("MARKDOWN_ARTIFACT"));
});

// ---- the AI-tell gate does NOT reject the authored corpus -------------------

test("every hand-authored question passes the AI-tell ERROR gate", () => {
  const bank = readContentFile<{
    items: readonly { question: string }[];
    pvpHardening?: { items?: readonly { question: string }[] };
  }>(M1_DUEL_BANK_PATH);
  const questions = [
    ...bank.items.map((i) => i.question),
    ...(bank.pvpHardening?.items ?? []).map((i) => i.question),
  ];
  assert.ok(questions.length >= 25, `expected the 25-item corpus, got ${questions.length}`);
  for (const question of questions) {
    const findings = checkAiTells(candidate({ question }));
    assert.equal(
      findings.some((f) => f.severity === "ERROR"),
      false,
      `authored question wrongly flagged: ${JSON.stringify({ question, findings })}`,
    );
  }
});

// ---- deliberately overlapping (needs the model discriminator) ---------------

function fakeModel(defensible: ReadonlySet<string>): PipelineModel {
  return {
    judge: async () => ({
      defensible: Object.fromEntries(cards.map((c, i) => [`c${i + 1}`, defensible.has(c.cardId)])),
    }),
  };
}

test("an item a second card also answers is rejected as OVERLAP", async () => {
  // The model says both the bound scope card AND the date card defensibly answer.
  const model = fakeModel(new Set([LAWFUL_CARD, FOUR_CARD]));
  const report = await runGauntlet({ candidate: candidate({}), cards, model });
  assert.equal(report.modelChecksRan, true);
  assert.ok(codes(report.findings, "ERROR").includes("OVERLAP"), JSON.stringify(report.findings));
  assert.equal(report.passed, false);
});

test("a cleanly-separated item passes the discriminator", async () => {
  const model = fakeModel(new Set([LAWFUL_CARD]));
  const report = await runGauntlet({ candidate: candidate({}), cards, model });
  assert.equal(report.modelChecksRan, true);
  assert.equal(report.passed, true, JSON.stringify(report.findings));
});

test("a binding no card defensibly answers is rejected", async () => {
  // The model says the bound card does NOT answer the question.
  const model = fakeModel(new Set([FOUR_CARD]));
  const report = await runGauntlet({ candidate: candidate({}), cards, model });
  const errorCodes = codes(report.findings, "ERROR");
  assert.ok(errorCodes.includes("BINDING_NOT_DEFENSIBLE"), JSON.stringify(report.findings));
});

test("a failed model call reports MODEL_UNAVAILABLE and does not pass as verified", async () => {
  const brokenModel: PipelineModel = { judge: async () => null };
  const report = await runGauntlet({ candidate: candidate({}), cards, model: brokenModel });
  assert.equal(report.modelChecksRan, false);
  assert.ok(codes(report.findings).includes("MODEL_UNAVAILABLE"));
});

// ---- binding and label defects ---------------------------------------------

test("binding to an unknown or wrong-concept card is rejected", () => {
  const unknown = candidate({ boundCardIds: ["BOS.MD01.CARD.DOES_NOT_EXIST.v1"] });
  assert.ok(codes(runStaticGauntlet({ candidate: unknown, cards }), "ERROR").includes("UNKNOWN_CARD"));

  const wrongConcept = candidate({ boundCardIds: ["BOS.MD01.CARD.CONSENT_GROUND.v1"] });
  assert.ok(
    codes(runStaticGauntlet({ candidate: wrongConcept, cards }), "ERROR").includes(
      "CARD_CONCEPT_MISMATCH",
    ),
  );
});

test("too few held-out labels is rejected (the anti-erosion floor, per item)", () => {
  const thin = candidate({ accept: ["only one"], reject: ["a", "b", "c"] });
  assert.ok(codes(runStaticGauntlet({ candidate: thin, cards }), "ERROR").includes("THIN_ACCEPT_LABELS"));
});

// ---- the runtime prose half -------------------------------------------------

test("deterministic fast-accept grants an exact/near phrasing and escalates otherwise", () => {
  const accepts = candidate({}).accept;
  assert.equal(deterministicProseAccept("no, none of them ban printing, they shut the port and the meetings not the press", accepts), true);
  // A correct-but-differently-phrased answer does NOT get a fast reject — it returns
  // false, which means "escalate to the model", so the fast tier cannot cause a false negative.
  assert.equal(deterministicProseAccept("nothing they printed is caught by the four acts", accepts), false);
});

test("combineHalves grades the two halves independently for the feedback signal", () => {
  assert.deepEqual(combineHalves(true, true), { verdict: "CORRECT", signal: "MASTERED" });
  assert.deepEqual(combineHalves(true, false), {
    verdict: "WRONG",
    signal: "EVIDENCE_RIGHT_REASONING_WEAK",
  });
  assert.deepEqual(combineHalves(false, true), {
    verdict: "WRONG",
    signal: "REASONING_RIGHT_EVIDENCE_WRONG",
  });
  assert.deepEqual(combineHalves(false, false), { verdict: "WRONG", signal: "MISSED" });
});
