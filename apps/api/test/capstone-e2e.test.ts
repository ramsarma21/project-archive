import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSESSMENT_ITEMS_PER_CONCEPT, LEARNING_MODULE_SECONDS } from "@pa/contracts";
import { ProgressionService } from "../src/progression/service.js";
import type { OpenResponseGrade } from "../src/progression/content.js";
import {
  BOSTON_RUNTIME_CHAPTER_ID,
  M1_MISSION_ID,
  M1_MODULE_ID,
  bostonProgressionContent,
} from "../src/progression/content.js";
import { MemoryStore } from "./support/memoryProgressionStore.js";

// The Boston chapter capstone (BOS.CAPSTONE.v1), driven end to end against the REAL
// content pack the server boots with — bostonProgressionContent(), not a mock. This
// is the proof the wiring asked for: a green unit suite next to a capstone that opens
// an attempt and serves zero items would still be "green", so the bar is behaviour.
// It opens a real attempt, checks it serves the authored count and formats for all
// three concepts, answers every item, submits, and confirms concept mastery is
// written, the attempt scores, and the concepts' Codex cards become PvP-legal.
//
// The store is the in-memory double that models Postgres field for field (the same
// one progression.test.ts drives the service against). The open-response GRADER is
// stubbed to return CORRECT, because it is an external service and not what this test
// is proving; a separate Postgres run (reported to the owner) confirms the same flow
// writes the real concept_mastery rows. The selected-response half is graded by the
// server's own key with no stub. The authenticity of that key — that it matches the
// authored answer-key.json and TEA's released keys — is pinned separately by
// capstone-content-parity.test.ts; this test proves the mechanics around it.

const PROFILE = "44444444-4444-4444-8444-444444444444";
const CONTENT = bostonProgressionContent();
const ASSESSMENT = CONTENT.assessmentId(BOSTON_RUNTIME_CHAPTER_ID);
const CONCEPTS = CONTENT.chapterConceptIds(BOSTON_RUNTIME_CHAPTER_ID);
// Authored options use A-D; released TEA items use F-J. The correct one is whichever
// the server's own key accepts — found here rather than hard-coded, so the test does
// not restate the key it is exercising.
const SR_OPTION_IDS = ["A", "B", "C", "D", "F", "G", "H", "J"] as const;

const OPEN_VERDICTS = new Map<string, OpenResponseGrade>();

