// M1's nail stance, proved against the geometry the level actually ships.

import assert from "node:assert/strict";
import test from "node:test";
import { FIELD_TICK_HZ } from "../engine.js";
import { beatSpecDefects, beatWorstCaseTicks, inFacingArc } from "../spec.js";
import { beatObjective, inBeatStance, isTerminalPrecisionFailure, BEAT_MOUNT_CONTRACT } from "../mount.js";
import {
  M1_BEAT_WORST_CASE_TICKS,
  M1_NAIL_STANCE,
  M1_NAIL_TARGET,
  M1_POST_OBJECTIVE_ID,
  m1NailStanceBeat,
} from "../m1NailStance.js";
import { reactionWorstCaseSpan } from "../schedule.js";
import { playBeat } from "./harness.js";

const SPEC = m1NailStanceBeat();

test("the shipped M1 beat has no defects", () => {
  assert.deepEqual(beatSpecDefects(SPEC), []);
});

test("the stance and target match the level's authored PRECISION block", () => {
  assert.deepEqual(M1_NAIL_STANCE, { x: 79.6, y: 8.3, z: 0.4 });
  assert.deepEqual(M1_NAIL_TARGET, { x: 80.15, y: 9.45, z: 0.55 });
  assert.ok(
    Math.abs(SPEC.facingYaw - Math.atan2(0.55, 0.15)) < 1e-9,
    `the derived facing ${SPEC.facingYaw} is not the authored ${Math.atan2(0.55, 0.15)}`,
  );
});

test("the beat costs the clock a fixed, affordable number of seconds", () => {
  // The pacing claim: the reaction act is reserved at its widest span plus the
  // follow-through, and it is a whole-second handful, not a chapter. It is a
  // fixed reservation because the worst case does not depend on the seed.
  const worstSeconds = M1_BEAT_WORST_CASE_TICKS / FIELD_TICK_HZ;
  assert.equal(M1_BEAT_WORST_CASE_TICKS, beatWorstCaseTicks(SPEC));
  assert.equal(
    M1_BEAT_WORST_CASE_TICKS,
    reactionWorstCaseSpan(SPEC.reaction) + SPEC.verb.settleTicks,
  );
  assert.ok(
    worstSeconds > 6 && worstSeconds < 15,
    `the beat reserves ${worstSeconds.toFixed(2)}s, which is not a handful of seconds`,
  );
});

test("the act is short and doable — a small handful of flares, each with a wide window", () => {
  assert.ok(SPEC.reaction.targetCount >= 4 && SPEC.reaction.targetCount <= 8);
  assert.ok(SPEC.reaction.cellCount >= 4);
  assert.ok(
    SPEC.reaction.windowTicks / FIELD_TICK_HZ >= 1,
    "a flare is up for at least a second",
  );
});

test("the stance test accepts the bough and rejects the ground under it", () => {
  const facing = SPEC.facingYaw;
  assert.equal(inBeatStance(SPEC, { pos: M1_NAIL_STANCE, yaw: facing }), true);
  assert.equal(
    inBeatStance(SPEC, {
      pos: { ...M1_NAIL_STANCE, x: M1_NAIL_STANCE.x - 0.5 },
      yaw: facing,
    }),
    true,
  );
  assert.equal(
    inBeatStance(SPEC, { pos: { ...M1_NAIL_STANCE, y: 0 }, yaw: facing }),
    false,
  );
  assert.equal(
    inBeatStance(SPEC, {
      pos: { ...M1_NAIL_STANCE, x: M1_NAIL_STANCE.x - 3 },
      yaw: facing,
    }),
    false,
  );
});

test("the facing arc is generous but not a full circle", () => {
  const facing = SPEC.facingYaw;
  assert.equal(inFacingArc(SPEC, facing), true);
  assert.equal(inFacingArc(SPEC, facing + 0.5), true);
  assert.equal(inFacingArc(SPEC, facing + Math.PI), false, "the player's back is turned");
  assert.equal(inFacingArc(SPEC, facing + Math.PI * 2), true);
});

test("the objective is met by doing the work, not by arriving at it", () => {
  let posted = false;
  const objective = beatObjective({
    id: M1_POST_OBJECTIVE_ID,
    label: "Nail the handbill to the Liberty Tree",
    spec: SPEC,
    posted: () => posted,
  });
  const atTheTree = { pos: M1_NAIL_STANCE, yaw: SPEC.facingYaw };
  assert.equal(objective.satisfiedBy(atTheTree), false, "arriving completed the objective");
  posted = true;
  assert.equal(objective.satisfiedBy(atTheTree), true);
  assert.equal(
    objective.satisfiedBy({ pos: { x: 0, y: 0, z: 0 }, yaw: SPEC.facingYaw }),
    false,
  );
  assert.equal(objective.id, M1_POST_OBJECTIVE_ID);
  assert.equal(objective.required, true);
});

test("a torn sheet is a terminal failure and an abandoned run is not", () => {
  const missAll = Array.from({ length: SPEC.reaction.targetCount }, (_, index) => index);
  const torn = playBeat(SPEC, 5, { dropped: missAll });
  assert.equal(torn.outcome.grade, "TORN");
  assert.equal(isTerminalPrecisionFailure(torn.outcome), true);

  const walkedAway = playBeat(SPEC, 5, { leaveAt: SPEC.reaction.leadTicks + 5 });
  assert.equal(walkedAway.outcome.abandoned, true);
  assert.equal(
    isTerminalPrecisionFailure(walkedAway.outcome),
    false,
    "stepping off the bough spent the attempt",
  );
});

test("the mount contract names every file that has to change", () => {
  assert.ok(BEAT_MOUNT_CONTRACT.length > 0);
  for (const line of BEAT_MOUNT_CONTRACT) {
    assert.ok(line.includes(":"), `contract line has no owner: ${line}`);
  }
  const owners = new Set(BEAT_MOUNT_CONTRACT.map((line) => line.split(":")[0]!.trim()));
  for (const owner of ["the mission runtime", "the level", "the stage", "playerInput"]) {
    assert.ok(owners.has(owner), `the contract says nothing about ${owner}`);
  }
});
