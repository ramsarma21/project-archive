import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type CollisionWorld,
  type LadderSpec,
  alignClimbToLadder,
  surfaceInteriorDir,
  surfaceRectById,
  wallFromRect,
  platformFromRect,
  CAPSULE_RADIUS,
  STAND_HEIGHT,
} from "../collision.js";

// ---------------------------------------------------------------------------
// THE LADDER-ALIGNED CLIMB PREDICATE.
//
// The owner's rule: you cannot climb without a ladder, and a climb is only
// offered when it visually makes sense against the ladder's rungs. The engine
// half of that is a predicate decidable from the ladder object and the world —
// NOT a swept-spline residual test (the approach that produced false positives
// last night). This file pins the two properties that make the predicate worth
// preferring: it rides the body on the OUTER FACE from any heading, and it
// REFUSES a ladder whose top-out has no standing clearance (a ladder pointing
// into a ceiling), which is what makes the "forced straight up and through"
// impossible to arm.
// ---------------------------------------------------------------------------

const OPEN_BOUNDS = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };

/** A wall along +X with a walkable deck on top, and a ladder up its −Z face. */
function wallWithDeck(): CollisionWorld {
  return {
    // A solid wall: footprint x[-3,3] z[0,1], top at 3.0m.
    blockers: [wallFromRect("WALL", 0, 0.5, 3, 0.5, { topY: 3.0, landable: true })],
    // The deck the ladder tops out onto, coplanar with the wall top.
    platforms: [platformFromRect("DECK", -3, 3, 0, 1, 3.0)],
    bounds: OPEN_BOUNDS,
  };
}

// Base at the wall's −Z face (z = 0), on the ground, face pointing −Z (outward,
// away from the wall toward a climber standing at negative z).
const LADDER: LadderSpec = {
  id: "L_WALL",
  base: { x: 0, y: 0, z: 0 },
  topY: 3.0,
  faceX: 0,
  faceZ: -1,
  toSurface: "DECK",
  widthM: 0.6,
  rungGapM: 0.3,
};

test("a ladder with a clear top arms a climb that rides the outer face", () => {
  const world = wallWithDeck();
  const climb = alignClimbToLadder(world, LADDER);
  assert.ok(climb, "a ladder against a wall with a clear deck must arm a climb");
  // The rise is held a full capsule radius OUT along the face normal (−Z), so
  // the capsule centre is tangent to the rungs and never inside the wall.
  assert.equal(+climb!.riseFoot.z.toFixed(3), -CAPSULE_RADIUS);
  assert.equal(climb!.riseFoot.y, 0);
  assert.equal(+climb!.riseTop.y.toFixed(3), 3.0);
  assert.equal(+climb!.riseTop.z.toFixed(3), -CAPSULE_RADIUS);
  // The top-out steps INWARD (+Z) onto the deck, a full radius clear of the lip
  // (the rise stood a radius out, so the inward step is two radii).
  assert.ok(climb!.topOut.z > climb!.riseTop.z, "top-out steps in over the deck");
  assert.ok(climb!.topOut.z >= CAPSULE_RADIUS - 1e-9, "top-out clears the near lip by a radius");
});

test("the arming path is identical regardless of any approach heading", () => {
  // alignClimbToLadder takes NO probe/heading input: the path is a pure function
  // of the ladder and the world. This is the property that kills the angle bug —
  // "from any other angle it goes through the ceiling" — at its root. Two reads
  // of the same ladder are byte-identical.
  const world = wallWithDeck();
  const a = alignClimbToLadder(world, LADDER);
  const b = alignClimbToLadder(world, { ...LADDER });
  assert.deepEqual(a, b);
});

test("a ladder into a ceiling does not arm (no clearance, no climb)", () => {
  const world = wallWithDeck();
  // Drop a soffit a hair over the deck at the top-out point: a real ceiling with
  // less than standing headroom above where the body would finish.
  world.blockers.push(
    wallFromRect("CEILING", 0, 0.5 + CAPSULE_RADIUS + 0.05, 3, 1, {
      baseY: 3.0 + 0.5,
      topY: 3.0 + 1.0,
      landable: false,
    }),
  );
  const climb = alignClimbToLadder(world, LADDER);
  assert.equal(climb, null, "a ladder whose top-out has no standing room must refuse");
});

test("a ladder onto no known surface does not arm", () => {
  const world = wallWithDeck();
  const climb = alignClimbToLadder(world, { ...LADDER, toSurface: "NOWHERE" });
  // The top-out landing check fails because there is no deck to land on.
  assert.equal(climb, null);
});

test("surfaceRectById / surfaceInteriorDir read a surface off its footprint", () => {
  const world = wallWithDeck();
  const rect = surfaceRectById(world, "DECK");
  assert.ok(rect);
  assert.equal(rect!.y, 3.0);
  // A foot standing at the −Z edge of the deck points inward toward its centre
  // (+Z), independent of which way the player walked in.
  const dir = surfaceInteriorDir(world, "DECK", 0, -2);
  assert.ok(dir);
  assert.ok(dir!.z > 0.9, "interior direction points into the deck");
  assert.equal(surfaceRectById(world, "NOWHERE"), null);
});
