import { test } from "node:test";
import assert from "node:assert/strict";
import { ProgressionSnapshotSchema, type ProgressionSnapshot } from "@pa/contracts";
import { BOSTON_SLATE, missionUnlocked } from "../src/chapter/bostonChapter.js";
import {
  CAPSTONE_NODE_ID,
  DEFAULT_HUB_SLATE,
  MISSION_NODES,
  missionNodesFor,
  nodeById,
} from "../src/pages/hub/hubState.js";
import { projectProgression } from "../src/progression/projection.js";

// ===========================================================================
// The map, drawn from durable progression.
//
// The chapter route is walked from the missions the SERVER says are resolved.
// That is what makes "what's done is done" visible as well as enforced: a
// mission with three burned attempts reads SPENT, the route still advances past
// it, and neither fact came from anything this browser was told to remember.
// ===========================================================================

const PROFILE = "11111111-1111-4111-8111-111111111111";
const CHAPTER = "boston-1765";
const AT = "2026-07-25T12:00:00.000Z";

function snapshotWith(
  missions: {
    missionId: string;
    attemptsUsed: number;
    outcome: "IN_PROGRESS" | "CLEARED" | "FAILED_PERMANENT";
  }[],
  assessmentPassedAt: string | null = null,
): ProgressionSnapshot {
  return ProgressionSnapshotSchema.parse({
    campaign: {
      profileId: PROFILE,
      modelVersion: 1,
      rank: 1,
      cumulativeLevels: 4,
      activeChapterId: CHAPTER,
      revision: 1,
      createdAt: AT,
      updatedAt: AT,
    },
    activeChapter: {
      profileId: PROFILE,
      chapterId: CHAPTER,
      level: 4,
      xp: 300,
      levelsAtChapterStart: 0,
      status: "ACTIVE",
      assessmentPassedAt,
      startedAt: AT,
      completedAt: null,
      updatedAt: AT,
    },
    derived: {
      rank: 1,
      cumulativeLevels: 4,
      levelsToNextRank: 6,
      level: 4,
      xp: 300,
      xpToNextLevel: 52,
    },
    missions: missions.map((mission) => ({
      profileId: PROFILE,
      chapterId: CHAPTER,
      missionId: mission.missionId,
      attemptsUsed: mission.attemptsUsed,
      outcome: mission.outcome,
      awardedXp: 0,
      clearedOnAttempt: null,
      clearedAt: null,
      failedAt: null,
      updatedAt: AT,
    })),
    openAttempt: null,
    codex: [],
    chapterAbilities: [],
    pvpAbilities: [],
    conceptMastery: [],
  });
}

const route = (input: {
  missionId: string;
  resolvedMissionIds: ReadonlySet<string>;
}) => missionUnlocked(input);

test("the hub's node ids are the chapter's real mission ids", () => {
  // The failure this pins is total and silent: a node carrying a display slug
  // produces a Deploy button the mission registry has never heard of, so the
  // only built mission in the game refuses to launch.
  assert.deepEqual(
    DEFAULT_HUB_SLATE.map((entry) => entry.missionId),
    BOSTON_SLATE.map((entry) => entry.missionId),
  );
  assert.deepEqual(
    DEFAULT_HUB_SLATE.map((entry) => entry.ordinal),
    BOSTON_SLATE.map((entry) => entry.ordinal),
  );
  assert.equal(
    DEFAULT_HUB_SLATE.filter((entry) => entry.built).length,
    BOSTON_SLATE.filter((entry) => entry.built).length,
  );
});

test("a fresh runner sees the first operation open and nothing else", () => {
  assert.equal(MISSION_NODES.length, BOSTON_SLATE.length + 1);
  assert.equal(MISSION_NODES[0]?.status, "UNLOCKED");
  assert.ok(
    MISSION_NODES.slice(1).every((node) => node.status === "LOCKED"),
    "including the capstone",
  );
  assert.equal(MISSION_NODES.at(-1)?.id, CAPSTONE_NODE_ID);
});

test("a cleared operation reads COMPLETE and opens the next one", () => {
  const first = BOSTON_SLATE[0]!.missionId;
  const view = projectProgression(
    snapshotWith([{ missionId: first, attemptsUsed: 1, outcome: "CLEARED" }]),
  );
  const nodes = missionNodesFor({ slate: DEFAULT_HUB_SLATE, view, isRouteOpen: route });
  assert.equal(nodeById(nodes, first)?.status, "COMPLETE");
  // The second operation has no level built, so the route advances and the node
  // still refuses to launch. Locked is the honest reading of that.
  assert.equal(nodeById(nodes, BOSTON_SLATE[1]!.missionId)?.status, "LOCKED");
});

test("three burned attempts read SPENT, not COMPLETE, and still advance the route", () => {
  const first = BOSTON_SLATE[0]!.missionId;
  const view = projectProgression(
    snapshotWith([{ missionId: first, attemptsUsed: 3, outcome: "FAILED_PERMANENT" }]),
  );
  const nodes = missionNodesFor({ slate: DEFAULT_HUB_SLATE, view, isRouteOpen: route });
  assert.equal(nodeById(nodes, first)?.status, "SPENT");
  assert.ok(view.resolvedMissionIds.has(first), "the player goes on regardless");
});

test("the capstone opens only once every operation is resolved, and closes when passed", () => {
  const everyMission = BOSTON_SLATE.map((entry) => ({
    missionId: entry.missionId,
    attemptsUsed: 1,
    outcome: "CLEARED" as const,
  }));
  const open = missionNodesFor({
    slate: DEFAULT_HUB_SLATE,
    view: projectProgression(snapshotWith(everyMission)),
    isRouteOpen: route,
  });
  assert.equal(nodeById(open, CAPSTONE_NODE_ID)?.status, "UNLOCKED");

  const passed = missionNodesFor({
    slate: DEFAULT_HUB_SLATE,
    view: projectProgression(snapshotWith(everyMission, AT)),
    isRouteOpen: route,
  });
  assert.equal(nodeById(passed, CAPSTONE_NODE_ID)?.status, "COMPLETE");

  const partial = missionNodesFor({
    slate: DEFAULT_HUB_SLATE,
    view: projectProgression(snapshotWith(everyMission.slice(0, 13))),
    isRouteOpen: route,
  });
  assert.equal(nodeById(partial, CAPSTONE_NODE_ID)?.status, "LOCKED");
});
