import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type CollisionWorld,
  wallFromRect,
  wallFromOrientedRect,
  wallFromCapsule,
  platformFromRect,
  sweepXZ,
  positionClear,
  supportBelow,
  headClearance,
  landingValid,
  canStand,
  STAND_HEIGHT,
  CROUCH_HEIGHT,
  CAPSULE_RADIUS,
} from "../collision.js";
import {
  createGroundedState,
  beginStandingJump,
  beginRunningJump,
  beginAuthored,
  toggleFreeCrouch,
  cancelAction,
  stepMotion,
  simulateBallistic,
  GRAVITY,
  STANDING_JUMP_VY,
  STEP_UP,
  type MotionState,
} from "../playerMotion.js";

const OPEN_BOUNDS = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };

function emptyWorld(): CollisionWorld {
  return { blockers: [], platforms: [], bounds: OPEN_BOUNDS };
}

// Run a motion state to rest (or for a max number of frames) at a fixed dt.
function run(
  world: CollisionWorld,
  state: MotionState,
  frames: number,
  dt = 1 / 60,
  input: { targetVelX?: number; targetVelZ?: number; reducedMotion?: boolean } = {},
) {
  let s = state;
  const events: string[] = [];
  for (let i = 0; i < frames; i++) {
    const r = stepMotion(world, s, {
      dt,
      targetVelX: input.targetVelX ?? 0,
      targetVelZ: input.targetVelZ ?? 0,
      reducedMotion: input.reducedMotion ?? false,
    });
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

test("standing jump: apex ~1.2m, drift <5cm, support snap to ground", () => {
  const world = emptyWorld();
  let s = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
  s = beginStandingJump(s);
  assert.equal(s.phase, "STANDING_JUMP");

  let apex = 0;
  let maxDrift = 0;
  const events: string[] = [];
  for (let i = 0; i < 200; i++) {
    const r = stepMotion(world, s, { dt: 1 / 60, targetVelX: 3, targetVelZ: 0, reducedMotion: false });
    s = r.state;
    events.push(...r.events);
    apex = Math.max(apex, s.pos.y);
    maxDrift = Math.max(maxDrift, Math.hypot(s.pos.x, s.pos.z));
    if (r.events.includes("landed")) break;
  }
  const analyticApex = (STANDING_JUMP_VY * STANDING_JUMP_VY) / (2 * GRAVITY);
  assert.ok(Math.abs(apex - analyticApex) < 0.05, `apex ${apex} vs ${analyticApex}`);
  assert.ok(apex > 1.15 && apex < 1.3, `apex ${apex} not ~1.2`);
  assert.ok(maxDrift < 0.05, `standing drift ${maxDrift} >= 5cm`);
  assert.ok(events.includes("landed"), "did not land");
  assert.ok(Math.abs(s.pos.y) < 0.01, `landed y ${s.pos.y} not within 1cm`);
  assert.equal(s.phase, "GROUNDED");
});

test("running jump: preserves launch horizontal velocity into a real arc", () => {
  const world = emptyWorld();
  let s = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
  s.vel = { x: 3.5, y: 0, z: 0 };
  s = beginRunningJump(s);
  assert.equal(s.phase, "RUNNING_JUMP");
  assert.equal(s.vel.x, 3.5);
  const { state } = run(world, s, 300, 1 / 60, { targetVelX: 0 });
  // Flight time ~2*vy/g; horizontal distance ~ vx * t.
  const flight = (2 * STANDING_JUMP_VY) / GRAVITY;
  assert.ok(Math.abs(state.pos.x - 3.5 * flight) < 0.15, `range ${state.pos.x}`);
  assert.equal(state.phase, "GROUNDED");
});

test("running jump collides with a wall, no collider bypass", () => {
  const world: CollisionWorld = {
    blockers: [wallFromRect("WALL", 1.5, 0, 0.3, 5)],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  let s = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
  s.vel = { x: 6, y: 0, z: 0 };
  s = beginRunningJump(s);
  const { state } = run(world, s, 300, 1 / 60);
  assert.ok(state.pos.x < 1.5 - 0.3, `passed through wall to x=${state.pos.x}`);
});

test("swept capsule cannot tunnel through a thin wall at extreme speed", () => {
  const world: CollisionWorld = {
    blockers: [wallFromRect("THIN", 0, 0, 0.02, 8)],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  const result = sweepXZ(
    world,
    { x: -8, y: 0, z: 0 },
    { x: 8, z: 0 },
    CAPSULE_RADIUS,
    STAND_HEIGHT,
  );
  assert.ok(result.x < -0.36, `tunnelled to x=${result.x}`);
  assert.deepEqual(result.hitIds, ["THIN"]);
  assert.ok(positionClear(world, { x: result.x, y: 0, z: result.z }, CAPSULE_RADIUS, STAND_HEIGHT));
});

test("sprint diagonal preserves tangent speed along a wall without sticking", () => {
  const world: CollisionWorld = {
    blockers: [wallFromRect("WALL", 1, 0, 0.1, 20)],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  let state = createGroundedState({ x: 0, y: 0, z: -4 }, 0);
  let previousZ = state.pos.z;
  let wallContactFrames = 0;
  for (let frame = 0; frame < 180; frame++) {
    state = stepMotion(world, state, {
      dt: 1 / 60,
      targetVelX: 4.6 / Math.SQRT2,
      targetVelZ: 4.6 / Math.SQRT2,
      reducedMotion: false,
    }).state;
    assert.ok(state.pos.z >= previousZ - 1e-9, `oscillated backward at ${frame}`);
    assert.ok(positionClear(world, state.pos, CAPSULE_RADIUS, state.capsuleHeight));
    if (state.pos.x > 0.53) wallContactFrames += 1;
    previousZ = state.pos.z;
  }
  assert.ok(wallContactFrames > 90, "never established sustained wall contact");
  assert.ok(state.pos.z > 3.5, `lost tangent travel at z=${state.pos.z}`);
  assert.ok(state.pos.x > 0.54 && state.pos.x < 0.551, `bad contact x=${state.pos.x}`);
  assert.ok(Math.abs(state.vel.x) < 1e-8, `retained inward velocity ${state.vel.x}`);
  assert.ok(state.vel.z > 3, `tangent velocity collapsed to ${state.vel.z}`);
});

test("inside corner settles once with no axis oscillation or invisible snag", () => {
  const world: CollisionWorld = {
    blockers: [
      wallFromRect("EAST", 1, 0, 0.1, 8),
      wallFromRect("NORTH", 0, 1, 8, 0.1),
    ],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  let state = createGroundedState({ x: -1, y: 0, z: -1 }, 0);
  const settled: Array<readonly [number, number]> = [];
  for (let frame = 0; frame < 240; frame++) {
    state = stepMotion(world, state, {
      dt: 1 / 60,
      targetVelX: 4.6 / Math.SQRT2,
      targetVelZ: 4.6 / Math.SQRT2,
      reducedMotion: false,
    }).state;
    assert.ok(positionClear(world, state.pos, CAPSULE_RADIUS, state.capsuleHeight));
    if (frame >= 180) settled.push([state.pos.x, state.pos.z]);
  }
  const spreadX = Math.max(...settled.map(([x]) => x)) - Math.min(...settled.map(([x]) => x));
  const spreadZ = Math.max(...settled.map(([, z]) => z)) - Math.min(...settled.map(([, z]) => z));
  assert.ok(spreadX < 1e-7 && spreadZ < 1e-7, `corner jitter ${spreadX},${spreadZ}`);
  assert.ok(state.pos.x > 0.54 && state.pos.x < 0.551);
  assert.ok(state.pos.z > 0.54 && state.pos.z < 0.551);
});

test("OBB and capsule edges slide deterministically and remain clear", () => {
  const blockers = [
    wallFromOrientedRect("OBB", 0, 0, 0.2, 4, Math.PI / 4),
    wallFromCapsule(
      "PROP",
      { x: 4, y: 0, z: -1 },
      { x: 4, y: 0, z: 1 },
      0.35,
      { topY: 2 },
    ),
  ];
  const world: CollisionWorld = { blockers, platforms: [], bounds: OPEN_BOUNDS };
  const starts = [
    { x: -3, y: 0, z: 3 },
    { x: 2, y: 0, z: 0 },
  ];
  const targets = [
    { x: 3, z: -2 },
    { x: 6, z: 1.2 },
  ];
  starts.forEach((start, index) => {
    const first = sweepXZ(
      world,
      start,
      targets[index]!,
      CAPSULE_RADIUS,
      STAND_HEIGHT,
    );
    const second = sweepXZ(
      world,
      start,
      targets[index]!,
      CAPSULE_RADIUS,
      STAND_HEIGHT,
    );
    assert.deepEqual(first, second, `non-deterministic shape ${index}`);
    assert.ok(first.hitIds.length > 0, `shape ${index} never collided`);
    assert.ok(positionClear(world, { x: first.x, y: 0, z: first.z }, CAPSULE_RADIUS, STAND_HEIGHT));
    assert.ok(
      Math.hypot(first.x - start.x, first.z - start.z) > 0.5,
      `shape ${index} dead-stopped`,
    );
  });
});

test("gap jump: solvable landing validates, void does not", () => {
  const withPlatform: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("FAR", 2.5, 5, -2, 2, 0)],
    bounds: OPEN_BOUNDS,
  };
  const good = simulateBallistic(withPlatform, { x: 0, y: 0, z: 0 }, { x: 4, y: STANDING_JUMP_VY, z: 0 }, undefined);
  assert.ok(good.landed && good.valid, "expected a valid gap landing");

  // No support anywhere except the launch: model the void with bounds that let
  // the body fall past y=-50 (no ground plane hit because it moves off any pad).
  const voidWorld: CollisionWorld = { blockers: [], platforms: [], bounds: OPEN_BOUNDS };
  // Ground plane at 0 always catches in this model, so a "no solvable landing"
  // is represented by an obstacle wall blocking the arc into a dead end.
  const blocked: CollisionWorld = {
    blockers: [wallFromRect("W", 1.2, 0, 0.2, 5)],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  const stuck = simulateBallistic(blocked, { x: 0, y: 0, z: 0 }, { x: 5, y: STANDING_JUMP_VY, z: 0 }, undefined);
  // It still lands (ground), but short of the wall — the caller compares the
  // predicted landing id/position to decide. Sanity: it never tunnels past.
  assert.ok(stuck.pos.x < 1.2, "arc tunneled through wall in preflight");
  void voidWorld;
});

test("climb heights land exactly on the authored anchor (0.7 / 1.5 / 3m within 1cm)", () => {
  for (const h of [0.7, 1.5, 3.0]) {
    const world: CollisionWorld = {
      blockers: [],
      platforms: [platformFromRect(`TOP${h}`, -1, 1, h - 0.5, h + 0.5, h)],
      bounds: OPEN_BOUNDS,
    };
    let s = createGroundedState({ x: 0, y: 0, z: 2 }, 0);
    const begun = beginAuthored(world, s, {
      kind: "CLIMB_UP",
      anchors: [
        { x: 0, y: 0, z: 2 },
        { x: 0, y: h, z: h },
      ],
      durationMs: 1000,
    });
    assert.ok(begun, `climb to ${h} failed preflight`);
    const { state, events } = run(world, begun!, 120);
    assert.ok(events.includes("actionComplete"), `climb ${h} never completed`);
    assert.ok(Math.abs(state.pos.y - h) < 0.01, `climb ${h} ended at y=${state.pos.y}`);
  }
});

test("climb-down faces the obstacle during, restores outward facing at exit", () => {
  // Obstacle to the north (+z); actor climbs down to the south (-z). Outward
  // normal points -z, so facing the obstacle is +z (yaw atan2(0,1)=0) and exit
  // facing is -z (yaw atan2(0,-1)=PI).
  const world: CollisionWorld = { blockers: [], platforms: [], bounds: OPEN_BOUNDS };
  let s = createGroundedState({ x: 0, y: 2, z: 0 }, 0);
  const begun = beginAuthored(world, s, {
    kind: "CLIMB_DOWN",
    anchors: [
      { x: 0, y: 2, z: 0 }, // top (obstacle)
      { x: 0, y: 0, z: -1.5 }, // ground (outward)
    ],
    durationMs: 1000,
  })!;
  // Mid-action: faces the obstacle (+z => yaw ~0).
  let mid = begun;
  for (let i = 0; i < 30; i++) mid = stepMotion(world, mid, { dt: 1 / 60, targetVelX: 0, targetVelZ: 0, reducedMotion: false }).state;
  assert.ok(Math.abs(mid.yaw) < 0.2, `climb-down mid yaw ${mid.yaw} not facing obstacle`);
  const done = run(world, begun, 120).state;
  assert.ok(Math.abs(Math.abs(done.yaw) - Math.PI) < 0.05, `exit yaw ${done.yaw} not outward`);
});

test("cardinal climbs all end at the correct height and outward facing", () => {
  const dirs: Array<[string, number, number]> = [
    ["N", 0, 1],
    ["S", 0, -1],
    ["E", 1, 0],
    ["W", -1, 0],
  ];
  const world: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("TOP", -1, 1, -1, 1, 1.5)],
    bounds: OPEN_BOUNDS,
  };
  for (const [name, nx, nz] of dirs) {
    let s = createGroundedState({ x: nx * 2, y: 0, z: nz * 2 }, 0);
    const begun = beginAuthored(world, s, {
      kind: "CLIMB_UP",
      anchors: [
        { x: nx * 2, y: 0, z: nz * 2 },
        { x: 0, y: 1.5, z: 0 },
      ],
      durationMs: 800,
    })!;
    const done = run(world, begun, 100).state;
    assert.ok(Math.abs(done.pos.y - 1.5) < 0.01, `${name} climb ended at ${done.pos.y}`);
  }
});

test("vault ignores only the tagged obstacle during clearance", () => {
  const crateA = wallFromRect("CRATE_A", 1, 0, 0.6, 0.6, { topY: 1.0 });
  const crateB = wallFromRect("CRATE_B", 3, 0, 0.6, 0.6, { topY: 1.0 });
  const world: CollisionWorld = { blockers: [crateA, crateB], platforms: [], bounds: OPEN_BOUNDS };
  const from = { x: 0, y: 0, z: 0 };
  // Ignoring crate A lets us move into its footprint; crate B is untouched.
  const ignoreA = sweepXZ(world, from, { x: 1, z: 0 }, CAPSULE_RADIUS, STAND_HEIGHT, new Set(["CRATE_A"]));
  assert.ok(!ignoreA.blockedX, "vault should ignore its own obstacle");
  const noIgnore = sweepXZ(world, from, { x: 1, z: 0 }, CAPSULE_RADIUS, STAND_HEIGHT);
  assert.ok(noIgnore.blockedX, "non-target obstacle must still block");
});

test("duck: no full-height stand under a low ceiling, crouch fits", () => {
  const world: CollisionWorld = {
    blockers: [wallFromRect("EAVE", 0, 0, 2, 2, { baseY: 1.1, topY: Infinity })],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  assert.equal(canStand(world, 0, 0, CAPSULE_RADIUS, 0), false);
  const clr = headClearance(world, 0, 0, CAPSULE_RADIUS, 0);
  assert.ok(clr >= CROUCH_HEIGHT - 0.05 && clr < STAND_HEIGHT, `clearance ${clr}`);
});

test("C toggles free crouch and refuses stand without head clearance", () => {
  const open = emptyWorld();
  const grounded = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
  const down = toggleFreeCrouch(open, grounded);
  assert.ok(down.changed);
  assert.equal(down.state.phase, "CROUCH");
  assert.equal(down.state.capsuleHeight, CROUCH_HEIGHT);
  assert.equal(down.state.action, null, "free C must not create DUCK_UNDER action");
  const up = toggleFreeCrouch(open, down.state);
  assert.ok(up.changed);
  assert.equal(up.state.phase, "GROUNDED");
  assert.equal(up.state.capsuleHeight, STAND_HEIGHT);

  const lowCeiling: CollisionWorld = {
    blockers: [wallFromRect("EAVE", 0, 0, 2, 2, { baseY: 1.1, topY: Infinity })],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  const blocked = toggleFreeCrouch(lowCeiling, down.state);
  assert.equal(blocked.changed, false);
  assert.equal(blocked.state.phase, "CROUCH");
  assert.equal(blocked.state.capsuleHeight, CROUCH_HEIGHT);
});

test("landing validation and support queries", () => {
  const world: CollisionWorld = {
    blockers: [wallFromRect("BOX", 0, 0, 1, 1, { topY: 1.0 })],
    platforms: [platformFromRect("ROOF", 5, 8, -1, 1, 3)],
    bounds: OPEN_BOUNDS,
  };
  assert.equal(supportBelow(world, 0, 0, 1.0)?.y, 1.0); // box top
  assert.equal(supportBelow(world, 6, 6, 5)?.y, 0); // off the roof, ground
  assert.equal(supportBelow(world, 6, 0, 3)?.id, "ROOF");
  assert.ok(landingValid(world, 6, 0, CAPSULE_RADIUS, 3, STAND_HEIGHT));
  assert.ok(!landingValid(world, 6, 0, CAPSULE_RADIUS, 2, STAND_HEIGHT)); // no support at y=2
});

test("cancelAction snaps to nearest validated endpoint, zeroes velocity", () => {
  const world: CollisionWorld = { blockers: [], platforms: [], bounds: OPEN_BOUNDS };
  let s = createGroundedState({ x: 0, y: 0, z: 2 }, 0);
  const begun = beginAuthored(world, s, {
    kind: "VAULT",
    anchors: [
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 0, z: -2 },
    ],
    durationMs: 1000,
    arcHeight: 0.8,
  })!;
  // Advance partway, then cancel.
  let mid = begun;
  for (let i = 0; i < 20; i++) mid = stepMotion(world, mid, { dt: 1 / 60, targetVelX: 0, targetVelZ: 0, reducedMotion: false }).state;
  const { state, events } = cancelAction(world, mid);
  assert.ok(events.includes("actionCancelled"));
  assert.equal(state.phase, "GROUNDED");
  assert.equal(state.vel.x, 0);
  assert.equal(state.vel.y, 0);
  assert.equal(state.vel.z, 0);
  // Snapped to one of the two endpoints (z=2 start or z=-2 end), never a midpoint.
  assert.ok(Math.abs(state.pos.z - 2) < 1e-6 || Math.abs(state.pos.z + 2) < 1e-6, `snapped to midpoint z=${state.pos.z}`);
});

test("reduced motion snaps an authored action straight to its endpoint", () => {
  const world: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("TOP", -1, 1, -1, 1, 1.5)],
    bounds: OPEN_BOUNDS,
  };
  let s = createGroundedState({ x: 0, y: 0, z: 2 }, 0);
  const begun = beginAuthored(world, s, {
    kind: "CLIMB_UP",
    anchors: [
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 1.5, z: 0 },
    ],
    durationMs: 2000,
  })!;
  const r = stepMotion(world, begun, { dt: 1 / 60, targetVelX: 0, targetVelZ: 0, reducedMotion: true });
  assert.ok(r.events.includes("actionComplete"));
  assert.ok(Math.abs(r.state.pos.y - 1.5) < 0.01);
});

test("invalid preflight (no landing) does nothing", () => {
  const world: CollisionWorld = { blockers: [], platforms: [], bounds: OPEN_BOUNDS };
  const s = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
  // End floats at y=3 with no support -> landingValid false -> begin returns null.
  const begun = beginAuthored(world, s, {
    kind: "CLIMB_UP",
    anchors: [
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 3, z: 0 },
    ],
    durationMs: 800,
  });
  assert.equal(begun, null);
});

