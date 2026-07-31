import { test } from "node:test";
import assert from "node:assert/strict";

import { alignClimbToLadder } from "@pa/engine-world/collision";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import type { LadderPlacementSpec } from "../types.js";

// ---------------------------------------------------------------------------
// THE LADDER FORWARDING PIPE.
//
// The refusal rule ("no ladder, no climb") cannot be wired until placed ladders
// reach the CollisionWorld, and today there is no generic ladder asset in the
// project — the placements are a content-pipeline job sequenced ahead of the
// rule. So this pass lays the pipe INERT: `compile.ts` forwards `level.ladders`
// into `world.ladders`, resolving each ladder's top off the surface it serves,
// and the engine's tested `alignClimbToLadder` reads it. This file proves the
// pipe end-to-end so it cannot silently rot before the placements land.
// ---------------------------------------------------------------------------

test("the real level authors its climb ladders, and every one resolves an ascent", () => {
  const { world } = compileLevel(M1_EFFIGY_RUN);
  // The content landed: one ladder per route climb-up a ladder honestly serves
  // (the tree and the stone buttress are grips, not ladders — see level/ladders).
  // The merchant's two goods-ladders were retired 31-Jul (its covert climb-in is a
  // ≤1.9 m mantle chain now, no ladder), so the count is down from 11 to 9. The
  // east-half ladders are being converted to mantle chains landmark by landmark.
  assert.equal(world.ladders?.length, 9, "nine ladders forwarded into world.ladders (merchant window + reveal retired to a mantle chain)");
  // Every forwarded ladder is one the tested predicate accepts: a real served
  // surface and a top-out with standing clearance ("no ladder, no climb" armed,
  // not refused). This is what the mission-world lane will read to turn the rule
  // on behind this content.
  for (const ladder of world.ladders ?? []) {
    assert.ok(
      alignClimbToLadder(world, ladder),
      `${ladder.id} does not resolve an ascent the predicate accepts`,
    );
  }
});

test("a placed ladder is forwarded into world.ladders with its top resolved off the served surface", () => {
  // SCAFFOLD_D1 is a real deck at y=2.9; place a ladder at its foot facing -Z.
  const placement: LadderPlacementSpec = {
    id: "TEST_SCAFFOLD_LADDER",
    at: [44.8, 0, -6.4],
    onto: "SCAFFOLD_D1",
    faceX: 0,
    faceZ: -1,
  };
  const level = { ...M1_EFFIGY_RUN, ladders: [placement] };
  const { world } = compileLevel(level);

  assert.equal(world.ladders?.length, 1);
  const ladder = world.ladders![0]!;
  // The top is MEASURED off the served surface, not re-typed.
  assert.equal(ladder.topY, 2.9);
  assert.deepEqual(ladder.base, { x: 44.8, y: 0, z: -6.4 });
  assert.equal(ladder.toSurface, "SCAFFOLD_D1");
  // Defaults applied by the pipe.
  assert.equal(ladder.widthM, 0.6);
  assert.equal(ladder.rungGapM, 0.3);
  // And the tested engine predicate can consume the forwarded ladder.
  const climb = alignClimbToLadder(world, ladder);
  assert.ok(climb, "the forwarded ladder resolves an ascent the predicate accepts");
});

test("a ladder onto an unknown surface drops out of the pipe (no ghost climb)", () => {
  const placement: LadderPlacementSpec = {
    id: "TEST_NOWHERE_LADDER",
    at: [0, 0, 0],
    onto: "NO_SUCH_SURFACE",
    faceX: 1,
    faceZ: 0,
  };
  const level = { ...M1_EFFIGY_RUN, ladders: [placement] };
  const { world } = compileLevel(level);
  assert.deepEqual(world.ladders, []);
});
