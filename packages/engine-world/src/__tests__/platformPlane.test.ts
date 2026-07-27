// The shared swept-capsule / platform-plane test, and the four placed-not-swept
// paths that have to consult it.
//
// A platform has a single y and no solid span, so the swept mover, head
// clearance and the intrusion predicate are all blind to it — correct for the
// side (you walk under a roof) and wrong for the plane (a body must not pass its
// feet or its head through the boards). Every path that is PLACED rather than
// swept — a ballistic arc, an authored vault, a reduced-motion completion, a
// validated move whose world then changed — used to cross deck planes freely.
// They all now ask sweptCapsuleCrossesPlatform.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  platformFromRect,
  platformFromPolygon,
  sweptCapsuleCrossesPlatform,
  type CollisionWorld,
} from "../collision.js";
import {
  STANDING_JUMP_VY,
  GRAVITY,
  beginStandingJump,
  beginAuthored,
  createGroundedState,
  stepMotion,
} from "../playerMotion.js";

const OPEN_BOUNDS = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };

// ---- the shared test: whole capsule span, expanded footprint, direction-aware -

const rectDeck: CollisionWorld = {
  blockers: [],
  platforms: [platformFromRect("DECK", -2, 2, -2, 2, 1.5)],
  bounds: OPEN_BOUNDS,
};

function crosses(
  w: CollisionWorld,
  from: [number, number, number],
  to: [number, number, number],
  height = STAND_HEIGHT,
) {
  return sweptCapsuleCrossesPlatform(
    w,
    { x: from[0], y: from[1], z: from[2] },
    { x: to[0], y: to[1], z: to[2] },
    CAPSULE_RADIUS,
    height,
  );
}

test("upward: feet rising through a deck are blocked", () => {
  assert.equal(crosses(rectDeck, [0, 0, 0], [0, 3, 0])?.id, "DECK");
});

test("upward: a head striking the underside is blocked even with the feet below", () => {
  // The deck is above the standing crown, so the feet stay well under it (0 ->
  // 0.6) while the crown (1.55 -> 2.15) rises through the plane at 2.0. A
  // feet-only test would have missed this entirely.
  const high: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("HIGH", -2, 2, -2, 2, 2.0)],
    bounds: OPEN_BOUNDS,
  };
  assert.equal(crosses(high, [0, 0, 0], [0, 0.6, 0])?.id, "HIGH");
});

test("downward: landing on a deck from above is not a crossing, but passing through an intermediate deck is", () => {
  // Coming down ONTO a deck's top: feet reach the plane from above and stop there,
  // so the plane is at the boundary of the span, never strictly inside — a
  // landing, not a crossing. Support and landingValid own it.
  assert.equal(crosses(rectDeck, [0, 3, 0], [0, 1.5, 0]), null);
  // Descending clean THROUGH the deck to the ground below it: the feet pass from
  // above the plane to below it while the body spans it over the footprint. That
  // is an intermediate deck the body drove through, and it is now caught (the old
  // endpoint test, which never looked at descents, missed it).
  assert.equal(crosses(rectDeck, [0, 3, 0], [0, 0, 0])?.id, "DECK");
  // (Leaving the deck a body was standing ON is the same swept fact; the caller
  // exempts the start and destination surfaces via `ignore`, exercised in the
  // authored regressions below and in the mission route tests.)
});

test("starts-on-plane: standing on a deck and leaving it is not a crossing", () => {
  // Rising off it.
  assert.equal(crosses(rectDeck, [0, 1.5, -1], [0, 3, 1]), null);
  // Walking level along it.
  assert.equal(crosses(rectDeck, [0, 1.5, -1], [0, 1.5, 1]), null);
});

test("horizontal: a full-body lateral passage through a deck is blocked", () => {
  // Feet below the plane, crown above it, travelling sideways over the footprint:
  // the deck cuts through the body. A plane at the feet is the floor, not a wall.
  assert.equal(crosses(rectDeck, [0, 1.0, -1], [0, 1.0, 1])?.id, "DECK");
  assert.equal(crosses(rectDeck, [0, 1.5, -1], [0, 1.5, 1]), null);
});

