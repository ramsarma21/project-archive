// The chapter key and the capstone id, pinned to the ones the rest of the system
// already uses.
//
// This suite exists because of two specific divergences, not for symmetry.
//
// The chapter key: this package spelled Boston `BOSTON` while @pa/curriculum, the
// API, the client and every row in `chapter_ability_unlocks`, `concept_mastery`
// and `chapter_assessment_attempts` spelled it `boston-1765`. It cost nothing
// only because the API re-keys each milestone on the way through and
// `resolveChapterLoadout` had no production caller. Both strings are well-formed,
// so no guard rejected either: the first caller to pass the runtime id would have
// been handed an empty ability pool, which is a legal answer for a Level 0 player
// and therefore not one anything downstream could question.
//
// The capstone id: `BOSTON_CAPSTONE` named the chapter assessment
// `BOSTON.CAPSTONE` while the authored blueprint, its answer key, its item files,
// its released-item map and its labelled eval set all say `BOS.CAPSTONE.v1`.
// Nothing joined the two halves yet, because `assessmentId()` in
// apps/api/src/progression/content.ts still answers null — so the divergence had
// no symptom and no expiry date either.
//
// The literals below are duplicated from @pa/curriculum, apps/api, apps/web and
// content/ deliberately. This package must not import @pa/curriculum — @pa/pvp
// depends on this package, and the XP curve has no business knowing about student
// expectations — so a divergence is only catchable by writing the other side's
// constant down and asserting on it. Failing here is the point: the alternative
// is a player deploying with no abilities.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ABILITY_CHAPTER_IDS,
  BOSTON_CAPSTONE_ASSESSMENT_ID,
  BOSTON_CHAPTER_ID,
  UnknownAbilityChapterError,
  asAbilityChapterId,
  isAbilityChapterId,
  resolveAbilityChapterId,
} from "../chapters.js";
import { BOSTON_ABILITY_MILESTONES, resolveChapterLoadout } from "../loadout.js";
import { BOSTON_CAPSTONE, BOSTON_MISSION_XP } from "../missions.js";

/** `CHAPTER_BOSTON` in packages/curriculum/src/chapters.ts. */
const CURRICULUM_CHAPTER_ID = "boston-1765";

/** `BOSTON_RUNTIME_CHAPTER_ID` in apps/api/src/progression/content.ts. */
const API_RUNTIME_CHAPTER_ID = "boston-1765";

/** `BOSTON_CHAPTER_ID` in apps/web/src/chapter/bostonChapter.ts. */
const WEB_CHAPTER_ID = "boston-1765";

/** `scope.assessmentId` in content/capstone/boston-1765/blueprint.json. */
const CONTENT_CAPSTONE_ASSESSMENT_ID = "BOS.CAPSTONE.v1";

/** `ASSESSMENT_BOSTON_CAPSTONE` in packages/curriculum/src/assessments.ts. */
const CURRICULUM_CAPSTONE_ASSESSMENT_ID = "BOS.CAPSTONE.v1";

test("this package's chapter key is the one the registry, the API and the client use", () => {
  assert.equal(BOSTON_CHAPTER_ID, CURRICULUM_CHAPTER_ID);
  assert.equal(BOSTON_CHAPTER_ID, API_RUNTIME_CHAPTER_ID);
  assert.equal(BOSTON_CHAPTER_ID, WEB_CHAPTER_ID);
});

test("every authored row is keyed by that same chapter id", () => {
  // The API re-keys milestones onto the runtime id before persisting them. That
  // projection is now an identity, and these assertions are what keep it one:
  // if this package drifts again, the re-key silently starts translating.
  for (const milestone of BOSTON_ABILITY_MILESTONES) {
    assert.ok(
      isAbilityChapterId(milestone.chapterId),
      `${milestone.abilityId} is scheduled in an unknown chapter: ${milestone.chapterId}`,
    );
  }
  for (const row of BOSTON_MISSION_XP) {
    assert.ok(
      isAbilityChapterId(row.chapterId),
      `${row.missionId} pays into an unknown chapter: ${row.chapterId}`,
    );
  }
  assert.ok(isAbilityChapterId(BOSTON_CAPSTONE.chapterId));
});

test("the capstone id is the one the authored content and the registry use", () => {
  assert.equal(BOSTON_CAPSTONE_ASSESSMENT_ID, CONTENT_CAPSTONE_ASSESSMENT_ID);
  assert.equal(BOSTON_CAPSTONE_ASSESSMENT_ID, CURRICULUM_CAPSTONE_ASSESSMENT_ID);
  assert.equal(BOSTON_CAPSTONE.assessmentId, CONTENT_CAPSTONE_ASSESSMENT_ID);
  // The old spelling is not a second name for it.
  assert.notEqual(BOSTON_CAPSTONE.assessmentId, "BOSTON.CAPSTONE");
});

test("an unknown chapter is refused, never answered with an empty pool", () => {
  assert.equal(resolveAbilityChapterId("CHAPTER.DOES_NOT_EXIST"), null);
  assert.equal(isAbilityChapterId("CHAPTER.DOES_NOT_EXIST"), false);
  assert.throws(
    () => asAbilityChapterId("CHAPTER.DOES_NOT_EXIST"),
    UnknownAbilityChapterError,
  );
  // The error names what it does hold, because the bug this replaces was two
  // plausible spellings and no way to see which one was in hand.
  try {
    asAbilityChapterId("boston1765");
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(error instanceof UnknownAbilityChapterError);
    assert.equal(error.input, "boston1765");
    assert.deepEqual([...error.known], [...ABILITY_CHAPTER_IDS]);
    assert.match(error.message, /boston-1765/);
  }
});

test("the superseded authoring key canonicalises rather than resolving to itself", () => {
  assert.equal(resolveAbilityChapterId("BOSTON"), BOSTON_CHAPTER_ID);
  assert.equal(asAbilityChapterId("BOSTON"), BOSTON_CHAPTER_ID);
  // A superseded spelling is not a chapter anybody is in: no database row carries
  // it, so a request naming one is asking for a chapter that does not exist.
  assert.equal(isAbilityChapterId("BOSTON"), false);
  // It still reaches the abilities it used to, so reconciling the key was not a
  // flag day for any caller still spelling it the old way.
  assert.deepEqual(
    resolveChapterLoadout({ chapterId: "BOSTON", level: 34 }).carried,
    resolveChapterLoadout({ chapterId: BOSTON_CHAPTER_ID, level: 34 }).carried,
  );
});

test("case is not a chapter key, so no loadout resolves by luck", () => {
  for (const wrong of ["Boston-1765", "BOSTON-1765", "boston_1765", "boston"]) {
    assert.equal(resolveAbilityChapterId(wrong), null, wrong);
  }
});
