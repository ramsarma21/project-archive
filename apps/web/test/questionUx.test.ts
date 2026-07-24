import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const checkpoint = readFileSync(
  new URL("../src/presenter/CheckpointDebrief.tsx", import.meta.url),
  "utf8",
);
const openResponse = readFileSync(
  new URL("../src/presenter/OpenResponsePanel.tsx", import.meta.url),
  "utf8",
);

test("CP1 answers show authored rationales before player-controlled advance", () => {
  assert.match(checkpoint, /selected\.rationale/);
  assert.match(checkpoint, /option\.rationale/);
  assert.match(checkpoint, /Why each choice works or fails/);
  assert.match(checkpoint, /Continue to the next call/);
  assert.match(checkpoint, /Continue to the hint/);
  assert.match(checkpoint, /event\.key === "Enter"/);
  assert.match(checkpoint, /<kbd>\{index \+ 1\}<\/kbd>/);
});

test("open response distinguishes source context, submit, and continue", () => {
  assert.match(openResponse, /open-response-context/);
  assert.match(openResponse, /sourcePacket\.sourceIds\.length/);
  assert.match(openResponse, /Submit this line/);
  assert.match(openResponse, /Back to the street/);
  assert.doesNotMatch(openResponse, /Formative—not a grade/);
  assert.doesNotMatch(openResponse, /Return to the exact prior objective/);
});
