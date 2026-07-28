// The authored content, checked the way a content compiler checks it.
//
// The bank is `content/m1/duel-items.json`, read through the port in
// ../items/port.ts. These tests are the drift detector: if the content pass edits
// the file into a shape this service cannot grade, one of them fails and names the
// item. That is the guarantee a generated artifact would give, without a second
// copy of eighteen items to keep in step.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { validateAuthoredPool } from "../rubric.js";
import {
  m1AuthoredPools,
  m1ContentBank,
  m1GradingPolicy,
  m1ItemBank,
} from "../items/m1.js";
import { isCountCoreItem, twoPartCoreItemIds } from "../items/port.js";
import { buildSystemPrompt } from "../prompt.js";

const bank = m1ItemBank();
const pools = m1AuthoredPools();
const content = m1ContentBank();

describe("the authored bank loads", () => {
  it("is the production content bank, not a transliteration", () => {
    assert.equal(content.contentId, "BOS.MD01.CONTENT.DUEL_BANK.v1");
    assert.equal(content.items.length, 18);
  });

  it("has the eighteen items Mission-Slate §4.9 requires, six per concept", () => {
    assert.equal(bank.size, 18);
    assert.equal(pools.length, 3);
    for (const pool of pools) {
      assert.equal(pool.items.length, 6, `${pool.poolId} has ${pool.items.length} items`);
    }
  });

  it("compiles with no errors", () => {
    for (const pool of pools) {
      const errors = validateAuthoredPool(pool).filter(
        (defect) => defect.severity === "ERROR",
      );
      assert.deepEqual(errors, [], `${pool.poolId}: ${JSON.stringify(errors)}`);
    }
  });

  it("compiles with no warnings either, which is the authoring bar", () => {
    for (const pool of pools) {
      const warnings = validateAuthoredPool(pool).filter(
        (defect) => defect.severity === "WARN",
      );
      assert.deepEqual(
        warnings,
        [],
        `${pool.poolId} warnings: ${JSON.stringify(warnings, null, 1)}`,
      );
    }
  });

  it("gives every item a version derived from its content", () => {
    const versions = new Set(bank.items.map((item) => item.rubricVersion));
    assert.equal(versions.size, 18, "two items share a rubric version");
    for (const item of bank.items) {
      assert.match(item.rubricVersion, /^r1-[0-9a-f]{16}$/);
    }
  });

  it("carries the canonical curriculum concept ids", () => {
    // The content retagged these from the legacy BOS.MD01.CONCEPT.* ids to the
    // canonical BOS.CONCEPT.* ones from packages/curriculum.
    assert.deepEqual(
      [...new Set(bank.items.map((item) => item.conceptId))].sort(),
      [
        "BOS.CONCEPT.POSTWAR_REVENUE.v1",
        "BOS.CONCEPT.REPRESENTATION.v1",
        "BOS.CONCEPT.STAMP_SCOPE.v1",
      ],
    );
  });

  it("keeps the item ids the two banks agree on", () => {
    // The port is a replacement rather than a merge, and it only is one if the ids
    // match. These are §4.9's ids and the content's ids both.
    for (const itemId of [
      "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1",
      "BOS.MD01.DUEL.POSTWAR.CAME_FROM_NOWHERE.v1",
      "BOS.MD01.DUEL.STAMP.FROM_WHEN.v1",
      "BOS.MD01.DUEL.STAMP.NAME_TWO.v1",
      "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1",
      "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1",
    ]) {
      assert.ok(bank.get(itemId) !== undefined, `${itemId} missing from the bank`);
    }
    for (const item of bank.items) {
      assert.match(item.itemId, /^BOS\.MD01\.DUEL\.[A-Z]+\.[A-Z_]+\.v1$/);
    }
  });
});

