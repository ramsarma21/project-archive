import { test } from "node:test";
import assert from "node:assert/strict";

import { M1_POST_OBJECTIVE_ID, beatSpecDefects } from "@pa/beat";
import { PRECISION, PRECISION_BEAT_SECONDS } from "@pa/mission-m1";
import { missionInstanceDefects } from "../src/mission/levelPort.js";
import { missionDefinitionDefects } from "../src/mission/missionFormat.js";
import {
  BOSTON_SLATE,
  bostonSlateDefects,
  chapterNodeState,
  missionUnlocked,
} from "../src/chapter/bostonChapter.js";
import { M1_MISSION_ID, m1Instance, m1MissionDefinition } from "../src/chapter/m1Mission.js";

// M1 is the mission the owner plays. These check that it can actually be
// deployed, rather than that its data is shaped plausibly.

function instance(seed = 12345, ordinal = 1) {
  return m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: ordinal,
    seed,
    Scenery: null,
  });
}

test("the M1 definition is registrable", () => {
  assert.deepEqual(missionDefinitionDefects(m1MissionDefinition()), []);
});

test("the M1 instance passes the container's own validation", () => {
  assert.deepEqual(missionInstanceDefects(instance()), []);
});

test("the floor has a completion and it is not vacuous", () => {
  const required = instance().objectives.filter((o) => o.required);
  assert.ok(required.length >= 1);
  const atSpawn = instance();
  const spawnRead = {
    pos: atSpawn.spawn.pos,
    yaw: atSpawn.spawn.yaw,
    speedMps: 0,
    capsuleHeight: 1.55,
    crouched: false,
    grounded: true,
    verb: "NONE" as const,
    tick: 0,
    elapsedS: 0,
  };
  for (const objective of required) {
    assert.equal(
      objective.satisfiedBy(spawnRead),
      false,
      `${objective.id} is already met on tick one, which would clear the mission at full XP`,
    );
  }
});

// ---- the precision beat ----------------------------------------------------

test("the beat is mounted, on the bough the level authored", () => {
  const beat = instance().beat;
  assert.ok(beat, "M1 ships a precision beat and nothing mounted it");
  assert.deepEqual(beatSpecDefects(beat.spec), []);
  // The spec's geometry is the level's own PRECISION block rather than a second
  // copy of it, so moving the bough moves the beat.
  assert.deepEqual(beat.spec.stance, {
    x: PRECISION.stance[0],
    y: PRECISION.stance[1],
    z: PRECISION.stance[2],
  });
  assert.deepEqual(beat.spec.target, {
    x: PRECISION.target[0],
    y: PRECISION.target[1],
    z: PRECISION.target[2],
  });
  assert.ok(Math.abs(beat.spec.facingYaw - PRECISION.facingYaw) < 1e-9);
});

test("posting the handbill needs the work done, not the bough reached", () => {
  // The mission used to satisfy this objective with `within(read, post, 2, 1.2)`
  // — arriving at the tree WAS nailing the handbill up, which made the one
  // mechanical-skill expression in the mission optional scenery.
  const level = instance();
  const objective = level.objectives.find((o) => o.id === M1_POST_OBJECTIVE_ID);
  assert.ok(objective);
  assert.equal(objective.required, true);

  const onTheBough = {
    pos: level.beat!.spec.stance,
    yaw: level.beat!.spec.facingYaw,
    speedMps: 0,
    capsuleHeight: 1.55,
    crouched: false,
    grounded: true,
    verb: "NONE" as const,
    tick: 0,
    elapsedS: 40,
  };
  assert.equal(objective.satisfiedBy(onTheBough), false, "arriving posted it");

  level.beat!.onResolved?.({
    specId: level.beat!.spec.id,
    chartSpecId: level.beat!.spec.chart.id,
    seed: 1,
    grade: "CLEAN",
    posted: true,
    score: {
      quality: 0.8,
      strokeQuality: 0.8,
      worstStrikeQuality: 0.5,
      flush: 2,
      trueStrikes: 2,
      glancing: 1,
      slips: 0,
      strays: 0,
      judged: 5,
    },
    strikes: [],
    loudestIntensity: 0.3,
    elapsedTicks: 180,
    abandoned: false,
  });
  assert.equal(objective.satisfiedBy(onTheBough), true);
});