test("edge overlap: a capsule that clips the boards is over them (expand, do not erode)", () => {
  // 0.2m outside the +X edge is within the 0.35m radius: the body clips the deck,
  // so a rise there is through it. Erosion used to let this pass.
  assert.equal(crosses(rectDeck, [2.2, 0, 0], [2.2, 3, 0])?.id, "DECK");
  // A full radius clear of the edge really is clear.
  assert.equal(crosses(rectDeck, [2.5, 0, 0], [2.5, 3, 0]), null);
});

// ---- exact geometry: rounded corners, exact edge distance, tangency ---------
//
// The swept test measures the true distance from the capsule centre's path to
// the footprint, not an axis-expanded box or a march of samples. A vertical rise
// holds the centre at one (x,z) while the plane crosses the span, so these probe
// that exact distance at a known offset. CAPSULE_RADIUS is 0.35.

test("rect corner: a body a clean radius away diagonally does NOT collide (no square-corner false positive)", () => {
  const w: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("DECK", 0, 4, 0, 4, 1.5)],
    bounds: OPEN_BOUNDS,
  };
  // (-0.3, -0.3) is 0.30m off the corner in each axis — inside a 0.35m
  // axis-expanded box, but 0.4243m from the true corner. Rounded corners: clear.
  assert.equal(crosses(w, [-0.3, 0, -0.3], [-0.3, 3, -0.3]), null, "0.424m diagonal must not collide");
  // Nearer than the radius on the true diagonal (0.3394m): collide.
  assert.equal(crosses(w, [-0.24, 0, -0.24], [-0.24, 3, -0.24])?.id, "DECK");
});

test("polygon edge: a body within the radius of an edge collides (0.3488m < 0.35)", () => {
  const square: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  const w: CollisionWorld = {
    blockers: [],
    platforms: [platformFromPolygon("PDECK", square, 1.5)],
    bounds: OPEN_BOUNDS,
  };
  // 0.3488m perpendicular from the left edge: inside the 0.35 radius — collide.
  assert.equal(crosses(w, [-0.3488, 0, 2], [-0.3488, 3, 2])?.id, "PDECK");
  // 0.36m out: clear.
  assert.equal(crosses(w, [-0.36, 0, 2], [-0.36, 3, 2]), null);
});

test("tangency: contact exactly at the radius counts, a hair beyond does not", () => {
  const w: CollisionWorld = {
    blockers: [],
    platforms: [platformFromPolygon("PDECK", [[0, 0], [4, 0], [4, 4], [0, 4]], 1.5)],
    bounds: OPEN_BOUNDS,
  };
  // Exactly 0.35m from the edge: tangent, and a body grazing the boards is over
  // them — the safe boundary for a floor test.
  assert.equal(crosses(w, [-0.35, 0, 2], [-0.35, 3, 2])?.id, "PDECK");
  // A hair outside the radius: clear.
  assert.equal(crosses(w, [-0.3501, 0, 2], [-0.3501, 3, 2]), null);
});

test("horizontal outside-to-outside: a swept path crossing a deck between two clear endpoints is blocked", () => {
  // A deck narrow in Z, both endpoints clear of its footprint, the path passing
  // straight over it at chest height. The old endpoint test saw two clear ends
  // and missed the crossing between them; the swept test catches it.
  const narrow: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("STRIP", -3, 3, -0.5, 0.5, 1.5)],
    bounds: OPEN_BOUNDS,
  };
  // Feet at 1.0, crown at 2.55: the plane at 1.5 is inside the span. Endpoints at
  // z=-2 and z=+2 are both outside STRIP (z in [-0.5, 0.5]).
  assert.equal(crosses(narrow, [0, 1.0, -2], [0, 1.0, 2])?.id, "STRIP");
  // A path that stays to one side never crosses it.
  assert.equal(crosses(narrow, [0, 1.0, -2], [0, 1.0, -0.9]), null);
});

test("diagonal: a crossing that changes height and lane at once is blocked", () => {
  const deck: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("DECK", -2, 2, -2, 2, 1.5)],
    bounds: OPEN_BOUNDS,
  };
  // Rises and slides sideways; the crown passes through the plane over the deck.
  assert.equal(crosses(deck, [-3, 0.4, -3], [1, 1.4, 1])?.id, "DECK");
});

