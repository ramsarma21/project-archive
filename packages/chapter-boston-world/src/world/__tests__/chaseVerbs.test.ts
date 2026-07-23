import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHASE_TOPPLE_STACKS,
  TAVERN_CUT,
  chaseVerbsAvailable,
  eligibleToppleStacks,
  propInstanceKey,
  tavernCutEligible,
  tavernCutObstacle,
  toppleObstacle,
  toppleStackManifestMismatches,
  toppleStackPropKeys,
  type ChaseVerbContext,
} from "../chaseVerbs.js";
import {
  CHASE_TUNING,
  EXTERIOR_CHASE_GRAPH,
  STEALTH_VOLUMES,
} from "../stealthManifest.js";
import { exteriorColliders, PROPS } from "../manifest.js";

function ctx(over: Partial<ChaseVerbContext> = {}): ChaseVerbContext {
  return {
    chaseActive: true,
    chasePhase: "ACTIVE",
    spaceId: "EXTERIOR",
    toppledStackIds: new Set<string>(),
    usedTavernCutChaseIds: new Set<string>(),
    chaseId: "CHASE_1",
    ...over,
  };
}

test("every authored topple stack references a live imported manifest prop", () => {
  assert.deepEqual(toppleStackManifestMismatches(), []);
  // And every stack must be a barrel/crate group (imported assets only).
  for (const stack of CHASE_TOPPLE_STACKS) {
    assert.ok(
      stack.glb === "barrel-group" || stack.glb === "crate-stack",
      `${stack.id} reuses an imported stack asset`,
    );
  }
});

test("topple stacks sit on or near the authored chase lanes", () => {
  // Each stack must be within reach of a chase-graph lane (z 0 / ±22) so a
  // pursuer pathing the lanes can actually reach the spill.
  for (const stack of CHASE_TOPPLE_STACKS) {
    const nearLane = EXTERIOR_CHASE_GRAPH.waypoints.some(
      (wp) => Math.abs(stack.pos[2] - wp.position[2]) <= 12,
    );
    assert.ok(nearLane, `${stack.id} is reachable from a chase lane`);
  }
});

test("chase verbs are offered only during a live exterior pursuit", () => {
  assert.ok(chaseVerbsAvailable(ctx()));
  assert.ok(chaseVerbsAvailable(ctx({ chasePhase: "STARTING" })));
  assert.ok(!chaseVerbsAvailable(ctx({ chaseActive: false, chaseId: null })));
  assert.ok(!chaseVerbsAvailable(ctx({ spaceId: "EXPLORE_tavern" })));
  assert.ok(!chaseVerbsAvailable(ctx({ chasePhase: "RESOLVING" })));
  assert.ok(!chaseVerbsAvailable(ctx({ chasePhase: "CAUGHT" })));
});

test("a toppled stack is one-shot: it never re-offers", () => {
  const all = eligibleToppleStacks(ctx());
  assert.equal(all.length, CHASE_TOPPLE_STACKS.length);
  const first = CHASE_TOPPLE_STACKS[0]!;
  const after = eligibleToppleStacks(
    ctx({ toppledStackIds: new Set([first.id]) }),
  );
  assert.equal(after.length, CHASE_TOPPLE_STACKS.length - 1);
  assert.ok(!after.some((stack) => stack.id === first.id));
});

test("the tavern cut is once per chase and needs a live chase", () => {
  assert.ok(tavernCutEligible(ctx()));
  assert.ok(
    !tavernCutEligible(ctx({ usedTavernCutChaseIds: new Set(["CHASE_1"]) })),
  );
  assert.ok(
    tavernCutEligible(
      ctx({ usedTavernCutChaseIds: new Set(["CHASE_0"]), chaseId: "CHASE_1" }),
    ),
  );
  assert.ok(!tavernCutEligible(ctx({ chaseActive: false, chaseId: null })));
});

test("topple obstacle carries the authored deterministic stumble", () => {
  const stack = CHASE_TOPPLE_STACKS[0]!;
  const ob = toppleObstacle(stack, 42);
  assert.equal(ob.id, stack.id);
  assert.equal(ob.tick, 42);
  assert.equal(ob.delaySeconds, CHASE_TUNING.stumbleDelaySeconds);
  assert.equal(ob.radiusM, CHASE_TUNING.stumbleRadiusM);
  assert.equal(ob.x, stack.pos[0]);
  assert.equal(ob.z, stack.pos[2]);
});

test("tavern cut pause is shorter when the pursuer saw you go in", () => {
  const seen = tavernCutObstacle(10, true);
  const unseen = tavernCutObstacle(10, false);
  assert.equal(seen.delaySeconds, CHASE_TUNING.tavernCutSeenPauseSeconds);
  assert.equal(
    unseen.delaySeconds,
    CHASE_TUNING.tavernCutUnseenPauseSeconds,
  );
  assert.ok(seen.delaySeconds < unseen.delaySeconds);
});

test("tavern cut endpoints stand on walkable ground, not inside a collider", () => {
  const colliders = exteriorColliders();
  const inside = (x: number, z: number): boolean =>
    colliders.some(
      ([cx, cz, hx, hz]) =>
        Math.abs(x - cx) < hx && Math.abs(z - cz) < hz,
    );
  assert.ok(
    !inside(TAVERN_CUT.backEntry[0], TAVERN_CUT.backEntry[2]),
    "back-door approach is clear",
  );
  assert.ok(
    !inside(TAVERN_CUT.frontExit[0], TAVERN_CUT.frontExit[2]),
    "front-door exit is clear",
  );
  // The cut crosses the tavern row: entry in the alley band, exit on the
  // street side, same doorX lane.
  assert.ok(TAVERN_CUT.backEntry[2] < -19.5);
  assert.ok(TAVERN_CUT.frontExit[2] > -10.6);
  assert.equal(TAVERN_CUT.backEntry[0], -18);
});

test("tavern cut exit lands OUTSIDE the front-door refuge volume", () => {
  // Landing inside REFUGE_TAVERN_DOOR would auto-resolve the pursuit as
  // REFUGE the instant the transit completes — the cut must instead hand the
  // street back to the runner with the chase still live.
  const refuge = STEALTH_VOLUMES.find(
    (volume) => volume.id === "REFUGE_TAVERN_DOOR",
  );
  assert.ok(refuge);
  const distance = Math.hypot(
    TAVERN_CUT.frontExit[0] - refuge!.center[0],
    TAVERN_CUT.frontExit[2] - refuge!.center[2],
  );
  assert.ok(
    distance > refuge!.radius + 0.3,
    `exit ${distance.toFixed(2)}m from refuge centre (radius ${refuge!.radius})`,
  );
});

test("prop hide-keys name exactly the toppled manifest instances", () => {
  const first = CHASE_TOPPLE_STACKS[0]!;
  const keys = toppleStackPropKeys([first.id]);
  assert.equal(keys.size, 1);
  const expected = propInstanceKey(first.glb, first.pos[0], first.pos[2]);
  assert.ok(keys.has(expected));
  const manifestMatch = PROPS.find(
    (prop) =>
      propInstanceKey(prop.glb, prop.pos[0], prop.pos[2]) === expected,
  );
  assert.ok(manifestMatch, "hide-key matches the live manifest entry");
});