test("a torn sheet ends the attempt and an abandoned run does not", () => {
  const torn = instance();
  const walkedAway = instance();
  const outcome = (grade: "TORN" | "RAGGED", abandoned: boolean) => ({
    specId: "x",
    chartSpecId: "x",
    seed: 1,
    grade,
    posted: false,
    score: {
      quality: 0,
      strokeQuality: 0,
      worstStrikeQuality: 0,
      flush: 0,
      trueStrikes: 0,
      glancing: 0,
      slips: 5,
      strays: 0,
      judged: 5,
    },
    strikes: [],
    loudestIntensity: 0.45,
    elapsedTicks: 100,
    abandoned,
  });

  const read = {
    pos: { x: 79.6, y: 8.3, z: 0.4 },
    yaw: 0,
    speedMps: 0,
    capsuleHeight: 1.55,
    crouched: false,
    grounded: true,
    verb: "NONE" as const,
    tick: 0,
    elapsedS: 40,
  };
  const calm = {
    suspicion: 0,
    squadState: "UNAWARE" as const,
    detected: false,
    alertedTicks: 0,
    contactIds: [],
  };

  assert.equal(torn.failWhen?.(read, calm), null, "nothing has happened yet");
  torn.beat!.onResolved?.(outcome("TORN", false));
  const failure = torn.failWhen?.(read, calm);
  assert.ok(failure, "a torn sheet is §4.11's terminal precision failure");
  assert.equal(failure.code, "PRECISION_TORN");
  assert.ok(failure.cueId, "the terminal notice stays traceable to an authored cue");

  // The same grade, walked away from. The work is simply not done yet.
  walkedAway.beat!.onResolved?.(outcome("TORN", true));
  assert.equal(walkedAway.failWhen?.(read, calm), null);
});

test("the level asks for a dash, and gives the optional objective for it", () => {
  const optional = instance().objectives.filter((o) => !o.required);
  assert.ok(
    optional.some((o) => o.id === "the-burst"),
    "the burst is a verb the level never acknowledges",
  );
});

test("the beat is a moment in the mission's clock, not a chapter of it", () => {
  // `PRECISION_BEAT_S` was a placeholder from before a runtime existed: the mission
  // slate reserved 20 seconds for POST_JOB, and the runtime now derives the real
  // cost from the shipped chart. What the difference bought is traversal budget,
  // which changes how much level M1 still owes its three minutes rather than being
  // bookkeeping — so what has to hold is a RATIO against that clock, not a literal.
  //
  // THIS DELIBERATELY DOES NOT PIN THE CHART. The chart is retuned on its own terms
  // — it has already gone from 5 judged strokes over a variable 1.6-3.0s span to 13
  // over a fixed 5.6s one, and a beat is bars of authored figures, so its span moves
  // whenever a bar is added or a density spike is moved. A bound at a literal number
  // of seconds fails on every such retune while saying nothing about the design
  // claim, which is the one this test exists to hold: the beat is a held breath
  // inside a run, and the run is the mission.
  //
  // A tenth of the clock is where that stops being true. At the shipped chart the
  // beat is ~3.5% of the budget, so the chart has room to grow by most of a factor
  // of three, and there is headroom for the second encounter M1 may yet mount. The
  // old 20-second reservation was 11% and still fails this, which is the point of
  // the test's name; so would any beat that grew into a level of its own.
  const budgetS = instance().traversalBudgetS;
  const share = PRECISION_BEAT_SECONDS / budgetS;
  assert.ok(
    share <= 0.1,
    `the beat costs ${PRECISION_BEAT_SECONDS.toFixed(2)}s of a ${budgetS}s mission ` +
      `(${(share * 100).toFixed(1)}%). Past a tenth of the clock it is not a set ` +
      "piece inside a traversal any more, it is the level",
  );
  // And it is not free either: a beat cheap enough to be rounding is a beat nobody
  // has to plan a patrol gap around, which is the whole mechanic.
  assert.ok(
    share >= 0.01,
    `the beat costs ${PRECISION_BEAT_SECONDS.toFixed(2)}s, under a hundredth of the ` +
      "clock, which is too little to have to find a gap for",
  );
});