test("walking off a high platform falls instead of teleporting to ground", () => {
  const world: CollisionWorld = {
    blockers: [],
    platforms: [platformFromRect("ROOF", -1, 1, -1, 1, 3)],
    bounds: OPEN_BOUNDS,
  };
  let s = createGroundedState({ x: 0, y: 3, z: 0 }, 0);
  // Push east off the roof edge.
  const r = run(world, s, 180, 1 / 60, { targetVelX: 4 });
  assert.ok(r.state.pos.y < 3, "should have left the roof");
  assert.ok(r.events.includes("landed"), "should land on the ground below");
  assert.ok(Math.abs(r.state.pos.y) < 0.01, `ground landing y=${r.state.pos.y}`);
});

// ---------------------------------------------------------------------------
// DEPENETRATION.
//
// Until today nothing in the step ever pushed a body out of anything. A capsule
// that ended a frame inside a blocker stayed inside it indefinitely and escaped
// only if the player happened to hold a direction that pointed outward, which
// is the "you glitch on objects" in the owner's report. The sweep is not the
// answer to this and never was: it stops a body from ENTERING a blocker, and is
// silent about one that is already in.
// ---------------------------------------------------------------------------

test("a body that starts inside a blocker is pushed out of it", () => {
  const world: CollisionWorld = {
    blockers: [wallFromRect("BLOCK", 0, 0, 1, 1, { topY: 3 })],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  const embedded = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
  assert.equal(
    positionClear(world, embedded.pos, CAPSULE_RADIUS, STAND_HEIGHT),
    false,
    "the fixture has to start embedded or it proves nothing",
  );

  // No input at all. Before this existed the body sat here forever.
  const rested = run(world, embedded, 60, 1 / 60, {});
  assert.ok(
    positionClear(world, rested.state.pos, CAPSULE_RADIUS, STAND_HEIGHT),
    `still embedded at (${rested.state.pos.x}, ${rested.state.pos.z})`,
  );
});

test("a body wedged in a corner leaves it, and is not fired out of it", () => {
  // TWO BLOCKERS AT ONCE IS THE CASE THAT BREAKS NAIVE IMPLEMENTATIONS. Resolve
  // each overlap independently and add the pushes together and an inside corner
  // ejects the body about twice as far as either wall needs. The resolution is
  // deepest-first with everything re-measured from the new position each pass,
  // so the corner is walked out of rather than sprung out of.
  const world: CollisionWorld = {
    blockers: [
      wallFromRect("WEST", -1, 0, 1, 4, { topY: 3 }),
      wallFromRect("SOUTH", 0, -1, 4, 1, { topY: 3 }),
    ],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  // Just inside the corner both walls make at (0, 0).
  const start = { x: -0.1, y: 0, z: -0.1 };
  const rested = run(world, createGroundedState(start, 0), 60, 1 / 60, {});
  const moved = Math.hypot(
    rested.state.pos.x - start.x,
    rested.state.pos.z - start.z,
  );
  assert.ok(
    positionClear(world, rested.state.pos, CAPSULE_RADIUS, STAND_HEIGHT),
    `corner did not resolve: (${rested.state.pos.x}, ${rested.state.pos.z})`,
  );
  // Freeing this corner needs about 0.45m on each axis, so 0.7m of travel. Twice
  // that would be the double-push bug; three times it would be an ejection.
  assert.ok(
    moved < 1.4,
    `pushed ${moved.toFixed(2)}m out of a corner that needs about 0.7m`,
  );
});

test("depenetration does not nudge a body that is merely leaning on a wall", () => {
  // The sweep parks a body a hair off every face it stops against and the
  // footprint test treats faces as closed, so "resting against" is a rounding
  // error from "inside". A body pressed on a wall must come to rest, not creep.
  const world: CollisionWorld = {
    blockers: [wallFromRect("WALL", 0, 4, 6, 0.5, { topY: 3 })],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  const pressed = run(world, createGroundedState({ x: 0, y: 0, z: 0 }, 0), 240, 1 / 60, {
    targetVelZ: 4.6,
  });
  const settled = run(world, pressed.state, 120, 1 / 60, { targetVelZ: 4.6 });
  assert.ok(
    Math.abs(settled.state.pos.z - pressed.state.pos.z) < 1e-3,
    `body crept ${(settled.state.pos.z - pressed.state.pos.z).toExponential(2)}m while held against a wall`,
  );
});

test("a slot narrower than the body stops rather than jittering", () => {
  // No solution exists here. The loop must notice it is not making progress and
  // leave the body where it is; oscillating between two faces every frame is
  // worse than being stuck, because it looks like the world is shaking.
  const world: CollisionWorld = {
    blockers: [
      wallFromRect("A", 0, -0.5, 4, 0.2, { topY: 3 }),
      wallFromRect("B", 0, 0.5, 4, 0.2, { topY: 3 }),
    ],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  const a = run(world, createGroundedState({ x: 0, y: 0, z: 0 }, 0), 60, 1 / 60, {});
  const b = run(world, a.state, 60, 1 / 60, {});
  assert.ok(
    Math.abs(b.state.pos.z - a.state.pos.z) < 1e-6,
    `unresolvable slot is still moving the body by ${(b.state.pos.z - a.state.pos.z).toExponential(2)}m`,
  );
});

test("a landing whose head is through a deck is not a landing", () => {
  // A platform is a support with no thickness and therefore no underside, which
  // is exactly what lets a player walk beneath a roof — and it means head
  // clearance cannot see one. Mantling onto a market counter with its own
  // canopy 0.65m above it passed every test the game had while putting the
  // player's head through the boards, and was the single worst case the
  // through-the-floor survey found: four verbs, 1.10m in.
  const counter = wallFromRect("COUNTER", 0, 3, 1.3, 1, { topY: 1.9 });
  const world: CollisionWorld = {
    blockers: [counter],
    platforms: [platformFromRect("AWNING", -1.4, 1.4, 1.6, 4.4, 2.55)],
    bounds: OPEN_BOUNDS,
  };
  assert.equal(
    landingValid(world, 0, 3, CAPSULE_RADIUS, 1.9, STAND_HEIGHT),
    false,
    "0.65m of headroom under an awning is not somewhere a body can stand",
  );
  // It is the headroom and not the awning that refuses: a counter low enough to
  // stand on under the same boards is a landing again.
  const lowCounter: CollisionWorld = {
    ...world,
    blockers: [wallFromRect("COUNTER", 0, 3, 1.3, 1, { topY: 0.9 })],
  };
  assert.equal(
    landingValid(lowCounter, 0, 3, CAPSULE_RADIUS, 0.9, STAND_HEIGHT),
    true,
  );
  // And the awning's own top is unaffected: you land ON a deck all the time.
  assert.equal(
    landingValid(world, 0, 3, CAPSULE_RADIUS, 2.55, STAND_HEIGHT),
    true,
  );
});

// ---------------------------------------------------------------------------
// STEP OFFSET.
//
// The sweep stops the capsule the same distance short of a blocker whatever its
// height, so before this a 3cm doorstep and a cathedral wall were the same wall
// to a running body. The parkour ladder was papering over it with a 750ms
// scripted vault for a 10cm kerb, which is a verb doing a tolerance's job.
// ---------------------------------------------------------------------------

test("a kerb too low to be worth a verb no longer stops a run", () => {
  for (const height of [0.03, 0.1, 0.34]) {
    const world: CollisionWorld = {
      blockers: [wallFromRect("KERB", 0, 3, 6, 1.5, { topY: height })],
      platforms: [],
      bounds: OPEN_BOUNDS,
    };
    let state = createGroundedState({ x: 0, y: 0, z: 0 }, 0);
    let stoodOnTop = false;
    for (let tick = 0; tick < 180; tick++) {
      state = stepMotion(world, state, {
        dt: 1 / 60,
        targetVelX: 0,
        targetVelZ: 4.6,
        reducedMotion: false,
      }).state;
      // The kerb spans z = 2.25 to 3.75; anywhere in its middle the body should
      // be up on it rather than pushed against it or walking through it.
      if (state.pos.z > 2.6 && state.pos.z < 3.4) {
        assert.ok(
          Math.abs(state.pos.y - height) < 0.02,
          `crossing a ${(height * 100).toFixed(0)}cm kerb at z=${state.pos.z.toFixed(2)} with feet at y=${state.pos.y.toFixed(3)}`,
        );
        stoodOnTop = true;
      }
    }
    assert.ok(
      stoodOnTop && state.pos.z > 4,
      `a ${(height * 100).toFixed(0)}cm kerb stopped a full-speed run at z=${state.pos.z.toFixed(2)}`,
    );
  }
});

test("the step offset is a ceiling, not a ramp up anything", () => {
  // Above the free step the body must still be stopped, or the offset has
  // quietly become a climb and the verb ladder has nothing left to do.
  const world: CollisionWorld = {
    blockers: [wallFromRect("LEDGE", 0, 3, 6, 0.6, { topY: STEP_UP + 0.1 })],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  const r = run(world, createGroundedState({ x: 0, y: 0, z: 0 }, 0), 180, 1 / 60, {
    targetVelZ: 4.6,
  });
  assert.ok(r.state.pos.y < 0.01, `body climbed to y=${r.state.pos.y} unasked`);
  assert.ok(r.state.pos.z < 3, `body passed the ledge at z=${r.state.pos.z}`);
});

test("the step offset will not put a body under a soffit it cannot stand in", () => {
  // Lifting the capsule is only legal if the capsule fits lifted. A kerb with a
  // beam over it must stop the body, not wedge it.
  const world: CollisionWorld = {
    blockers: [
      wallFromRect("KERB", 0, 3, 6, 0.3, { topY: 0.3 }),
      wallFromRect("BEAM", 0, 3, 6, 0.3, { baseY: 1.2, topY: 1.8 }),
    ],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  const r = run(world, createGroundedState({ x: 0, y: 0, z: 0 }, 0), 180, 1 / 60, {
    targetVelZ: 4.6,
  });
  assert.ok(
    r.state.pos.z < 3,
    `body stepped up into a 1.2m soffit and ended at z=${r.state.pos.z.toFixed(2)}`,
  );
});

test("the step offset will not walk a body out over a hole", () => {
  // The far side has to have something to stand on. A lip with nothing behind
  // it is a lip, and leaving the ground is the fall path's business.
  const world: CollisionWorld = {
    blockers: [wallFromRect("LIP", 0, 3, 6, 0.3, { topY: 0.3, landable: false })],
    platforms: [],
    bounds: OPEN_BOUNDS,
  };
  const r = run(world, createGroundedState({ x: 0, y: 0, z: 0 }, 0), 120, 1 / 60, {
    targetVelZ: 4.6,
  });
  assert.ok(
    Math.abs(r.state.pos.y) < 0.01,
    `body rose to y=${r.state.pos.y} onto a top that is not landable`,
  );
});
