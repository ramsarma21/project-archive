// The mission keys, pinned to the ones the rest of the system already uses.
//
// This suite exists because of a specific failure, and because that failure has
// already been shipped once in this family. Content spelled a mission `m1` while
// the registry spelled it `PA.SEA01.CH02.BOSTON.MD01`; that instance was patched
// at the call site. The unpatched form was wider: this registry keyed its
// fourteen missions `M1`..`M14`, while `mission_progress.mission_id`,
// `mission_attempts.mission_id`, `BOSTON_SLATE` in the client and
// `bostonMissionId()` in the API all say `PA.SEA01.CH02.BOSTON.MD01`.
//
// Both spellings are well-formed, so no guard rejected either: `conceptsForMission`
// with the runtime id matched no concept's owner and returned an empty list. A
// mission that teaches nothing is a real state here — M3's assignment is
// deliberately unsettled — so "this mission has no concepts" could not be told
// apart from "nobody noticed the key was wrong".
//
// The literals below are duplicated from apps/api, apps/web and content/
// deliberately. None can be imported — @pa/curriculum sits beneath all three, and
// the API's helper is not even exported — so a divergence is only catchable by
// writing the other side's ids down and asserting on them. Failing here is the
// point: the alternative is a mission's concepts quietly going missing.

import assert from "node:assert/strict";
import { test } from "node:test";

import { ALL_CONCEPTS, conceptsForMission } from "../conceptRegistry.js";
import {
  CURRICULUM_MISSION_IDS,
  MISSION_M1,
  MISSION_M3,
  MISSION_M14,
  UnknownMissionError,
  asCurriculumMissionId,
  isCurriculumMissionId,
  resolveMissionId,
} from "../missionIds.js";
import { ALL_MISSIONS, M1_STABLE_MISSION_ID, getMission } from "../missions.js";

/**
 * `BOSTON_SLATE` in apps/web/src/chapter/bostonChapter.ts, in ordinal order.
 * Entry 1 is `M1_MISSION_ID` from apps/web/src/chapter/m1Mission.ts, which is the
 * same literal.
 */
const WEB_SLATE_MISSION_IDS = [
  "PA.SEA01.CH02.BOSTON.MD01",
  "PA.SEA01.CH02.BOSTON.MD02",
  "PA.SEA01.CH02.BOSTON.MD03",
  "PA.SEA01.CH02.BOSTON.MD04",
  "PA.SEA01.CH02.BOSTON.MD05",
  "PA.SEA01.CH02.BOSTON.MD06",
  "PA.SEA01.CH02.BOSTON.MD07",
  "PA.SEA01.CH02.BOSTON.MD08",
  "PA.SEA01.CH02.BOSTON.MD09",
  "PA.SEA01.CH02.BOSTON.MD10",
  "PA.SEA01.CH02.BOSTON.MD11",
  "PA.SEA01.CH02.BOSTON.MD12",
  "PA.SEA01.CH02.BOSTON.MD13",
  "PA.SEA01.CH02.BOSTON.MD14",
];

/**
 * `bostonMissionId()` in apps/api/src/progression/content.ts, which is what keys
 * `mission_progress` and `mission_attempts`. Restated rather than imported: it is
 * a module-private function in a package that depends on this one.
 */
const apiMissionId = (ordinal: number) =>
  `PA.SEA01.CH02.BOSTON.MD${String(ordinal).padStart(2, "0")}`;

/** `module.missionId` in content/m1/module.json — the payload the client parses. */
const CONTENT_M1_MISSION_ID = "PA.SEA01.CH02.BOSTON.MD01";

/**
 * `authoredFor.stableMissionId` in content/m1/module.json, also
 * `content/m1/duel-items.json` and `content/boston/act1/package.manifest.json`,
 * and what Mission-Slate.md section 3 calls the "stable mission ID". A content
 * revision of the mission day, not a second mission.
 */
const CONTENT_M1_STABLE_MISSION_ID = "PA.SEA01.CH02.BOSTON.MD01.v1";

test("the registry's mission keys are the ones the API and the client send", () => {
  assert.deepEqual([...CURRICULUM_MISSION_IDS], WEB_SLATE_MISSION_IDS);
  for (const [index, missionId] of CURRICULUM_MISSION_IDS.entries()) {
    assert.equal(missionId, apiMissionId(index + 1));
  }
  assert.equal(MISSION_M1, CONTENT_M1_MISSION_ID);
});

test("the slate is keyed by those ids, in ordinal order", () => {
  assert.deepEqual(
    ALL_MISSIONS.map((mission) => mission.missionId),
    WEB_SLATE_MISSION_IDS,
  );
  assert.deepEqual(
    ALL_MISSIONS.map((mission) => mission.ordinal),
    Array.from({ length: 14 }, (_, index) => index + 1),
  );
});