describe("the line every item draws", () => {
  it("requires the whole authored core on every item", () => {
    // This bank writes the line into the wording of the core rather than into a
    // count, so needs is always every idea. A count below the total would mean an
    // idea the author said was required is optional.
    for (const item of bank.items) {
      assert.equal(
        item.needs,
        item.ideas.length,
        `${item.itemId} needs ${item.needs} of ${item.ideas.length}`,
      );
    }
  });

  it("gives twelve items a single core and six a genuine two-part core", () => {
    // The owner made the prose grader require both halves on the items whose evidence
    // hand demands two cards, so a written half-answer fails just as a one-card
    // selection does. Twelve items keep a single required proposition (NAME_TWO's
    // count is one idea); six carry two ideas with needs "all", which is still binary
    // rather than partial credit.
    const single = bank.items.filter((item) => item.ideas.length === 1);
    assert.equal(single.length, 12, "expected 12 single-core items");
    const twoPart = bank.items.filter((item) => item.ideas.length === 2);
    assert.equal(twoPart.length, 6, "expected 6 two-part items in the PvE bank");
    for (const item of twoPart) {
      assert.equal(item.needs, 2, `${item.itemId} must require both halves`);
    }
  });

  it("splits exactly the items whose core is genuinely two propositions", () => {
    // The five postwar/representation items promoted to a two-card minimum, plus
    // BOSTON_DOES_ELECT which was always two-part, plus the PvP-only HOW_FAR_IT_GOES.
    assert.deepEqual([...twoPartCoreItemIds()].sort(), [
      "BOS.MD01.DUEL.POSTWAR.DEBT_TO_TAX.v1",
      "BOS.MD01.DUEL.POSTWAR.WHAT_IT_LEFT.v1",
      "BOS.MD01.DUEL.POSTWAR.WHO_PAYS.v1",
      "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1",
      "BOS.MD01.DUEL.REP.HOW_FAR_IT_GOES.v1",
      "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1",
      "BOS.MD01.DUEL.REP.NOT_THE_MONEY.v1",
    ]);
    const item = bank.get("BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1");
    assert.equal(item?.ideas.length, 2);
    assert.equal(item?.needs, 2, "either half alone leaves the objection standing");
  });

  it("keeps NAME_TWO as one idea, because a count is not two propositions", () => {
    assert.ok(isCountCoreItem("BOS.MD01.DUEL.STAMP.NAME_TWO.v1"));
    const item = bank.get("BOS.MD01.DUEL.STAMP.NAME_TWO.v1");
    assert.equal(item?.ideas.length, 1);
    assert.match(item?.ideas[0]?.text ?? "", /two distinct/i);
  });

  it("turns the date item into reasoning about the resistance window, not date recall", () => {
    // Rewritten from "From what date must the stamp be paid?" — a bare recall
    // question the owner's later direction retired as trivia — into one that asks
    // why the town is still free to argue tonight when the Act is already law. The
    // student can only answer by reasoning from the taught fact (the duty begins
    // 1 November) that the tax has not yet taken effect. The date is still tested,
    // as the ground of a causal claim rather than as a string to recall.
    const item = bank.get("BOS.MD01.DUEL.STAMP.FROM_WHEN.v1");
    assert.ok(item !== undefined);
    assert.equal(item.ideas.length, 1, "still a single-core item");
    assert.match(
      item.ideas[0]?.text ?? "",
      /not taken effect|not yet|still time|not owed until/i,
    );
    assert.match(item.ask, /what has not happened yet|why is this town still/i);
    // The bare-recall answer is no longer the whole item.
    assert.doesNotMatch(item.ask, /from what date must the stamp be paid/i);
  });
});

