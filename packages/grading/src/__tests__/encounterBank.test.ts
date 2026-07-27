import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt } from "../prompt.js";
import { m1EncounterBank, resetM1EncounterBankCache } from "../items/encounters.js";

test("the encounter bank compiles to six items across two pools", () => {
  resetM1EncounterBankCache();
  const bank = m1EncounterBank();
  assert.equal(bank.size, 6);
  const ids = bank.items.map((item) => item.itemId).sort();
  assert.deepEqual(ids, [
    "BOS.MD01.ENC.ROPEWALK.WHAT_STOPS.v1",
    "BOS.MD01.ENC.ROPEWALK.WHOSE_TROUBLE.v1",
    "BOS.MD01.ENC.ROPEWALK.WHY_CARE.v1",
    "BOS.MD01.ENC.SHAMBLES.BY_WHAT_RIGHT.v1",
    "BOS.MD01.ENC.SHAMBLES.WHO_DEFENDED.v1",
    "BOS.MD01.ENC.SHAMBLES.WHY_PAY.v1",
  ]);
});

test("every item carries a real rubric: ideas, a threshold, and rich examples", () => {
  const bank = m1EncounterBank();
  for (const item of bank.items) {
    assert.ok(item.ideas.length >= 1 && item.ideas.length <= 3, `${item.itemId} ideas`);
    assert.ok(item.needs >= 1 && item.needs <= item.ideas.length, `${item.itemId} needs`);
    assert.ok(
      item.heldOutExamples.correct.length >= 3,
      `${item.itemId} has < 3 accept examples`,
    );
    assert.ok(
      item.heldOutExamples.wrong.length >= 3,
      `${item.itemId} has < 3 reject examples`,
    );
    assert.ok(item.wrongIfSays.length >= 1, `${item.itemId} has no wrong-classes`);
    // Accept and reject must be disjoint — an example cannot be both.
    const accept = new Set(item.heldOutExamples.correct.map((t) => t.toLowerCase()));
    for (const wrong of item.heldOutExamples.wrong) {
      assert.equal(accept.has(wrong.toLowerCase()), false, `${item.itemId} overlap`);
    }
  }
});

test("no accept/reject example text is ever rendered into the classifier prompt", () => {
  const bank = m1EncounterBank();
  for (const item of bank.items) {
    const prompt = buildSystemPrompt(item);
    for (const example of [
      ...item.heldOutExamples.correct,
      ...item.heldOutExamples.wrong,
    ]) {
      assert.equal(
        prompt.includes(example),
        false,
        `${item.itemId} leaked a held-out example into the prompt`,
      );
    }
  }
});
