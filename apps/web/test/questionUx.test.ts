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

test("open response typesets a claim, evidence, and original line", () => {
  assert.match(openResponse, /open-response-context/);
  assert.match(openResponse, /sourcePacket\.sourceIds\.length/);
  assert.match(openResponse, /Set a claim/);
  assert.match(openResponse, /Set the evidence/);
  assert.match(openResponse, /Add your line/);
  assert.match(openResponse, /Print mini-broadside/);
  assert.match(openResponse, /Back to the street/);
  assert.doesNotMatch(openResponse, /minLength=/);
  assert.doesNotMatch(openResponse, /more required|character counter|word minimum/i);
  assert.doesNotMatch(openResponse, /Formative—not a grade/);
  assert.doesNotMatch(openResponse, /Return to the exact prior objective/);
});