test("narrow polygon: a plank thinner than the body is still a floor to it", () => {
  const plank: CollisionWorld = {
    blockers: [],
    platforms: [
      platformFromPolygon(
        "PLANK",
        [
          [-0.1, -3],
          [0.1, -3],
          [0.1, 3],
          [-0.1, 3],
        ],
        1.5,
      ),
    ],
    bounds: OPEN_BOUNDS,
  };
  // Rising over the plank, and rising a hair beside it (within radius): both
  // blocked, where an eroded polygon narrower than a diameter was invisible.
  assert.equal(crosses(plank, [0, 0, 0], [0, 3, 0])?.id, "PLANK");
  assert.equal(crosses(plank, [0.3, 0, 0], [0.3, 3, 0])?.id, "PLANK");
  // Well clear of the plank on the X axis: no crossing.
  assert.equal(crosses(plank, [1, 0, 0], [1, 3, 0]), null);
});

// ---- ballistic movement ----------------------------------------------------

test("a jump under a deck stops at the boards instead of teleporting on top", () => {
  // The deck is above head height, so the standing pose is legal; the jump's
  // apex would carry the head up through the plane. headClearance sees only
  // blockers, so without the shared plane test the body rose straight through.
  const deckY = 2.4;
  const w: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("DECK", -3, 3, -3, 3, deckY)],
    bounds: OPEN_BOUNDS,
  };
  let s = beginStandingJump(createGroundedState({ x: 0, y: 0, z: 0 }, 0));
  const freeApex = (STANDING_JUMP_VY * STANDING_JUMP_VY) / (2 * GRAVITY);
  let maxFoot = 0;
  for (let i = 0; i < 240; i++) {
    s = stepMotion(w, s, { dt: 1 / 120, targetVelX: 0, targetVelZ: 0, reducedMotion: false }).state;
    maxFoot = Math.max(maxFoot, s.pos.y);
    if (s.grounded) break;
  }
  const ceilingFoot = deckY - STAND_HEIGHT;
  assert.ok(
    maxFoot < freeApex - 0.2,
    `head passed through the deck: rose to foot y=${maxFoot.toFixed(2)}, free apex is ${freeApex.toFixed(2)}`,
  );
  assert.ok(
    Math.abs(maxFoot - ceilingFoot) < 0.1,
    `apex ${maxFoot.toFixed(2)} should clamp at the deck underside (foot ${ceilingFoot.toFixed(2)})`,
  );
  assert.ok(Math.abs(s.pos.y) < 0.01, `landed back on the ground, not the deck (y=${s.pos.y.toFixed(2)})`);
});

// ---- authored preflight ----------------------------------------------------

test("an authored climb whose path rises through a deck is refused, unless the deck is what it tops out on", () => {
  const w: CollisionWorld = {
    blockers: [],
    platforms: [
      platformFromRect("ROOF", -3, 3, -3, 3, 3),
      platformFromRect("DECK", -3, 3, -3, 3, 1.5),
    ],
    bounds: OPEN_BOUNDS,
  };
  const anchors = [
    { x: 0, y: 0, z: -2 },
    { x: 0, y: 3, z: 0 },
  ];
  // The deck cuts the rise at y=1.5 (x=0, z=-1, well inside): refused.
  assert.equal(
    beginAuthored(w, createGroundedState({ x: 0, y: 0, z: -2 }, 0), {
      kind: "CLIMB_UP",
      anchors,
      durationMs: 800,
    }),
    null,
  );
  // The same climb, told the deck is the thing it is topping out on, is allowed.
  assert.notEqual(
    beginAuthored(w, createGroundedState({ x: 0, y: 0, z: -2 }, 0), {
      kind: "CLIMB_UP",
      anchors,
      durationMs: 800,
      ignore: ["DECK"],
    }),
    null,
  );
});

// ---- reduced-motion completion in a changed world --------------------------

