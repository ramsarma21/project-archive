import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  BOSTON_RUNTIME_CHAPTER_ID,
  bostonProgressionContent,
} from "../src/progression/content.js";

// content.ts is the SERVER's transcribed copy of the capstone bank, the same way
// MODULE_DECKS is a transcription of module.json. A transcription drifts; a wrong
// answer-key letter or a mis-tagged format would silently under-assess a student and
// pass every behavioural test that submits its own answers. This pins the copy to the
// authored content under content/capstone/boston-1765/ and to TEA's own keys under
// content/staar — the single sources — so a drift fails this gate instead.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const CAPSTONE = resolve(REPO, "content/capstone/boston-1765");
const readCapstone = (name: string): any =>
  JSON.parse(readFileSync(resolve(CAPSTONE, name), "utf8"));

const CONTENT = bostonProgressionContent();

const blueprint = readCapstone("blueprint.json");
const ASSESSMENT: string = blueprint.scope.assessmentId;
const CONCEPTS: string[] = blueprint.scope.conceptsAuthored;

// Every authored + released item's concept and format, from the item files and the
// released-item map (the single sources selection reads).
const authoredConcept = new Map<string, string>();
const authoredFormat = new Map<string, string>();
for (const descriptor of [
  ...readCapstone("items/selected-response.json").entries.map((e: any) => e.descriptor),
  ...readCapstone("items/open-response.json").entries.map((e: any) => e.descriptor),
  ...readCapstone("released-item-map.json").served,
]) {
  authoredConcept.set(descriptor.itemId, descriptor.conceptId);
  authoredFormat.set(descriptor.itemId, descriptor.format);
}

// The selected-response key: six authored letters from answer-key.json, three released
// letters from TEA's own capture in content/staar (answer-key.json deliberately refuses
// to copy those, so they have one home).
const answerKey = new Map<string, string>();
const keyFile = readCapstone("answer-key.json");
for (const item of keyFile.authoredItems) answerKey.set(item.itemId, item.correctOptionId);
for (const released of keyFile.releasedItems.items) {
  const filePath = (released.keyAt as string).split("->")[0].trim();
  const staar = JSON.parse(readFileSync(resolve(REPO, filePath), "utf8"));
  const capture = staar.items.find((i: any) => i.itemId === released.itemId);
  assert.ok(capture, `released capture missing for ${released.itemId}`);
  answerKey.set(
    released.itemId,
    capture.correctOptionId ?? capture.provenance?.correctAnswerFromOfficialKey,
  );
}

const ALL_OPTION_IDS = ["A", "B", "C", "D", "F", "G", "H", "J"] as const;

test("the assessment id and the concept set match the blueprint", () => {
  assert.equal(CONTENT.assessmentId(BOSTON_RUNTIME_CHAPTER_ID), ASSESSMENT);
  assert.equal(ASSESSMENT, "BOS.CAPSTONE.v1");
  assert.deepEqual([...CONTENT.chapterConceptIds(BOSTON_RUNTIME_CHAPTER_ID)], CONCEPTS);
});

test("the reserve holds exactly the eighteen authored items, correctly concepted and formatted", () => {
  const reserve = CONCEPTS.flatMap((conceptId) => CONTENT.itemReserve(ASSESSMENT, conceptId));
  assert.equal(reserve.length, 18, "eighteen items across three concepts");
  assert.equal(new Set(reserve).size, 18, "no item served for two concepts");
  assert.deepEqual([...reserve].sort(), [...authoredConcept.keys()].sort(), "reserve == authored bank");
  for (const itemId of reserve) {
    assert.equal(CONTENT.itemConcept(itemId), authoredConcept.get(itemId), `${itemId} concept`);
    assert.equal(CONTENT.itemFormat(itemId), authoredFormat.get(itemId), `${itemId} format`);
  }
});

test("each concept's reserve is six items and interleaves recognition with reasoning", () => {
  for (const conceptId of CONCEPTS) {
    const reserve = CONTENT.itemReserve(ASSESSMENT, conceptId);
    assert.equal(reserve.length, 6, `${conceptId} reserve size`);
    const authoredForConcept = [...authoredConcept.entries()]
      .filter(([, c]) => c === conceptId)
      .map(([itemId]) => itemId);
    assert.deepEqual([...reserve].sort(), authoredForConcept.sort(), `${conceptId} reserve set`);
    // Interleaved so selectFreshItems (in order) hands every two-item form one of each.
    assert.deepEqual(
      reserve.map((itemId) => CONTENT.itemFormat(itemId)),
      ["SELECTED_RESPONSE", "OPEN_RESPONSE", "SELECTED_RESPONSE", "OPEN_RESPONSE", "SELECTED_RESPONSE", "OPEN_RESPONSE"],
      `${conceptId} interleave`,
    );
  }
});

test("the selected-response key matches answer-key.json and the released TEA keys, exactly", () => {
  assert.equal(answerKey.size, 9, "nine selected-response keys (six authored, three released)");
  for (const [itemId, key] of answerKey) {
    assert.equal(CONTENT.itemFormat(itemId), "SELECTED_RESPONSE", `${itemId} is selected-response`);
    assert.equal(CONTENT.isCorrectOption(itemId, key), true, `${itemId} accepts its authored key ${key}`);
    // And nothing else — the key is exactly the authored one, not a permissive always-true.
    for (const optionId of ALL_OPTION_IDS) {
      if (optionId === key) continue;
      assert.equal(CONTENT.isCorrectOption(itemId, optionId), false, `${itemId} wrongly accepts ${optionId}`);
    }
  }
  // No open-response item leaks a key.
  for (const itemId of authoredConcept.keys()) {
    if (CONTENT.itemFormat(itemId) === "OPEN_RESPONSE") {
      for (const optionId of ALL_OPTION_IDS) {
        assert.equal(CONTENT.isCorrectOption(itemId, optionId), false, `${itemId} is open-response, keys nothing`);
      }
    }
  }
});
