import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type CollisionWorld,
  type GripSpec,
  type LadderSpec,
  alignClimbToGrip,
  alignClimbToLadder,
  climbAffordanceAt,
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

// ---------------------------------------------------------------------------
// THE GRIP: a climb up a visible STRUCTURE that is not a ladder.
//
// The owner's law is "ladder OR grip". Two M1 ascents (the elm crown, the stone
// buttress) should not carry a bolted ladder, so they are authored as grips: a
// climb up a drawn solid whose set-offs / boughs are the holds. A grip is
// validated exactly as a ladder is — not exempted — and the merit is that the
// named support genuinely spans the rise.
// ---------------------------------------------------------------------------

/** A solid buttress mass (top at 2.6) with the ground it is climbed from. */
function buttressWorld(): CollisionWorld {
  return {
    blockers: [wallFromRect("BUTTRESS", 0, 0.5, 3, 0.6, { topY: 2.6, landable: true })],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
}

const BUTTRESS_GRIP: GripSpec = {
  id: "G_BUTTRESS",
  base: { x: 0, y: 0, z: 1.6 }, // north of the buttress (which ends at z ~1.1)
  topY: 2.6,
  faceX: 0,
  faceZ: 1,
  toSurface: "BUTTRESS",
  support: "BUTTRESS",
  kind: "STEPPED_MASONRY",
};

test("a grip up a solid that spans the rise arms a climb", () => {
  const world = buttressWorld();
  const climb = alignClimbToGrip(world, BUTTRESS_GRIP);
  assert.ok(climb, "stepped masonry that reaches the served top is a climbable grip");
  assert.equal(+climb!.riseTop.y.toFixed(3), 2.6);
});

test("a grip whose support does not reach the served top refuses", () => {
  // A support that stops a metre short of the served height is a bare face for
  // the top of the rise: there is nothing drawn to grip up there.
  const world: CollisionWorld = {
    blockers: [wallFromRect("STUB", 0, 0.5, 3, 0.6, { topY: 1.5, landable: true })],
    platforms: [platformFromRect("LEDGE", -3, 3, 0, 1, 2.6)],
    bounds: OPEN_BOUNDS,
  };
  const climb = alignClimbToGrip(world, {
    ...BUTTRESS_GRIP,
    toSurface: "LEDGE",
    support: "STUB",
  });
  assert.equal(climb, null, "a support that does not span the rise is not a grip");
});

test("a grip naming a support the world does not have refuses", () => {
  const world = buttressWorld();
  const climb = alignClimbToGrip(world, { ...BUTTRESS_GRIP, support: "NOWHERE" });
  assert.equal(climb, null);
});

test("climbAffordanceAt requires a ladder or grip at the foot — no means, no climb", () => {
  // A bare climb volume surface with no affordance: refuse.
  const bare = wallWithDeck();
  assert.equal(
    climbAffordanceAt(bare, 0, 0, -0.3, "DECK"),
    null,
    "no ladder and no grip means climbAffordanceAt refuses",
  );
  // With the ladder placed, the same foot arms.
  const withLadder: CollisionWorld = { ...bare, ladders: [LADDER] };
  assert.ok(
    climbAffordanceAt(withLadder, 0, 0, -0.1, "DECK"),
    "a ladder at the foot arms the climb",
  );
  // A grip arms it too.
  const withGrip: CollisionWorld = { ...buttressWorld(), grips: [BUTTRESS_GRIP] };
  assert.ok(
    climbAffordanceAt(withGrip, 0, 0, 1.6, "BUTTRESS"),
    "a grip at the foot arms the climb",
  );
  // But only near the foot: a ladder metres away does not arm this spot.
  assert.equal(
    climbAffordanceAt(withLadder, 20, 0, 20, "DECK"),
    null,
    "an affordance far from the foot does not arm a distant climb",
  );
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
