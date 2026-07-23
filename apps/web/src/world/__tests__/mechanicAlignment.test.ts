import { test } from "node:test";
import assert from "node:assert/strict";
import { startingAlignmentFor } from "../../presenter/CompoundMechanicControls.js";

// Feel-audit-1 P1-18 regression: alignment stages must never open pre-solved
// at dead centre ("100% TRUE" with zero interaction).

test("every stage opens visibly off-centre and inside the rail", () => {
  const stages = [
    "PIKE_PROOF:CATCH",
    "PIKE_PROOF:REGISTER",
    "PIKE_PROOF:PULL",
    "FINAL_PAGE:CATCH",
    "FINAL_PAGE:REGISTER",
    "FINAL_PAGE:PULL",
    "PIKE_REPRINT:CATCH",
    "POST_JOB:LINE_UP",
    "PLACE:LINE_UP",
  ];
  for (const stage of stages) {
    const start = startingAlignmentFor(stage);
    assert.ok(start >= 0 && start <= 1, `${stage} within rail (${start})`);
    assert.ok(
      Math.abs(start - 0.5) >= 0.15,
      `${stage} must open meaningfully off-centre (${start})`,
    );
  }
});

test("offsets are deterministic per stage key", () => {
  assert.equal(
    startingAlignmentFor("PIKE_PROOF:CATCH"),
    startingAlignmentFor("PIKE_PROOF:CATCH"),
  );
});

test("stage keys vary the offset (not one shared constant)", () => {
  const values = new Set(
    ["PIKE_PROOF:CATCH", "PIKE_PROOF:REGISTER", "PIKE_PROOF:PULL", "POST_JOB:LINE_UP"].map(
      startingAlignmentFor,
    ),
  );
  assert.ok(values.size >= 2, "offsets must differ across stages");
});
