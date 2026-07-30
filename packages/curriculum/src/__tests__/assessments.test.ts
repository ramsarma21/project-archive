// The chapter capstone id, pinned to the one the authored content already uses.
//
// This suite exists because `BOSTON_CAPSTONE` in packages/abilities/src/missions.ts
// named the chapter assessment `BOSTON.CAPSTONE` while every authored file under
// content/capstone/boston-1765/ — the blueprint, the answer key, both item files,
// the released-item map and the labelled eval set — says `BOS.CAPSTONE.v1`.
//
// The two halves are now joined on `BOS.CAPSTONE.v1`: @pa/abilities was reconciled to
// it and `assessmentId()` in apps/api/src/progression/content.ts answers it too, so a
// stored `chapter_assessment_attempts.assessment_id` is found by every half. This
// suite stays because the divergence it catches is silent until a row exists, and
// pinning all three literals is the only way a future edit that reintroduces it fails
// here rather than in production.
//
// The literals below are duplicated from content/ and @pa/abilities deliberately.
// The content directory is not importable from a package — the API container ships
// apps/api and packages and no content directory at all — and @pa/abilities does
// not depend on this package. Writing the other side's constant down is the only
// way the divergence is catchable.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSESSMENT_BOSTON_CAPSTONE,
  CURRICULUM_ASSESSMENT_IDS,
  UnknownAssessmentError,
  asCurriculumAssessmentId,
  isCurriculumAssessmentId,
  resolveAssessmentId,
} from "../assessments.js";

/** `scope.assessmentId` in content/capstone/boston-1765/blueprint.json. */
const CONTENT_BLUEPRINT_ASSESSMENT_ID = "BOS.CAPSTONE.v1";

/**
 * The root of the content id namespace the capstone's files hang off:
 * `BOS.CAPSTONE.CONTENT.PLAN.v1`, `BOS.CAPSTONE.CONTENT.KEY.v1`,
 * `BOS.CAPSTONE.GRADING_POLICY.v1`, `BOS.CAPSTONE.EVAL.OPEN_RESPONSE.v1` and the
 * authored item ids. This is the reason `BOS.CAPSTONE.v1` wins: it is not one
 * constant, it is the stem of everything already written.
 */
const CONTENT_ID_STEM = "BOS.CAPSTONE";

/** `BOSTON_CAPSTONE_ASSESSMENT_ID` in packages/abilities/src/chapters.ts. */
const ABILITIES_CAPSTONE_ASSESSMENT_ID = "BOS.CAPSTONE.v1";

test("the registry's capstone id is the one the authored content carries", () => {
  assert.equal(ASSESSMENT_BOSTON_CAPSTONE, CONTENT_BLUEPRINT_ASSESSMENT_ID);
  assert.equal(ASSESSMENT_BOSTON_CAPSTONE, ABILITIES_CAPSTONE_ASSESSMENT_ID);
  assert.ok(ASSESSMENT_BOSTON_CAPSTONE.startsWith(`${CONTENT_ID_STEM}.`));
});

test("an unknown assessment is refused rather than scoped to nothing", () => {
  assert.equal(resolveAssessmentId("ASSESS.DOES_NOT_EXIST"), null);
  assert.equal(isCurriculumAssessmentId("ASSESS.DOES_NOT_EXIST"), false);
  assert.throws(
    () => asCurriculumAssessmentId("ASSESS.DOES_NOT_EXIST"),
    UnknownAssessmentError,
  );
  try {
    asCurriculumAssessmentId("BOS.CAPSTONE");
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(error instanceof UnknownAssessmentError);
    assert.equal(error.input, "BOS.CAPSTONE");
    assert.deepEqual([...error.known], [...CURRICULUM_ASSESSMENT_IDS]);
    assert.match(error.message, /BOS\.CAPSTONE\.v1/);
  }
});

test("the superseded spelling canonicalises rather than resolving to itself", () => {
  assert.equal(resolveAssessmentId("BOSTON.CAPSTONE"), ASSESSMENT_BOSTON_CAPSTONE);
  assert.equal(asCurriculumAssessmentId("BOSTON.CAPSTONE"), ASSESSMENT_BOSTON_CAPSTONE);
  // Not a second name for the capstone: no attempt row carries it.
  assert.equal(isCurriculumAssessmentId("BOSTON.CAPSTONE"), false);
});

test("a near miss is not the capstone, so no attempt is scoped by luck", () => {
  for (const wrong of [
    "BOS.CAPSTONE",
    "BOS.CAPSTONE.v2",
    "bos.capstone.v1",
    "BOSTON.CAPSTONE.v1",
    "BOS.CAPSTONE.CONTENT.PLAN.v1",
  ]) {
    assert.equal(resolveAssessmentId(wrong), null, wrong);
  }
});
