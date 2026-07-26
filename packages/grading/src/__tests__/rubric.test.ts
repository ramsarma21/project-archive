import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  compilePool,
  deriveRubricVersion,
  ItemBank,
  RubricCompileError,
  validateAuthoredPool,
  type AuthoredItem,
  type AuthoredPool,
} from "../rubric.js";

const item = (overrides: Partial<AuthoredItem> = {}): AuthoredItem => ({
  id: "SAMPLE",
  ask: "Why did it happen?",
  correct: "Because of the debt.",
  ideas: ["the debt"],
  accept: ["debt", "they owed money"],
  reject: ["the weather"],
  ...overrides,
});

const pool = (items: AuthoredItem[]): AuthoredPool => ({
  poolId: "POOL.TEST.v1",
  conceptId: "CONCEPT.TEST.v1",
  idPrefix: "TEST.DUEL",
  idSuffix: ".v1",
  items,
});

describe("authoring surface", () => {
  it("derives the full item id from the pool namespace so authors write short ids", () => {
    const compiled = compilePool(pool([item({ id: "WHY_NOW" })]));
    assert.equal(compiled.items[0]?.itemId, "TEST.DUEL.WHY_NOW.v1");
  });

  it("defaults the line to every idea", () => {
    const compiled = compilePool(
      pool([item({ ideas: ["a", "b", "c"], needs: undefined })]),
    );
    assert.equal(compiled.items[0]?.needs, 3);
  });

  it("lets the author draw the line below every idea", () => {
    const compiled = compilePool(pool([item({ ideas: ["a", "b", "c"], needs: 2 })]));
    assert.equal(compiled.items[0]?.needs, 2);
  });

  it("keeps held-out examples out of the compiled prompt fields", () => {
    const compiled = compilePool(
      pool([item({ accept: ["one", "two"], reject: ["nope"] })]),
    );
    const only = compiled.items[0];
    assert.deepEqual(only?.heldOutExamples.correct, ["one", "two"]);
    assert.deepEqual(only?.heldOutExamples.wrong, ["nope"]);
  });
});

describe("rubric version derivation", () => {
  it("is stable for the same content", () => {
    assert.equal(deriveRubricVersion(item(), 1), deriveRubricVersion(item(), 1));
  });

  it("changes when the line moves, which is what expires the cache", () => {
    const two = item({ ideas: ["a", "b"] });
    assert.notEqual(deriveRubricVersion(two, 2), deriveRubricVersion(two, 1));
  });

  it("changes when an idea is reworded", () => {
    assert.notEqual(
      deriveRubricVersion(item({ ideas: ["the debt"] }), 1),
      deriveRubricVersion(item({ ideas: ["the war debt"] }), 1),
    );
  });

  it("ignores fields the grader never reads, so a note fix keeps the cache warm", () => {
    assert.equal(
      deriveRubricVersion(item({ note: "look at this again" }), 1),
      deriveRubricVersion(item({ note: "totally different note" }), 1),
    );
    assert.equal(
      deriveRubricVersion(item({ cards: ["CARD.A"] }), 1),
      deriveRubricVersion(item({ cards: ["CARD.B", "CARD.C"] }), 1),
    );
  });

  it("does not collide across reordered ideas, because order carries meaning", () => {
    assert.notEqual(
      deriveRubricVersion(item({ ideas: ["a", "b"] }), 2),
      deriveRubricVersion(item({ ideas: ["b", "a"] }), 2),
    );
  });
});

describe("validation catches what an author gets wrong at scale", () => {
  it("refuses an item with no ideas", () => {
    const defects = validateAuthoredPool(pool([item({ ideas: [] })]));
    assert.ok(defects.some((defect) => defect.code === "NO_IDEAS"));
    assert.throws(() => compilePool(pool([item({ ideas: [] })])), RubricCompileError);
  });

  it("refuses a line that cannot be met", () => {
    const defects = validateAuthoredPool(pool([item({ ideas: ["a"], needs: 3 })]));
    assert.ok(defects.some((defect) => defect.code === "NEEDS_OUT_OF_RANGE"));
  });

  it("refuses duplicate item ids inside a pool", () => {
    const defects = validateAuthoredPool(pool([item(), item()]));
    assert.ok(defects.some((defect) => defect.code === "DUPLICATE_ITEM_ID"));
  });

  it("refuses an example that is in both lists", () => {
    const defects = validateAuthoredPool(
      pool([item({ accept: ["debt", "x"], reject: ["Debt"] })]),
    );
    assert.ok(defects.some((defect) => defect.code === "EXAMPLE_IN_BOTH_LISTS"));
  });

  it("warns rather than fails on thin example coverage", () => {
    const defects = validateAuthoredPool(pool([item({ accept: ["only one"] })]));
    const thin = defects.find((defect) => defect.code === "THIN_ACCEPT_COVERAGE");
    assert.equal(thin?.severity, "WARN");
    assert.doesNotThrow(() => compilePool(pool([item({ accept: ["only one"] })])));
  });

  it("warns when an idea is phrased as a string match", () => {
    const defects = validateAuthoredPool(
      pool([item({ ideas: ["contains the word debt"] })]),
    );
    const warn = defects.find(
      (defect) => defect.code === "IDEA_LOOKS_LIKE_KEYWORD_MATCH",
    );
    assert.equal(warn?.severity, "WARN");
  });

  it("refuses a single-wording sameThing cluster, which credits nothing", () => {
    const defects = validateAuthoredPool(pool([item({ sameThing: [["one wording"]] })]));
    assert.ok(
      defects.some((defect) => defect.code === "SAME_THING_CLUSTER_TOO_SMALL"),
    );
  });

  it("caps ideas per item so a classifier is not asked to track a checklist", () => {
    const defects = validateAuthoredPool(
      pool([item({ ideas: ["a", "b", "c", "d", "e"], needs: 5 })]),
    );
    assert.ok(defects.some((defect) => defect.code === "TOO_MANY_IDEAS"));
  });
});

describe("ItemBank", () => {
  it("refuses two pools claiming the same item id", () => {
    const one = compilePool(pool([item()]));
    assert.throws(() => new ItemBank([one, one]), /duplicate itemId/);
  });

  it("returns undefined for an unknown id rather than guessing", () => {
    const bank = new ItemBank([compilePool(pool([item()]))]);
    assert.equal(bank.get("NOPE"), undefined);
    assert.equal(bank.size, 1);
  });
});