test("every concept is owned by a mission the registry knows", () => {
  for (const concept of ALL_CONCEPTS) {
    if (concept.owner.missionId === null) continue;
    assert.ok(
      isCurriculumMissionId(concept.owner.missionId),
      `${concept.conceptId} is owned by an unknown mission: ${concept.owner.missionId}`,
    );
  }
});

test("the runtime id reaches a mission's concepts, which is what used to be empty", () => {
  // The exact call that answered nothing: the id the client deploys against and
  // the database stores, asked of the registry that keyed missions `M1`.
  const byRuntimeId = conceptsForMission(CONTENT_M1_MISSION_ID);
  assert.equal(byRuntimeId.length, 3);
  assert.deepEqual(
    byRuntimeId.map((concept) => concept.conceptId),
    [
      "BOS.CONCEPT.POSTWAR_REVENUE.v1",
      "BOS.CONCEPT.STAMP_SCOPE.v1",
      "BOS.CONCEPT.REPRESENTATION.v1",
    ],
  );
  // And the slate label reaches the same three, rather than being a second
  // mission with its own concepts.
  assert.deepEqual(conceptsForMission("M1"), byRuntimeId);
  assert.deepEqual(conceptsForMission(CONTENT_M1_STABLE_MISSION_ID), byRuntimeId);
});

test("an unknown mission is refused, never answered with an empty list", () => {
  assert.equal(resolveMissionId("MISSION.DOES_NOT_EXIST"), null);
  assert.equal(isCurriculumMissionId("MISSION.DOES_NOT_EXIST"), false);
  assert.throws(() => asCurriculumMissionId("MISSION.DOES_NOT_EXIST"), UnknownMissionError);
  assert.throws(() => conceptsForMission("MISSION.DOES_NOT_EXIST"), UnknownMissionError);
  assert.throws(() => getMission("MISSION.DOES_NOT_EXIST"), UnknownMissionError);
  // A mission past the slate is refused too, so an off-by-one is not an empty
  // chapter.
  assert.throws(() => conceptsForMission("M15"), UnknownMissionError);
  assert.throws(() => conceptsForMission("PA.SEA01.CH02.BOSTON.MD15"), UnknownMissionError);

  // The error names what it does hold, because the bug this replaces was two
  // plausible spellings and no way to see which one was in hand.
  try {
    conceptsForMission("m1");
    assert.fail("expected a refusal");
  } catch (error) {
    assert.ok(error instanceof UnknownMissionError);
    assert.equal(error.input, "m1");
    assert.deepEqual([...error.known], [...CURRICULUM_MISSION_IDS]);
    assert.match(error.message, /PA\.SEA01\.CH02\.BOSTON\.MD01/);
  }
});

test("a mission that genuinely teaches nothing answers empty, and says so", () => {
  // The distinction the throw exists to preserve: M3's assignment is unsettled by
  // design, so an empty list here is the registry being honest rather than a
  // spelling nobody caught.
  assert.deepEqual(conceptsForMission(MISSION_M3), []);
  assert.equal(getMission(MISSION_M3).assignmentStatus, "OPEN");
});

test("the superseded spellings canonicalise rather than resolving to themselves", () => {
  for (const [index, missionId] of CURRICULUM_MISSION_IDS.entries()) {
    const label = `M${index + 1}`;
    assert.equal(resolveMissionId(label), missionId);
    assert.equal(asCurriculumMissionId(label), missionId);
    // A superseded spelling is not a mission anybody has played: no
    // `mission_attempts` row carries one.
    assert.equal(isCurriculumMissionId(label), false);
    assert.equal(resolveMissionId(`${missionId}.v1`), missionId);
    assert.equal(isCurriculumMissionId(`${missionId}.v1`), false);
  }
  assert.equal(getMission("M14").missionId, MISSION_M14);
});

test("M1_STABLE_MISSION_ID is the id the runtime uses, not the content revision", () => {
  // It was `PA.SEA01.CH02.BOSTON.MD01.v1`, which is the content stable id and
  // matches no stored row. Anything trusting it would have found nothing.
  assert.equal(M1_STABLE_MISSION_ID, MISSION_M1);
  assert.notEqual(M1_STABLE_MISSION_ID, CONTENT_M1_STABLE_MISSION_ID);
  assert.equal(resolveMissionId(CONTENT_M1_STABLE_MISSION_ID), MISSION_M1);
});

test("case and separators are not mission keys, so no lookup succeeds by luck", () => {
  for (const wrong of [
    "m1",
    "pa.sea01.ch02.boston.md01",
    "PA.SEA01.CH02.BOSTON.MD1",
    "PA-SEA01-CH02-BOSTON-MD01",
    "PA.SEA01.CH02.BOSTON.MD01.v2",
    "MD01",
  ]) {
    assert.equal(resolveMissionId(wrong), null, wrong);
  }
});
