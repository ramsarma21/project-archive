// The chapter key, pinned to the one the rest of the system already uses.
//
// This suite exists because of a specific failure, not for symmetry. The registry
// keyed Boston `BOSTON` while the API, the client and every row in
// `chapter_assessment_attempts`, `concept_mastery` and `chapter_ability_unlocks`
// keyed it `boston-1765`. Both strings are well-formed, so no guard rejected
// either: a chapter-keyed lookup with the runtime id filtered the registry down
// to nothing and returned an empty list, and an empty concept list on the
// educator surface reads as a class that owes nothing rather than as a report
// that could not be drawn.
//
// The literals below are duplicated from apps/api and apps/web deliberately.
// Neither can be imported — @pa/curriculum sits beneath both — so a divergence is
// only catchable by writing the other side's constant down and asserting on it.
// Failing here is the point: the alternative is discovering it in a roster.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHAPTER_BOSTON,
  CURRICULUM_CHAPTER_IDS,
  UnknownChapterError,
  asCurriculumChapterId,
  isCurriculumChapterId,
  resolveChapterId,
} from "../chapters.js";
import { ALL_CONCEPTS } from "../conceptRegistry.js";
import { ALL_STUDENT_EXPECTATIONS } from "../seRegistry.js";

/** `BOSTON_RUNTIME_CHAPTER_ID` in apps/api/src/progression/content.ts. */
const API_RUNTIME_CHAPTER_ID = "boston-1765";

/** `BOSTON_CHAPTER_ID` in apps/web/src/chapter/bostonChapter.ts. */
const WEB_CHAPTER_ID = "boston-1765";

test("the registry's chapter key is the one the API and the client send", () => {
  assert.equal(CHAPTER_BOSTON, API_RUNTIME_CHAPTER_ID);
  assert.equal(CHAPTER_BOSTON, WEB_CHAPTER_ID);
});

test("every concept and standard is owned by a chapter the registry knows", () => {
  for (const concept of ALL_CONCEPTS) {
    assert.ok(
      isCurriculumChapterId(concept.owner.chapterId),
      `${concept.conceptId} is owned by an unknown chapter: ${concept.owner.chapterId}`,
    );
  }
  for (const se of ALL_STUDENT_EXPECTATIONS) {
    assert.ok(
      isCurriculumChapterId(se.primaryChapter),
      `${se.code} is carried by an unknown chapter: ${se.primaryChapter}`,
    );
  }
});

test("an unknown chapter is refused, never answered with an empty list", () => {
  assert.equal(resolveChapterId("CHAPTER.DOES_NOT_EXIST"), null);
  assert.equal(isCurriculumChapterId("CHAPTER.DOES_NOT_EXIST"), false);
  assert.throws(() => asCurriculumChapterId("CHAPTER.DOES_NOT_EXIST"), UnknownChapterError);
  // The error names what it does hold, because the bug this replaces was two
  // plausible spellings and no way to see which one was in hand.
  try {
    asCurriculumChapterId("boston1765");
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(error instanceof UnknownChapterError);
    assert.equal(error.input, "boston1765");
    assert.deepEqual([...error.known], [...CURRICULUM_CHAPTER_IDS]);
    assert.match(error.message, /boston-1765/);
  }
});

test("the superseded authoring key canonicalises rather than resolving to itself", () => {
  assert.equal(resolveChapterId("BOSTON"), CHAPTER_BOSTON);
  assert.equal(asCurriculumChapterId("BOSTON"), CHAPTER_BOSTON);
  // A superseded spelling is not a chapter anybody is in: no database row carries
  // it, so a request naming one is asking for a chapter that does not exist.
  assert.equal(isCurriculumChapterId("BOSTON"), false);
});

test("case is not a chapter key, so no lookup succeeds by luck", () => {
  for (const wrong of ["Boston-1765", "BOSTON-1765", "boston_1765", "boston"]) {
    assert.equal(resolveChapterId(wrong), null, wrong);
  }
});