test("patrols and the crowd are pure functions of tick and seed", () => {
  const a = instance();
  assert.deepEqual(a.watcherPosesAtTick(600, 99), a.watcherPosesAtTick(600, 99));
  assert.notDeepEqual(a.watcherPosesAtTick(0, 99), a.watcherPosesAtTick(600, 99));
  const first = a.civiliansAtTick?.(0, 99);
  assert.ok(first && first.length > 0);
  // Same array, not merely equal: the container counts density from identity.
  assert.equal(a.civiliansAtTick?.(300, 99), first);
});

test("every civilian belongs to a declared crowd", () => {
  const a = instance();
  const clusters = new Set(a.crowdClusters.map((c) => c.id));
  for (const civilian of a.civiliansAtTick?.(0, 1) ?? []) {
    assert.ok(
      civilian.clusterId === null || clusters.has(civilian.clusterId),
      `${civilian.id} names a crowd that does not exist`,
    );
  }
});

test("the duel gets six questions, two per concept, and no repeats across attempts", () => {
  const seen = new Set<string>();
  for (const ordinal of [1, 2, 3]) {
    const brief = instance(4242, ordinal).duel;
    assert.equal(brief.questions.length, brief.rounds);
    const refs = brief.questions as ReadonlyArray<{
      itemId: string;
      conceptId: string;
    }>;
    const byConcept = new Map<string, number>();
    for (const ref of refs) {
      byConcept.set(ref.conceptId, (byConcept.get(ref.conceptId) ?? 0) + 1);
      assert.ok(
        !seen.has(ref.itemId),
        `${ref.itemId} is asked twice across a player's three attempts`,
      );
      seen.add(ref.itemId);
    }
    assert.equal(byConcept.size, 3);
    for (const [conceptId, count] of byConcept) {
      assert.equal(count, 2, `${conceptId} is asked ${count} times, not twice`);
    }
  }
});

test("the duel arena is the yard the player dropped into", () => {
  const brief = instance().duel;
  assert.ok(brief.world.blockers.length >= 8, "the arena has its cover");
  assert.ok(brief.world.platforms.length >= 1, "the arena has a floor");
  for (const side of ["A", "B"] as const) {
    const { pos } = brief.placement[side];
    assert.ok(
      pos.x > brief.world.bounds.minX && pos.x < brief.world.bounds.maxX,
      `${side} spawns outside the arena`,
    );
  }
});

test("the chapter declares fourteen missions and builds one", () => {
  assert.deepEqual(bostonSlateDefects(), []);
  assert.equal(BOSTON_SLATE.length, 14);
  assert.equal(BOSTON_SLATE.filter((entry) => entry.built).length, 1);
  assert.equal(BOSTON_SLATE[0]!.missionId, M1_MISSION_ID);
});

test("an unbuilt mission is never open, however far the player has got", () => {
  const everything = new Set(BOSTON_SLATE.map((entry) => entry.missionId));
  for (const entry of BOSTON_SLATE) {
    if (entry.built) continue;
    assert.equal(
      missionUnlocked({ missionId: entry.missionId, resolvedMissionIds: everything }),
      false,
      `${entry.missionId} is not built and must not be deployable`,
    );
    assert.equal(
      chapterNodeState({ missionId: entry.missionId, resolvedMissionIds: new Set() }),
      "FORTHCOMING",
      `${entry.missionId} should be drawn as forthcoming, not as a locked node`,
    );
  }
});

test("M1 is open from a standing start", () => {
  assert.equal(
    missionUnlocked({ missionId: M1_MISSION_ID, resolvedMissionIds: new Set() }),
    true,
  );
  assert.equal(
    chapterNodeState({ missionId: M1_MISSION_ID, resolvedMissionIds: new Set() }),
    "OPEN",
  );
});
