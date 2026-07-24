import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inkBeatScore,
  printQualityFor,
  startingAlignmentFor,
  timingWindowPosition,
  timingWindowScore,
} from "../src/presenter/CompoundMechanicControls.js";

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

test("press timing windows are deterministic and visibly score the center", () => {
  assert.equal(timingWindowPosition(475, 1900), 0.5);
  assert.equal(timingWindowPosition(475, 1900), timingWindowPosition(475, 1900));
  assert.equal(timingWindowScore(0.5), 1);
  assert.equal(timingWindowScore(0), 0);
});

test("ink rhythm grades authored beat times without randomness", () => {
  assert.equal(inkBeatScore(560, 0), 1);
  assert.equal(inkBeatScore(1120, 1), 1);
  assert.equal(inkBeatScore(0, 0), 0.35);
});

test("physical quality tiers follow the committed phase scores", () => {
  assert.equal(
    printQualityFor({
      catch: 0.95,
      ink: 0.9,
      register: 0.94,
      pull: 0.92,
      peel: 0.9,
    }),
    "CRISP",
  );
  assert.equal(
    printQualityFor({
      catch: 0.8,
      ink: 0.76,
      register: 0.7,
      pull: 0.72,
      peel: 0.78,
    }),
    "USABLE",
  );
  assert.equal(
    printQualityFor({
      catch: 0.9,
      ink: 0.25,
      register: 0.9,
      pull: 0.9,
      peel: 0.9,
    }),
    "SMUDGED",
  );
});
