import test from "node:test";
import assert from "node:assert/strict";
import {
  choiceTagline,
  primerFor,
} from "../src/pages/play/playCopy.js";

test("first-use hints are one-line context rather than stacked modal copy", () => {
  const seen = new Set<"ARCHIVE" | "MOVEMENT" | "READ" | "WORK" | "CHOICE">();
  const choice = primerFor(
    {
      kind: "CHOICE",
      promptId: "ENTRY",
      frame: "At the door",
      options: [],
    },
    seen,
  );
  assert.deepEqual(choice, {
    id: "CHOICE",
    hint: "Small tags preview the tone or cost before you choose.",
  });
  assert.equal(choice?.hint.includes("ACKNOWLEDGE"), false);
  assert.equal(primerFor(
    {
      kind: "CHOICE",
      promptId: "ENTRY",
      frame: "At the door",
      options: [],
    },
    new Set(["CHOICE"]),
  ), null);
});

test("choice cards never repeat the meaningless approach fallback", () => {
  assert.equal(choiceTagline([]), null);
  assert.equal(
    choiceTagline(["costs time", "earns a favor"]),
    "costs time · earns a favor",
  );
});
