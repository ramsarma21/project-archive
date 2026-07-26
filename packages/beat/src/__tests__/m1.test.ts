// M1's nail stance, proved against the geometry the level actually ships.

import assert from "node:assert/strict";
import test from "node:test";
import { FIELD_TICK_HZ } from "../engine.js";
import { beatSpecDefects, beatWorstCaseTicks, inFacingArc } from "../spec.js";
import { beatObjective, inBeatStance, isTerminalPrecisionFailure, BEAT_MOUNT_CONTRACT } from "../mount.js";
import {
  M1_BEAT_WORST_CASE_TICKS,
  M1_HANDBILL_CHART,
  M1_NAIL_STANCE,
  M1_NAIL_TARGET,
  M1_POST_OBJECTIVE_ID,
  M1_SECOND_BEAT_CHART,
  M1_SECOND_BEAT_TICKS,
  m1NailStanceBeat,
} from "../m1NailStance.js";
import { deriveChart } from "../chart.js";
import { playBeat, perfectPlan } from "./harness.js";

const SPEC = m1NailStanceBeat();

test("the shipped M1 beat has no defects", () => {
  assert.deepEqual(beatSpecDefects(SPEC), []);
});

test("the stance and target match the level's authored PRECISION block", () => {
  // Mirrored from @pa/mission-m1's opposition.ts. This package does not depend
  // on the level package — the dependency would eventually invert — so the
  // numbers are restated here and pinned, and the pin is what will fail if the
  // level moves the bough.
  assert.deepEqual(M1_NAIL_STANCE, { x: 79.6, y: 8.3, z: 0.4 });
  assert.deepEqual(M1_NAIL_TARGET, { x: 80.15, y: 9.45, z: 0.55 });
  // PRECISION.facingYaw is authored as Math.atan2(0.55, 0.15), which is the
  // heading from the stance to the target under this repo's yaw convention.
  // Compared to a tolerance rather than exactly: subtracting the coordinates
  // costs about 1e-14 of the literal, and the facing arc is sixty degrees wide,
  // so demanding bit equality here would only ever fail for a reason nobody can
  // feel.
  assert.ok(
    Math.abs(SPEC.facingYaw - Math.atan2(0.55, 0.15)) < 1e-9,
    `the derived facing ${SPEC.facingYaw} is not the authored ${Math.atan2(0.55, 0.15)}`,
  );
});

test("the beat costs the clock a fixed, affordable number of seconds", () => {
  // THE PACING CLAIM, pinned. A competent run of M1 was measured at 167.9 of the
  // 180-second clock, so there is roughly twelve seconds unspent and a longer
  // chart competes directly with route content. This chart takes 2.6 of them —
  // 6.25 seconds against the 3.65 the five-stroke chart reserved — and buys 2.6x
  // the judged input for it. The remaining nine and a half seconds are still the
  // level's to spend.
  //
  // Pinned exactly rather than bounded, because the number is now exact: the
  // chart is a whole number of bars, so there is no distribution to bound.
  const worstSeconds = M1_BEAT_WORST_CASE_TICKS / FIELD_TICK_HZ;
  assert.equal(M1_BEAT_WORST_CASE_TICKS, beatWorstCaseTicks(SPEC));
  assert.equal(M1_BEAT_WORST_CASE_TICKS, 375);
  assert.equal(worstSeconds, 6.25);
});

test("a second beat would cost less than the one it used to be", () => {
  // The costed proposal in m1NailStance.ts, kept honest. One bar behind the same
  // full-approach opening is five judged strokes for 3.05 seconds — fewer
  // seconds than the five-stroke chart this rework replaced, for the same five
  // strokes — so a level that finds a second place to put one adds a third
  // again of the mission's timed input for a quarter of its remaining headroom.
  assert.equal(M1_SECOND_BEAT_CHART.judgedBeats, 5);
  assert.equal(M1_SECOND_BEAT_TICKS / FIELD_TICK_HZ, 3.05);
  assert.ok(
    M1_SECOND_BEAT_TICKS < M1_BEAT_WORST_CASE_TICKS,
    "the costed second beat is no longer the cheap one",
  );
});

test("every seed's beat costs the same, so the budget is a price and not a bound", () => {
  // What the fixed span is FOR. The player spends this beat inside a patrol gap
  // they have to judge before committing, and a commitment whose length is a
  // dice roll cannot be judged. A perfect run lands on the same tick every time.
  const seen = new Set<number>();
  for (let seed = 0; seed < 400; seed++) {
    const played = playBeat(SPEC, seed, perfectPlan(SPEC, seed));
    seen.add(played.elapsedTicks);
    assert.ok(
      played.elapsedTicks <= M1_BEAT_WORST_CASE_TICKS,
      `seed ${seed} ran ${played.elapsedTicks} ticks against a ${M1_BEAT_WORST_CASE_TICKS} budget`,
    );
  }
  assert.deepEqual(
    [...seen],
    [M1_HANDBILL_CHART.spanTicks + SPEC.verb.settleTicks],
    "two seeds took different amounts of the mission clock for the same play",
  );
});

test("the stance test accepts the bough and rejects the ground under it", () => {
  const facing = SPEC.facingYaw;
  assert.equal(inBeatStance(SPEC, { pos: M1_NAIL_STANCE, yaw: facing }), true);
  // Half a metre along the bough is still the stance.
  assert.equal(
    inBeatStance(SPEC, {
      pos: { ...M1_NAIL_STANCE, x: M1_NAIL_STANCE.x - 0.5 },
      yaw: facing,
    }),
    true,
  );
  // The crowd is eight metres below and is not.
  assert.equal(
    inBeatStance(SPEC, { pos: { ...M1_NAIL_STANCE, y: 0 }, yaw: facing }),
    false,
  );
  // Neither is the far side of the crown.
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
  // Wrapping is handled: the arc is an angle, not an interval on the line.
  assert.equal(inFacingArc(SPEC, facing + Math.PI * 2), true);
});

test("the objective is met by doing the work, not by arriving at it", () => {
  // This is the whole difference from what M1 ships today, where the same
  // objective is a proximity test and reaching the bough completes it.
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
  // And standing somewhere else with the work done does not retroactively count.
  assert.equal(
    objective.satisfiedBy({ pos: { x: 0, y: 0, z: 0 }, yaw: SPEC.facingYaw }),
    false,
  );
  assert.equal(objective.id, M1_POST_OBJECTIVE_ID);
  assert.equal(objective.required, true);
});

test("a torn sheet is a terminal failure and an abandoned run is not", () => {
  const judged = deriveChart(SPEC.chart, 5).judgedBeats;
  const torn = playBeat(SPEC, 5, { offsets: new Array(judged).fill(null) });
  assert.equal(torn.outcome.grade, "TORN");
  assert.equal(isTerminalPrecisionFailure(torn.outcome), true);

  const walkedAway = playBeat(SPEC, 5, {
    armAt: 0,
    offsets: new Array(judged).fill(0),
    leaveAt: 20,
  });
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