test("a reduced-motion action cancels rather than completing through a deck the world grew", () => {
  const before: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("ROOF", -3, 3, -3, 3, 3)],
    bounds: OPEN_BOUNDS,
  };
  const anchors = [
    { x: 0, y: 0, z: -2 },
    { x: 0, y: 3, z: 0 },
  ];
  const begun = beginAuthored(before, createGroundedState({ x: 0, y: 0, z: -2 }, 0), {
    kind: "CLIMB_UP",
    anchors,
    durationMs: 2000,
  });
  assert.ok(begun, "the climb validates in the world it was begun in");

  // A door/route swap drops a deck across the ascent after it committed.
  const after: CollisionWorld = {
    ...before,
    platforms: [
      platformFromRect("ROOF", -3, 3, -3, 3, 3),
      platformFromRect("DECK", -3, 3, -3, 3, 1.5),
    ],
  };
  const r = stepMotion(after, begun!, { dt: 1 / 60, targetVelX: 0, targetVelZ: 0, reducedMotion: true });
  assert.ok(
    r.events.includes("actionCancelled"),
    `reduced motion completed through the new deck instead of cancelling: ${r.events.join(",")}`,
  );
  assert.ok(!r.events.includes("actionComplete"));
  // Snapped to a validated endpoint (the ground start), never a midpoint inside
  // the boards.
  assert.ok(Math.abs(r.state.pos.y) < 0.01, `snapped to y=${r.state.pos.y.toFixed(2)}, not the ground start`);
});

// ---- unrelated intermediate decks, across every authored path ---------------

test("preflight: a descending authored move through an unrelated intermediate deck is refused", () => {
  // Down off a high roof to the ground, with a deck in the way partway down that
  // the move does not start or end on. The start (ROOF) and destination (GROUND)
  // are exempt; the intermediate DECK is a floor the body would drop through.
  const w: CollisionWorld = {
    blockers: [],
    platforms: [
      platformFromRect("ROOF", -3, 3, -3, 0, 6),
      platformFromRect("DECK", -3, 3, 0, 3, 3),
    ],
    bounds: OPEN_BOUNDS,
  };
  const anchors = [
    { x: 0, y: 6, z: -0.5 },
    { x: 0, y: 0, z: 2 },
  ];
  assert.equal(
    beginAuthored(w, createGroundedState({ x: 0, y: 6, z: -0.5 }, 0), {
      kind: "CLIMB_DOWN",
      anchors,
      durationMs: 800,
    }),
    null,
    "the descent drives through the intermediate DECK and must be refused",
  );
  // Told to ignore that deck (it is the thing being descended onto), it is allowed.
  assert.notEqual(
    beginAuthored(w, createGroundedState({ x: 0, y: 6, z: -0.5 }, 0), {
      kind: "CLIMB_DOWN",
      anchors,
      durationMs: 800,
      ignore: ["DECK"],
    }),
    null,
  );
});

test("runtime: an authored move is cancelled when an unrelated intermediate deck appears across its remaining path", () => {
  // A long level vault-style crossing on the same tier. It validates in the empty
  // world; a deck then materialises across the middle of its remaining path, and
  // the per-tick runtime check cancels it rather than driving the body through.
  const before: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("LEDGE", -3, 3, -3, 3, 3)],
    bounds: OPEN_BOUNDS,
  };
  const anchors = [
    { x: 0, y: 3, z: -2.5 },
    { x: 0, y: 3, z: 2.5 },
  ];
  const begun = beginAuthored(before, createGroundedState({ x: 0, y: 3, z: -2.5 }, 0), {
    kind: "VAULT",
    anchors,
    durationMs: 1200,
  });
  assert.ok(begun, "the level crossing validates in the empty world");

  // A deck cutting the body at chest height (y=3.8, within [3, 4.55]) across the
  // lane the body is still to travel.
  const after: CollisionWorld = {
    blockers: [],
    platforms: [
      platformFromRect("LEDGE", -3, 3, -3, 3, 3),
      platformFromRect("WALLDECK", -3, 3, 0.5, 1.5, 3.8),
    ],
    bounds: OPEN_BOUNDS,
  };
  let motion = begun!;
  let cancelled = false;
  for (let i = 0; i < 90; i++) {
    const r = stepMotion(after, motion, { dt: 1 / 60, targetVelX: 0, targetVelZ: 0, reducedMotion: false });
    motion = r.state;
    if (r.events.includes("actionCancelled")) {
      cancelled = true;
      break;
    }
  }
  assert.ok(cancelled, "the runtime check did not cancel the move through the new deck");
});