function harness() {
  const store = new MemoryStore();
  let ids = 0;
  let clock = Date.parse("2026-07-30T00:00:00.000Z");
  OPEN_VERDICTS.clear();
  const service = new ProgressionService(
    store,
    CONTENT,
    () => new Date((clock += 1000)),
    () => {
      ids += 1;
      return `10000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
    },
    { verdict: async ({ responseRef }) => structuredClone(OPEN_VERDICTS.get(responseRef)) ?? null },
  );
  return { store, service };
}

/** Run the M1 lesson module so its nine Codex cards are learned and mintable. */
async function learnM1(service: ProgressionService): Promise<void> {
  const result = await service.completeLearningModule(PROFILE, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    moduleId: M1_MODULE_ID,
    gatesKind: "MISSION_ATTEMPT",
    gatesId: M1_MISSION_ID,
    acknowledgedCueIds: [...(CONTENT.moduleDeckCueIds(M1_MODULE_ID) ?? [])],
    acknowledgedCheckIds: [...CONTENT.moduleRequiredCheckIds(M1_MODULE_ID)],
    observedSeconds: LEARNING_MODULE_SECONDS,
  });
  assert.equal(result.ok, true, `module did not complete: ${JSON.stringify(result)}`);
}

/** Answer one served item correctly. SR by the server's own key; OR via the stub grader. */
async function answerCorrectly(
  service: ProgressionService,
  attemptId: string,
  itemId: string,
): Promise<void> {
  const format = CONTENT.itemFormat(itemId);
  if (format === "OPEN_RESPONSE") {
    const responseRef = `resp-${itemId}`;
    OPEN_VERDICTS.set(responseRef, { correct: true, needsReview: false });
    const result = await service.answerAssessmentItem(PROFILE, {
      attemptId,
      itemId,
      itemFormat: "OPEN_RESPONSE",
      responseRef,
    });
    assert.equal(result.ok, true, `open answer failed for ${itemId}: ${JSON.stringify(result)}`);
    return;
  }
  const correct = SR_OPTION_IDS.find((optionId) => CONTENT.isCorrectOption(itemId, optionId));
  assert.ok(correct, `${itemId} has no correct option in the server key`);
  const result = await service.answerAssessmentItem(PROFILE, {
    attemptId,
    itemId,
    itemFormat: "SELECTED_RESPONSE",
    selectedOptionId: correct,
  });
  assert.equal(result.ok, true, `selected answer failed for ${itemId}: ${JSON.stringify(result)}`);
}

test("the real content pack wires the capstone: it is no longer PACKAGE_MISSING", () => {
  assert.equal(ASSESSMENT, "BOS.CAPSTONE.v1");
  assert.deepEqual(
    [...CONCEPTS].sort(),
    [
      "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
      "BOS.CONCEPT.MERCANTILISM.v1",
      "BOS.CONCEPT.REPRESENTATION.v1",
    ],
  );
  assert.equal(CONTENT.assessmentModuleId(BOSTON_RUNTIME_CHAPTER_ID), M1_MODULE_ID);
  // Six items a concept, so three attempts each draw a fresh two-item form.
  for (const conceptId of CONCEPTS) {
    assert.equal(CONTENT.itemReserve(ASSESSMENT!, conceptId).length, 6, conceptId);
  }
});

test("a first attempt serves the three concepts, two items a form, one of each format", async () => {
  const { service } = harness();
  await learnM1(service);
  const opened = await service.openChapterAssessment(PROFILE, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    assessmentId: ASSESSMENT!,
  });
  assert.equal(opened.ok, true, `capstone did not open: ${JSON.stringify(opened)}`);
  if (!opened.ok) return;
  const attempt = opened.value;
  assert.equal(attempt.attemptOrdinal, 1);
  assert.equal(attempt.isReportedMeasure, true);
  // All three chapter concepts, in the authored order.
  assert.deepEqual(
    attempt.form.map((entry) => entry.conceptId),
    [...CONCEPTS],
  );
  for (const entry of attempt.form) {
    assert.equal(entry.itemIds.length, ASSESSMENT_ITEMS_PER_CONCEPT, `${entry.conceptId} count`);
    for (const itemId of entry.itemIds) {
      assert.equal(CONTENT.itemConcept(itemId), entry.conceptId, `${itemId} owner`);
    }
    // The parallel-forms shape: one recognition (SR) item and one reasoning (OR) item.
    const formats = entry.itemIds.map((itemId) => CONTENT.itemFormat(itemId)).sort();
    assert.deepEqual(formats, ["OPEN_RESPONSE", "SELECTED_RESPONSE"], `${entry.conceptId} formats`);
  }
});

test("answering every served item correctly masters all three concepts, scores, and mints nine cards", async () => {
  const { service, store } = harness();
  await learnM1(service);
  const opened = await service.openChapterAssessment(PROFILE, {
    chapterId: BOSTON_RUNTIME_CHAPTER_ID,
    assessmentId: ASSESSMENT!,
  });
  assert.ok(opened.ok);
  if (!opened.ok) return;
  const attempt = opened.value;
  const servedItemIds = attempt.form.flatMap((entry) => entry.itemIds);
  assert.equal(servedItemIds.length, CONCEPTS.length * ASSESSMENT_ITEMS_PER_CONCEPT, "six items served");

  for (const itemId of servedItemIds) {
    await answerCorrectly(service, attempt.attemptId, itemId);
  }

  const submitted = await service.submitChapterAssessment(PROFILE, attempt.attemptId);
  assert.equal(submitted.ok, true, `submit failed: ${JSON.stringify(submitted)}`);
  if (!submitted.ok) return;
  // The attempt scores, and every served item was correct.
  assert.equal(submitted.value.passed, true, "every concept at 100% passes the chapter");
  assert.equal(submitted.value.scoreNumerator, 6);
  assert.equal(submitted.value.scoreDenominator, 6);
  // All three concepts mastered.
  assert.deepEqual([...submitted.value.masteredConceptIds].sort(), [...CONCEPTS].sort());
  // Nine Codex cards (three a concept) become PvP-legal — the reward the capstone gates.
  assert.equal(submitted.value.newlyPvpLegalCardIds.length, 9, "three cards a concept");

  // concept_mastery is ACTUALLY WRITTEN: a mastered row per concept, in the store that
  // models the Postgres table. Read back rather than inferred from the return value.
  for (const conceptId of CONCEPTS) {
    const row = store.mastery.get(`${PROFILE}:${BOSTON_RUNTIME_CHAPTER_ID}:${conceptId}`);
    assert.ok(row?.masteredAt, `${conceptId} has no written mastery row`);
    assert.equal(row.itemsCorrect, ASSESSMENT_ITEMS_PER_CONCEPT, `${conceptId} itemsCorrect`);
    assert.equal(row.firstAttemptCorrect, ASSESSMENT_ITEMS_PER_CONCEPT, `${conceptId} first-attempt measure`);
  }
  // The chapter records the pass (what gates a next chapter, when one exists).
  assert.ok(
    store.chapters.get(`${PROFILE}:${BOSTON_RUNTIME_CHAPTER_ID}`)?.assessmentPassedAt,
    "the chapter did not record the capstone pass",
  );
});