describe("held-out examples and provenance", () => {
  it("gives every item at least two correct examples and one wrong", () => {
    for (const item of bank.items) {
      assert.ok(
        item.heldOutExamples.correct.length >= 2,
        `${item.itemId} has ${item.heldOutExamples.correct.length} accept examples`,
      );
      assert.ok(
        item.heldOutExamples.wrong.length >= 1,
        `${item.itemId} has no reject example`,
      );
    }
  });

  it("carries far more examples than the draft did", () => {
    // The draft averaged two or three per item. This bank's depth is the reason the
    // eval set is worth running.
    const total = bank.items.reduce(
      (sum, item) =>
        sum + item.heldOutExamples.correct.length + item.heldOutExamples.wrong.length,
      0,
    );
    assert.ok(total >= 170, `only ${total} held-out examples across 18 items`);
  });

  it("maps every item onto at least one Codex card", () => {
    for (const item of bank.items) {
      assert.ok(item.cards.length >= 1, `${item.itemId} maps to no card`);
      for (const card of item.cards) {
        assert.match(card, /^BOS\.MD01\.CARD\.[A-Z_]+\.v1$/);
      }
    }
  });

  it("cites the ninth Codex card, which the concept registry still needs", () => {
    // BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1 is new in this content pass. Two items
    // rest on it, and packages/curriculum's REPRESENTATION entry does not list it
    // yet — reported as a follow-up rather than fixed here, since the registry is
    // another agent's file.
    const citing = bank.items.filter((item) =>
      item.cards.includes("BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1"),
    );
    assert.deepEqual(
      citing.map((item) => item.itemId).sort(),
      [
        "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1",
        "BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1",
      ],
    );
  });

  it("aliases the war's names on the item where the student must name it", () => {
    // §4.9's module-coverage constraint 2. Without this a student writing "Seven
    // Years' War" is marked wrong for using the name their textbook uses.
    const item = bank.get("BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1");
    const flat = (item?.alsoIgnore ?? []).join(" ");
    assert.match(flat, /Seven Years/);
    assert.match(flat, /French and Indian/);
    assert.ok(buildSystemPrompt(item!).includes("Seven Years"));
  });
});

describe("the calibrated grading policy", () => {
  it("comes from the content rather than from this package", () => {
    const policy = m1GradingPolicy();
    assert.equal(policy.policyId, "BOS.MD01.GRADING_POLICY.v1");
    assert.ok(policy.alwaysIgnore.length >= 6);
    assert.ok(policy.neverSufficient.length >= 6);
  });

  it("states the four rules read off the TEA-scored responses", () => {
    const policy = m1GradingPolicy();
    const ignore = policy.alwaysIgnore.join(" ").toLowerCase();
    const never = policy.neverSufficient.join(" ").toLowerCase();
    // Naming without explaining scores zero.
    assert.match(never, /without saying anything about it|naming/);
    // Vague affect scores zero however fluent.
    assert.match(never, /mad|angry|fair/);
    // Form is not evidence.
    assert.match(ignore, /spelling/);
    assert.match(ignore, /length/);
  });

  it("reaches the prompt, so the calibration is what the model is told", () => {
    const prompt = buildSystemPrompt(bank.get("BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1")!, {
      governingQuestion: "Q?",
      alwaysIgnore: m1GradingPolicy().alwaysIgnore,
      neverSufficient: m1GradingPolicy().neverSufficient,
    });
    assert.ok(prompt.includes("ALWAYS IGNORE:"));
    assert.ok(prompt.includes("NEVER SUFFICIENT ON ITS OWN:"));
    assert.ok(prompt.includes("TEA"), "the calibration evidence is cited to the model");
  });
});

describe("every item's prompt is well formed", () => {
  it("names the question, the reference answer and every idea", () => {
    for (const item of bank.items) {
      const prompt = buildSystemPrompt(item);
      assert.ok(prompt.includes(item.ask), `${item.itemId} omits its question`);
      for (const idea of item.ideas) {
        assert.ok(prompt.includes(idea.text), `${item.itemId} omits idea ${idea.key}`);
      }
    }
  });

  it("stays small enough to be cheap, since prompt tokens are the whole cost", () => {
    for (const item of bank.items) {
      const characters = buildSystemPrompt(item).length;
      assert.ok(characters < 6_000, `${item.itemId} prompt is ${characters} characters`);
    }
  });
});

describe("module answerability", () => {
  it("declares no unanswerable item, and every item names its source cue", () => {
    // The content fixed three items by changing the module rather than loosening a
    // rubric, which is the right direction. If that claim ever stops holding, this
    // is where it shows.
    assert.deepEqual(
      (content as unknown as { moduleCoverage: { itemsNotAnswerable: string[] } })
        .moduleCoverage.itemsNotAnswerable,
      [],
    );
    for (const item of content.items) {
      assert.ok(
        item.answerableFrom.length >= 1,
        `${item.itemId} names no module cue it is answerable from`,
      );
    }
  });
});
