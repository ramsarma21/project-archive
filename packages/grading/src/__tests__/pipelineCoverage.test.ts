// The anti-erosion gate: the eval set must cover EVERY item in the bank.
//
// The owner's named failure mode is the gates silently coming to cover a shrinking
// fraction of the bank — "the 3.4% false negatives while reporting healthy, with a
// new mechanism". Generation makes it acute: a generated item that ships with no
// held-out labels contributes nothing to the eval set, so the grader is measured on
// an ever-smaller slice while the number looks fine.
//
// This test makes that impossible to do silently. Every compiled item must carry the
// label floors AND must actually produce eval cases, so bank size and eval coverage
// move together. It runs offline in `pnpm test`; it needs no model.

import assert from "node:assert/strict";
import { test } from "node:test";
import { m1ItemBank } from "../items/m1.js";
import { buildEvalSet } from "../eval/harness.js";
import { MIN_ACCEPT_LABELS, MIN_REJECT_LABELS } from "../pipeline/types.js";

test("every bank item carries the held-out label floors", () => {
  const bank = m1ItemBank();
  for (const item of bank.items) {
    assert.ok(
      item.heldOutExamples.correct.length >= MIN_ACCEPT_LABELS,
      `${item.itemId} has ${item.heldOutExamples.correct.length} accept labels, floor is ${MIN_ACCEPT_LABELS}`,
    );
    assert.ok(
      item.heldOutExamples.wrong.length >= MIN_REJECT_LABELS,
      `${item.itemId} has ${item.heldOutExamples.wrong.length} reject labels, floor is ${MIN_REJECT_LABELS}`,
    );
  }
});

test("the eval set covers 100% of the bank — no item ships unmeasured", () => {
  const bank = m1ItemBank();
  const cases = buildEvalSet(bank);
  const covered = new Set(cases.map((c) => c.itemId));
  const uncovered = bank.items.filter((item) => !covered.has(item.itemId)).map((i) => i.itemId);
  assert.deepEqual(
    uncovered,
    [],
    `these items contribute no eval case, so the gate does not measure them: ${uncovered.join(", ")}`,
  );
  // Stated as a fraction too, so a future regression reads as coverage falling.
  const fraction = covered.size / bank.size;
  assert.equal(fraction, 1, `eval covers ${(fraction * 100).toFixed(1)}% of the bank; it must be 100%`);
});
