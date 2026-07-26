import { test } from "node:test";
import assert from "node:assert/strict";
import { rankFromCumulativeLevels } from "@pa/contracts";
import {
  MISSION_EDGES,
  MISSION_NODES,
  NEW_RUNNER_STATE,
} from "../src/pages/hub/hubState.js";

// What the hub reads, not how Rank is derived: the arithmetic belongs to
// @pa/contracts and is covered by its own tests. These pin the state the hub
// starts from and the shape of the chapter it draws.

test("a new runner is Level 0, 0 XP, Rank 1", () => {
  assert.equal(NEW_RUNNER_STATE.level, 0);
  assert.equal(NEW_RUNNER_STATE.xp, 0);
  assert.equal(NEW_RUNNER_STATE.cumulativeLevels, 0);
  assert.equal(rankFromCumulativeLevels(NEW_RUNNER_STATE.cumulativeLevels), 1);
});

test("the chapter is fourteen operations closed by one capstone", () => {
  const missions = MISSION_NODES.filter((node) => node.kind === "MISSION");
  const capstones = MISSION_NODES.filter((node) => node.kind === "CAPSTONE");
  assert.equal(missions.length, 14);
  assert.equal(capstones.length, 1);
  assert.equal(MISSION_NODES.at(-1)?.kind, "CAPSTONE");
});

test("the map is one unbroken route with only the first operation open", () => {
  assert.equal(MISSION_EDGES.length, MISSION_NODES.length - 1);
  MISSION_EDGES.forEach((edge, index) => {
    assert.equal(edge.from, MISSION_NODES[index]?.id);
    assert.equal(edge.to, MISSION_NODES[index + 1]?.id);
  });
  assert.equal(MISSION_NODES[0]?.status, "UNLOCKED");
  assert.ok(
    MISSION_NODES.slice(1).every((node) => node.status === "LOCKED"),
    "a fresh runner has nothing else open",
  );
});
